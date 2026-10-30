import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';
import {runBumblePeerShadow} from './bumble-peer-shadow.mjs';
import {privateTestFixture} from './private-test-fixture.mjs';
import {preparePrivateEvidence} from './evidence-permissions.mjs';
import {evidenceDir} from './evidence-location.mjs';
import {BumbleCapacity} from './bumble-capacity.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: fixtures choose their own evidence home
const H=value=>crypto.createHash('sha256').update(value).digest('hex');
const home=privateTestFixture('momm-peer-shadow-');
process.env.MOMM_EVIDENCE_HOME=home;const project=fs.realpathSync(process.cwd());preparePrivateEvidence(evidenceDir({cwd:project,env:process.env}));
const artifact='export const value = 1;',input={artifact,model:'synthetic-model',max_tokens:1024,role:'architect',role_version:'1'};
let cases=0,calls=0,reserves=0,marks=0,terminals=0,held=false;
const check=async(name,fn)=>{await fn();cases++;};
const capacity={summary(){return {configuration_sha256:'d'.repeat(64),attempts:held?1:0,reserved_tokens:held?1024:0};},reserve(options){reserves++;assert.equal(options.admission_budget.authorization_sha256,'e'.repeat(64));assert.equal(options.admission_budget.configuration_sha256,'d'.repeat(64));assert.equal(options.admission_budget.max_attempts,4);assert.equal(options.admission_budget.max_reserved_tokens,4096);assert.equal(options.admission_budget.max_completion_tokens,1024);assert.equal(options.admission_budget.max_outstanding,1);if(held)return {admitted:false};held=true;return {admitted:true,reservation_id:crypto.randomUUID()};},markTransmissionPossible(){marks++;},terminal(){terminals++;/* Success deliberately does not release physical capacity. */}};
const connection={synthetic:true,credential_epoch:1};
const host={approval:{mode:'synthetic_shadow',owner_approved:true,expires_at:Date.now()+3600000,disclosure:'synthetic_code_only',max_requests:4,max_tokens:1024,deadline_ms:180000,operator_reconciliation_sha256:'a'.repeat(64)},root:project,run_id:'rev_shadow_'+crypto.randomUUID().replaceAll('-',''),endpoint_id:'synthetic',adapter_sha256:'b'.repeat(64),connection,connection_sha256:H(JSON.stringify(connection)),capacity,runProcess:async(command,args,options)=>{calls++;assert.equal(command,process.execPath);assert.equal(args.length,1);assert(args[0].endsWith('bumble-peer-worker.mjs'));assert(options.timeoutMs<=180000);const job=JSON.parse(options.input);const content=JSON.stringify({review_status:'complete',reviewed_scope:[{quote:artifact,assessment:'A constant export.'}],verdict:'ACCEPT',confidence:0.9,findings:[],summary:'No concrete defect.',suggested_improvements:[]});return {code:0,stdout:JSON.stringify({schema:'momm-bumble-peer-worker-result/1',attempt_id:job.attempt_id,transport:'success',payload:'envelope_valid',finished:true,content,reported_usage:null,http_status:200,request_id:'synthetic-request',retry_after:null,duration_ms:1,raw_envelope_sha256:'c'.repeat(64)}),timedOut:false,outputLimited:false};}};
host.adapter_sha256=H(fs.readFileSync(new URL('./bumble-peer-worker.mjs',import.meta.url)));
Object.assign(host.approval,{connection_sha256:host.connection_sha256,adapter_sha256:host.adapter_sha256,credential_epoch:connection.credential_epoch,authorization_sha256:'e'.repeat(64),capacity_configuration_sha256:'d'.repeat(64)});
await check('default refusal touches no source',async()=>{let reads=0;const source=new Proxy({},{get(){reads++;throw Error('Unapproved source access');}});const value=await runBumblePeerShadow(source,{});assert.equal(value.dispatched,0);assert.equal(reads,0);assert.equal(calls,0);});
await check('unknown prior outcome cannot be cleared by idle counters',async()=>{const value=await runBumblePeerShadow(input,{...host,approval:{...host.approval,operator_reconciliation_sha256:null}});assert.equal(value.dispatched,0);assert.equal(reserves,0);});
await check('expired approval refuses',async()=>{const value=await runBumblePeerShadow(input,{...host,approval:{...host.approval,expires_at:0}});assert.equal(value.dispatched,0);assert.equal(reserves,0);});
await check('changed connection refuses before admission',async()=>{const value=await runBumblePeerShadow(input,{...host,connection:{changed:true}});assert.equal(value.dispatched,0);assert.equal(reserves,0);});
await check('durable attempt and exact supervised job',async()=>{const value=await runBumblePeerShadow(input,host);assert.equal(value.status,'advisory_valid');assert.equal(calls,1);assert.equal(marks,1);assert.equal(terminals,1);assert.equal(value.quorum_votes,0);assert.equal(value.completion,false);assert.equal(value.reservation_held,true);const at=path.join(evidenceDir({cwd:project,env:process.env}),'attempts');const names=fs.readdirSync(at);assert.equal(names.filter(n=>n.endsWith('.started.json')).length,1);assert.equal(names.filter(n=>!n.endsWith('.started.json')).length,1);});
await check('no completion-based invented physical release or replay',async()=>{const value=await runBumblePeerShadow(input,host);assert.equal(value.dispatched,0);assert.equal(value.reason,'shared_capacity_or_budget');assert.equal(calls,1);assert.equal(held,true);});
for(const mode of ['throw','timedOut','outputLimited','mismatched_attempt','mark_throw','start_failure','persist_failure','null_reservation']) {
  await check('failure retains capacity: '+mode,async()=>{
    let invoked=0,transmitted=0;
    const isolated={...host,run_id:'rev_shadow_failure_'+crypto.randomUUID().replaceAll('-',''),capacity:{...capacity,summary:()=>({configuration_sha256:'d'.repeat(64),attempts:0,reserved_tokens:0}),reserve:()=>mode==='null_reservation'?null:{admitted:true,reservation_id:crypto.randomUUID()},markTransmissionPossible:()=>{if(mode==='mark_throw')throw Error('Synthetic capacity failure');transmitted++;}},runProcess:async(...args)=>{
      invoked++;
      if(mode==='throw')throw Error('Synthetic supervisor failure');
      if(mode==='persist_failure')process.env.MOMM_EVIDENCE_HOME=path.join(home,'absent-evidence');
      const response=await host.runProcess(...args);
      if(mode==='timedOut')response.timedOut=true;
      if(mode==='outputLimited')response.outputLimited=true;
      if(mode==='mismatched_attempt'){const value=JSON.parse(response.stdout);value.attempt_id='wrong-attempt';response.stdout=JSON.stringify(value);}
      return response;
    }};
    if(mode==='start_failure')isolated.root=path.join(project,'nonexistent-synthetic-project');
    try {
      const value=await runBumblePeerShadow(input,isolated);
      assert.notEqual(value.status,'advisory_valid');
      assert(value.reservation_held===true||value.reservation_held==='unknown');
      assert.equal(invoked,['mark_throw','start_failure','null_reservation'].includes(mode)?0:1);
      assert.equal(value.dispatched,invoked);
      assert.equal(value.completion,false);
    } finally {process.env.MOMM_EVIDENCE_HOME=home;}
  });
}
await check('missing approval identity refuses before admission',async()=>{const before=reserves;const value=await runBumblePeerShadow(input,{...host,approval:{...host.approval,authorization_sha256:undefined}});assert.equal(value.dispatched,0);assert.equal(reserves,before);});
await check('changed global capacity digest refuses before admission',async()=>{const before=reserves;const value=await runBumblePeerShadow(input,{...host,approval:{...host.approval,capacity_configuration_sha256:'f'.repeat(64)}});assert.equal(value.dispatched,0);assert.equal(reserves,before);});
for(const mode of ['contradictory_axes','over_budget_duration','invalid_json','credential_reflection']) {
  await check('worker result axes and budget: '+mode,async()=>{
    const isolated={...host,run_id:'rev_shadow_axes_'+crypto.randomUUID().replaceAll('-',''),capacity:{...capacity,summary:()=>({configuration_sha256:'d'.repeat(64),attempts:0,reserved_tokens:0}),reserve:()=>({admitted:true,reservation_id:crypto.randomUUID()})},runProcess:async(...args)=>{
      const response=await host.runProcess(...args),value=JSON.parse(response.stdout);
      if(mode==='contradictory_axes'){value.transport='authentication_required';value.http_status=401;value.finished=false;value.content=null;}
      else if(mode==='over_budget_duration')value.duration_ms=200000;
      else {value.payload=mode;value.finished=false;value.content=null;value.raw_envelope_sha256=null;}
      return {...response,stdout:JSON.stringify(value)};
    }};
    const value=await runBumblePeerShadow(input,isolated);
    assert.equal(value.status,['invalid_json','credential_reflection'].includes(mode)?mode:'outcome_unknown');
    assert.equal(value.reservation_held,true);assert.equal(value.review,null);assert.equal(value.gates.schema,false);assert.equal(value.quorum_votes,0);
  });
}
await check('gateway 504 evidence keeps status and unknown outcome',async()=>{
  const axes=[];
  const isolated={...host,run_id:'rev_shadow_gateway_'+crypto.randomUUID().replaceAll('-',''),capacity:{...capacity,summary:()=>({configuration_sha256:'d'.repeat(64),attempts:0,reserved_tokens:0}),reserve:()=>({admitted:true,reservation_id:crypto.randomUUID()}),terminal:(_id,value)=>{axes.push(value);}},runProcess:async(...args)=>{
    const response=await host.runProcess(...args),value=JSON.parse(response.stdout);
    Object.assign(value,{transport:'outcome_unknown',payload:'upstream_error',http_status:504,request_id:'gw-504',finished:false,content:null,raw_envelope_sha256:null,reported_usage:null});
    return {...response,stdout:JSON.stringify(value)};
  }};
  const value=await runBumblePeerShadow(input,isolated);
  assert.equal(value.status,'outcome_unknown');assert.equal(value.reservation_held,true);assert.equal(value.quorum_votes,0);
  assert.equal(axes.length,1);assert.equal(axes[0].transport,'outcome_unknown');assert.equal(axes[0].payload,'unavailable');
  const record=JSON.parse(fs.readFileSync(path.join(evidenceDir({cwd:project,env:process.env}),'attempts',path.basename(value.evidence.path)),'utf8'));
  assert.equal(record.original_transport,'outcome_unknown');assert.equal(record.original_payload,'upstream_error');assert.equal(record.http_status,504);assert.equal(record.request_id,'gw-504');assert.equal(record.automatic_retries,0);
});
for(const [label,patch,kept] of [['503 with Retry-After',{http_status:503,retry_after:'30'},true],['499 is not a gateway error',{http_status:499},false],['600 is not an HTTP status',{http_status:600},false],['upstream_error on refused transport',{transport:'refused',http_status:503},false],['upstream_error on success transport',{transport:'success',http_status:502},false]]) {
  await check('upstream_error boundary: '+label,async()=>{
    const isolated={...host,run_id:'rev_shadow_upstream_'+crypto.randomUUID().replaceAll('-',''),capacity:{...capacity,summary:()=>({configuration_sha256:'d'.repeat(64),attempts:0,reserved_tokens:0}),reserve:()=>({admitted:true,reservation_id:crypto.randomUUID()}),terminal:()=>{}},runProcess:async(...args)=>{
      const response=await host.runProcess(...args),value=JSON.parse(response.stdout);
      Object.assign(value,{transport:'outcome_unknown',payload:'upstream_error',finished:false,content:null,raw_envelope_sha256:null,reported_usage:null},patch);
      return {...response,stdout:JSON.stringify(value)};
    }};
    const value=await runBumblePeerShadow(input,isolated);
    assert.equal(value.status,'outcome_unknown');assert.equal(value.reservation_held,true);
    const record=JSON.parse(fs.readFileSync(path.join(evidenceDir({cwd:project,env:process.env}),'attempts',path.basename(value.evidence.path)),'utf8'));
    assert.equal(record.original_transport,'outcome_unknown');assert.equal(record.automatic_retries,0);
    if(kept){assert.equal(record.original_payload,'upstream_error');assert.equal(record.http_status,patch.http_status);assert.equal(record.retry_after,patch.retry_after);}
    else {assert.equal(record.original_payload,'unavailable');assert.equal(record.http_status,null);}
  });
}
await check('overlong run identity refuses before reserving',async()=>{
  let reserved=0;const value=await runBumblePeerShadow(input,{...host,run_id:'rev_'+'x'.repeat(300),capacity:{...capacity,reserve(){reserved++;throw Error('Must not reserve');}}});
  assert.equal(reserved,0);assert.equal(value.dispatched,0);assert.equal(value.reason,'trusted_host_binding_required');
});
await check('approval exhausted by transmission marking cannot launch worker',async()=>{
  const originalNow=Date.now,expiry=host.approval.expires_at;let invoked=0,terminal=null;
  const isolated={...host,run_id:'rev_shadow_expiry_'+crypto.randomUUID().replaceAll('-',''),capacity:{...capacity,summary:()=>({configuration_sha256:'d'.repeat(64),attempts:0,reserved_tokens:0}),reserve:()=>({admitted:true,reservation_id:crypto.randomUUID()}),markTransmissionPossible(){Date.now=()=>expiry+1;},terminal(_id,axes){terminal=axes;}},runProcess:async(...args)=>{invoked++;return host.runProcess(...args);}};
  let value;try{value=await runBumblePeerShadow(input,isolated);}finally{Date.now=originalNow;}
  assert.equal(invoked,0);assert.equal(value.reservation_held,true);assert.equal(value.status,'outcome_unknown');assert.equal(terminal.transport,'outcome_unknown');
});
await check('real manager retains scoped budget and prevents next dispatch',async()=>{
  const config={schema:'momm-bumble-capacity/1',global_slots:2,max_attempts:10,max_reserved_tokens:10240,deadline:host.approval.expires_at,resource_groups:[{id:'synthetic-physical',slots:2}],source_ip_groups:[{id:'synthetic-ip',slots:2}],endpoints:[{id:'synthetic',resource_group:'synthetic-physical',source_ip_group:'synthetic-ip'}]};
  const options={root:path.join(home,'actual-capacity'),config,project_root:project};
  const shared=new BumbleCapacity(options),approved={...host.approval,capacity_configuration_sha256:shared.summary().configuration_sha256};
  const scoped={...host,run_id:'rev_shadow_actual_'+crypto.randomUUID().replaceAll('-',''),capacity:shared,approval:approved};
  const first=await runBumblePeerShadow(input,scoped);assert.equal(first.status,'advisory_valid');
  const actual=shared.summary();assert.equal(actual.held,1);assert.equal(actual.reservations[0].admission_budget.authorization_sha256,approved.authorization_sha256);
  const before=calls;const second=await runBumblePeerShadow(input,{...scoped,capacity:new BumbleCapacity(options)});assert.equal(second.dispatched,0);assert.equal(calls,before);assert.equal(shared.summary().held,1);
});
console.log(JSON.stringify({passed:cases,synthetic_supervisor_calls:calls,external_requests:0,real_credential_reads:0,unknown_holds_preserved:true,scope:'shadow admission, persistence and supervisor seam; not operator or native qualification'}));
