// Trusted governor-adjudicated records, not worker self-certification or release votes.
// Checksums bind bytes consistently; private provenance/permissions remain caller obligations.
import crypto from 'node:crypto';
const canonicalValue=value=>Array.isArray(value)?value.map(canonicalValue):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalValue(value[key])])):value;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
const isHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const time=value=>Number.isSafeInteger(value)&&value>=0;
const fields=(value,names)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![null,Object.prototype].includes(Object.getPrototypeOf(value)))return false;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  return Object.keys(descriptors).length===names.length&&names.every(name=>descriptors[name]?.enumerable===true&&Object.hasOwn(descriptors[name],'value'));
};
const IDENTITY_FIELDS=['worker_id','connector_id','endpoint_id','adapter_sha256','model_lineage_sha256','task_type','role_version','role_sha256','schema_sha256','fixture_suite_sha256','config_epoch','credential_epoch','trust_sha256'];
const POLICY_FIELDS=['schema','policy_id','task_type','required_defects','required_controls','max_missed_defects','max_false_candidates','lifetime_ms','max_observations'];
function identityValue(identity){
  if(!fields(identity,IDENTITY_FIELDS)||!IDENTITY_FIELDS.every(key=>key.endsWith('_sha256')?isHash(identity[key]):text(identity[key])))throw Error('Invalid qualification identity.');
  return Object.fromEntries(IDENTITY_FIELDS.map(key=>[key,identity[key]]));
}
function policyValue(policy){
  if(!fields(policy,POLICY_FIELDS)||policy.schema!=='momm-bumble-qualification-policy/1'||!text(policy.policy_id)||!text(policy.task_type))throw Error('Invalid qualification policy.');
  for(const key of ['required_defects','required_controls','max_missed_defects','max_false_candidates','max_observations'])if(!Number.isSafeInteger(policy[key])||policy[key]<0||policy[key]>1000)throw Error('Invalid fixture budget.');
  if(policy.required_defects<1||policy.required_controls<1||policy.max_observations<2||policy.max_missed_defects>=policy.required_defects||policy.max_false_candidates>=policy.required_controls||!time(policy.lifetime_ms)||policy.lifetime_ms<1||policy.lifetime_ms>7*86400000)throw Error('Invalid qualification threshold or expiry.');
  return Object.fromEntries(POLICY_FIELDS.map(key=>[key,policy[key]]));
}
function frameValue(frame){
  if(!Array.isArray(frame)||frame.length<2||frame.length>1000)throw Error('Invalid qualification fixture frame.');
  const ids=new Set(),hashes=new Set();
  return frame.map(f=>{
    if(!fields(f,['id','kind','sha256','split'])||!text(f.id)||!['defect','control'].includes(f.kind)||!isHash(f.sha256)||f.split!=='qualification'||ids.has(f.id)||hashes.has(f.sha256))throw Error('Duplicate, unbound or non-qualification fixture.');
    ids.add(f.id);hashes.add(f.sha256);return {id:f.id,kind:f.kind,sha256:f.sha256,split:f.split};
  });
}
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export const qualificationBinding=identity=>hash(identityValue(identity));
export const fixtureFrameBinding=frame=>hash(frameValue(frame));

export function qualifyBumble({identity,policy,frame,observations,now}){
  if(!time(now))throw Error('Invalid qualification time.');
  const boundIdentity=identityValue(identity),boundPolicy=policyValue(policy),fixtures=frameValue(frame);
  identity=boundIdentity;policy=boundPolicy;
  if(identity.task_type!==policy.task_type||identity.fixture_suite_sha256!==hash(fixtures))throw Error('Task or fixture-frame binding mismatch.');
  if(fixtures.filter(f=>f.kind==='defect').length<policy.required_defects||fixtures.filter(f=>f.kind==='control').length<policy.required_controls)throw Error('Fixture frame cannot meet qualification policy.');
  // This is a bounded record validator, not the durable live dispatch/fixture-burn ledger.
  if(fixtures.length>policy.max_observations||!Array.isArray(observations)||observations.length>policy.max_observations)throw Error('Qualification observation budget exceeded.');
  const byId=new Map(fixtures.map(f=>[f.id,f])),seen=new Set(),attempts=new Set(),binding=hash(boundIdentity);
  const counts={defects:0,controls:0,missed_defects:0,false_candidates:0,unresolved:0};
  const evidence=[];
  const validResults=['candidate','no_candidate_in_supplied_scope','insufficient_context','abstain','refused'];
  const transports=['success','known_not_sent','transport_error','outcome_unknown','cancelled','refused','stale','authentication_required','policy_required','timeout'];
  const payloads=['valid','invalid','unavailable','stale'];
  const assessments=['reproduced_candidate','missed_defect','scoped_negative_verified','false_candidate','inconclusive'];
  for(const o of observations){
    const names=['fixture_id','fixture_sha256','attempt_id','identity_binding','transport','payload','result','governor_assessment','evidence_sha256','observed_at',...(o&&Object.hasOwn(o,'attempt_finished_at')?['attempt_finished_at']:[])];
    if(!fields(o,names))throw Error('Invalid qualification observation shape.');
    const f=byId.get(o.fixture_id);
    const resultAbsent=o.result===null&&(o.transport!=='success'||o.payload!=='valid');
    if(!f||seen.has(o.fixture_id)||!text(o.attempt_id)||attempts.has(o.attempt_id)||o.fixture_sha256!==f.sha256||o.identity_binding!==binding||!isHash(o.evidence_sha256)||!time(o.observed_at)||o.observed_at>now||!assessments.includes(o.governor_assessment)||!transports.includes(o.transport)||!payloads.includes(o.payload)||(!validResults.includes(o.result)&&!resultAbsent))throw Error('Invalid, replayed or unbound qualification observation.');
    if(Object.hasOwn(o,'attempt_finished_at')&&(!time(o.attempt_finished_at)||o.attempt_finished_at>o.observed_at))throw Error('Invalid original attempt time anchor.');
    seen.add(o.fixture_id);attempts.add(o.attempt_id);
    evidence.push(Object.fromEntries(names.map(name=>[name,o[name]])));
    if(o.transport!=='success'||o.payload!=='valid'||now-(o.attempt_finished_at??o.observed_at)>=policy.lifetime_ms||o.governor_assessment==='inconclusive'){counts.unresolved++;continue;}
    if(f.kind==='defect'){
      if(o.result==='candidate'&&o.governor_assessment==='reproduced_candidate')counts.defects++;
      else if(o.result==='no_candidate_in_supplied_scope'&&o.governor_assessment==='missed_defect'){counts.defects++;counts.missed_defects++;}
      else counts.unresolved++;
    }else{
      if(o.result==='no_candidate_in_supplied_scope'&&o.governor_assessment==='scoped_negative_verified')counts.controls++;
      else if(o.result==='candidate'&&o.governor_assessment==='false_candidate'){counts.controls++;counts.false_candidates++;}
      else counts.unresolved++;
    }
  }
  counts.unresolved+=fixtures.length-seen.size;
  const status=counts.missed_defects>policy.max_missed_defects||counts.false_candidates>policy.max_false_candidates?'failed':counts.unresolved||counts.defects<policy.required_defects||counts.controls<policy.required_controls?'incomplete':'qualified';
  const issued=now,expires=evidence.length?Math.min(...evidence.map(e=>e.attempt_finished_at??e.observed_at))+policy.lifetime_ms:now;
  if(!time(expires))throw Error('Qualification expiry exceeds supported time bounds.');
  const record={schema:'momm-bumble-qualification/1',identity_binding:binding,policy_binding:hash(boundPolicy),fixture_binding:hash(fixtures),task_type:identity.task_type,status,counts,evidence,frame:fixtures,issued_at:issued,expires_at:expires,quorum_votes:0};
  return freeze({...record,record_sha256:hash(record)});
}

export function qualificationStatus(record,options={}){
  const no=reason=>({eligible:false,reason,quorum_votes:0});
  if(!record)return no('absent');
  try{
    const {identity,policy,now}=options??{};
    const names=['schema','identity_binding','policy_binding','fixture_binding','task_type','status','counts','evidence','frame','issued_at','expires_at','quorum_votes','record_sha256'];
    if(!fields(record,names)||!time(now)||record.schema!=='momm-bumble-qualification/1'||record.quorum_votes!==0||!time(record.issued_at)||!time(record.expires_at)||record.issued_at>now||!['qualified','failed','incomplete'].includes(record.status))return no('invalid_record');
    if(!fields(record.counts,['defects','controls','missed_defects','false_candidates','unresolved'])||!Object.values(record.counts).every(value=>Number.isSafeInteger(value)&&value>=0&&value<=1000))return no('invalid_record');
    if(record.identity_binding!==qualificationBinding(identity)||record.policy_binding!==hash(policyValue(policy))||record.task_type!==identity.task_type)return no('binding_changed');
    const expected=qualifyBumble({identity,policy,frame:record.frame,observations:record.evidence,now:record.issued_at});
    const {record_sha256,...body}=record;
    if(!isHash(record_sha256)||hash(body)!==record_sha256||expected.record_sha256!==record_sha256)return no('invalid_record');
    if(record.status!=='qualified')return no(record.status==='failed'?'failed':'incomplete');
    if(now>=record.expires_at)return no('expired');
    return {eligible:true,reason:'qualified_for_bound_task_only',quorum_votes:0};
  }catch{return no('invalid_record');}
}
