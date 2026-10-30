// Trusted-host metadata journal, never a token/code/verifier store or send permit.
// Authorizer callbacks must verify real owner policy/trust/disclosure/logging;
// structured model/HTTP data cannot replace that host. Canonical per-scope root
// mapping is the host's responsibility. Hash replay checks consistency, not
// protection against a malicious same-user writer rewriting the whole chain.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {preparePrivateEvidence,requirePrivateEvidence} from './evidence-permissions.mjs';
import {parseBumbleJSON} from './bumble-contract.mjs';
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const uint=v=>Number.isSafeInteger(v)&&v>=0;
const fault=code=>{throw Object.assign(Error('OAuth journal refused: '+code),{code});};
const closed=(v,fields)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;const ds=Object.getOwnPropertyDescriptors(v),ks=Reflect.ownKeys(ds);return ks.length===fields.length&&ks.every(k=>typeof k==='string'&&fields.includes(k)&&ds[k].enumerable&&Object.hasOwn(ds[k],'value'));};
const clone=v=>JSON.parse(JSON.stringify(v));
const outside=(project,target)=>{const rel=path.relative(project,target);return !!rel&&(path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep));};
const OPS=['code_exchange','refresh','revocation'],OUTCOMES=['success','refused','known_not_sent','outcome_unknown','cancelled'];
const CFG=['schema','scope_binding','policy_sha256','trust_sha256','disclosure_sha256','logging_sha256','max_attempts','max_bytes','deadline'];
const requestFields=['attempt_id','operation','request_binding','previous_reference','now','deadline'];
const referenceWasUsed=(attempts,request)=>request.operation==='refresh'&&attempts.some(a=>['refresh','revocation'].includes(a.operation)&&a.previous_reference===request.previous_reference&&Object.hasOwn(a,'possible_at'));
function requestOK(r){return closed(r,requestFields)&&UUID.test(r.attempt_id)&&OPS.includes(r.operation)&&SHA.test(r.request_binding)&&uint(r.now)&&uint(r.deadline)&&r.deadline>r.now&&r.deadline-r.now<=300000&&(r.operation==='code_exchange'?r.previous_reference===null:UUID.test(r.previous_reference));}
export class BumbleOAuthJournal{
 #root;#project;#cfg;#authorize;
 constructor({root,project_root=process.cwd(),config,authorize=null}){
  if(typeof root!=='string'||!path.isAbsolute(root)||(authorize!==null&&typeof authorize!=='function')||!closed(config,CFG)||config.schema!=='momm-bumble-oauth-journal-config/1'||![config.scope_binding,config.policy_sha256,config.trust_sha256,config.disclosure_sha256,config.logging_sha256].every(v=>SHA.test(v))||!Number.isSafeInteger(config.max_attempts)||config.max_attempts<1||config.max_attempts>32||!Number.isSafeInteger(config.max_bytes)||config.max_bytes<(3*config.max_attempts+1)*2048+4096||config.max_bytes>1000000||!uint(config.deadline))fault('invalid_configuration');
  this.#root=path.resolve(root);this.#project=fs.realpathSync.native(project_root);this.#cfg=Object.freeze(clone(config));this.#authorize=authorize;
 }
 #configured(){if(!this.#authorize)fault('owner_approval_required');}
 #approval(r){
  this.#configured();let a;try{a=this.#authorize({operation:r.operation,request_binding:r.request_binding,scope_binding:this.#cfg.scope_binding,now:r.now,deadline:r.deadline});}catch{fault('owner_approval_unavailable');}
  const names=['schema','scope_binding','operation','request_binding','policy_sha256','trust_sha256','disclosure_sha256','logging_sha256','valid_until'];
  if(!closed(a,names)||a.schema!=='momm-bumble-oauth-operation-approval/1'||a.operation!==r.operation||a.request_binding!==r.request_binding||!uint(a.valid_until)||a.valid_until<r.deadline||a.valid_until<=r.now||a.valid_until-r.now>86400000||['scope_binding','policy_sha256','trust_sha256','disclosure_sha256','logging_sha256'].some(k=>a[k]!==this.#cfg[k]))fault('owner_approval_required');
  return H(JSON.stringify(a));
 }
 #home(create){
  const exists=fs.existsSync(this.#root),parent=exists?this.#root:path.dirname(this.#root);
  if(!outside(this.#project,this.#root)||!outside(this.#project,fs.realpathSync.native(parent)))fault('private_external_home_required');
  if(!exists){if(!create)fault('journal_absent');preparePrivateEvidence(this.#root);}
  if(fs.realpathSync.native(this.#root)!==this.#root)fault('private_external_home_required');requirePrivateEvidence(this.#root);
 }
 #regular(file,max){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>max)fault('invalid_journal_record');const bytes=fs.readFileSync(file),again=fs.lstatSync(file);if(again.ino!==s.ino||again.size!==s.size||again.nlink!==1||again.isSymbolicLink())fault('journal_record_changed');return bytes;}
 #write(file,bytes){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 #locked(fn,create=false){
  this.#configured();this.#home(create);const file=path.join(this.#root,'writer.lock');let fd;try{fd=fs.openSync(file,'wx',0o600);}catch{fault('busy_or_unknown_prior_outcome');}const own=fs.fstatSync(fd,{bigint:true});let value,error;
  try{value=fn();}catch(e){error=e;}let cleanup=false;
  try{const s=fs.lstatSync(file,{bigint:true});if(s.ino!==own.ino||(process.platform!=='win32'&&s.dev!==own.dev)||s.nlink!==1n||s.isSymbolicLink())fault('lock_changed');fs.unlinkSync(file);}catch{cleanup=true;}try{fs.closeSync(fd);}catch{cleanup=true;}
  if(error)throw error;if(cleanup)fault('unknown_committed_outcome');return value;
 }
 #load(create=false){
  requirePrivateEvidence(this.#root);const names=fs.readdirSync(this.#root);
  if(names.some(n=>n!=='header.json'&&n!=='writer.lock'&&!/^event-\d{6}\.json$/.test(n)))fault('foreign_journal_entry');
  const headerFile=path.join(this.#root,'header.json');
  if(!fs.existsSync(headerFile)){if(!create||names.some(n=>n.startsWith('event-')))fault('journal_header_missing');this.#write(headerFile,Buffer.from(JSON.stringify({schema:'momm-bumble-oauth-journal-header/1',config:this.#cfg,configuration_sha256:H(JSON.stringify(this.#cfg))})+'\n'));}
  const headerBytes=this.#regular(headerFile,4096);let header;try{header=parseBumbleJSON(new TextDecoder('utf-8',{fatal:true}).decode(headerBytes));}catch{fault('invalid_journal_header');}
  if(!closed(header,['schema','config','configuration_sha256'])||header.schema!=='momm-bumble-oauth-journal-header/1'||JSON.stringify(header.config)!==JSON.stringify(this.#cfg)||header.configuration_sha256!==H(JSON.stringify(this.#cfg)))fault('journal_configuration_changed');
  const files=names.filter(n=>n.startsWith('event-')).sort();if(files.length>3*this.#cfg.max_attempts+1)fault('event_budget');
  const state={attempts:[],retired:false,events:[],bytes:headerBytes.length,previous_sha256:H(headerBytes),last_at:0};
  for(let i=0;i<files.length;i++){
   if(files[i]!=='event-'+String(i+1).padStart(6,'0')+'.json')fault('journal_sequence_changed');
   const bytes=this.#regular(path.join(this.#root,files[i]),2048);let e;try{e=parseBumbleJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fault('invalid_journal_event');}
   if(!e||typeof e!=='object'||Array.isArray(e))fault('invalid_journal_event');
   if(e.seq!==i+1||e.previous_sha256!==state.previous_sha256||!uint(e.at)||e.at<state.last_at)fault('journal_chain_changed');
   this.#apply(state,e);state.events.push(e);state.bytes+=bytes.length;state.previous_sha256=H(bytes);state.last_at=e.at;
  }
  if(state.bytes>this.#cfg.max_bytes)fault('storage_budget');return state;
 }
 #apply(state,e){
  const base=['seq','previous_sha256','kind','at'];
  if(e.kind==='begin'){
   if(!closed(e,[...base,'attempt_id','operation','request_binding','previous_reference','deadline','approval_sha256'])||!requestOK({...Object.fromEntries(requestFields.filter(k=>k!=='now').map(k=>[k,e[k]])),now:e.at})||!SHA.test(e.approval_sha256)||e.deadline>this.#cfg.deadline||state.retired||state.attempts.some(a=>['prepared','possible','quarantined'].includes(a.state))||state.attempts.some(a=>a.attempt_id===e.attempt_id||a.request_binding===e.request_binding)||state.attempts.length>=this.#cfg.max_attempts)fault('invalid_original_begin');
   if(referenceWasUsed(state.attempts,e))fault('invalid_original_begin');
   state.attempts.push({...e,created_at:e.at,state:'prepared',terminal:null});
  }else if(e.kind==='possible'){
   const a=state.attempts.find(a=>a.attempt_id===e.attempt_id);if(!closed(e,[...base,'attempt_id'])||!a||a.state!=='prepared'||state.retired||e.at>=a.deadline)fault('invalid_original_transition');a.state='possible';a.possible_at=e.at;
  }else if(e.kind==='terminal'){
   const a=state.attempts.find(a=>a.attempt_id===e.attempt_id);
   if(!closed(e,[...base,'attempt_id','outcome','protected_reference'])||!a||a.terminal||!OUTCOMES.includes(e.outcome)||(e.outcome==='success'?!UUID.test(e.protected_reference):e.protected_reference!==null)||(a.state==='possible'&&e.outcome==='known_not_sent')||(a.state==='prepared'&&!['known_not_sent','refused','cancelled'].includes(e.outcome)))fault('invalid_original_terminal');
   a.terminal=e;a.reported_outcome=e.outcome;a.state=a.state==='prepared'?'known_not_sent':e.at>=a.deadline||['outcome_unknown','cancelled'].includes(e.outcome)?'quarantined':e.outcome;
  }else if(e.kind==='retired'){if(!closed(e,base)||state.retired)fault('invalid_retirement');state.retired=true;}
  else fault('unknown_journal_event');
 }
 #append(state,body){
  const e={seq:state.events.length+1,previous_sha256:state.previous_sha256,...body};if(!uint(e.at)||e.at<state.last_at)fault('clock_regression');this.#apply({...state,attempts:clone(state.attempts)},e);
  const bytes=Buffer.from(JSON.stringify(e)+'\n');if(bytes.length>2048||state.bytes+bytes.length>this.#cfg.max_bytes||state.events.length>=3*this.#cfg.max_attempts+1)fault('storage_budget');
  this.#write(path.join(this.#root,'event-'+String(e.seq).padStart(6,'0')+'.json'),bytes);return H(bytes);
 }
 begin(request){
  this.#configured();if(!requestOK(request)||request.deadline>this.#cfg.deadline)fault('invalid_operation_request');const approval_sha256=this.#approval(request);
  return this.#locked(()=>{const s=this.#load(true);if(s.retired)fault('scope_retired');if(s.attempts.some(a=>a.attempt_id===request.attempt_id||a.request_binding===request.request_binding))fault('original_operation_not_replayed');if(s.attempts.some(a=>['prepared','possible','quarantined'].includes(a.state)))fault('scope_quarantined_or_busy');if(referenceWasUsed(s.attempts,request))fault('original_refresh_reference_not_reused');if(s.attempts.length>=this.#cfg.max_attempts)fault('attempt_budget');
   const {now,...rest}=request,record_sha256=this.#append(s,{kind:'begin',at:now,...rest,approval_sha256});return Object.freeze({recorded:true,state:'prepared',attempt_id:request.attempt_id,record_sha256,replay_allowed:false,credentials_read:false,quorum_votes:0});},true);
 }
 markPossible(attempt_id,now){
  if(!UUID.test(attempt_id)||!uint(now))fault('invalid_original_transition');return this.#locked(()=>{const s=this.#load(),a=s.attempts.find(a=>a.attempt_id===attempt_id);if(!a||a.terminal||s.retired)fault('invalid_original_transition');if(a.state==='possible')return Object.freeze({recorded:false,original_transition:false,state:'possible',replay_allowed:false,quorum_votes:0});
   if(now>=a.deadline||this.#approval({operation:a.operation,request_binding:a.request_binding,now,deadline:a.deadline})!==a.approval_sha256)fault('owner_approval_required');const record_sha256=this.#append(s,{kind:'possible',at:now,attempt_id});return Object.freeze({recorded:true,original_transition:true,state:'possible',attempt_id,record_sha256,replay_allowed:false,permission_granted:false,quorum_votes:0});});
 }
 finish(attempt_id,result){
  if(!UUID.test(attempt_id)||!closed(result,['outcome','protected_reference','now'])||!uint(result.now)||!OUTCOMES.includes(result.outcome)||(result.outcome==='success'?!UUID.test(result.protected_reference):result.protected_reference!==null))fault('invalid_terminal_observation');
  // Recording an original outcome is not another credential operation: it remains
  // available after the existing authorizer revokes/its grant expires.
  return this.#locked(()=>{const s=this.#load(),a=s.attempts.find(a=>a.attempt_id===attempt_id);if(!a)fault('original_attempt_missing');if(a.terminal){if(a.terminal.at!==result.now||a.terminal.outcome!==result.outcome||a.terminal.protected_reference!==result.protected_reference)fault('original_outcome_not_relabelled');return Object.freeze({recorded:false,state:a.state,reported_outcome:a.reported_outcome,quorum_votes:0});}
   if((a.state==='possible'&&result.outcome==='known_not_sent')||(a.state==='prepared'&&!['known_not_sent','refused','cancelled'].includes(result.outcome)))fault('original_outcome_not_relabelled');const record_sha256=this.#append(s,{kind:'terminal',at:result.now,attempt_id,outcome:result.outcome,protected_reference:result.protected_reference}),updated=this.#load().attempts.find(a=>a.attempt_id===attempt_id);return Object.freeze({recorded:true,state:updated.state,reported_outcome:updated.reported_outcome,record_sha256,physical_release_verified:false,identity_verified:false,quorum_votes:0});});
 }
 observe(attempt_id){if(!UUID.test(attempt_id))fault('invalid_reference');this.#configured();this.#home(false);const a=this.#load().attempts.find(a=>a.attempt_id===attempt_id);if(!a)fault('original_attempt_missing');return Object.freeze({attempt_id:a.attempt_id,operation:a.operation,request_binding:a.request_binding,state:a.state,reported_outcome:a.reported_outcome??null,replay_allowed:false,physical_release_verified:false,identity_verified:false,quorum_votes:0});}
 retire(now){if(!uint(now))fault('invalid_clock');return this.#locked(()=>{const s=this.#load();if(s.retired)return Object.freeze({recorded:false,retired:true,physical_release_verified:false,quorum_votes:0});const record_sha256=this.#append(s,{kind:'retired',at:now});return Object.freeze({recorded:true,retired:true,record_sha256,physical_release_verified:false,quorum_votes:0});});}
 summary(){this.#configured();this.#home(false);const s=this.#load();return Object.freeze({schema:'momm-bumble-oauth-journal-summary/1',attempts:s.attempts.length,events:s.events.length,bytes:s.bytes,retired:s.retired,quarantined:s.attempts.some(a=>['possible','quarantined'].includes(a.state)),in_flight:s.attempts.some(a=>['prepared','possible'].includes(a.state)),journal_sha256:s.previous_sha256,credentials_read:false,physical_release_verified:false,identity_verified:false,quorum_votes:0,completion:false});}
}
