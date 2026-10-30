// Actual private-store operations, synthetic baseline/qualification; no remote worker.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {realTempDir} from './private-test-fixture.mjs';
import {BumbleStage} from './bumble-stage.mjs';import {BumbleCapacity} from './bumble-capacity.mjs';import {BumbleFixtureLedger} from './bumble-fixtures.mjs';
import {qualificationBinding,fixtureFrameBinding} from './bumble-qualification.mjs';import {qualifyBumbleWithLedger} from './bumble-qualification-ledger.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
// Test-owned writes only: product filesystem APIs and the process umask stay unchanged.
const writeFixture=(file,data,options)=>fs.writeFileSync(file,data,{mode:0o600,...(typeof options==='string'?{encoding:options}:options)});
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),parent=realTempDir('momm-stage-recovery-'),ownerParent=path.dirname(parent),source='const n = 1;';
const frame=[['d','defect'],['c','control']].map(([id,kind])=>({id,kind,sha256:H(id),split:'qualification'}));
const worker={worker_id:'w',connector_id:'c',endpoint_id:'e',adapter_sha256:H('a'),model_lineage_sha256:H('m'),task_type:'t',role_version:'1',role_sha256:H('r'),schema_sha256:H('s'),fixture_suite_sha256:fixtureFrameBinding(frame),config_epoch:'1',credential_epoch:'1',trust_sha256:H('trust')};
const policy={schema:'momm-bumble-qualification-policy/1',policy_id:'p',task_type:'t',required_defects:1,required_controls:1,max_missed_defects:0,max_false_candidates:0,lifetime_ms:10000,max_observations:2},scope_binding=H('synthetic-owner-scope');
let originalFailure,failed=false;
try{
 const ledger=new BumbleFixtureLedger({root:path.join(parent,'qualification'),frame,scope_binding,budget:{max_total_attempts:2,max_transmissions:2,deadline:1000}}),observations=[];
 for(let n=0;n<2;n++){const f=frame[n],a=ledger.reserve(f.id,{purpose:'qualification',binding:qualificationBinding(worker),now:1+3*n});ledger.markTransmissionPossible(a.attempt_id,2+3*n);ledger.finish(a.attempt_id,{outcome:'success',now:3+3*n});observations.push({fixture_id:f.id,fixture_sha256:f.sha256,attempt_id:a.attempt_id,identity_binding:qualificationBinding(worker),transport:'success',payload:'valid',result:f.kind==='defect'?'candidate':'no_candidate_in_supplied_scope',governor_assessment:f.kind==='defect'?'reproduced_candidate':'scoped_negative_verified',evidence_sha256:H(f.id+'-e'),observed_at:10});}
 const qualification=qualifyBumbleWithLedger({identity:worker,policy,frame,observations,now:10},{ledger,scope_binding}),qualification_options={ledger,scope_binding,policy};
 const report={run_id:'rev_synthetic_stage',governor:'codex',input_sha256:H(source),input_bytes:Buffer.byteLength(source),gate_policy:{quorum_required:2},quorum:{required:2,met:true},reviewers:[{agent:'claude',status:'success'},{agent:'copilot',status:'success'}]};
 const task={run_id:report.run_id,piece_id:'whole',source,scope:[{file:'synthetic.js',start_line:1,text:source}],check:'Check supplied source',omissions:['Synthetic fixture, no callers'],deadline:500,budget:{response_bytes:4096,candidates:1},role_version:'1',task_type:'t'};
 const reserve={identity:worker,qualification,qualification_options,check_id:'check',now:11};
 function owned(name){const root=path.join(parent,name),capacity=new BumbleCapacity({root:path.join(parent,name+'-capacity'),config:{schema:'momm-bumble-capacity/1',global_slots:1,max_attempts:4,max_reserved_tokens:100000,deadline:1000,resource_groups:[{id:'gpu',slots:1}],source_ip_groups:[{id:'ip',slots:1}],endpoints:[{id:'e',resource_group:'gpu',source_ip_group:'ip'}]}}),stage=new BumbleStage({root,source,baseline_bytes:Buffer.from(JSON.stringify(report)),limits:{global:1,per_group:1,max_tasks:1,max_candidates:1,max_bytes:10000,max_investigations:1,deadline:1000,negative_ids:['check'],minimum_negatives:1},task_frame:[{id:'check',task}],capacity});return {root,stage,capacity};}
 const cases={
  unsentIdempotentControl(){
    const f=owned('unsent-idempotent'),a=f.stage.reserve(reserve);assert(a.admitted);
    const expectedCharge=Buffer.byteLength(JSON.stringify(a.task))+a.task.budget.response_bytes+1024;assert.equal(f.capacity.summary().reserved_tokens,expectedCharge,'reservation records its exact conservative charge');
    f.stage.finish(a.reservation_id,{bytes:'',transport:'known_not_sent',finished:false,now:12});
    const local=fs.readFileSync(path.join(f.root,'stage.json')),global=f.capacity.summary();
    assert.equal(global.held,0);assert.equal(global.reserved_tokens,expectedCharge,'known-not-sent retains the exact original charge');assert.equal(global.attempts,1);assert.equal(global.reservations[0].reserved_tokens,expectedCharge);
    for(let i=0;i<2;i++)assert.equal(f.stage.reconcile(a.reservation_id).at,12);
    assert.deepEqual(fs.readFileSync(path.join(f.root,'stage.json')),local);assert.deepEqual(f.capacity.summary(),global);
  },
  candidateRecoveryRestart(){
    const f=owned('candidate-restart'),a=f.stage.reserve(reserve);assert(a.admitted);f.stage.markTransmissionPossible(a.reservation_id,12);
    const bytes=JSON.stringify({task_id:a.task.task_id,result:'candidate',candidates:[{file:'synthetic.js',location:'1',quote:source,hypothesis:'Synthetic issue only',trigger:'Synthetic trigger',missing_information:[]}],limitations:[]});
    const terminal=f.capacity.terminal;f.capacity.terminal=()=>{throw Error('Synthetic pre-global fault');};
    try{assert.throws(()=>f.stage.finish(a.reservation_id,{bytes,transport:'success',finished:true,now:13}),/Synthetic pre-global fault/);}finally{f.capacity.terminal=terminal;}
    const file=path.join(f.root,'result-'+a.reservation_id+'.json'),original=fs.readFileSync(file);
    assert.throws(()=>f.stage.finish(a.reservation_id,{bytes:'changed',transport:'success',finished:true,now:14}),/cannot replace/);
    const adopted=f.stage.reconcile(a.reservation_id);assert.equal(adopted.at,13);assert.equal(adopted.payload,'valid');assert.equal(adopted.candidates.length,1);assert.equal(adopted.attempt_id,a.task.attempt_id);
    const local=fs.readFileSync(path.join(f.root,'stage.json')),global=f.capacity.summary();assert.equal(global.held,1);assert.equal(global.attempts,1);
    const restarted=owned('candidate-restart');for(let i=0;i<2;i++)assert.equal(restarted.stage.reconcile(a.reservation_id).at,13);
    assert.deepEqual(fs.readFileSync(file),original);assert.deepEqual(fs.readFileSync(path.join(f.root,'stage.json')),local);assert.deepEqual(restarted.capacity.summary(),global);
    const state=JSON.parse(local);assert.equal(state.plan.state.candidates,1);assert.equal(state.raw_bytes,Buffer.byteLength(bytes));assert.equal(state.plan.state.attempts.filter(e=>e.event==='terminal').length,1);
    assert.equal(adopted.quorum_votes,0);assert.equal(adopted.completion,false);
  },
  conflictAndCorruption(){
    const f=owned('conflict'),a=f.stage.reserve(reserve);assert(a.admitted);f.stage.markTransmissionPossible(a.reservation_id,12);
    const terminal=f.capacity.terminal;f.capacity.terminal=()=>{throw Error('Synthetic pre-global fault');};
    try{assert.throws(()=>f.stage.finish(a.reservation_id,{bytes:'',transport:'refused',finished:false,now:13}),/Synthetic pre-global fault/);}finally{f.capacity.terminal=terminal;}
    const file=path.join(f.root,'result-'+a.reservation_id+'.json'),original=fs.readFileSync(file),intentFile=path.join(f.root,'terminal-intent-'+a.reservation_id+'.json'),originalIntent=fs.readFileSync(intentFile);
    const capacityId=JSON.parse(fs.readFileSync(path.join(f.root,'stage.json'),'utf8')).attempts[0].capacity_reservation_id;
    f.capacity.terminal(capacityId,{transport:'cancelled',payload:'unavailable',now:13});
    assert.throws(()=>f.stage.reconcile(a.reservation_id),/Conflicting original global terminal/);
    const changed=JSON.parse(original);changed.at=14;writeFixture(file,JSON.stringify(changed)+'\n');
    assert.throws(()=>f.stage.reconcile(a.reservation_id),/digest changed/);writeFixture(file,original);
    const intent=JSON.parse(originalIntent);intent.attempt_id='other-attempt';writeFixture(intentFile,JSON.stringify(intent)+'\n');
    assert.throws(()=>f.stage.reconcile(a.reservation_id),/intent is unbound/);writeFixture(intentFile,originalIntent);
    fs.unlinkSync(intentFile);assert.throws(()=>f.stage.reconcile(a.reservation_id),error=>{if(error?.code!=='ENOENT'||error.path!==intentFile)throw error;return true;},'missing intent must refuse at its exact original path');
    assert.deepEqual(fs.readFileSync(file),original);assert.equal(f.capacity.summary().held,1);assert.equal(f.stage.summary().attempts[0].state,'transmission_possible');
  },
  incompleteIntentAndOverflow(){
    const f=owned('intent-only'),a=f.stage.reserve(reserve);assert(a.admitted);f.stage.markTransmissionPossible(a.reservation_id,12);
    const file=path.join(f.root,'result-'+a.reservation_id+'.json'),open=fs.openSync;
    fs.openSync=function(target,...args){if(target===file)throw Error('Synthetic original result write refusal');return open.call(fs,target,...args);};
    try{assert.throws(()=>f.stage.finish(a.reservation_id,{bytes:'',transport:'refused',finished:false,now:13}),/Synthetic original result write refusal/);}finally{fs.openSync=open;}
    assert(fs.existsSync(path.join(f.root,'terminal-intent-'+a.reservation_id+'.json')));assert(!fs.existsSync(file));
    const originalIntent=fs.readFileSync(path.join(f.root,'terminal-intent-'+a.reservation_id+'.json')),intent=JSON.parse(originalIntent),globalBefore=f.capacity.summary();
    assert.throws(()=>f.stage.reconcile(a.reservation_id),error=>{if(error?.code!=='ENOENT'||error.path!==file)throw error;return true;},'an absent result without original input remains quarantined at its exact original path');
    for(const changed of [{bytes:'changed',transport:'refused',finished:false},{bytes:'',transport:'success',finished:false},{bytes:'',transport:'refused',finished:true}])assert.throws(()=>f.stage.finish(a.reservation_id,{...changed,now:14}),/cannot replace/,'foreign bytes or terminal axes cannot recover the original');
    assert(!fs.existsSync(file));assert.deepEqual(fs.readFileSync(path.join(f.root,'terminal-intent-'+a.reservation_id+'.json')),originalIntent);assert.deepEqual(f.capacity.summary(),globalBefore);
    const recovered=f.stage.finish(a.reservation_id,{bytes:'',transport:'refused',finished:false,now:14}),saved=fs.readFileSync(file),globalAfter=f.capacity.summary();
    assert.equal(recovered.at,13,'recovery retains original completion time, not caller14');assert.equal(recovered.attempt_id,a.task.attempt_id);assert.equal(H(saved),intent.result_sha256);assert.deepEqual(fs.readFileSync(path.join(f.root,'terminal-intent-'+a.reservation_id+'.json')),originalIntent);
    assert.equal(globalAfter.held,1,'terminal reconstruction is not physical release');assert.equal(globalAfter.attempts,globalBefore.attempts);assert.equal(globalAfter.reserved_tokens,globalBefore.reserved_tokens);assert.equal(globalAfter.reservations[0].terminal.at,13);assert.equal(recovered.quorum_votes,0);assert.equal(recovered.completion,false);
    const recoveredLocal=fs.readFileSync(path.join(f.root,'stage.json'));assert.equal(f.stage.reconcile(a.reservation_id).at,13);assert.deepEqual(fs.readFileSync(file),saved);assert.deepEqual(fs.readFileSync(path.join(f.root,'stage.json')),recoveredLocal);assert.deepEqual(f.capacity.summary(),globalAfter);
    const partial=owned('partial-result'),p=partial.stage.reserve(reserve);assert(p.admitted);partial.stage.markTransmissionPossible(p.reservation_id,12);const partialFile=path.join(partial.root,'result-'+p.reservation_id+'.json');
    fs.openSync=function(target,...args){if(target===partialFile)throw Error('Synthetic partial result-create refusal');return open.call(fs,target,...args);};
    try{assert.throws(()=>partial.stage.finish(p.reservation_id,{bytes:'',transport:'refused',finished:false,now:13}),/Synthetic partial result-create refusal/);}finally{fs.openSync=open;}
    const partialIntentFile=path.join(partial.root,'terminal-intent-'+p.reservation_id+'.json'),partialIntent=fs.readFileSync(partialIntentFile),partialGlobal=partial.capacity.summary(),fragment=Buffer.from('{');writeFixture(partialFile,fragment);
    assert.throws(()=>partial.stage.finish(p.reservation_id,{bytes:'',transport:'refused',finished:false,now:14}),/digest changed/,'an existing partial result is never overwritten');assert.deepEqual(fs.readFileSync(partialFile),fragment);assert.deepEqual(fs.readFileSync(partialIntentFile),partialIntent);assert.deepEqual(partial.capacity.summary(),partialGlobal);
    const o=owned('overflow'),b=o.stage.reserve(reserve);assert(b.admitted);o.stage.markTransmissionPossible(b.reservation_id,12);
    const result=o.stage.finish(b.reservation_id,{bytes:Buffer.alloc(7000,97),transport:'success',finished:true,now:13});
    assert.equal(result.payload,'byte_overflow');assert.equal(result.complete_raw_sha256,null);assert.equal(result.overflow_bytes,2904);
    const local=fs.readFileSync(path.join(o.root,'stage.json'));assert.equal(o.stage.reconcile(b.reservation_id).payload,'byte_overflow');assert.deepEqual(fs.readFileSync(path.join(o.root,'stage.json')),local);assert.equal(o.capacity.summary().held,1);assert.equal(JSON.parse(local).raw_bytes,4096);
  }
 };
 const selected=process.argv[2];if(selected){assert(Object.hasOwn(cases,selected),'Unknown adoption case');cases[selected]();}else for(const test of Object.values(cases))test();console.log(JSON.stringify({passed:true,case:selected||'all',checks:selected?1:Object.keys(cases).length,available_checks:Object.keys(cases).length,transport_instrumentation:'unavailable',scope:'local stage/capacity original terminal and generated write-failure boundaries; not power-loss or live recovery certification'}));
}catch(error){failed=true;originalFailure=error;throw error;}finally{
 try{if(path.dirname(parent)!==ownerParent||!path.basename(parent).startsWith('momm-stage-recovery-')||fs.realpathSync.native(parent)!==parent)throw Error('Cleanup target outside owned fixture');fs.rmSync(parent,{recursive:true,force:true});}
 catch(cleanupError){if(failed)throw new AggregateError([originalFailure,cleanupError],'Adoption test and fixture cleanup both failed');throw cleanupError;}
}
