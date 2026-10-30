// Synthetic bytes only: no login, certificate trust, network or model calls.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {makeBumbleTask} from '../scripts/bumble-contract.mjs';
import {sealBumbleOAuthHandoff,takeBumbleOAuthHandoff,discardBumbleOAuthHandoff} from '../scripts/bumble-oauth-handoff.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
 const now=Date.now();
 const certificate=Buffer.from('synthetic certificate stand-in');
 const config={base_url:'https://node.example.test/v1',server_name:'node.example.test',certificate_sha256:H(certificate),scope_binding:H('scope'),baseline_report_sha256:H('baseline'),policy_sha256:H('policy'),trust_sha256:H('trust'),disclosure_sha256:H('disclosure'),logging_sha256:H('logging')};
 const source='const count = 3;';
 const job={model_id:'fixture/model',task:makeBumbleTask({run_id:'rev_fixture',piece_id:'whole',source,scope:[{file:'fixture.js',start_line:1,text:source}],check:'One source-grounded check',omissions:['No callers; synthetic fixture only'],deadline:now+300000,budget:{response_bytes:4096,candidates:1}})};
 const approval=q=>({schema:'momm-bumble-oauth-handoff-approval/1',config_sha256:q.config_sha256,task_sha256:q.task_sha256,request_sha256:q.request_sha256,scope_binding:q.scope_binding,policy_sha256:config.policy_sha256,trust_sha256:config.trust_sha256,disclosure_sha256:config.disclosure_sha256,logging_sha256:config.logging_sha256,valid_until:q.deadline});
 return {job,options:{max_tokens:128,response_format:'json_schema',now},config,material:{access_token:Buffer.from('abcdefgh=='),certificate},approval};
}
const cases={
 revocation(){const f=fixture();let active=true,calls=0;const authorize=q=>{calls++;return active?f.approval(q):null;};const owned=sealBumbleOAuthHandoff(f.job,f.options,f.config,f.material,authorize);active=false;assert.throws(()=>takeBumbleOAuthHandoff(owned,{now:f.options.now+1}),{code:'owner_approval_required'});assert.equal(calls,2);assert.throws(()=>takeBumbleOAuthHandoff(owned,{now:f.options.now+2}),{code:'owned_original_handoff_required'});},
 bearer_grammar(){const f=fixture();for(const text of ['abcd=efgh','==abcdefgh','========'])assert.throws(()=>sealBumbleOAuthHandoff(f.job,f.options,f.config,{...f.material,access_token:Buffer.from(text)},f.approval),{code:'invalid_bearer_material'});const owned=sealBumbleOAuthHandoff(f.job,f.options,f.config,f.material,f.approval);discardBumbleOAuthHandoff(owned);},
 connector_mutation(){const f=fixture();const authorize=q=>{const accepted=f.approval(q);f.config.base_url='https://other.example.test/v1';return accepted;};assert.throws(()=>sealBumbleOAuthHandoff(f.job,f.options,f.config,f.material,authorize),{code:'public_frame_changed'});},
 positive(){const f=fixture();let calls=0;const owned=sealBumbleOAuthHandoff(f.job,f.options,f.config,f.material,q=>{calls++;return f.approval(q);});const taken=takeBumbleOAuthHandoff(owned,{now:f.options.now+1});assert.equal(JSON.parse(taken.bytes).base_url,f.config.base_url);taken.bytes.fill(0);assert.equal(calls,2);}
};
let failed=0;for(const [name,test] of Object.entries(cases)){try{test();console.log(JSON.stringify({name,passed:true}));}catch(error){failed++;console.log(JSON.stringify({name,passed:false,error:error.code??error.message}));}}
console.log(JSON.stringify({checks:Object.keys(cases).length,failed,network_calls:0,model_calls:0,real_credentials:false}));process.exitCode=failed?1:0;
