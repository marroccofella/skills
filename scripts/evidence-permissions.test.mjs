import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {inspectEvidencePermissions,requirePrivateEvidence,preparePrivateEvidence} from '../momm/scripts/evidence-permissions.mjs';
const dir=path.resolve('synthetic-evidence');
const stat=(options={})=>({isSymbolicLink:()=>false,isDirectory:()=>true,isFile:()=>false,uid:123,mode:0o40700,nlink:1,...options});
const fsx={lstatSync:()=>stat(),readdirSync:()=>[]};
let checks=0;
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
console.log(JSON.stringify({passed:true,checks,scope:'synthetic permission decisions; not native ACL certification'}));
