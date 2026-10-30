// Actual private-store operations, synthetic baseline/qualification; no remote worker.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {realTempDir} from './private-test-fixture.mjs';
import {BumbleStage} from './bumble-stage.mjs';import {BumbleCapacity} from './bumble-capacity.mjs';import {BumbleFixtureLedger} from './bumble-fixtures.mjs';
import {qualificationBinding,fixtureFrameBinding} from './bumble-qualification.mjs';import {qualifyBumbleWithLedger} from './bumble-qualification-ledger.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),parent=realTempDir('momm-stage-recovery-'),ownerParent=path.dirname(parent),source='const n = 1;';
const frame=[['d','defect'],['c','control']].map(([id,kind])=>({id,kind,sha256:H(id),split:'qualification'}));
const worker={worker_id:'w',connector_id:'c',endpoint_id:'e',adapter_sha256:H('a'),model_lineage_sha256:H('m'),task_type:'t',role_version:'1',role_sha256:H('r'),schema_sha256:H('s'),fixture_suite_sha256:fixtureFrameBinding(frame),config_epoch:'1',credential_epoch:'1',trust_sha256:H('trust')};
const policy={schema:'momm-bumble-qualification-policy/1',policy_id:'p',task_type:'t',required_defects:1,required_controls:1,max_missed_defects:0,max_false_candidates:0,lifetime_ms:10000,max_observations:2},scope_binding=H('synthetic-owner-scope');
try{
 const ledger=new BumbleFixtureLedger({root:path.join(parent,'qualification'),frame,scope_binding,budget:{max_total_attempts:2,max_transmissions:2,deadline:1000}}),observations=[];
 for(let n=0;n<2;n++){const f=frame[n],a=ledger.reserve(f.id,{purpose:'qualification',binding:qualificationBinding(worker),now:1+3*n});ledger.markTransmissionPossible(a.attempt_id,2+3*n);ledger.finish(a.attempt_id,{outcome:'success',now:3+3*n});observations.push({fixture_id:f.id,fixture_sha256:f.sha256,attempt_id:a.attempt_id,identity_binding:qualificationBinding(worker),transport:'success',payload:'valid',result:f.kind==='defect'?'candidate':'no_candidate_in_supplied_scope',governor_assessment:f.kind==='defect'?'reproduced_candidate':'scoped_negative_verified',evidence_sha256:H(f.id+'-e'),observed_at:10});}
 const qualification=qualifyBumbleWithLedger({identity:worker,policy,frame,observations,now:10},{ledger,scope_binding}),qualification_options={ledger,scope_binding,policy};
 const report={run_id:'rev_synthetic_stage',governor:'codex',input_sha256:H(source),input_bytes:Buffer.byteLength(source),gate_policy:{quorum_required:2},quorum:{required:2,met:true},reviewers:[{agent:'claude',status:'success'},{agent:'copilot',status:'success'}]};
 const task={run_id:report.run_id,piece_id:'whole',source,scope:[{file:'synthetic.js',start_line:1,text:source}],check:'Check supplied source',omissions:['Synthetic fixture, no callers'],deadline:500,budget:{response_bytes:4096,candidates:1},role_version:'1',task_type:'t'};
 const reserve={identity:worker,qualification,qualification_options,check_id:'check',now:11};
 function owned(name){const root=path.join(parent,name),capacity=new BumbleCapacity({root:path.join(parent,name+'-capacity'),config:{schema:'momm-bumble-capacity/1',global_slots:1,max_attempts:4,max_reserved_tokens:100000,deadline:1000,resource_groups:[{id:'gpu',slots:1}],source_ip_groups:[{id:'ip',slots:1}],endpoints:[{id:'e',resource_group:'gpu',source_ip_group:'ip'}]}}),stage=new BumbleStage({root,source,baseline_bytes:Buffer.from(JSON.stringify(report)),limits:{global:1,per_group:1,max_tasks:1,max_candidates:1,max_bytes:10000,max_investigations:1,deadline:1000,negative_ids:['check'],minimum_negatives:1},task_frame:[{id:'check',task}],capacity});return {root,stage,capacity};}
 const cases={
  admissionIntentWriteFault(){
    const f=owned('admission-intent-fault'),open=fs.openSync;let fault=false;
    fs.openSync=function(file,...args){if(typeof file==='string'&&path.dirname(file)===f.root&&path.basename(file).startsWith('admission-intent-')){fault=true;throw Error('Synthetic admission intent create fault');}return open.call(fs,file,...args);};
    try{assert.throws(()=>f.stage.reserve(reserve),/Synthetic admission intent create fault/);}finally{fs.openSync=open;}
    assert(fault);assert.equal(f.capacity.summary().attempts,0);
    assert.doesNotThrow(()=>f.stage.summary(),'An intent creation fault before global admission must not brick the store');
    assert.equal(f.stage.summary().attempts.length,0,'No local admission publishes before its complete intent');
  },
  missingHistoricalAdmissionIntent(){
    const f=owned('historical-missing-intent'),original=f.capacity.reserve;f.capacity.reserve=()=>{throw Error('Synthetic precommit fault');};
    try{assert.throws(()=>f.stage.reserve(reserve));}finally{f.capacity.reserve=original;}
    const a=f.stage.summary().attempts[0],file=path.join(f.root,'admission-intent-'+a.reservation_id+'.json');fs.unlinkSync(file);
    assert.doesNotThrow(()=>f.stage.summary(),'A missing historical intent must be inspectable, not inferred or recreated');
    const value=f.stage.reconcileAdmission(a.reservation_id);assert.equal(value.reconciled,false);assert.equal(value.dispatch_authorized,false);assert.equal(value.reason,'original_admission_intent_missing');
    assert.equal(f.stage.reserve(reserve).admitted,false);assert.equal(fs.existsSync(file),false);assert.equal(f.capacity.summary().attempts,0);
  },
  terminalResultCreateFault(){
    const f=owned('terminal-result-fault'),a=f.stage.reserve(reserve);f.stage.markTransmissionPossible(a.reservation_id,12);
    const open=fs.openSync;let fault=false;fs.openSync=function(file,...args){if(typeof file==='string'&&path.dirname(file)===f.root&&path.basename(file).startsWith('result-')){fault=true;throw Error('Synthetic result create fault');}return open.call(fs,file,...args);};
    try{assert.throws(()=>f.stage.finish(a.reservation_id,{bytes:'original',transport:'refused',finished:false,now:13}),/Synthetic result create fault/);}finally{fs.openSync=open;}
    assert(fault);const intentFile=path.join(f.root,'terminal-intent-'+a.reservation_id+'.json'),intent=fs.readFileSync(intentFile),global=f.capacity.summary();
    assert.throws(()=>f.stage.finish(a.reservation_id,{bytes:'replacement',transport:'refused',finished:false,now:14}));
    assert.equal(fs.existsSync(path.join(f.root,'result-'+a.reservation_id+'.json')),false);
    let result;assert.doesNotThrow(()=>{result=f.stage.finish(a.reservation_id,{bytes:'original',transport:'refused',finished:false,now:14});},'Exact original input may materialize only its hash-bound missing result, never resend');
    assert.equal(result.at,13);assert.equal(result.transport,'refused');assert.equal(result.quorum_votes,0);assert.equal(result.completion,false);assert.deepEqual(fs.readFileSync(intentFile),intent);
    assert.equal(f.capacity.summary().held,1);assert.equal(f.capacity.summary().attempts,global.attempts);assert.equal(f.capacity.summary().reserved_tokens,global.reserved_tokens);
    assert.equal(f.stage.summary().attempts[0].state,'terminal');
  },
  lockStatFaultClosesDescriptor(){
    const f=owned('lock-stat-fault'),stat=fs.fstatSync,open=fs.openSync,close=fs.closeSync;let fd=null,closed=false;
    fs.openSync=function(file,...args){const value=open.call(fs,file,...args);if(file===path.join(f.root,'writer.lock'))fd=value;return value;};
    fs.fstatSync=function(value,...args){if(value===fd)throw Error('Synthetic lock stat fault');return stat.call(fs,value,...args);};
    fs.closeSync=function(value){if(value===fd)closed=true;return close.call(fs,value);};
    try{assert.throws(()=>f.stage.reserve(reserve),/lock|reconciliation/i);}finally{fs.openSync=open;fs.fstatSync=stat;fs.closeSync=close;}
    if(!closed&&fd!==null)close(fd); // fixture-owned descriptor only, no production recovery
    assert.equal(closed,true,'The failed initial lock stat must not leak its opened descriptor');assert(fs.existsSync(path.join(f.root,'writer.lock')),'Unverified lock is retained');assert.equal(f.capacity.summary().held,0);
  },
  adoptionBeforeGlobal(){
    const f=owned('adopt-before-global'),a=f.stage.reserve(reserve);assert(a.admitted);f.stage.markTransmissionPossible(a.reservation_id,12);
    const terminal=f.capacity.terminal;let injected=false;
    f.capacity.terminal=function(...args){if(!injected){injected=true;throw Error('Synthetic global terminal write refusal');}return terminal.apply(this,args);};
    try{assert.throws(()=>f.stage.finish(a.reservation_id,{bytes:'',transport:'refused',finished:false,now:13}),/Synthetic global terminal write refusal/);}finally{f.capacity.terminal=terminal;}
    assert(injected);const file=path.join(f.root,'result-'+a.reservation_id+'.json'),original=fs.readFileSync(file),global=f.capacity.summary();
    assert.equal(global.reservations[0].terminal,null);assert.equal(global.held,1);assert.equal(f.stage.summary().attempts[0].state,'transmission_possible');
    assert.doesNotThrow(()=>f.stage.finish(a.reservation_id,{bytes:'',transport:'refused',finished:false,now:14}),'adopt the original saved result without a new inference or a relabelled time');
    assert.deepEqual(fs.readFileSync(file),original);assert.equal(f.capacity.summary().reservations[0].terminal.at,13);assert.equal(f.capacity.summary().held,1);
    assert.equal(f.capacity.summary().reserved_tokens,global.reserved_tokens);assert.equal(f.stage.summary().attempts[0].state,'terminal');
    const state=JSON.parse(fs.readFileSync(path.join(f.root,'stage.json'),'utf8'));assert.equal(state.plan.state.attempts.filter(e=>e.event==='terminal').length,1);
  },
  adoptionAfterGlobal(){
    const f=owned('adopt-after-global'),a=f.stage.reserve(reserve);assert(a.admitted);f.stage.markTransmissionPossible(a.reservation_id,12);
    const rename=fs.renameSync;let injected=false;
    fs.renameSync=(from,to)=>{if(to===path.join(f.root,'stage.json')){injected=true;throw Error('Synthetic final stage snapshot write refusal');}return rename(from,to);};
    try{assert.throws(()=>f.stage.finish(a.reservation_id,{bytes:'',transport:'refused',finished:false,now:13}),/Synthetic final stage snapshot write refusal/);}finally{fs.renameSync=rename;}
    assert(injected);const file=path.join(f.root,'result-'+a.reservation_id+'.json'),original=fs.readFileSync(file),global=f.capacity.summary();
    assert.equal(global.reservations[0].terminal.transport,'refused');assert.equal(global.reservations[0].terminal.at,13);assert.equal(global.held,1);
    assert.equal(f.stage.summary().attempts[0].state,'transmission_possible');
    assert.doesNotThrow(()=>f.stage.finish(a.reservation_id,{bytes:'',transport:'refused',finished:false,now:14}),'adopt the identical committed terminal rather than recording another attempt');
    assert.deepEqual(fs.readFileSync(file),original);assert.deepEqual(f.capacity.summary().reservations,global.reservations);
    assert.equal(f.stage.summary().attempts[0].state,'terminal');
    const state=JSON.parse(fs.readFileSync(path.join(f.root,'stage.json'),'utf8'));assert.equal(state.plan.state.attempts.filter(e=>e.event==='terminal').length,1);
  },
  lateRefusal(){const f=owned('late'),a=f.stage.reserve(reserve);assert(a.admitted);f.stage.markTransmissionPossible(a.reservation_id,12);const r=f.stage.finish(a.reservation_id,{bytes:'',transport:'refused',finished:false,now:600});assert.equal(r.transport,'refused','preserve original observed transport');assert.equal(r.payload,'stale');assert.equal(f.stage.summary().attempts[0].state,'terminal');assert.equal(f.capacity.summary().held,1,'late response is not physical release');assert.equal(r.quorum_votes,0);assert.equal(r.completion,false);},
  earlyUnsent(){const f=owned('early'),a=f.stage.reserve(reserve);assert(a.admitted);assert.throws(()=>f.stage.finish(a.reservation_id,{bytes:'',transport:'known_not_sent',finished:false,now:10}));assert(!fs.existsSync(path.join(f.root,'result-'+a.reservation_id+'.json')),'invalid terminal time must refuse before the immutable write');f.stage.finish(a.reservation_id,{bytes:'',transport:'known_not_sent',finished:false,now:12});assert.equal(f.capacity.summary().held,0);},
  failedStageSave(){
    // The first local snapshot is now BEFORE global admission. Preserve this
    // original failure boundary rather than pretending it is a postcommit fault.
    const f=owned('save-fault'),originalOpen=fs.openSync,originalReserve=f.capacity.reserve;let injected=false,globalCalls=0;
    f.capacity.reserve=function(...args){globalCalls++;return originalReserve.apply(this,args);};
    fs.openSync=function(file,...args){if(!injected&&typeof file==='string'&&path.dirname(file)===f.root&&/^stage-[a-f0-9-]+\.tmp$/.test(path.basename(file))){injected=true;throw Object.assign(Error('Synthetic stage-write failure'),{code:'EIO'});}return originalOpen.call(fs,file,...args);};
    try{assert.throws(()=>f.stage.reserve(reserve),/Synthetic stage-write failure/);}finally{fs.openSync=originalOpen;f.capacity.reserve=originalReserve;}
    assert(injected);assert.equal(globalCalls,0,'A failed pre-admission snapshot must not call global admission');assert.equal(f.stage.summary().attempts.length,0);
    const summary=f.capacity.summary();assert.equal(summary.held,0);assert.equal(summary.attempts,0);assert.equal(summary.reserved_tokens,0);
  },
  unsentControl(){const f=owned('control'),a=f.stage.reserve(reserve);assert(a.admitted);const r=f.stage.finish(a.reservation_id,{bytes:'',transport:'known_not_sent',finished:false,now:12});assert.equal(r.transport,'known_not_sent');assert.equal(f.capacity.summary().held,0);assert.equal(f.stage.summary().attempts[0].state,'terminal');}
 };
 const selected=process.argv[2];if(selected){assert(cases[selected]);cases[selected]();}else for(const test of Object.values(cases))test();console.log(JSON.stringify({passed:true,case:selected||'all',network_calls:0,credentials_read:false,scope:'local stage/capacity terminal and one injected write-failure boundary; not power-loss or live recovery certification'}));
}finally{if(path.dirname(parent)!==ownerParent||!path.basename(parent).startsWith('momm-stage-recovery-')||fs.realpathSync.native(parent)!==parent)throw Error('Cleanup target outside owned fixture');fs.rmSync(parent,{recursive:true,force:true});}
