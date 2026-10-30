// Protected host composition for one OAuth supplementary review. No default
// activation, signer, credential reader, capacity creation or release operation.
// A signature authenticates the supplied plan, not its backend assertions.
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {performance} from 'node:perf_hooks';
import {requirePrivateEvidence} from './evidence-permissions.mjs';
import {publishImmutableBytes} from './bumble-immutable-file.mjs';
import {openBumbleBaseline,materialForBumbleStage} from './bumble-baseline.mjs';
import {BumbleCapacity} from './bumble-capacity.mjs';
import {captureBumbleOAuthWorker} from './bumble-protected-execution.mjs';
import {prepareBumbleOAuthPeerContract,sealBumbleOAuthPeerHandoff,takeBumbleOAuthPeerHandoff,discardBumbleOAuthPeerHandoff} from './bumble-oauth-peer-handoff.mjs';
import {validateBumblePeerContent} from './bumble-peer-review.mjs';
import {validWorkerResult} from './bumble-peer-shadow.mjs';
import {parseBumbleJSON} from './bumble-contract.mjs';
import {startAttempt,persistAttempt} from './attempts.mjs';
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),SHA=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),UINT=v=>Number.isSafeInteger(v)&&v>=0;
const directory=path.dirname(fileURLToPath(import.meta.url));
const fail=()=>{throw Error('Protected OAuth pilot refused; no new dispatch or hold release authorized.');};
function fields(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail();const d=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(d);if(names.length!==keys.length||names.some(k=>!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail();return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
function readPinned(root,name,digest){
 requirePrivateEvidence(root);const file=path.join(root,name),a=fs.lstatSync(file,{bigint:true});
 const same=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&s.ino>0n&&s.ino===a.ino&&(process.platform==='win32'||s.dev===a.dev)&&s.size===a.size&&s.mtimeNs===a.mtimeNs;
 if(!same(a)||a.size<1n||a.size>65536n)fail();const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let bytes;
 try{if(!same(fs.fstatSync(fd,{bigint:true})))fail();bytes=Buffer.alloc(Number(a.size)+1);let n=0;while(n<bytes.length){const got=fs.readSync(fd,bytes,n,bytes.length-n,n);if(!got)break;n+=got;}if(n!==Number(a.size)||!same(fs.fstatSync(fd,{bigint:true}))||!same(fs.lstatSync(file,{bigint:true})))fail();bytes=bytes.subarray(0,n);}finally{fs.closeSync(fd);}
 if(H(bytes)!==digest)fail();return bytes;
}
const CONFIG=['base_url','server_name','certificate_sha256','scope_binding','baseline_report_sha256','association_sha256','validator_sha256','policy_sha256','trust_sha256','disclosure_sha256','logging_sha256'];
export function createBumbleOAuthPilot(options){
 const o=fields(options,['project_root','journal_root','approval_root','approval_file','approval_sha256','public_key_pem','public_key_sha256','capacity','runProcess','getPrivateMaterial']);
 if(!(o.capacity instanceof BumbleCapacity)||typeof o.runProcess!=='function'||typeof o.getPrivateMaterial!=='function'||!SHA(o.approval_sha256)||!SHA(o.public_key_sha256)||typeof o.public_key_pem!=='string'||Buffer.byteLength(o.public_key_pem)>4096)fail();
 const project=fs.realpathSync.native(o.project_root),outside=r=>Boolean(r)&&(path.isAbsolute(r)||r==='..'||r.startsWith('..'+path.sep));
 const privateRoot=value=>{if(typeof value!=='string'||!path.isAbsolute(value))fail();requirePrivateEvidence(value);const actual=fs.realpathSync.native(value);if(actual!==value||!outside(path.relative(project,actual))||!outside(path.relative(actual,project)))fail();return actual;};
 const approvals=privateRoot(o.approval_root),journal=privateRoot(o.journal_root);
 if(typeof o.approval_file!=='string'||!/^oauth-pilot-[a-f0-9-]{36}\.json$/.test(o.approval_file))fail();
 const key=crypto.createPublicKey(o.public_key_pem);if(key.asymmetricKeyType!=='ed25519'||H(key.export({type:'spki',format:'der'}))!==o.public_key_sha256)fail();
 const read=()=>readPinned(approvals,o.approval_file,o.approval_sha256),envelope=fields(parseBumbleJSON(new TextDecoder('utf-8',{fatal:true}).decode(read())),['payload','signature']);
 if(typeof envelope.payload!=='string'||Buffer.byteLength(envelope.payload)>60000||typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))fail();
 const signature=Buffer.from(envelope.signature,'base64url');if(signature.length!==64||signature.toString('base64url')!==envelope.signature||!crypto.verify(null,Buffer.from(envelope.payload),key,signature))fail();
 const p=fields(parseBumbleJSON(envelope.payload),['schema','authorization_id','issued_at','expires_at','run_id','endpoint_id','baseline_report_sha256','input_sha256','request_sha256','profile_sha256','config','config_sha256','model','role','role_version','coordinator_sha256','executor_sha256','manifest_sha256','files','capacity_configuration_sha256','operator_reconciliation_sha256','disclosure','max_requests','max_tokens','deadline_ms']);
 if(p.schema!=='momm-bumble-oauth-pilot-approval/1'||typeof p.authorization_id!=='string'||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(p.authorization_id)||o.approval_file!==`oauth-pilot-${p.authorization_id}.json`||typeof p.run_id!=='string'||!/^rev_[A-Za-z0-9_]{1,124}$/.test(p.run_id)||typeof p.endpoint_id!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(p.endpoint_id)||!UINT(p.issued_at)||!UINT(p.expires_at)||p.expires_at<=p.issued_at||p.expires_at-p.issued_at>3600000||p.max_requests!==1||p.max_tokens!==1024||p.deadline_ms!==180000||p.disclosure!=='reviewed_baseline_only'||!['baseline_report_sha256','input_sha256','request_sha256','profile_sha256','config_sha256','coordinator_sha256','executor_sha256','manifest_sha256','capacity_configuration_sha256','operator_reconciliation_sha256'].every(k=>SHA(p[k])))fail();
 const config=Object.freeze(fields(p.config,CONFIG));if(H(JSON.stringify(config))!==p.config_sha256||config.baseline_report_sha256!==p.baseline_report_sha256||CONFIG.filter(k=>k.endsWith('sha256')||k==='scope_binding').some(k=>!SHA(config[k])))fail();
 if(typeof config.base_url!=='string'||config.base_url.length>2000||typeof config.server_name!=='string'||config.server_name.length<1||config.server_name.length>253||!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(config.server_name))fail();
 let endpoint;try{endpoint=new URL(config.base_url);}catch{fail();}
 const address=endpoint.hostname.split('.').map(Number);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/v1'||net.isIP(endpoint.hostname)!==4||address[0]!==100||address[1]<64||address[1]>127)fail();
 let previous=Date.now(),burned=false;const beganMono=performance.now(),beganWall=previous;
 const current=()=>{const now=Date.now();if(burned||now<previous||now<p.issued_at||now>=p.expires_at||performance.now()-beganMono>=p.expires_at-beganWall){burned=true;fail();}previous=now;read();requirePrivateEvidence(journal);if(fs.existsSync(path.join(approvals,`revoked-${p.authorization_id}.json`))||H(fs.readFileSync(fileURLToPath(import.meta.url)))!==p.coordinator_sha256||H(fs.readFileSync(path.join(directory,'bumble-protected-execution.mjs')))!==p.executor_sha256||o.capacity.summary().configuration_sha256!==p.capacity_configuration_sha256)fail();o.capacity.endpointGroups(p.endpoint_id);};
 current();
 const baseline=openBumbleBaseline({project_root:project,run_id:p.run_id});
 if(baseline.report_sha256!==p.baseline_report_sha256||baseline.input_sha256!==p.input_sha256)fail();
 const source=materialForBumbleStage(baseline).source,input=Object.freeze({artifact:source,model:p.model,role:p.role,role_version:p.role_version,max_tokens:p.max_tokens}),request=prepareBumbleOAuthPeerContract(input);
 if(request.request_sha256!==p.request_sha256)fail();
 const executor=captureBumbleOAuthWorker({source_root:directory,files:p.files,manifest_sha256:p.manifest_sha256,runProcess:o.runProcess});
 const authorization_sha256=H(p.authorization_id),binding=Buffer.from(JSON.stringify({schema:'momm-bumble-oauth-pilot-binding/1',payload_sha256:H(envelope.payload),public_key_sha256:o.public_key_sha256})+'\n'),bindingName=`oauth-binding-${p.authorization_id}.json`,bindingFile=path.join(journal,bindingName);
 if(fs.existsSync(bindingFile)){if(!readPinned(journal,bindingName,H(binding)).equals(binding))fail();}else publishImmutableBytes(journal,bindingFile,binding);
 let dispatched=false;
 return Object.freeze({
  readiness(){current();materialForBumbleStage(baseline);return Object.freeze({schema:'momm-bumble-oauth-pilot/1',authentication:'oauth-bearer',protected_execution:'captured_pinned_graph',baseline_report_sha256:baseline.report_sha256,request_sha256:request.request_sha256,manifest_sha256:executor.manifest_sha256,native_active:false,owner_host_qualification:'external_prerequisite',quorum_votes:0,completion:false});},
  async dispatch(){
   const at=Date.now(),mono=performance.now(),deadline=Math.min(at+180000,p.expires_at);current();materialForBumbleStage(baseline);if(dispatched)fail();dispatched=true;
   publishImmutableBytes(journal,path.join(journal,`oauth-claim-${p.authorization_id}.json`),Buffer.from(JSON.stringify({schema:'momm-bumble-oauth-pilot-claim/1',authorization_sha256,baseline_report_sha256:baseline.report_sha256,request_sha256:request.request_sha256,claimed_at:at,deadline})+'\n'));
   const remaining=()=>Math.min(deadline-Date.now(),180000-(performance.now()-mono));
   const check=()=>{current();materialForBumbleStage(baseline);if(remaining()<=0)fail();};check();
   const worker_binding=H(JSON.stringify([request.request_sha256,p.profile_sha256,p.config_sha256,p.manifest_sha256,p.operator_reconciliation_sha256])),task_id=crypto.randomUUID();
   const budget={schema:'momm-bumble-admission-budget/1',authorization_sha256,configuration_sha256:p.capacity_configuration_sha256,max_attempts:1,max_reserved_tokens:1024,max_completion_tokens:1024,max_outstanding:1,expires_at:p.expires_at};
   const r=o.capacity.reserve({endpoint_id:p.endpoint_id,run_id:p.run_id,task_id,worker_binding,max_tokens:1024,deadline,now:Date.now(),admission_budget:budget});
   if(!r.admitted)return {status:'not_dispatched',reason:'shared_capacity_or_budget',dispatched:0,quorum_votes:0,completion:false};
   let started;
   try{started=startAttempt(project,{run_id:p.run_id,route:'bumble-oauth-pilot',piece:'whole',ordinal:1,started_at:new Date().toISOString(),baseline_report_sha256:baseline.report_sha256,input_sha256:p.input_sha256,request_sha256:request.request_sha256,approval_sha256:o.approval_sha256,reservation_id:r.reservation_id,task_id,worker_binding,deadline,max_tokens:1024,quorum_votes:0});}
   catch{return {status:'attempt_evidence_failed',dispatched:0,reservation_held:true,quorum_votes:0,completion:false};}
   let execution=null,spawned=0,privateBytes=null,handoff=null;
   try{
    check();o.capacity.markTransmissionPossible(r.reservation_id,Date.now());check();
    const c=Object.freeze({...config,attempt_id:started.attempt_id,deadline}),configHash=H(JSON.stringify(c));
    const authorize=q=>{check();if(q.config_sha256!==configHash||q.request_sha256!==request.request_sha256||q.scope_binding!==config.scope_binding||q.deadline!==deadline)fail();return {schema:'momm-bumble-oauth-peer-approval/1',config_sha256:configHash,request_sha256:request.request_sha256,scope_binding:config.scope_binding,policy_sha256:config.policy_sha256,trust_sha256:config.trust_sha256,disclosure_sha256:config.disclosure_sha256,logging_sha256:config.logging_sha256,valid_until:p.expires_at};};
    // The trusted host must supply already-consented short-lived vault material
    // synchronously. The host owns/clears its vault buffers; seal borrows and
    // copies them. No file reads or login are hidden in this path.
    const material=o.getPrivateMaterial(Object.freeze({authorization_sha256,profile_sha256:p.profile_sha256,request_sha256:request.request_sha256,attempt_id:started.attempt_id,deadline}));
    handoff=sealBumbleOAuthPeerHandoff(input,c,material,authorize);check();privateBytes=takeBumbleOAuthPeerHandoff(handoff).bytes;check();const timeoutMs=Math.floor(remaining());if(timeoutMs<1)fail();spawned=1;
    execution=await executor.execute(privateBytes,{timeoutMs});
   }catch{/* Any post-reservation failure retains its original hold. */}
   finally{privateBytes?.fill(0);if(handoff)try{discardBumbleOAuthPeerHandoff(handoff);}catch{/* Never mask an original failure. */}}
   let envelope=null;
   if(execution?.code===0&&!execution.timedOut&&!execution.outputLimited&&typeof execution.stdout==='string'&&Buffer.byteLength(execution.stdout)<=100000)try{const v=parseBumbleJSON(execution.stdout);if(validWorkerResult(v,started.attempt_id))envelope=v;}catch{}
   let currentAfter=true;try{check();}catch{currentAfter=false;}
   if(!envelope||!currentAfter)envelope={transport:'outcome_unknown',payload:remaining()<=0?'deadline':'unavailable',finished:false,content:null};
   let result={status:envelope.transport,review:null,gates:{transport:false,json:false,schema:false,scope:false,finding_accuracy:'unverified'},quorum_votes:0,completion:false};
   if(envelope.transport==='success'&&envelope.payload==='envelope_valid')try{result=validateBumblePeerContent(envelope.content,source,envelope.finished);}catch{result={...result,status:'invalid_output'};}
   const status=result.status==='advisory_valid'?'success':envelope.transport==='authentication_required'?'authentication_required':envelope.transport==='success'?'invalid_output':'error';
   let evidence=null;try{
    evidence=persistAttempt(project,{schema:'momm-attempt/1',run_id:p.run_id,attempt_id:started.attempt_id,route:'bumble-oauth-pilot',piece:'whole',ordinal:1,task_id,reservation_id:r.reservation_id,baseline_report_sha256:baseline.report_sha256,input_sha256:p.input_sha256,request_sha256:request.request_sha256,approval_sha256:o.approval_sha256,worker_binding,deadline,status,outcome:status==='success'?'succeeded':status==='authentication_required'?'authentication_required':status==='invalid_output'?'invalid_output':'failed',original_transport:envelope.transport,original_payload:envelope.payload,finished_at:new Date().toISOString(),content:envelope.content,review:result.review,gates:result.gates,usage:envelope.reported_usage??null,raw_envelope_sha256:envelope.raw_envelope_sha256??null,automatic_retries:0,quorum_votes:0,completion:false});
    // A conservative possible-transmission mark is never converted to unsent,
    // and this coordinator never invokes reconcileRelease.
    const summary=o.capacity.summary().reservations.find(v=>v.id===r.reservation_id);
    if(summary?.transmission_possible)o.capacity.terminal(r.reservation_id,{transport:envelope.transport==='success'?'success':envelope.transport==='authentication_required'||envelope.transport==='refused'?'refused':'outcome_unknown',payload:remaining()<=0?'stale':envelope.transport==='success'?(status==='success'?'valid':'invalid'):'unavailable',now:Date.now()});
    return {...result,status,dispatched:spawned,attempt_id:started.attempt_id,evidence,reservation_held:true,physical_release:'not_verified',automatic_retries:0,quorum_votes:0,completion:false};
   }catch{return {status:'evidence_or_capacity_reconciliation_required',dispatched:spawned,attempt_id:started.attempt_id,evidence,reservation_held:true,remote_outcome:'unknown',quorum_votes:0,completion:false};}
  }
 });
}
