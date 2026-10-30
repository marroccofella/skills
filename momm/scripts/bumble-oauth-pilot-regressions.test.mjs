import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import crypto from 'node:crypto';import net from 'node:net';
delete process.env.MOMM_EVIDENCE_HOME;
const source=fs.readFileSync(new URL('./bumble-oauth-pilot.mjs',import.meta.url),'utf8');
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const mode=process.argv[2]??'all';
if(process.argv.length>3||!['all','--clock','--connection'].includes(mode))throw Error('Use --clock or --connection, or no argument for all five controls');
if(mode==='all'||mode==='--connection'){
 const begin=source.indexOf(' const config=Object.freeze(fields(p.config,CONFIG));'),end=source.indexOf('\n let previous=',begin);assert(begin>=0&&end>begin);const segment=source.slice(begin,end);
 for(const bad of [{base_url:{x:1},server_name:42},{base_url:'http://100.126.129.80:5441/v1',server_name:'reviewer.example'},{base_url:'https://127.0.0.1/v1',server_name:'reviewer.example'}]){
  const config={base_url:'https://100.126.129.80:5441/v1',server_name:'reviewer.example',certificate_sha256:H('x'),scope_binding:H('x'),baseline_report_sha256:H('x'),association_sha256:H('x'),validator_sha256:H('x'),policy_sha256:H('x'),trust_sha256:H('x'),disclosure_sha256:H('x'),logging_sha256:H('x'),...bad};
  const context=vm.createContext({Object,URL,net,H,SHA:v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),fields:v=>({...v}),CONFIG:Object.keys(config),p:{config,config_sha256:H(JSON.stringify(config)),baseline_report_sha256:config.baseline_report_sha256},fail(){throw Error('refused');}});
  assert.throws(()=>vm.runInContext(segment,context),/refused/,'invalid connection must be rejected before admission/private material');
 }
 console.log(JSON.stringify({passed:3,scope:'actual constructor connection-validation segment; no I/O'}));
}
if(mode!=='--connection'){
let persisted=0,terminal=0,caught=null,value=null;
if(mode!=='--clock'){
const tail=source.slice(source.indexOf('   let envelope=null;'),source.lastIndexOf('\n  }\n });'));
assert(tail.startsWith('   let envelope=null;'));
const context=vm.createContext({Buffer,Date,execution:{code:0,stdout:JSON.stringify({transport:'success',payload:'envelope_valid',finished:true,content:'synthetic-control'})},parseBumbleJSON:JSON.parse,validWorkerResult:()=>true,check(){},remaining:()=>10000,validateBumblePeerContent(){throw Error('SYNTHETIC_VALIDATOR_FAULT');},persistAttempt(){persisted++;return {synthetic:true};},o:{capacity:{summary:()=>({reservations:[{id:'one',transmission_possible:true}]}),terminal(){terminal++;}}},started:{attempt_id:'synthetic'},r:{reservation_id:'one'},project:'synthetic',p:{run_id:'rev_synthetic',input_sha256:'a'.repeat(64)},baseline:{report_sha256:'b'.repeat(64)},request:{request_sha256:'c'.repeat(64)},source:'synthetic',worker_binding:'d'.repeat(64),deadline:Date.now()+10000,task_id:'synthetic',spawned:1});
try{value=await vm.runInContext('(async()=>{'+tail+'})()',context);}catch(e){caught=e.message;}
assert.equal(caught,null,'validator exception must not escape the admitted-attempt recording path');assert.equal(persisted,1);assert.equal(terminal,1);assert.equal(value.status,'invalid_output');assert.equal(value.reservation_held,true);
}
let called=0;const begin=source.indexOf('privateBytes=takeBumbleOAuthPeerHandoff(handoff).bytes;'),end=source.indexOf('\n   }catch',begin),segment=source.slice(begin,end);assert(begin>=0&&end>begin);
const late=vm.createContext({takeBumbleOAuthPeerHandoff:()=>({bytes:Buffer.from('synthetic-only')}),handoff:{},check(){},remaining:()=>0.5,fail(){throw Error('late');},executor:{async execute(_bytes,o){called++;assert(o.timeoutMs>0);}},privateBytes:null,spawned:0});
await assert.rejects(vm.runInContext('(async()=>{'+segment+'})()',late),{message:'late'});assert.equal(called,0,'sub-millisecond budget must refuse before invoking executor');assert.equal(late.spawned,0);
console.log(JSON.stringify({passed:mode==='--clock'?1:2,scope:'actual broker tail/dispatch segment under injected validator fault and sub-millisecond budget; no network operations'}));
}
