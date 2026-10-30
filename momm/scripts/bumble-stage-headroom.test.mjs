// Actual bounded local store near its byte ceiling, no workers or network.
// Pure geometry chooses a valid task frame; only executed filesystem behavior
// below is evidence. It does not bypass any task/qualification/capacity check.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {BumbleStage} from './bumble-stage.mjs';import {BumbleCapacity} from './bumble-capacity.mjs';import {BumblePlan} from './bumble-plan.mjs';import {makeBumbleTask} from './bumble-contract.mjs';
import {BumbleFixtureLedger} from './bumble-fixtures.mjs';import {qualificationBinding,fixtureFrameBinding} from './bumble-qualification.mjs';import {qualifyBumbleWithLedger} from './bumble-qualification-ledger.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),E=JSON.stringify,MAX=4_000_000,parent=fs.mkdtempSync(path.join(os.tmpdir(),'momm-headroom-control-'));
const fixtures=[['defect','defect'],['control','control']].map(([id,kind])=>({id,kind,sha256:H(id),split:'qualification'}));
const worker={worker_id:'w',connector_id:'c',endpoint_id:'e',adapter_sha256:H('adapter'),model_lineage_sha256:H('model'),task_type:'source-check',role_version:'1',role_sha256:H('role'),schema_sha256:H('schema'),fixture_suite_sha256:fixtureFrameBinding(fixtures),config_epoch:'1',credential_epoch:'1',trust_sha256:H('trust')};
const policy={schema:'momm-bumble-qualification-policy/1',policy_id:'policy',task_type:worker.task_type,required_defects:1,required_controls:1,max_missed_defects:0,max_false_candidates:0,lifetime_ms:10000,max_observations:2},scope_binding=H('generated-headroom-scope');
const limits={global:2,per_group:2,max_tasks:6,max_candidates:6,max_bytes:30000,max_investigations:1,deadline:1000,negative_ids:['control'],minimum_negatives:1};
const config={schema:'momm-bumble-capacity/1',global_slots:2,max_attempts:6,max_reserved_tokens:1000000000,deadline:1000,resource_groups:[{id:'gpu',slots:2}],source_ip_groups:[{id:'ip',slots:2}],endpoints:[{id:'e',resource_group:'gpu',source_ip_group:'ip'}]};
function frameFor(source,pad=0){return ['check','control','other-2','other-3','other-4','other-5'].map(id=>({id,task:{run_id:'rev_headroom_fixture',piece_id:'whole',source,scope:Array.from({length:8},(_,i)=>({file:`context-${i}.js`,start_line:1,text:source})),check:'Check bounded supplied context '+id+(id==='control'?'.'.repeat(pad):''),omissions:['Generated fixture; callers omitted'],deadline:500,budget:{response_bytes:4096,candidates:1},role_version:'1',task_type:worker.task_type}}));}
function reportFor(source){return {run_id:'rev_headroom_fixture',governor:'codex',input_sha256:H(source),input_bytes:Buffer.byteLength(source),gate_policy:{quorum_required:2},quorum:{required:2,met:true},reviewers:[{agent:'claude',status:'success'},{agent:'copilot',status:'success'}]};}
const strip=t=>Object.fromEntries(Object.entries(t).filter(([k])=>!['task_id','attempt_id'].includes(k)));
try{
 const ledger=new BumbleFixtureLedger({root:path.join(parent,'qualification'),frame:fixtures,scope_binding,budget:{max_total_attempts:2,max_transmissions:2,deadline:1000}}),observations=[];
 for(let n=0;n<2;n++){const f=fixtures[n],a=ledger.reserve(f.id,{purpose:'qualification',binding:qualificationBinding(worker),now:1+n*3});ledger.markTransmissionPossible(a.attempt_id,2+n*3);ledger.finish(a.attempt_id,{outcome:'success',now:3+n*3});observations.push({fixture_id:f.id,fixture_sha256:f.sha256,attempt_id:a.attempt_id,identity_binding:qualificationBinding(worker),transport:'success',payload:'valid',result:f.kind==='defect'?'candidate':'no_candidate_in_supplied_scope',governor_assessment:f.kind==='defect'?'reproduced_candidate':'scoped_negative_verified',evidence_sha256:H(f.id+'-evidence'),observed_at:10});}
 const qualification=qualifyBumbleWithLedger({identity:worker,policy,frame:fixtures,observations,now:10},{ledger,scope_binding}),qualification_options={ledger,scope_binding,policy};
 const request={identity:worker,qualification,qualification_options,check_id:'check',now:11};
 const capacity=new BumbleCapacity({root:path.join(parent,'near-capacity'),config}),capacity_binding=capacity.summary().configuration_sha256;
 function predictedBytes(n,pad=0){
  const source='\\'.repeat(n),frame=frameFor(source,pad),report=reportFor(source),baselineBytes=Buffer.from(E(report));
  const plan=new BumblePlan(limits),reservation_id=plan.admit({task_id:'check',resource_group:'gpu',source_ip_group:'ip'},11),task=makeBumbleTask(frame[0].task);
  const a={reservation_id,capacity_reservation_id:crypto.randomUUID(),check_id:'check',identity_binding:qualificationBinding(worker),scope_binding,qualification_sha256:H(E(qualification)),task,state:'reserved',admission_request:{endpoint_id:'e',run_id:report.run_id,task_id:task.task_id,worker_binding:qualificationBinding(worker),max_tokens:Buffer.byteLength(E(task))+task.budget.response_bytes+1024,deadline:task.deadline,now:11},admission_intent_sha256:'f'.repeat(64)};
  return Buffer.byteLength(E({schema:'momm-bumble-stage/1',capacity_binding,baseline:{run_id:report.run_id,governor:'codex',required:2,source_sha256:H(source),baseline_sha256:H(baselineBytes),pieces:['whole']},task_frame:frame.map(f=>({id:f.id,task:strip(makeBumbleTask(f.task))})),plan:plan.snapshot(),attempts:[a],raw_bytes:0,investigations:[]})+'\n');
 }
 let low=1,high=32000;while(low<high){const middle=Math.ceil((low+high)/2);if(predictedBytes(middle)<=MAX-16)low=middle;else high=middle-1;}
 const pad=MAX-16-predictedBytes(low);assert(pad>=0&&pad<200);const source='\\'.repeat(low),task_frame=frameFor(source,pad);
 assert.equal(predictedBytes(low,pad),MAX-16,'Valid input geometry must target the actual admission representation');
 const options={root:path.join(parent,'near'),source,baseline_bytes:Buffer.from(E(reportFor(source))),limits,task_frame,capacity},stage=new BumbleStage(options);
 let admission,refusal=null;try{admission=stage.reserve(request);}catch(error){refusal=/storage|headroom/i.test(error.message)?'storage_refused':'other';}
 if(admission?.admitted){
  const actual=fs.statSync(path.join(options.root,'stage.json')).size;assert.equal(actual,MAX-16,'Measured real admission must match the chosen geometry');
  let terminalFailure=null;try{stage.finish(admission.reservation_id,{bytes:'',transport:'known_not_sent',finished:false,now:12});}catch(error){terminalFailure=/storage/i.test(error.message)?'storage_exhausted':'other';}
  console.log(E({actual_admitted:true,measured_stage_bytes:actual,terminal_failure:terminalFailure,global_attempts:capacity.summary().attempts,network_calls:0,model_calls:0}));
 }
 assert(!admission?.admitted,'A task was admitted without enough bytes to retain its own terminal state');assert(!refusal||refusal==='storage_refused');assert.equal(capacity.summary().attempts,0,'Headroom refusal must precede global charge/hold');
 const positiveSource='const answer = 4;',positiveCapacity=new BumbleCapacity({root:path.join(parent,'positive-capacity'),config}),positive=new BumbleStage({root:path.join(parent,'positive'),source:positiveSource,baseline_bytes:Buffer.from(E(reportFor(positiveSource))),limits,task_frame:frameFor(positiveSource),capacity:positiveCapacity});
 const accepted=positive.reserve(request);assert(accepted.admitted,'Small valid task must not be blanket-refused');positive.finish(accepted.reservation_id,{bytes:'',transport:'known_not_sent',finished:false,now:12});assert.equal(positive.summary().attempts[0].state,'terminal');
 console.log(E({passed:true,network_calls:0,model_calls:0,real_credentials:false,scope:'Actual near-byte-ceiling admission and known-unsent terminal, plus successful small-task control; no power-loss or remote-release certification'}));
}finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-headroom-control-'));fs.rmSync(parent,{recursive:true,force:true});}
