// Supplementary adapter containment is the existing governor's runProcess.
// No activation flag, credential value or permission is accepted from worker output.
import {fileURLToPath} from 'node:url';
import {REMOTE_POLICY_ACTIVE} from './reviewer-registry.mjs';
import {parseBumbleJSON} from './bumble-contract.mjs';
const worker=fileURLToPath(new URL('./bumble-http-worker.mjs',import.meta.url));
// Pure validation can be tested without injecting an activation switch.
export function validateBumbleTransportReply(job,execution){
  const unknown=()=>({transport:'outcome_unknown',payload:'unavailable',result:null,request_sent:'unknown',credentials_read:'unknown',quorum_votes:0,completion:false});
  const identity=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);
  const modelName=v=>typeof v==='string'&&/^[A-Za-z0-9_.:/-]{1,200}$/.test(v);
  if(!identity(job?.task?.task_id)||!identity(job?.task?.attempt_id)||!execution||execution.timedOut||execution.outputLimited||execution.code!==0||typeof execution.stdout!=='string'||Buffer.byteLength(execution.stdout)>100000)return unknown();
  let reply;try{reply=parseBumbleJSON(execution.stdout);}catch{return unknown();}
  const allowed=['schema','task_id','attempt_id','transport','payload','finished','content','finish_reason','reported_usage','reported_model','raw_envelope_sha256','raw_withheld','quorum_votes','credentials_read','request_sent'];
  if(!reply||typeof reply!=='object'||Array.isArray(reply)||Object.keys(reply).some(key=>!allowed.includes(key))||reply.schema!=='momm-bumble-http-attempt/1'||reply.task_id!==job.task.task_id||reply.attempt_id!==job.task.attempt_id||!['success','transport_error','outcome_unknown','refused','stale','authentication_required','policy_required'].includes(reply.transport)||!['envelope_valid','invalid_envelope','invalid_json','credential_reflection','stale','unavailable','byte_overflow','deadline','owner_handoff_not_qualified'].includes(reply.payload)||typeof reply.finished!=='boolean'||(reply.content!==null&&(typeof reply.content!=='string'||Buffer.byteLength(reply.content)>65536)))return unknown();
  if((Object.hasOwn(reply,'quorum_votes')&&reply.quorum_votes!==0)||(Object.hasOwn(reply,'raw_withheld')&&typeof reply.raw_withheld!=='boolean')||(Object.hasOwn(reply,'credentials_read')&&typeof reply.credentials_read!=='boolean')||(Object.hasOwn(reply,'request_sent')&&typeof reply.request_sent!=='boolean'&&reply.request_sent!=='unknown'))return unknown();
  if(reply.payload==='envelope_valid'){
    if(reply.transport!=='success'||typeof reply.content!=='string'||!['stop','length'].includes(reply.finish_reason)||reply.finished!==(reply.finish_reason==='stop')||!modelName(reply.reported_model)||typeof reply.raw_envelope_sha256!=='string'||!/^[a-f0-9]{64}$/.test(reply.raw_envelope_sha256))return unknown();
  }else if(reply.content!==null||reply.finished)return unknown();
  const usage=reply.reported_usage??{};
  if(!usage||typeof usage!=='object'||Array.isArray(usage)||Object.keys(usage).some(key=>!['prompt_tokens','completion_tokens','total_tokens'].includes(key)||!Number.isSafeInteger(usage[key])||usage[key]<0))return unknown();
  return {schema:'momm-bumble-http-attempt/1',task_id:job.task.task_id,attempt_id:job.task.attempt_id,transport:reply.transport,payload:reply.payload,finished:reply.finished,content:reply.content,
    ...(reply.payload==='envelope_valid'?{finish_reason:reply.finish_reason,reported_model:reply.reported_model,raw_envelope_sha256:reply.raw_envelope_sha256,reported_usage:{...usage}}:{}),
    result:null,request_sent:'unknown',credentials_read:'unknown',quorum_votes:0,completion:false};
}
export function createBumbleTransport(runProcess){
  if(typeof runProcess!=='function')throw Error('The existing MOMM process supervisor is required.');
  return Object.freeze({
    async dispatch(job,{deadline,now=Date.now()}={}){
      if(!REMOTE_POLICY_ACTIVE)return {transport:'policy_required',payload:'unavailable',result:null,credentials_read:false,request_sent:false,quorum_votes:0};
      if(!Number.isSafeInteger(deadline)||!Number.isSafeInteger(now)||now>=deadline)return {transport:'known_not_sent',payload:'unavailable',result:null,request_sent:false,quorum_votes:0};
      const input=JSON.stringify(job);if(Buffer.byteLength(input)>100000)throw Error('Private worker handoff exceeds its finite input budget.');
      const execution=await runProcess(process.execPath,[worker],{input,timeoutMs:Math.min(deadline-now,300000)});
      // The trusted task validator, not this envelope or a model, decides coverage.
      return validateBumbleTransportReply(job,execution);
    }
  });
}
