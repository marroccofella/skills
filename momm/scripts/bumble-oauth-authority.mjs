// Temporary OAuth authority core for an explicitly approved single-review pilot.
// No listener, browser approval, deployment, backend call or API-key adapter.
// Mount only behind a qualified TLS/authenticated-consent host. HTTP request
// fields must NEVER become calls to decide(). State is memory-only: restart
// revokes every grant; it does not reconcile or release an admitted backend job.
import crypto from 'node:crypto';
import {validateBumbleOAuthMetadata} from './bumble-oauth-contract.mjs';
const H=v=>crypto.createHash('sha256').update(v).digest('hex');
const random=()=>crypto.randomBytes(32).toString('base64url');
const fail=code=>{throw Object.assign(Error('Temporary OAuth refused: '+code),{code});};
const data=(v,keys)=>{if(!v||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;const ds=Object.getOwnPropertyDescriptors(v),ks=Reflect.ownKeys(ds);return ks.length===keys.length&&ks.every(k=>typeof k==='string'&&keys.includes(k)&&ds[k].enumerable&&Object.hasOwn(ds[k],'value'));};
function fields(raw,names){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>8192||/%(?![a-fA-F0-9]{2})/.test(raw))fail('invalid_form');
 const p=new URLSearchParams(raw);if([...p.keys()].length!==names.length||names.some(k=>p.getAll(k).length!==1)||[...p.keys()].some(k=>!names.includes(k)))fail('invalid_form');
 return Object.fromEntries(p);
}
const tokenKey=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v)?H(v):null;
export function createTemporaryBumbleOAuthAuthority(config,{now=Date.now}={}){
 if(!data(config,['issuer','resource','client_id','redirect_uri','scopes','model_id','expires_at'])||typeof now!=='function')fail('invalid_configuration');
 // Existing client rules supply HTTPS, scope, exact loopback and public-client
 // validation. Copy before retaining: caller edits cannot widen a running pilot.
 const p=JSON.parse(JSON.stringify(config));
 let previous=now();if(!Number.isSafeInteger(previous)||previous<0||!Number.isSafeInteger(p.expires_at)||p.expires_at<=previous||p.expires_at-previous>1800000||typeof p.model_id!=='string'||!/^[-A-Za-z0-9_.:/]{1,200}$/.test(p.model_id))fail('invalid_window_or_model');
 const issuer=new URL(p.issuer);if(issuer.pathname!=='/'||p.issuer!==issuer.origin)fail('issuer_origin_required');
 const metadata=Object.freeze({issuer:p.issuer,authorization_endpoint:p.issuer+'/authorize',token_endpoint:p.issuer+'/token',revocation_endpoint:p.issuer+'/revoke',response_types_supported:Object.freeze(['code']),grant_types_supported:Object.freeze(['authorization_code']),code_challenge_methods_supported:Object.freeze(['S256']),token_endpoint_auth_methods_supported:Object.freeze(['none']),authorization_response_iss_parameter_supported:true});
 const {model_id,expires_at,...profile}=p;
 validateBumbleOAuthMetadata({schema:'momm-bumble-oauth-profile/1',...profile,config_epoch:'temporary-1'},metadata);
 const pending=new Map(),handles=new WeakMap(),codes=new Map(),tokens=new Map(),permits=new WeakMap();
 let closed=false,admitted=false,epoch=crypto.randomUUID();
 function clock(){const at=now();if(!Number.isSafeInteger(at)||at<previous){close();fail('clock_rollback');}previous=at;if(closed||at>=p.expires_at){close();fail('authority_expired');}return at;}
 function prune(at){for(const map of [pending,codes,tokens])for(const [k,v]of map)if(v.until<=at)map.delete(k);}
 function close(){closed=true;pending.clear();codes.clear();tokens.clear();}
 function grant(token,scope,at){const g=tokens.get(tokenKey(token));if(!g||g.until<=at||!g.scopes.includes(scope))fail('invalid_token_or_scope');return g;}
 return Object.freeze({
  metadata,
  begin(authorization_uri){
   const at=clock();prune(at);if(pending.size>=8)fail('pending_budget');
   let u;try{u=new URL(authorization_uri);}catch{fail('invalid_authorization_request');}
   if(u.origin!==p.issuer||u.pathname!=='/authorize'||u.username||u.password||u.hash)fail('invalid_authorization_request');
   const r=fields(u.search.slice(1),['response_type','client_id','redirect_uri','scope','resource','state','code_challenge','code_challenge_method']);
   const scopes=r.scope.split(' ');
   if(r.response_type!=='code'||r.client_id!==p.client_id||r.redirect_uri!==p.redirect_uri||r.resource!==p.resource||r.code_challenge_method!=='S256'||!tokenKey(r.code_challenge)||!/^[A-Za-z0-9_-]{32,128}$/.test(r.state)||!scopes.length||scopes.some(s=>!p.scopes.includes(s))||new Set(scopes).size!==scopes.length)fail('authorization_binding');
   const id=random(),request={...r,scopes,until:Math.min(at+60000,p.expires_at)};pending.set(id,request);
   const handle=Object.freeze({schema:'momm-bumble-consent-intent/1',client_id:p.client_id,resource:p.resource,scopes:Object.freeze([...scopes]),model_id,expires_at:request.until,max_requests:1,max_tokens:1024,timeout_seconds:180,authenticated_consent_required:true});
   handles.set(handle,id);return handle;
  },
  decide(handle,decision){
   const at=clock(),id=handles.get(handle),r=pending.get(id);if(!r||r.until<=at)fail('expired_or_consumed_consent');
   // Burn before entering any issuance branch; a copied handle has no identity.
   pending.delete(id);handles.delete(handle);
   if(!data(decision,['approved','subject'])||typeof decision.approved!=='boolean'||typeof decision.subject!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/.test(decision.subject))fail('invalid_consent_decision');
   const u=new URL(p.redirect_uri);u.searchParams.set('state',r.state);u.searchParams.set('iss',p.issuer);
   if(!decision.approved){u.searchParams.set('error','access_denied');return u.href;}
   prune(at);if(codes.size>=8)fail('code_budget');const code=random();codes.set(H(code),{...r,subject:decision.subject,until:Math.min(at+60000,p.expires_at)});u.searchParams.set('code',code);return u.href;
  },
  exchange(form){
   const at=clock(),r=fields(form,['grant_type','code','client_id','redirect_uri','code_verifier','resource']),key=tokenKey(r.code),g=codes.get(key);
   if(!g)fail('invalid_grant');codes.delete(key); // No replay, even after a bad verifier.
   if(g.until<=at||r.grant_type!=='authorization_code'||r.client_id!==p.client_id||r.redirect_uri!==p.redirect_uri||r.resource!==p.resource||!/^[-A-Za-z0-9._~]{43,128}$/.test(r.code_verifier)||crypto.createHash('sha256').update(r.code_verifier).digest('base64url')!==g.code_challenge)fail('invalid_grant');
   prune(at);if(tokens.size>=8)fail('token_budget');const token=random(),seconds=Math.min(300,Math.floor((p.expires_at-at)/1000));if(seconds<1)fail('authority_expired');
   tokens.set(H(token),{until:at+seconds*1000,subject:g.subject,scopes:[...g.scopes]});
   // Private endpoint response, never a log/dashboard object. No refresh grant.
   return {access_token:token,token_type:'Bearer',expires_in:seconds,scope:g.scopes.join(' ')};
  },
  authorize(token,request){
   const at=clock();if(!data(request,['resource','scope','model_id'])||request.resource!==p.resource||request.model_id!==model_id||!['momm.models.read','momm.infer'].includes(request.scope))fail('resource_binding');
   const g=grant(token,request.scope,at),permit=Object.freeze({schema:'momm-bumble-resource-permit/1',scope:request.scope,model_id,expires_at:g.until,quorum_votes:0,physical_release_verified:false});
   permits.set(permit,{key:tokenKey(token),scope:request.scope,epoch});return permit;
  },
  admit(permit,request){
   const at=clock(),g=permits.get(permit);permits.delete(permit);
   if(!g||g.epoch!==epoch||g.scope!=='momm.infer')fail('owned_inference_permit_required');
   const token=tokens.get(g.key);if(!token||token.until<=at||!token.scopes.includes('momm.infer'))fail('invalid_token_or_scope');
   if(!data(request,['model_id','max_tokens','stream','request_sha256','deadline'])||request.model_id!==model_id||!Number.isSafeInteger(request.max_tokens)||request.max_tokens<1||request.max_tokens>1024||request.stream!==false||!/^\b[a-f0-9]{64}\b$/.test(request.request_sha256)||!Number.isSafeInteger(request.deadline)||request.deadline<=at||request.deadline-at>180000||request.deadline>token.until||request.deadline>p.expires_at)fail('inference_budget');
   if(admitted)fail('single_review_budget_exhausted');admitted=true;
   return Object.freeze({schema:'momm-bumble-oauth-admission/1',...request,epoch,authorized:true,backend_dispatched:false,physical_release_verified:false,quorum_votes:0,completion:false});
  },
  revoke(token){clock();const key=tokenKey(token);if(key)tokens.delete(key);return Object.freeze({revoked:true,physical_release_verified:false});},
  close(){close();epoch=crypto.randomUUID();return Object.freeze({revoked:true,physical_release_verified:false});}
 });
}
