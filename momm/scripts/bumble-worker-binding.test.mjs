// Pure producer/consumer compatibility. No socket, credential, policy activation or writes.
import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {validateOpenAIEnvelope} from './bumble-http-worker.mjs';import {validateBumbleTransportReply} from './bumble-transport.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // this synthetic suite owns its fixtures
const job={task:{task_id:'synthetic-task',attempt_id:'synthetic-attempt'}},H=b=>crypto.createHash('sha256').update(b).digest('hex');
const envelope=model=>Buffer.from(JSON.stringify({model,choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16}}));
const options=model=>({model_id:model,task_id:job.task.task_id,attempt_id:job.task.attempt_id,deadline:100,now:1});
const consume=reply=>validateBumbleTransportReply(job,{code:0,stdout:JSON.stringify(reply)});
const reply=model=>({schema:'momm-bumble-http-attempt/1',task_id:job.task.task_id,attempt_id:job.task.attempt_id,transport:'success',payload:'envelope_valid',finished:true,content:'{}',finish_reason:'stop',reported_model:model,reported_usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16},raw_envelope_sha256:H('synthetic-original'),quorum_votes:0});
const cases={
 producer(){
  const actual=validateOpenAIEnvelope(envelope('synthetic-model'),options('synthetic-model'));
  assert.equal(consume({...actual,attempt_id:job.task.attempt_id}).transport,'success','Positive expected-envelope control prevents reject-everything coverage');
  assert.equal(actual.attempt_id,job.task.attempt_id,'Trusted worker producer must preserve the caller attempt identity');
  assert.equal(consume(actual).transport,'success','Producer output must satisfy its actual parent contract');
 },
 slash(){
  assert.equal(consume(reply('synthetic-model')).transport,'success','Plain-name positive control');
  assert.equal(consume(reply('synthetic-org/model-7b')).transport,'success','Model names are not task/attempt identifiers');
 },
 chainAndRefusals(){
  const actual=validateOpenAIEnvelope(envelope('synthetic-org/model-7b'),options('synthetic-org/model-7b'));
  assert.equal(actual.payload,'envelope_valid');assert.equal(actual.attempt_id,job.task.attempt_id);assert.equal(consume(actual).transport,'success');
  for(const altered of [{attempt_id:undefined},{attempt_id:null},{attempt_id:''},{attempt_id:'../other'}])assert.equal(validateOpenAIEnvelope(envelope('synthetic-model'),{...options('synthetic-model'),...altered}).payload,'invalid_envelope');
  assert.equal(consume({...actual,attempt_id:'foreign-attempt'}).transport,'outcome_unknown');
  for(const model of ['', 'bad\nmodel', 'x'.repeat(201)])assert.equal(consume({...reply('synthetic-model'),reported_model:model}).transport,'outcome_unknown');
  const stale=validateOpenAIEnvelope(envelope('synthetic-model'),{...options('synthetic-model'),now:100});assert.equal(stale.attempt_id,job.task.attempt_id);assert.equal(stale.payload,'stale');
 }
};
const selected=process.argv[2];if(selected){assert(cases[selected]);cases[selected]();}else for(const test of Object.values(cases))test();
console.log(JSON.stringify({passed:true,case:selected||'all',network_calls:0,credentials_read:false,policy_activated:false,qualified:false}));
