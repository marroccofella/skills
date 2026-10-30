import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {BumbleFixtureLedger} from './bumble-fixtures.mjs';
import {qualificationBinding,fixtureFrameBinding} from './bumble-qualification.mjs';
import {qualifyBumbleWithLedger,qualificationStatusWithLedger} from './bumble-qualification-ledger.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=v=>crypto.createHash('sha256').update(v).digest('hex');
const parent=fs.mkdtempSync(path.join(os.tmpdir(),'momm-qualification-ledger-test-'));
const frame=[{id:'d',kind:'defect',sha256:H('d'),split:'qualification'},{id:'c',kind:'control',sha256:H('c'),split:'qualification'}];
const identity={worker_id:'w',connector_id:'c',endpoint_id:'e',adapter_sha256:H('a'),model_lineage_sha256:H('m'),task_type:'t',role_version:'1',role_sha256:H('r'),schema_sha256:H('s'),fixture_suite_sha256:fixtureFrameBinding(frame),config_epoch:'1',credential_epoch:'1',trust_sha256:H('trust')};
const policy={schema:'momm-bumble-qualification-policy/1',policy_id:'p',task_type:'t',required_defects:1,required_controls:1,max_missed_defects:0,max_false_candidates:0,lifetime_ms:100,max_observations:2};
const scope=H('owner-approved-operator-group'),binding=qualificationBinding(identity);
try{
  const options={root:path.join(parent,'private'),frame,scope_binding:scope,budget:{max_total_attempts:3,max_transmissions:3,deadline:1000}};
  const ledger=new BumbleFixtureLedger(options),observations=[];
  for(let n=0;n<frame.length;n++){const f=frame[n],a=ledger.reserve(f.id,{purpose:'qualification',binding,now:1+n*3});ledger.markTransmissionPossible(a.attempt_id,2+n*3);ledger.finish(a.attempt_id,{outcome:'success',now:3+n*3});observations.push({fixture_id:f.id,fixture_sha256:f.sha256,attempt_id:a.attempt_id,identity_binding:binding,transport:'success',payload:'valid',result:f.kind==='defect'?'candidate':'no_candidate_in_supplied_scope',governor_assessment:f.kind==='defect'?'reproduced_candidate':'scoped_negative_verified',evidence_sha256:H(f.id+'-e'),observed_at:10});}
  const params={identity,policy,frame,observations,now:10};
  const result=qualifyBumbleWithLedger(params,{ledger,scope_binding:scope});
  assert.equal(result.qualification.status,'qualified');assert.equal(result.quorum_votes,0);
  assert.equal(qualificationStatusWithLedger(result,{ledger,scope_binding:scope,identity,policy,now:11}).eligible,true);
  assert.throws(()=>qualifyBumbleWithLedger({...params,observations:observations.map((o,i)=>i===0?{...o,attempt_id:'fabricated'}:o)},{ledger,scope_binding:scope}));
  assert.throws(()=>qualifyBumbleWithLedger(params,{ledger,scope_binding:H('different')}));
  assert.throws(()=>qualifyBumbleWithLedger(params,{ledger:{summary:()=>ledger.summary()},scope_binding:scope}));
  assert.equal(qualificationStatusWithLedger(result,{ledger,scope_binding:scope,identity,policy,now:110}).reason,'expired');
  assert.equal(qualificationStatusWithLedger({...result,ledger_binding:{...result.ledger_binding,journal_sha256:H('wrong')}},{ledger,scope_binding:scope,identity,policy,now:11}).eligible,false);
  const restart=new BumbleFixtureLedger(options);
  assert.equal(qualificationStatusWithLedger(result,{ledger:restart,scope_binding:scope,identity,policy,now:11}).eligible,true);
  const diagnostic=restart.reserve('d',{purpose:'diagnostic',binding,now:12});
  restart.finish(diagnostic.attempt_id,{outcome:'known_not_sent',now:13});
  assert.equal(qualificationStatusWithLedger(result,{ledger:restart,scope_binding:scope,identity,policy,now:14}).eligible,true);
  assert.throws(()=>qualifyBumbleWithLedger({...params,now:14,observations:[{...observations[0],attempt_id:diagnostic.attempt_id},observations[1]]},{ledger:restart,scope_binding:scope}));
  assert.throws(()=>restart.reserve('c',{purpose:'diagnostic',binding,now:14}),/budget/);
  console.log(JSON.stringify({passed:true,network_calls:0,scope:'native private qualification-to-journal binding; not a live qualification claim'}));
}finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-qualification-ledger-test-'));fs.rmSync(parent,{recursive:true,force:true});}
