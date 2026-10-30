import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createBumbleShadowBroker} from '../scripts/bumble-peer-shadow.mjs';
import {prepareBumblePeerRequest} from '../scripts/bumble-peer-review.mjs';
import {BumbleCapacity} from '../scripts/bumble-capacity.mjs';
import {privateTestFixture} from '../scripts/private-test-fixture.mjs';
import {preparePrivateEvidence} from '../scripts/evidence-permissions.mjs';
import {evidenceDir} from '../scripts/evidence-location.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=value=>crypto.createHash('sha256').update(value).digest('hex');
const project=fs.realpathSync(process.cwd()),home=fs.realpathSync.native(privateTestFixture('momm-shadow-broker-'));
process.env.MOMM_EVIDENCE_HOME=home;preparePrivateEvidence(evidenceDir({cwd:project,env:process.env}));
const keys=crypto.generateKeyPairSync('ed25519');
const public_key_pem=keys.publicKey.export({type:'spki',format:'pem'}),public_key_sha256=H(keys.publicKey.export({type:'spki',format:'der'}));
const script=name=>fileURLToPath(new URL('../scripts/'+name,import.meta.url));
const fixtureInput=i=>({artifact:`export const synthetic${i} = ${i};`,model:'synthetic-model',max_tokens:1024,role:'architect',role_version:'1'});
let cases=0,calls=0;
async function check(name,run){await run();cases++;console.log('PASS '+name);}
function setup(label,{change=()=>{},capacity:existing,signer=keys.privateKey}={}){
  // Fresh children inherit the verified private fixture ACL; no existing path's
  // permissions are changed. The production broker audits both stores itself.
  const base=path.join(home,label);fs.mkdirSync(base,{mode:0o700});
  const approvals=path.join(base,'approvals'),journal=path.join(base,'journal');fs.mkdirSync(approvals,{mode:0o700});fs.mkdirSync(journal,{mode:0o700});
  // Nonexistent synthetic paths: the mocked supervisor never opens material.
  const connection={connect_address:'100.100.100.100',port:443,tls_identity:'192.168.99.1',certificate_file:path.join(base,'synthetic.crt'),certificate_sha256:H('synthetic certificate'),credential_file:path.join(base,'synthetic.json'),model:'synthetic-model',credential_epoch:1};
  const now=Date.now(),capacity=existing??new BumbleCapacity({root:path.join(base,'capacity'),project_root:project,config:{schema:'momm-bumble-capacity/1',deadline:now+3600000,max_attempts:8,max_reserved_tokens:8192,global_slots:1,resource_groups:[{id:'synthetic-gpu',slots:1}],source_ip_groups:[{id:'synthetic-ip',slots:1}],endpoints:[{id:'synthetic-endpoint',resource_group:'synthetic-gpu',source_ip_group:'synthetic-ip'}]}});
  const p={schema:'momm-bumble-shadow-approval/1',authorization_id:crypto.randomUUID(),issued_at:now-1,expires_at:now+300000,run_id:'rev_broker_'+crypto.randomUUID().replaceAll('-',''),endpoint_id:'synthetic-endpoint',connection_sha256:H(JSON.stringify(connection)),adapter_sha256:H(fs.readFileSync(script('bumble-peer-worker.mjs'))),broker_sha256:H(fs.readFileSync(script('bumble-peer-shadow.mjs'))),capacity_configuration_sha256:capacity.summary().configuration_sha256,operator_reconciliation_sha256:H('synthetic reconciliation; not real backend proof'),credential_epoch:1,disclosure:'synthetic_code_only',mode:'synthetic_shadow',max_requests:4,max_tokens:1024,deadline_ms:180000,fixtures:[1,2].map(i=>{const input=fixtureInput(i);return {id:'synthetic-'+i,input,request_sha256:prepareBumblePeerRequest(input).request_sha256};})};
  change(p);
  const file='approval-'+p.authorization_id+'.json';
  const write=(plan=p,signingKey=signer)=>{
    const payload=JSON.stringify(plan),bytes=Buffer.from(JSON.stringify({payload,signature:crypto.sign(null,Buffer.from(payload),signingKey).toString('base64url')})+'\n');
    fs.writeFileSync(path.join(approvals,file),bytes,{mode:0o600});return H(bytes);
  };
  const options={project_root:project,journal_root:journal,approval_root:approvals,approval_file:file,approval_sha256:write(),public_key_pem,public_key_sha256,connection,capacity,runProcess:async(command,args,options)=>{
    calls++;assert.equal(command,process.execPath);assert.equal(args.length,1);assert.equal(args[0],script('bumble-peer-worker.mjs'));assert(options.timeoutMs>0&&options.timeoutMs<=180000);
    const job=JSON.parse(options.input);assert.equal(job.frame.model,'synthetic-model');
    const content=JSON.stringify({review_status:'complete',reviewed_scope:[{quote:job.frame.artifact,assessment:'The supplied constant export.'}],verdict:'ACCEPT',confidence:0.9,findings:[],summary:'No concrete defect in this scope.',suggested_improvements:[]});
    return {code:0,timedOut:false,outputLimited:false,stdout:JSON.stringify({schema:'momm-bumble-peer-worker-result/1',attempt_id:job.attempt_id,transport:'success',payload:'envelope_valid',finished:true,content,http_status:200,duration_ms:1,raw_envelope_sha256:H('synthetic envelope')})};
  }};
  return {options,plan:p,write,capacity,journal,approvals,file};
}
const budgetOnly=process.argv.includes('--one-request-only');
if(!budgetOnly){
await check('missing approval and fake capacity refuse without executing a supervisor',()=>{
  assert.throws(()=>createBumbleShadowBroker({owner_approved:true}));
  const f=setup('fake');let touched=false;assert.throws(()=>createBumbleShadowBroker({...f.options,capacity:{summary(){touched=true;return {};}}}));assert.equal(touched,false);assert.equal(calls,0);
});
const negativeCapacity=setup('negative-pool').capacity;
for(const [label,change] of [
  ['expired',p=>{p.issued_at-=400000;p.expires_at=Date.now()-1;}],
  ['future',p=>{p.issued_at=Date.now()+10000;p.expires_at=p.issued_at+10000;}],
  ['long-lived',p=>{p.expires_at=p.issued_at+3600001;}],
  ['wrong-schema',p=>{p.schema='untrusted';}],
  ['private-source',p=>{p.disclosure='private_repository';}],
  ['bigger-budget',p=>{p.max_requests=5;}],
  ['wrong-worker',p=>{p.adapter_sha256='0'.repeat(64);}],
  ['wrong-broker',p=>{p.broker_sha256='0'.repeat(64);}],
  ['wrong-capacity',p=>{p.capacity_configuration_sha256='0'.repeat(64);}],
  ['wrong-connection',p=>{p.connection_sha256='0'.repeat(64);}],
  ['missing-reconciliation',p=>{p.operator_reconciliation_sha256=null;}],
  ['wrong-epoch',p=>{p.credential_epoch=2;}],
  ['duplicate-fixture',p=>{p.fixtures.push(p.fixtures[0]);}],
  ['duplicate-content',p=>{p.fixtures[1]={...p.fixtures[0],id:'other'};}],
  ['request-changed',p=>{p.fixtures[0].input.artifact+=' changed';}],
  ['overlong-run',p=>{p.run_id='rev_'+'x'.repeat(125);}]
])await check('refuse '+label,()=>{const before=calls,f=setup(label,{change,capacity:negativeCapacity});assert.throws(()=>createBumbleShadowBroker(f.options));assert.equal(calls,before);assert.equal(f.capacity.summary().attempts,0);});
await check('foreign signer and changed pin refuse',()=>{
  const before=calls,foreign=crypto.generateKeyPairSync('ed25519'),f=setup('foreign',{signer:foreign.privateKey});
  assert.throws(()=>createBumbleShadowBroker(f.options));
  const correctlySigned=setup('pin-only');assert.throws(()=>createBumbleShadowBroker({...correctlySigned.options,public_key_sha256:'0'.repeat(64)}));assert.equal(calls,before);
});
await check('credential-bearing connection extras refuse before child framing',()=>{
  const f=setup('credential-fields'),before=calls;f.options.connection.api_key=['synthetic','not','credential'].join('-');
  f.plan.connection_sha256=H(JSON.stringify(f.options.connection));f.options.approval_sha256=f.write();
  assert.throws(()=>createBumbleShadowBroker(f.options));assert.equal(calls,before);assert.equal(f.capacity.summary().attempts,0);
});
await check('changed receipt before dispatch refuses with no child or reservation',async()=>{
  const f=setup('receipt-change'),broker=createBumbleShadowBroker(f.options);const before=calls;
  fs.appendFileSync(path.join(f.approvals,f.file),' ');
  await assert.rejects(broker.dispatch('synthetic-1'));assert.equal(calls,before);assert.equal(f.capacity.summary().attempts,0);
});
await check('local revocation refuses before admission',async()=>{
  const f=setup('revoked'),broker=createBumbleShadowBroker(f.options);const before=calls;
  fs.writeFileSync(path.join(f.approvals,'revoked-'+f.plan.authorization_id+'.json'),'{}\n',{flag:'wx',mode:0o600});
  await assert.rejects(broker.dispatch('synthetic-1'));assert.equal(calls,before);assert.equal(f.capacity.summary().attempts,0);
});
await check('post-load expiry refuses before child launch',async()=>{
  const f=setup('late'),broker=createBumbleShadowBroker(f.options),clock=Date.now,before=calls;
  try{Date.now=()=>f.plan.expires_at;await assert.rejects(broker.dispatch('synthetic-1'));}finally{Date.now=clock;}
  await assert.rejects(broker.dispatch('synthetic-1'),'Observed expiry remains burned after clock return.');
  assert.equal(calls,before);assert.equal(f.capacity.summary().attempts,0);
});
await check('unknown fixture and source mutation cannot change signed frame',async()=>{
  const f=setup('owned'),broker=createBumbleShadowBroker(f.options),before=calls;
  f.options.connection.model='untrusted-model';f.plan.fixtures[0].input.artifact='unapproved replacement';
  await assert.rejects(broker.dispatch('not-approved'));assert.equal(calls,before);
  const value=await broker.dispatch('synthetic-1');assert.equal(value.status,'advisory_valid');assert.equal(value.reservation_held,true);assert.equal(value.quorum_votes,0);
  assert.equal(f.capacity.summary().held,1);assert.equal(f.capacity.summary().attempts,1);assert.equal(f.capacity.summary().reserved_tokens,1024);
  await assert.rejects(broker.dispatch('synthetic-1'));assert.equal(calls,before+1);
  assert.equal(fs.readdirSync(f.journal).filter(n=>n.startsWith('claim-')).length,1);assert.equal(fs.readdirSync(f.journal).filter(n=>n.startsWith('result-')).length,1);
});
await check('restart cannot replay a claimed fixture or infer release from completion',async()=>{
  const f=setup('restart'),before=calls,broker=createBumbleShadowBroker(f.options);
  await broker.dispatch('synthetic-1');const restarted=createBumbleShadowBroker(f.options);
  await assert.rejects(restarted.dispatch('synthetic-1'));assert.equal(calls,before+1);
  const blocked=await restarted.dispatch('synthetic-2');assert.equal(blocked.dispatched,0);assert.equal(blocked.reason,'shared_capacity_or_budget');
  assert.equal(f.capacity.summary().held,1);assert.equal(f.capacity.summary().attempts,1);assert.equal(f.capacity.summary().reserved_tokens,1024);
});
await check('same authorization ID cannot redefine signed input',()=>{
  const f=setup('redefine');createBumbleShadowBroker(f.options);f.plan.fixtures[0].input=fixtureInput(3);f.plan.fixtures[0].request_sha256=prepareBumblePeerRequest(f.plan.fixtures[0].input).request_sha256;
  f.options.approval_sha256=f.write();assert.throws(()=>createBumbleShadowBroker(f.options));assert.equal(f.capacity.summary().attempts,0);
});
await check('hard-linked approval is refused without reading a credential',()=>{
  const f=setup('hardlink');fs.linkSync(path.join(f.approvals,f.file),path.join(f.approvals,'copy.json'));
  assert.throws(()=>createBumbleShadowBroker(f.options));assert.equal(f.capacity.summary().attempts,0);
});
}
await check('a signed one-request ceiling is accepted and stays one after dispatch and restart',async()=>{
  const before=calls,f=setup('one-request',{change(p){p.max_requests=1;p.fixtures=p.fixtures.slice(0,1);}});let broker;
  assert.doesNotThrow(()=>{broker=createBumbleShadowBroker(f.options);},'A valid signed ceiling of one must not require four-request authority');
  const result=await broker.dispatch('synthetic-1');assert.equal(result.status,'advisory_valid');assert.equal(calls,before+1);
  const s=f.capacity.summary();assert.equal(s.attempts,1);assert.equal(s.reserved_tokens,1024);assert.equal(s.held,1);
  const stored=JSON.parse(fs.readFileSync(path.join(f.approvals,'..','capacity','capacity.json'),'utf8')).reservations[0].admission_budget;
  assert.equal(stored.max_attempts,1);assert.equal(stored.max_reserved_tokens,1024);assert.equal(stored.max_completion_tokens,1024);assert.equal(stored.max_outstanding,1);
  await assert.rejects(broker.dispatch('synthetic-2'));await assert.rejects(createBumbleShadowBroker(f.options).dispatch('synthetic-1'));assert.equal(calls,before+1);
  f.plan.max_requests=4;f.options.approval_sha256=f.write();assert.throws(()=>createBumbleShadowBroker(f.options),'An existing authorization cannot be widened by re-signing different terms');assert.equal(f.capacity.summary().attempts,1);assert.equal(f.capacity.summary().held,1);
});
for(const value of [0,-1,1.5,true,'1',5])await check('invalid narrowed request ceiling '+String(value)+' refuses before admission',()=>{
 const before=calls,f=setup('invalid-ceiling-'+typeof value+'-'+String(value),{change(p){p.max_requests=value;p.fixtures=p.fixtures.slice(0,1);}});assert.throws(()=>createBumbleShadowBroker(f.options));assert.equal(f.capacity.summary().attempts,0);assert.equal(calls,before);
});
for(const value of [2,3])await check('finite signed request ceiling '+value+' is accepted without dispatch',()=>{
 const before=calls,f=setup('finite-ceiling-'+value,{change(p){p.max_requests=value;}});assert.doesNotThrow(()=>createBumbleShadowBroker(f.options));assert.equal(f.capacity.summary().attempts,0);assert.equal(calls,before);
});
await check('more fixtures than the signed request ceiling refuses',()=>{const before=calls,f=setup('fixture-ceiling-overflow',{change(p){p.max_requests=1;}});assert.throws(()=>createBumbleShadowBroker(f.options));assert.equal(f.capacity.summary().attempts,0);assert.equal(calls,before);});
console.log(JSON.stringify({passed:cases,synthetic_supervisor_invocations:calls,scope:'signed protected-plan broker controls; supervisor mocked; no real BAB qualification',fixtures_retained:true}));
