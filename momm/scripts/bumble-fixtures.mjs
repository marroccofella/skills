// Owner-private append-only fixture accounting. No transport or automatic remote recovery.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {preparePrivateEvidence,requirePrivateEvidence} from './evidence-permissions.mjs';
const MAX_JOURNAL_BYTES=1_000_000;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encode=v=>JSON.stringify(canonical(v));
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const hash=v=>digest(encode(v));
const text=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0;
const fields=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
const OUTCOMES=['known_not_sent','success','invalid_output','refused','transport_error','outcome_unknown','cancelled','stale'];
const unresolved=outcome=>['transport_error','outcome_unknown','cancelled','stale'].includes(outcome);
function frameValue(frame){
  if(!Array.isArray(frame)||!frame.length||frame.length>1000)throw Error('Invalid bounded fixture frame.');
  const ids=new Set(),hashes=new Set();
  return frame.map(f=>{
    if(!fields(f,['id','kind','sha256','split'])||!text(f.id)||!sha(f.sha256)||!['defect','control'].includes(f.kind)||!['tuning','qualification','holdout'].includes(f.split)||ids.has(f.id)||hashes.has(f.sha256))throw Error('Invalid or duplicated fixture identity.');
    ids.add(f.id);hashes.add(f.sha256);return {id:f.id,kind:f.kind,sha256:f.sha256,split:f.split};
  });
}
function budgetValue(budget){
  if(!fields(budget,['max_total_attempts','max_transmissions','deadline'])||!Number.isSafeInteger(budget.max_total_attempts)||budget.max_total_attempts<1||budget.max_total_attempts>1000||!Number.isSafeInteger(budget.max_transmissions)||budget.max_transmissions<1||budget.max_transmissions>budget.max_total_attempts||!time(budget.deadline))throw Error('Invalid finite fixture budget.');
  return {...budget};
}
function reserveAllowed(f,purpose,state,budget,now){
  if(!f)throw Error('Unknown fixture.');
  if(!['qualification','holdout','diagnostic'].includes(purpose))throw Error('Invalid fixture purpose.');
  if(purpose!=='diagnostic'&&f.burned)throw Error('Fixture burned; fresh evaluation cannot reuse it.');
  if(f.open)throw Error('Fixture already reserved or has an unresolved transmitted attempt.');
  if(f.split==='holdout'&&!f.burned&&purpose!=='holdout')throw Error('Unused held-out fixture cannot be used for diagnostics.');
  if(purpose!=='diagnostic'&&purpose!==f.split)throw Error('Fixture split does not match evaluation purpose.');
  if(now>=budget.deadline||state.attempts.size>=budget.max_total_attempts)throw Error('Fixture attempt budget exhausted.');
}
function project(header,events){
  const state={fixtures:new Map(header.frame.map(f=>[f.id,{...f,burned:false,open:null}])),attempts:new Map(),transmissions:0,last_at:0};
  for(const e of events){
    if(!time(e.at)||e.at<state.last_at)throw Error('Invalid fixture journal event time.');
    state.last_at=e.at;
    if(e.kind==='reserved'){
      if(!fields(e,['kind','seq','at','previous_hash','attempt_id','fixture_id','purpose','binding','fresh_evidence'])||!text(e.attempt_id)||state.attempts.has(e.attempt_id)||!sha(e.binding))throw Error('Invalid fixture journal reservation.');
      const f=state.fixtures.get(e.fixture_id);reserveAllowed(f,e.purpose,state,header.budget,e.at);
      const fresh=e.purpose!=='diagnostic'&&!f.burned;
      if(e.fresh_evidence!==fresh)throw Error('Fixture journal contains an invalid freshness claim.');
      f.open=e.attempt_id;state.attempts.set(e.attempt_id,{...e,state:'reserved',transmission_possible:false,outcome:null});
    }else if(e.kind==='transmission_possible'){
      if(!fields(e,['kind','seq','at','previous_hash','attempt_id']))throw Error('Invalid fixture journal transmission.');
      const a=state.attempts.get(e.attempt_id);
      if(!a||a.state!=='reserved'||state.transmissions>=header.budget.max_transmissions||e.at>=header.budget.deadline)throw Error('Invalid fixture journal transmission transition.');
      a.state='transmission_possible';a.transmission_possible=true;state.transmissions++;state.fixtures.get(a.fixture_id).burned=true;
    }else if(e.kind==='terminal'){
      if(!fields(e,['kind','seq','at','previous_hash','attempt_id','outcome'])||!OUTCOMES.includes(e.outcome))throw Error('Invalid fixture journal terminal record.');
      const a=state.attempts.get(e.attempt_id);
      if(!a||a.state==='terminal')throw Error('Attempt is already terminal or unknown.');
      if(e.at>=header.budget.deadline&&!unresolved(e.outcome)&&e.outcome!=='known_not_sent')throw Error('Late result must retain stale or unknown coverage.');
      if(e.outcome==='known_not_sent'&&a.transmission_possible)throw Error('Possible transmission cannot be relabelled never sent.');
      if(e.outcome!=='known_not_sent'&&!a.transmission_possible)throw Error('Transmission evidence is required before a remote outcome.');
      a.state='terminal';a.outcome=e.outcome;a.terminal_at=e.at;
      if(!unresolved(e.outcome))state.fixtures.get(a.fixture_id).open=null;
    }else throw Error('Unsupported fixture journal event.');
  }
  return state;
}

export class BumbleFixtureLedger {
  constructor({root,frame,scope_binding,budget,project_root=process.cwd()}){
    if(!path.isAbsolute(root)||!sha(scope_binding))throw Error('Invalid private fixture store binding.');
    const projectPath=fs.realpathSync(project_root),literal=path.resolve(root),relative=path.relative(projectPath,literal);
    if(!relative||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)))throw Error('Global fixture accounting belongs outside project source.');
    const ancestor=fs.existsSync(literal)?literal:path.dirname(literal),ancestorRelative=path.relative(projectPath,fs.realpathSync(ancestor));
    if(!ancestorRelative||(!path.isAbsolute(ancestorRelative)&&ancestorRelative!=='..'&&!ancestorRelative.startsWith('..'+path.sep)))throw Error('Fixture store parent resolves inside project source. No directory was created.');
    preparePrivateEvidence(literal);
    this.root=fs.realpathSync(literal);
    const actualRelative=path.relative(projectPath,this.root);
    if(!actualRelative||(!path.isAbsolute(actualRelative)&&actualRelative!=='..'&&!actualRelative.startsWith('..'+path.sep)))throw Error('Fixture store resolves inside project source.');
    this.file=path.join(this.root,'fixtures.jsonl');this.lock=path.join(this.root,'writer.lock');
    this.header={schema:'momm-bumble-fixture-ledger/1',kind:'frame',scope_binding,frame:frameValue(frame),budget:budgetValue(budget)};
    this._locked(()=>{
      if(!fs.existsSync(this.file)){
        const bytes=encode(this.header)+'\n';if(Buffer.byteLength(bytes)>MAX_JOURNAL_BYTES)throw Error('Fixture storage budget exceeded.');
        const fd=fs.openSync(this.file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      }
      this._read();
    });
  }
  _locked(operation){
    requirePrivateEvidence(this.root);
    let fd;try{fd=fs.openSync(this.lock,'wx',0o600);}catch{throw Error('Fixture ledger is busy; no stale lock is removed automatically.');}
    const own=fs.fstatSync(fd,{bigint:true});let result,failure;
    try{result=operation();}catch(error){failure=error;}
    let cleanupFailed=false;
    // Windows path stat reports dev=0 while handle stat reports a volume ID; inode needs BigInt.
    try{const current=fs.lstatSync(this.lock,{bigint:true});if(current.ino!==own.ino||(process.platform!=='win32'&&current.dev!==own.dev)||current.nlink!==1n||current.isSymbolicLink())throw Error('Lock identity changed.');fs.unlinkSync(this.lock);}catch{cleanupFailed=true;}
    try{fs.closeSync(fd);}catch{cleanupFailed=true;}
    if(failure)throw failure;
    if(cleanupFailed)throw Error('Fixture checkpoint outcome requires reconciliation; lock cleanup failed.');
    return result;
  }
  _read(){
    requirePrivateEvidence(this.root);
    const stat=fs.lstatSync(this.file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_JOURNAL_BYTES)throw Error('Invalid bounded fixture journal file.');
    let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(this.file));}catch{throw Error('Invalid UTF-8 fixture journal.');}
    if(!raw.endsWith('\n'))throw Error('Incomplete fixture journal; original bytes retained.');
    const lines=raw.slice(0,-1).split('\n');let values;
    try{values=lines.map(line=>{const value=JSON.parse(line);if(encode(value)!==line)throw Error('Noncanonical or duplicated fields.');return value;});}catch{throw Error('Invalid fixture journal; original bytes retained.');}
    const header=values[0],events=values.slice(1);
    if(encode(header)!==encode(this.header))throw Error('Fixture journal binding/frame/budget mismatch.');
    if(events.length>3*header.budget.max_total_attempts)throw Error('Fixture journal event budget exceeded.');
    for(let n=0;n<events.length;n++)if(events[n].seq!==n+1||events[n].previous_hash!==digest(lines[n]))throw Error('Invalid fixture journal chain.');
    const state=project(header,events);
    return {header,events,state,raw,journal_sha256:digest(raw),last_hash:digest(lines.at(-1))};
  }
  _append(makeEvent){
    return this._locked(()=>{
      const current=this._read(),event=makeEvent(current.state);
      if(!time(event.at)||event.at<current.state.last_at)throw Error('Fixture event time is invalid.');
      event.seq=current.events.length+1;event.previous_hash=current.last_hash;
      project(this.header,[...current.events,event]);
      const line=encode(event)+'\n';
      if(Buffer.byteLength(current.raw)+Buffer.byteLength(line)>MAX_JOURNAL_BYTES)throw Error('Fixture storage budget exhausted; original journal retained.');
      const fd=fs.openSync(this.file,'a');try{fs.writeFileSync(fd,line);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      requirePrivateEvidence(this.root);
      return JSON.parse(JSON.stringify(event));
    });
  }
  reserve(fixture_id,{purpose,binding,now}){
    if(!sha(binding)||!time(now))throw Error('Invalid task binding or fixture reservation time.');
    return this._append(state=>{
      const f=state.fixtures.get(fixture_id);reserveAllowed(f,purpose,state,this.header.budget,now);
      return {kind:'reserved',at:now,attempt_id:crypto.randomUUID(),fixture_id,purpose,binding,fresh_evidence:purpose!=='diagnostic'&&!f.burned};
    });
  }
  markTransmissionPossible(attempt_id,now){return this._append(()=>({kind:'transmission_possible',at:now,attempt_id}));}
  finish(attempt_id,{outcome,now}){return this._append(()=>({kind:'terminal',at:now,attempt_id,outcome}));}
  summary(){
    const {state,journal_sha256,events}=this._read();
    return {schema:'momm-bumble-fixture-summary/1',scope_binding:this.header.scope_binding,frame_binding:hash(this.header.frame),journal_sha256,event_count:events.length,
      total_attempts:state.attempts.size,transmission_possible_count:state.transmissions,
      burned_fixture_ids:[...state.fixtures.values()].filter(f=>f.burned).map(f=>f.id),
      unresolved_attempt_ids:[...state.attempts.values()].filter(a=>a.state!=='terminal'||unresolved(a.outcome)).map(a=>a.attempt_id),
      attempts:[...state.attempts.values()].map(a=>({...a})),quorum_votes:0,completion:false};
  }
  frame(){return JSON.parse(JSON.stringify(this._read().header.frame));}
  hasCheckpoint({event_count,journal_sha256}){
    if(!Number.isSafeInteger(event_count)||event_count<0||!sha(journal_sha256))return false;
    const current=this._read();if(event_count>current.events.length)return false;
    const prefix=current.raw.split('\n').slice(0,event_count+1).join('\n')+'\n';
    return digest(prefix)===journal_sha256;
  }
}
