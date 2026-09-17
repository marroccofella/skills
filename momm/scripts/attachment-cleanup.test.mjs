// Synthetic files only; no provider calls, personal media, or external network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {privateTestFixture} from '../../scripts/private-test-fixture.mjs';
const dispatcher=fileURLToPath(new URL('./multi-review.mjs',import.meta.url));
const source=fs.readFileSync(dispatcher,'utf8');
const stageStart=source.indexOf('function stageAttachments(');
const stageEnd=source.indexOf('\nfunction attachmentContractSection(',stageStart);
const mainStart=source.indexOf('async function main()');
const mainEnd=source.lastIndexOf('\nmain().catch(');
assert(stageStart>0&&stageEnd>stageStart&&mainEnd>mainStart);
const root=privateTestFixture('momm-attachment-cleanup-test-');
const checks=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const input=Buffer.from('SYNTHETIC_MEDIA_BYTES_NO_PERSONAL_DATA');
let sequence=0;
function fixture(){
  const cwd=path.join(root,String(++sequence)),temporary=path.join(cwd,'tmp');
  fs.mkdirSync(temporary,{recursive:true});fs.mkdirSync(path.join(cwd,'home'));
  fs.writeFileSync(path.join(cwd,'artifact.js'),'export const value = 1;\n');
  fs.writeFileSync(path.join(cwd,'synthetic.gif'),input);
  return {cwd,temporary};
}
const leftovers=dir=>{
  const evidenceStaging=path.join(path.dirname(dir),'.ensemble_reviews','staging');
  return [...fs.readdirSync(dir),...(fs.existsSync(evidenceStaging)?fs.readdirSync(evidenceStaging):[])].filter(name=>name.startsWith('momm-'));
};
async function test(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}}
function actual(f,extra){
  return spawnSync(process.execPath,[dispatcher,'--governor','codex','--reviewers','codex','--input','artifact.js','--no-ui',...extra],{
    cwd:f.cwd,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:500000,
    env:{...process.env,TEMP:f.temporary,TMP:f.temporary,TMPDIR:f.temporary,HOME:path.join(f.cwd,'home'),USERPROFILE:path.join(f.cwd,'home'),
      MULTI_LLM_REVIEW_DEPTH:'0',NO_UPDATE_CHECK:'1',MOMM_NO_UPDATE_CHECK:'1',DO_NOT_TRACK:'1'},
  });
}
function stageContext(f,overrides={}){
  const context=vm.createContext({fs:{...fs,...overrides},os:{tmpdir:()=>f.temporary},path,Buffer,createHash,
    createEvidenceWorkspace:prefix=>fs.mkdtempSync(path.join(f.temporary,prefix)),
    requirePrivateScratch:()=>{},
    MODALITY_BY_EXTENSION:{gif:'image'},MODALITY_MAX_BYTES:{image:8000000},modalityOfFile:()=> 'image'});
  vm.runInContext(source.slice(stageStart,stageEnd)+';this.stage=stageAttachments;',context);
  return context;
}
try{
  for(const [name,attachments] of [
    ['missing second file',['synthetic.gif','missing.png']],
    ['missing first file',['missing.png','synthetic.gif']],
    ['unknown second media type',['synthetic.gif','artifact.js']],
  ])await test(`actual CLI ${name}: failure leaves no attachment staging`,()=>{
    const f=fixture(),r=actual(f,attachments.flatMap(a=>['--attach',a]));
    assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,1);
    assert.match(r.stderr,/--attach/);assert.equal(r.stdout,'');
    assert.deepEqual(leftovers(f.temporary),[],'staged directory survived rejection');
    assert.equal(hash(fs.readFileSync(path.join(f.cwd,'synthetic.gif'))),hash(input));
  });
  await test('actual CLI missing guidance after staging still removes media',()=>{
    const f=fixture(),r=actual(f,['--attach','synthetic.gif','--guidance-file','missing-guidance.json']);
    assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,1);
    assert.match(r.stderr,/guidance/);assert.deepEqual(leftovers(f.temporary),[]);
  });
  await test('actual governor-self-excluded review preserves descriptors, removes copies',()=>{
    const f=fixture(),r=actual(f,['--attach','synthetic.gif']);
    assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);
    const report=JSON.parse(r.stdout);assert.equal(report.attachments[0].sha256,hash(input));
    assert.equal(report.reviewers[0].status,'self_excluded');assert.deepEqual(leftovers(f.temporary),[]);
    assert.equal(hash(fs.readFileSync(path.join(f.cwd,'synthetic.gif'))),hash(input));
  });
  await test('staging write failure removes even a partial output file',()=>{
    const f=fixture();const context=stageContext(f,{writeFileSync:(file,bytes,opts)=>{fs.writeFileSync(file,bytes.subarray(0,4),opts);throw Error('synthetic write failure');}});
    assert.throws(()=>context.stage([path.join(f.cwd,'synthetic.gif')]),/synthetic write failure/);
    assert.deepEqual(leftovers(f.temporary),[]);
  });
  await test('staging read failure removes the newly allocated empty directory',()=>{
    const f=fixture();const context=stageContext(f,{readFileSync:()=>{throw Error('synthetic read failure');}});
    assert.throws(()=>context.stage([path.join(f.cwd,'synthetic.gif')]),/synthetic read failure/);
    assert.deepEqual(leftovers(f.temporary),[]);
  });
  await test('cleanup refusal is explicit, not silent privacy success',()=>{
    const f=fixture();const context=stageContext(f,{readFileSync:()=>{throw Error('synthetic read failure');},rmSync:()=>{throw Error('synthetic cleanup refusal');}});
    assert.throws(()=>context.stage([path.join(f.cwd,'synthetic.gif')]),/cleanup failed.*temporary.*remain/i);
  });
  // Exercise actual main's ownership boundary with controlled dependencies.
  // No provider executable is called; each selected boundary throws after stage.
  for(const boundary of ['capabilities','guidance','scheduler'])await test(`${boundary} rejection after staging removes media`,async()=>{
    const f=fixture(),context=stageContext(f);
    const options={governor:'codex',reviewers:['codex'],timeoutMs:1000,maxBytes:1000,attach:[path.join(f.cwd,'synthetic.gif')]};
    const fail=()=>{throw Error(`synthetic ${boundary} failure`);};
    Object.assign(context,{process:{argv:['node','fixture'],env:{},cwd:()=>f.cwd,stderr:{write(){},isTTY:false}},
      parseArgs:()=>options,parseReviewDepth:()=>0,VALID_GOVERNORS:new Set(['codex']),collectArtifact:async()=> 'export const value=1;',
      captureSourceSnapshot:()=>({}),inputLimitFor:()=>1000,sanitizeText:s=>({value:s}),applyTier(){},effectiveTimeoutMs:()=>1000,
      // This VM test targets staging ownership; native permission enforcement
      // is exercised independently by evidence-permissions-native.test.mjs.
      preparePrivateEvidence:()=>({verified:true}),
      resolveDispatchCapabilities:boundary==='capabilities'?fail:async()=>({capabilities:null,registry:null}),
      clockTrigger(){},personaFor:()=>null,resolveGuidance:boundary==='guidance'?fail:()=>({routes:{},notices:[]}),
      createUi:()=>({start(){},preflight(){},stop(){}}),emitEvent(){},preflightCheck:async()=>[],
      createScheduler:fail,clipped:s=>s,os:{tmpdir:()=>f.temporary,homedir:()=>path.join(f.cwd,'home')},
    });
    context.moduleUrl=new URL('./multi-review.mjs',import.meta.url).href;
    vm.runInContext(source.slice(mainStart,mainEnd).replaceAll('import.meta.url','moduleUrl')+';this.run=main;',context);
    await assert.rejects(context.run(),new RegExp(`synthetic ${boundary} failure`));
    assert.deepEqual(leftovers(f.temporary),[]);
  });
}finally{
  const resolved=path.resolve(root),temporary=path.resolve(os.tmpdir());
  assert(resolved.startsWith(temporary+path.sep)&&path.basename(resolved).startsWith('momm-attachment-cleanup-test-'));
  fs.rmSync(resolved,{recursive:true,force:true});
}
console.log(JSON.stringify({node:process.version,passed:checks.filter(c=>c.passed).length,total:checks.length,checks},null,2));
process.exitCode=checks.every(c=>c.passed)?0:1;
