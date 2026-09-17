// Provider-free regression of stdin transport and authoritative terminal results.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {PEER_CONTRACT,reviewProblem} from './review-contract.mjs';
import {assemblePrompt} from './guidance.mjs';
const source=fs.readFileSync(new URL('./multi-review.mjs',import.meta.url),'utf8');
const start=source.indexOf('function extractJsonObjects('),end=source.indexOf('\nfunction fingerprint(',start);
assert(start>=0&&end>start);
const context=vm.createContext({fs,os,path,process,Buffer,PEER_CONTRACT,reviewProblem,assemblePrompt,
  createEvidenceWorkspace:prefix=>fs.mkdtempSync(path.join(os.tmpdir(),prefix)),
  VALID_VERDICTS:new Set(['ACCEPT','MODIFY','REJECT']),VALID_SEVERITIES:new Set(['CRITICAL','WARNING','NITPICK']),
  attachmentRouting:()=>[],attachmentContractSection:()=>'',buildContract:()=> 'Synthetic contract',
  agentTimeoutMs:(_a,ms)=>ms,cleanOauthEnv:()=>({}),parseUsage:()=>({reported:null}),LOGIN_HINTS:{},
  sanitizeText:s=>({value:s}),antigravityCommand:()=> 'agy',REVIEW_JSON_SCHEMA:{type:'object'}});
vm.runInContext(source.slice(start,end)+';this.invoke=invokeReviewer;',context);
const artifact='export const value = "literal & % ! ü";\n';
const payload={review_status:'complete',reviewed_scope:[{quote:artifact.trim(),assessment:'Synthetic exact source was inspected.'}],
  verdict:'ACCEPT',confidence:0.8,findings:[],summary:'Synthetic complete response.',suggested_improvements:[]};
function events(response=JSON.stringify(payload),status='SUCCESS') {return [
  {event:'init',init:{cwd:'PRIVATE_SENTINEL'}},{event:'step_update',step_update:{text_delta:'UNTRUSTED_PROGRESS'}},
  {event:'result',result:{status,response}}];}
const encode=rows=>rows.map(JSON.stringify).join('\n')+'\n';
let invocation;
async function invoke(rows=events(),extra={},options={}) {
  return context.invoke('antigravity',artifact,{governor:'codex',timeoutMs:60000,...options,runProcess:async(command,args,opts)=>{
    invocation={command,args,opts,promptFile:fs.existsSync(path.join(opts.cwd,'prompt.txt'))};
    return {code:0,stdout:typeof rows==='string'?rows:encode(rows),stderr:'',...extra};
  }});
}
const checks=[];
async function test(name,fn){try{await fn();checks.push({name,passed:true})}catch(e){checks.push({name,passed:false,error:e.message})}}
await test('complete nested native result reaches unchanged review validation',async()=>{
  const r=await invoke();assert.equal(r.status,'success',r.detail);assert.equal(r.review.summary,payload.summary);
  assert(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(r).includes('UNTRUSTED_PROGRESS'));
});
await test('one JSONL stdin prompt preserves source bytes, no source argv or permission widening',async()=>{
  await invoke();const {args,opts,promptFile}=invocation;
  assert.equal(args[args.indexOf('--input-format')+1],'stream-json');assert.equal(args[args.indexOf('--output-format')+1],'stream-json');
  assert(!args.includes('-p'));assert(!args.includes('--json-schema'));assert(!args.includes('--dangerously-skip-permissions'));
  for(const flag of ['--new-project','--mode=plan','--sandbox'])assert(args.includes(flag));
  assert.equal(args[args.indexOf('--print-timeout')+1],'55s');assert(!args.some(a=>a.includes(artifact.trim())));
  const lines=opts.input.trimEnd().split('\n');assert.equal(lines.length,1);const message=JSON.parse(lines[0]);
  assert.equal(message.event,'user');assert(message.message.content.includes(artifact));
  assert(message.message.content.includes('untrusted'));assert.equal(promptFile,false);
  assert(!fs.existsSync(opts.cwd),'Private staging must be cleaned');
});
await test('all documented unsuccessful or nonterminal statuses refuse earlier valid content',async()=>{
  for(const status of ['ERROR','CANCELED','INTERRUPTED','INVALID','WAITING','RUNNING'])assert.equal((await invoke(events(JSON.stringify(payload),status))).status,'error');
});
await test('success without complete content, with error or with missing status is refused',async()=>{
  for(const response of ['', '   ','{}','{"review_status":"pending"}'])assert.equal((await invoke(events(response))).status,'invalid_output');
  const failed=events();failed.at(-1).result.error='PRIVATE_DIAGNOSTIC';const r=await invoke(failed);assert.equal(r.status,'error');assert(!JSON.stringify(r).includes('PRIVATE_DIAGNOSTIC'));
  const absent=events();delete absent.at(-1).result.status;assert.equal((await invoke(absent)).status,'invalid_output');
});
await test('schema and zero native exit do not promote empty partial output',async()=>{
  const rows=events('');rows.at(-1).result.json_schema={type:'object'};
  const r=await invoke(rows,{stderr:'[agy] print timeout after 55s with turn in progress; returning partial output\n'});
  assert.equal(r.status,'timeout');assert(!r.review);
});
await test('native partial-output timeout invalidates even a plausible completed response',async()=>{
  assert.equal((await invoke(events(),{stderr:'[agy] print timeout after 55s with turn in progress; returning partial output'})).status,'timeout');
});
await test('missing, duplicate or nonfinal result, malformed JSONL and unknown events fail closed',async()=>{
  for(const mutate of [r=>r.pop(),r=>r.push(r.at(-1)),r=>r.push({event:'step_update'}),r=>r.splice(1,0,{event:'future.state'})]){
    const rows=events();mutate(rows);assert.equal((await invoke(rows)).status,'invalid_output');
  }
  for(const tail of ['{"event":','null','[]'])assert.equal((await invoke(encode(events())+tail)).status,'invalid_output');
});
await test('progress text cannot substitute for the terminal answer',async()=>{
  const rows=events('');rows[1].step_update.text_delta=JSON.stringify(payload);assert.equal((await invoke(rows)).status,'invalid_output');
});
await test('scope mismatch, truncation and outer timeout still fail',async()=>{
  assert.equal((await invoke(events(JSON.stringify({...payload,reviewed_scope:[{quote:'not source',assessment:'Synthetic'}]})))).status,'invalid_output');
  assert.equal((await invoke(events(),{outputLimited:true})).status,'invalid_output');
  assert.equal((await invoke(events(),{timedOut:true})).status,'timeout');
});
await test('media transport rejects every unsuccessful native status despite a complete answer',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'momm-agy-status-control-'));
  const file=path.join(dir,'fixture.png');
  try{
    fs.writeFileSync(file,'synthetic transport fixture only');
    const options={staging:{directory:dir,attachments:[{staged_path:file,modality:'image',name:'fixture.png'}]}};
    for(const status of ['ERROR','CANCELED','INTERRUPTED','INVALID','WAITING','RUNNING']) {
      const r=await invoke(JSON.stringify({status,response:JSON.stringify(payload)}),{},options);
      assert.equal(r.status,'error',status+' must not promote a nested review');
    }
  }finally{fs.unlinkSync(file);fs.rmdirSync(dir)}
});
await test('media attachment transport retains existing private-file/schema binding',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'momm-agy-media-control-'));
  try{
    const file=path.join(dir,'fixture.png');fs.writeFileSync(file,'synthetic byte-identity fixture, not an image probe');
    const r=await invoke(JSON.stringify({status:'SUCCESS',response:JSON.stringify(payload)}),{},
      {staging:{directory:dir,attachments:[{staged_path:file,modality:'image',name:'fixture.png'}]}});
    assert.equal(r.status,'success',r.detail);assert(invocation.args.includes('-p'));assert(invocation.args.includes('--json-schema'));
    assert(!invocation.args.includes('--input-format'));assert.equal(invocation.opts.input,'');assert.equal(invocation.promptFile,true);
  }finally{fs.unlinkSync(path.join(dir,'fixture.png'));fs.rmdirSync(dir)}
});
console.log(JSON.stringify({passed:checks.filter(c=>c.passed).length,total:checks.length,checks},null,2));
if(checks.some(c=>!c.passed))process.exitCode=1;
