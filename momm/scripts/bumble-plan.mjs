// Deterministic offline admission decisions; reservation IDs are freshly random.
// Caller timestamps are logical bounds, not trusted wall/monotonic evidence.
// A live host must bind its own clock and owner-global ledger. This value object
// authenticates neither time nor physical release and grants no transport authority.
import crypto from 'node:crypto';
const OUTCOMES=['known_not_sent','scoped_negative','candidate','insufficient_context','abstain','refused','invalid_output','transport_error','outcome_unknown','cancelled','stale'];
const uint=n=>Number.isSafeInteger(n)&&n>=0;
const shape=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...names].sort().join(',');
function admissionDenied(reservations,limits,halted,{task_id,resource_group,source_ip_group},now){
  const active=reservations.filter(r=>!r.released);
  return halted||now>=limits.deadline||reservations.length>=limits.max_tasks||reservations.some(r=>r.task_id===task_id||(r.resource_group===resource_group&&r.retired===true))||active.length>=limits.global||active.filter(r=>r.resource_group===resource_group).length>=limits.per_group||active.filter(r=>r.source_ip_group===source_ip_group).length>=limits.per_group;
}
function validateRestoredHistory(state,negativeIds,limits){
  const projected=new Map(),tasks=new Set(),negatives=[];let bytes=0,candidates=0,investigations=0,halted=false;
  for(const event of state.attempts){
    if(event?.event==='admitted'){
      if(!shape(event,['event','id','task_id','resource_group','source_ip_group','state','released','now'])||!['id','task_id','resource_group','source_ip_group'].every(k=>typeof event[k]==='string'&&event[k].length>0&&event[k].length<=200)||event.state!=='admitted'||event.released!==false||!uint(event.now)||projected.has(event.id)||tasks.has(event.task_id)||admissionDenied([...projected.values()],limits,halted,event,event.now))throw Error('Invalid restored admission journal identity, clock or bounds; undated legacy history requires explicit reconciliation.');
      projected.set(event.id,{id:event.id,task_id:event.task_id,resource_group:event.resource_group,source_ip_group:event.source_ip_group,state:'admitted',released:false,retired:false});tasks.add(event.task_id);
    }else if(event?.event==='terminal'){
      const r=projected.get(event.reservation_id);
      if(!shape(event,['event','reservation_id','outcome','remote_release_verified','bytes','candidates'])||!r||r.state!=='admitted'||!OUTCOMES.includes(event.outcome)||typeof event.remote_release_verified!=='boolean'||!uint(event.bytes)||!uint(event.candidates))throw Error('Invalid restored terminal journal/accounting.');
      r.state=event.outcome;r.released=event.outcome==='known_not_sent'||event.remote_release_verified;bytes+=event.bytes;candidates+=event.candidates;
      if(!uint(bytes)||!uint(candidates))throw Error('Restored accounting exceeds supported bounds.');
      if(bytes>limits.max_bytes||candidates>limits.max_candidates)halted=true;
      if(event.outcome==='scoped_negative'&&negativeIds.has(r.task_id))negatives.push(r.task_id);
    }else if(event?.event==='physical_release'){
      const r=projected.get(event.reservation_id);
      if(!shape(event,['event','reservation_id','receipt_sha256','at'])||!r||r.state==='admitted'||r.state==='known_not_sent'||r.released||typeof event.receipt_sha256!=='string'||!/^[a-f0-9]{64}$/.test(event.receipt_sha256)||!uint(event.at))throw Error('Invalid restored physical-release journal.');
      r.released=true;
    }else if(event?.event==='retired'){
      if(!shape(event,['event','resource_group','reservations_preserved'])||event.reservations_preserved!==true)throw Error('Invalid restored retirement journal.');
      const held=[...projected.values()].filter(r=>r.resource_group===event.resource_group&&!r.released&&!r.retired);
      if(!held.length)throw Error('Unbacked restored retirement journal.');for(const r of held)r.retired=true;
    }else if(event?.event==='investigation'){
      if(!shape(event,['event','accepted'])||typeof event.accepted!=='boolean'||halted||event.accepted!==(investigations<limits.max_investigations))throw Error('Invalid restored investigation journal.');
      if(event.accepted)investigations++;else halted=true;
    }else throw Error('Unknown restored journal event.');
  }
  if(projected.size!==state.reservations.length||state.reservations.some(r=>{const p=projected.get(r.id);return !p||['task_id','resource_group','source_ip_group','state','released'].some(k=>r[k]!==p[k])||(r.retired===true)!==p.retired;})||state.bytes!==bytes||state.candidates!==candidates||JSON.stringify(state.negatives)!==JSON.stringify(negatives)||state.investigations!==investigations||state.halted!==halted)throw Error('Invalid restored audit/journal/accounting binding.');
}
export class BumblePlan {
  // Limits, including an absolute deadline, are required; none is silently guessed.
  constructor({global=1,per_group=1,max_tasks=100,max_candidates=100,max_bytes=1_000_000,max_investigations=10,deadline,negative_ids=[],minimum_negatives=1},restored=null){
    for(const n of [global,per_group,max_tasks,max_candidates,max_bytes,max_investigations,minimum_negatives])if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid plan bounds.');
    if(!Number.isSafeInteger(deadline)||deadline<0||global<1||per_group<1||!uint(4*max_tasks+max_investigations+1))throw Error('Invalid absolute plan deadline or journal bounds.');
    this.limits={global,per_group,max_tasks,max_candidates,max_bytes,max_investigations,deadline,minimum_negatives};
    if(!Array.isArray(negative_ids)||negative_ids.length>max_tasks||negative_ids.some(v=>typeof v!=='string'||v.length>200)||new Set(negative_ids).size!==negative_ids.length)throw Error('Invalid precommitted audit frame.');
    if(minimum_negatives<1||(negative_ids.length>0&&minimum_negatives>negative_ids.length))throw Error('Invalid precommitted audit minimum.');
    // An empty planning frame remains visibly audit_unmet; it never supplies
    // native dispatch authority. BumbleStage requires a nonempty bound frame.
    this.negative_ids=new Set(negative_ids);
    if(restored&&(restored.schema!=='momm-bumble-plan/2'||JSON.stringify(restored.limits)!==JSON.stringify(this.limits)||JSON.stringify(restored.negative_ids)!==JSON.stringify(negative_ids)))throw Error('Restored plan binding/limits mismatch; legacy history requires explicit reconciliation.');
    this.state=restored?JSON.parse(JSON.stringify(restored.state)):{reservations:[],attempts:[],tasks:0,bytes:0,candidates:0,investigations:0,negatives:[],halted:false};
    if(!this.state||!Array.isArray(this.state.reservations)||!Array.isArray(this.state.attempts)||!Array.isArray(this.state.negatives)||this.state.reservations.length>max_tasks||this.state.attempts.length>4*max_tasks+max_investigations+1||!['tasks','bytes','candidates','investigations'].every(k=>Number.isSafeInteger(this.state[k])&&this.state[k]>=0)||typeof this.state.halted!=='boolean')throw Error('Invalid restored plan state.');
    if(this.state.tasks!==this.state.reservations.length||new Set(this.state.reservations.map(r=>r?.id)).size!==this.state.reservations.length||this.state.reservations.some(r=>!r||typeof r!=='object'||typeof r.id!=='string'||typeof r.task_id!=='string'||typeof r.resource_group!=='string'||typeof r.source_ip_group!=='string'||typeof r.released!=='boolean'||!['admitted',...OUTCOMES].includes(r.state)||(r.state==='admitted'&&r.released)||(Object.hasOwn(r,'retired')&&typeof r.retired!=='boolean'))||new Set(this.state.negatives).size!==this.state.negatives.length||this.state.negatives.some(n=>!this.negative_ids.has(n)))throw Error('Invalid restored reservation/audit state.');
    // Self-consistency is not proof that a worker performed a check. The stage
    // still binds original private results; these derived counts grant no votes.
    validateRestoredHistory(this.state,this.negative_ids,this.limits);
  }
  admit({task_id,resource_group,source_ip_group},now){
    if(!uint(now)||![task_id,resource_group,source_ip_group].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw Error('Invalid admission time or identity.');
    if(admissionDenied(this.state.reservations,this.limits,this.state.halted,{task_id,resource_group,source_ip_group},now))return null;
    const reservation={id:crypto.randomUUID(),task_id,resource_group,source_ip_group,state:'admitted',released:false};this.state.reservations.push(reservation);this.state.tasks++;this.state.attempts.push({event:'admitted',...reservation,now});return reservation.id;
  }
  terminal(id,outcome,{remote_release_verified=false,bytes=0,candidates=0}={}){
    if(!OUTCOMES.includes(outcome)||typeof remote_release_verified!=='boolean')throw Error('Invalid terminal outcome or release evidence.');
    const r=this.state.reservations.find(r=>r.id===id);if(!r||r.state!=='admitted')throw Error('Attempt already terminal or unknown.');
    if(!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(candidates)||candidates<0)throw Error('Invalid accounting.');
    const totalBytes=this.state.bytes+bytes,totalCandidates=this.state.candidates+candidates;
    if(!Number.isSafeInteger(totalBytes)||!Number.isSafeInteger(totalCandidates))throw Error('Cumulative accounting exceeds supported safe integer bounds.');
    this.state.bytes=totalBytes;this.state.candidates=totalCandidates;r.state=outcome;r.released=outcome==='known_not_sent'||remote_release_verified;
    this.state.attempts.push({event:'terminal',reservation_id:id,outcome,remote_release_verified,bytes,candidates});
    if(this.state.bytes>this.limits.max_bytes||this.state.candidates>this.limits.max_candidates)this.state.halted=true;
    if(outcome==='scoped_negative'&&this.negative_ids.has(r.task_id)&&!this.state.negatives.includes(r.task_id))this.state.negatives.push(r.task_id);
  }
  // A planning event is not physical proof. Only the stage may adopt this after
  // its global manager has revalidated an exact pinned-host receipt.
  adoptPhysicalRelease(id,{receipt_sha256,at}){
    if(typeof receipt_sha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt_sha256)||!uint(at))throw Error('Invalid physical-release journal data.');
    const r=this.state.reservations.find(r=>r.id===id),prior=this.state.attempts.find(e=>e.event==='physical_release'&&e.reservation_id===id);
    if(prior){if(prior.receipt_sha256!==receipt_sha256||prior.at!==at)throw Error('Original release event cannot be replaced.');return false;}
    if(!r||r.state==='admitted'||r.state==='known_not_sent'||r.released)throw Error('Original held terminal reservation is required.');
    r.released=true;this.state.attempts.push({event:'physical_release',reservation_id:id,receipt_sha256,at});return true;
  }
  investigate(){if(this.state.halted)return false;const accepted=this.state.investigations<this.limits.max_investigations;this.state.attempts.push({event:'investigation',accepted});if(accepted)this.state.investigations++;else this.state.halted=true;return accepted;}
  retire(resource_group){
    // The retirement tombstone survives release of every original reservation.
    const outstanding=this.state.reservations.filter(r=>r.resource_group===resource_group&&!r.released&&r.retired!==true);
    if(!outstanding.length)return false;
    for(const r of outstanding)r.retired=true;
    this.state.attempts.push({event:'retired',resource_group,reservations_preserved:true});return true;
  }
  snapshot(){return JSON.parse(JSON.stringify({schema:'momm-bumble-plan/2',limits:this.limits,negative_ids:[...this.negative_ids],state:this.state}));}
  coverage(){return {audit:this.negative_ids.size>0&&this.state.negatives.length>=this.limits.minimum_negatives?'sample_met':'audit_unmet',unresolved_reservations:this.state.reservations.filter(r=>!r.released).length,halted:this.state.halted,completion:false,quorum_votes:0};}
}
