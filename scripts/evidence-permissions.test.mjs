import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import {inspectEvidencePermissions,requirePrivateEvidence,preparePrivateEvidence,protectEvidence,evidenceRemediation} from '../momm/scripts/evidence-permissions.mjs';
const dir=path.resolve('synthetic-evidence');
// Actual allocator code, isolated dependencies: a stripped Windows environment
// must refuse with the privacy error before spawning or allocating anything.
{
 const source=fs.readFileSync(new URL('../momm/scripts/evidence-permissions.mjs',import.meta.url),'utf8');
 const start=source.indexOf('export function createEvidenceWorkspace(');
 assert(start>=0);
 const context=vm.createContext({path,fs:{realpathSync:p=>p},os:{tmpdir:()=>path.resolve('synthetic-temp')},
  process:{platform:'win32',env:{}},randomUUID:()=> 'synthetic',requirePrivateEvidence:()=>{},
  spawnSync:()=>{throw Error('Must not spawn');}});
 vm.runInContext(source.slice(start).replace('export function','function')+';this.allocate=createEvidenceWorkspace;',context);
 assert.throws(()=>context.allocate('momm-review-',dir),error=>error.code==='MOMM_EVIDENCE_PERMISSIONS');
}
const stat=(options={})=>({isSymbolicLink:()=>false,isDirectory:()=>true,isFile:()=>false,uid:123,mode:0o40700,nlink:1,...options});
const fsx={lstatSync:()=>stat(),readdirSync:()=>[]};
let checks=1; // Includes the stripped-Windows-environment allocator regression.
for(const [output,expected] of [
 [{verified:true,inspected:1},true],
 [{verified:true,inspected:0},false],
 [{verified:false,reason:'additional_principal'},false],
 [{verified:false,reason:'no_access_rules'},false],
 [{verified:'true',inspected:1},false],
 [null,false],
]){
 const result=inspectEvidencePermissions(dir,{platform:'win32',systemRoot:path.resolve('synthetic-system'),fsx,run:(_exe,args,options)=>{
  assert.deepEqual(JSON.parse(options.input),{path:dir});
  assert(args.includes('-NonInteractive'));
  assert(!args.at(-1).includes('Set-Acl'));
  assert(args.at(-1).includes("Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'"));
  return {status:0,stdout:JSON.stringify(output)};
 }});
 assert.equal(result.verified,expected);checks++;
}
assert.equal(inspectEvidencePermissions(dir,{platform:'win32',systemRoot:path.resolve('synthetic-system'),fsx,run:()=>({status:1,stderr:'private diagnostic'})}).verified,false);checks++;
assert.equal(inspectEvidencePermissions(dir,{platform:'linux',uid:123,fsx}).verified,true);checks++;
for(const replacement of [stat({mode:0o40755}),stat({uid:456}),stat({isSymbolicLink:()=>true})]){
 const options={platform:'linux',uid:123,fsx:{...fsx,lstatSync:()=>replacement}};
 assert.equal(inspectEvidencePermissions(dir,options).verified,false);
 assert.throws(()=>requirePrivateEvidence(dir,options),{code:'MOMM_EVIDENCE_PERMISSIONS'});checks++;
}
const result=inspectEvidencePermissions(dir,{platform:'linux',uid:123,fsx:{lstatSync:p=>p===dir?stat():stat({isDirectory:()=>false,isFile:()=>true,nlink:2}),readdirSync:()=>['linked-file']}});
assert.equal(result.verified,false);checks++;
// Exercise the actual dispatch prelude, not a second implementation of its
// ordering: refused evidence storage must precede reading the review input.
const source=fs.readFileSync(new URL('../momm/scripts/multi-review.mjs',import.meta.url),'utf8');
const start=source.indexOf('  const currentDepth = parseReviewDepth(process.env.MULTI_LLM_REVIEW_DEPTH);');
const end=source.indexOf('  const sourceSnapshot = captureSourceSnapshot',start);
assert(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const dispatchPrelude=new AsyncFunction('process','parseReviewDepth','VALID_GOVERNORS','options','path','preparePrivateEvidence','collectArtifact',source.slice(start,end));
for(const [kind,expected]of[['private',true],['broad',false],['mkdir_failed',false]]){
 let collected=0,created=0;
 const fixture={...fsx,mkdirSync:(_dir,options)=>{created++;assert.equal(options.mode,0o700);if(kind==='mkdir_failed')throw Error('SENSITIVE FIXTURE DETAIL');},lstatSync:()=>stat({mode:kind==='broad'?0o40755:0o40700})};
 const run=dispatchPrelude({env:{}},()=>0,new Set(['codex']),{governor:'codex',timeoutMs:1000,maxBytes:1024},path,d=>preparePrivateEvidence(d,{platform:'linux',uid:123,fsx:fixture}),async()=>{collected++;return 'synthetic input';});
 if(expected)await run;
 else await assert.rejects(run,error=>error.code==='MOMM_EVIDENCE_PERMISSIONS'&&!error.message.includes('SENSITIVE FIXTURE DETAIL'));
 assert.equal(created,1);assert.equal(collected,expected?1:0);checks++;
}
// Release test 2026-09-18: on Windows a folder MOMM creates itself must get its private DACL at
// creation (mkdir inherits the parent's rules and MOMM never repairs). An existing folder is only
// inspected. The refusal names the reason in words and the owner's remediation.
{
 const okRun=()=>({status:0,stdout:JSON.stringify({verified:true,inspected:1})});
 const winBase={platform:'win32',systemRoot:path.resolve('synthetic-system'),run:okRun};
 // Missing folder: the parent is made normally, the leaf only through the private creator.
 let made=[],privateCalls=[],exists=false;
 const missingFs={lstatSync:()=>{if(!exists)throw Object.assign(Error('missing'),{code:'ENOENT'});return stat();},mkdirSync:(d,o)=>{made.push([d,o]);},readdirSync:()=>[]};
 const created=preparePrivateEvidence(dir,{...winBase,fsx:missingFs,createPrivate:(target)=>{privateCalls.push(target);exists=true;return true;}});
 assert.equal(created.verified,true);assert.deepEqual(privateCalls,[dir]);
 assert.deepEqual(made.map(([d])=>d),[path.dirname(dir)],'only the parent may be created with plain mkdir');checks++;
 // Existing folder: never re-created, only inspected.
 let touched=0;
 preparePrivateEvidence(dir,{...winBase,fsx:{...fsx,mkdirSync:()=>{touched++;}},createPrivate:()=>{touched++;return true;}});
 assert.equal(touched,0,'an existing evidence folder is inspected, never created or changed');checks++;
 // Private creation refused and nothing appeared: typed refusal, no fallback to an inherited mkdir.
 assert.throws(()=>preparePrivateEvidence(dir,{...winBase,fsx:{...missingFs,lstatSync:()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});}},createPrivate:()=>false}),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/cannot prepare/.test(e.message));checks++;
 // The refusal explains itself and names the owner-invoked action; it never claims to have changed anything.
 const broadRun=()=>({status:0,stdout:JSON.stringify({verified:false,reason:'additional_principal',inspected:1})});
 assert.throws(()=>requirePrivateEvidence(dir,{...winBase,fsx,run:broadRun}),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&e.reason==='additional_principal'
  &&/other accounts or groups can access it/.test(e.message)&&/evidence --protect/.test(e.message)&&/No permission changes were made/.test(e.message));checks++;
 assert.match(evidenceRemediation(dir,'linux'),/chmod -R go-rwx/);checks++;
 // The protect action only ever targets a directory named .ensemble_reviews, and spawns nothing otherwise.
 const noSpawn=()=>{throw Error('Must not spawn');};
 assert.throws(()=>protectEvidence(path.resolve('Documents'),{...winBase,run:noSpawn,fsx}),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/only ever changes a directory named \.ensemble_reviews/.test(e.message));checks++;
 assert.throws(()=>protectEvidence(path.resolve('project/.ensemble_reviews'),{...winBase,run:noSpawn,fsx:{...fsx,lstatSync:()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});}}}),e=>/no evidence folder here yet/.test(e.message));checks++;
 // Already private: reports unchanged and runs no protect script.
 let scripts=0;
 const unchanged=protectEvidence(path.resolve('project/.ensemble_reviews'),{...winBase,fsx,run:(_e,args)=>{scripts++;assert(!args.at(-1).includes('Set-Acl'));return okRun();}});
 assert.equal(unchanged.changed,false);assert.equal(scripts,1);checks++;
}
console.log(JSON.stringify({passed:true,checks,scope:'synthetic permission decisions; not native ACL certification'}));
