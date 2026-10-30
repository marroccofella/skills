// Offline canonical-peer OAuth frame custody. No network, login or activation.
// Only the trusted host supplies authorization; caller/model data is not authority.
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {prepareBumblePeerRequest} from './bumble-peer-review.mjs';
const wall=Date.now.bind(Date),mono=performance.now.bind(performance),frames=new WeakMap();
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uint=v=>Number.isSafeInteger(v)&&v>=0;
const fail=code=>{throw Object.assign(Error('Peer OAuth handoff refused: '+code),{code});};
function own(value,keys){
 if(!value||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('invalid_fields');
 const d=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(d);
 if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail('invalid_fields');
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
export function prepareBumbleOAuthPeerContract(input){
 const request=prepareBumblePeerRequest(input),body=JSON.parse(request.request_body);
 return Object.freeze({...request,system_sha256:H(body.messages[0].content),wire_encoding:'utf8-json-stringify/1',
  response_format:'json_object+schema',request_path:'/v1/chat/completions',authentication:'oauth-bearer',
  requires_qualified_host:true,request_sent:false});
}
const CONFIG=['base_url','server_name','certificate_sha256','scope_binding','baseline_report_sha256','association_sha256','validator_sha256','policy_sha256','trust_sha256','disclosure_sha256','logging_sha256','attempt_id','deadline'];
function configValue(value){
 const c=own(value,CONFIG);
 if(CONFIG.filter(k=>k.endsWith('sha256')||k==='scope_binding').some(k=>!sha(c[k]))||typeof c.attempt_id!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(c.attempt_id)||!uint(c.deadline))fail('invalid_configuration');
 if(typeof c.base_url!=='string'||c.base_url.length>2000||typeof c.server_name!=='string'||!c.server_name.length||c.server_name.length>253||/[\x00-\x20\x7f]/.test(c.base_url+c.server_name))fail('invalid_configuration');
 let u;try{u=new URL(c.base_url);}catch{fail('invalid_configuration');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/v1')fail('invalid_configuration');
 // Socket address, TLS trust and caller qualification still belong to the host.
 return Object.freeze(c);
}
const GRANT=['schema','config_sha256','request_sha256','scope_binding','policy_sha256','trust_sha256','disclosure_sha256','logging_sha256','valid_until'];
function approval(authorize,query,c){
 let v;try{v=own(authorize(query),GRANT);}catch{fail('owner_approval_required');}
 if(v.schema!=='momm-bumble-oauth-peer-approval/1'||v.config_sha256!==query.config_sha256||v.request_sha256!==query.request_sha256||['scope_binding','policy_sha256','trust_sha256','disclosure_sha256','logging_sha256'].some(k=>v[k]!==c[k])||!uint(v.valid_until)||v.valid_until<c.deadline||v.valid_until<=wall()||v.valid_until-wall()>86400000)fail('owner_approval_required');
 return H(JSON.stringify(v));
}
export function sealBumbleOAuthPeerHandoff(input,config,privateInput,authorize=null){
 if(typeof authorize!=='function')fail('owner_approval_required'); // Before input/secret getters.
 const request=prepareBumbleOAuthPeerContract(input),c=configValue(config),started=wall(),startMono=mono();
 if(c.deadline<=started||c.deadline-started>180000)fail('invalid_deadline');
 const query=Object.freeze({operation:'seal_oauth_peer_handoff',config_sha256:H(JSON.stringify(c)),request_sha256:request.request_sha256,scope_binding:c.scope_binding,deadline:c.deadline});
 const grant=approval(authorize,query,c);
 if(wall()>=c.deadline||mono()-startMono>=c.deadline-started)fail('handoff_expired');
 const secret=own(privateInput,['access_token','certificate']);
 if(!(secret.access_token instanceof Uint8Array)||secret.access_token.length<8||secret.access_token.length>4096||!(secret.certificate instanceof Uint8Array)||secret.certificate.length<1||secret.certificate.length>32768)fail('invalid_private_material');
 const token=Buffer.from(secret.access_token),certificate=Buffer.from(secret.certificate);let bytes;
 try{
  if(!/^[-A-Za-z0-9._~+/]+=*$/.test(token.toString('utf8'))||H(certificate)!==c.certificate_sha256)fail('private_binding_changed');
  bytes=Buffer.from(JSON.stringify({schema:'momm-bumble-oauth-peer-private-frame/1',authentication:'oauth-bearer',config:c,
   peer_contract:request.peer_contract,wire_encoding:request.wire_encoding,model:request.model,role:request.role,role_version:request.role_version,
   max_tokens:request.max_tokens,artifact_sha256:request.artifact_sha256,schema_sha256:request.schema_sha256,system_sha256:request.system_sha256,
   request_body_base64:Buffer.from(request.request_body).toString('base64'),request_sha256:request.request_sha256,
   access_token_base64:token.toString('base64'),certificate_base64:certificate.toString('base64'),approval_sha256:grant}));
 }finally{token.fill(0);certificate.fill(0);}
 if(bytes.length>200000||wall()>=c.deadline||mono()-startMono>=c.deadline-started){bytes.fill(0);fail('handoff_expired_or_oversize');}
 const descriptor=Object.freeze({schema:'momm-bumble-oauth-peer-handoff/1',sha256:H(bytes),bytes:bytes.length,request_sha256:request.request_sha256,
  deadline:c.deadline,authentication:'oauth-bearer',request_sent:false,physical_release_verified:false,quorum_votes:0,completion:false});
 frames.set(descriptor,{bytes,config:c,query,grant,authorize,started,startMono,used:false});return descriptor;
}
export function takeBumbleOAuthPeerHandoff(value){
 const f=frames.get(value);if(!f||f.used)fail('owned_original_handoff_required');f.used=true;
 try{
  if(wall()>=f.config.deadline||mono()-f.startMono>=f.config.deadline-f.started)fail('handoff_expired');
  if(approval(f.authorize,Object.freeze({...f.query,operation:'take_oauth_peer_handoff'}),f.config)!==f.grant)fail('owner_approval_changed');
  if(wall()>=f.config.deadline||mono()-f.startMono>=f.config.deadline-f.started||H(f.bytes)!==value.sha256)fail('handoff_expired_or_changed');
  const bytes=Buffer.from(f.bytes);
  if(wall()>=f.config.deadline||mono()-f.startMono>=f.config.deadline-f.started){bytes.fill(0);fail('handoff_expired');}
  return Object.freeze({bytes,private_material:true,request_sent:false,quorum_votes:0,toJSON(){throw Error('Private OAuth peer material is not serializable.');}});
 }finally{f.bytes.fill(0);}
}
export function discardBumbleOAuthPeerHandoff(value){const f=frames.get(value);if(!f)fail('owned_original_handoff_required');f.used=true;f.bytes.fill(0);return Object.freeze({discarded:true,physical_release_verified:false,quorum_votes:0});}
