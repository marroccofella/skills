// Canonical original-admission recovery controls. Real private local stores,
// synthetic qualification and injected filesystem/commit faults, zero network.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {BumbleStage} from './bumble-stage.mjs';import {BumbleCapacity} from './bumble-capacity.mjs';import {BumbleFixtureLedger} from './bumble-fixtures.mjs';
import {qualificationBinding,fixtureFrameBinding} from './bumble-qualification.mjs';import {qualifyBumbleWithLedger} from './bumble-qualification-ledger.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),parent=fs.mkdtempSync(path.join(os.tmpdir(),'momm-admission-control-'));
const frame=[['defect','defect'],['control','control']].map(([id,kind])=>({id,kind,sha256:H(id),split:'qualification'}));
const worker={worker_id:'w',connector_id:'c',endpoint_id:'e',adapter_sha256:H('adapter'),model_lineage_sha256:H('model'),task_type:'source-check',role_version:'1',role_sha256:H('role'),schema_sha256:H('schema'),fixture_suite_sha256:fixtureFrameBinding(frame),config_epoch:'1',credential_epoch:'1',trust_sha256:H('trust')};
const policy={schema:'momm-bumble-qualification-policy/1',policy_id:'qualification',task_type:worker.task_type,required_defects:1,required_controls:1,max_missed_defects:0,max_false_candidates:0,lifetime_ms:10000,max_observations:2},scope_binding=H('generated-owner-scope');
const source='const answer = 2 * 2;',report={run_id:'rev_admission_fixture',governor:'codex',input_sha256:H(source),input_bytes:Buffer.byteLength(source),gate_policy:{quorum_required:2},quorum:{required:2,met:true},reviewers:[{agent:'claude',status:'success'},{agent:'copilot',status:'success'}]};
const task={run_id:report.run_id,piece_id:'whole',source,scope:[{file:'generated.js',start_line:1,text:source}],check:'Check the supplied arithmetic boundary',omissions:['No caller context; generated offline fixture only'],deadline:500,budget:{response_bytes:4096,candidates:1},role_version:'1',task_type:worker.task_type};
const limits={global:2,per_group:2,max_tasks:2,max_candidates:2,max_bytes:20000,max_investigations:1,deadline:1000,negative_ids:['control'],minimum_negatives:1};
const capacityConfig={schema:'momm-bumble-capacity/1',global_slots:2,max_attempts:4,max_reserved_tokens:100000,deadline:1000,resource_groups:[{id:'gpu',slots:2}],source_ip_groups:[{id:'ip',slots:2}],endpoints:[{id:'e',resource_group:'gpu',source_ip_group:'ip'}]};
try{
 const ledger=new BumbleFixtureLedger({root:path.join(parent,'qualification'),frame,scope_binding,budget:{max_total_attempts:2,max_transmissions:2,deadline:1000}}),observations=[];
 for(let n=0;n<2;n++){const f=frame[n],a=ledger.reserve(f.id,{purpose:'qualification',binding:qualificationBinding(worker),now:1+3*n});ledger.markTransmissionPossible(a.attempt_id,2+3*n);ledger.finish(a.attempt_id,{outcome:'success',now:3+3*n});observations.push({fixture_id:f.id,fixture_sha256:f.sha256,attempt_id:a.attempt_id,identity_binding:qualificationBinding(worker),transport:'success',payload:'valid',result:f.kind==='defect'?'candidate':'no_candidate_in_supplied_scope',governor_assessment:f.kind==='defect'?'reproduced_candidate':'scoped_negative_verified',evidence_sha256:H(f.id+'-original'),observed_at:10});}
 const qualification=qualifyBumbleWithLedger({identity:worker,policy,frame,observations,now:10},{ledger,scope_binding}),qualification_options={ledger,scope_binding,policy};
 const request={identity:worker,qualification,qualification_options,check_id:'check',now:11};
 const fixture=name=>{const capacity=new BumbleCapacity({root:path.join(parent,name+'-capacity'),config:capacityConfig}),options={root:path.join(parent,name),source,baseline_bytes:Buffer.from(JSON.stringify(report)),limits,task_frame:[{id:'check',task},{id:'control',task:{...task,check:'Check the precommitted negative control'}}],capacity};return {capacity,options,stage:new BumbleStage(options)};};
 const positive=fixture('positive'),accepted=positive.stage.reserve(request);assert(accepted.admitted);assert.equal(positive.stage.summary().attempts.length,1);assert.equal(positive.capacity.summary().held,1);
 const post=fixture('postcommit'),originalReserve=post.capacity.reserve.bind(post.capacity);let committed=false;
 post.capacity.reserve=r=>{const observed=originalReserve(r);committed=observed.admitted;if(observed.admitted)throw Error('Generated fault after the real global commit');return observed;};
 assert.throws(()=>post.stage.reserve(request));assert(committed);const global=post.capacity.summary(),pending=post.stage.summary().attempts;
 assert.equal(pending.length,1,'A committed global hold lost its original durable local admission identity');
 assert.equal(pending[0].state,'admitting');assert.equal(global.held,1);assert.equal(global.reserved_tokens,global.reservations[0].reserved_tokens);
 post.capacity.reserve=originalReserve;
 const restarted=new BumbleStage(post.options),beforeGlobal=JSON.stringify(post.capacity.summary()),id=pending[0].reservation_id;
 const adopted=restarted.reconcileAdmission(id);assert.equal(adopted.reconciled,true);assert.equal(adopted.dispatch_authorized,false);assert.equal(adopted.quorum_votes,0);
 assert.equal(restarted.summary().attempts[0].reservation_id,id);assert.equal(restarted.summary().attempts[0].task_id,global.reservations[0].task_id);assert.equal(restarted.summary().attempts[0].state,'reserved');
 assert.equal(JSON.stringify(post.capacity.summary()),beforeGlobal,'Recovery must not rewrite global time, identity, token charge or physical hold');
 assert.equal(restarted.reconcileAdmission(id).dispatch_authorized,false);assert.equal(restarted.summary().attempts.length,1);assert.equal(restarted.reserve(request).admitted,false,'Original task cannot be minted again after recovery');
 const pre=fixture('precommit');pre.capacity.reserve=()=>{throw Error('Generated fault before global admission');};assert.throws(()=>pre.stage.reserve(request));assert.equal(pre.capacity.summary().attempts,0);
 const preId=pre.stage.summary().attempts[0].reservation_id,unproven=new BumbleStage(pre.options).reconcileAdmission(preId);assert.equal(unproven.reconciled,false);assert.equal(unproven.dispatch_authorized,false);assert.equal(pre.stage.summary().attempts[0].state,'admitting');
 assert.equal(pre.stage.reserve({...request,check_id:'control'}).admitted,false,'An unresolved original admission must stop another dispatch');assert.throws(()=>pre.stage.markTransmissionPossible(preId,12));
 const conflict=fixture('conflict'),conflictReserve=conflict.capacity.reserve.bind(conflict.capacity);conflict.capacity.reserve=r=>{const result=conflictReserve(r);if(result.admitted)throw Error('Generated postcommit fault');return result;};assert.throws(()=>conflict.stage.reserve(request));
 const conflictId=conflict.stage.summary().attempts[0].reservation_id;conflict.capacity.markTransmissionPossible(conflict.capacity.summary().reservations[0].id,12);
 assert.throws(()=>new BumbleStage(conflict.options).reconcileAdmission(conflictId),/admission|conflict|held/i);assert.equal(conflict.capacity.summary().held,1);assert.equal(conflict.stage.summary().attempts[0].state,'admitting');
 console.log(JSON.stringify({passed:true,network_calls:0,model_calls:0,real_credentials:false,scope:'Original local/global admission, precommit uncertainty, exact restart adoption, no recovery send permit, idempotence and conflicting transmission hold only'}));
}finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-admission-control-'));fs.rmSync(parent,{recursive:true,force:true});}
