// Governor-owned supplementary stage. Baseline reports seal before any worker task.
// This store does not grant credential policy, release votes or source-write authority.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {preparePrivateEvidence,requirePrivateEvidence} from './evidence-permissions.mjs';
import {BumblePlan} from './bumble-plan.mjs';
import {BumbleCapacity} from './bumble-capacity.mjs';
import {makeBumbleTask,validateBumbleResponse,retainCandidates,parseBumbleJSON} from './bumble-contract.mjs';
import {qualificationBinding} from './bumble-qualification.mjs';
import {qualificationStatusWithLedger} from './bumble-qualification-ledger.mjs';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const encode=value=>JSON.stringify(value);
const clone=value=>JSON.parse(encode(value));
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const finiteTime=value=>Number.isSafeInteger(value)&&value>=0;
const settledAttempt=state=>state==='terminal'||state==='admission_denied';
const ROUTES=new Set(['codex','claude','antigravity','copilot','grok','gemini']);
const MAX_BYTES=4_000_000;
function outside(project,target){const relative=path.relative(project,target);return Boolean(relative)&&(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep));}
function baselineValue(bytes,source){
  if(!(bytes instanceof Uint8Array)||bytes.length>MAX_BYTES||typeof source!=='string'||Buffer.byteLength(source)>1_000_000)throw Error('Invalid bounded whole-piece baseline.');
  let report;try{report=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('Invalid whole-piece baseline bytes.');}
  const required=report.gate_policy?.quorum_required;
  if(!identity(report.run_id)||!ROUTES.has(report.governor)||!Number.isSafeInteger(required)||required<2||required>ROUTES.size-1||report.quorum?.met!==true||report.quorum.required!==required||report.input_sha256!==sha(source)||report.input_bytes!==Buffer.byteLength(source)||Object.hasOwn(report,'bumble_candidates'))throw Error('Independent whole-piece baseline is not complete or source-bound.');
  const independent=routes=>new Set(routes.filter(route=>ROUTES.has(route)&&route!==report.governor)).size;
  if(report.split){
    const pieces=report.split.pieces;
    if(!Array.isArray(pieces)||!pieces.length||pieces.length>1000||report.split.governor_direct?.length||new Set(pieces.map(p=>p.id)).size!==pieces.length||pieces.some(p=>!identity(p.id)||p.quorum_met!==true||independent(Object.entries(p.reviewers||{}).filter(([,status])=>status==='success').map(([route])=>route))<required))throw Error('Every whole piece needs its original independent reports sealed first.');
  }else if(!Array.isArray(report.reviewers)||independent(report.reviewers.filter(r=>r.status==='success').map(r=>r.agent))<required)throw Error('Original independent reports are missing.');
  return {run_id:report.run_id,governor:report.governor,required,source_sha256:sha(source),baseline_sha256:sha(bytes),pieces:report.split?report.split.pieces.map(p=>p.id):['whole']};
}

export class BumbleStage {
  #root;#file;#source;#baseline;#limits;#frame;#capacity;#capacityBinding;
  constructor({root,project_root=process.cwd(),source,baseline_bytes,limits,task_frame,capacity}){
    if(!(capacity instanceof BumbleCapacity))throw Error('The owner-global physical capacity ledger is required.');
    this.#capacity=capacity;this.#capacityBinding=capacity.summary().configuration_sha256;
    if(!path.isAbsolute(root))throw Error('A private absolute supplementary-stage home is required.');
    const project=fs.realpathSync(project_root),literal=path.resolve(root);
    if(!outside(project,literal))throw Error('Supplementary evidence belongs outside project source.');
    // Resolve an existing parent before creation, not after a symlink could create project files.
    const ancestor=fs.existsSync(literal)?literal:path.dirname(literal);
    if(!outside(project,fs.realpathSync(ancestor)))throw Error('Supplementary store parent resolves inside project source.');
    this.#baseline=baselineValue(baseline_bytes,source);this.#source=source;
    const plan=new BumblePlan(limits);this.#limits=clone(plan.snapshot());
    if(plan.limits.max_tasks>1000||plan.limits.minimum_negatives<1||plan.negative_ids.size<plan.limits.minimum_negatives)throw Error('Supplementary task budget or precommitted negative audit is invalid.');
    if(!Array.isArray(task_frame)||!task_frame.length||task_frame.length>plan.limits.max_tasks||new Set(task_frame.map(f=>f.id)).size!==task_frame.length)throw Error('Invalid precommitted supplementary task frame.');
    this.#frame=task_frame.map(f=>{
      if(!identity(f.id)||!f.task)throw Error('Invalid precommitted task identity.');
      const task=makeBumbleTask(f.task);
      if(task.run_id!==this.#baseline.run_id||!this.#baseline.pieces.includes(task.piece_id)||!source.includes(task.source)||task.deadline>plan.limits.deadline)throw Error('Precommitted task is outside the sealed source or deadline.');
      return {id:f.id,task:Object.fromEntries(Object.entries(task).filter(([key])=>!['task_id','attempt_id'].includes(key)))};
    });
    if(new Set(this.#frame.map(f=>sha(encode(f.task)))).size!==this.#frame.length||plan.negative_ids.size&&[...plan.negative_ids].some(id=>!this.#frame.some(f=>f.id===id)))throw Error('Duplicated task content or unbound negative audit frame.');
    preparePrivateEvidence(literal);this.#root=fs.realpathSync(literal);this.#file=path.join(this.#root,'stage.json');
    if(!outside(project,this.#root))throw Error('Supplementary evidence resolves inside project source.');
    this.#locked(()=>{
      const baselineFile=path.join(this.#root,'baseline.json');
      if(!fs.existsSync(baselineFile))this.#exclusiveFile(baselineFile,baseline_bytes);
      else if(sha(this.#regularBytes(baselineFile))!==this.#baseline.baseline_sha256)throw Error('Sealed baseline changed; original retained.');
      if(!fs.existsSync(this.#file))this.#save({schema:'momm-bumble-stage/1',capacity_binding:this.#capacityBinding,baseline:this.#baseline,task_frame:this.#frame,plan:this.#limits,attempts:[],raw_bytes:0,investigations:[]});
      this.#read();
    });
  }
  #regularBytes(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)throw Error('Supplementary store is not a bounded private regular file.');return fs.readFileSync(file);}
  #exclusiveFile(file,bytes){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  #locked(fn){
    requirePrivateEvidence(this.#root);const lock=path.join(this.#root,'writer.lock');let fd;
    try{fd=fs.openSync(lock,'wx',0o600);}catch{throw Error('Supplementary stage is busy; no lock is removed automatically.');}
    let own;try{own=fs.fstatSync(fd,{bigint:true});}catch(error){
      // The descriptor is ours, but the unverified lock name is not safe to
      // remove. Close once and preserve that name for explicit reconciliation.
      try{fs.closeSync(fd);}catch{/* Close outcome remains uncertain; no retry. */}
      throw Error('Supplementary lock identity requires reconciliation; lock retained.',{cause:error});
    }
    let value,error;
    try{value=fn();}catch(e){error=e;}
    let cleanup=false;
    try{const stat=fs.lstatSync(lock,{bigint:true});if(stat.ino!==own.ino||(process.platform!=='win32'&&stat.dev!==own.dev)||stat.nlink!==1n||stat.isSymbolicLink())throw Error('Lock identity changed.');fs.unlinkSync(lock);}catch{cleanup=true;}
    try{fs.closeSync(fd);}catch{cleanup=true;}
    if(error)throw error;if(cleanup)throw Error('Supplementary write outcome requires reconciliation; lock retained.');return value;
  }
  #read(){
    requirePrivateEvidence(this.#root);
    const state=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(this.#regularBytes(this.#file)));
    const global=this.#capacity.summary();
    if(state.capacity_binding!==this.#capacityBinding||global.configuration_sha256!==this.#capacityBinding)throw Error('Owner-global capacity binding changed.');
    if(state.schema!=='momm-bumble-stage/1'||encode(state.baseline)!==encode(this.#baseline)||encode(state.task_frame)!==encode(this.#frame)||!Array.isArray(state.attempts)||state.attempts.length>this.#limits.limits.max_tasks||!Number.isSafeInteger(state.raw_bytes)||state.raw_bytes<0||state.attempts.some(a=>!identity(a.reservation_id)||!identity(a.check_id)||!hash(a.identity_binding)||!hash(a.scope_binding)||!a.task||!['admitting','admission_denied','reserved','transmission_possible','terminal'].includes(a.state))||new Set(state.attempts.map(a=>a.reservation_id)).size!==state.attempts.length)throw Error('Supplementary state binding or structure changed.');
    const plan=new BumblePlan({...this.#limits.limits,negative_ids:this.#limits.negative_ids},state.plan);
    if(!Array.isArray(state.investigations)||state.investigations.length!==plan.state.investigations||new Set(state.investigations).size!==state.investigations.length||!state.investigations.every(hash))throw Error('Supplementary investigation accounting changed.');
    if(plan.state.reservations.length!==state.attempts.length||state.attempts.some(a=>!plan.state.reservations.some(r=>r.id===a.reservation_id&&r.task_id===a.check_id)))throw Error('Supplementary attempt/reservation mismatch.');
    if(state.attempts.some(a=>!['admitting','admission_denied'].includes(a.state)&&!global.reservations.some(r=>r.id===a.capacity_reservation_id&&r.run_id===this.#baseline.run_id&&r.task_id===a.task.task_id&&r.worker_binding===a.identity_binding)))throw Error('Original global reservation is missing or mismatched.');
    for(const a of state.attempts){
      if(['admitting','admission_denied'].includes(a.state)&&!Object.hasOwn(a,'admission_request'))throw Error('Original admission metadata is missing; no inferred recovery.');
      if(Object.hasOwn(a,'admission_request')){
        // Historical pre-intent interruption: retain the exact pending attempt
        // and expose inspection/reconciliation, never recreate proof or admit.
        if(a.state==='admitting'&&!fs.existsSync(this.#admissionPath(a))){
          this.#admissionExpected(a);
          if(a.capacity_reservation_id!==null)throw Error('Pending admission cannot claim a capacity identity.');
          continue;
        }
        const intent=this.#readAdmission(a),r=this.#matchAdmission(intent,global);
        if(a.state==='admitting'&&a.capacity_reservation_id!==null)throw Error('Pending admission cannot claim a capacity identity.');
        if(a.state==='admission_denied'){
          if(r||a.capacity_reservation_id!==null||this.#readDenied(a).sha256!==a.admission_denied_sha256)throw Error('Denied admission conflicts with original capacity.');
          const event=plan.state.attempts.find(e=>e.event==='terminal'&&e.reservation_id===a.reservation_id);
          if(!event||event.outcome!=='known_not_sent'||event.bytes!==0||event.candidates!==0||event.remote_release_verified!==false)throw Error('Denied admission accounting changed.');
        }else if(a.state!=='admitting'&&(!r||r.id!==a.capacity_reservation_id))throw Error('Original admission capacity changed.');
      }
    }
    for(const a of state.attempts)if(a.state==='terminal'&&(!hash(a.result_sha256)||sha(this.#regularBytes(path.join(this.#root,`result-${a.reservation_id}.json`)))!==a.result_sha256))throw Error('Original supplementary result changed; reconciliation required.');
    for(const a of state.attempts)if(a.state==='terminal'&&Object.hasOwn(a,'terminal_intent_sha256')&&(!hash(a.terminal_intent_sha256)||sha(this.#regularBytes(this.#intentPath(a)))!==a.terminal_intent_sha256))throw Error('Original terminal intent changed; reconciliation required.');
    for(const a of state.attempts)if(Object.hasOwn(a,'transmission_intent_sha256')&&(!hash(a.transmission_intent_sha256)||sha(this.#regularBytes(this.#transmissionPath(a)))!==a.transmission_intent_sha256))throw Error('Original transmission intent changed; reconciliation required.');
    let physical_release_pending=0;const physical_release_pending_reservations=[];
    for(const a of state.attempts){
      const physical=global.reservations.find(r=>r.id===a.capacity_reservation_id),events=plan.state.attempts.filter(e=>e.event==='physical_release'&&e.reservation_id===a.reservation_id);
      if(Object.hasOwn(a,'physical_release')){
        const p=a.physical_release,expected=this.#physicalReleaseExpected(a,physical),bytes=this.#regularBytes(this.#physicalReleasePath(a));
        if(a.state!=='terminal'||!p||Object.keys(p).sort().join(',')!=='intent_sha256,receipt_sha256,recorded_at'||p.receipt_sha256!==expected.receipt_sha256||p.recorded_at!==expected.recorded_at||p.intent_sha256!==sha(bytes)||encode(parseBumbleJSON(bytes.toString('utf8')))!==encode(expected)||events.length!==1||events[0].receipt_sha256!==p.receipt_sha256||events[0].at!==p.recorded_at)throw Error('Original cross-store release changed; reconciliation required.');
      }else{
        if(events.length)throw Error('Unbacked local release event; reconciliation required.');
        if(physical?.physical_release){physical_release_pending++;physical_release_pending_reservations.push({reservation_id:a.reservation_id,capacity_reservation_id:a.capacity_reservation_id});}
      }
    }
    return {state,plan,physical_release_pending,physical_release_pending_reservations};
  }
  #save(state){
    const bytes=Buffer.from(encode(state)+'\n');if(bytes.length>MAX_BYTES)throw Error('Supplementary storage budget exhausted. No dispatch authorized.');
    const temporary=path.join(this.#root,`stage-${crypto.randomUUID()}.tmp`);
    try{this.#exclusiveFile(temporary,bytes);requirePrivateEvidence(this.#root);fs.renameSync(temporary,this.#file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  #resultPath(a){return path.join(this.#root,`result-${a.reservation_id}.json`);}
  #intentPath(a){return path.join(this.#root,`terminal-intent-${a.reservation_id}.json`);}
  #hasTerminalEvidence(a){return fs.existsSync(this.#intentPath(a))||fs.existsSync(this.#resultPath(a));}
  #transmissionPath(a){return path.join(this.#root,`transmission-intent-${a.reservation_id}.json`);}
  #admissionPath(a){return path.join(this.#root,`admission-intent-${a.reservation_id}.json`);}
  #deniedPath(a){return path.join(this.#root,`admission-denied-${a.reservation_id}.json`);}
  #physicalReleasePath(a){return path.join(this.#root,`physical-release-${a.reservation_id}.json`);}
  #physicalReleaseExpected(a,r){
    // capacity.summary has already revalidated the pinned-host signature and
    // original reservation binding. Its timestamp is retained, not reminted.
    if(!r||!r.transmission_possible||!r.released||!r.terminal||!r.physical_release||r.id!==a.capacity_reservation_id||r.run_id!==this.#baseline.run_id||r.task_id!==a.task.task_id||r.worker_binding!==a.identity_binding||!hash(a.result_sha256)||!hash(a.terminal_intent_sha256))throw Error('Exact verified global physical release is required.');
    return {schema:'momm-bumble-stage-physical-release/1',reservation_id:a.reservation_id,capacity_reservation_id:r.id,capacity_binding:this.#capacityBinding,baseline_sha256:this.#baseline.baseline_sha256,task_id:a.task.task_id,attempt_id:a.task.attempt_id,result_sha256:a.result_sha256,terminal_intent_sha256:a.terminal_intent_sha256,receipt_sha256:r.physical_release.receipt_sha256,recorded_at:r.physical_release.recorded_at};
  }
  #admissionExpected(a){
    const request=a.admission_request,fields=['endpoint_id','run_id','task_id','worker_binding','max_tokens','deadline','now'];
    const original=this.#frame.find(f=>f.id===a.check_id)?.task;
    const supplied=Object.fromEntries(Object.entries(a.task).filter(([k])=>!['task_id','attempt_id'].includes(k)));
    if(!request||Object.keys(request).sort().join(',')!==fields.sort().join(',')||!original||encode(original)!==encode(supplied)||!hash(a.qualification_sha256)||!identity(request.endpoint_id)||request.run_id!==this.#baseline.run_id||request.task_id!==a.task.task_id||request.worker_binding!==a.identity_binding||request.max_tokens!==Buffer.byteLength(encode(a.task))+a.task.budget.response_bytes+1024||request.deadline!==a.task.deadline||!finiteTime(request.now)||request.now>=request.deadline)throw Error('Original admission request is unbound; reservation stays held.');
    return {schema:'momm-bumble-admission-intent/1',reservation_id:a.reservation_id,capacity_binding:this.#capacityBinding,baseline_sha256:this.#baseline.baseline_sha256,check_id:a.check_id,task_sha256:sha(encode(a.task)),identity_binding:a.identity_binding,scope_binding:a.scope_binding,qualification_sha256:a.qualification_sha256,request:clone(request)};
  }
  #readAdmission(a){
    const bytes=this.#regularBytes(this.#admissionPath(a));
    let intent;try{intent=parseBumbleJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('Original admission intent is incomplete; reservation stays held.');}
    if(!hash(a.admission_intent_sha256)||sha(bytes)!==a.admission_intent_sha256||encode(intent)!==encode(this.#admissionExpected(a)))throw Error('Original admission intent changed; reservation stays held.');return intent;
  }
  #matchAdmission(intent,global=this.#capacity.summary()){
    const q=intent.request,found=global.reservations.filter(r=>r.run_id===q.run_id&&r.task_id===q.task_id);
    if(global.configuration_sha256!==intent.capacity_binding||found.length>1)throw Error('Original admission capacity conflict; reservation stays held.');
    const r=found[0];if(r&&(r.endpoint_id!==q.endpoint_id||r.worker_binding!==q.worker_binding||r.reserved_tokens!==q.max_tokens||r.deadline!==q.deadline||r.reserved_at!==q.now))throw Error('Original admission capacity conflict; reservation stays held.');return r??null;
  }
  #deniedExpected(a){return {schema:'momm-bumble-admission-denied/1',reservation_id:a.reservation_id,admission_intent_sha256:a.admission_intent_sha256,capacity_binding:this.#capacityBinding,at:a.admission_request.now,reason:'global_capacity_or_budget'};}
  #readDenied(a){
    const bytes=this.#regularBytes(this.#deniedPath(a));let record;try{record=parseBumbleJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('Original admission refusal is incomplete; reservation stays held.');}
    if(encode(record)!==encode(this.#deniedExpected(a)))throw Error('Original admission refusal changed; reservation stays held.');return {sha256:sha(bytes)};
  }
  #adoptAdmission(state,plan,a){
    if(!a||!Object.hasOwn(a,'admission_request'))throw Error('Original admission intent is missing; no legacy identity is invented.');
    if(a.state==='admitting'&&!fs.existsSync(this.#admissionPath(a)))return {reconciled:false,admitted:false,reason:'original_admission_intent_missing',dispatch_authorized:false,quorum_votes:0,completion:false};
    const intent=this.#readAdmission(a),physical=this.#matchAdmission(intent);
    if(fs.existsSync(this.#deniedPath(a))){
      const denied=this.#readDenied(a);if(physical)throw Error('Original admission refusal conflicts with a global hold.');
      if(a.state!=='admission_denied'){
        if(a.state!=='admitting')throw Error('Original admission state conflicts with its refusal.');
        plan.terminal(a.reservation_id,'known_not_sent',{remote_release_verified:false,bytes:0,candidates:0});a.state='admission_denied';a.admission_denied_sha256=denied.sha256;state.plan=plan.snapshot();this.#save(state);
      }
      return {reconciled:true,admitted:false,reason:'original_admission_denied',dispatch_authorized:false,quorum_votes:0,completion:false};
    }
    if(!physical)return {reconciled:false,admitted:false,reason:'original_global_admission_absent',dispatch_authorized:false,quorum_votes:0,completion:false};
    if(a.state==='admitting'){
      if(physical.transmission_possible||physical.terminal||physical.released)throw Error('Original admission has conflicting transmission or terminal state; hold retained.');
      a.capacity_reservation_id=physical.id;a.state='reserved';this.#save(state);
    }else if(a.capacity_reservation_id!==physical.id)throw Error('Original capacity identity changed; hold retained.');
    // Adoption restores only the original local/global relation. It never mints
    // another task, changes time/token accounting, clears a hold or permits send.
    return {reconciled:true,admitted:false,reservation_id:a.reservation_id,dispatch_authorized:false,quorum_votes:0,completion:false};
  }
  reconcileAdmission(reservation_id){
    if(!identity(reservation_id))throw Error('Invalid original admission identity.');
    return this.#locked(()=>{const {state,plan}=this.#read(),a=state.attempts.find(a=>a.reservation_id===reservation_id);return this.#adoptAdmission(state,plan,a);});
  }
  #recoverTransmission(state,a){
    if(!a||!['reserved','transmission_possible'].includes(a.state))throw Error('Original attempt cannot reconcile transmission.');
    const bytes=this.#regularBytes(this.#transmissionPath(a)),intent=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const expected={schema:'momm-bumble-transmission-intent/1',reservation_id:a.reservation_id,capacity_reservation_id:a.capacity_reservation_id,capacity_binding:this.#capacityBinding,baseline_sha256:this.#baseline.baseline_sha256,task_id:a.task.task_id,attempt_id:a.task.attempt_id,task_sha256:sha(encode(a.task)),identity_binding:a.identity_binding,scope_binding:a.scope_binding,qualification_sha256:a.qualification_sha256,at:intent?.at};
    if(!intent||Object.keys(intent).sort().join(',')!==Object.keys(expected).sort().join(',')||encode(intent)!==encode(expected)||!finiteTime(intent.at)||intent.at>=a.task.deadline||intent.at>=state.plan.limits.deadline)throw Error('Original transmission intent binding/time changed; reservation stays held.');
    const global=this.#capacity.summary().reservations.find(r=>r.id===a.capacity_reservation_id);
    if(!global||global.run_id!==this.#baseline.run_id||global.task_id!==a.task.task_id||global.worker_binding!==a.identity_binding||intent.at<global.reserved_at)throw Error('Original transmission capacity identity changed; reservation stays held.');
    if(!global.transmission_possible){
      if(a.state!=='reserved'||Object.hasOwn(a,'transmission_intent_sha256')||global.transmission_at!==null)throw Error('Conflicting original transmission state; reservation stays held.');
      return {reconciled:false,reason:'global_mark_absent',transmission_possible:false,dispatch_authorized:false,quorum_votes:0,completion:false};
    }
    if(global.transmission_at!==intent.at||global.released)throw Error('Conflicting original transmission time/release; reservation stays held.');
    if(a.state==='transmission_possible'){
      if(a.possible_at!==intent.at||a.transmission_intent_sha256!==sha(bytes))throw Error('Original local transmission binding changed; reservation stays held.');
    }else{a.state='transmission_possible';a.possible_at=intent.at;a.transmission_intent_sha256=sha(bytes);this.#save(state);}
    // Recovery settles only the original recorded mark. It never returns another
    // send permit, clears a physical hold, changes time or creates a new attempt.
    return {reconciled:true,transmission_possible:true,dispatch_authorized:false,transmission_at:intent.at,quorum_votes:0,completion:false};
  }
  reconcileTransmission(reservation_id){
    if(!identity(reservation_id))throw Error('Invalid original transmission identity.');
    return this.#locked(()=>{const {state}=this.#read(),a=state.attempts.find(a=>a.reservation_id===reservation_id);return this.#recoverTransmission(state,a);});
  }
  #result(a,{raw,transport,finished,now,input_supported,overflow_bytes=0}){
    const neverSent=a.state==='reserved'&&transport==='known_not_sent';
    // For an overflow replay, only the retained prefix survives. One extra byte
    // reproduces the original overflow classification, not the omitted content.
    const checked=overflow_bytes?Buffer.concat([raw,Buffer.alloc(1)]):raw;
    const result=!neverSent&&now>=a.task.deadline?{transport,payload:'stale',result:null,coverage:'unresolved',quorum_votes:0,detail:'Deadline passed; original late transport retained.'}:validateBumbleResponse(a.task,input_supported?checked:undefined,{transport,finished,now});
    return {schema:'momm-bumble-attempt-result/1',reservation_id:a.reservation_id,baseline_sha256:this.#baseline.baseline_sha256,task_id:a.task.task_id,attempt_id:a.task.attempt_id,identity_binding:a.identity_binding,scope_binding:a.scope_binding,at:now,
      ...result,raw_base64:raw.toString('base64'),complete_raw_sha256:overflow_bytes?null:sha(raw),overflow_bytes,
      candidates:result.candidates?retainCandidates(a.task,result.candidates):[],remote_release_verified:false,completion:false};
  }
  #outcome(result){return result.payload==='stale'?'stale':result.transport!=='success'?result.transport:result.payload!=='valid'?'invalid_output':result.result==='no_candidate_in_supplied_scope'?'scoped_negative':result.result;}
  #axes(result){return {transport:result.transport,payload:result.payload==='valid'?'valid':result.payload==='stale'?'stale':result.transport==='success'?'invalid':'unavailable',now:result.at};}
  #legacyBOMRevalidation(a,{intent,intentBytes,raw,rebuilt,result}){
    // Exactly one historical representation difference: TextDecoder stripped
    // the first UTF-8 BOM from the overflow's derived `raw` string. No other
    // field, classification, candidate, count, time or permission may change.
    if(intent.overflow_bytes!==0||raw.length<3||raw[0]!==239||raw[1]!==187||raw[2]!==191||rebuilt.schema!=='momm-bumble-attempt-result/1'||result.schema!==rebuilt.schema||rebuilt.transport!=='success'||rebuilt.payload!=='candidate_overflow'||rebuilt.coverage!=='unresolved'||rebuilt.quorum_votes!==0||rebuilt.remote_release_verified!==false||rebuilt.completion!==false||typeof rebuilt.raw!=='string'||!rebuilt.raw.startsWith('\uFEFF')||result.raw!==rebuilt.raw.slice(1))return null;
    const historical={...rebuilt,raw:rebuilt.raw.slice(1)};
    if(sha(Buffer.from(encode(historical)+'\n'))!==intent.result_sha256||sha(raw)!==intent.input_sha256)return null;
    return {schema:'momm-bumble-revalidation/1',rule:'legacy-v1-overflow-BOM-projection/1',reservation_id:a.reservation_id,task_sha256:sha(encode(a.task)),baseline_sha256:this.#baseline.baseline_sha256,original_result_sha256:intent.result_sha256,original_intent_sha256:sha(intentBytes),original_input_sha256:intent.input_sha256,original_completion_at:intent.axes.now,current_result_sha256:sha(Buffer.from(encode(rebuilt)+'\n')),authoritative_raw:'original raw_base64',classification_changed:false,quorum_votes:0,dispatch_authorized:false,remote_release_verified:false,completion:false};
  }
  #retainRevalidation(a,record){
    const file=path.join(this.#root,`revalidation-${a.reservation_id}.json`),bytes=Buffer.from(encode(record)+'\n');
    if(bytes.length>2048)throw Error('Bounded revalidation metadata exceeded; reservation stays held.');
    // One bounded append-only companion per admitted attempt (max 1,000), not
    // a replacement for the original attempt, result or terminal intent.
    if(fs.existsSync(file)){if(!this.#regularBytes(file).equals(bytes))throw Error('Original revalidation record changed; reservation stays held.');}
    else this.#exclusiveFile(file,bytes);
  }
  #adopt(state,plan,a,caller=null){
    const intentBytes=this.#regularBytes(this.#intentPath(a)),intent=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(intentBytes));
    const fields=['schema','reservation_id','capacity_reservation_id','capacity_binding','baseline_sha256','task_id','attempt_id','identity_binding','scope_binding','qualification_sha256','result_sha256','input_sha256','input_supported','finished','retained_bytes','overflow_bytes','candidate_count','outcome','axes'];
    if(!intent||Object.keys(intent).sort().join(',')!==fields.sort().join(',')||intent.schema!=='momm-bumble-terminal-intent/1'||intent.reservation_id!==a.reservation_id||intent.capacity_reservation_id!==a.capacity_reservation_id||intent.capacity_binding!==this.#capacityBinding||intent.baseline_sha256!==this.#baseline.baseline_sha256||intent.task_id!==a.task.task_id||intent.attempt_id!==a.task.attempt_id||intent.identity_binding!==a.identity_binding||intent.scope_binding!==a.scope_binding||intent.qualification_sha256!==a.qualification_sha256||!hash(intent.result_sha256)||!hash(intent.input_sha256)||typeof intent.input_supported!=='boolean'||typeof intent.finished!=='boolean'||!Number.isSafeInteger(intent.retained_bytes)||intent.retained_bytes<0||intent.retained_bytes>a.task.budget.response_bytes||!Number.isSafeInteger(intent.overflow_bytes)||intent.overflow_bytes<0||!Number.isSafeInteger(intent.candidate_count)||intent.candidate_count<0||!intent.axes||Object.keys(intent.axes).sort().join(',')!=='now,payload,transport'||!finiteTime(intent.axes.now))throw Error('Original terminal intent is unbound or invalid; reservation stays held.');
    if(caller&&(caller.transport!==intent.axes.transport||sha(caller.raw)!==intent.input_sha256||caller.input_supported!==intent.input_supported||caller.finished!==intent.finished))throw Error('Recovery cannot replace the original response or terminal axes.');
    if(!fs.existsSync(this.#resultPath(a))&&caller){
      // Only the exact original input can materialize an absent result. Its
      // original intent time and result digest stay authoritative; no model
      // request, replacement, send permit or physical release is performed.
      const raw=caller.raw.subarray(0,a.task.budget.response_bytes);
      const rebuilt=this.#result(a,{raw,transport:intent.axes.transport,finished:intent.finished,now:intent.axes.now,input_supported:intent.input_supported,overflow_bytes:caller.raw.length-raw.length});
      const bytes=Buffer.from(encode(rebuilt)+'\n');
      if(bytes.length>MAX_BYTES||sha(bytes)!==intent.result_sha256||raw.length!==intent.retained_bytes||caller.raw.length-raw.length!==intent.overflow_bytes)throw Error('Missing original result cannot be reconstructed exactly; reservation stays held.');
      this.#exclusiveFile(this.#resultPath(a),bytes);
    }
    const original=this.#regularBytes(this.#resultPath(a));
    if(sha(original)!==intent.result_sha256)throw Error('Original result digest changed; reservation stays held.');
    const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));
    if(typeof result.raw_base64!=='string'||Buffer.byteLength(result.raw_base64)>Math.ceil(a.task.budget.response_bytes/3)*4)throw Error('Original retained response is invalid.');
    const raw=Buffer.from(result.raw_base64,'base64');
    if(raw.toString('base64')!==result.raw_base64||raw.length!==intent.retained_bytes)throw Error('Original retained response accounting changed.');
    // Rebuild the trusted classification from the original task/time/prefix.
    // A model field cannot create an outcome, release flag, count or vote.
    const priorState=a.state==='terminal'?(intent.axes.transport==='known_not_sent'?'reserved':'transmission_possible'):a.state;
    const rebuilt=this.#result({...a,state:priorState},{raw,transport:intent.axes.transport,finished:intent.finished,now:intent.axes.now,input_supported:intent.input_supported,overflow_bytes:intent.overflow_bytes});
    const axes=this.#axes(rebuilt),candidateCount=rebuilt.candidates.reduce((n,c)=>n+c.originals.length,0),outcome=this.#outcome(rebuilt);
    const exact=sha(Buffer.from(encode(rebuilt)+'\n'))===intent.result_sha256;
    const revalidation=exact?null:this.#legacyBOMRevalidation(a,{intent,intentBytes,raw,rebuilt,result});
    if((!exact&&!revalidation)||encode(axes)!==encode(intent.axes)||outcome!==intent.outcome||candidateCount!==intent.candidate_count||(!intent.overflow_bytes&&sha(raw)!==intent.input_sha256))throw Error('Original result does not match trusted task classification/accounting.');
    let global=this.#capacity.summary().reservations.find(r=>r.id===a.capacity_reservation_id);
    if(!global||global.run_id!==this.#baseline.run_id||global.task_id!==a.task.task_id||global.worker_binding!==a.identity_binding)throw Error('Original capacity identity is missing or changed.');
    const expected={transport:axes.transport,payload:axes.payload,at:axes.now};
    const agrees=r=>r&&encode(r.terminal)===encode(expected)&&(r.released===(axes.transport==='known_not_sent')||(axes.transport!=='known_not_sent'&&r.released===true&&Boolean(r.physical_release)));
    if(global.terminal&&!agrees(global))throw Error('Conflicting original global terminal; reservation stays held.');
    if(revalidation)this.#retainRevalidation(a,revalidation);
    const originalResult=()=>revalidation?{...clone(result),revalidation:clone(revalidation)}:clone(result);
    if(a.state==='terminal'){
      const event=plan.state.attempts.find(e=>e.event==='terminal'&&e.reservation_id===a.reservation_id);
      if(a.result_sha256!==intent.result_sha256||a.terminal_intent_sha256!==sha(intentBytes)||!agrees(global)||!event||event.outcome!==outcome||event.bytes!==raw.length||event.candidates!==candidateCount||event.remote_release_verified!==(axes.transport==='known_not_sent'))throw Error('Terminal reconciliation accounting changed.');
      return originalResult(); // already adopted: no new write, charge or vote
    }
    if(!['reserved','transmission_possible'].includes(a.state))throw Error('Attempt cannot adopt an original result.');
    if(!global.terminal){
      try{this.#capacity.terminal(a.capacity_reservation_id,axes);}catch(error){
        // A failed commit/cleanup can have landed. Accept only the exact original
        // terminal, never a new time or a guessed physical release.
        global=this.#capacity.summary().reservations.find(r=>r.id===a.capacity_reservation_id);
        if(!agrees(global))throw error;
      }
    }
    plan.terminal(a.reservation_id,outcome,{remote_release_verified:axes.transport==='known_not_sent',bytes:raw.length,candidates:candidateCount});
    a.state='terminal';a.result_sha256=intent.result_sha256;a.terminal_intent_sha256=sha(intentBytes);state.raw_bytes+=raw.length;state.plan=plan.snapshot();this.#save(state);
    return originalResult();
  }
  reconcile(reservation_id){
    if(!identity(reservation_id))throw Error('Invalid original reservation identity.');
    return this.#locked(()=>{const {state,plan}=this.#read(),a=state.attempts.find(a=>a.reservation_id===reservation_id);if(!a)throw Error('Original stage attempt is missing.');return this.#adopt(state,plan,a);});
  }
  reconcilePhysicalRelease(reservation_id,receipt=undefined){
    if(!identity(reservation_id))throw Error('Invalid original release identity.');
    return this.#locked(()=>{
      const {state,plan}=this.#read(),a=state.attempts.find(a=>a.reservation_id===reservation_id);
      if(!a||a.state!=='terminal')throw Error('Reconcile the original terminal result before physical release.');
      this.#adopt(state,plan,a); // revalidate unchanged result, intent and terminal axes
      const priorPhysical=this.#capacity.summary().reservations.find(r=>r.id===a.capacity_reservation_id),file=this.#physicalReleasePath(a);
      // This method publishes a local intent only after the exact global proof.
      // An existing intent without that proof is therefore a conflict, not a
      // reason to commit a fresh global release and leave an unadoptable store.
      if(!priorPhysical?.physical_release&&fs.existsSync(file))throw Error('Original local release intent conflicts with uncommitted global release; no new global release committed.');
      // Legacy stores may predate admission headroom for release adoption. Check
      // the worst-case local representation BEFORE committing any new global
      // release proof. An externally committed release still remains pending.
      if(!Object.hasOwn(a,'physical_release'))this.#releaseStorageHeadroom(state,a.reservation_id);
      if(receipt!==undefined)this.#capacity.reconcileRelease(a.capacity_reservation_id,receipt);
      const physical=this.#capacity.summary().reservations.find(r=>r.id===a.capacity_reservation_id),expected=this.#physicalReleaseExpected(a,physical),bytes=Buffer.from(encode(expected)+'\n');
      if(Object.hasOwn(a,'physical_release'))return {reconciled:true,released:true,recorded:false,dispatch_authorized:false,quorum_votes:0,completion:false};
      if(fs.existsSync(file)){if(!this.#regularBytes(file).equals(bytes))throw Error('Original release intent conflicts; no replacement or admission.');}
      else this.#exclusiveFile(file,bytes);
      plan.adoptPhysicalRelease(a.reservation_id,{receipt_sha256:expected.receipt_sha256,at:expected.recorded_at});
      a.physical_release={receipt_sha256:expected.receipt_sha256,recorded_at:expected.recorded_at,intent_sha256:sha(bytes)};state.plan=plan.snapshot();this.#save(state);
      return {reconciled:true,released:true,recorded:true,dispatch_authorized:false,quorum_votes:0,completion:false};
    });
  }
  #sizePhysicalReleases(image,target_reservation_id=null){
    // Sizing only: never persist this synthetic image as proof or history.
    for(const a of image.attempts){
      if(target_reservation_id!==null&&a.reservation_id!==target_reservation_id)continue;
      const r=image.plan.state.reservations.find(r=>r.id===a.reservation_id);
      if(a.state==='admission_denied'||a.physical_release||!r||r.released)continue;
      a.physical_release={receipt_sha256:'f'.repeat(64),recorded_at:Number.MAX_SAFE_INTEGER,intent_sha256:'f'.repeat(64)};
      image.plan.state.attempts.push({event:'physical_release',reservation_id:a.reservation_id,receipt_sha256:'f'.repeat(64),at:Number.MAX_SAFE_INTEGER});r.released=true;
    }
  }
  #releaseStorageHeadroom(state,reservation_id){
    const future=clone(state);this.#sizePhysicalReleases(future,reservation_id);
    if(Buffer.byteLength(encode(future)+'\n')>MAX_BYTES)throw Error('Supplementary release storage headroom exhausted. No new global release committed.');
  }
  #terminalHeadroom(state){
    // Bound the serialized future representation, not just the admission bytes.
    // This is an upper-bound sizing image, never a fabricated history written
    // to disk. Max-safe integers cover every permitted accounting/time spelling.
    const future=clone(state),pending=future.attempts.filter(a=>!settledAttempt(a.state));
    let possibleCandidateBytes=state.plan.state.candidates;
    for(const a of pending){
      possibleCandidateBytes+=a.task.budget.response_bytes;
      a.capacity_reservation_id='00000000-0000-4000-8000-000000000000';
      a.state='transmission_possible';a.possible_at=Number.MAX_SAFE_INTEGER;
      for(const key of ['result_sha256','terminal_intent_sha256','transmission_intent_sha256','admission_denied_sha256'])a[key]='f'.repeat(64);
      const r=future.plan.state.reservations.find(r=>r.id===a.reservation_id);r.state='insufficient_context';r.released=false;
      future.plan.state.attempts.push({event:'terminal',reservation_id:a.reservation_id,outcome:'insufficient_context',remote_release_verified:false,bytes:Number.MAX_SAFE_INTEGER,candidates:Number.MAX_SAFE_INTEGER});
    }
    this.#sizePhysicalReleases(future);
    future.raw_bytes=Number.MAX_SAFE_INTEGER;future.plan.state.bytes=Number.MAX_SAFE_INTEGER;future.plan.state.candidates=Number.MAX_SAFE_INTEGER;future.plan.state.investigations=Number.MAX_SAFE_INTEGER;
    future.plan.state.negatives=clone(this.#limits.negative_ids);future.plan.state.halted=false;
    // At least one response byte is needed per candidate. Use that deliberately
    // loose bound even for candidate-overflow results retained for investigation.
    // Count key bytes arithmetically; never allocate a budget-sized array.
    const remainingKeys=Math.min(state.plan.limits.max_investigations-state.investigations.length,possibleCandidateBytes);
    const investigationEventBytes=Buffer.byteLength(encode({event:'investigation',accepted:true}))+1,haltEventBytes=Buffer.byteLength(encode({event:'investigation',accepted:false}))+1;
    const bytes=Buffer.byteLength(encode(future)+'\n')+remainingKeys*(67+investigationEventBytes)+haltEventBytes;
    if(!Number.isSafeInteger(bytes)||bytes>MAX_BYTES)throw Error('Supplementary storage headroom exhausted. No dispatch authorized.');
  }
  reserve({identity:worker,qualification,qualification_options,check_id,resource_group,source_ip_group,now}){
    if(!finiteTime(now))throw Error('Invalid supplementary capacity time.');
    const qualified=qualificationStatusWithLedger(qualification,{...qualification_options,identity:worker,now});
    if(!qualified.eligible)throw Error('Worker is not qualified for its exact task/role/configuration.');
    const identity_binding=qualificationBinding(worker),scope_binding=qualification_options?.scope_binding;
    const owned=this.#capacity.endpointGroups(worker.endpoint_id);
    if((resource_group!==undefined&&resource_group!==owned.resource_group)||(source_ip_group!==undefined&&source_ip_group!==owned.source_ip_group))return {admitted:false,reason:'capacity_binding_mismatch',quorum_votes:0};
    resource_group=owned.resource_group;source_ip_group=owned.source_ip_group;
    const task=this.#frame.find(f=>f.id===check_id)?.task;
    if(!task||now>=task.deadline)throw Error('Task is not in the precommitted frame or its deadline passed.');
    if(!hash(scope_binding)||task.run_id!==this.#baseline.run_id||!this.#baseline.pieces.includes(task.piece_id)||task.role_version!==worker.role_version||task.task_type!==worker.task_type||!this.#source.includes(task.source))throw Error('Task is outside the sealed source baseline or worker role.');
    const prepared=makeBumbleTask(task); // identity is minted here, never selected by model output
    return this.#locked(()=>{
      const {state,plan,physical_release_pending}=this.#read();
      if(physical_release_pending)return {admitted:false,reason:'physical_release_requires_reconciliation',quorum_votes:0};
      if(state.attempts.some(a=>a.state==='admitting'))return {admitted:false,reason:'admission_requires_reconciliation',quorum_votes:0};
      const held=state.attempts.filter(a=>!settledAttempt(a.state));
      if(plan.state.bytes+held.reduce((n,a)=>n+a.task.budget.response_bytes,0)+prepared.budget.response_bytes>plan.limits.max_bytes||plan.state.candidates+held.reduce((n,a)=>n+a.task.budget.candidates,0)+prepared.budget.candidates>plan.limits.max_candidates)return {admitted:false,reason:'reserved_output_budget',quorum_votes:0};
      const reservation_id=plan.admit({task_id:check_id,resource_group,source_ip_group},now);
      if(!reservation_id)return {admitted:false,reason:'capacity_or_budget',quorum_votes:0};
      const request={endpoint_id:worker.endpoint_id,run_id:this.#baseline.run_id,task_id:prepared.task_id,worker_binding:identity_binding,max_tokens:Buffer.byteLength(encode(prepared))+prepared.budget.response_bytes+1024,deadline:prepared.deadline,now};
      const attempt={reservation_id,capacity_reservation_id:null,check_id,identity_binding,scope_binding,qualification_sha256:sha(encode(qualification)),task:clone(prepared),state:'admitting',admission_request:request};
      state.attempts.push(attempt);state.plan=plan.snapshot();
      const intentBytes=Buffer.from(encode(this.#admissionExpected(attempt))+'\n');attempt.admission_intent_sha256=sha(intentBytes);
      // Allow for the eventual full UUID, not just the smaller pending null.
      const sized=clone(state);sized.attempts.at(-1).capacity_reservation_id='00000000-0000-4000-8000-000000000000';
      if(Buffer.byteLength(encode(sized)+'\n')>MAX_BYTES)throw Error('Supplementary storage budget exhausted. No dispatch authorized.');
      this.#terminalHeadroom(state);
      // Publish the complete original intent before referencing it from state.
      // A failed state write can leave an orphan intent, never a global hold or
      // send permit. Preserve that evidence; no retry is performed here.
      this.#exclusiveFile(this.#admissionPath(attempt),intentBytes);this.#save(state);
      // Conservative byte-based reservation. A live adapter must also qualify
      // its tokenizer/context accounting; reported usage never refunds this cap.
      let physical;try{physical=this.#capacity.reserve(request);}catch(error){throw Error('Original admission requires reconciliation; do not create another attempt or send.',{cause:error});}
      if(!physical.admitted){
        if(this.#matchAdmission(this.#readAdmission(attempt)))throw Error('Original admission refusal conflicts with a committed global hold.');
        this.#exclusiveFile(this.#deniedPath(attempt),Buffer.from(encode(this.#deniedExpected(attempt))+'\n'));this.#adoptAdmission(state,plan,attempt);
        return {...physical,reason:'global_capacity_or_budget'};
      }
      attempt.capacity_reservation_id=physical.reservation_id;
      attempt.state='reserved';
      try{this.#save(state);}catch(error){
        // The committed physical hold remains attached to the original durable
        // pending attempt. Recovery adopts it; it never guesses release or resend.
        throw Error('Supplementary admission outcome requires reconciliation; do not resend.',{cause:error});
      }
      return {admitted:true,reservation_id,task:clone(prepared),quorum_votes:0};
    });
  }
  beginInvestigation(candidate_key){
    if(!hash(candidate_key))throw Error('Invalid source-bound candidate key.');
    return this.#locked(()=>{
      const {state,plan}=this.#read();
      if(state.investigations.includes(candidate_key))return {admitted:false,reason:'already_investigated',quorum_votes:0};
      const candidates=state.attempts.filter(a=>a.state==='terminal').flatMap(a=>JSON.parse(this.#regularBytes(path.join(this.#root,`result-${a.reservation_id}.json`))).candidates||[]);
      if(!candidates.some(c=>c.key===candidate_key))throw Error('Candidate is not in an original supplementary result.');
      if(!plan.investigate()){state.plan=plan.snapshot();this.#save(state);return {admitted:false,reason:'investigation_budget',quorum_votes:0};}
      state.investigations.push(candidate_key);state.plan=plan.snapshot();this.#save(state);return {admitted:true,quorum_votes:0};
    });
  }
  markTransmissionPossible(reservation_id,now){
    if(!finiteTime(now))throw Error('Invalid transmission time.');
    return this.#locked(()=>{
      const {state}=this.#read(),a=state.attempts.find(a=>a.reservation_id===reservation_id);if(!a||!['reserved','transmission_possible'].includes(a.state))throw Error('Attempt cannot transmit.');
      // An immutable terminal claim excludes a later send, even when local or
      // global adoption failed. Only reconcile the original terminal evidence.
      if(this.#hasTerminalEvidence(a))throw Error('Terminal evidence excludes transmission; reconcile the original result.');
      if(fs.existsSync(this.#transmissionPath(a)))return this.#recoverTransmission(state,a);
      if(a.state!=='reserved'||now>=a.task.deadline||now>=state.plan.limits.deadline)throw Error('Attempt cannot transmit.');
      const global=this.#capacity.summary().reservations.find(r=>r.id===a.capacity_reservation_id);
      if(!global||global.transmission_possible||global.terminal||now<global.reserved_at)throw Error('Original capacity cannot create a fresh transmission intent.');
      const intent={schema:'momm-bumble-transmission-intent/1',reservation_id:a.reservation_id,capacity_reservation_id:a.capacity_reservation_id,capacity_binding:this.#capacityBinding,baseline_sha256:this.#baseline.baseline_sha256,task_id:a.task.task_id,attempt_id:a.task.attempt_id,task_sha256:sha(encode(a.task)),identity_binding:a.identity_binding,scope_binding:a.scope_binding,qualification_sha256:a.qualification_sha256,at:now};
      this.#exclusiveFile(this.#transmissionPath(a),Buffer.from(encode(intent)+'\n'));
      this.#capacity.markTransmissionPossible(a.capacity_reservation_id,now);a.state='transmission_possible';a.possible_at=now;a.transmission_intent_sha256=sha(Buffer.from(encode(intent)+'\n'));this.#save(state);
      return {quorum_votes:0,transmission_possible:true,transmission_at:now,dispatch_authorized:true,reconciled:false,completion:false};
    });
  }
  finish(reservation_id,{bytes,transport,finished,now,remote_release_verified=false}){
    if(!finiteTime(now)||typeof finished!=='boolean'||typeof remote_release_verified!=='boolean'||!['known_not_sent','success','transport_error','outcome_unknown','cancelled','refused'].includes(transport))throw Error('Invalid supplementary terminal status.');
    // Reject malformed host source text before Buffer.from could repair it.
    // Refusal leaves the original transmission reservation held for reconciliation.
    if(typeof bytes==='string'&&/[\uD800-\uDFFF]/u.test(bytes))throw Error('Malformed supplementary response source text.');
    return this.#locked(()=>{
      remote_release_verified=false; // model answers and caller booleans are not release evidence
      const {state,plan}=this.#read(),a=state.attempts.find(a=>a.reservation_id===reservation_id);
      const neverSent=a?.state==='reserved'&&transport==='known_not_sent';
      if(!a||(!neverSent&&a.state!=='transmission_possible')||(!neverSent&&transport==='known_not_sent'))throw Error('Original attempt is missing, already terminal, or could have transmitted.');
      // A durable intent survives a failed global mark. It is not proof of a
      // never-sent outcome; keep the original hold for exact reconciliation.
      if(neverSent&&fs.existsSync(this.#transmissionPath(a)))throw Error('Original transmission intent requires reconciliation; never-sent settlement is refused.');
      if(!neverSent&&now<a.possible_at)throw Error('Terminal time precedes transmission.');
      const input_supported=typeof bytes==='string'||bytes instanceof Uint8Array,raw=input_supported?Buffer.from(bytes):Buffer.alloc(0);
      if(this.#hasTerminalEvidence(a))return this.#adopt(state,plan,a,{transport,raw,input_supported,finished});
      const retained=raw.subarray(0,a.task.budget.response_bytes),terminal=this.#result(a,{raw:retained,transport,finished,now,input_supported,overflow_bytes:raw.length-retained.length});
      const capacityAxes=this.#axes(terminal);
      // Refuse known-invalid capacity transitions before creating an immutable
      // result. Commit revalidates under its own lock; races still fail held.
      this.#capacity.validateTerminal(a.capacity_reservation_id,capacityAxes);
      const resultBytes=Buffer.from(encode(terminal)+'\n');if(resultBytes.length>MAX_BYTES)throw Error('Original result exceeds private storage budget.');
      const intent={schema:'momm-bumble-terminal-intent/1',reservation_id:a.reservation_id,capacity_reservation_id:a.capacity_reservation_id,capacity_binding:this.#capacityBinding,baseline_sha256:this.#baseline.baseline_sha256,task_id:a.task.task_id,attempt_id:a.task.attempt_id,identity_binding:a.identity_binding,scope_binding:a.scope_binding,qualification_sha256:a.qualification_sha256,result_sha256:sha(resultBytes),input_sha256:sha(raw),input_supported,finished,retained_bytes:retained.length,overflow_bytes:raw.length-retained.length,candidate_count:terminal.candidates.reduce((n,c)=>n+c.originals.length,0),outcome:this.#outcome(terminal),axes:capacityAxes};
      // Immutable governor intent binds the exact result before cross-store writes.
      // Missing/partial intent or result stays held: never invent an old receipt.
      this.#exclusiveFile(this.#intentPath(a),Buffer.from(encode(intent)+'\n'));
      this.#exclusiveFile(this.#resultPath(a),resultBytes);
      return this.#adopt(state,plan,a);
    });
  }
  summary(){const {state,plan,physical_release_pending,physical_release_pending_reservations}=this.#read();return {schema:'momm-bumble-stage-summary/1',baseline:clone(this.#baseline),attempts:state.attempts.map(a=>({reservation_id:a.reservation_id,task_id:a.task.task_id,state:a.state,result_sha256:a.result_sha256??null})),...plan.coverage(),physical_release_pending,physical_release_pending_reservations,quorum_votes:0,completion:false};}
}
