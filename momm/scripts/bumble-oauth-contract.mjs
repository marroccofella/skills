// OAuth-only native-node contract foundations. Pure preparation/validation, no I/O.
// These functions do not mint owner approval, contact an issuer or qualify a worker.
import crypto from 'node:crypto';import {parseBumbleJSON} from './bumble-contract.mjs';
const scopes=new Set(['momm.models.read','momm.infer','momm.jobs.read','momm.jobs.cancel']);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>d.enumerable&&Object.hasOwn(d,'value'));
const time=v=>Number.isSafeInteger(v)&&v>=0;
const fail=code=>{throw Object.assign(Error('OAuth contract refused: '+code),{code});};
const ownKeys=(v,allowed)=>plain(v)&&Object.keys(v).every(k=>allowed.includes(k));
const copy=v=>JSON.parse(JSON.stringify(v));
const contracts=new WeakSet(),flows=new WeakMap(),exchanges=new WeakMap();
const deepFreeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))deepFreeze(child);Object.freeze(v);}return v;};
function httpsURL(value){
 if(typeof value!=='string'||value.length>2000||/[\x00-\x20\x7f]/.test(value))fail('unsafe_endpoint');
 let u;try{u=new URL(value);}catch{fail('unsafe_endpoint');}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search)fail('unsafe_endpoint');return u;
}
function redirectURL(value){
 let u;try{u=new URL(value);}catch{fail('unsafe_redirect');}
 if(u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||!u.port||Number(u.port)<1||Number(u.port)>65535||u.pathname!=='/momm/oauth/callback'||u.search||u.hash)fail('unsafe_redirect');return u;
}
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function validateBumbleOAuthMetadata(profile,metadata){
 if(!ownKeys(profile,['schema','issuer','resource','client_id','scopes','redirect_uri','config_epoch'])||profile.schema!=='momm-bumble-oauth-profile/1'||typeof profile.client_id!=='string'||!profile.client_id.length||profile.client_id.length>200||/[\x00-\x20\x7f]/.test(profile.client_id)||typeof profile.config_epoch!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(profile.config_epoch))fail('invalid_profile');
 httpsURL(profile.issuer);httpsURL(profile.resource);redirectURL(profile.redirect_uri);
 if(!Array.isArray(profile.scopes)||!profile.scopes.length||profile.scopes.length>scopes.size||new Set(profile.scopes).size!==profile.scopes.length||profile.scopes.some(s=>!scopes.has(s)))fail('scope_not_allowed');
 if(!plain(metadata)||metadata.issuer!==profile.issuer||!Array.isArray(metadata.response_types_supported)||!metadata.response_types_supported.includes('code')||!Array.isArray(metadata.code_challenge_methods_supported)||!metadata.code_challenge_methods_supported.includes('S256')||!Array.isArray(metadata.token_endpoint_auth_methods_supported)||!metadata.token_endpoint_auth_methods_supported.includes('none')||metadata.authorization_response_iss_parameter_supported!==true)fail('unsupported_metadata');
 httpsURL(metadata.authorization_endpoint);httpsURL(metadata.token_endpoint);
 if(metadata.grant_types_supported!==undefined&&(!Array.isArray(metadata.grant_types_supported)||!metadata.grant_types_supported.includes('authorization_code')))fail('unsupported_grant');
 const contract=deepFreeze({schema:'momm-bumble-oauth-contract/1',profile:copy(profile),authorization_endpoint:metadata.authorization_endpoint,token_endpoint:metadata.token_endpoint,issuer_parameter_required:true,
   metadata_sha256:crypto.createHash('sha256').update(JSON.stringify(metadata)).digest('hex'),owner_approval_required:true,trust_qualification_required:true,model_calls:0,quorum_votes:0,completion:false});
 contracts.add(contract);return contract;
}
export function prepareBumblePKCE(contract,{now,deadline}){
 if(!contracts.has(contract)||!time(now)||!time(deadline)||deadline<=now||deadline-now>600000)fail('invalid_authorization_window');
 const verifier=crypto.randomBytes(64).toString('base64url'),state=crypto.randomBytes(32).toString('base64url');
 const challenge=crypto.createHash('sha256').update(verifier).digest('base64url'),uri=new URL(contract.authorization_endpoint);
 for(const [name,value]of Object.entries({response_type:'code',client_id:contract.profile.client_id,redirect_uri:contract.profile.redirect_uri,scope:contract.profile.scopes.join(' '),resource:contract.profile.resource,state,code_challenge:challenge,code_challenge_method:'S256'}))uri.searchParams.set(name,value);
 // Only this process owns the verifier and consumed state. Copying the browser
 // descriptor conveys no authorization. Restart invalidates flows; no replay or
 // persisted credential is recovered here. Durable owner approval remains separate.
 const intent=Object.freeze({schema:'momm-bumble-oauth-intent/1',created_at:now,deadline,state,challenge,authorization_uri:uri.href});
 flows.set(intent,{contract,created_at:now,deadline,state,verifier:Buffer.from(verifier),consumed:false});return intent;
}
export function consumeBumbleOAuthCallback(intent,callback,{now}){
 const flow=flows.get(intent);
 if(!flow||flow.consumed||!time(now)||now<flow.created_at||now>=flow.deadline)fail('expired_or_consumed');
 if(typeof callback!=='string'||callback.length>16000||/[\x00-\x20\x7f]/.test(callback))fail('invalid_callback');
 let uri;try{uri=new URL(callback);}catch{fail('invalid_callback');}
 const expected=new URL(flow.contract.profile.redirect_uri);
 if(uri.origin!==expected.origin||uri.pathname!==expected.pathname||uri.username||uri.password||uri.hash)fail('redirect_mismatch');
 const allowed=['code','state','iss','error','error_description','error_uri'];
 for(const key of uri.searchParams.keys())if(!allowed.includes(key)||uri.searchParams.getAll(key).length!==1)fail('invalid_callback_fields');
 if(!equal(uri.searchParams.get('state'),flow.state))fail('state_mismatch');
 const issuer=uri.searchParams.get('iss');if(issuer!==flow.contract.profile.issuer)fail('issuer_mismatch');
 // Burn before a token exchange, including provider refusal. A timeout is not
 // permission to replay a possibly consumed code; durable handling is still needed.
 flow.consumed=true;
 try{
  if(uri.searchParams.has('error'))fail('authorization_refused');
  if(uri.searchParams.has('error_description')||uri.searchParams.has('error_uri'))fail('ambiguous_callback');
  const code=uri.searchParams.get('code');if(typeof code!=='string'||!code.length||code.length>4096||/[\x00-\x20\x7f]/.test(code))fail('invalid_code');
  const exchange={token_endpoint:flow.contract.token_endpoint,body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:flow.contract.profile.redirect_uri,client_id:flow.contract.profile.client_id,code_verifier:flow.verifier.toString(),resource:flow.contract.profile.resource}),token_material_private:true};
  exchanges.set(exchange,{contract:flow.contract,body:exchange.body.toString(),used:false});return exchange;
 }finally{flow.verifier.fill(0);}
}
export function describeBumbleOAuthExchange(exchange,contract){
 const e=exchanges.get(exchange);
 if(!e||e.used||e.contract!==contract||!contracts.has(contract)||exchange.token_endpoint!==contract.token_endpoint||!(exchange.body instanceof URLSearchParams)||exchange.body.toString()!==e.body)fail('owned_unmodified_exchange_required');
 return Object.freeze({token_endpoint:contract.token_endpoint,request_sha256:crypto.createHash('sha256').update(e.body).digest('hex')});
}
export function takeBumbleOAuthExchange(exchange,contract){
 const descriptor=describeBumbleOAuthExchange(exchange,contract),e=exchanges.get(exchange);e.used=true;
 const body=Buffer.from(e.body);e.body=null;
 return Object.freeze({...descriptor,body,private_material:true,toJSON(){throw Error('Private OAuth exchange is not serializable.');}});
}
export function validateBumbleOAuthTokenEnvelope(raw,{contract,now,minimum_lifetime_ms=0}){
 if(!contracts.has(contract)||!time(now)||!time(minimum_lifetime_ms)||typeof raw!=='string'||Buffer.byteLength(raw)>32000)fail('invalid_token_envelope');
 let value;try{value=parseBumbleJSON(raw);}catch{fail('invalid_token_json');}
 if(!ownKeys(value,['access_token','token_type','expires_in','scope','refresh_token','id_token'])||typeof value.access_token!=='string'||!value.access_token.length||Buffer.byteLength(value.access_token)>8192||!/^[-A-Za-z0-9._~+/]+=*$/.test(value.access_token)||typeof value.token_type!=='string'||value.token_type.toLowerCase()!=='bearer'||!Number.isSafeInteger(value.expires_in)||value.expires_in<1||value.expires_in>86400)fail('invalid_token_response');
 const granted=value.scope===undefined?[...contract.profile.scopes]:typeof value.scope==='string'?value.scope.split(' ').filter(Boolean):[];
 if(!granted.length||new Set(granted).size!==granted.length||granted.some(s=>!contract.profile.scopes.includes(s))||contract.profile.scopes.some(s=>!granted.includes(s)))fail('scope_mismatch');
 const expires_at=now+value.expires_in*1000;if(!time(expires_at)||expires_at-now<=minimum_lifetime_ms)fail('insufficient_token_lifetime');
 // No identity is inferred from an unverified id_token. Refresh persistence and
 // rotation require the protected broker/owner policy and are not implemented here.
 return {schema:'momm-bumble-oauth-token-material/1',access_token:Buffer.from(value.access_token),expires_at,scopes:granted,refresh_material_withheld:Object.hasOwn(value,'refresh_token'),identity:'unverified',protected_storage_required:true,resource:contract.profile.resource,issuer:contract.profile.issuer,model_calls:0,quorum_votes:0,completion:false};
}
