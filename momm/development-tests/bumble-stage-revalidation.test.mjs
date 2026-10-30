// Governor-authored synthetic legacy fixtures. Never mutates real attempts.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {realTempDir} from '../scripts/private-test-fixture.mjs';
import {BumbleStage} from '../scripts/bumble-stage.mjs';import {BumbleCapacity} from '../scripts/bumble-capacity.mjs';import {BumbleFixtureLedger} from '../scripts/bumble-fixtures.mjs';
import {qualificationBinding,fixtureFrameBinding} from '../scripts/bumble-qualification.mjs';import {qualifyBumbleWithLedger} from '../scripts/bumble-qualification-ledger.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),parent=realTempDir('momm-revalidation-'),source='const n = 1;';
const frame=[['d','defect'],['c','control']].map(([id,kind])=>({id,kind,sha256:H(id),split:'qualification'}));
const worker={worker_id:'w',connector_id:'c',endpoint_id:'e',adapter_sha256:H('a'),model_lineage_sha256:H('m'),task_type:'t',role_version:'1',role_sha256:H('r'),schema_sha256:H('s'),fixture_suite_sha256:fixtureFrameBinding(frame),config_epoch:'1',credential_epoch:'1',trust_sha256:H('trust')};
const policy={schema:'momm-bumble-qualification-policy/1',policy_id:'p',task_type:'t',required_defects:1,required_controls:1,max_missed_defects:0,max_false_candidates:0,lifetime_ms:10000,max_observations:2},scope_binding=H('synthetic-owner-scope');
let passed=0,failed=0;const observations=[];
try{
 const ledger=new BumbleFixtureLedger({root:path.join(parent,'qualification'),frame,scope_binding,budget:{max_total_attempts:2,max_transmissions:2,deadline:1000}}),items=[];
 for(let n=0;n<2;n++){const f=frame[n],a=ledger.reserve(f.id,{purpose:'qualification',binding:qualificationBinding(worker),now:1+3*n});ledger.markTransmissionPossible(a.attempt_id,2+3*n);ledger.finish(a.attempt_id,{outcome:'success',now:3+3*n});items.push({fixture_id:f.id,fixture_sha256:f.sha256,attempt_id:a.attempt_id,identity_binding:qualificationBinding(worker),transport:'success',payload:'valid',result:f.kind==='defect'?'candidate':'no_candidate_in_supplied_scope',governor_assessment:f.kind==='defect'?'reproduced_candidate':'scoped_negative_verified',evidence_sha256:H(f.id+'-e'),observed_at:10});}
 const qualification=qualifyBumbleWithLedger({identity:worker,policy,frame,observations:items,now:10},{ledger,scope_binding});
 const report={run_id:'rev_synthetic_revalidation',governor:'codex',input_sha256:H(source),input_bytes:Buffer.byteLength(source),gate_policy:{quorum_required:2},quorum:{required:2,met:true},reviewers:[{agent:'claude',status:'success'},{agent:'copilot',status:'success'}]};
 const task={run_id:report.run_id,piece_id:'whole',source,scope:[{file:'fixture.js',start_line:1,text:source}],check:'Check supplied source',deadline:500,budget:{response_bytes:4096,candidates:1},role_version:'1',task_type:'t'};
 function open(name){const root=path.join(parent,name),capacity=new BumbleCapacity({root:path.join(parent,name+'-capacity'),config:{schema:'momm-bumble-capacity/1',global_slots:1,max_attempts:4,max_reserved_tokens:100000,deadline:1000,resource_groups:[{id:'gpu',slots:1}],source_ip_groups:[{id:'ip',slots:1}],endpoints:[{id:'e',resource_group:'gpu',source_ip_group:'ip'}]}});return {root,capacity,stage:new BumbleStage({root,source,baseline_bytes:Buffer.from(JSON.stringify(report)),limits:{global:1,per_group:1,max_tasks:1,max_candidates:1,max_bytes:10000,max_investigations:1,deadline:1000,negative_ids:['check'],minimum_negatives:1},task_frame:[{id:'check',task}],capacity})};}
 function seed(name){
  const f=open(name),a=f.stage.reserve({identity:worker,qualification,qualification_options:{ledger,scope_binding,policy},check_id:'check',now:11});assert(a.admitted);f.stage.markTransmissionPossible(a.reservation_id,12);
  const c={file:'fixture.js',location:'1',quote:source,hypothesis:'Synthetic issue',trigger:'Fixture',missing_information:[]},body=Buffer.from(JSON.stringify({task_id:a.task.task_id,result:'candidate',candidates:[c,c],limitations:[]})),raw=Buffer.concat([Buffer.from([239,187,191]),body]);
  const terminal=f.capacity.terminal;f.capacity.terminal=()=>{throw Error('Synthetic pre-global fault');};try{assert.throws(()=>f.stage.finish(a.reservation_id,{bytes:raw,transport:'success',finished:true,now:13}),/Synthetic pre-global fault/);}finally{f.capacity.terminal=terminal;}
  const file=path.join(f.root,'result-'+a.reservation_id+'.json'),intentFile=path.join(f.root,'terminal-intent-'+a.reservation_id+'.json'),record=JSON.parse(fs.readFileSync(file)),intent=JSON.parse(fs.readFileSync(intentFile));
  // This intentionally seeds a historical representation in a fresh synthetic
  // fixture only. Production originals must NEVER be rewritten this way.
  record.raw=body.toString('utf8');const original=Buffer.from(JSON.stringify(record)+'\n');intent.result_sha256=H(original);
  fs.writeFileSync(file,original);fs.writeFileSync(intentFile,JSON.stringify(intent)+'\n');
  return {...f,a,file,intentFile,original,originalIntent:fs.readFileSync(intentFile),raw,sidecar:path.join(f.root,'revalidation-'+a.reservation_id+'.json')};
 }
 function test(name,fn){try{fn();passed++;observations.push({name,status:'passed'});}catch{failed++;observations.push({name,status:'failed'});}}
 function intact(f){assert.deepEqual(fs.readFileSync(f.file),f.original);assert.deepEqual(fs.readFileSync(f.intentFile),f.originalIntent);assert.equal(f.capacity.summary().held,1);assert.equal(f.capacity.summary().attempts,1);}
 test('legacy projection is recorded, idempotent and restart-safe without new votes or release',()=>{
  const f=seed('positive'),adopted=f.stage.reconcile(f.a.reservation_id);assert.equal(adopted.at,13);assert.equal(adopted.payload,'candidate_overflow');assert.equal(adopted.quorum_votes,0);assert.equal(adopted.completion,false);
  const record=JSON.parse(fs.readFileSync(f.sidecar));assert.equal(record.schema,'momm-bumble-revalidation/1');assert.equal(record.original_result_sha256,H(f.original));assert.equal(record.original_intent_sha256,H(f.originalIntent));assert.equal(record.original_input_sha256,H(f.raw));assert.equal(record.original_completion_at,13);assert.equal(record.dispatch_authorized,false);assert.equal(record.remote_release_verified,false);assert.equal(record.classification_changed,false);assert.equal(record.quorum_votes,0);assert.equal(record.completion,false);assert(fs.statSync(f.sidecar).size<=2048);
  const saved=fs.readFileSync(f.sidecar),state=fs.readFileSync(path.join(f.root,'stage.json')),global=f.capacity.summary();assert.deepEqual(adopted.revalidation,record);
  for(const stage of [f.stage,open('positive').stage])assert.deepEqual(stage.reconcile(f.a.reservation_id),adopted);
  assert.deepEqual(fs.readFileSync(f.sidecar),saved);assert.deepEqual(fs.readFileSync(path.join(f.root,'stage.json')),state);assert.deepEqual(f.capacity.summary(),global);intact(f);
 });
 test('non-raw derived field changes are refused, even with a consistent synthetic result digest',()=>{
  const f=seed('semantic-tamper'),r=JSON.parse(f.original),intent=JSON.parse(f.originalIntent);r.candidates[0].originals[0].candidate.hypothesis='Changed synthetic hypothesis';const bytes=Buffer.from(JSON.stringify(r)+'\n');intent.result_sha256=H(bytes);fs.writeFileSync(f.file,bytes);fs.writeFileSync(f.intentFile,JSON.stringify(intent)+'\n');
  assert.throws(()=>f.stage.reconcile(f.a.reservation_id));assert(!fs.existsSync(f.sidecar));assert.equal(f.capacity.summary().held,1);assert.equal(f.capacity.summary().reservations[0].terminal,null);
 });
 test('corrupted companion cannot be overwritten or ignored',()=>{
  const f=seed('companion-corrupt');fs.writeFileSync(f.sidecar,'{"tampered":true}\n');assert.throws(()=>f.stage.reconcile(f.a.reservation_id));assert.equal(fs.readFileSync(f.sidecar,'utf8'),'{"tampered":true}\n');assert.equal(f.capacity.summary().reservations[0].terminal,null);intact(f);
 });
 test('a post-companion capacity failure recovers only the original attempt and time',()=>{
  const f=seed('post-companion-fault'),terminal=f.capacity.terminal;f.capacity.terminal=()=>{throw Error('Synthetic after-companion fault');};try{assert.throws(()=>f.stage.reconcile(f.a.reservation_id),/Synthetic after-companion fault/);}finally{f.capacity.terminal=terminal;}
  const saved=fs.readFileSync(f.sidecar);assert.equal(f.capacity.summary().reservations[0].terminal,null);intact(f);const recovered=open('post-companion-fault').stage.reconcile(f.a.reservation_id);assert.equal(recovered.at,13);assert.equal(recovered.quorum_votes,0);assert.equal(recovered.completion,false);assert.deepEqual(fs.readFileSync(f.sidecar),saved);intact(f);
 });
 test('candidate-accounting changes fail before a companion is minted',()=>{
  const f=seed('count-tamper'),intent=JSON.parse(f.originalIntent);intent.candidate_count=0;fs.writeFileSync(f.intentFile,JSON.stringify(intent)+'\n');assert.throws(()=>f.stage.reconcile(f.a.reservation_id));assert(!fs.existsSync(f.sidecar));assert.equal(f.capacity.summary().held,1);assert.equal(f.capacity.summary().reservations[0].terminal,null);
 });
}finally{if(!path.basename(parent).startsWith('momm-revalidation-')||fs.realpathSync.native(parent)!==parent)throw Error('Cleanup outside owned synthetic fixture');fs.rmSync(parent,{recursive:true,force:true});}
console.log(JSON.stringify({passed,failed,observations,network_calls:0,model_calls:0,credentials_read:false,scope:'Synthetic bounded legacy projection and real private-store recovery; not live worker qualification, power-loss certification or permission'}));if(failed)process.exitCode=1;
