// Global owner-private physical admission, shared by review runs—not by profile names.
// Registered capacity is an owner configuration, not a worker's independence claim.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {preparePrivateEvidence,requirePrivateEvidence} from './evidence-permissions.mjs';
import {isBumbleReleaseVerifier,verifyBumbleReleaseReceipt} from './bumble-release-receipt.mjs';
const text=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uint=v=>Number.isSafeInteger(v)&&v>=0;
const MAX_BYTES=2_000_000;
const originalReleaseBinding=r=>{const value={...r,released:false};delete value.physical_release;return hash(value);};
const releaseEnvelope=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid release envelope.');
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
 if(keys.length!==2||keys.some(k=>!['payload','signature'].includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))throw Error('Invalid release envelope.');
 if(typeof ds.payload.value!=='string'||Buffer.byteLength(ds.payload.value)>8192||typeof ds.signature.value!=='string'||! /^[A-Za-z0-9_-]{86}$/.test(ds.signature.value))throw Error('Invalid release envelope scalars.');
 return {payload:ds.payload.value,signature:ds.signature.value};
};
// Optional development shadow ceiling. Legacy reservations/configuration remain
// unchanged; an approval-scoped caller can only narrow admission, never widen it.
function admissionBudget(input){
  const fields=['schema','authorization_sha256','configuration_sha256','max_attempts','max_reserved_tokens','max_completion_tokens','max_outstanding','expires_at'];
  if(!input||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Array.isArray(input))throw Error('Invalid admission budget data.');
  const descriptors=Object.getOwnPropertyDescriptors(input),names=Reflect.ownKeys(descriptors);
  if(names.length!==fields.length||names.some(key=>typeof key!=='string'||!fields.includes(key)||!Object.hasOwn(descriptors[key],'value')||!descriptors[key].enumerable))throw Error('Invalid admission budget data.');
  const value=Object.fromEntries(fields.map(key=>[key,descriptors[key].value]));
  if(value.schema!=='momm-bumble-admission-budget/1'||!sha(value.authorization_sha256)||!sha(value.configuration_sha256)||!Number.isSafeInteger(value.max_attempts)||value.max_attempts<1||value.max_attempts>4||!Number.isSafeInteger(value.max_reserved_tokens)||value.max_reserved_tokens<1||value.max_reserved_tokens>4096||!Number.isSafeInteger(value.max_completion_tokens)||value.max_completion_tokens<1||value.max_completion_tokens>1024||value.max_outstanding!==1||!uint(value.expires_at))throw Error('Invalid finite shadow admission budget.');
  return Object.freeze(value);
}
const outside=(project,target)=>{const rel=path.relative(project,target);return Boolean(rel)&&(path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep));};
function originalTerminal(state,id,{transport,payload,now}){
  if(!['known_not_sent','success','transport_error','outcome_unknown','cancelled','refused','stale'].includes(transport)||!['unavailable','valid','invalid','stale'].includes(payload)||(transport==='known_not_sent'&&payload!=='unavailable')||!uint(now))throw Error('Invalid global terminal axes.');
  const r=state.reservations.find(r=>r.id===id);
  if(!r||r.terminal||now<r.reserved_at||(r.transmission_possible&&now<r.transmission_at)||(transport==='known_not_sent'&&r.transmission_possible)||(transport!=='known_not_sent'&&!r.transmission_possible)||(now>=r.deadline&&payload!=='stale'&&!['known_not_sent','outcome_unknown','cancelled','stale','transport_error'].includes(transport)))throw Error('Global original outcome cannot be relabelled.');
  return r;
}
function configuration(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='deadline,endpoints,global_slots,max_attempts,max_reserved_tokens,resource_groups,schema,source_ip_groups')throw Error('Invalid global capacity configuration fields.');
  const value=JSON.parse(JSON.stringify(input));
  if(value.schema!=='momm-bumble-capacity/1'||!Number.isSafeInteger(value.global_slots)||value.global_slots<1||value.global_slots>256||!Number.isSafeInteger(value.max_attempts)||value.max_attempts<1||value.max_attempts>1000||!Number.isSafeInteger(value.max_reserved_tokens)||value.max_reserved_tokens<1||value.max_reserved_tokens>1_000_000_000||!uint(value.deadline))throw Error('Invalid global capacity budget.');
  for(const name of ['resource_groups','source_ip_groups']){
    const groups=value[name];if(!Array.isArray(groups)||!groups.length||groups.length>1000||new Set(groups.map(g=>g.id)).size!==groups.length||groups.some(g=>Object.keys(g).sort().join(',')!=='id,slots'||!text(g.id)||!Number.isSafeInteger(g.slots)||g.slots<1||g.slots>256))throw Error('Invalid physical/source-IP group capacity.');
  }
  const endpoints=value.endpoints;
  if(!Array.isArray(endpoints)||!endpoints.length||endpoints.length>1000||new Set(endpoints.map(e=>e.id)).size!==endpoints.length||endpoints.some(e=>Object.keys(e).sort().join(',')!=='id,resource_group,source_ip_group'||!text(e.id)||!value.resource_groups.some(g=>g.id===e.resource_group)||!value.source_ip_groups.some(g=>g.id===e.source_ip_group)))throw Error('Endpoint must belong to known physical and source-IP groups.');
  const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
  // These arrays are identity maps, not an ordered dispatch preference.
  for(const name of ['resource_groups','source_ip_groups','endpoints'])value[name].sort(byId);
  return value;
}
export class BumbleCapacity {
  #root;#file;#config;#releaseVerifier;
  constructor({root,config,project_root=process.cwd(),release_verifier=null}){
    if(release_verifier!==null&&!isBumbleReleaseVerifier(release_verifier))throw Error('A pinned trusted-host release verifier is required.');
    this.#releaseVerifier=release_verifier;
    if(!path.isAbsolute(root))throw Error('Global capacity needs an owner-private absolute home.');
    const project=fs.realpathSync(project_root),literal=path.resolve(root),ancestor=fs.existsSync(literal)?literal:path.dirname(literal);
    if(!outside(project,literal)||!outside(project,fs.realpathSync(ancestor)))throw Error('Global capacity must resolve outside source before creation.');
    this.#config=configuration(config);preparePrivateEvidence(literal);this.#root=fs.realpathSync(literal);this.#file=path.join(this.#root,'capacity.json');
    this.#locked(()=>{if(!fs.existsSync(this.#file))this.#save({schema:'momm-bumble-capacity-state/2',config:this.#config,reservations:[],retired_groups:[],reserved_tokens:0});this.#read();});
  }
  #locked(fn){
    requirePrivateEvidence(this.#root);const lock=path.join(this.#root,'writer.lock');let fd;
    try{fd=fs.openSync(lock,'wx',0o600);}catch{throw Error('Global capacity is busy; no stale lock is removed automatically.');}
    const own=fs.fstatSync(fd,{bigint:true});let value,error;try{value=fn();}catch(e){error=e;}
    let cleanup=false;
    try{const stat=fs.lstatSync(lock,{bigint:true});if(stat.ino!==own.ino||(process.platform!=='win32'&&stat.dev!==own.dev)||stat.nlink!==1n||stat.isSymbolicLink())throw Error('Lock changed.');fs.unlinkSync(lock);}catch{cleanup=true;}
    try{fs.closeSync(fd);}catch{cleanup=true;}
    if(error)throw error;if(cleanup)throw Error('Global capacity write requires reconciliation.');return value;
  }
  #read(){
    requirePrivateEvidence(this.#root);const stat=fs.lstatSync(this.#file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)throw Error('Global capacity state refused.');
    const state=JSON.parse(fs.readFileSync(this.#file,'utf8'));
    // Development v1 records did not retain original transmission time. Never
    // invent a timestamp or release those holds during a silent migration.
    if(state.schema!=='momm-bumble-capacity-state/2'||hash(configuration(state.config))!==hash(this.#config)||!Array.isArray(state.reservations)||state.reservations.length>this.#config.max_attempts||!Array.isArray(state.retired_groups)||state.retired_groups.length>this.#config.resource_groups.length||new Set(state.retired_groups).size!==state.retired_groups.length||state.retired_groups.some(id=>!this.#config.resource_groups.some(g=>g.id===id))||!uint(state.reserved_tokens)||state.reserved_tokens>this.#config.max_reserved_tokens)throw Error('Global capacity binding or budget changed; legacy original holds require explicit reconciliation.');
    let tokens=0;const ids=new Set(),budgets=new Map();
    for(const r of state.reservations){
      const endpoint=this.#config.endpoints.find(e=>e.id===r.endpoint_id);
      if(!text(r.id)||ids.has(r.id)||!text(r.run_id)||!text(r.task_id)||!sha(r.worker_binding)||!endpoint||r.resource_group!==endpoint.resource_group||r.source_ip_group!==endpoint.source_ip_group||!Number.isSafeInteger(r.reserved_tokens)||r.reserved_tokens<1||!uint(r.reserved_at)||!uint(r.deadline)||r.deadline>this.#config.deadline||typeof r.transmission_possible!=='boolean'||typeof r.released!=='boolean'||(r.released&&!Object.hasOwn(r,'physical_release')&&!(r.terminal?.transport==='known_not_sent'&&!r.transmission_possible)))throw Error('Invalid original global reservation.');
      if(r.transmission_possible?(!uint(r.transmission_at)||r.transmission_at<r.reserved_at||r.transmission_at>=r.deadline):r.transmission_at!==null)throw Error('Original global transmission time is missing or invalid.');
      if(r.terminal&&(!['known_not_sent','success','transport_error','outcome_unknown','cancelled','refused','stale'].includes(r.terminal.transport)||!['unavailable','valid','invalid','stale'].includes(r.terminal.payload)||(r.terminal.transport==='known_not_sent'&&r.terminal.payload!=='unavailable')||!uint(r.terminal.at)||r.terminal.at<r.reserved_at))throw Error('Invalid original global terminal status.');
      if(r.terminal&&r.transmission_possible&&r.terminal.at<r.transmission_at)throw Error('Original global terminal precedes transmission.');
      if(Object.hasOwn(r,'physical_release')){
        const release=r.physical_release;
        if(!r.released||!r.transmission_possible||!r.terminal||!release||Object.keys(release).sort().join(',')!=='receipt,receipt_sha256,recorded_at,schema'||release.schema!=='momm-bumble-recorded-release/1'||!uint(release.recorded_at)||release.recorded_at>Date.now()||release.receipt_sha256!==hash(releaseEnvelope(release.receipt)))throw Error('Recorded physical release changed; hold requires reconciliation.');
        const p=verifyBumbleReleaseReceipt(this.#releaseVerifier,release.receipt,this.#releaseChallenge(r),'stored');
        if(release.recorded_at<p.observed_at)throw Error('Recorded physical release time changed.');
      }
      if(Object.hasOwn(r,'admission_budget')){
        const budget=admissionBudget(r.admission_budget),digest=hash(budget);
        if(budget.configuration_sha256!==hash(this.#config)||r.reserved_tokens>budget.max_completion_tokens||r.deadline>budget.expires_at||r.reserved_at>=budget.expires_at)throw Error('Original admission budget binding changed.');
        const previous=budgets.get(budget.authorization_sha256)??{digest,attempts:0,tokens:0};
        if(previous.digest!==digest)throw Error('Original approval budget terms conflict.');
        previous.attempts++;previous.tokens+=r.reserved_tokens;
        if(previous.attempts>budget.max_attempts||previous.tokens>budget.max_reserved_tokens)throw Error('Original approval budget accounting exceeded.');
        budgets.set(budget.authorization_sha256,previous);
      }
      ids.add(r.id);tokens+=r.reserved_tokens;
    }
    if(tokens!==state.reserved_tokens)throw Error('Global token accounting does not reconcile.');
    return state;
  }
  #save(state){
    const bytes=Buffer.from(JSON.stringify(state)+'\n');if(bytes.length>MAX_BYTES)throw Error('Global capacity storage budget exhausted.');
    const temporary=path.join(this.#root,`capacity-${crypto.randomUUID()}.tmp`),fd=fs.openSync(temporary,'wx',0o600);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    try{requirePrivateEvidence(this.#root);fs.renameSync(temporary,this.#file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  reserve({endpoint_id,run_id,task_id,worker_binding,max_tokens,deadline,now,admission_budget}){
    if(![endpoint_id,run_id,task_id].every(text)||!sha(worker_binding)||!Number.isSafeInteger(max_tokens)||max_tokens<1||!uint(deadline)||!uint(now)||deadline<=now)throw Error('Invalid global reservation request.');
    const budget=admission_budget===undefined?null:admissionBudget(admission_budget);
    return this.#locked(()=>{
      const state=this.#read(),endpoint=this.#config.endpoints.find(e=>e.id===endpoint_id);
      if(!endpoint)throw Error('Endpoint is not in the approved capacity map.');
      const active=state.reservations.filter(r=>!r.released),group=this.#config.resource_groups.find(g=>g.id===endpoint.resource_group),ip=this.#config.source_ip_groups.find(g=>g.id===endpoint.source_ip_group);
      // Re-read and charge within the same writer lock. Summary is advisory only.
      // Own wall time applies to this new scoped route, not caller-supplied time.
      const reservedAt=budget?Date.now():now;
      if(budget){
        if(budget.configuration_sha256!==hash(this.#config))throw Error('Approval capacity configuration changed.');
        const owned=state.reservations.filter(r=>r.admission_budget?.authorization_sha256===budget.authorization_sha256);
        if(owned.some(r=>hash(admissionBudget(r.admission_budget))!==hash(budget)))throw Error('Approval admission terms changed.');
        if(reservedAt>=budget.expires_at||deadline<=reservedAt||deadline>budget.expires_at||deadline>reservedAt+180000||max_tokens>budget.max_completion_tokens||owned.length>=budget.max_attempts||owned.reduce((sum,r)=>sum+r.reserved_tokens,0)+max_tokens>budget.max_reserved_tokens||active.length>=budget.max_outstanding)return {admitted:false,reason:'approval_capacity_or_budget',quorum_votes:0};
      }
      if(reservedAt>=this.#config.deadline||deadline>this.#config.deadline||state.retired_groups.includes(group.id)||state.reservations.length>=this.#config.max_attempts||state.reserved_tokens+max_tokens>this.#config.max_reserved_tokens||state.reservations.some(r=>r.run_id===run_id&&r.task_id===task_id)||active.length>=this.#config.global_slots||active.filter(r=>r.resource_group===group.id).length>=group.slots||active.filter(r=>r.source_ip_group===ip.id).length>=ip.slots)return {admitted:false,reason:'global_capacity_or_budget',quorum_votes:0};
      const reservation={id:crypto.randomUUID(),endpoint_id,run_id,task_id,worker_binding,resource_group:group.id,source_ip_group:ip.id,reserved_tokens:max_tokens,reserved_at:reservedAt,deadline,transmission_possible:false,transmission_at:null,released:false,terminal:null,...(budget?{admission_budget:budget}:{})};
      state.reservations.push(reservation);state.reserved_tokens+=max_tokens;this.#save(state);return {admitted:true,reservation_id:reservation.id,quorum_votes:0};
    });
  }
  markTransmissionPossible(id,now){return this.#locked(()=>{const state=this.#read(),r=state.reservations.find(r=>r.id===id),at=r?.admission_budget?Date.now():now;if(!r||r.terminal||r.transmission_possible||!uint(at)||at<r.reserved_at||at>=r.deadline)throw Error('Global reservation cannot transmit.');r.transmission_possible=true;r.transmission_at=at;this.#save(state);return {transmission_possible:true,transmission_at:at,quorum_votes:0};});}
  terminal(id,{transport,payload,now}){
    return this.#locked(()=>{
      const state=this.#read(),owned=state.reservations.find(r=>r.id===id),at=owned?.admission_budget?Date.now():now,r=originalTerminal(state,id,{transport,payload,now:at});
      r.terminal={transport,payload,at};r.released=transport==='known_not_sent';
      // A valid model answer or client cancellation is not physical release proof.
      // Documented status/lease verification is a separate, not-yet-activated gate.
      this.#save(state);return {recorded:true,released:r.released,quorum_votes:0,completion:false};
    });
  }
  validateTerminal(id,axes){return this.#locked(()=>{const state=this.#read(),r=state.reservations.find(r=>r.id===id);originalTerminal(state,id,r?.admission_budget?{...axes,now:Date.now()}:axes);return {valid:true,quorum_votes:0,completion:false};});}
  #releaseChallenge(r){return Object.freeze({configuration_sha256:hash(this.#config),reservation_id:r.id,reservation_sha256:originalReleaseBinding(r),earliest_at:r.transmission_at});}
  releaseChallenge(id){const state=this.#read(),r=state.reservations.find(r=>r.id===id);if(!r||!r.transmission_possible||!r.terminal)throw Error('Original transmitted terminal record is required.');return this.#releaseChallenge(r);}
  reconcileRelease(id,receipt){
    // No default authority, no caller approval flag, no worker-derived release.
    if(!isBumbleReleaseVerifier(this.#releaseVerifier))throw Error('Trusted-host release verifier is not configured; original hold retained.');
    return this.#locked(()=>{
      const state=this.#read(),r=state.reservations.find(r=>r.id===id);
      if(!r||!r.transmission_possible||!r.terminal)throw Error('Original transmitted terminal record is required.');
      const owned=releaseEnvelope(receipt);
      if(Object.hasOwn(r,'physical_release')){if(hash(owned)!==r.physical_release.receipt_sha256)throw Error('Original physical release cannot be replaced.');return {recorded:false,released:true,quorum_votes:0,completion:false};}
      verifyBumbleReleaseReceipt(this.#releaseVerifier,owned,this.#releaseChallenge(r));
      r.physical_release={schema:'momm-bumble-recorded-release/1',receipt:owned,receipt_sha256:hash(owned),recorded_at:Date.now()};r.released=true;
      // Original terminal, attempts and token charges are deliberately unchanged.
      this.#save(state);return {recorded:true,released:true,quorum_votes:0,completion:false};
    });
  }
  retire(resource_group){return this.#locked(()=>{const state=this.#read();if(!this.#config.resource_groups.some(g=>g.id===resource_group))throw Error('Unknown physical resource group.');if(!state.retired_groups.includes(resource_group)){state.retired_groups.push(resource_group);this.#save(state);}return {retired:true,reservations_preserved:true,completion:false};});}
  summary(){const state=this.#read();return {schema:'momm-bumble-capacity-summary/1',configuration_sha256:hash(this.#config),attempts:state.reservations.length,held:state.reservations.filter(r=>!r.released).length,reserved_tokens:state.reserved_tokens,retired_groups:[...state.retired_groups],reservations:state.reservations.map(r=>({...r})),quorum_votes:0,completion:false,release_verification:'not_activated'};}
  endpointGroups(endpoint_id){this.#read();const endpoint=this.#config.endpoints.find(e=>e.id===endpoint_id);if(!endpoint)throw Error('Endpoint is not in the approved capacity map.');return {...endpoint,configuration_sha256:hash(this.#config)};}
}
