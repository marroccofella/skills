import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import {inspectEvidencePermissions,requirePrivateEvidence,requirePrivateScratch,preparePrivateEvidence,createPrivateDirectory,protectEvidence,evidenceRemediation} from '../momm/scripts/evidence-permissions.mjs';
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
 // A file (or link) where the folder should be: the original "cannot prepare" refusal, nothing created.
 assert.throws(()=>preparePrivateEvidence(dir,{...winBase,fsx:{...fsx,lstatSync:()=>stat({isDirectory:()=>false,isFile:()=>true})},createPrivate:()=>{throw Error('must not create');}}),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/cannot prepare its evidence directory/.test(e.message));checks++;
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
// Gate rev_20260918172020_ehti: evidence --protect must survey the whole tree first and refuse a
// hard-linked file (its mode/ACL is shared with a name outside the folder), a link or a special
// file BEFORE anything is changed, on both platforms. On POSIX every change then goes through a
// no-follow descriptor that is compared with the surveyed inode, never through a pathname.
{
 const root=path.resolve('project/.ensemble_reviews');
 const model=(spec,hooks={})=>{
  const nodes=new Map(Object.entries(spec).map(([rel,n],i)=>[rel?path.join(root,rel):root,{ino:100+i,nlink:1,...n}]));
  const changed=[],fds=new Map();let next=10;
  const st=n=>({isSymbolicLink:()=>n.kind==='link',isDirectory:()=>n.kind==='dir',isFile:()=>n.kind==='file',uid:123,mode:n.mode,nlink:n.nlink,ino:n.ino,dev:1});
  const get=p=>{const n=nodes.get(p);if(!n)throw Object.assign(Error('missing'),{code:'ENOENT'});return n;};
  const fake={
   lstatSync:p=>st(get(p)),
   readdirSync:p=>[...nodes.keys()].filter(k=>k!==p&&path.dirname(k)===p).map(k=>path.basename(k)),
   chmodSync:(p,mode)=>{changed.push(['path',p]);const n=get(p);n.mode=(n.mode&~0o777)|mode;},
   openSync:p=>{hooks.beforeOpen?.(p,nodes);const n=get(p);if(n.kind==='link')throw Object.assign(Error('loop'),{code:'ELOOP'});fds.set(++next,n);return next;},
   fstatSync:fd=>st(fds.get(fd)),
   fchmodSync:(fd,mode)=>{const n=fds.get(fd);changed.push(['fd',n.ino]);n.mode=(n.mode&~0o777)|mode;},
   closeSync:fd=>{fds.delete(fd);},
  };
  return {fake,changed,nodes,open:()=>fds.size};
 };
 const broad={'':{kind:'dir',mode:0o40755},'reports':{kind:'dir',mode:0o40755},'reports/a.json':{kind:'file',mode:0o100644}};
 const posix=fake=>({platform:'linux',uid:123,fsx:fake});
 // Hard-linked file: refused, nothing changed.
 let m=model({...broad,'zz-shared.txt':{kind:'file',mode:0o100644,nlink:2}});
 assert.throws(()=>protectEvidence(root,posix(m.fake)),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/hard-linked/.test(e.message)&&/[Nn]othing was changed/.test(e.message));
 assert.deepEqual(m.changed,[],'a hard-linked file must be refused before any mode is changed');checks++;
 // A link deep in the tree: refused, nothing changed (no "earlier entries may have changed").
 m=model({...broad,'reports/zz-link':{kind:'link',mode:0o120777}});
 assert.throws(()=>protectEvidence(root,posix(m.fake)),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/link/.test(e.message)&&/[Nn]othing was changed/.test(e.message));
 assert.deepEqual(m.changed,[],'a link must be refused before any mode is changed');checks++;
 // Clean tree: every change goes through a descriptor, none through a pathname; descriptors are closed.
 m=model(broad);
 const done=protectEvidence(root,posix(m.fake));
 assert.equal(done.changed,true);assert.equal(done.after.verified,true);
 assert.equal(m.changed.length,3);assert(m.changed.every(([how])=>how==='fd'),'POSIX protection must never chmod by pathname');
 assert.equal(m.open(),0,'descriptors must be closed');checks++;
 // Entry swapped for a symlink between the survey and the change: the no-follow open refuses it.
 const victim=path.join(root,'reports','a.json');
 m=model(broad,{beforeOpen:(p,nodes)=>{if(p===victim)nodes.set(p,{kind:'link',mode:0o120777,nlink:1,ino:999});}});
 assert.throws(()=>protectEvidence(root,posix(m.fake)),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/changed while/.test(e.message));
 assert(m.changed.every(([how])=>how==='fd'));assert.equal(m.open(),0);checks++;
 // Entry (or one of its parents) swapped so the path now reaches another inode: refused, that inode untouched.
 m=model(broad,{beforeOpen:(p,nodes)=>{if(p===victim)nodes.set(p,{kind:'file',mode:0o100644,nlink:1,ino:999});}});
 assert.throws(()=>protectEvidence(root,posix(m.fake)),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/changed while/.test(e.message));
 assert(!m.changed.some(([,id])=>id===999),'an inode that was not surveyed must never be changed');assert.equal(m.open(),0);checks++;
 // Same inode, but it gained a second name after the survey: refused.
 m=model(broad,{beforeOpen:(p,nodes)=>{if(p===victim)nodes.get(p).nlink=2;}});
 assert.throws(()=>protectEvidence(root,posix(m.fake)),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/changed while/.test(e.message));
 assert(!m.changed.some(([,id])=>id===m.nodes.get(victim).ino));checks++;
 // Windows: the same survey runs in Node before the protect script is ever spawned.
 for(const extra of [{'zz-shared.txt':{kind:'file',mode:0o100666,nlink:2}},{'reports/zz-junction':{kind:'link',mode:0o120777}}]){
  m=model({...broad,...extra});const spawned=[];
  const run=(_exe,args)=>{spawned.push(args.at(-1));return {status:0,stdout:JSON.stringify({verified:false,reason:'additional_principal',inspected:1})};};
  assert.throws(()=>protectEvidence(root,{platform:'win32',systemRoot:path.resolve('synthetic-system'),run,fsx:m.fake}),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/[Nn]othing was changed/.test(e.message));
  assert.equal(spawned.filter(s=>s.includes('SetAccessControl')).length,0,'the protect script must not run when the survey refuses');checks++;
 }
}
// Gate rev_20260918172020_ehti: Windows PowerShell decodes stdin with the console's OEM code page
// unless the machine uses the UTF-8 system locale, so every payload must be pure ASCII (JSON \u
// escapes) and still name the exact path.
{
 const odd=path.resolve('pro\u00f8j\u00e9ct-\u65e5\u672c-\ud83d\udcc1','.ensemble_reviews'),payloads=[];
 const capture=output=>(_exe,_args,options)=>{payloads.push(options.input);return {status:0,stdout:JSON.stringify(output)};};
 const win={platform:'win32',systemRoot:path.resolve('synthetic-system'),fsx};
 inspectEvidencePermissions(odd,{...win,run:capture({verified:true,inspected:1})});
 createPrivateDirectory(odd,{...win,run:capture({created:true})});
 assert.throws(()=>protectEvidence(odd,{...win,run:capture({verified:false,reason:'additional_principal',inspected:1})}),{code:'MOMM_EVIDENCE_PERMISSIONS'});
 assert.equal(payloads.length,4,'inspection, private creation, inspection before protect, protect');
 for(const payload of payloads){assert.match(payload,/^[\x20-\x7e]+$/,'stdin payload must be pure ASCII');assert.equal(JSON.parse(payload).path,odd);}
 checks++;
}
// Provider scratch only: a sandboxing CLI (Codex) adds a read-only grant for its own sandbox group
// to the directory it runs in. The allowance is opt-in, named, read-only, reported, and never the
// default. The names travel in the stdin payload, never inside the script text.
{
 const win={platform:'win32',systemRoot:path.resolve('synthetic-system'),fsx};
 const seen=[];
 const answer=output=>(_exe,args,options)=>{seen.push({script:args.at(-1),payload:JSON.parse(options.input)});return {status:0,stdout:JSON.stringify(output)};};
 const allowed={allowReadOnlyPrincipals:['CodexSandboxUsers']};
 const tolerated=inspectEvidencePermissions(dir,{...win,...allowed,run:answer({verified:true,inspected:2,tolerated:['CodexSandboxUsers']})});
 assert.deepEqual(seen.at(-1).payload,{path:dir,allow_read_only:['CodexSandboxUsers']});
 assert(!seen.at(-1).script.includes('CodexSandboxUsers'),'names must never be interpolated into the script');
 assert.equal(tolerated.verified,true);
 assert.deepEqual(tolerated.tolerated,[{principal:'CodexSandboxUsers',rights:'read_execute'}]);checks++;
 // Nothing tolerated: no tolerated key at all, so a recorded result never implies an allowance.
 const plain=inspectEvidencePermissions(dir,{...win,...allowed,run:answer({verified:true,inspected:2,tolerated:[]})});
 assert.equal(plain.verified,true);assert.equal('tolerated' in plain,false);checks++;
 // Default call: no allowance in the payload; an inspector answer that claims one is not trusted.
 const claimed=inspectEvidencePermissions(dir,{...win,run:answer({verified:true,inspected:2,tolerated:['CodexSandboxUsers']})});
 assert.deepEqual(seen.at(-1).payload,{path:dir});
 assert.equal(claimed.verified,false);assert.equal(claimed.reason,'inspection_unavailable');checks++;
 // An answer naming a principal that was not requested, or a malformed list, is refused too.
 for(const bad of [['Everyone'],'CodexSandboxUsers',[7],['CodexSandboxUsers','Everyone']])
  assert.equal(inspectEvidencePermissions(dir,{...win,...allowed,run:answer({verified:true,inspected:2,tolerated:bad})}).verified,false);
 checks++;
 // The wrappers pass the option through and keep the result.
 assert.deepEqual(requirePrivateEvidence(dir,{...win,...allowed,run:answer({verified:true,inspected:1,tolerated:['codexsandboxusers']})}).tolerated,[{principal:'CodexSandboxUsers',rights:'read_execute'}]);checks++;
 // A write-capable rule is reported by the inspector as additional_principal and stays refused.
 assert.throws(()=>requirePrivateEvidence(dir,{...win,...allowed,run:answer({verified:false,reason:'additional_principal',inspected:1})}),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&e.reason==='additional_principal');checks++;
 // Validation happens before anything is spawned, on every platform.
 const noSpawn=()=>{throw Error('Must not spawn');};
 for(const bad of ['CodexSandboxUsers',[''],['1starts-with-digit'],['DOMAIN\\Group'],['a'.repeat(65)],['semi;colon'],[null],['a','b','c','d','e']]){
  for(const platform of ['win32','linux'])
   assert.throws(()=>inspectEvidencePermissions(dir,{...win,platform,uid:123,run:noSpawn,allowReadOnlyPrincipals:bad}),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/allowReadOnlyPrincipals/.test(e.message),JSON.stringify(bad));
  assert.throws(()=>requirePrivateScratch(dir,{...win,run:noSpawn,allowReadOnlyPrincipals:bad}),{code:'MOMM_EVIDENCE_PERMISSIONS'});
 }
 checks++;
 // An empty list is simply no allowance.
 inspectEvidencePermissions(dir,{...win,allowReadOnlyPrincipals:[],run:answer({verified:true,inspected:1})});
 assert.deepEqual(seen.at(-1).payload,{path:dir});checks++;
 // POSIX: the option changes nothing.
 const posixResult=inspectEvidencePermissions(dir,{platform:'linux',uid:123,fsx,...allowed});
 assert.equal(posixResult.verified,true);assert.equal('tolerated' in posixResult,false);
 assert.equal(inspectEvidencePermissions(dir,{platform:'linux',uid:123,fsx:{...fsx,lstatSync:()=>stat({mode:0o40750})},...allowed}).verified,false);checks++;
}
console.log(JSON.stringify({passed:true,checks,scope:'synthetic permission decisions; not native ACL certification'}));
