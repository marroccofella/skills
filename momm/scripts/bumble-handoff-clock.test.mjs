// Governor-authored custody clock regressions. No real credentials/network.
import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {makeBumbleTask} from './bumble-contract.mjs';
import {sealBumbleOAuthHandoff,takeBumbleOAuthHandoff} from './bumble-oauth-handoff.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(now=Date.now(),deadline=now+60000){
  const certificate=Buffer.from('synthetic certificate');
  const config={base_url:'https://node.example.test/v1',server_name:'node.example.test',certificate_sha256:H(certificate),scope_binding:H('scope'),baseline_report_sha256:H('baseline'),policy_sha256:H('policy'),trust_sha256:H('trust'),disclosure_sha256:H('disclosure'),logging_sha256:H('logging')};
  const source='const value = 3;',job={model_id:'fixture/model',task:makeBumbleTask({run_id:'rev_fixture',piece_id:'whole',source,scope:[{file:'fixture.js',start_line:1,text:source}],check:'One source-grounded check',omissions:['Synthetic only'],deadline,budget:{response_bytes:4096,candidates:1}})};
  const options={max_tokens:128,response_format:'json_schema',now};
  const material={access_token:Buffer.from('syntheticfixturetoken'),certificate};
  const approve=q=>({schema:'momm-bumble-oauth-handoff-approval/1',config_sha256:q.config_sha256,task_sha256:q.task_sha256,request_sha256:q.request_sha256,scope_binding:q.scope_binding,policy_sha256:config.policy_sha256,trust_sha256:config.trust_sha256,disclosure_sha256:config.disclosure_sha256,logging_sha256:config.logging_sha256,valid_until:q.deadline});
  return {job,options,config,material,approve};
}
const cases={
  future_creation_default_take(){const f=fixture(Date.now()+900),owned=sealBumbleOAuthHandoff(f.job,f.options,f.config,f.material,f.approve);const result=takeBumbleOAuthHandoff(owned);result.bytes.fill(0);},
  async approval_uses_current_owned_time(){const f=fixture();let observed;const owned=sealBumbleOAuthHandoff(f.job,f.options,f.config,f.material,q=>{if(q.operation==='take_oauth_handoff')observed=q.now;return f.approve(q);});await new Promise(r=>setTimeout(r,1400));const result=takeBumbleOAuthHandoff(owned,{now:f.options.now});result.bytes.fill(0);assert(Math.abs(observed-Date.now())<1000,'Host approval must receive module-owned current time.');},
  malformed_request_is_not_expiry(){const f=fixture(),owned=sealBumbleOAuthHandoff(f.job,f.options,f.config,f.material,f.approve);assert.throws(()=>takeBumbleOAuthHandoff(owned,{now:f.options.now,extra:true}),{code:'invalid_take_request'});assert.throws(()=>takeBumbleOAuthHandoff(owned),{code:'owned_original_handoff_required'});},
  async real_expiry_overrides_stale_caller(){const now=Date.now(),f=fixture(now,now+750),owned=sealBumbleOAuthHandoff(f.job,f.options,f.config,f.material,f.approve);await new Promise(r=>setTimeout(r,850));assert.throws(()=>takeBumbleOAuthHandoff(owned,{now}),{code:'handoff_expired'});},
  accessor_refused_without_evaluation(){const f=fixture(),owned=sealBumbleOAuthHandoff(f.job,f.options,f.config,f.material,f.approve);let reads=0;assert.throws(()=>takeBumbleOAuthHandoff(owned,{get now(){reads++;return Date.now();}}));assert.equal(reads,0);assert.throws(()=>takeBumbleOAuthHandoff(owned),{code:'owned_original_handoff_required'});},
  stale_creation_refused(){const now=Date.now(),f=fixture(now-2000,now+60000);assert.throws(()=>sealBumbleOAuthHandoff(f.job,f.options,f.config,f.material,f.approve),{code:'invalid_handoff_clock'});},
  positive_one_shot(){const f=fixture(),owned=sealBumbleOAuthHandoff(f.job,f.options,f.config,f.material,f.approve);const result=takeBumbleOAuthHandoff(owned);assert.equal(result.quorum_votes,0);result.bytes.fill(0);assert.throws(()=>takeBumbleOAuthHandoff(owned),{code:'owned_original_handoff_required'});}
};
let failed=0;for(const [name,test] of Object.entries(cases)){try{await test();console.log(JSON.stringify({name,passed:true}));}catch(error){failed++;console.log(JSON.stringify({name,passed:false,error:error.code??error.message}));}}
console.log(JSON.stringify({checks:Object.keys(cases).length,failed,network_calls:0,model_calls:0,real_credentials:false}));process.exitCode=failed?1:0;
