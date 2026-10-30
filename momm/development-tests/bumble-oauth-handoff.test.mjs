// Generated OAuth-shaped bytes/public certificate stand-in; no real credential,
// network/issuer/model or live transport. Draft outside the frozen137 catalogue.
import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {makeBumbleTask} from '../scripts/bumble-contract.mjs';import {sealBumbleOAuthHandoff,takeBumbleOAuthHandoff,discardBumbleOAuthHandoff} from '../scripts/bumble-oauth-handoff.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),certificate=Buffer.alloc(32768,65),token=Buffer.from(crypto.randomBytes(24).toString('base64url'));
const config={base_url:'https://node.example.test/v1',server_name:'node.example.test',certificate_sha256:H(certificate),scope_binding:H('scope'),baseline_report_sha256:H('baseline'),policy_sha256:H('policy'),trust_sha256:H('trust'),disclosure_sha256:H('disclosure'),logging_sha256:H('logging')};
const options={max_tokens:128,response_format:'json_schema',now:Date.now()};
const jobFor=source=>({model_id:'fixture/model',task:makeBumbleTask({run_id:'rev_fixture',piece_id:'whole',source,scope:[{file:'fixture.js',start_line:1,text:source}],check:'One source-grounded check',omissions:['No callers; generated data only'],deadline:options.now+300000,budget:{response_bytes:4096,candidates:1}})});
const authorize=q=>({schema:'momm-bumble-oauth-handoff-approval/1',config_sha256:q.config_sha256,task_sha256:q.task_sha256,request_sha256:q.request_sha256,scope_binding:q.scope_binding,policy_sha256:config.policy_sha256,trust_sha256:config.trust_sha256,disclosure_sha256:config.disclosure_sha256,logging_sha256:config.logging_sha256,valid_until:q.deadline});
let touched=0;const blocked={get access_token(){touched++;throw Error('Must not read');},certificate};assert.throws(()=>sealBumbleOAuthHandoff(jobFor('const value = 4;'),options,config,blocked),{code:'owner_approval_required'});assert.equal(touched,0);
const job=jobFor('const value = 4;'),sealed=sealBumbleOAuthHandoff(job,options,config,{access_token:token,certificate},authorize);assert(sealed.frame_bytes<=100000);assert.equal(sealed.request_sent,false);assert.equal(sealed.permission_granted,false);assert(!JSON.stringify(sealed).includes(token.toString('base64')));assert.throws(()=>takeBumbleOAuthHandoff({...sealed}),{code:'owned_original_handoff_required'});
const material=takeBumbleOAuthHandoff(sealed,{now:options.now+1}),frame=JSON.parse(material.bytes);assert.equal(frame.task.task_id,job.task.task_id);assert.equal(frame.task.attempt_id,job.task.attempt_id);assert.equal(frame.authentication,'oauth-bearer');assert.equal(H(Buffer.from(frame.request_body_base64,'base64')),frame.request_sha256);assert.equal(Buffer.from(frame.access_token_base64,'base64').toString(),token.toString());assert.throws(()=>JSON.stringify(material),/not serializable/);material.bytes.fill(0);assert.throws(()=>takeBumbleOAuthHandoff(sealed),{code:'owned_original_handoff_required'});
assert.throws(()=>sealBumbleOAuthHandoff(job,options,config,{access_token:token,certificate},()=>null),{code:'owner_approval_required'});
assert.throws(()=>sealBumbleOAuthHandoff(job,options,config,{access_token:token,certificate:Buffer.from('changed')},authorize),{code:'certificate_binding_changed'});
// Select an overflow by actual complete encoded measurements, not a guessed
// source length. Every temporary synthetic frame is discarded immediately.
let completeOverflow=false,largestMeasured=0;
for(let n=8000;n<=16000;n+=500){
 try{const candidate=sealBumbleOAuthHandoff(jobFor('x'.repeat(n)),options,config,{access_token:Buffer.alloc(4096,65),certificate},authorize);largestMeasured=Math.max(largestMeasured,candidate.frame_bytes);discardBumbleOAuthHandoff(candidate);}
 catch(error){assert.equal(error.code,'complete_handoff_byte_budget','Overflow must be actual private frame, not another gate');completeOverflow=true;break;}
}
assert(completeOverflow,'Valid public preflight must exercise actual complete-frame overflow');assert(largestMeasured>90000&&largestMeasured<=100000);
const discarded=sealBumbleOAuthHandoff(job,options,config,{access_token:token,certificate},authorize);assert.equal(discardBumbleOAuthHandoff(discarded).physical_release_verified,false);assert.throws(()=>takeBumbleOAuthHandoff(discarded),{code:'owned_original_handoff_required'});token.fill(0);
const expiryNow=Date.now(),expirySource='const value = 4;',expiryJob={model_id:'fixture/model',task:makeBumbleTask({run_id:'rev_fixture',piece_id:'whole',source:expirySource,scope:[{file:'fixture.js',start_line:1,text:expirySource}],check:'One source-grounded check',omissions:['No callers; generated data only'],deadline:expiryNow+750,budget:{response_bytes:4096,candidates:1}})};
const expired=sealBumbleOAuthHandoff(expiryJob,{...options,now:expiryNow},config,{access_token:Buffer.from(crypto.randomBytes(24).toString('base64url')),certificate},authorize);
await new Promise(resolve=>setTimeout(resolve,850));
assert.throws(()=>takeBumbleOAuthHandoff(expired,{now:expiryNow}),{code:'handoff_expired'},'Actual module-owned expiry must refuse stale caller time');discardBumbleOAuthHandoff(expired);
console.log(JSON.stringify({passed:true,model_calls:0,network_calls:0,real_credentials:false,scope:'Actual complete synthetic private-frame bytes, owner-gate-before-input and one-shot custody; not issuer/token/transport qualification or native activation'}));
