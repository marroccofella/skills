import assert from 'node:assert/strict';import {BumblePlan} from './bumble-plan.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const options={deadline:1000,global:1,negative_ids:['n']};
const p=new BumblePlan(options),id=p.admit({task_id:'t',resource_group:'g',source_ip_group:'ip'},1);p.retire('g');
assert.doesNotThrow(()=>p.terminal(id,'candidate',{remote_release_verified:false,bytes:10,candidates:1}),'retirement must not discard late accounting');
assert.equal(p.snapshot().state.bytes,10);assert.equal(p.snapshot().state.candidates,1);assert.equal(p.coverage().unresolved_reservations,1);
const terminal=p.snapshot().state.reservations[0].state;p.retire('g');assert.equal(p.snapshot().state.reservations[0].state,terminal,'retirement is not an original terminal outcome');
assert.equal(new BumblePlan(options,p.snapshot()).coverage().unresolved_reservations,1);
console.log(JSON.stringify({passed:true,network_calls:0,scope:'retirement preserves late accounting and original evidence without releasing capacity'}));
