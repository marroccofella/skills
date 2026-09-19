// Actual adapter functions with synthetic filesystem faults; zero providers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {PEER_CONTRACT,reviewProblem} from './review-contract.mjs';
import {assemblePrompt} from './guidance.mjs';
import {requirePrivateEvidence} from './evidence-permissions.mjs';
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
    createEvidenceWorkspace:prefix=>fs.mkdtempSync(path.join(temporary,prefix)),
    requirePrivateScratch:()=>{},
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
  for(const route of ['codex','claude','gemini','antigravity','copilot','grok'])await test(`${route} changed scratch permissions refuses the result but still removes scratch`,async()=>{
    const c=context();c.ctx.requirePrivateScratch=failure;
    const r=await c.ctx.invoke(route,'Synthetic input.',{governor:'other',timeoutMs:1000,runProcess:async()=>({code:1,stdout:'',stderr:'authentication required'})});
    safeFailure(r);clean(c);assert.match(r.detail,/permissions/);
  });
  for(const route of ['codex','claude','gemini'])await test(`${route} runs outside the governor project and removes its scratch folder`,async()=>{
    const c=context();let observed;
    const r=await c.ctx.invoke(route,'Synthetic complete input only.',{governor:'other',timeoutMs:1000,
      runProcess:async(_command,_args,options)=>{observed=options.cwd;return {code:1,stdout:'',stderr:'authentication required'};}});
    assert(observed,'Provider was not reached');
    assert.notEqual(path.resolve(observed),path.resolve(process.cwd()),'Provider inherited governor project');
    assert.equal(path.dirname(observed),c.temporary,'Provider did not use its isolated scratch folder');
    assert.equal(r.status,'authentication_required');clean(c);
  });
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
  // Provider sandbox allowance (reproduced on Windows: a sandboxed Codex shell command
  // grants <machine>\CodexSandboxUsers read/execute on Codex's own scratch). Only the
  // post-run check of that route's scratch may name the group; the inspector decides
  // whether the grant is tolerable, and anything else keeps the existing refusal.
  const scratchArtifact='export const synthetic = 1;';
  const scratchReview=JSON.stringify({review_status:'complete',reviewed_scope:[{quote:scratchArtifact,assessment:'Synthetic exact source was inspected.'}],
    verdict:'ACCEPT',confidence:0.8,findings:[],summary:'Synthetic complete response.',suggested_improvements:[]});
  const scratchReply={antigravity:JSON.stringify({event:'result',result:{status:'SUCCESS',response:scratchReview}})+'\n',
    copilot:[{type:'assistant.turn_start',data:{turnId:'t'}},{type:'assistant.message',data:{turnId:'t',content:scratchReview,toolRequests:[]}},{type:'assistant.turn_end',data:{turnId:'t'}},{type:'result',exitCode:0}].map(row=>JSON.stringify(row)).join('\n')+'\n'};
  const scratchInvoke=(c,route,check,seam=false)=>{
    if(!seam)c.ctx.requirePrivateScratch=check;
    return c.ctx.invoke(route,scratchArtifact,{governor:'other',timeoutMs:1000,...(seam?{testWorkspaceCheck:check}:{}),
      runProcess:async()=>({code:0,stdout:scratchReply[route]??scratchReview,stderr:''})});
  };
  // The shape the real inspector returns: the exact offered name and its read-only verdict.
  const sandboxGrant={principal:'CodexSandboxUsers',rights:'read_execute'};
  for(const seam of [false,true])await test(`codex tolerated sandbox group on its own scratch is accepted and recorded (${seam?'testWorkspaceCheck seam':'stubbed requirePrivateScratch binding'})`,async()=>{
    const c=context(),calls=[];
    const r=await scratchInvoke(c,'codex',(...args)=>{calls.push(args);return {verified:true,basis:'windows_dacl',tolerated:[sandboxGrant]};},seam);
    assert.equal(r.status,'success',r.detail);clean(c);
    assert.equal(calls.length,1);assert.equal(calls[0].length,2);
    assert.equal(JSON.stringify(calls[0][1]),JSON.stringify({allowReadOnlyPrincipals:['CodexSandboxUsers']}));
    assert.equal(JSON.stringify(r.scratch_access.tolerated),JSON.stringify([sandboxGrant]));
    assert.equal(r.scratch_access.note,'provider sandbox group was granted read-only access to its own scratch during execution');
  });
  await test('codex scratch that stayed strictly private records no scratch access',async()=>{
    for(const verdict of [undefined,{verified:true},{verified:true,tolerated:[]}]){
      const c=context();const r=await scratchInvoke(c,'codex',()=>verdict);
      assert.equal(r.status,'success',r.detail);assert(!('scratch_access' in r));clean(c);
    }
  });
  await test('codex scratch with a principal the inspector does not tolerate keeps the existing refusal',async()=>{
    const c=context();
    const r=await scratchInvoke(c,'codex',()=>{const e=Error('PRIVATE_DIAGNOSTIC_SENTINEL additional_principal');e.code='MOMM_EVIDENCE_PERMISSIONS';e.reason='additional_principal';throw e;});
    safeFailure(r);clean(c);assert(!('scratch_access' in r));
    assert.equal(r.detail,'review workspace permissions could not be verified after execution; temporary copies were removed and no review was accepted');
  });
  await test('a tolerated entry outside the route table, or malformed, is refused rather than recorded',async()=>{
    for(const tolerated of [[{principal:'OTHERDOMAIN\\CodexSandboxUsers',rights:'read_execute'}],[{principal:'WORK\\Everyone',rights:'ReadAndExecute'}],[sandboxGrant,{principal:'BUILTIN\\Users',rights:'ReadAndExecute'}],[{principal:'WORK\\CodexSandboxUsersX',rights:'Read'}],[{rights:'Read'}],'CodexSandboxUsers',[null]]){
      const c=context();const r=await scratchInvoke(c,'codex',()=>({verified:true,tolerated}));
      safeFailure(r);clean(c);assert.match(r.detail,/permissions could not be verified after execution/);assert(!('scratch_access' in r));
    }
  });
  for(const route of ['claude','gemini','antigravity','copilot','grok'])await test(`${route} never passes a sandbox allowance and cannot be granted one`,async()=>{
    let c=context();const calls=[];
    let r=await scratchInvoke(c,route,(...args)=>{calls.push(args);return {verified:true};});
    assert.equal(r.status,'success',r.detail);clean(c);assert(!('scratch_access' in r));
    assert.equal(calls.length,1);assert.equal(calls[0].length,1,'only the scratch directory may be passed');
    c=context();r=await scratchInvoke(c,route,()=>({verified:true,tolerated:[sandboxGrant]}));
    safeFailure(r);clean(c);assert.match(r.detail,/permissions could not be verified after execution/);
  });
  // Gate rev_20260918185005_hwu4 production-check-test-mocked: the tests above stub the
  // inspector, so they cannot see a disagreement between what evidence-permissions.mjs
  // returns and what the dispatcher accepts. These go through the REAL inspector (the
  // exact call requirePrivateScratch makes on Windows) with only the PowerShell process
  // replaced by recorded stdout, on every CI platform.
  const recordedInspector=(stdout,seen=[])=>(dir,options)=>requirePrivateEvidence(dir,{...(options??{}),platform:'win32',
    systemRoot:process.platform==='win32'?'C:\\Windows':'/windows',
    run:(exe,args,spawnOptions)=>{seen.push({exe,request:JSON.parse(spawnOptions.input)});return {status:0,stdout,stderr:''};}});
  await test('real inspector contract: its tolerated answer for the Codex group is accepted and recorded as returned',async()=>{
    const c=context(),seen=[];
    const r=await scratchInvoke(c,'codex',recordedInspector('{"verified":true,"inspected":3,"tolerated":["CodexSandboxUsers"]}',seen));
    assert.equal(r.status,'success',r.detail);clean(c);
    assert.equal(seen.length,1);assert.match(seen[0].exe,/powershell\.exe$/i);
    assert.equal(JSON.stringify(seen[0].request.allow_read_only),JSON.stringify(['CodexSandboxUsers']));
    assert.equal(JSON.stringify(r.scratch_access.tolerated),JSON.stringify([{principal:'CodexSandboxUsers',rights:'read_execute'}]));
  });
  await test('real inspector contract: a strictly private Codex scratch is accepted with nothing recorded',async()=>{
    for(const stdout of ['{"verified":true,"inspected":3,"tolerated":[]}','{"verified":true,"inspected":3}']){
      const c=context();const r=await scratchInvoke(c,'codex',recordedInspector(stdout));
      assert.equal(r.status,'success',r.detail);assert(!('scratch_access' in r));clean(c);
    }
  });
  await test('real inspector contract: refusals and untrusted inspector answers keep the existing refusal',async()=>{
    for(const stdout of ['{"verified":false,"reason":"additional_principal","inspected":1}','{"verified":true,"inspected":3,"tolerated":["Everyone"]}',
      '{"verified":true,"inspected":3,"tolerated":[{"principal":"CodexSandboxUsers"}]}','{"verified":true,"inspected":0,"tolerated":["CodexSandboxUsers"]}','not json']){
      const c=context();const r=await scratchInvoke(c,'codex',recordedInspector(stdout));
      safeFailure(r);clean(c);assert(!('scratch_access' in r));
      assert.equal(r.detail,'review workspace permissions could not be verified after execution; temporary copies were removed and no review was accepted');
    }
  });
  await test('real inspector contract: a route without a sandbox group never asks the inspector to tolerate anyone',async()=>{
    for(const route of ['claude','gemini','antigravity','copilot','grok']){
      let c=context();const seen=[];
      let r=await scratchInvoke(c,route,recordedInspector('{"verified":true,"inspected":3,"tolerated":[]}',seen));
      assert.equal(r.status,'success',route+': '+r.detail);clean(c);
      assert.equal(seen.length,1);assert(!('allow_read_only' in seen[0].request),route);
      // Even an inspector that volunteers the group is refused: it was never requested.
      c=context();r=await scratchInvoke(c,route,recordedInspector('{"verified":true,"inspected":3,"tolerated":["CodexSandboxUsers"]}'));
      safeFailure(r);clean(c);
    }
  });
  await test('the scratch is still created strictly private: creation never receives the allowance',async()=>{
    const c=context(),created=[],make=c.ctx.createEvidenceWorkspace;
    c.ctx.createEvidenceWorkspace=(...args)=>{created.push(args);return make(...args);};
    const r=await scratchInvoke(c,'codex',()=>({verified:true,tolerated:[sandboxGrant]}));
    assert.equal(r.status,'success',r.detail);assert.equal(JSON.stringify(created),JSON.stringify([['momm-review-']]));clean(c);
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
