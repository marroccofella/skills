// Governor-authored probes of actual source, outside the running pack's frozen membership.
import assert from 'node:assert/strict';
import {makeBumbleTask,validateBumbleResponse} from '../scripts/bumble-contract.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const selected=process.argv[process.argv.indexOf('--case')+1];
assert(['attestation','grounding','decoding'].includes(selected),'Choose one bounded synthetic case');
let passed=0,failed=0;const observations=[];
function test(name,fn){try{const measurement=fn();passed++;observations.push({name,status:'passed',...measurement});}catch(error){failed++;observations.push({name,status:'failed',...(error.measurement||{})});}}
const make=(source='const total = 2;',deadline=Date.now()+60000)=>makeBumbleTask({run_id:'boundary-fixture',piece_id:'piece',source,scope:[{file:'fixture.js',start_line:1,text:source}],check:'One supplied-source check',deadline,budget:{response_bytes:65536,candidates:1}});
const negative=task=>JSON.stringify({task_id:task.task_id,result:'no_candidate_in_supplied_scope',candidates:[],limitations:[]});
if(selected==='attestation'){
  const task=make(),body=negative(task);
  test('explicit trusted completion is a positive control',()=>assert.equal(validateBumbleResponse(task,body,{transport:'success',finished:true,now:Date.now()}).coverage,'scoped_completed'));
  test('omitted host attestations cannot establish scoped completion',()=>assert.equal(validateBumbleResponse(task,body).coverage,'unresolved'));
  test('partial host attestations cannot establish scoped completion',()=>assert.equal(validateBumbleResponse(task,body,{now:Date.now()}).coverage,'unresolved'));
  test('null host attestations return unresolved instead of throwing',()=>assert.equal(validateBumbleResponse(task,body,null).coverage,'unresolved'));
  test('explicit interrupted transport cannot grant votes',()=>{const value=validateBumbleResponse(task,body,{transport:'timeout',finished:false,now:Date.now()});assert.equal(value.coverage,'unresolved');assert.equal(value.quorum_votes,0);});
}
if(selected==='grounding'){
  function measure(width,candidates){
    const source=';'.repeat(width)+'\nEND',task=make(source),candidate={file:'fixture.js',location:'1',quote:';\nEND',hypothesis:'Synthetic hypothesis',trigger:'Input',missing_information:[]};
    const body=JSON.stringify({task_id:task.task_id,result:'candidate',candidates:Array.from({length:candidates},()=>({...candidate})),limitations:[]});
    const original=Array.prototype.join;let joins=0,characters=0,result;
    Array.prototype.join=function(separator){if(this.length===2&&this[0]===';'.repeat(width)&&this[1]==='END'){joins++;characters+=this[0].length+this[1].length+String(separator).length;}return original.call(this,separator);};
    try{result=validateBumbleResponse(task,body,{transport:'success',finished:true,now:Date.now()});}finally{Array.prototype.join=original;}
    return {result,measurement:{width,candidates,scope_tail_join_calls:joins,scope_tail_join_input_characters:characters,network_calls:0,model_calls:0}};
  }
  for(const width of [32,128])test('one valid mid-line quote copies its supplied tail at most once: '+width,()=>{const {result,measurement}=measure(width,1);assert.equal(result.payload,'valid');try{assert(measurement.scope_tail_join_calls<=1);}catch(error){error.measurement=measurement;throw error;}return measurement;});
  test('overflow retains its distinct status without repeated source-tail copying',()=>{const {result,measurement}=measure(128,16);assert.equal(result.payload,'candidate_overflow');assert.equal(result.coverage,'unresolved');try{assert(measurement.scope_tail_join_calls<=1);}catch(error){error.measurement=measurement;throw error;}return measurement;});
}
if(selected==='decoding'){
  const task=make(),body=negative(task),bytes=Buffer.concat([Buffer.from([239,187,191]),Buffer.from(body)]);
  test('intentional BOM tolerance preserves the exact distinct raw-byte identity',()=>{const a=validateBumbleResponse(task,bytes,{transport:'success',finished:true,now:Date.now()}),b=validateBumbleResponse(task,Buffer.from(body),{transport:'success',finished:true,now:Date.now()});assert.equal(a.payload,'valid');assert.equal(b.payload,'valid');assert.notEqual(a.raw_sha256,b.raw_sha256);assert.equal(a.quorum_votes,0);});
  test('unpaired source-text surrogate is refused rather than silently repaired',()=>{const value=JSON.stringify({task_id:task.task_id,result:'abstain',candidates:[],limitations:['prefix']}).replace('prefix',String.fromCharCode(0xd800));const result=validateBumbleResponse(task,value,{transport:'success',finished:true,now:Date.now()}),measurement={observed_payload:result.payload,observed_limitation_codepoint:result.limitations?.[0]?.codePointAt(0)??null,coverage:result.coverage,quorum_votes:result.quorum_votes};try{assert.equal(result.payload,'invalid_json');}catch(error){error.measurement=measurement;throw error;}return measurement;});
}
console.log(JSON.stringify({selected,passed,failed,observations,network_calls:0,model_calls:0,product_modified:false,scope:'Synthetic explicit-attestation and deterministic join-work observations, not a CPU benchmark or native worker qualification'}));if(failed)process.exitCode=1;
