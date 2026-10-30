// Caller-group binding for one owner endpoint. Synthetic qualification only;
// not a second-endpoint alias, live network or credential-custody qualification.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {BumbleStage} from './bumble-stage.mjs';import {BumbleCapacity} from './bumble-capacity.mjs';import {BumbleFixtureLedger} from './bumble-fixtures.mjs';import {qualificationBinding,fixtureFrameBinding} from './bumble-qualification.mjs';import {qualifyBumbleWithLedger} from './bumble-qualification-ledger.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=v=>crypto.createHash('sha256').update(v).digest('hex'),parent=fs.mkdtempSync(path.join(os.tmpdir(),'momm-stage-capacity-test-'));
try{
  const frame=[{id:'d',kind:'defect',sha256:H('d'),split:'qualification'},{id:'c',kind:'control',sha256:H('c'),split:'qualification'}],scope_binding=H('scope');
  const identity={worker_id:'w',connector_id:'c',endpoint_id:'e',adapter_sha256:H('a'),model_lineage_sha256:H('m'),task_type:'t',role_version:'1',role_sha256:H('r'),schema_sha256:H('s'),fixture_suite_sha256:fixtureFrameBinding(frame),config_epoch:'1',credential_epoch:'1',trust_sha256:H('trust')};
  const policy={schema:'momm-bumble-qualification-policy/1',policy_id:'p',task_type:'t',required_defects:1,required_controls:1,max_missed_defects:0,max_false_candidates:0,lifetime_ms:10000,max_observations:2};
  const ledger=new BumbleFixtureLedger({root:path.join(parent,'qualification'),frame,scope_binding,budget:{max_total_attempts:2,max_transmissions:2,deadline:1000}}),observations=[];
  for(let n=0;n<2;n++){const f=frame[n],a=ledger.reserve(f.id,{purpose:'qualification',binding:qualificationBinding(identity),now:1+n*3});ledger.markTransmissionPossible(a.attempt_id,2+n*3);ledger.finish(a.attempt_id,{outcome:'success',now:3+n*3});observations.push({fixture_id:f.id,fixture_sha256:f.sha256,attempt_id:a.attempt_id,identity_binding:qualificationBinding(identity),transport:'success',payload:'valid',result:f.kind==='defect'?'candidate':'no_candidate_in_supplied_scope',governor_assessment:f.kind==='defect'?'reproduced_candidate':'scoped_negative_verified',evidence_sha256:H(f.id+'e'),observed_at:10});}
  const qualification=qualifyBumbleWithLedger({identity,policy,frame,observations,now:10},{ledger,scope_binding});
  const source='const n = 1;',report={run_id:'r',governor:'codex',input_sha256:H(source),input_bytes:Buffer.byteLength(source),gate_policy:{quorum_required:2},quorum:{required:2,met:true},reviewers:[{agent:'claude',status:'success'},{agent:'copilot',status:'success'}]};
  const task={run_id:'r',piece_id:'whole',source,scope:[{file:'a.js',start_line:1,text:source}],check:'Check A',deadline:500,budget:{response_bytes:4096,candidates:2},role_version:'1',task_type:'t'};
  const capacity=new BumbleCapacity({root:path.join(parent,'global'),config:{schema:'momm-bumble-capacity/1',global_slots:2,max_attempts:4,max_reserved_tokens:100000,deadline:1000,resource_groups:[{id:'gpu',slots:1}],source_ip_groups:[{id:'ip',slots:1}],endpoints:[{id:'e',resource_group:'gpu',source_ip_group:'ip'}]}});
  const stage=new BumbleStage({root:path.join(parent,'stage'),source,baseline_bytes:Buffer.from(JSON.stringify(report)),capacity,task_frame:[{id:'a',task},{id:'b',task:{...task,check:'Check B'}}],limits:{global:2,per_group:1,max_tasks:2,max_candidates:4,max_bytes:10000,max_investigations:2,deadline:1000,negative_ids:['b'],minimum_negatives:1}});
  const request={identity,qualification,qualification_options:{ledger,scope_binding,policy},check_id:'a',resource_group:'gpu',source_ip_group:'ip',now:11};
  const renamed={...request,check_id:'b',resource_group:'renamed-gpu',source_ip_group:'renamed-ip'};
  const free=JSON.stringify(capacity.summary());
  assert.equal(stage.reserve(renamed).reason,'capacity_binding_mismatch','free-slot denial must come from exact owner map binding');
  assert.equal(JSON.stringify(capacity.summary()),free,'renamed-group refusal creates no capacity or token charge');
  const first=stage.reserve(request);assert(first.admitted);
  assert.match(first.reservation_id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,'trusted planner mints path-safe UUIDs');
  // Observe the actual synchronous evidence primitives used by this component,
  // including lookups/readFile internals that an openSync-only spy misses. This
  // does not instrument arbitrary future async/named-import filesystem routes.
  const methods=['openSync','lstatSync','readFileSync'],originals=new Map(methods.map(name=>[name,fs[name]]));let foreignOperations=0,ownedOperations=0;const errors=[];
  for(const name of methods)fs[name]=function(file,...args){if(typeof file==='string'){if(file.includes('foreign:stream'))foreignOperations++;if(file.includes(first.reservation_id))ownedOperations++;}return originals.get(name).call(fs,file,...args);};
  try{
    assert.throws(()=>stage.reconcile('foreign:stream'),error=>{errors.push(error);return true;});
    assert.throws(()=>stage.reconcileAdmission('foreign:stream'),error=>{errors.push(error);return true;});
    assert.equal(stage.reconcileAdmission(first.reservation_id).dispatch_authorized,false,'positive control traverses original evidence without another send permit');
  }finally{for(const [name,original]of originals)fs[name]=original;}
  assert.equal(foreignOperations,0,'unknown caller identities never select evidence filenames');
  assert(ownedOperations>0,'filesystem observation positive control must see legitimate evidence');
  assert.match(errors[0].message,/Original stage attempt is missing/);assert.match(errors[1].message,/Original admission intent is missing/);
  const held=JSON.stringify(capacity.summary());
  assert.equal(stage.reserve(renamed).reason,'capacity_binding_mismatch','held-slot alias denial remains distinct from capacity exhaustion');
  assert.equal(JSON.stringify(capacity.summary()),held);
  stage.markTransmissionPossible(first.reservation_id,12);
  const bytes=JSON.stringify({task_id:first.task.task_id,result:'no_candidate_in_supplied_scope',candidates:[],limitations:[]});
  const result=stage.finish(first.reservation_id,{bytes,transport:'success',finished:true,now:13,remote_release_verified:true});
  assert.equal(result.remote_release_verified,false,'a bare caller boolean cannot release physical capacity');assert.equal(capacity.summary().held,1);
  // Companion hashes are checked before terminal evidence is parsed. This is
  // not a generic JSON parser or protection against rewriting the whole chain.
  for(const name of ['result-','terminal-intent-']){
    const file=path.join(parent,'stage',name+first.reservation_id+'.json'),original=fs.readFileSync(file);
    fs.writeFileSync(file,original.toString('utf8').replace(/}\s*$/,' ,"quorum_votes":99,"quorum_votes":0}\n'));
    try{assert.throws(()=>stage.summary(),name==='result-'?/Original supplementary result changed/:/Original terminal intent changed/);}finally{fs.writeFileSync(file,original);}
    assert.equal(stage.summary().completion,false);assert.equal(capacity.summary().held,1);
  }
  assert.equal(stage.reserve({...request,check_id:'b',now:14}).reason,'capacity_or_budget','a canonical group denial comes from the retained physical hold');
  console.log(JSON.stringify({passed:true,foreign_evidence_operations:foreignOperations,owned_evidence_positive_control:ownedOperations>0,network_activity:'not_instrumented',scope:'one-endpoint caller-group binding and held success; not live transport or backend evidence'}));
}finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-stage-capacity-test-'));fs.rmSync(parent,{recursive:true,force:true});}
