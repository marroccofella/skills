import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {BumbleCapacity} from './bumble-capacity.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const parent=fs.mkdtempSync(path.join(os.tmpdir(),'momm-capacity-test-'));
try{
  const config={schema:'momm-bumble-capacity/1',global_slots:2,max_attempts:4,max_reserved_tokens:1000,deadline:1000,resource_groups:[{id:'physical-one',slots:1},{id:'physical-two',slots:1}],source_ip_groups:[{id:'shared-ip',slots:1}],endpoints:[{id:'alias-one',resource_group:'physical-one',source_ip_group:'shared-ip'},{id:'alias-two',resource_group:'physical-one',source_ip_group:'shared-ip'},{id:'other-gpu',resource_group:'physical-two',source_ip_group:'shared-ip'}]};
  const options={root:path.join(parent,'private'),config},one=new BumbleCapacity(options),two=new BumbleCapacity(options);
  const request={endpoint_id:'alias-one',run_id:'run-one',task_id:'task-one',worker_binding:'a'.repeat(64),max_tokens:256,deadline:500,now:1};
  const a=one.reserve(request);assert(a.admitted);
  assert.equal(two.reserve({...request,endpoint_id:'alias-two',run_id:'run-two'}).admitted,false,'renamed endpoint on the same GPU cannot bypass physical capacity');
  assert.equal(two.reserve({...request,endpoint_id:'other-gpu',run_id:'run-two'}).admitted,false,'shared source-IP limit spans GPUs and review runs');
  const notSent=one.terminal(a.reservation_id,{transport:'known_not_sent',payload:'unavailable',now:2});assert(notSent.released);
  const b=two.reserve({...request,endpoint_id:'alias-two',run_id:'run-two',now:3});assert(b.admitted);two.markTransmissionPossible(b.reservation_id,4);
  assert.throws(()=>one.terminal(b.reservation_id,{transport:'known_not_sent',payload:'unavailable',now:5}),/relabel/i);
  const result=one.terminal(b.reservation_id,{transport:'success',payload:'valid',now:5});assert.equal(result.released,false,'worker success alone never frees global physical capacity');
  const restart=new BumbleCapacity(options);assert.equal(restart.summary().held,1);assert.equal(restart.summary().reserved_tokens,512,'unknown/finished reservations retain worst-case token charges');
  const before=restart.summary().reservations.find(r=>r.id===b.reservation_id).terminal;
  restart.retire('physical-one');restart.retire('physical-one');assert.deepEqual(restart.summary().reservations.find(r=>r.id===b.reservation_id).terminal,before,'retirement preserves original terminal evidence');
  assert.equal(new BumbleCapacity(options).reserve({...request,endpoint_id:'alias-two',run_id:'new-run',now:6}).admitted,false);
  assert.throws(()=>new BumbleCapacity({...options,config:{...config,global_slots:20}}),/binding|budget/i,'a restart cannot silently enlarge capacity');
  assert.equal(restart.summary().quorum_votes,0);assert.equal(restart.summary().completion,false);
  // A fresh, empty home removes shared-IP, held-slot and token-budget masking.
  const freshOptions={root:path.join(parent,'fresh-private'),config},fresh=new BumbleCapacity(freshOptions);
  fresh.retire('physical-two');
  assert.equal(new BumbleCapacity(freshOptions).reserve({...request,endpoint_id:'other-gpu',run_id:'retired-empty',now:6}).admitted,false,'unoccupied retired physical group must refuse new work');
  assert.equal(fresh.summary().held,0);assert.equal(fresh.summary().reserved_tokens,0);
  assert.equal(fresh.reserve({...request,run_id:'unretired-control',now:6}).admitted,true,'unretired physical group remains admissible under the same otherwise-free bounds');
  console.log(JSON.stringify({passed:true,network_calls:0,scope:'global owner-private reservations across runs, shared aliases/IPs, conservative token charges and retirement; not measured hardware capacity'}));
}finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-capacity-test-'));fs.rmSync(parent,{recursive:true,force:true});}
