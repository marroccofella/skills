// Governor-authored probes of source review claims. Synthetic stores, no sends.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
import {realTempDir} from '../scripts/private-test-fixture.mjs';
import {BumbleStage} from '../scripts/bumble-stage.mjs';import {BumbleCapacity} from '../scripts/bumble-capacity.mjs';import {BumbleFixtureLedger} from '../scripts/bumble-fixtures.mjs';
import {qualificationBinding,fixtureFrameBinding} from '../scripts/bumble-qualification.mjs';import {qualifyBumbleWithLedger} from '../scripts/bumble-qualification-ledger.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const selected=process.argv.includes('--case')?process.argv[process.argv.indexOf('--case')+1]:'all';assert(['all','terminal_send','denied_output','capacity_quality_alias','capacity_quality_path','capacity_quality_metadata'].includes(selected));
// Test the test's discrimination using bounded governor-authored mutations in
// an isolated process; production files and private real jobs are never edited.
function capacityQuality(kind){
 const scripts=fileURLToPath(new URL('../scripts/',import.meta.url));
 let program=fs.readFileSync(new URL('../scripts/bumble-stage-capacity.test.mjs',import.meta.url),'utf8').replace(/from '(\.\/[^']+)'/g,(_match,relative)=>"from '"+pathToFileURL(path.resolve(scripts,relative)).href+"'");
 const mutation=kind==='alias'?"const originalReserve=BumbleStage.prototype.reserve; BumbleStage.prototype.reserve=function(q){if(q.resource_group==='renamed-gpu')return {admitted:false,reason:'global_capacity_or_budget',quorum_votes:0};return originalReserve.call(this,q);};\n":kind==='path'?"BumbleStage.prototype.reconcile=function(id){if(id==='foreign:stream')return fs.lstatSync(path.join(parent,'stage','result-'+id+'.json'));throw Error('Unexpected mutation invocation');};\n":'';
 if(mutation)program=program.replace('delete process.env.MOMM_EVIDENCE_HOME;',mutation+'delete process.env.MOMM_EVIDENCE_HOME;');
 const r=spawnSync(process.execPath,['--input-type=module'],{input:program,encoding:'utf8',cwd:path.resolve(scripts,'../..'),env:{...process.env,MOMM_NO_UPDATE_CHECK:'1',NO_UPDATE_CHECK:'1'},timeout:180000,maxBuffer:1000000,windowsHide:true});
 assert.equal(r.error,undefined,'bounded mutation child must finish, not time out');
 if(kind==='metadata'){assert.equal(r.status,0,r.stderr);const output=JSON.parse(r.stdout.trim().split('\n').at(-1));assert.equal(Object.hasOwn(output,'network_calls'),false,'do not report a constant as measured network instrumentation');}
 else{assert.equal(r.status,1,'the canonical suite must detect this targeted test-boundary mutation');assert.match(r.stderr,kind==='alias'?/capacity_binding_mismatch/:/unknown caller identities never select evidence filenames/);}
}
if(selected.startsWith('capacity_quality_')){capacityQuality(selected.slice('capacity_quality_'.length));console.log(JSON.stringify({passed:true,case:selected,scope:'Bounded mutation discrimination of the canonical capacity test, not transport or backend qualification'}));process.exit(0);}
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),parent=realTempDir('momm-stage-review-'),source='const n = 1;';
const frame=[['d','defect'],['c','control']].map(([id,kind])=>({id,kind,sha256:H(id),split:'qualification'}));
const worker={worker_id:'w',connector_id:'c',endpoint_id:'e',adapter_sha256:H('a'),model_lineage_sha256:H('m'),task_type:'t',role_version:'1',role_sha256:H('r'),schema_sha256:H('s'),fixture_suite_sha256:fixtureFrameBinding(frame),config_epoch:'1',credential_epoch:'1',trust_sha256:H('trust')};
const policy={schema:'momm-bumble-qualification-policy/1',policy_id:'p',task_type:'t',required_defects:1,required_controls:1,max_missed_defects:0,max_false_candidates:0,lifetime_ms:10000,max_observations:2},scope_binding=H('synthetic-owner-scope');
let passed=0,failed=0;const observations=[];
try{
 const ledger=new BumbleFixtureLedger({root:path.join(parent,'qualification'),frame,scope_binding,budget:{max_total_attempts:2,max_transmissions:2,deadline:1000}}),items=[];
 for(let n=0;n<2;n++){const f=frame[n],a=ledger.reserve(f.id,{purpose:'qualification',binding:qualificationBinding(worker),now:1+3*n});ledger.markTransmissionPossible(a.attempt_id,2+3*n);ledger.finish(a.attempt_id,{outcome:'success',now:3+3*n});items.push({fixture_id:f.id,fixture_sha256:f.sha256,attempt_id:a.attempt_id,identity_binding:qualificationBinding(worker),transport:'success',payload:'valid',result:f.kind==='defect'?'candidate':'no_candidate_in_supplied_scope',governor_assessment:f.kind==='defect'?'reproduced_candidate':'scoped_negative_verified',evidence_sha256:H(f.id+'-e'),observed_at:10});}
 const qualification=qualifyBumbleWithLedger({identity:worker,policy,frame,observations:items,now:10},{ledger,scope_binding}),qualification_options={ledger,scope_binding,policy};
 const report={run_id:'rev_synthetic_stage_review',governor:'codex',input_sha256:H(source),input_bytes:Buffer.byteLength(source),gate_policy:{quorum_required:2},quorum:{required:2,met:true},reviewers:[{agent:'claude',status:'success'},{agent:'copilot',status:'success'}]};
 function fixture(name){const root=path.join(parent,name),capacity=new BumbleCapacity({root:path.join(parent,name+'-capacity'),config:{schema:'momm-bumble-capacity/1',global_slots:1,max_attempts:4,max_reserved_tokens:100000,deadline:1000,resource_groups:[{id:'gpu',slots:1}],source_ip_groups:[{id:'ip',slots:1}],endpoints:[{id:'e',resource_group:'gpu',source_ip_group:'ip'}]}}),task_frame=['first','second'].map(id=>({id,task:{run_id:report.run_id,piece_id:'whole',source,scope:[{file:'fixture.js',start_line:1,text:source}],check:'Check supplied source: '+id,deadline:500,budget:{response_bytes:4096,candidates:1},role_version:'1',task_type:'t'}}));return {root,capacity,stage:new BumbleStage({root,source,baseline_bytes:Buffer.from(JSON.stringify(report)),limits:{global:1,per_group:1,max_tasks:2,max_candidates:4,max_bytes:5000,max_investigations:1,deadline:1000,negative_ids:['first'],minimum_negatives:1},task_frame,capacity})};}
 const request=(check_id,now)=>({identity:worker,qualification,qualification_options,check_id,now});
 function test(name,fn){try{const observation=fn();passed++;observations.push({name,status:'passed',...observation});}catch(error){failed++;observations.push({name,status:'failed',...(error.observation||{})});}}
 if(selected==='all'||selected==='terminal_send')test('sealed known-not-sent result excludes later transmission permission',()=>{
  const f=fixture('terminal'),a=f.stage.reserve(request('first',11));assert(a.admitted);const terminal=f.capacity.terminal;f.capacity.terminal=()=>{throw Error('Synthetic pre-commit failure');};try{assert.throws(()=>f.stage.finish(a.reservation_id,{bytes:'',transport:'known_not_sent',finished:false,now:12}),/Synthetic pre-commit failure/);}finally{f.capacity.terminal=terminal;}
  const result=path.join(f.root,'result-'+a.reservation_id+'.json'),intent=path.join(f.root,'terminal-intent-'+a.reservation_id+'.json'),original=fs.readFileSync(result),originalIntent=fs.readFileSync(intent);let refused=false,permit=null;try{permit=f.stage.markTransmissionPossible(a.reservation_id,13);}catch(error){assert.match(String(error.message),/terminal|sealed|known_not_sent/i,'only the intended original-terminal refusal satisfies this probe');refused=true;}
  const observation={refused,dispatch_authorized:permit?.dispatch_authorized??false,original_result_unchanged:fs.readFileSync(result).equals(original),original_intent_unchanged:fs.readFileSync(intent).equals(originalIntent),physical_holds:f.capacity.summary().held};
  try{assert(refused,'Sealed terminal evidence must exclude a later send permit');assert.equal(observation.dispatch_authorized,false);assert(observation.original_result_unchanged);assert(observation.original_intent_unchanged);assert.equal(observation.physical_holds,1);}catch(error){error.observation=observation;throw error;}return observation;
 });
 if(selected==='all'||selected==='denied_output')test('a closed admission denial cannot consume future output headroom',()=>{
  const f=fixture('denied'),reserve=f.capacity.reserve;let calls=0;f.capacity.reserve=function(input){if(++calls===1)return {admitted:false};return reserve.call(this,input);};
  const first=f.stage.reserve(request('first',11));assert.equal(first.admitted,false);const second=f.stage.reserve(request('second',12)),observation={first_admitted:first.admitted,second_admitted:second.admitted,second_reason:second.reason??null,capacity_calls:calls};
  try{assert.equal(second.admitted,true,'Closed denial has zero outstanding response bytes/candidates');assert.equal(calls,2);}catch(error){error.observation=observation;throw error;}return observation;
 });
 if(selected==='all')for(const kind of ['alias','path','metadata'])test('capacity test mutation discrimination: '+kind,()=>{capacityQuality(kind);return {mutation:kind};});
}finally{if(!path.basename(parent).startsWith('momm-stage-review-')||fs.realpathSync.native(parent)!==parent)throw Error('Cleanup outside owned synthetic fixture');fs.rmSync(parent,{recursive:true,force:true});}
console.log(JSON.stringify({selected,passed,failed,observations,activity_instrumentation:'not_measured_by_this_fixture',scope:'Actual local send-permit and output-budget seams with synthetic baseline/qualification, not live admission or release'}));if(failed)process.exitCode=1;
