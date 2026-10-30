// Complete private stdin frame encoder, not a login, transport or send permit.
// Only a trusted host may supply the approval verifier; never create one from
// model/HTTP fields. Native deployment remains unqualified and disabled.
import crypto from 'node:crypto';import {performance} from 'node:perf_hooks';import {prepareBumbleRequest} from './bumble-request.mjs';
const wallNow=Date.now.bind(Date),monoNow=performance.now.bind(performance);
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),SHA=/^[a-f0-9]{64}$/,frames=new WeakMap();
const digest=v=>typeof v==='string'&&SHA.test(v),uint=v=>Number.isSafeInteger(v)&&v>=0;
const fail=code=>{throw Object.assign(Error('OAuth handoff refused: '+code),{code});};
function closed(v,fields){if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d);return keys.length===fields.length&&keys.every(k=>typeof k==='string'&&fields.includes(k)&&d[k].enumerable&&Object.hasOwn(d[k],'value'));}
const CFG=['base_url','server_name','certificate_sha256','scope_binding','baseline_report_sha256','policy_sha256','trust_sha256','disclosure_sha256','logging_sha256'];
export function sealBumbleOAuthHandoff(job,options,config,privateInput,authorize=null){
 // Default denial happens before any private input access or descriptor scan.
 if(typeof authorize!=='function')fail('owner_approval_required');
 const prepared=prepareBumbleRequest(job,options);if(prepared.state!=='prepared_frame')fail(prepared.reason);
 const creationNow=options.now,model_id=job.model_id,options_sha256=H(JSON.stringify(options)),actualNow=wallNow(),creationMono=monoNow();
 // Production frames use absolute epoch deadlines. Caller time cannot extend
 // the module-owned wall/monotonic limit; stale or future clocks are refused.
 if(Math.abs(creationNow-actualNow)>1000||prepared.deadline<=actualNow||prepared.deadline-actualNow>300000)fail('invalid_handoff_clock');
 if(!closed(config,CFG)||CFG.filter(k=>k.endsWith('sha256')||k==='scope_binding').some(k=>!digest(config[k]))||typeof config.base_url!=='string'||config.base_url.length>2000||typeof config.server_name!=='string'||!config.server_name.length||config.server_name.length>253||/[\x00-\x20\x7f]/.test(config.base_url+config.server_name))fail('invalid_connector_configuration');
 let target;try{target=new URL(config.base_url);}catch{fail('invalid_connector_configuration');}if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash)fail('invalid_connector_configuration');
 const config_sha256=H(JSON.stringify(config)),task_sha256=H(JSON.stringify(job.task)),request_sha256=prepared.request_sha256;
 const query=Object.freeze({operation:'seal_oauth_handoff',config_sha256,task_sha256,request_sha256,scope_binding:config.scope_binding,now:actualNow,deadline:prepared.deadline});
 let approval;try{approval=authorize(query);}catch{fail('owner_approval_unavailable');}
 const approvalFields=['schema','config_sha256','task_sha256','request_sha256','scope_binding','policy_sha256','trust_sha256','disclosure_sha256','logging_sha256','valid_until'];
 if(!closed(approval,approvalFields)||approval.schema!=='momm-bumble-oauth-handoff-approval/1'||approval.config_sha256!==config_sha256||approval.task_sha256!==task_sha256||approval.request_sha256!==request_sha256||['scope_binding','policy_sha256','trust_sha256','disclosure_sha256','logging_sha256'].some(k=>approval[k]!==config[k])||!uint(approval.valid_until)||approval.valid_until<prepared.deadline||approval.valid_until<=creationNow||approval.valid_until-creationNow>86400000)fail('owner_approval_required');
 if(H(JSON.stringify(config))!==config_sha256||H(JSON.stringify(job.task))!==task_sha256||job.model_id!==model_id||H(JSON.stringify(options))!==options_sha256)fail('public_frame_changed');
 if(wallNow()>=prepared.deadline)fail('handoff_expired');
 const approval_sha256=H(JSON.stringify(approval));
 if(!closed(privateInput,['access_token','certificate']))fail('invalid_private_fields');
 if(!(privateInput.access_token instanceof Uint8Array)||privateInput.access_token.length<8||privateInput.access_token.length>4096||!(privateInput.certificate instanceof Uint8Array)||privateInput.certificate.length<1||privateInput.certificate.length>32768)fail('invalid_private_material');
 // Work only on an owned token copy; the vault still owns the caller's buffer.
 const token=Buffer.from(privateInput.access_token);let bytes;
 try{
  if([...token].some(b=>!((b>=48&&b<=57)||(b>=65&&b<=90)||(b>=97&&b<=122)||'-._~+/='.includes(String.fromCharCode(b))))||!/^[-A-Za-z0-9._~+/]+=*$/.test(token.toString('ascii')))fail('invalid_bearer_material');
  if(H(privateInput.certificate)!==config.certificate_sha256)fail('certificate_binding_changed');
  if(H(prepared.request_body)!==request_sha256||H(JSON.stringify(job.task))!==task_sha256)fail('public_frame_changed');
  const frame={schema:'momm-bumble-oauth-private-frame/1',authentication:'oauth-bearer',task:job.task,model_id,base_url:config.base_url,server_name:config.server_name,certificate_base64:Buffer.from(privateInput.certificate).toString('base64'),access_token_base64:token.toString('base64'),request_body_base64:prepared.request_body.toString('base64'),request_sha256,config_sha256,task_sha256,scope_binding:config.scope_binding,baseline_report_sha256:config.baseline_report_sha256,approval_sha256,deadline:prepared.deadline,response_bytes:job.task.budget.response_bytes,max_tokens:prepared.max_tokens};
  bytes=Buffer.from(JSON.stringify(frame));if(bytes.length>100000){bytes.fill(0);fail('complete_handoff_byte_budget');}
 }finally{token.fill(0);}
 if(wallNow()>=prepared.deadline){bytes.fill(0);fail('handoff_expired');}
 const value=Object.freeze({schema:'momm-bumble-owned-oauth-handoff/1',task_id:job.task.task_id,attempt_id:job.task.attempt_id,request_sha256,task_sha256,config_sha256,frame_sha256:H(bytes),frame_bytes:bytes.length,deadline:prepared.deadline,credentials_read:true,request_sent:false,model_calls:0,permission_granted:false,transport_qualified:false,quorum_votes:0,completion:false});
 frames.set(value,{bytes,sha256:value.frame_sha256,consumed:false,created_at:actualNow,created_mono:creationMono,maximum_elapsed:Math.max(0,Math.min(300000,prepared.deadline-actualNow)),deadline:prepared.deadline,authorize,query,approval_sha256,approvalFields});return value;
}
export function takeBumbleOAuthHandoff(value,options={now:Date.now()}){
 const f=frames.get(value);if(!f||f.consumed)fail('owned_original_handoff_required');
 if(!closed(options,['now'])||!uint(options.now)){f.consumed=true;f.bytes.fill(0);fail('invalid_take_request');}
 const actualNow=wallNow();
 if(actualNow>=f.deadline||monoNow()-f.created_mono>=f.maximum_elapsed){f.consumed=true;f.bytes.fill(0);fail('handoff_expired');}
 // Claim before calling host code so reentrant take cannot receive the bytes.
 f.consumed=true;
 // Revocation is checked by trusted host code at the point of private release.
 // A changed approval is not silently treated as a renewal or wider permission.
 let approval;try{approval=f.authorize(Object.freeze({...f.query,operation:'take_oauth_handoff',now:actualNow}));}catch{f.consumed=true;f.bytes.fill(0);fail('owner_approval_unavailable');}
 if(wallNow()>=f.deadline||monoNow()-f.created_mono>=f.maximum_elapsed){f.bytes.fill(0);fail('handoff_expired');}
 if(!closed(approval,f.approvalFields)||H(JSON.stringify(approval))!==f.approval_sha256){f.consumed=true;f.bytes.fill(0);fail('owner_approval_required');}
 if(H(f.bytes)!==f.sha256){f.bytes.fill(0);fail('private_frame_changed');}const bytes=Buffer.from(f.bytes);f.bytes.fill(0);
 if(wallNow()>=f.deadline||monoNow()-f.created_mono>=f.maximum_elapsed){bytes.fill(0);fail('handoff_expired');}
 return Object.freeze({bytes,private_material:true,request_sent:false,quorum_votes:0,toJSON(){throw Error('Private OAuth handoff is not serializable.');}});
}
export function discardBumbleOAuthHandoff(value){const f=frames.get(value);if(!f)fail('owned_original_handoff_required');f.bytes.fill(0);f.consumed=true;return Object.freeze({discarded:true,physical_release_verified:false,quorum_votes:0});}
