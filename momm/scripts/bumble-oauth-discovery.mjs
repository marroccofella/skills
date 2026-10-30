// Public profile parsing is not owner trust, login, token validation or worker qualification.
// No I/O: a trusted bounded/TLS-qualified reader must supply these bytes separately.
import crypto from 'node:crypto';import {parseBumbleJSON} from './bumble-contract.mjs';
const SHA=/^[a-f0-9]{64}$/,SCOPES=new Set(['momm.models.read','momm.infer','momm.jobs.read','momm.jobs.cancel']);
const fail=code=>{throw Object.assign(Error('OAuth discovery refused: '+code),{code});};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function closed(v,names){if(!plain(v))return false;const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);return keys.length===names.length&&keys.every(k=>typeof k==='string'&&names.includes(k)&&ds[k].enumerable&&Object.hasOwn(ds[k],'value'));}
const freeze=v=>{if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;};
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const epoch=v=>Number.isSafeInteger(v)&&v>=1;
const matchedAssessments=new WeakSet();
function https(value){if(typeof value!=='string'||value.length>2000||/[\x00-\x20\x7f]/.test(value))fail('unsafe_public_endpoint');let u;try{u=new URL(value);}catch{fail('unsafe_public_endpoint');}if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search)fail('unsafe_public_endpoint');return u;}
function scopeList(v){
 if(!Array.isArray(v)||v.length<1||v.length>4)return false;const ds=Object.getOwnPropertyDescriptors(v);
 if(Reflect.ownKeys(ds).length!==v.length+1)return false;const values=[];
 for(let i=0;i<v.length;i++){const d=ds[String(i)];if(!d||!d.enumerable||!Object.hasOwn(d,'value')||!SCOPES.has(d.value))return false;values.push(d.value);}
 return new Set(values).size===values.length;
}
export function bumbleOAuthDiscoveryURL(issuer,{kind='oauth_as'}={}){
 const u=https(issuer);if(!['oauth_as','oidc'].includes(kind))fail('unsupported_discovery_kind');
 // RFC8414 inserts before the issuer path; OIDC discovery appends to it.
 const suffix=u.pathname.replace(/\/+$/,'');
 u.pathname=kind==='oauth_as'?'/.well-known/oauth-authorization-server'+suffix:suffix.replace(/\/$/,'')+'/.well-known/openid-configuration';return u.href;
}
export function parseBumbleAuthProfile(raw){
 const bytes=typeof raw==='string'?Buffer.from(raw):raw instanceof Uint8Array?Buffer.from(raw):null;if(!bytes||bytes.length<1||bytes.length>32000)fail('profile_byte_budget');
 let p;try{p=parseBumbleJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('invalid_profile_json');}
 const raw_sha256=H(bytes);
 if(closed(p,['schema','state','reason','profile_epoch'])&&p.schema==='momm-bumble-auth-profile/1'&&p.state==='unsupported'&&p.reason==='oauth_not_configured'&&epoch(p.profile_epoch))return freeze({schema:p.schema,state:p.state,reason:p.reason,profile_epoch:p.profile_epoch,raw_sha256,owner_approval_required:true,login_allowed:false,qualified:false,quorum_votes:0,completion:false});
 if(!closed(p,['schema','state','issuer','resource','client_id','scopes','redirect','flow','profile_epoch'])||p.schema!=='momm-bumble-auth-profile/1'||!['supported','proposed'].includes(p.state)||!epoch(p.profile_epoch))fail('invalid_profile_shape');
 https(p.issuer);https(p.resource);if(typeof p.client_id!=='string'||!p.client_id.length||p.client_id.length>200||/[\x00-\x20\x7f]/.test(p.client_id)||!scopeList(p.scopes))fail('invalid_public_client_scope');
 if(!closed(p.flow,['grant','pkce','token_endpoint_auth_method'])||p.flow.grant!=='authorization_code'||p.flow.pkce!=='S256'||p.flow.token_endpoint_auth_method!=='none')fail('unsupported_public_flow');
 if(!closed(p.redirect,['scheme','hosts','path','port_policy'])||p.redirect.scheme!=='http'||p.redirect.path!=='/momm/oauth/callback'||p.redirect.port_policy!=='ephemeral'||!Array.isArray(p.redirect.hosts)||p.redirect.hosts.length<1||p.redirect.hosts.length>2||new Set(p.redirect.hosts).size!==p.redirect.hosts.length||p.redirect.hosts.some(host=>!['127.0.0.1','[::1]'].includes(host)))fail('unsupported_loopback_rules');
 return freeze({...p,scopes:[...p.scopes],redirect:{...p.redirect,hosts:[...p.redirect.hosts]},flow:{...p.flow},raw_sha256,owner_approval_required:true,login_allowed:false,qualified:false,quorum_votes:0,completion:false});
}
export function assessBumbleAuthProfile(raw,{resource,trust=null}={}){
 https(resource);const profile=parseBumbleAuthProfile(raw);
 const base={schema:'momm-bumble-discovery-assessment/1',profile,login_allowed:false,qualified:false,quorum_votes:0,completion:false};
 if(profile.state==='unsupported')return freeze({...base,state:'unsupported',reason:'oauth_not_configured'});
 if(profile.resource!==resource)return freeze({...base,state:'refused',reason:'resource_mismatch'});
 if(profile.state==='proposed')return freeze({...base,state:'proposed',reason:'capability_not_established'});
 if(trust===null)return freeze({...base,state:'trust_required',reason:'metadata_cannot_approve_itself'});
 // These pins are supplied by the trusted owner-consent host, NOT copied from
 // the advertisement or received worker fields. This function verifies matches;
 // it cannot certify that a human actually approved them or real TLS occurred.
 if(!closed(trust,['schema','issuer','resource','client_id','scopes','minimum_epoch','profile_sha256'])||trust.schema!=='momm-bumble-auth-trust-pins/1'||!epoch(trust.minimum_epoch)||!SHA.test(trust.profile_sha256)||!scopeList(trust.scopes))fail('invalid_trust_pins');
 if(trust.issuer!==profile.issuer||trust.resource!==profile.resource||trust.client_id!==profile.client_id||trust.profile_sha256!==profile.raw_sha256||profile.profile_epoch<trust.minimum_epoch||trust.scopes.length!==profile.scopes.length||trust.scopes.some(s=>!profile.scopes.includes(s)))return freeze({...base,state:'refused',reason:'trust_binding_changed'});
 const matched=freeze({...base,state:'profile_matches_pins',reason:'issuer_metadata_and_human_login_still_required',pins_match:true});matchedAssessments.add(matched);return matched;
}
// Pure callback decision, not a socket/listener or owner approval. The actual
// listener must bind this exact literal host and report its real ephemeral port.
// A copied DTO cannot manufacture the original matching byte/pin assessment.
export function selectBumbleOAuthCallback(assessment,options){
 if(!matchedAssessments.has(assessment))fail('owned_matching_profile_required');
 if(!closed(options,['port'])&&!closed(options,['port','host']))fail('invalid_callback_options');
 const {port}=options;if(!Number.isSafeInteger(port)||port<1||port>65535)fail('invalid_callback_port');
 const hosts=assessment.profile.redirect.hosts,host=Object.hasOwn(options,'host')?options.host:hosts.includes('127.0.0.1')?'127.0.0.1':'[::1]';
 if(!hosts.includes(host))fail('callback_host_not_pinned');
 return freeze({schema:'momm-bumble-callback-decision/1',profile_sha256:assessment.profile.raw_sha256,advertised_host:host,bind_host:host==='[::1]'?'::1':host,port,redirect_uri:'http://'+host+':'+port+assessment.profile.redirect.path,listener_verified:false,login_allowed:false,qualified:false,quorum_votes:0,completion:false});
}
