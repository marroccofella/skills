// Actual adapter functions with synthetic filesystem faults; zero providers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {PEER_CONTRACT,reviewProblem} from './review-contract.mjs';
import {assemblePrompt} from './guidance.mjs';
const source=fs.readFileSync(new URL('./multi-review.mjs',import.meta.url),'utf8');
const start=source.indexOf('function extractJsonObjects('),end=source.indexOf('\nfunction fingerprint(',start);
assert(start>0&&end>start);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'momm-adapter-cleanup-test-'));
const original=path.join(root,'original.gif');fs.writeFileSync(original,'SYNTHETIC_MEDIA_BYTES');
const sibling=path.join(root,'unrelated');fs.mkdirSync(sibling);fs.writeFileSync(path.join(sibling,'keep'),'keep');
let sequence=0;const checks=[];
async function test(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}}
function context(overrides={},command=()=> 'synthetic-agent'){
  const temporary=path.join(root,String(++sequence));fs.mkdirSync(temporary);
  const ctx=vm.createContext({fs:{...fs,...overrides},os:{tmpdir:()=>temporary},path,process,Buffer,PEER_CONTRACT,reviewProblem,assemblePrompt,
    VALID_VERDICTS:new Set(['ACCEPT','MODIFY','REJECT']),VALID_SEVERITIES:new Set(['CRITICAL','WARNING','NITPICK']),
    attachmentRouting:()=>[],attachmentContractSection:()=>'',buildContract:()=> 'Synthetic contract',
    agentTimeoutMs:(_a,ms)=>ms,cleanOauthEnv:()=>({}),parseUsage:()=>({reported:null}),LOGIN_HINTS:{},
    sanitizeText:s=>({value:s}),clipped:(s,n)=>String(s).slice(0,n),antigravityCommand:command,grokCommand:command,REVIEW_JSON_SCHEMA:{type:'object'}});
  vm.runInContext(source.slice(start,end)+';this.invoke=invokeReviewer;',ctx);
  return {ctx,temporary};
}
const attachments={directory:root,attachments:[{name:'original.gif',staged_path:original,modality:'image'}]};
const failure=()=>{throw Error('PRIVATE_DIAGNOSTIC_SENTINEL');};
async function invoke(c,route,{media=false,run=failure}={}){
  return c.ctx.invoke(route,'export const synthetic = 1;',{
    governor:'codex',timeoutMs:1000,...(media?{staging:attachments}:{}),runProcess:run,
  });
}
function clean(c){assert.deepEqual(fs.readdirSync(c.temporary),[],'adapter staging survived');}
function safeFailure(r){assert.equal(r.status,'error');assert(!r.review);assert(!JSON.stringify(r).includes('PRIVATE_DIAGNOSTIC_SENTINEL'));}
try{
  for(const route of ['antigravity','copilot','grok'])await test(`${route} partial prompt write: cleanup runs before ownership escapes`,async()=>{
    const c=context({writeFileSync:(file,bytes,opts)=>{fs.writeFileSync(file,String(bytes).slice(0,7),opts);failure();}});
    let called=false,r,error;
    try{r=await invoke(c,route,{media:route==='antigravity',run:async()=>{called=true;failure();}});}catch(e){error=e;}
    assert.equal(called,false);clean(c);assert.equal(error,undefined);safeFailure(r);
  });
  await test('AGY partial media copy removes copied prompt and partial media',async()=>{
    const c=context({copyFileSync:(_from,to)=>{fs.writeFileSync(to,'partial');failure();}});
    let r,error;try{r=await invoke(c,'antigravity',{media:true});}catch(e){error=e;}
    clean(c);assert.equal(error,undefined);safeFailure(r);
  });
  for(const route of ['antigravity','grok'])await test(`${route} command resolution after staging still cleans up`,async()=>{
    const c=context({},failure);let r,error;
    try{r=await invoke(c,route,{media:route==='antigravity'});}catch(e){error=e;}
    clean(c);assert.equal(error,undefined);safeFailure(r);
  });
  for(const route of ['antigravity','copilot','grok'])await test(`${route} rejected launcher returns a safe terminal status after cleanup`,async()=>{
    const c=context();let r,error;try{r=await invoke(c,route);}catch(e){error=e;}
    clean(c);assert.equal(error,undefined);safeFailure(r);
  });
  await test('OS cleanup refusal never leaks a diagnostic or accepts a review',async()=>{
    const c=context({rmSync:failure});
    const r=await invoke(c,'copilot',{run:async()=>({code:0,stdout:'{}',stderr:''})});
    safeFailure(r);assert.match(r.detail,/cleanup failed/);
  });
  for(const route of ['antigravity','copilot','grok'])await test(`${route} ordinary provider failure preserves classification and removes staging`,async()=>{
    const c=context();const r=await invoke(c,route,{run:async()=>({code:1,stdout:'',stderr:'authentication required'})});
    assert.equal(r.status,'authentication_required');clean(c);
  });
  await test('original attachment and unrelated sibling are untouched by all cleanups',()=>{
    assert.equal(fs.readFileSync(original,'utf8'),'SYNTHETIC_MEDIA_BYTES');
    assert.equal(fs.readFileSync(path.join(sibling,'keep'),'utf8'),'keep');
  });
}finally{
  const resolved=path.resolve(root),temporary=path.resolve(os.tmpdir());
  assert(resolved.startsWith(temporary+path.sep)&&path.basename(resolved).startsWith('momm-adapter-cleanup-test-'));
  fs.rmSync(resolved,{recursive:true,force:true});
}
console.log(JSON.stringify({node:process.version,passed:checks.filter(c=>c.passed).length,total:checks.length,checks},null,2));
process.exitCode=checks.every(c=>c.passed)?0:1;
