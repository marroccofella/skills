// Governor-authored concrete probes for the implementation review; no live inference.
import assert from 'node:assert/strict';
import {makeBumbleTask,validateBumbleResponse as validateResponse} from './bumble-contract.mjs';
import {BumblePlan} from './bumble-plan.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
delete process.env.MOMM_EVIDENCE_HOME;
// Known synthetic completed bodies only; negative axes override explicitly.
const validateBumbleResponse=(task,bytes,options)=>validateResponse(task,bytes,{transport:'success',finished:true,...options});
const task=()=>makeBumbleTask({run_id:'fixture',piece_id:'p1',source:'first\nsecond',scope:[{file:'a.js',start_line:1,text:'first'},{file:'a.js',start_line:2,text:'second'}],check:'Check supplied lines',deadline:1000,budget:{response_bytes:4096,candidates:2}});
const cases={
  newline(){const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'newlineChild'],{timeout:1000,encoding:'utf8',windowsHide:true});assert.equal(child.status,0,'a newline-leading ungrounded quote must not hang validation');},
  newlineChild(){const t=makeBumbleTask({run_id:'r',piece_id:'p',source:'alpha\nbeta\ngamma',scope:[{file:'a.js',start_line:1,text:'alpha\nbeta\ngamma'}],check:'Check span',deadline:1000,budget:{response_bytes:4096,candidates:2}});const body=JSON.stringify({task_id:t.task_id,result:'candidate',candidates:[{file:'a.js',location:'1',quote:'\ngamma',hypothesis:'h',trigger:'t',missing_information:[]}],limitations:[]});assert.equal(validateBumbleResponse(t,body,{now:1}).payload,'invalid_schema');},
  deadline(){const t=task();assert.equal(validateBumbleResponse(t,JSON.stringify({task_id:t.task_id,result:'no_candidate_in_supplied_scope',candidates:[],limitations:[]}),{now:t.deadline}).payload,'stale');},
  metadata(){const input={run_id:'fixture',piece_id:'p1',source:'first',scope:[{file:'a.js',start_line:1,text:'first'}],check:'Check supplied line',deadline:1000,budget:{response_bytes:4096,candidates:2}};for(const changed of [{run_id:undefined},{omissions:['x'.repeat(501)]},{mandatory:'yes'},{role_version:'x'.repeat(201)},{budget:{...input.budget,permissions:'write'}}])assert.throws(()=>makeBumbleTask({...input,...changed}),/task|metadata|scope/i);},
  retirement(){const limits={deadline:1000,max_tasks:1};const p=new BumblePlan(limits);p.admit({task_id:'t',resource_group:'g',source_ip_group:'ip'},1);for(let i=0;i<20;i++)p.retire('g');assert.doesNotThrow(()=>new BumblePlan(limits,p.snapshot()),'repeated retirement must not make its own journal unrestorable');assert(p.snapshot().state.attempts.length<=3);assert.equal(p.coverage().unresolved_reservations,1);},
  buffer(){const t=task(),body=Buffer.from(`{"task_id":"wrong","task_id":"${t.task_id}","result":"no_candidate_in_supplied_scope","candidates":[],"limitations":[]}`);assert.equal(validateBumbleResponse(t,body,{now:1}).payload,'invalid_json');},
  scopes(){const t=task(),body=JSON.stringify({task_id:t.task_id,result:'candidate',candidates:[{file:'a.js',location:'2',quote:'second',hypothesis:'Suspected boundary',trigger:'Input',missing_information:[]}],limitations:[]});assert.equal(validateBumbleResponse(t,body,{now:1}).payload,'valid');},
  time(){for(const now of [undefined,NaN,'not a time']){const p=new BumblePlan({deadline:1000});assert.throws(()=>p.admit({task_id:'t',resource_group:'g',source_ip_group:'ip'},now));}},
  negatives(){assert.throws(()=>new BumblePlan({deadline:1000,minimum_negatives:0}),/audit/i);assert.throws(()=>new BumblePlan({deadline:1000,minimum_negatives:2,negative_ids:['n']}),/audit/i);assert.equal(new BumblePlan({deadline:1000}).coverage().audit,'audit_unmet');const p=new BumblePlan({deadline:1000,minimum_negatives:2,negative_ids:['n','other']});for(let n=0;n<2;n++){const r=p.admit({task_id:'n',resource_group:'g',source_ip_group:'ip'},1);if(r)p.terminal(r,'scoped_negative',{remote_release_verified:true});}assert.equal(p.coverage().audit,'audit_unmet');assert.equal(p.snapshot().state.negatives.length,1);},
  terminal(){const p=new BumblePlan({deadline:1000}),r=p.admit({task_id:'t',resource_group:'g',source_ip_group:'ip'},1);assert.throws(()=>p.terminal(r,'admitted'));},
  restore(){const p=new BumblePlan({deadline:1000,negative_ids:['n']}),r=p.admit({task_id:'t',resource_group:'g',source_ip_group:'ip'},1);p.terminal(r,'outcome_unknown');assert.throws(()=>new BumblePlan({deadline:1000,global:2,negative_ids:['n']},p.snapshot()),/plan|binding|limits/i);},
  ip(){const p=new BumblePlan({deadline:1000,global:10,per_group:1});assert(p.admit({task_id:'a',resource_group:'g1',source_ip_group:'ip'},1));assert.equal(p.admit({task_id:'b',resource_group:'g2',source_ip_group:'ip'},1),null);}
};
const selected=process.argv[2];if(selected){assert(cases[selected]);cases[selected]();}else for(const fn of Object.values(cases))fn();
console.log(JSON.stringify({passed:true,case:selected||'all',scope:'offline implementation probes'}));
