// Synthetic governor controls for approval-scoped atomic capacity admission.
import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';
import {BumbleCapacity} from './bumble-capacity.mjs';
import {privateTestFixture} from './private-test-fixture.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: fixtures choose their own evidence home
const home=privateTestFixture('momm-peer-budget-');
let cases=0;
const check=(name,fn)=>{fn();cases++;};
function fixture(label) {
  const deadline=Date.now()+3590000;
  const config={schema:'momm-bumble-capacity/1',global_slots:10,max_attempts:10,max_reserved_tokens:10240,deadline,resource_groups:[{id:'synthetic-physical',slots:10}],source_ip_groups:[{id:'synthetic-ip',slots:10}],endpoints:[{id:'synthetic',resource_group:'synthetic-physical',source_ip_group:'synthetic-ip'}]};
  const options={root:path.join(home,label),project_root:process.cwd(),config};
  const one=new BumbleCapacity(options),two=new BumbleCapacity(options);
  const budget={schema:'momm-bumble-admission-budget/1',authorization_sha256:'a'.repeat(64),configuration_sha256:one.summary().configuration_sha256,max_attempts:4,max_reserved_tokens:4096,max_completion_tokens:1024,max_outstanding:1,expires_at:deadline};
  const request=()=>({endpoint_id:'synthetic',run_id:'rev_budget_'+crypto.randomUUID().replaceAll('-',''),task_id:crypto.randomUUID(),worker_binding:'b'.repeat(64),max_tokens:1024,deadline:Date.now()+180000,now:Date.now(),admission_budget:budget});
  return {one,two,budget,request,options};
}
check('fifth request refused although broader existing ledger has headroom',()=>{
  const f=fixture('requests');
  for(let i=0;i<4;i++){const r=f.one.reserve(f.request());assert(r.admitted);f.one.terminal(r.reservation_id,{transport:'known_not_sent',payload:'unavailable',now:Date.now()});}
  assert.equal(f.two.reserve(f.request()).admitted,false,'approval budget must be enforced inside the shared reservation lock');
  assert.equal(f.one.summary().attempts,4);assert.equal(f.one.summary().reserved_tokens,4096);
});
check('stale empty summaries cannot admit two outstanding requests',()=>{
  const f=fixture('outstanding');assert.equal(f.one.summary().held,0);assert.equal(f.two.summary().held,0);
  const first=f.one.reserve(f.request());assert(first.admitted);
  assert.equal(f.two.reserve(f.request()).admitted,false);assert.equal(f.one.summary().held,1);
});
check('caller clock cannot bypass actual approval expiry',()=>{
  const f=fixture('expired');const value=f.one.reserve({...f.request(),now:1,admission_budget:{...f.budget,expires_at:Date.now()-1}});
  assert.equal(value.admitted,false);assert.equal(f.one.summary().attempts,0);
});
check('changed configuration binding refuses without altering existing reservations',()=>{
  const f=fixture('configuration'),before=f.one.summary();
  assert.throws(()=>f.one.reserve({...f.request(),admission_budget:{...f.budget,configuration_sha256:'c'.repeat(64)}}));
  assert.deepEqual(f.one.summary(),before);
});
check('same authorization cannot change its retained budget terms across restart',()=>{
  const f=fixture('identity');const first=f.one.reserve(f.request());assert(first.admitted);
  f.one.terminal(first.reservation_id,{transport:'known_not_sent',payload:'unavailable',now:Date.now()});
  const restarted=new BumbleCapacity(f.options),before=restarted.summary();
  assert.throws(()=>restarted.reserve({...f.request(),admission_budget:{...f.budget,max_attempts:3}}));
  assert.deepEqual(restarted.summary(),before);
});
check('existing unknown hold cannot be relabelled or bypassed by scoped admission',()=>{
  const f=fixture('unknown');const first=f.one.reserve(f.request());f.one.markTransmissionPossible(first.reservation_id,Date.now());
  f.one.terminal(first.reservation_id,{transport:'outcome_unknown',payload:'unavailable',now:Date.now()});
  assert.throws(()=>f.one.terminal(first.reservation_id,{transport:'known_not_sent',payload:'unavailable',now:Date.now()}),/relabelled|terminal/i);
  assert.equal(f.two.reserve(f.request()).admitted,false);assert.equal(f.one.summary().held,1);
});
check('completion-token cap refuses before reservation',()=>{
  const f=fixture('tokens');assert.equal(f.one.reserve({...f.request(),max_tokens:1025}).admitted,false);assert.equal(f.one.summary().attempts,0);
});
check('budget getter refused without executing it',()=>{
  const f=fixture('getter');let reads=0;const budget={...f.budget};Object.defineProperty(budget,'max_attempts',{get(){reads++;return 4;},enumerable:true});
  assert.throws(()=>f.one.reserve({...f.request(),admission_budget:budget}));assert.equal(reads,0);assert.equal(f.one.summary().attempts,0);
});
check('legacy unscoped held reservation also blocks a scoped caller',()=>{
  const f=fixture('mixed');const prior=f.one.reserve({...f.request(),admission_budget:undefined});assert(prior.admitted);
  assert.equal(f.two.reserve(f.request()).admitted,false);assert.equal(f.one.summary().attempts,1);assert.equal(f.one.summary().held,1);
});
check('token budget is independent of request count and legacy headroom',()=>{
  const f=fixture('token-budget'),budget={...f.budget,max_reserved_tokens:2048};
  for(let i=0;i<2;i++){const r=f.one.reserve({...f.request(),admission_budget:budget});assert(r.admitted);f.one.terminal(r.reservation_id,{transport:'known_not_sent',payload:'unavailable',now:Date.now()});}
  assert.equal(f.two.reserve({...f.request(),admission_budget:budget}).admitted,false);assert.equal(f.one.summary().attempts,2);assert.equal(f.one.summary().reserved_tokens,2048);
});
check('request deadline cannot exceed approval expiry',()=>{
  const f=fixture('expiry-bound'),budget={...f.budget,expires_at:Date.now()+120000};
  assert.equal(f.one.reserve({...f.request(),deadline:budget.expires_at+1,admission_budget:budget}).admitted,false);assert.equal(f.one.summary().attempts,0);
});
check('request deadline cannot exceed the scoped 180-second window',()=>{
  const f=fixture('deadline-bound');assert.equal(f.one.reserve({...f.request(),deadline:Date.now()+1500000}).admitted,false);assert.equal(f.one.summary().attempts,0);
});
check('tampered persisted budget is quarantined without repairing the store',()=>{
  const f=fixture('tamper');const r=f.one.reserve(f.request());assert(r.admitted);
  const file=path.join(f.options.root,'capacity.json');assert(fs.realpathSync(file).startsWith(fs.realpathSync(home)+path.sep));
  const bytes=fs.readFileSync(file);fs.writeFileSync(path.join(f.options.root,'original-before-tamper.json'),bytes,{flag:'wx',mode:0o600});
  const changed=JSON.parse(bytes);changed.reservations[0].admission_budget.max_attempts=5;fs.writeFileSync(file,JSON.stringify(changed)+'\n');
  assert.throws(()=>new BumbleCapacity(f.options),/budget|admission/i);assert.equal(JSON.parse(fs.readFileSync(file)).reservations[0].admission_budget.max_attempts,5);
});
console.log(JSON.stringify({passed:cases,external_requests:0,real_credential_reads:0,synthetic_fixtures_retained:true,scope:'approval-scoped shared admission only; not receipt provenance or physical release qualification'}));
