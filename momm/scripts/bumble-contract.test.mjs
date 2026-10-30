import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {makeBumbleTask,validateBumbleResponse as validateResponse,retainCandidates} from './bumble-contract.mjs';
import {BumblePlan} from './bumble-plan.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
// These fixtures explicitly attest their synthetic completed transport. Production
// callers must supply every axis; direct missing-attestation probes stay unwrapped.
const validateBumbleResponse=(task,bytes,options)=>validateResponse(task,bytes,{transport:'success',finished:true,...options});
const task=makeBumbleTask({run_id:'fixture',piece_id:'p1',source:'const total = price * count;',scope:[{file:'a.js',text:'const total = price * count;',start_line:1}],check:'Check count=0',deadline:1000,budget:{response_bytes:4096,candidates:1}});
const candidate={file:'a.js',location:'1',quote:task.source,hypothesis:'Hypothesis',trigger:'Input',missing_information:[]};
const reply=(result,candidates=[],limitations=[])=>JSON.stringify({task_id:task.task_id,result,candidates,limitations});let count=0;
function test(fn){fn();count++;}
test(()=>assert.equal(validateBumbleResponse(task,reply('candidate',[candidate]),{now:1}).coverage,'scoped_completed'));
test(()=>assert.equal(validateBumbleResponse(task,reply('no_candidate_in_supplied_scope'),{now:1}).quorum_votes,0));
test(()=>{const raw=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(reply('no_candidate_in_supplied_scope'))]);const result=validateBumbleResponse(task,raw,{now:1});assert.equal(result.payload,'valid');assert.equal(result.raw_sha256,crypto.createHash('sha256').update(raw).digest('hex'),'original response hash includes BOM bytes');});
test(()=>{for(const result of ['insufficient_context','refused','abstain'])assert.equal(validateBumbleResponse(task,reply(result,[],['Missing dependency']),{now:1}).coverage,'unresolved');});
test(()=>assert.equal(validateBumbleResponse(task,reply('insufficient_context'),{now:1}).payload,'invalid_schema'));
test(()=>assert.equal(validateBumbleResponse(task,reply('candidate'),{now:1}).payload,'invalid_schema'));
test(()=>assert.equal(validateBumbleResponse(task,reply('candidate',[{...candidate,quote:'invented'}]),{now:1}).payload,'invalid_schema'));
test(()=>assert.equal(validateBumbleResponse(task,reply('candidate',[{...candidate,file:'invented.js'}]),{now:1}).payload,'invalid_schema'));
test(()=>assert.equal(validateBumbleResponse(task,reply('candidate',[{...candidate,location:'9'}]),{now:1}).payload,'invalid_schema'));
test(()=>assert.equal(validateBumbleResponse(task,'{"task_id":"wrong","task_id":"'+task.task_id+'"}',{now:1}).payload,'invalid_json'));
test(()=>assert.equal(validateBumbleResponse(task,reply('candidate',[candidate,candidate]),{now:1}).payload,'candidate_overflow'));
test(()=>{const v=validateBumbleResponse(task,'x'.repeat(5000),{now:1});assert.equal(v.payload,'byte_overflow');assert.equal(v.complete_hash,null);});
test(()=>assert.equal(validateBumbleResponse(task,reply('candidate',[candidate]),{now:1001}).payload,'stale'));
test(()=>assert.equal(validateBumbleResponse(task,'refusal prose',{now:1}).coverage,'unresolved'));
test(()=>assert.equal(retainCandidates(task,[candidate,{...candidate,trigger:'Other input'}]).length,2));
test(()=>{const plan=new BumblePlan({deadline:1000,negative_ids:['t1']});const r=plan.admit({task_id:'t1',resource_group:'g1',source_ip_group:'ip'},1);plan.terminal(r,'outcome_unknown');plan.retire('g1');const restored=new BumblePlan({deadline:1000,negative_ids:['t1']},plan.snapshot());assert.equal(restored.admit({task_id:'t2',resource_group:'g2',source_ip_group:'ip'},2),null);assert.equal(restored.coverage().audit,'audit_unmet');});
test(()=>{const plan=new BumblePlan({deadline:1000,max_investigations:1,negative_ids:['negative']});const r=plan.admit({task_id:'negative',resource_group:'g1',source_ip_group:'ip'},1);plan.terminal(r,'scoped_negative',{remote_release_verified:true});assert.equal(plan.coverage().audit,'sample_met');assert.equal(plan.investigate(),true);assert.equal(plan.investigate(),false);});
test(()=>{for(const size of [1,10,100,1000]){const plan=new BumblePlan({deadline:1000,global:Math.max(2,size),per_group:1});let admitted=0;for(let n=0;n<size;n++)if(plan.admit({task_id:`t${n}`,resource_group:`g${n}`,source_ip_group:'shared-ip'},1))admitted++;assert.equal(admitted,1);}});
// Supplied scope must be copied from validated data, never caller serialization.
const taskOptions=scope=>({run_id:'scope-fixture',piece_id:'piece',source:task.source,scope,check:'One grounded check',deadline:1000,budget:{response_bytes:4096,candidates:1}});
const validScope=()=>[{file:'a.js',start_line:1,text:task.source}];
test(()=>{const scope=validScope(),made=makeBumbleTask(taskOptions(scope));scope[0].file='changed.js';assert.equal(made.scope[0].file,'a.js');assert(Object.isFrozen(made.scope));assert(Object.isFrozen(made.scope[0]));assert.equal(made.quorum_votes,0);});
test(()=>{let invoked=0;const scope=validScope();scope.toJSON=()=>{invoked++;return [{file:'../outside.js',start_line:1,text:task.source}];};let made;try{made=makeBumbleTask(taskOptions(scope));}catch{assert.equal(invoked,0);return;}assert.equal(invoked,0);assert.equal(made.scope[0].file,'a.js');});
test(()=>{const scope=validScope();scope[0].file='../outside.js';scope.every=()=>true;assert.throws(()=>makeBumbleTask(taskOptions(scope)));});
test(()=>{let invoked=0;const scope=[];Object.defineProperty(scope,'0',{get(){invoked++;return validScope()[0];},enumerable:true});assert.throws(()=>makeBumbleTask(taskOptions(scope)));assert.equal(invoked,0);});
test(()=>{let invoked=0;const row={start_line:1,text:task.source};Object.defineProperty(row,'file',{get(){invoked++;return 'a.js';},enumerable:true});assert.throws(()=>makeBumbleTask(taskOptions([row])));assert.equal(invoked,0);});
test(()=>{const scope=validScope();Object.defineProperty(scope,Symbol.iterator,{value:function*(){yield {file:'../outside.js',start_line:1,text:task.source};}});assert.throws(()=>makeBumbleTask(taskOptions(scope)));});
test(()=>{const scope=validScope();scope.length=2;assert.throws(()=>makeBumbleTask(taskOptions(scope)));});
console.log(JSON.stringify({passed:true,checks:count,scope:'offline contract/admission fixtures; not live capacity or reviewer qualification'}));
