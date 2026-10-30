import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createTemporaryBumbleOAuthAuthority} from './bumble-oauth-authority.mjs';
import {prepareBumblePKCE,consumeBumbleOAuthCallback} from './bumble-oauth-contract.mjs';
import {discoverBumbleOAuth,exchangeBumbleOAuthCode} from './bumble-oauth-http.mjs';

delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const cert=Buffer.from('synthetic-public-certificate-not-a-TLS-test');
const profile={schema:'momm-bumble-oauth-profile/1',issuer:'https://issuer.example.test:5441',resource:'https://100.126.129.80:5441/v1',client_id:'momm-synthetic-http',redirect_uri:'http://127.0.0.1:54321/momm/oauth/callback',scopes:['momm.models.read','momm.infer'],config_epoch:'synthetic-1'};
const config=()=>({socket_address:'100.126.129.80',port:5441,server_name:'issuer.example.test',certificate_sha256:H(cert),deadline:Date.now()+29000});
const authorize=q=>({schema:'momm-bumble-oauth-http-approval/1',operation:q.operation,endpoint:q.endpoint,profile_sha256:q.profile_sha256,connection_sha256:q.connection_sha256,request_sha256:q.request_sha256,valid_until:q.deadline});
function fresh(options={}){
 const at=Date.now(),authority=createTemporaryBumbleOAuthAuthority({issuer:profile.issuer,resource:profile.resource,client_id:profile.client_id,redirect_uri:profile.redirect_uri,scopes:profile.scopes,model_id:'synthetic-model',expires_at:at+600000});
 const record={calls:0,options:[],bodyHashes:[]};
 const request=(opt,cb)=>{record.calls++;record.options.push({...opt,ca:Buffer.from(opt.ca)});const req=new EventEmitter();req.destroy=()=>{};
  req.end=body=>queueMicrotask(()=>{if(options.breakSocket){req.emit('error',Error('PRIVATE_SYNTHETIC_SOCKET_DETAIL'));return;}
   let value=opt.method==='GET'?authority.metadata:authority.exchange(body.toString());if(body)record.bodyHashes.push(H(body));
   value=options.alter?options.alter(value,opt):value;
   const raw=options.raw??JSON.stringify(value),res=new EventEmitter();res.statusCode=options.status??200;res.headers={'content-type':options.contentType??'application/json'};res.destroy=()=>{};cb(res);
   queueMicrotask(()=>{if(options.abort){res.emit('aborted');return;}res.emit('data',Buffer.isBuffer(raw)?raw:Buffer.from(raw));res.emit('end');});
  });return req;};
 return {at,authority,record,request,options};
}
const discover=f=>discoverBumbleOAuth(profile,config(),{certificate:cert},{authorize,request:f.request});
async function exchangeFlow(f){const contract=await discover(f),now=Date.now(),intent=prepareBumblePKCE(contract,{now,deadline:now+60000}),callback=f.authority.decide(f.authority.begin(intent.authorization_uri),{approved:true,subject:'synthetic-consent-only'});return {contract,exchange:consumeBumbleOAuthCallback(intent,callback,{now:Date.now()})};}
let passed=0;async function check(name,fn){await fn();passed++;}
await check('real PKCE core through mocked discovery/token requests and exact TLS/socket options',async()=>{const f=fresh();try{const x=await exchangeFlow(f),expected=H(x.exchange.body.toString()),token=await exchangeBumbleOAuthCode(x.contract,x.exchange,config(),{certificate:cert},{authorize,request:f.request});
 assert.equal(f.record.calls,2);assert.deepEqual(f.record.bodyHashes,[expected]);assert.equal(token.resource,profile.resource);assert.equal(token.completion,false);assert.equal(token.quorum_votes,0);assert.throws(()=>JSON.stringify(token));
 for(const o of f.record.options){assert.equal(o.hostname,'100.126.129.80');assert.equal(o.servername,'issuer.example.test');assert.equal(o.port,5441);assert.equal(o.rejectUnauthorized,true);assert.equal(o.agent,false);assert.equal(H(o.ca),H(cert));assert.equal(typeof o.checkServerIdentity,'function');}
 assert.equal(f.record.options[0].path,'/.well-known/oauth-authorization-server');assert.equal(f.record.options[1].path,'/token');assert.equal(f.record.options[1].headers['Content-Type'],'application/x-www-form-urlencoded');token.access_token.fill(0);
 await assert.rejects(exchangeBumbleOAuthCode(x.contract,x.exchange,config(),{certificate:cert},{authorize,request:f.request}),{code:'owned_unmodified_exchange_required'});assert.equal(f.record.calls,2);
 }finally{f.authority.close();}});
await check('default denial precedes private getters for both operations',async()=>{let reads=0;const secret={get certificate(){reads++;throw Error('private getter');}};await assert.rejects(discoverBumbleOAuth(null,null,secret),{code:'trusted_host_approval_required'});await assert.rejects(exchangeBumbleOAuthCode(null,null,null,secret),{code:'trusted_host_approval_required'});assert.equal(reads,0);});
await check('invalid host grant precedes private getters',async()=>{let reads=0,calls=0;await assert.rejects(discoverBumbleOAuth(profile,config(),{get certificate(){reads++;}},{authorize:()=>({}),request:()=>{calls++;}}),{code:'trusted_host_approval_required'});assert.equal(reads,0);assert.equal(calls,0);});
for(const change of [{socket_address:'127.0.0.1'},{socket_address:'192.168.1.1'},{port:443},{server_name:'other.example.test'},{deadline:Date.now()-1}])await check('mismatched socket, issuer or deadline denies before request',async()=>{let calls=0;await assert.rejects(discoverBumbleOAuth(profile,{...config(),...change},{certificate:cert},{authorize,request:()=>{calls++;}}));assert.equal(calls,0);});
await check('certificate hash mismatch denies before request',async()=>{let calls=0;await assert.rejects(discoverBumbleOAuth(profile,{...config(),certificate_sha256:H('different')},{certificate:cert},{authorize,request:()=>{calls++;}}),{code:'certificate_binding'});assert.equal(calls,0);});
for(const status of [302,401,429,502])await check('HTTP error never retries or follows redirects',async()=>{const f=fresh({status});try{await assert.rejects(discover(f),{code:status>=500?'outcome_unknown':'http_refused'});assert.equal(f.record.calls,1);}finally{f.authority.close();}});
await check('metadata endpoint origin substitution refuses',async()=>{const f=fresh({alter:v=>({...v,token_endpoint:new URL('/token','https://other.example.test').href})});try{await assert.rejects(discover(f),{code:'cross_origin_endpoint'});}finally{f.authority.close();}});
for(const raw of ['{','x'.repeat(32001),Buffer.from([0xff]),'{"issuer":"one","issuer":"two"}'])await check('malformed, duplicate, oversized or invalid UTF8 metadata refuses',async()=>{const f=fresh({raw});try{await assert.rejects(discover(f));assert.equal(f.record.calls,1);}finally{f.authority.close();}});
await check('non-JSON content type refuses',async()=>{const f=fresh({contentType:'text/html'});try{await assert.rejects(discover(f),{code:'invalid_content_type'});}finally{f.authority.close();}});
await check('copied or modified callback exchange refuses before network',async()=>{const f=fresh();try{const x=await exchangeFlow(f);await assert.rejects(exchangeBumbleOAuthCode(x.contract,{...x.exchange},config(),{certificate:cert},{authorize,request:f.request}),{code:'owned_unmodified_exchange_required'});x.exchange.body.set('resource','https://wrong.example.test/v1');await assert.rejects(exchangeBumbleOAuthCode(x.contract,x.exchange,config(),{certificate:cert},{authorize,request:f.request}),{code:'owned_unmodified_exchange_required'});assert.equal(f.record.calls,1);}finally{f.authority.close();}});
await check('ambiguous token exchange burns original and withholds raw socket diagnostics',async()=>{const f=fresh();try{const x=await exchangeFlow(f);f.options.breakSocket=true;await assert.rejects(exchangeBumbleOAuthCode(x.contract,x.exchange,config(),{certificate:cert},{authorize,request:f.request}),e=>e.code==='outcome_unknown'&&!e.message.includes('PRIVATE_'));await assert.rejects(exchangeBumbleOAuthCode(x.contract,x.exchange,config(),{certificate:cert},{authorize,request:f.request}),{code:'owned_unmodified_exchange_required'});assert.equal(f.record.calls,2);}finally{f.authority.close();}});
await check('token response scope escalation refuses',async()=>{const f=fresh();try{const x=await exchangeFlow(f);f.options.alter=(v,o)=>o.method==='POST'?{...v,scope:'admin'}:v;await assert.rejects(exchangeBumbleOAuthCode(x.contract,x.exchange,config(),{certificate:cert},{authorize,request:f.request}),{code:'scope_mismatch'});}finally{f.authority.close();}});
await check('host revocation during discovery prevents releasing a contract',async()=>{let allowed=true;const f=fresh({alter:v=>{allowed=false;return v;}});try{await assert.rejects(discoverBumbleOAuth(profile,config(),{certificate:cert},{authorize:q=>allowed?authorize(q):null,request:f.request}),{code:'trusted_host_approval_required'});assert.equal(f.record.calls,1);}finally{f.authority.close();}});
await check('host revocation during token request withholds token and burns exchange',async()=>{const f=fresh();try{const x=await exchangeFlow(f);let allowed=true;f.options.alter=v=>{allowed=false;return v;};await assert.rejects(exchangeBumbleOAuthCode(x.contract,x.exchange,config(),{certificate:cert},{authorize:q=>allowed?authorize(q):null,request:f.request}),{code:'trusted_host_approval_required'});await assert.rejects(exchangeBumbleOAuthCode(x.contract,x.exchange,config(),{certificate:cert},{authorize,request:f.request}),{code:'owned_unmodified_exchange_required'});assert.equal(f.record.calls,2);}finally{f.authority.close();}});
console.log(JSON.stringify({passed,scope:'synthetic in-process issuer and mocked HTTPS only; no real consent, TLS handshake, registration, credential-file read, deployment or inference'}));
