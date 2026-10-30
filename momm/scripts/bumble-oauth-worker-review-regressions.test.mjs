// Synthetic governor investigations. VM policy value exercises code only;
// the real registry/native entry remains disabled. No network or real secrets.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import crypto from 'node:crypto';import net from 'node:net';import tls from 'node:tls';import {performance} from 'node:perf_hooks';import {EventEmitter} from 'node:events';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {sealBumbleOAuthPeerHandoff,takeBumbleOAuthPeerHandoff} from '../scripts/bumble-oauth-peer-handoff.mjs';
import {prepareBumblePeerRequest} from '../scripts/bumble-peer-review.mjs';
import {parseBumbleJSON} from '../scripts/bumble-contract.mjs';
import {validateOpenAIEnvelope} from '../scripts/bumble-http-worker.mjs';
import {runBumbleOAuthPeerWorker} from '../scripts/bumble-oauth-peer-worker.mjs';

delete process.env.MOMM_EVIDENCE_HOME;
const source=fs.readFileSync(new URL('../scripts/bumble-oauth-peer-worker.mjs',import.meta.url),'utf8'),H=b=>crypto.createHash('sha256').update(b).digest('hex'),h=H('synthetic-binding');
const artifact='SYNTHETIC ONLY: two plus two equals five.',input={artifact,model:'synthetic-model',role:'architect',role_version:'1',max_tokens:1024};
function frame(token='fixture01+material/value='){
 const ca=Buffer.from('synthetic-public-certificate'),c={base_url:'https://100.126.129.80:5441/v1',server_name:'reviewer.example',certificate_sha256:H(ca),scope_binding:h,baseline_report_sha256:h,association_sha256:h,validator_sha256:h,policy_sha256:h,trust_sha256:h,disclosure_sha256:h,logging_sha256:h,attempt_id:'synthetic-attempt',deadline:Date.now()+5000};
 const d=sealBumbleOAuthPeerHandoff(input,c,{certificate:ca,access_token:Buffer.from(token)},q=>({schema:'momm-bumble-oauth-peer-approval/1',config_sha256:q.config_sha256,request_sha256:q.request_sha256,scope_binding:h,policy_sha256:h,trust_sha256:h,disclosure_sha256:h,logging_sha256:h,valid_until:c.deadline+1000}));return takeBumbleOAuthPeerHandoff(d).bytes;
}
function mock(body,status=200){const state={calls:0,requestDestroyed:false,responseDestroyed:false};const request=(_o,cb)=>{state.calls++;const req=new EventEmitter();req.destroy=()=>{state.requestDestroyed=true;};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=status;res.headers={};res.destroy=()=>{state.responseDestroyed=true;};cb(res);queueMicrotask(()=>{res.emit('data',Buffer.from(body));res.emit('end');});});return req;};return {request,state};}
function workerWith(validator){const start=source.indexOf('const H='),end=source.indexOf('\nif(process.argv[1]');assert(start>=0&&end>start);return vm.runInNewContext(source.slice(start,end).replace('export async function','async function')+'\nrunBumbleOAuthPeerWorker',{crypto,net,tls,performance,Buffer,Object,JSON,TextDecoder,URL,Date,setTimeout,clearTimeout,prepareBumblePeerRequest:value=>prepareBumblePeerRequest(JSON.parse(JSON.stringify(value))),parseBumbleJSON,validateOpenAIEnvelope:validator});}
async function cli({overflow=false}={}){
 const start=source.indexOf(' const refused='),end=source.lastIndexOf('\n}');assert(start>=0&&end>start);const chunks=[Buffer.from('SYNTHETIC_CHUNK'),Buffer.alloc(200000,65)],state={text:'',exit:null,timer:null};
 const stdin=overflow?(async function*(){yield* chunks;})():{[Symbol.asyncIterator](){return this;},next(){return new Promise(()=>{});}};
 const fn=vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})',{REMOTE_POLICY_ACTIVE:true,Buffer,process:{stdin,stdout:{write:text=>{state.text+=text;}},exit:code=>{state.exit=code;}},setTimeout:fn=>{state.timer=fn;return 1;},clearTimeout(){},runBumbleOAuthPeerWorker(){throw Error('No actual worker call expected.');}});
 const pending=fn();await Promise.resolve();if(!overflow){assert.equal(typeof state.timer,'function');state.timer();}else await pending;return{state,chunks};
}
const cases={
 async 'validator-child'(){process.once('uncaughtException',error=>{if(error.message==='SYNTHETIC_VALIDATOR_FAILURE')process.exit(42);process.stderr.write('Synthetic child assertion/context failure\n');process.exit(43);});const m=mock('{}'),run=workerWith(()=>{throw Error('SYNTHETIC_VALIDATOR_FAILURE');}),r=await run(frame(),{request:m.request});assert.equal(r.transport,'outcome_unknown');assert.equal(r.payload,'invalid_envelope');assert(m.state.requestDestroyed&&m.state.responseDestroyed);},
 async 'validator-failure'(){const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'validator-child'],{encoding:'utf8',windowsHide:true,timeout:7000});assert.equal(r.status,0,'A dependency exception must settle the worker, not become an uncaught process exception.');},
 async 'raw-reflection'(){for(const token of ['SYNTHETIC+material/value=','SYNTHETIC_UNRESERVED_TOKEN']){const m=mock(JSON.stringify({model:input.model,choices:[{message:{content:'echo:'+token},finish_reason:'stop'}]})),r=await runBumbleOAuthPeerWorker(frame(token),{request:m.request});assert.equal(r.payload,'credential_reflection');assert.equal(r.content,null);assert.equal(m.state.calls,1);}},
 async 'cli-timeout'(){const {state}=await cli();assert.equal(state.exit,2);assert(state.text.trim().length>0,'Stdin timeout must emit the refused result line.');assert.equal(JSON.parse(state.text).schema,'momm-bumble-peer-worker-result/1');},
 async 'cli-overflow'(){const {state,chunks}=await cli({overflow:true});assert.equal(JSON.parse(state.text).transport,'refused');for(const b of chunks)assert(b.every(n=>n===0),'Both partial and overflowing stdin chunks must be zeroed.');},
 async 'transport-conservatism'(){const m=mock('{}'),run=workerWith(()=>({transport:'refused',payload:'invalid_envelope',finished:false,content:null})),r=await run(frame(),{request:m.request});assert.equal(r.transport,'outcome_unknown');assert.equal(r.content,null);assert.equal(m.state.calls,1);assert(m.state.requestDestroyed&&m.state.responseDestroyed);},
 async 'non200-destroys'(){const m=mock('',429),r=await runBumbleOAuthPeerWorker(frame(),{request:m.request});assert.equal(r.transport,'refused');assert(m.state.requestDestroyed&&m.state.responseDestroyed);assert.equal(m.state.calls,1);},
 async 'tests-exist'(){const test=fileURLToPath(new URL('../scripts/bumble-oauth-peer-worker.test.mjs',import.meta.url)),r=spawnSync(process.execPath,[test],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0);assert(JSON.parse(r.stdout).passed>=32);}
};
const mode=process.argv[2]??'all';if(mode!=='all'&&!Object.hasOwn(cases,mode))throw Error('Known case required.');let passed=0;
for(const [name,fn]of Object.entries(cases))if((mode==='all'&&name!=='validator-child')||mode===name){await fn();passed++;console.log(JSON.stringify({name,passed:true}));}assert(passed>0);
console.log(JSON.stringify({passed,scope:'synthetic VM/owned child controls, closed native policy unchanged; validator-failure fault-injects a dependency rather than proving an upstream exploit'}));
