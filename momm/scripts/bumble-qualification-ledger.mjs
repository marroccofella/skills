// Native qualification requires owner-private journal provenance, not selected model claims.
import {BumbleFixtureLedger} from './bumble-fixtures.mjs';
import {qualificationBinding,fixtureFrameBinding,qualifyBumble,qualificationStatus} from './bumble-qualification.mjs';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function verifiedLedger(ledger,scope_binding){
  if(!(ledger instanceof BumbleFixtureLedger)||!sha(scope_binding))throw Error('Owned fixture journal is required.');
  const summary=ledger.summary();
  if(summary.scope_binding!==scope_binding||summary.quorum_votes!==0)throw Error('Fixture journal operator/disclosure binding mismatch.');
  return summary;
}
function bindObservations(params,ledger,summary){
  const frame=ledger.frame().filter(f=>f.split==='qualification');
  if(fixtureFrameBinding(params.frame)!==fixtureFrameBinding(frame))throw Error('Qualification frame is not the precommitted journal frame.');
  const binding=qualificationBinding(params.identity);
  if(!Array.isArray(params.observations))throw Error('Qualification observations must be supplied.');
  return params.observations.map(input=>{
    if(!input||![Object.prototype,null].includes(Object.getPrototypeOf(input))||!Object.values(Object.getOwnPropertyDescriptors(input)).every(d=>d.enumerable&&Object.hasOwn(d,'value')))throw Error('Qualification observation must be plain owned data.');
    const o={...input};
    const a=summary.attempts.find(a=>a.attempt_id===o.attempt_id);
    if(!a||a.fixture_id!==o.fixture_id||a.binding!==binding||a.purpose!=='qualification'||a.fresh_evidence!==true||a.transmission_possible!==true||a.state!=='terminal'||a.outcome!=='success'||!Number.isSafeInteger(a.terminal_at)||o.observed_at<a.terminal_at||a.terminal_at>params.now)throw Error('Observation lacks its original completed fresh qualification attempt.');
    if((params.require_anchor&&!Object.hasOwn(o,'attempt_finished_at'))||(Object.hasOwn(o,'attempt_finished_at')&&o.attempt_finished_at!==a.terminal_at))throw Error('Qualification age is not anchored to its original attempt.');
    return {...o,attempt_finished_at:a.terminal_at};
  });
}
export function qualifyBumbleWithLedger(params,{ledger,scope_binding}){
  const summary=verifiedLedger(ledger,scope_binding);
  const observations=bindObservations(params,ledger,summary);
  const qualification=qualifyBumble({...params,observations});
  return Object.freeze({schema:'momm-bumble-qualification-with-ledger/2',qualification,
    ledger_binding:Object.freeze({scope_binding,event_count:summary.event_count,journal_sha256:summary.journal_sha256,frame_binding:summary.frame_binding}),quorum_votes:0});
}
export function qualificationStatusWithLedger(envelope,options={}){
  const no=reason=>({eligible:false,reason,quorum_votes:0});
  try{
    const {ledger,scope_binding,identity,policy,now}=options??{};
    if(!envelope||envelope.schema!=='momm-bumble-qualification-with-ledger/2'||envelope.quorum_votes!==0)return no('absent_or_invalid_journal_qualification');
    const summary=verifiedLedger(ledger,scope_binding),binding=envelope.ledger_binding;
    if(!binding||binding.scope_binding!==scope_binding||binding.frame_binding!==summary.frame_binding||!ledger.hasCheckpoint(binding))return no('journal_binding_changed');
    const record=envelope.qualification;
    bindObservations({identity,frame:record.frame,observations:record.evidence,now:record.issued_at,require_anchor:true},ledger,summary);
    return qualificationStatus(record,{identity,policy,now});
  }catch{return no('invalid_journal_qualification');}
}
