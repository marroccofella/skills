// Governor-authored synthetic probes; no credentials, endpoint or model calls.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {makeBumbleTask,validateBumbleResponse} from '../scripts/bumble-contract.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const selected=process.argv[process.argv.indexOf('--case')+1];
assert(['raw','unicode','task'].includes(selected),'Choose a bounded probe case');
const now=1000,options={transport:'success',finished:true,now};
const H=v=>crypto.createHash('sha256').update(v).digest('hex');
const input=()=>({run_id:'raw-identity-probe',piece_id:'one',source:'const total = 2;',scope:[{file:'fixture.js',start_line:42,text:'const total = 2;'}],check:'Check this supplied statement',omissions:[],deadline:2000,budget:{response_bytes:8192,candidates:1}});
const negative=t=>JSON.stringify({task_id:t?.task_id,result:'no_candidate_in_supplied_scope',candidates:[],limitations:[]});
let passed=0,failed=0;const observations=[];
function test(name,fn){try{const detail=fn();passed++;observations.push({name,status:'passed',...detail});}catch(error){failed++;observations.push({name,status:'failed',...(error.observation||{})});}}
if(selected==='raw'){
  const task=makeBumbleTask(input()),candidate={file:'fixture.js',location:'42',quote:'const total = 2;',hypothesis:'Synthetic hypothesis',trigger:'Fixture only',missing_information:[]};
  const body=Buffer.from(JSON.stringify({task_id:task.task_id,result:'candidate',candidates:[candidate,{...candidate,hypothesis:'Second hypothesis'}],limitations:[]}));
  for(const bom of [false,true])test('overflow retains exact original UTF8 bytes, BOM='+bom,()=>{
    const raw=bom?Buffer.concat([Buffer.from([239,187,191]),body]):body;
    const result=validateBumbleResponse(task,raw,options);
    assert.equal(result.payload,'candidate_overflow');assert.equal(result.coverage,'unresolved');assert.equal(result.quorum_votes,0);assert.equal(result.candidates.length,2);
    const retained=Buffer.from(result.raw,'utf8'),observation={original_bytes:raw.length,retained_bytes:retained.length,exact_bytes:retained.equals(raw)};
    try{assert(retained.equals(raw),'Complete retained raw response must equal original bytes');}catch(error){error.observation=observation;throw error;}
    return observation;
  });
  test('ordinary BOM tolerance keeps a distinct original hash',()=>{const plain=Buffer.from(negative(task)),raw=Buffer.concat([Buffer.from([239,187,191]),plain]);const a=validateBumbleResponse(task,raw,options),b=validateBumbleResponse(task,plain,options);assert.equal(a.payload,'valid');assert.equal(a.raw_sha256,H(raw));assert.notEqual(a.raw_sha256,b.raw_sha256);});
}
if(selected==='unicode'){
  test('valid surrogate pairs remain supported in task text',()=>{const data=input();data.source+=' // \u{1f41d}';data.scope[0].text=data.source;data.check+=' \u{1f41d}';data.omissions=['\u{1f41d}'];const task=makeBumbleTask(data);assert.equal(task.source_sha256,H(data.source));assert.equal(validateBumbleResponse(task,negative(task),options).payload,'valid');});
  for(const field of ['source','check','scope','omissions'])test('constructor refuses lone surrogate in '+field,()=>{
    const data=input(),bad=String.fromCharCode(0xd800);
    if(field==='source'){data.source+=bad;data.scope[0].text=data.source;}
    if(field==='check')data.check+=bad;
    if(field==='scope'){data.source+=bad;data.scope[0].text+=bad;}
    if(field==='omissions')data.omissions=[bad];
    assert.throws(()=>makeBumbleTask(data),'Ill-formed task strings must be refused before hashing or JSON serialization');
  });
  test('different lone-surrogate sources cannot mint one shared source hash',()=>{const attempts=[];for(const unit of [0xd800,0xd801]){const data=input();data.source+=String.fromCharCode(unit);data.scope[0].text=data.source;try{attempts.push(makeBumbleTask(data));}catch{}}
    const observation={accepted:attempts.length,distinct_source_hashes:new Set(attempts.map(t=>t.source_sha256)).size};
    try{assert.equal(attempts.length,0);}catch(error){error.observation=observation;throw error;}return observation;
  });
}
if(selected==='task'){
  const task=makeBumbleTask(input());
  test('an ordinary task and owned serialized restore remain structurally valid',()=>{for(const t of [task,JSON.parse(JSON.stringify(task))])assert.equal(validateBumbleResponse(t,negative(t),options).payload,'valid');});
  test('missing task identity and deadline cannot establish scoped completion',()=>{const fake={source:task.source,scope:task.scope,budget:task.budget};const result=validateBumbleResponse(fake,negative(fake),options);const observation={payload:result.payload,coverage:result.coverage,quorum_votes:result.quorum_votes};try{assert.equal(result.coverage,'unresolved');}catch(error){error.observation=observation;throw error;}return observation;});
  test('a null task yields a bounded unresolved response, not an exception',()=>{assert.equal(validateBumbleResponse(null,negative(null),options).coverage,'unresolved');});
  test('mismatched source hash cannot establish scoped completion',()=>{const fake={...task,source_sha256:'0'.repeat(64)};assert.equal(validateBumbleResponse(fake,negative(fake),options).coverage,'unresolved');});
}
console.log(JSON.stringify({selected,passed,failed,observations,network_calls:0,model_calls:0,scope:'Pure structural/raw-byte probes; no native authority, qualification or dispatch claimed'}));
if(failed)process.exitCode=1;
