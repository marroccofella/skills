import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import https from 'node:https';import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {privateTestFixture} from './private-test-fixture.mjs';
import {validateShadowConnection, readProtectedServiceKey, runPeerShadowWorker} from './bumble-peer-worker.mjs';
import {prepareBumblePeerRequest} from './bumble-peer-review.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: fixtures choose their own evidence home
if(process.platform!=='win32') {
  assert.throws(()=>validateShadowConnection({}));
  assert.equal((await runPeerShadowWorker({})).transport,'refused');
  console.log(JSON.stringify({passed:2,external_requests:0,real_credentials_read:0,windows_protected_reader:'not_available_on_this_host',native_transport_qualified:false}));
  process.exit(0);
}
const H=value=>crypto.createHash('sha256').update(value).digest('hex');
const home=fs.realpathSync.native(privateTestFixture('momm-peer-worker-'));
const fakeKey='synthetic-only-not-a-real-credential-123456';
fs.writeFileSync(path.join(home,'key.json'),JSON.stringify({api_key:fakeKey}),{mode:0o600,flag:'wx'});
fs.writeFileSync(path.join(home,'trust.crt'),'synthetic-trust-fixture',{mode:0o600,flag:'wx'});
// Only these freshly allocated synthetic files take an explicit user owner. An elevated
// server token may otherwise default to an administrator-group owner, which the real reader refuses.
const ownFixtureFile=file=>{
  const stat=fs.lstatSync(file);
  assert(path.dirname(file)===home&&['key.json','trust.crt'].includes(path.basename(file)));
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);
  const script=String.raw`$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$file=([Console]::In.ReadToEnd()|ConvertFrom-Json).path
$me=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=Get-Acl -LiteralPath $file
$beforeOwner=($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $me.Value)
$access=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
$acl.SetOwner($me)
Set-Acl -LiteralPath $file -AclObject $acl
$after=Get-Acl -LiteralPath $file
@{before_current_user=$beforeOwner;after_current_user=($after.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $me.Value);access_unchanged=($access -ceq $after.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access))}|ConvertTo-Json -Compress`;
  const payload=JSON.stringify({path:file}).replace(/[^\x20-\x7e]/g,unit=>'\\u'+unit.charCodeAt(0).toString(16).padStart(4,'0'));
  const result=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{input:payload,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4096});
  if(result.status!==0||result.error)throw Error(`Could not set synthetic fixture owner (status ${result.status??'none'})`);
  const observed=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
  assert.equal(typeof observed.before_current_user,'boolean');assert.equal(observed.after_current_user,true);assert.equal(observed.access_unchanged,true);
  return observed;
};
console.log(JSON.stringify({synthetic_fixture_ownership:{key:ownFixtureFile(path.join(home,'key.json')),trust:ownFixtureFile(path.join(home,'trust.crt'))}}));
const connection={connect_address:'100.100.1.2',port:11438,tls_identity:'192.168.1.2',certificate_file:path.join(home,'trust.crt'),certificate_sha256:H('synthetic-trust-fixture'),credential_file:path.join(home,'key.json'),model:'synthetic-model',credential_epoch:1};
const frame={artifact:'export const value = 1;',model:'synthetic-model',max_tokens:1024,role:'architect',role_version:'1'};
const job=()=>({schema:'momm-bumble-peer-worker/1',attempt_id:crypto.randomUUID(),connection,connection_sha256:H(JSON.stringify(connection)),request_sha256:prepareBumblePeerRequest(frame).request_sha256,deadline:Date.now()+180000,frame});
let cases=0,calls=0;
const check=async(name,fn)=>{await fn();cases++;};
const oldRequest=https.request;
function mock(raw,status=200,headers={}) {
  https.request=(options,callback)=>{
    calls++;assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);assert.equal(options.hostname,connection.connect_address);assert.equal(options.path,'/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer '+fakeKey);
    assert.equal(options.checkServerIdentity('socket-name',{subjectaltname:'IP Address:'+connection.tls_identity}),undefined);
    assert(options.checkServerIdentity('socket-name',{subjectaltname:'IP Address:192.168.1.99'}) instanceof Error);
    const request=new EventEmitter();request.destroy=()=>{};
    request.end=body=>{assert(!body.includes(fakeKey));const parsed=JSON.parse(body);assert.equal(parsed.max_tokens,1024);assert.equal(parsed.response_format.type,'json_object');queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=status;response.headers=headers;response.destroy=()=>{response.emit('aborted');};callback(response);if(status===200){response.emit('data',Buffer.from(raw));response.emit('end');}});};
    return request;
  };
}
const content=JSON.stringify({review_status:'complete',reviewed_scope:[{quote:frame.artifact,assessment:'A constant export.'}],verdict:'ACCEPT',confidence:0.9,findings:[],summary:'No defect.',suggested_improvements:[]});
const envelope=(answer=content,finish='stop')=>JSON.stringify({model:connection.model,choices:[{message:{content:answer,reasoning_content:'Separate reasoning is excluded.'},finish_reason:finish}],usage:{prompt_tokens:30,completion_tokens:100,total_tokens:130}});
try {
  await check('approved Tailscale socket and independent TLS identity',async()=>{mock(envelope());const value=await runPeerShadowWorker(job());assert.equal(value.transport,'success');assert.equal(value.content,content);assert.equal(value.finished,true);assert(!JSON.stringify(value).includes(fakeKey));assert(!JSON.stringify(value).includes('Separate reasoning'));});
  await check('expired request creates no socket',async()=>{const before=calls;const value=await runPeerShadowWorker({...job(),deadline:0});assert.equal(value.transport,'refused');assert.equal(calls,before);});
  await check('public target rejected',()=>assert.throws(()=>validateShadowConnection({...connection,connect_address:'8.8.8.8'})));
  await check('unapproved TLS hostname rejected',()=>assert.throws(()=>validateShadowConnection({...connection,tls_identity:'unapproved.example'})));
  await check('unknown connection field rejected',()=>assert.throws(()=>validateShadowConnection({...connection,proxy:'unapproved'})));
  for(const field of ['credential_file','certificate_file'])for(const value of [String.raw`\\fixture.invalid\share\material`,String.raw`\\?\C:\fixture\material`,String.raw`\\.\C:\fixture\material`])await check('UNC/device path refused before I/O: '+field,()=>assert.throws(()=>validateShadowConnection({...connection,[field]:value})));
  await check('credential file hard link refused',()=>{const target=path.join(home,'linked.json');fs.linkSync(path.join(home,'key.json'),target);try{assert.throws(()=>readProtectedServiceKey(target));}finally{fs.unlinkSync(target);}});
  await check('oversized credential file refused',()=>{const target=path.join(home,'large.json');fs.writeFileSync(target,'x'.repeat(16385),{mode:0o600});assert.throws(()=>readProtectedServiceKey(target));});
  await check('changed certificate refuses before socket',async()=>{const changed={...connection,certificate_sha256:'a'.repeat(64)},before=calls;const value=await runPeerShadowWorker({...job(),connection:changed,connection_sha256:H(JSON.stringify(changed))});assert.equal(value.transport,'refused');assert.equal(calls,before);});
  await check('changed artifact binding refuses before socket',async()=>{const before=calls;const value=await runPeerShadowWorker({...job(),request_sha256:'a'.repeat(64)});assert.equal(value.transport,'refused');assert.equal(calls,before);});
  await check('401 has no raw body or retry',async()=>{mock(fakeKey,401);const before=calls,value=await runPeerShadowWorker(job());assert.equal(value.transport,'authentication_required');assert.equal(calls,before+1);assert.equal(value.content,null);});
  await check('429 preserves rejection without retry',async()=>{mock('private response',429,{'retry-after':'30'});const before=calls,value=await runPeerShadowWorker(job());assert.equal(value.transport,'refused');assert.equal(value.retry_after,'30');assert.equal(calls,before+1);assert.equal(value.content,null);});
  for(const status of [500,502,503,504]) await check('gateway '+status+' stays outcome unknown, not refused',async()=>{mock('private response',status,{'x-bab-request-id':'gw-'+status});const before=calls,value=await runPeerShadowWorker(job());assert.equal(value.transport,'outcome_unknown');assert.equal(value.payload,'upstream_error');assert.equal(value.http_status,status);assert.equal(value.request_id,'gw-'+status);assert.equal(calls,before+1);assert.equal(value.content,null);assert.equal(value.finished,false);});
  await check('redirect is not followed',async()=>{mock('private response',302);const before=calls,value=await runPeerShadowWorker(job());assert.equal(value.transport,'refused');assert.equal(calls,before+1);});
  await check('plain reflection withheld',async()=>{mock(envelope(fakeKey));const value=await runPeerShadowWorker(job());assert.equal(value.payload,'credential_reflection');assert.equal(value.content,null);assert(!JSON.stringify(value).includes(fakeKey));});
  await check('JSON-escaped reflection withheld',async()=>{mock(envelope(fakeKey).replace(fakeKey,'\\u0073'+fakeKey.slice(1)));const value=await runPeerShadowWorker(job());assert.equal(value.payload,'credential_reflection');assert.equal(value.content,null);});
  await check('base64 reflection in body withheld',async()=>{mock(envelope(Buffer.from(fakeKey).toString('base64')));const value=await runPeerShadowWorker(job());assert.equal(value.payload,'credential_reflection');assert.equal(value.content,null);});
  await check('base64 reflection in request ID withheld',async()=>{const encoded=Buffer.from(fakeKey).toString('base64');mock(envelope(),200,{'x-bab-request-id':encoded});const value=await runPeerShadowWorker(job());assert.equal(value.request_id,null);assert(!JSON.stringify(value).includes(encoded));});
  for(const raw of ['not json','{}','null','{"choices":[null]}']) {
    await check('malformed 200 envelope resolves without callback exception',async()=>{mock(raw);const value=await runPeerShadowWorker(job());assert.equal(value.transport,'success');assert(['invalid_json','invalid_envelope'].includes(value.payload));assert.equal(value.finished,false);assert.equal(value.content,null);});
  }
  await check('byte overflow resolves and withholds content',async()=>{mock('x'.repeat(100001));const value=await runPeerShadowWorker(job());assert.equal(value.transport,'outcome_unknown');assert.equal(value.payload,'byte_overflow');assert.equal(value.content,null);});
  await check('reflection in unrelated header withheld',async()=>{mock(envelope(),200,{'x-unrelated':fakeKey});const value=await runPeerShadowWorker(job());assert.equal(value.payload,'credential_reflection');assert.equal(value.content,null);assert(!JSON.stringify(value).includes(fakeKey));});
} finally {https.request=oldRequest;}
console.log(JSON.stringify({passed:cases,synthetic_mock_http_requests:calls,external_requests:0,real_credentials_read:0,fixtures_retained:true,scope:'Windows synthetic ACL reader and mocked socket; no real TLS qualification'}));
