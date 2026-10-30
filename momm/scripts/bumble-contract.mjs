// Trusted validation: model text never supplies authority, identity, budgets or completion.
import crypto from 'node:crypto';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const wellFormed=value=>typeof value==='string'&&!/[\uD800-\uDFFF]/u.test(value);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
export function parseBumbleJSON(bytes){
  if(typeof bytes!=='string'||Buffer.byteLength(bytes)>100000)throw Error('Invalid bounded JSON text.');
  const stack=[];
  for(let i=0;i<bytes.length;i++){
    const ch=bytes[i];
    if(ch==='"'){const begin=i;for(i++;i<bytes.length;i++){if(bytes[i]==='\\'){i++;continue;}if(bytes[i]==='"')break;}let next=i+1;while(/\s/.test(bytes[next]||'')&&next<bytes.length)next++;if(bytes[next]===':'&&stack.at(-1)?.type==='{'){const key=JSON.parse(bytes.slice(begin,i+1));if(stack.at(-1).keys.has(key))throw Error('Duplicate key');stack.at(-1).keys.add(key);}continue;}
    if(ch==='{'||ch==='['){stack.push({type:ch,keys:new Set()});if(stack.length>12)throw Error('Depth exceeded');}
    else if(ch==='}'||ch===']')stack.pop();
  }
  return JSON.parse(bytes);
}
function captureOwnData(value,required){
  if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Array.isArray(value))throw Error('Bounded task data fields are required.');
  const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
  if(names.length!==required.length||names.some(key=>typeof key!=='string'||!required.includes(key)||!Object.hasOwn(descriptors[key],'value')||!descriptors[key].enumerable))throw Error('Bounded task data fields are required.');
  return descriptors;
}
function copyDataArray(value,minimum,maximum){
  const invalid=()=>{throw Error('Bounded task array data is required.');};
  if(!Array.isArray(value))invalid();
  // Capture owned data once; caller iteration, validation and JSON hooks are unused.
  // Proxy descriptor traps are not an execution sandbox; construction is governor-owned.
  const descriptors=Object.getOwnPropertyDescriptors(value),length=descriptors.length?.value;
  if(!Number.isSafeInteger(length)||length<minimum||length>maximum)invalid();
  const names=Reflect.ownKeys(descriptors);
  if(names.length!==length+1||names.some(key=>typeof key!=='string'||(key!=='length'&&!/^(0|[1-9][0-9]*)$/.test(key))))invalid();
  const copied=[];
  for(let index=0;index<length;index++){
    const entry=descriptors[index];
    if(!entry||!Object.hasOwn(entry,'value')||!entry.enumerable)invalid();
    copied.push(entry.value);
  }
  return copied;
}
function copySuppliedScope(scope,source){
  const copied=[];
  for(const row of copyDataArray(scope,1,8)){
    const fields=captureOwnData(row,['file','start_line','text']);
    const file=fields.file.value,start_line=fields.start_line.value,text=fields.text.value;
    if(typeof file!=='string'||!/^[A-Za-z0-9_./-]{1,200}$/.test(file)||file.split('/').includes('..')||!wellFormed(text)||!text.length||!source.includes(text)||!Number.isSafeInteger(start_line)||start_line<1)throw Error('Bounded supplied file/line scope is required.');
    copied.push({file,start_line,text});
  }
  return copied;
}
function taskFields({run_id,piece_id,source,scope,check,omissions=[],deadline,budget,role_version='1',task_type='source-grounded-check',mandatory=false}){
  const suppliedOmissions=copyDataArray(omissions,0,8);
  if(![run_id,piece_id,role_version,task_type].every(identity)||typeof mandatory!=='boolean'||!suppliedOmissions.every(s=>wellFormed(s)&&s.length<=500))throw Error('Invalid bounded task metadata.');
  const budgetFields=captureOwnData(budget,['response_bytes','candidates']),response_bytes=budgetFields.response_bytes.value,candidates=budgetFields.candidates.value;
  if(!wellFormed(source)||!source.length||Buffer.byteLength(source)>32000||!wellFormed(check)||!check.trim()||check.length>1000||!Number.isSafeInteger(deadline)||deadline<0||!Number.isSafeInteger(response_bytes)||response_bytes<1||response_bytes>65536||!Number.isSafeInteger(candidates)||candidates<1||candidates>8)throw Error('Invalid bounded Bumble task.');
  const suppliedScope=copySuppliedScope(scope,source);
  return {run_id,piece_id,source,source_sha256:hash(source),scope:suppliedScope,check,omissions:suppliedOmissions,deadline,budget:{response_bytes,candidates},role_version,task_type,mandatory};
}
export function makeBumbleTask(input){
  const fields=taskFields(input);
  return freeze({schema:'momm-bumble-task/1',run_id:fields.run_id,piece_id:fields.piece_id,task_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),...Object.fromEntries(Object.entries(fields).filter(([key])=>!['run_id','piece_id'].includes(key))),quorum_votes:0});
}
function captureTask(task){
  const fields=captureOwnData(task,['schema','run_id','piece_id','task_id','attempt_id','source','source_sha256','scope','check','omissions','deadline','budget','role_version','task_type','mandatory','quorum_votes']);
  const owned=Object.fromEntries(Object.entries(fields).map(([key,descriptor])=>[key,descriptor.value]));
  if(owned.schema!=='momm-bumble-task/1'||!identity(owned.task_id)||!identity(owned.attempt_id)||owned.quorum_votes!==0)throw Error('Invalid task identity.');
  const validated=taskFields(owned);
  if(owned.source_sha256!==validated.source_sha256)throw Error('Task source identity mismatch.');
  // This validates bounded restored data, not origin or permission. The owned
  // stage must separately verify its immutable frame, baseline and reservations.
  return freeze({schema:owned.schema,run_id:validated.run_id,piece_id:validated.piece_id,task_id:owned.task_id,attempt_id:owned.attempt_id,...Object.fromEntries(Object.entries(validated).filter(([key])=>!['run_id','piece_id'].includes(key))),quorum_votes:0});
}
export function validateBumbleResponse(task,bytes,options){
  let transport='unavailable',finished,now;
  const unresolved=(payload,detail)=>({transport,payload,result:null,coverage:'unresolved',quorum_votes:0,detail});
  let attestation;
  try{attestation=captureOwnData(options,['transport','finished','now']);}
  catch{return unresolved('invalid_attestation','Explicit trusted transport, finality and time are required.');}
  const reportedTransport=attestation.transport.value;
  if(!['success','known_not_sent','transport_error','outcome_unknown','cancelled','refused','unavailable','unsupported','authentication_required','timeout'].includes(reportedTransport)||typeof attestation.finished.value!=='boolean')return unresolved('invalid_attestation','Trusted completion attestation is malformed.');
  transport=reportedTransport;finished=attestation.finished.value;now=attestation.now.value;
  if(transport!=='success')return unresolved('unavailable','Transport did not complete.');
  if(!Number.isSafeInteger(now)||now<0)return unresolved('invalid_clock','Completion time could not be verified.');
  try{task=captureTask(task);}catch{return unresolved('invalid_task','Bounded task identity and source could not be verified.');}
  if(now>=task.deadline)return unresolved('stale','Deadline passed; late answer retained separately.');
  if(!finished)return unresolved('truncated','No complete final response.');
  // Refuse ill-formed source text before UTF-8 encoding could replace it.
  // In Unicode mode a valid surrogate pair is one non-surrogate code point.
  if(typeof bytes==='string'&&/[\uD800-\uDFFF]/u.test(bytes))return unresolved('invalid_json','Response source text is not well-formed Unicode.');
  const raw=typeof bytes==='string'?Buffer.from(bytes):bytes instanceof Uint8Array?Buffer.from(bytes):null;
  if(!raw)return unresolved('invalid_bytes','Unsupported response byte container.');
  if(raw.length>task.budget.response_bytes)return {...unresolved('byte_overflow','Bounded prefix only; omitted candidate count unknown.'),retained_prefix:raw.subarray(0,task.budget.response_bytes).toString('base64'),complete_hash:null};
  try{bytes=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{return unresolved('invalid_json','Invalid UTF-8 response.');}
  let answer;try{answer=parseBumbleJSON(bytes);}catch{return unresolved('invalid_json','No evasion retry or automatic repair; duplicate keys/deep structures refused.');}
  if(!keys(answer,['task_id','result','candidates','limitations'])||answer.task_id!==task.task_id||!Array.isArray(answer.candidates)||!Array.isArray(answer.limitations)||answer.limitations.length>8||!answer.limitations.every(s=>typeof s==='string'&&s.length<=500))return unresolved('invalid_schema','Identity/shape mismatch.');
  if(!['candidate','no_candidate_in_supplied_scope','insufficient_context','abstain','refused'].includes(answer.result))return unresolved('invalid_schema','Unknown worker result.');
  if((answer.result==='candidate')!==(answer.candidates.length>0)||(answer.result==='insufficient_context'&&!answer.limitations.some(s=>s.trim())))return unresolved('invalid_schema','Contradictory result fields.');
  // Keep supplied text intact: offsets avoid rebuilding a suffix for every
  // matching column or candidate, without changing overflow validation order.
  const groundedScopes=task.scope.map(scope=>{
    const lines=scope.text.split('\n'),starts=[];let start=0;
    for(const line of lines){starts.push(start);start+=line.length+1;}
    return {scope,lines,starts};
  });
  for(const candidate of answer.candidates){
    if(!keys(candidate,['file','location','quote','hypothesis','trigger','missing_information'])||!['file','location','quote','hypothesis','trigger'].every(k=>typeof candidate[k]==='string'&&candidate[k].length>0&&candidate[k].length<=1500)||!task.source.includes(candidate.quote)||!Array.isArray(candidate.missing_information)||candidate.missing_information.length>8||!candidate.missing_information.every(s=>typeof s==='string'&&s.length<=500))return unresolved('invalid_schema','Candidate quote or fields invalid.');
    const line=Number(candidate.location);
    const grounded=({scope,lines,starts})=>{
      if(scope.file!==candidate.file||line<scope.start_line)return false;
      const offset=line-scope.start_line;if(offset>=lines.length)return false;
      const first=candidate.quote.split('\n')[0];
      if(!first)return false; // empty string search never advances past a line's end
      // A quote may begin within the cited line, but never silently on a later
      // line. Multi-line quotes must match the contiguous supplied span exactly.
      for(let column=lines[offset].indexOf(first);column>=0;column=lines[offset].indexOf(first,column+1))if(scope.text.startsWith(candidate.quote,starts[offset]+column))return true;
      return false;
    };
    if(!/^[1-9][0-9]{0,15}$/.test(candidate.location)||!Number.isSafeInteger(line)||!groundedScopes.some(grounded))return unresolved('invalid_schema','Quote is not bound to the supplied file and canonical start line.');
  }
  if(answer.candidates.length>task.budget.candidates)return {...unresolved('candidate_overflow','Complete bounded raw response retained; original candidates deferred-open.'),raw:raw.toString('utf8'),candidates:answer.candidates};
  return {transport:'success',payload:'valid',result:answer.result,coverage:['candidate','no_candidate_in_supplied_scope'].includes(answer.result)?'scoped_completed':'unresolved',candidates:answer.candidates,limitations:answer.limitations,raw_sha256:hash(raw),quorum_votes:0};
}
export function candidateKey(task,candidate){return hash(JSON.stringify([task.source_sha256,task.check,candidate.file,candidate.location,candidate.quote,candidate.trigger,candidate.hypothesis]));}
export function retainCandidates(task,candidates){const groups=new Map();for(const [index,c]of candidates.entries()){const key=candidateKey(task,c);const entry={task_id:task.task_id,candidate_index:index,candidate:c};if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}return [...groups].map(([key,originals])=>({key,originals,disposition:'deferred-open'}));}
