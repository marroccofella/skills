import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sealBumbleOAuthPeerHandoff,takeBumbleOAuthPeerHandoff} from './bumble-oauth-peer-handoff.mjs';
import {prepareBumblePeerRequest,validateBumblePeerContent} from './bumble-peer-review.mjs';
import {runBumbleOAuthPeerWorker} from './bumble-oauth-peer-worker.mjs';
import {createTemporaryBumbleOAuthAuthority} from './bumble-oauth-authority.mjs';
import {validateBumbleOAuthMetadata,prepareBumblePKCE,consumeBumbleOAuthCallback,validateBumbleOAuthTokenEnvelope} from './bumble-oauth-contract.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),h=H('synthetic-binding');
const artifact='SYNTHETIC ONLY. The stated calculation is 2 + 2 = 5.';
const input={artifact,model:'synthetic-model',role:'architect',role_version:'1',max_tokens:1024};
const review={review_status:'complete',reviewed_scope:[{quote:artifact,assessment:'Two plus two equals four.'}],verdict:'MODIFY',confidence:1,findings:[],summary:'The synthetic sentence contains an arithmetic error.',suggested_improvements:[]};
function frame(change=()=>{},requestInput=input,certificate=Buffer.from('synthetic-public-certificate'),issuedToken=null){
 const token=Buffer.from(issuedToken??['synthetic','oauth','material'].join('-'));
 const c={base_url:'https://100.126.129.80:5441/v1',server_name:'reviewer.example',certificate_sha256:H(certificate),scope_binding:h,baseline_report_sha256:h,association_sha256:h,validator_sha256:h,policy_sha256:h,trust_sha256:h,disclosure_sha256:h,logging_sha256:h,attempt_id:'synthetic-attempt',deadline:Date.now()+150000};
 const auth=q=>({schema:'momm-bumble-oauth-peer-approval/1',config_sha256:q.config_sha256,request_sha256:q.request_sha256,scope_binding:h,policy_sha256:h,trust_sha256:h,disclosure_sha256:h,logging_sha256:h,valid_until:c.deadline+1000});
 const d=sealBumbleOAuthPeerHandoff(requestInput,c,{access_token:token,certificate},auth),taken=takeBumbleOAuthPeerHandoff(d),v=JSON.parse(taken.bytes);taken.bytes.fill(0);change(v);return Buffer.from(JSON.stringify(v));
}
function mock(status=200,body=JSON.stringify({model:input.model,choices:[{message:{content:JSON.stringify(review)},finish_reason:'stop'}]}),headers={}){
 const record={calls:0,options:null,body:null};
 const request=(options,cb)=>{record.calls++;record.options=options;const req=new EventEmitter();req.destroy=()=>{};req.end=b=>{record.body=Buffer.from(b);queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=status;res.headers=headers;res.destroy=()=>{};cb(res);queueMicrotask(()=>{res.emit('data',Buffer.from(body));res.emit('end');});});};return req;};
 return {record,request};
}
let passed=0;async function check(name,fn){await fn();passed++;}
await check('exact canonical body, OAuth bearer, pinned socket/TLS, no tools or retry',async()=>{const m=mock(),r=await runBumbleOAuthPeerWorker(frame(),{request:m.request});assert.equal(r.transport,'success');assert.equal(r.payload,'envelope_valid');assert.equal(r.attempt_id,'synthetic-attempt');assert.equal(validateBumblePeerContent(r.content,artifact,r.finished).status,'advisory_valid');assert.equal(m.record.calls,1);assert.equal(m.record.options.hostname,'100.126.129.80');assert.equal(m.record.options.path,'/v1/chat/completions');assert.equal(m.record.options.rejectUnauthorized,true);assert.equal(m.record.options.agent,false);assert.equal(m.record.options.headers.Authorization,'Bearer '+['synthetic','oauth','material'].join('-'));assert.deepEqual(m.record.body,Buffer.from(prepareBumblePeerRequest(input).request_body));assert(!JSON.stringify(r).includes('synthetic-oauth-material'));});
for(const status of [401,403])await check('auth refusal never retries',async()=>{const m=mock(status,'');const r=await runBumbleOAuthPeerWorker(frame(),{request:m.request});assert.equal(r.transport,'authentication_required');assert.equal(m.record.calls,1);assert.equal(r.content,null);});
await check('quota refusal preserves safe retry metadata but never retries',async()=>{const m=mock(429,'',{'retry-after':'60'}),r=await runBumbleOAuthPeerWorker(frame(),{request:m.request});assert.equal(r.transport,'refused');assert.equal(r.retry_after,'60');assert.equal(m.record.calls,1);});
for(const status of [502,504])await check('gateway5xx remains unknown',async()=>{const m=mock(status,''),r=await runBumbleOAuthPeerWorker(frame(),{request:m.request});assert.equal(r.transport,'outcome_unknown');assert.equal(r.payload,'upstream_error');assert.equal(r.content,null);});
for(const change of [v=>v.request_sha256=h,v=>v.config.certificate_sha256=h,v=>v.schema_sha256=h,v=>v.system_sha256=h,v=>v.artifact_sha256=h,v=>v.config.base_url='https://127.0.0.1/v1',v=>v.config.base_url='https://192.168.1.1/v1',v=>v.config.deadline=Date.now()-1,v=>v.extra=true])await check('bad frame refuses before socket',async()=>{const m=mock(),r=await runBumbleOAuthPeerWorker(frame(change),{request:m.request});assert.equal(r.transport,'refused');assert.equal(r.content,null);assert.equal(m.record.calls,0);});
await check('duplicate outer keys refuse before socket',async()=>{const m=mock(),b=frame(),v=Buffer.from(b.toString().replace('"authentication":"oauth-bearer"','"authentication":"oauth-bearer","authentication":"oauth-bearer"'));const r=await runBumbleOAuthPeerWorker(v,{request:m.request});assert.equal(r.transport,'refused');assert.equal(m.record.calls,0);});
await check('truncated result cannot become complete',async()=>{const m=mock(200,JSON.stringify({model:input.model,choices:[{message:{content:JSON.stringify(review)},finish_reason:'length'}]})),r=await runBumbleOAuthPeerWorker(frame(),{request:m.request});assert.equal(r.finished,false);assert.equal(validateBumblePeerContent(r.content,artifact,r.finished).status,'truncated');});
await check('reflected encoded private material is withheld',async()=>{const m=mock(200,'',{'x-reflection':Buffer.from(['synthetic','oauth','material'].join('-')).toString('base64')}),r=await runBumbleOAuthPeerWorker(frame(),{request:m.request});assert.equal(r.payload,'credential_reflection');assert.equal(r.content,null);});
await check('malformed response stays invalid',async()=>{const m=mock(200,'{'),r=await runBumbleOAuthPeerWorker(frame(),{request:m.request});assert.equal(r.payload,'invalid_json');assert.equal(r.content,null);});
await check('oversized response withheld',async()=>{const m=mock(200,'x'.repeat(100001)),r=await runBumbleOAuthPeerWorker(frame(),{request:m.request});assert.equal(r.payload,'byte_overflow');assert.equal(r.content,null);});
await check('complete private frame above old100k parser cap is accepted within200k custody cap',async()=>{const large={...input,artifact:'"'.repeat(14500)},bytes=frame(()=>{},large,Buffer.alloc(32768,65));assert(bytes.length>100000&&bytes.length<=200000);const m=mock(),r=await runBumbleOAuthPeerWorker(bytes,{request:m.request});assert.equal(r.payload,'envelope_valid');assert.equal(m.record.calls,1);assert.deepEqual(m.record.body,Buffer.from(prepareBumblePeerRequest(large).request_body));});
await check('request mutation refuses before socket',async()=>{const m=mock(),r=await runBumbleOAuthPeerWorker(frame(v=>{v.request_body_base64=Buffer.from('{}').toString('base64');}),{request:m.request});assert.equal(r.transport,'refused');assert.equal(m.record.calls,0);});
await check('over200k private input refuses before socket',async()=>{const m=mock(),r=await runBumbleOAuthPeerWorker(Buffer.alloc(200001),{request:m.request});assert.equal(r.transport,'refused');assert.equal(m.record.calls,0);});
await check('socket error withholds diagnostics',async()=>{let calls=0;const request=()=>{calls++;const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>req.emit('error',Error('SYNTHETIC_PRIVATE_DIAGNOSTIC')));return req;};const r=await runBumbleOAuthPeerWorker(frame(),{request});assert.equal(r.transport,'outcome_unknown');assert.equal(r.payload,'socket_failure');assert.equal(calls,1);assert(!JSON.stringify(r).includes('PRIVATE_DIAGNOSTIC'));});
await check('disconnect after response remains unknown',async()=>{const request=(_o,cb)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.headers={};res.statusCode=200;res.destroy=()=>{};cb(res);res.emit('aborted');});return req;};const r=await runBumbleOAuthPeerWorker(frame(),{request});assert.equal(r.transport,'outcome_unknown');assert.equal(r.payload,'incomplete_body');});
await check('default standalone entry refuses before private stdin',async()=>{const r=spawnSync(process.execPath,[fileURLToPath(new URL('./bumble-oauth-peer-worker.mjs',import.meta.url))],{input:'PRIVATE_SYNTHETIC_STDIN',encoding:'utf8',timeout:5000,windowsHide:true});assert.equal(r.status,2);const value=JSON.parse(r.stdout);assert.equal(value.transport,'refused');assert(!r.stdout.includes('PRIVATE_SYNTHETIC'));});

// Cross-component integration uses the real in-process PKCE/code/token core.
// Consent, host approval, certificate and HTTPS response remain synthetic mocks:
// no endpoint is contacted, no real capacity/physical-release evidence is made.
function issuedFlow(scopes=['momm.models.read','momm.infer']){
 const at=Date.now(),config={issuer:'https://issuer.example.test',resource:'https://100.126.129.80:5441/v1',client_id:'momm-integration-fixture',redirect_uri:'http://127.0.0.1:54321/momm/oauth/callback',scopes,model_id:input.model,expires_at:at+600000};
 const authority=createTemporaryBumbleOAuthAuthority(config,{now:()=>at});
 const contract=validateBumbleOAuthMetadata({schema:'momm-bumble-oauth-profile/1',issuer:config.issuer,resource:config.resource,client_id:config.client_id,redirect_uri:config.redirect_uri,scopes,config_epoch:'synthetic-only'},authority.metadata);
 const intent=prepareBumblePKCE(contract,{now:at,deadline:at+60000});
 const callback=authority.decide(authority.begin(intent.authorization_uri),{approved:true,subject:'synthetic-consent-control'});
 const exchange=consumeBumbleOAuthCallback(intent,callback,{now:at});
 const token=validateBumbleOAuthTokenEnvelope(JSON.stringify(authority.exchange(exchange.body.toString())),{contract,now:at,minimum_lifetime_ms:180000});
 return {authority,config,token,intent,callback,exchange,at};
}
function authorityMock(flow,{reviewValue=review,failAfterAdmission=false,resource=flow.config.resource}={}){
 const record={calls:0,admissions:0,last:null};
 const request=(options,cb)=>{record.calls++;const req=new EventEmitter();req.destroy=()=>{};
  req.end=bytes=>queueMicrotask(()=>{let status=200,body='';try{
   const wire=JSON.parse(bytes),permit=flow.authority.authorize(options.headers.Authorization.slice(7),{resource,scope:'momm.infer',model_id:wire.model});
   record.last=flow.authority.admit(permit,{model_id:wire.model,max_tokens:wire.max_tokens,stream:wire.stream,request_sha256:H(bytes),deadline:flow.at+150000});record.admissions++;
   if(failAfterAdmission)status=502;else body=JSON.stringify({model:input.model,choices:[{message:{content:JSON.stringify(reviewValue)},finish_reason:'stop'}]});
  }catch(e){status=e.code==='single_review_budget_exhausted'?409:401;}
  const res=new EventEmitter();res.statusCode=status;res.headers={};res.destroy=()=>{};cb(res);queueMicrotask(()=>{res.emit('data',Buffer.from(body));res.emit('end');});});return req;};
 return {record,request};
}
await check('issued PKCE token passes canonical frame and mocked service once, without quorum/release',async()=>{const f=issuedFlow(),m=authorityMock(f),bytes=frame(()=>{},input,undefined,f.token.access_token);try{
 const result=await runBumbleOAuthPeerWorker(bytes,{request:m.request}),validated=validateBumblePeerContent(result.content,artifact,result.finished);
 assert.equal(validated.status,'advisory_valid');assert.equal(validated.quorum_votes,0);assert.equal(validated.completion,false);assert.equal(m.record.admissions,1);assert.equal(m.record.last.backend_dispatched,false);assert.equal(m.record.last.physical_release_verified,false);
 const replay=await runBumbleOAuthPeerWorker(bytes,{request:m.request});assert.equal(replay.transport,'refused');assert.equal(replay.http_status,409);assert.equal(m.record.admissions,1);assert.equal(m.record.calls,2);
 assert.throws(()=>consumeBumbleOAuthCallback(f.intent,f.callback,{now:f.at}));assert.throws(()=>f.authority.exchange(f.exchange.body.toString()),{code:'invalid_grant'});
 }finally{bytes.fill(0);f.token.access_token.fill(0);f.authority.close();}});
await check('revoked issued token is rejected by mocked service, no admission',async()=>{const f=issuedFlow(),m=authorityMock(f);try{f.authority.revoke(f.token.access_token.toString());const r=await runBumbleOAuthPeerWorker(frame(()=>{},input,undefined,f.token.access_token),{request:m.request});assert.equal(r.transport,'authentication_required');assert.equal(m.record.admissions,0);assert.equal(m.record.calls,1);}finally{f.token.access_token.fill(0);f.authority.close();}});
await check('models-only issued scope cannot perform review',async()=>{const f=issuedFlow(['momm.models.read']),m=authorityMock(f);try{const r=await runBumbleOAuthPeerWorker(frame(()=>{},input,undefined,f.token.access_token),{request:m.request});assert.equal(r.transport,'authentication_required');assert.equal(m.record.admissions,0);}finally{f.token.access_token.fill(0);f.authority.close();}});
await check('wrong resource binding cannot perform review',async()=>{const f=issuedFlow(),m=authorityMock(f,{resource:'https://other.example.test/v1'});try{const r=await runBumbleOAuthPeerWorker(frame(()=>{},input,undefined,f.token.access_token),{request:m.request});assert.equal(r.transport,'authentication_required');assert.equal(m.record.admissions,0);}finally{f.token.access_token.fill(0);f.authority.close();}});
await check('admitted mocked upstream failure is unknown and does not recycle single-use budget',async()=>{const f=issuedFlow(),m=authorityMock(f,{failAfterAdmission:true});try{const r=await runBumbleOAuthPeerWorker(frame(()=>{},input,undefined,f.token.access_token),{request:m.request});assert.equal(r.transport,'outcome_unknown');assert.equal(r.payload,'upstream_error');assert.equal(m.record.calls,1);assert.equal(m.record.admissions,1);assert.equal(m.record.last.physical_release_verified,false);assert.throws(()=>f.authority.admit(f.authority.authorize(f.token.access_token.toString(),{resource:f.config.resource,scope:'momm.infer',model_id:input.model}),{model_id:input.model,max_tokens:1024,stream:false,request_sha256:h,deadline:f.at+150000}),{code:'single_review_budget_exhausted'});}finally{f.token.access_token.fill(0);f.authority.close();}});
await check('successful mocked transport does not qualify a false quote',async()=>{const f=issuedFlow(),m=authorityMock(f,{reviewValue:{...review,reviewed_scope:[{quote:'This quote is absent from the supplied artifact.',assessment:'Synthetic invalid scope.'}]}});try{const r=await runBumbleOAuthPeerWorker(frame(()=>{},input,undefined,f.token.access_token),{request:m.request});assert.equal(r.transport,'success');assert.equal(validateBumblePeerContent(r.content,artifact,r.finished).status,'invalid_scope_or_contract');assert.equal(m.record.admissions,1);}finally{f.token.access_token.fill(0);f.authority.close();}});
console.log(JSON.stringify({passed,scope:'mocked HTTPS; no real issuer, certificate, credential or BAB call; no native activation'}));
