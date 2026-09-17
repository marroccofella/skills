// Independent candidate regression probes. No network or real reviewer calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run,plan} from './modality.mjs';
import {effective,loadBaseline} from './capabilities.mjs';
const matrix=effective({baseline:loadBaseline(),overlay:{entries:[],invalidated:[],stale:[]}});
const {privateTestFixture}=await import('./private-test-fixture.mjs');
process.umask(0o077);
const temp=privateTestFixture('momm-e7-evaluation-');
const results=[];
async function test(name,fn){try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
const options={consent:true,effective:matrix,home:temp,cwd:temp};
try{
  const text=path.join(temp,'input.txt');fs.writeFileSync(text,'Synthetic text, not an image.');
  await test('required image input rejects text-only files before calling a provider',async()=>{
    let calls=0;const p=plan(matrix,{input:['image'],output:['text']},{prompt:'Describe the image.'});
    await assert.rejects(run(p,{...options,inputs:[text],exec:async()=>{calls++;return {code:0,stdout:'Looks fine',stderr:''};}}),e=>e.code==='MOMM_INPUT_MISSING');
    assert.equal(calls,0);
  });
  await test('disconnected saved chain rejects before any provider call',async()=>{
    let calls=0;const p=plan(matrix,{chain:['text','text','text']},{prompt:'Summarise the previous input.'});
    p.steps[1].from=['image'];
    await assert.rejects(run(p,{...options,exec:async()=>{calls++;return {code:0,stdout:'Text only',stderr:''};}}),e=>e.code==='MOMM_BAD_PLAN');
    assert.equal(calls,0);
  });
  await test('empty successful process output fails the chain and does not reach step two',async()=>{
    let calls=0;const p=plan(matrix,{chain:['text','text','text']},{prompt:'Say hello.'});
    const r=await run(p,{...options,exec:async()=>{calls++;return {code:0,stdout:'   ',stderr:''};}});
    assert.equal(r.report.status,'failed');assert.equal(r.report.failure,'invalid_output');assert.equal(calls,1);
  });
  await test('provider error envelope is not a successful text result',async()=>{
    const p=plan(matrix,{chain:['text','text']},{prompt:'Say hello.'});p.steps[0].chosen='claude';
    const r=await run(p,{...options,exec:async()=>({code:0,stdout:JSON.stringify({type:'result',is_error:true,result:'Provider refused'}),stderr:''})});
    assert.equal(r.report.status,'failed');assert.equal(r.report.failure,'invalid_output');
  });
  await test('structured text result stages only the answer, not provider metadata',async()=>{
    const p=plan(matrix,{chain:['text','text']},{prompt:'Say hello.'});p.steps[0].chosen='claude';
    const r=await run(p,{...options,exec:async()=>({code:0,stdout:JSON.stringify({type:'result',is_error:false,result:'Hello.',session_id:'not-artifact-data'}),stderr:''})});
    assert.equal(r.report.status,'complete');assert.equal(fs.readFileSync(path.join(temp,r.report.steps[0].files[0].path),'utf8'),'Hello.');
  });
  await test('empty saved plan fails with an actionable plan error',async()=>{
    await assert.rejects(run({schema:'momm-plan/1',possible:true,prompt:'Hello',steps:[]},{...options,exec:async()=>{throw Error('must not run');}}),e=>e.code==='MOMM_BAD_PLAN');
  });
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log(JSON.stringify({results},null,2));if(results.some(r=>!r.passed))process.exitCode=1;
