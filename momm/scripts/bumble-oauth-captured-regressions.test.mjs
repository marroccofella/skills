import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {captureBumbleOAuthWorker,BUMBLE_OAUTH_WORKER_FILES} from './bumble-protected-execution.mjs';
import {privateTestFixture} from './private-test-fixture.mjs';import {defaultExec} from './probes.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),origin=path.dirname(fileURLToPath(import.meta.url)),home=fs.realpathSync.native(privateTestFixture('momm-oauth-captured-controls-'));
for(const name of BUMBLE_OAUTH_WORKER_FILES)fs.copyFileSync(path.join(origin,name),path.join(home,name));
// Generated trusted test worker observes only an instrumented test buffer array;
// no token, certificate or network operation is involved. No product file edited.
fs.writeFileSync(path.join(home,'bumble-oauth-peer-worker.mjs'),'export function runBumbleOAuthPeerWorker(){return {wiped:globalThis.__TEST_CHUNKS.every(b=>b.every(n=>n===0))};}\n');
const files=BUMBLE_OAUTH_WORKER_FILES.map(file=>({file,sha256:H(fs.readFileSync(path.join(home,file)))}));let children=0;
function executor(tamper=false){return captureBumbleOAuthWorker({source_root:home,files,manifest_sha256:H(JSON.stringify(files)),runProcess:async(command,args,o)=>{
 children++;const observed=args.slice();assert(observed[3].includes('let length=0;const chunks=[];'));
 observed[3]=observed[3].replace('let length=0;const chunks=[];','let length=0;const chunks=globalThis.__TEST_CHUNKS=[];');
 let input=o.input;if(tamper){const p=JSON.parse(input);p.job+='=';input=JSON.stringify(p);}
 return defaultExec(command,observed,{input,timeout:o.timeoutMs,env:o.env,cwd:home});
}});}
const e=executor();await assert.rejects(e.execute(Buffer.from('synthetic-only')),/Protected worker graph refused/);assert.equal(children,0);
const r=await e.execute(Buffer.from('synthetic-only'),{timeoutMs:15000});assert.equal(r.code,0);assert.equal(JSON.parse(r.stdout).wiped,true,'owned raw stdin chunks must be wiped before captured module evaluation');
const bad=await executor(true).execute(Buffer.from('synthetic-only'),{timeoutMs:15000});assert.equal(bad.code,1);assert.equal(JSON.parse(bad.stdout).payload,'captured_execution_refused');
console.log(JSON.stringify({passed:3,synthetic_only:true,real_network_calls:0,scope:'owned raw input wiping; mandatory timeout; canonical OAuth base64 in actual supervised child'}));
