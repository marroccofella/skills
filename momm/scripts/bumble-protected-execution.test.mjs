delete process.env.MOMM_EVIDENCE_HOME;
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {BUMBLE_WORKER_FILES,captureBumbleWorker} from './bumble-protected-execution.mjs';
import {privateTestFixture} from './private-test-fixture.mjs';import {defaultExec} from './probes.mjs';
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),origin=path.dirname(fileURLToPath(import.meta.url)),home=privateTestFixture('momm-captured-worker-');
let cases=0,children=0;const check=async(name,run)=>{await run();cases++;console.log('PASS '+name);};
function setup(){const root=path.join(home,crypto.randomUUID());fs.mkdirSync(root,{mode:0o700});for(const name of BUMBLE_WORKER_FILES)fs.copyFileSync(path.join(origin,name),path.join(root,name));const files=BUMBLE_WORKER_FILES.map(file=>({file,sha256:H(fs.readFileSync(path.join(root,file)))}));return {source_root:fs.realpathSync.native(root),files,manifest_sha256:H(JSON.stringify(files)),runProcess:async(command,args,o)=>{children++;assert.equal(command,process.execPath);assert.deepEqual(args.slice(0,3),['--experimental-vm-modules','--input-type=module','--eval']);assert(!Object.keys(o.env).some(k=>k.toUpperCase()==='NODE_OPTIONS'));const payload=JSON.parse(o.input);assert(args[3].includes(H(payload.graph)));return defaultExec(command,args,{input:o.input,timeout:o.timeoutMs,env:o.env,cwd:home});}};}
await check('missing external manifest pin refuses before child',()=>{const o=setup(),before=children;delete o.manifest_sha256;assert.throws(()=>captureBumbleWorker(o));assert.equal(children,before);});
await check('changed external manifest pin refuses before child',()=>{const o=setup(),before=children;assert.throws(()=>captureBumbleWorker({...o,manifest_sha256:'0'.repeat(64)}));assert.equal(children,before);});
await check('changed worker and changed transitive dependency each refuse capture',()=>{for(const name of ['bumble-peer-worker.mjs','evidence-location.mjs']){const o=setup();fs.appendFileSync(path.join(o.source_root,name),'\nthrow Error("synthetic mutation");\n');assert.throws(()=>captureBumbleWorker(o));}assert.equal(children,0);});
await check('duplicate graph member refuses',()=>{const o=setup(),before=children;o.files[1]={...o.files[0]};o.manifest_sha256=H(JSON.stringify(o.files));assert.throws(()=>captureBumbleWorker(o));assert.equal(children,before);});
await check('unknown graph member refuses',()=>{const o=setup(),before=children;o.files[1]={file:'unknown.mjs',sha256:H('synthetic')};o.manifest_sha256=H(JSON.stringify(o.files));assert.throws(()=>captureBumbleWorker(o));assert.equal(children,before);});
await check('hard-linked graph member refuses before child',()=>{const o=setup(),before=children;fs.linkSync(path.join(o.source_root,'bumble-peer-worker.mjs'),path.join(home,crypto.randomUUID()+'.mjs'));assert.throws(()=>captureBumbleWorker(o));assert.equal(children,before);});
await check('linked source root refuses before child',()=>{const o=setup(),before=children,linked=path.join(home,crypto.randomUUID());fs.symlinkSync(o.source_root,linked,process.platform==='win32'?'junction':'dir');assert.throws(()=>captureBumbleWorker({...o,source_root:linked}));assert.equal(children,before);});
await check('owned snapshot ignores caller mutation and later worker/dependency replacement',async()=>{
 const before=children,o=setup(),executor=captureBumbleWorker(o);assert.equal(executor.worker_sha256,o.files.find(f=>f.file==='bumble-peer-worker.mjs').sha256);
 for(const name of BUMBLE_WORKER_FILES)fs.writeFileSync(path.join(o.source_root,name),'throw Error("project replacement must not run");\n');
 o.files[0].sha256='0'.repeat(64);o.runProcess=()=>{throw Error('Changed callback must not run');};
 const result=await executor.execute({schema:'deliberately-invalid-synthetic-job'},{timeoutMs:15000});assert.equal(children,before+1);assert.equal(result.code,0);const value=JSON.parse(result.stdout);assert.equal(value.transport,'refused');assert.equal(value.payload,'invalid_handoff');
});
await check('actual graph imports and returns malformed-job refusal',async()=>{const before=children,e=captureBumbleWorker(setup());const result=await e.execute(null,{timeoutMs:15000});assert.equal(children,before+1);assert.equal(result.code,0);assert.equal(JSON.parse(result.stdout).payload,'invalid_handoff');});
await check('oversized input and invalid deadlines refuse before supervision',async()=>{const e=captureBumbleWorker(setup()),before=children;const refused=error=>error.message==='Protected worker graph refused; no child authorized.';for(const timeoutMs of [0,-1,180001,NaN])await assert.rejects(e.execute(null,{timeoutMs}),refused);await assert.rejects(e.execute({huge:'x'.repeat(2000000)},{timeoutMs:1000}),refused);assert.equal(children,before);});
function generated(source){const o=setup();fs.writeFileSync(path.join(o.source_root,'bumble-peer-worker.mjs'),source);o.files=o.files.map(row=>({...row,sha256:H(fs.readFileSync(path.join(o.source_root,row.file)))}));o.manifest_sha256=H(JSON.stringify(o.files));return o;}
for(const mode of ['open-handle','noise','undefined','static-import','dynamic-import'])await check('actual generated child '+mode,async()=>{
 const code={
  'open-handle':"export function runPeerShadowWorker(){setInterval(()=>{},1000);return {synthetic:true};}",
  noise:"console.log('synthetic import noise');export function runPeerShadowWorker(){console.log('synthetic job noise');return {synthetic:true};}",
  undefined:'export function runPeerShadowWorker(){}',
  'static-import':"import './unknown.mjs';export function runPeerShadowWorker(){return {synthetic:true};}",
  'dynamic-import':"export async function runPeerShadowWorker(){await import('node:fs');return {synthetic:true};}"
 }[mode],before=children,result=await captureBumbleWorker(generated(code)).execute({synthetic:true},{timeoutMs:10000});
 assert.equal(children,before+1);assert.equal(result.timedOut,false);const value=JSON.parse(result.stdout);
 if(['open-handle','noise'].includes(mode)){assert.equal(result.code,0);assert.equal(value.synthetic,true);}else{assert.equal(result.code,1);assert.equal(value.payload,'captured_execution_refused');}
});
await check('nonserializable or undefined jobs normalize refusal without child',async()=>{const e=captureBumbleWorker(setup()),before=children,cycle={};cycle.self=cycle;for(const job of [undefined,1n,cycle])await assert.rejects(e.execute(job,{timeoutMs:1000}),error=>error.message==='Protected worker graph refused; no child authorized.');assert.equal(children,before);});
await check('encoded graph that cannot fit refuses during capture',()=>{const o=generated('export const padding='+JSON.stringify('\\'.repeat(370000))+';export function runPeerShadowWorker(){return {synthetic:true};}'),before=children;assert.throws(()=>captureBumbleWorker(o),error=>error.message==='Protected worker graph refused; no child authorized.');assert.equal(children,before);});
console.log(JSON.stringify({suite:'captured-worker',cases,supervised_children:children,child_network_and_material_observation:'instrumentation_unavailable',test_inputs:'generated invalid jobs and synthetic source files',completion:false}));
