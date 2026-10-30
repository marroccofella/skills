// Governor-authored boundary regressions; synthetic markers only, zero network calls.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {qualificationBinding,fixtureFrameBinding,qualifyBumble} from './bumble-qualification.mjs';
import {BumblePlan} from './bumble-plan.mjs';
import {validateOpenAIEnvelope} from './bumble-http-worker.mjs';
import * as transportModule from './bumble-transport.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=v=>crypto.createHash('sha256').update(v).digest('hex');
const frame=[['d','defect'],['c','control']].map(([id,kind])=>({id,kind,sha256:H(id),split:'qualification'}));
const identity={worker_id:'w',connector_id:'c',endpoint_id:'e',adapter_sha256:H('a'),model_lineage_sha256:H('m'),task_type:'t',role_version:'1',role_sha256:H('r'),schema_sha256:H('s'),fixture_suite_sha256:fixtureFrameBinding(frame),config_epoch:'1',credential_epoch:'1',trust_sha256:H('trust')};
const policy={schema:'momm-bumble-qualification-policy/1',policy_id:'p',task_type:'t',required_defects:1,required_controls:1,max_missed_defects:0,max_false_candidates:0,lifetime_ms:1000,max_observations:2};
const observations=frame.map(f=>({fixture_id:f.id,fixture_sha256:f.sha256,attempt_id:f.id,identity_binding:qualificationBinding(identity),transport:'success',payload:'valid',result:f.kind==='defect'?'candidate':'no_candidate_in_supplied_scope',governor_assessment:f.kind==='defect'?'reproduced_candidate':'scoped_negative_verified',evidence_sha256:H(f.id+'-e'),observed_at:5000}));
const qualification=changes=>qualifyBumble({identity,policy,frame,observations:observations.map((o,i)=>i===0?{...o,...changes}:o),now:5000});
const limits={global:1,per_group:1,max_tasks:2,max_candidates:2,max_bytes:100,max_investigations:2,deadline:100,minimum_negatives:1,negative_ids:['a']};
const admitted=()=>{const p=new BumblePlan(limits);p.admit({task_id:'a',resource_group:'g',source_ip_group:'ip'},1);return p;};
const envelope=content=>' {"model":"fixture-model","choices":[{"finish_reason":"stop","message":{"content":'+content+'}}]}';
const http=(raw,credential)=>validateOpenAIEnvelope(Buffer.from(raw),{model_id:'fixture-model',task_id:'fixture-task',attempt_id:'fixture-attempt',deadline:100,now:1,credential});
// Before the pure projection export existed, execute only its actual parsing block.
// This fixture never runs the policy, credential or process path and cannot activate it.
function projection(){
  if(typeof transportModule.validateBumbleTransportReply==='function')return transportModule.validateBumbleTransportReply;
  const source=fs.readFileSync(new URL('./bumble-transport.mjs',import.meta.url),'utf8');
  const begin=source.indexOf('const unknown=()=>'),ending='return {...reply,quorum_votes:0,completion:false};',end=source.indexOf(ending,begin);
  assert(begin>=0&&end>begin,'the original production stdout-validation block must be present');
  return vm.runInNewContext('(job,execution)=>{'+source.slice(begin,end+ending.length)+'}',{JSON});
}
const job={task:{task_id:'synthetic-task',attempt_id:'synthetic-attempt'}};
const reply={schema:'momm-bumble-http-attempt/1',task_id:job.task.task_id,attempt_id:job.task.attempt_id,transport:'success',payload:'envelope_valid',finished:true,content:'source-grounded synthetic result',finish_reason:'stop',reported_usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3},reported_model:'synthetic-model',raw_envelope_sha256:H('synthetic'),quorum_votes:0};
const project=v=>projection()(job,{code:0,stdout:JSON.stringify(v)});
const cases={
 qualificationAbsent(){const r=qualification({transport:'transport_error',payload:'unavailable',result:null,governor_assessment:'inconclusive'});assert.equal(r.status,'incomplete');assert.equal(r.counts.unresolved,1);assert.equal(r.evidence[0].result,null);assert.equal(r.quorum_votes,0);},
 qualificationAxes(){assert.throws(()=>qualification({transport:'invented'}),/observation|status|axes/i);assert.throws(()=>qualification({payload:'invented'}),/observation|status|axes/i);assert.equal(qualification({}).status,'qualified');assert.throws(()=>qualification({result:null}),/observation|status|axes/i);},
 planUnknown(){const s=admitted().snapshot();s.state.reservations[0].state='invented';assert.throws(()=>new BumblePlan(limits,s),/restored|reservation|outcome/i);},
 planReleased(){const s=admitted().snapshot();s.state.reservations[0].released=true;assert.throws(()=>new BumblePlan(limits,s),/restored|reservation|release/i);},
 planHalted(){const p=admitted();p.terminal(p.state.reservations[0].id,'candidate',{bytes:101,candidates:1});assert.equal(p.coverage().halted,true);assert.equal(p.investigate(),false);assert.equal(p.state.investigations,0);},
 planUnsent(){const p=admitted();p.terminal(p.state.reservations[0].id,'known_not_sent');assert.equal(p.coverage().unresolved_reservations,0);assert(p.admit({task_id:'b',resource_group:'g',source_ip_group:'ip'},2));},
 planControls(){const p=admitted();assert.equal(new BumblePlan(limits,p.snapshot()).state.tasks,1);assert.equal(p.investigate(),true);assert.equal(p.state.investigations,1);},
 reflection(){for(const marker of ['synthetic-marker','synthetic/marker']){const quoted=marker.includes('/')?JSON.stringify(marker).replace('/','\\/'):'"'+[...marker].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('')+'"';const r=http(envelope(quoted),marker);assert.equal(r.payload,'credential_reflection');assert.equal(r.content,null);}assert.equal(http(envelope('"clean result"'),'synthetic-marker').payload,'envelope_valid');assert.equal(http(envelope('"synthetic-marker"'),'synthetic-marker').payload,'credential_reflection');},
 projection(){const r=project({...reply,remote_release_verified:true,admitted:true});assert(r.transport==='outcome_unknown'||(!Object.hasOwn(r,'remote_release_verified')&&!Object.hasOwn(r,'admitted')));assert.equal(project({...reply,payload:'qualified_for_release'}).transport,'outcome_unknown');assert.equal(project({...reply,content:null}).transport,'outcome_unknown');},
 projectionControls(){const r=project(reply);assert.equal(r.transport,'success');assert.equal(r.content,reply.content);assert.equal(r.quorum_votes,0);assert.equal(r.completion,false);assert.equal(project({...reply,task_id:'wrong'}).transport,'outcome_unknown');assert.equal(projection()(job,{code:0,stdout:'not JSON'}).transport,'outcome_unknown');},
 async closedPolicy(){let spawned=0,touched=0;const adapter=transportModule.createBumbleTransport(()=>{spawned++;throw Error('No spawn allowed');});const r=await adapter.dispatch(new Proxy({},{get(){touched++;throw Error('No handoff read allowed');}}));assert.equal(r.transport,'policy_required');assert.equal(spawned,0);assert.equal(touched,0);}
};
const selected=process.argv[2];if(selected){assert(cases[selected]);await cases[selected]();}else for(const test of Object.values(cases))await test();
console.log(JSON.stringify({passed:true,case:selected||'all',checks:Object.keys(cases).length,network_calls:0,credentials_read:false,policy_activated:false,scope:'pure offline record, planner, envelope and stdout boundaries; not live qualification'}));
