// Shadow orchestration seam: caller is the trusted governor, never a model.
// The existing dispatcher supplies runProcess; no second process supervisor.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {BumbleCapacity} from './bumble-capacity.mjs';
import {requirePrivateEvidence} from './evidence-permissions.mjs';
import {publishImmutableBytes} from './bumble-immutable-file.mjs';
import {startAttempt, persistAttempt} from './attempts.mjs';
import {prepareBumblePeerRequest, validateBumblePeerContent, peerSchemaMatches} from './bumble-peer-review.mjs';
import {parseBumbleJSON} from './bumble-contract.mjs';
const worker = fileURLToPath(new URL('./bumble-peer-worker.mjs', import.meta.url));
const H = value => crypto.createHash('sha256').update(value).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const boundedShadowRequests = value => Number.isSafeInteger(value) && value >= 1 && value <= 4;
const nullableString = {type:['string','null'],maxLength:200};
const count = {type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const WORKER_RESULT_SCHEMA = {
  type:'object',additionalProperties:false,
  required:['schema','attempt_id','transport','payload','finished','content','duration_ms'],
  properties:{schema:{enum:['momm-bumble-peer-worker-result/1']},attempt_id:{type:'string',maxLength:128},transport:{enum:['success','refused','authentication_required','outcome_unknown']},payload:{enum:['invalid_handoff','protected_preflight_refused','unavailable','credential_reflection','deadline','byte_overflow','incomplete_body','socket_failure','invalid_envelope','invalid_json','stale','envelope_valid','upstream_error']},finished:{type:'boolean'},content:{type:['string','null'],maxLength:65536},reported_usage:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,properties:{prompt_tokens:count,completion_tokens:count,total_tokens:count}}]},http_status:{anyOf:[{type:'null'},{type:'integer',minimum:100,maximum:599}]},request_id:nullableString,retry_after:nullableString,duration_ms:count,raw_envelope_sha256:{type:['string','null'],maxLength:64}}
};
export function validWorkerResult(value,attempt_id) {
  if(!peerSchemaMatches(value,WORKER_RESULT_SCHEMA)||value.attempt_id!==attempt_id||value.duration_ms>180000) return false;
  for(const name of ['request_id','retry_after'])if(value[name]!=null&&!/^[\x20-\x7e]{1,200}$/.test(value[name]))return false;
  if(value.raw_envelope_sha256!=null&&!sha(value.raw_envelope_sha256))return false;
  if(value.transport==='success'){
    if(value.http_status!==200)return false;
    if(value.payload==='envelope_valid')return typeof value.content==='string'&&sha(value.raw_envelope_sha256);
    return ['invalid_json','invalid_envelope','credential_reflection'].includes(value.payload)&&value.finished===false&&value.content===null;
  }
  if(value.finished!==false||value.content!==null)return false;
  if(value.transport==='authentication_required')return value.payload==='unavailable'&&[401,403].includes(value.http_status);
  if(value.transport==='refused')return ['invalid_handoff','protected_preflight_refused','unavailable'].includes(value.payload);
  if(value.payload==='upstream_error')return value.transport==='outcome_unknown'&&Number.isInteger(value.http_status)&&value.http_status>=500&&value.http_status<=599;
  return ['deadline','byte_overflow','incomplete_body','socket_failure','credential_reflection','stale','invalid_json','invalid_envelope'].includes(value.payload);
}
const refused = reason => ({schema:'momm-bumble-shadow/1', status:'not_dispatched', reason, dispatched:0, credentials_read:false, quorum_votes:0, completion:false});
// No default activation. Approval is an owner-host receipt, not a worker field.
// This seam intentionally cannot construct/replace a global capacity ledger or
// reconcile unknowns. The host must bind the existing manager and exact operator
// reconciliation evidence. No missing-proof fallback to counter/idle evidence.
export async function runBumblePeerShadow(input, host) {
  if (host?.approval?.mode !== 'synthetic_shadow' || host.approval.owner_approved !== true) return refused('owner_approval_required');
  const approval = host.approval, now = Date.now();
  if (!Number.isSafeInteger(approval.expires_at) || now >= approval.expires_at || approval.expires_at - now > 3600000 || approval.disclosure !== 'synthetic_code_only' || !boundedShadowRequests(approval.max_requests) || approval.max_tokens !== 1024 || approval.deadline_ms !== 180000 || !sha(approval.operator_reconciliation_sha256)) return refused('bounded_approval_or_reconciliation_required');
  if (typeof host.runProcess !== 'function' || !host.capacity || !['reserve','summary','markTransmissionPossible','terminal'].every(name=>typeof host.capacity[name]==='function') || typeof host.root!=='string' || !host.root || !/^rev_[A-Za-z0-9_]{1,124}$/.test(host.run_id??'') || !identity(host.endpoint_id) || !sha(host.adapter_sha256) || !sha(host.connection_sha256)) return refused('trusted_host_binding_required');
  if(!host.connection || typeof host.connection!=='object' || Array.isArray(host.connection))return refused('trusted_host_binding_required');
  if(!sha(approval.connection_sha256)||approval.connection_sha256!==host.connection_sha256||!sha(approval.adapter_sha256)||approval.adapter_sha256!==host.adapter_sha256||!Number.isSafeInteger(approval.credential_epoch)||approval.credential_epoch<1||approval.credential_epoch!==host.connection.credential_epoch)return refused('owner_connection_binding_required');
  if(!sha(approval.authorization_sha256)||!sha(approval.capacity_configuration_sha256))return refused('owner_capacity_binding_required');
  let connectionBytes;
  try {connectionBytes=JSON.stringify(host.connection);if(typeof connectionBytes!=='string'||Buffer.byteLength(connectionBytes)>16384||H(connectionBytes)!==host.connection_sha256)return refused('connection_or_budget_changed');} catch {return refused('trusted_host_binding_required');}
  let request;
  try { request = prepareBumblePeerRequest(input); } catch { return refused('invalid_request'); }
  // Capture the exact owned data already validated by request preparation, once.
  // The caller's input object is never read again after an asynchronous boundary.
  const artifact=JSON.parse(JSON.parse(request.request_body).messages[1].content).artifact;
  const frame={artifact,model:request.model,max_tokens:request.max_tokens,role:request.role,role_version:request.role_version};
  if (request.max_tokens > approval.max_tokens) return refused('connection_or_budget_changed');
  const deadline = Math.min(Date.now() + approval.deadline_ms, approval.expires_at);
  if (deadline <= Date.now()) return refused('expired_before_admission');
  const run_id = host.run_id, task_id = crypto.randomUUID();
  const binding = H(JSON.stringify([request.peer_contract, request.schema_sha256, request.model, request.role, request.role_version, host.adapter_sha256, host.connection_sha256, approval.operator_reconciliation_sha256]));
  let reservation;
  try {const summary=host.capacity.summary();if(summary.configuration_sha256!==approval.capacity_configuration_sha256)return refused('owner_capacity_binding_required');if(!Number.isSafeInteger(summary.attempts)||summary.attempts<0||!Number.isSafeInteger(summary.reserved_tokens)||summary.reserved_tokens<0)return refused('finite_shared_budget');} catch {return refused('capacity_reconciliation_required');}
  const admission_budget={schema:'momm-bumble-admission-budget/1',authorization_sha256:approval.authorization_sha256,configuration_sha256:approval.capacity_configuration_sha256,max_attempts:approval.max_requests,max_reserved_tokens:approval.max_requests*approval.max_tokens,max_completion_tokens:approval.max_tokens,max_outstanding:1,expires_at:approval.expires_at};
  try { reservation = host.capacity.reserve({endpoint_id:host.endpoint_id, run_id, task_id, worker_binding:binding, max_tokens:request.max_tokens, deadline, now:Date.now(),admission_budget}); } catch { return {...refused('capacity_reconciliation_required'),reservation_held:'unknown'}; }
  if(!reservation || typeof reservation!=='object' || typeof reservation.admitted!=='boolean')return {...refused('capacity_reconciliation_required'),reservation_held:'unknown'};
  if (!reservation.admitted) return refused('shared_capacity_or_budget');
  if(!identity(reservation.reservation_id))return {...refused('capacity_reconciliation_required'),reservation_held:true};
  let started;
  try {
    started = startAttempt(host.root, {run_id, route:'bumble-shadow', piece:'synthetic', started_at:new Date().toISOString(), input_sha256:request.artifact_sha256, request_sha256:request.request_sha256, schema_sha256:request.schema_sha256, peer_contract:request.peer_contract, model:request.model, role:request.role, role_version:request.role_version, model_family:'unknown', ordinal:1, reservation_id:reservation.reservation_id, task_id, deadline, max_tokens:request.max_tokens, worker_binding:binding, quorum_votes:0});
  } catch { return {...refused('attempt_evidence_failed'), reservation_held:true}; }
  const base = {schema:'momm-bumble-shadow/1', attempt_id:started.attempt_id, dispatched:0, quorum_votes:0, completion:false};
  // No child or secret access before a durable started identity and reservation.
  // This conservative mark can retain a hold even if child setup later refuses.
  try { host.capacity.markTransmissionPossible(reservation.reservation_id, Date.now()); }
  catch { return {...base, dispatched:0, status:'capacity_reconciliation_required', reservation_held:true}; }
  let execution;
  try {
    const workerInput=JSON.stringify({schema:'momm-bumble-peer-worker/1', attempt_id:started.attempt_id, connection:JSON.parse(connectionBytes), connection_sha256:host.connection_sha256, request_sha256:request.request_sha256, deadline, frame});
    const timeoutMs=deadline-Date.now();
    // Local evidence/marking can exhaust approval. Never create a new 1ms window.
    // The possible-transmission mark and conservative hold remain untouched.
    if(timeoutMs>0){
      // Detect code changed during admission/evidence work. This consistency
      // recheck is not atomic executable custody or an OS sandbox.
      if(H(fs.readFileSync(worker))!==host.adapter_sha256)throw Error('Worker changed before supervisor invocation.');
      base.dispatched=1;
      execution = await host.runProcess(process.execPath, [worker], {input:workerInput,timeoutMs});
    }
  } catch { execution = null; }
  let envelope = null;
  if (execution && execution.code === 0 && !execution.timedOut && !execution.outputLimited && typeof execution.stdout === 'string' && Buffer.byteLength(execution.stdout) <= 100000) {
    try { envelope = parseBumbleJSON(execution.stdout); } catch { /* Unknown is retained. */ }
  }
  const valid = envelope && validWorkerResult(envelope,started.attempt_id);
  if (!valid) envelope = {transport:'outcome_unknown', payload:'unavailable', finished:false, content:null};
  const result = envelope.transport === 'success' && envelope.payload === 'envelope_valid' ? validateBumblePeerContent(envelope.content, artifact, envelope.finished) : {status:['credential_reflection','invalid_json','invalid_envelope','stale'].includes(envelope.payload) ? envelope.payload : envelope.transport, gates:{transport:envelope.transport==='success',json:false,schema:false,scope:false,finding_accuracy:'unverified'}, review:null, quorum_votes:0, completion:false};
  const status = result.status === 'advisory_valid' ? 'success' : envelope.transport === 'authentication_required' ? 'authentication_required' : envelope.transport === 'success' ? 'invalid_output' : 'error';
  const record = {schema:'momm-attempt/1', run_id, attempt_id:started.attempt_id, route:'bumble-shadow', ordinal:1, piece:'synthetic', task_id, reservation_id:reservation.reservation_id, input_sha256:request.artifact_sha256, request_sha256:request.request_sha256, schema_sha256:request.schema_sha256, peer_contract:request.peer_contract, model:request.model, model_family:'unknown', role:request.role, role_version:request.role_version, status, outcome:status === 'success' ? 'succeeded' : status === 'invalid_output' ? 'invalid_output' : status === 'authentication_required' ? 'authentication_required' : 'failed', original_transport:envelope.transport, original_payload:envelope.payload, finished_at:new Date().toISOString(), usage:envelope.reported_usage ?? null, request_id:envelope.request_id ?? null, http_status:envelope.http_status ?? null, retry_after:envelope.retry_after ?? null, raw_envelope_sha256:envelope.raw_envelope_sha256 ?? null, content:envelope.content, gates:result.gates, review:result.review, quorum_votes:0, accounting:{cost:'unavailable'}, automatic_retries:0, completion:false};
  let evidence=null;
  try {
    evidence = persistAttempt(host.root, record);
    host.capacity.terminal(reservation.reservation_id, {transport:envelope.transport === 'success' ? 'success' : envelope.transport === 'refused' || envelope.transport === 'authentication_required' ? 'refused' : 'outcome_unknown', payload:envelope.transport === 'success' ? result.status === 'advisory_valid' ? 'valid' : 'invalid' : 'unavailable', now:Date.now()});
    return {...base, ...result, evidence, reservation_held:true, credentials_read:'unknown', physical_release:'not_verified'};
  } catch { return {...base, status:'evidence_or_capacity_reconciliation_required', evidence, reservation_held:true, remote_outcome:'unknown'}; }
}

// Development host broker. The separately trusted owner host supplies the public
// pin, already-private stores, existing global manager and existing supervisor.
// This authenticates an exact signed plan, not the truth of its reconciliation,
// signer custody, synthetic-source assertion or native/platform qualification.
// There is no signer, credential reader, approval UI or native activation here.
export function createBumbleShadowBroker(options) {
  const fail=()=>{throw Error('Protected shadow approval refused; no dispatch or hold release authorized.');};
  const fields=(v,names)=>{
    if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail();
    const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);
    if(keys.length!==names.length||keys.some(k=>typeof k!=='string'||!names.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail();
    return Object.fromEntries(names.map(k=>[k,ds[k].value]));
  };
  const o=fields(options,['project_root','journal_root','approval_root','approval_file','approval_sha256','public_key_pem','public_key_sha256','connection','capacity','runProcess']);
  if(typeof o.runProcess!=='function'||!(o.capacity instanceof BumbleCapacity)||!sha(o.approval_sha256)||!sha(o.public_key_sha256)||typeof o.public_key_pem!=='string'||!o.public_key_pem.startsWith('-----BEGIN PUBLIC KEY-----')||Buffer.byteLength(o.public_key_pem)>4096)fail();
  let key;try{key=crypto.createPublicKey(o.public_key_pem);}catch{fail();}
  if(key.asymmetricKeyType!=='ed25519'||H(key.export({type:'spki',format:'der'}))!==o.public_key_sha256)fail();
  const project=fs.realpathSync.native(o.project_root);
  const privateRoot=value=>{
    if(typeof value!=='string'||!path.isAbsolute(value))fail();
    requirePrivateEvidence(value);const actual=fs.realpathSync.native(value),relative=path.relative(project,actual);
    const reverse=path.relative(actual,project);
    const outside=rel=>Boolean(rel)&&(path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep));
    if(actual!==value||!outside(relative)||!outside(reverse))fail();
    return actual;
  };
  const approvals=privateRoot(o.approval_root),journal=privateRoot(o.journal_root);
  if(typeof o.approval_file!=='string'||!/^approval-[a-f0-9-]{36}\.json$/.test(o.approval_file))fail();
  const receiptFile=path.join(approvals,o.approval_file);
  const readReceipt=()=>{
    requirePrivateEvidence(approvals);
    const before=fs.lstatSync(receiptFile,{bigint:true});
    const regular=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&s.ino>0n&&s.size>0n&&s.size<=65536n;
    if(!regular(before))fail();
    const same=s=>regular(s)&&s.ino===before.ino&&(process.platform==='win32'||s.dev===before.dev)&&s.size===before.size&&s.mtimeNs===before.mtimeNs;
    const fd=fs.openSync(receiptFile,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let bytes;
    try{
      if(!same(fs.fstatSync(fd,{bigint:true})))fail();bytes=Buffer.alloc(Number(before.size)+1);let offset=0;
      while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!count)break;offset+=count;}
      if(offset!==Number(before.size)||!same(fs.fstatSync(fd,{bigint:true}))||!same(fs.lstatSync(receiptFile,{bigint:true})))fail();bytes=bytes.subarray(0,offset);
    }finally{fs.closeSync(fd);}
    if(H(bytes)!==o.approval_sha256)fail();return bytes;
  };
  const envelope=fields(parseBumbleJSON(new TextDecoder('utf-8',{fatal:true}).decode(readReceipt())),['payload','signature']);
  if(typeof envelope.payload!=='string'||Buffer.byteLength(envelope.payload)>60000||typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))fail();
  const signature=Buffer.from(envelope.signature,'base64url');
  if(signature.length!==64||signature.toString('base64url')!==envelope.signature||!crypto.verify(null,Buffer.from(envelope.payload),key,signature))fail();
  const p=fields(parseBumbleJSON(envelope.payload),['schema','authorization_id','issued_at','expires_at','run_id','endpoint_id','connection_sha256','adapter_sha256','broker_sha256','capacity_configuration_sha256','operator_reconciliation_sha256','credential_epoch','disclosure','mode','max_requests','max_tokens','deadline_ms','fixtures']);
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if(p.schema!=='momm-bumble-shadow-approval/1'||!uuid.test(p.authorization_id)||o.approval_file!==`approval-${p.authorization_id}.json`||!/^rev_[A-Za-z0-9_]{1,124}$/.test(p.run_id)||!identity(p.endpoint_id)||p.mode!=='synthetic_shadow'||p.disclosure!=='synthetic_code_only'||!boundedShadowRequests(p.max_requests)||p.max_tokens!==1024||p.deadline_ms!==180000||!Number.isSafeInteger(p.issued_at)||p.issued_at<0||!Number.isSafeInteger(p.expires_at)||p.expires_at<=p.issued_at||p.expires_at-p.issued_at>3600000||!Number.isSafeInteger(p.credential_epoch)||p.credential_epoch<1||!['connection_sha256','adapter_sha256','broker_sha256','capacity_configuration_sha256','operator_reconciliation_sha256'].every(k=>sha(p[k])))fail();
  // Own one serialized snapshot; later caller mutation cannot change the plan.
  const connection=fields(o.connection,['connect_address','port','tls_identity','certificate_file','certificate_sha256','credential_file','model','credential_epoch']);
  const address=typeof connection.connect_address==='string'?connection.connect_address.split('.').map(Number):[];
  if(typeof connection.connect_address!=='string'||net.isIP(connection.connect_address)!==4||address[0]!==100||address[1]<64||address[1]>127||typeof connection.tls_identity!=='string'||!Number.isSafeInteger(connection.port)||connection.port<1||connection.port>65535||!['certificate_file','credential_file'].every(k=>typeof connection[k]==='string'&&path.isAbsolute(connection[k]))||!sha(connection.certificate_sha256))fail();
  if(H(JSON.stringify(connection))!==p.connection_sha256||connection.credential_epoch!==p.credential_epoch)fail();
  if(!Array.isArray(p.fixtures)||!p.fixtures.length||p.fixtures.length>p.max_requests)fail();
  const fixtures=new Map();
  for(const value of p.fixtures){
    const f=fields(value,['id','input','request_sha256']);if(!identity(f.id)||fixtures.has(f.id)||!sha(f.request_sha256))fail();
    const request=prepareBumblePeerRequest(f.input);
    if(request.request_sha256!==f.request_sha256||request.model!==connection.model)fail();
    if([...fixtures.values()].some(other=>other.request_sha256===f.request_sha256))fail();
    fixtures.set(f.id,f);
  }
  const anchor=Date.now(),mono=performance.now();let lastWall=anchor,burned=false;
  const current=()=>{
    const now=Date.now(),elapsed=performance.now()-mono;
    if(burned||now<lastWall||now<p.issued_at||now>=p.expires_at||elapsed<0||elapsed>=p.expires_at-anchor){burned=true;fail();}lastWall=now;
    if(H(fs.readFileSync(worker))!==p.adapter_sha256||H(fs.readFileSync(fileURLToPath(import.meta.url)))!==p.broker_sha256)fail();
    readReceipt();requirePrivateEvidence(journal);
    if(fs.existsSync(path.join(approvals,`revoked-${p.authorization_id}.json`))||o.capacity.summary().configuration_sha256!==p.capacity_configuration_sha256)fail();
    o.capacity.endpointGroups(p.endpoint_id);
  };
  current();
  // Bind the authorization ID once. Different envelopes cannot silently redefine
  // an existing authorization or reset its global attempt/token accounting.
  const authorization_sha256=H(p.authorization_id),bindingFile=path.join(journal,`authorization-${p.authorization_id}.json`);
  const binding=Buffer.from(JSON.stringify({schema:'momm-bumble-shadow-authorization-binding/1',payload_sha256:H(envelope.payload),public_key_sha256:o.public_key_sha256})+'\n');
  if(fs.existsSync(bindingFile)){
    const stat=fs.lstatSync(bindingFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==binding.length||!fs.readFileSync(bindingFile).equals(binding))fail();
  }else publishImmutableBytes(journal,bindingFile,binding);
  return Object.freeze({
    readiness:()=>({schema:'momm-bumble-shadow-broker/1',scope:'signed_synthetic_plan_only',native_active:false,credentials_read:false,quorum_votes:0,completion:false}),
    async dispatch(fixture_id){
      current();const f=fixtures.get(fixture_id);if(!f)fail();
      const claimFile=path.join(journal,`claim-${p.authorization_id}-${H(fixture_id)}.json`);
      // Exclusive claim before reservation/child. A failed/uncertain claim or
      // later failure is never retried, reclaimed or treated as known-unsent.
      publishImmutableBytes(journal,claimFile,Buffer.from(JSON.stringify({schema:'momm-bumble-shadow-claim/1',authorization_sha256,fixture_id,request_sha256:f.request_sha256,claimed_at:Date.now()})+'\n'));
      current();
      const approval={...p,owner_approved:true,authorization_sha256};delete approval.fixtures;
      const result=await runBumblePeerShadow(f.input,{approval,root:project,run_id:p.run_id,endpoint_id:p.endpoint_id,connection,connection_sha256:p.connection_sha256,adapter_sha256:p.adapter_sha256,capacity:o.capacity,runProcess:o.runProcess});
      const record={schema:'momm-bumble-shadow-broker-result/1',authorization_sha256,fixture_id,request_sha256:f.request_sha256,status:result.status,dispatched:result.dispatched,attempt_id:result.attempt_id??null,reservation_held:result.reservation_held??null,quorum_votes:0,completion:false};
      publishImmutableBytes(journal,path.join(journal,`result-${p.authorization_id}-${H(fixture_id)}.json`),Buffer.from(JSON.stringify(record)+'\n'));
      return result;
    }
  });
}
