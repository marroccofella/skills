// Governor-authored review probes. The compatibility seam selects the old/new draft cap name.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {qualificationBinding,fixtureFrameBinding,qualifyBumble,qualificationStatus} from './bumble-qualification.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // each suite owns its fixture evidence location
const source=fs.readFileSync(new URL('./bumble-qualification.mjs',import.meta.url),'utf8');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const recordDigest=value=>digest(JSON.stringify(source.includes('canonicalValue')?canonical(value):value));
const now=5000;
const frame=[{id:'defect',kind:'defect',sha256:digest('defect'),split:'qualification'},{id:'control',kind:'control',sha256:digest('control'),split:'qualification'}];
const H=digest('bound');
const identity={worker_id:'w',connector_id:'c',endpoint_id:'e',adapter_sha256:H,model_lineage_sha256:H,task_type:'t',role_version:'1',role_sha256:H,schema_sha256:H,fixture_suite_sha256:fixtureFrameBinding(frame),config_epoch:'1',credential_epoch:'1',trust_sha256:H};
const policy={schema:'momm-bumble-qualification-policy/1',policy_id:'p',task_type:'t',required_defects:1,required_controls:1,max_missed_defects:0,max_false_candidates:0,lifetime_ms:1000,[source.includes('max_observations')?'max_observations':'max_attempts']:2};
const observations=frame.map(f=>({fixture_id:f.id,fixture_sha256:f.sha256,attempt_id:f.id,identity_binding:qualificationBinding(identity),transport:'success',payload:'valid',result:f.kind==='defect'?'candidate':'no_candidate_in_supplied_scope',governor_assessment:f.kind==='defect'?'reproduced_candidate':'scoped_negative_verified',evidence_sha256:digest(f.id+'-evidence'),observed_at:now}));
const make=(changes={})=>qualifyBumble({identity,policy,frame,observations,now,...changes});
const forged=(record,changes)=>{const {record_sha256,...data}=record;Object.assign(data,changes);return {...data,record_sha256:recordDigest(data)};};
const cases={
  status(){for(const obs of [[],observations.map(o=>({...o,observed_at:now-1000}))]){const r=make({observations:obs});assert.equal(r.status,'incomplete');assert.equal(qualificationStatus(r,{identity,policy,now}).reason,'incomplete');}},
  policy(){assert.throws(()=>make({policy:{...policy,max_missed_defects:1,max_false_candidates:1}}));},
  options(){assert.deepEqual(qualificationStatus(null),{eligible:false,reason:'absent',quorum_votes:0});assert.equal(qualificationStatus(make(),null).eligible,false);},
  raw(){const getter={...identity};let reads=0;Object.defineProperty(getter,'task_type',{get:()=> ++reads<=3?'t':'other',enumerable:true});assert.throws(()=>{const r=make({identity:getter});console.log(JSON.stringify({returned_task_type:r.task_type,expected_hashed_task_type:'t'}));});},
  frame(){assert.throws(()=>make({policy:{...policy,required_controls:2}}));},
  integrity(){const r=make();assert.equal(qualificationStatus(forged(r,{}),{identity,policy,now}).eligible,true,'unmodified re-digested record must remain eligible');for(const change of [{expires_at:r.expires_at+10000},{fixture_binding:digest('wrong')},{counts:{...r.counts,unresolved:1}}])assert.equal(qualificationStatus(forged(r,change),{identity,policy,now}).eligible,false);},
  evidence(){const r=make();for(const e of r.evidence){const o=observations.find(o=>o.fixture_id===e.fixture_id);assert.equal(e.result,o.result);assert.equal(e.governor_assessment,o.governor_assessment);}},
  reorder(){const r=make(),reordered=Object.fromEntries(Object.entries(r).reverse());assert.equal(qualificationStatus(reordered,{identity,policy,now}).eligible,true);},
  budget(){const {max_attempts,max_observations,...rest}=policy;assert.equal(make({policy:{...rest,max_observations:2}}).status,'qualified');assert.throws(()=>make({observations:[...observations,observations[0]]}),/budget/i);},
  existing_tests(){assert(fs.existsSync(new URL('./bumble-qualification.test.mjs',import.meta.url)));const r=make();assert.equal(qualificationStatus(r,{identity,policy,now:now+1000}).reason,'expired');assert.throws(()=>make({observations:[observations[0],observations[0]]}));}
};
const selected=process.argv[2];
if(selected){assert(cases[selected]);cases[selected]();}else for(const test of Object.values(cases))test();
console.log(JSON.stringify({passed:true,case:selected||'all',network_calls:0,scope:'offline authored qualification probes, not a live worker benchmark'}));
