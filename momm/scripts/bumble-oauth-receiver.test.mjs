// Actual localhost sockets, generated callbacks only. No real issuer/login/token/model.
import fs from 'node:fs';import http from 'node:http';import net from 'node:net';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {assessBumbleAuthProfile} from './bumble-oauth-discovery.mjs';
import {validateBumbleOAuthMetadata,prepareBumblePKCE} from './bumble-oauth-contract.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const url=new URL('./bumble-oauth-receiver.mjs',import.meta.url),module=fs.existsSync(url)?await import(url):{};
assert.equal(typeof module.openBumbleOAuthReceiver,'function','Owned loopback receiver is not implemented');
const H=v=>crypto.createHash('sha256').update(v).digest('hex'),scope_binding=H('synthetic-receiver-scope');
function assessment(hosts){const p={schema:'momm-bumble-auth-profile/1',state:'supported',issuer:'https://issuer.example.test',resource:'https://node.example.test/v1',client_id:'public-fixture',scopes:['momm.infer'],redirect:{scheme:'http',hosts,path:'/momm/oauth/callback',port_policy:'ephemeral'},flow:{grant:'authorization_code',pkce:'S256',token_endpoint_auth_method:'none'},profile_epoch:1},raw=JSON.stringify(p);return assessBumbleAuthProfile(raw,{resource:p.resource,trust:{schema:'momm-bumble-auth-trust-pins/1',issuer:p.issuer,resource:p.resource,client_id:p.client_id,scopes:p.scopes,minimum_epoch:1,profile_sha256:H(raw)}});}
const authorize=({profile_sha256,deadline})=>({schema:'momm-bumble-receiver-approval/1',scope_binding,profile_sha256,policy_sha256:H('policy'),disclosure_sha256:H('disclosure'),logging_sha256:H('logging'),valid_until:deadline});
function arm(receiver){const p=receiver.profile;const contract=validateBumbleOAuthMetadata({schema:'momm-bumble-oauth-profile/1',issuer:p.issuer,resource:p.resource,client_id:p.client_id,scopes:p.scopes,redirect_uri:receiver.redirect_uri,config_epoch:'fixture'}, {issuer:p.issuer,authorization_endpoint:p.issuer+'/authorize',token_endpoint:p.issuer+'/token',response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],authorization_response_iss_parameter_supported:true});const intent=prepareBumblePKCE(contract,{now:Date.now(),deadline:receiver.deadline});receiver.arm(intent);return intent;}
let local_requests=0;
function get(url,{method='GET',headers={}}={}){local_requests++;return new Promise((resolve,reject)=>{const req=http.request(url,{method,headers,agent:false},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));});req.on('error',reject);req.end();});}
async function closureControl(){
 // A real idle connection keeps close() pending until the owned socket is
 // destroyed. Observe the actual Server close callback, not a timer or flag.
 const original=http.Server.prototype.close;let pendingCloses=0;
 http.Server.prototype.close=function(callback){pendingCloses++;return original.call(this,(...args)=>{pendingCloses--;if(callback)callback(...args);});};
 let receiver,idle;
 try{
  receiver=await module.openBumbleOAuthReceiver({assessment:assessment(['127.0.0.1']),scope_binding,deadline:Date.now()+5000,host:'127.0.0.1',authorize});arm(receiver);
  idle=net.createConnection({host:'127.0.0.1',port:receiver.port});await new Promise((resolve,reject)=>{idle.once('connect',resolve);idle.once('error',reject);});
  const result=await receiver.cancel();
  assert.equal(pendingCloses,0,'OAuth outcome escaped while the real receiver still owned an open connection');
  assert.equal(result.listener_closed,true);assert.equal(result.status,'cancelled');
  assert.equal((await receiver.cancel()).status,'cancelled','Closure replay cannot create a new outcome');
  await assert.rejects(()=>get(receiver.redirect_uri),error=>['ECONNREFUSED','ECONNRESET'].includes(error.code));
 }finally{if(idle)idle.destroy();if(receiver)await receiver.cancel();http.Server.prototype.close=original;}
}
if(process.argv[2]==='closure'){await closureControl();console.log('Actual idle-socket listener closure control passed');process.exit(0);}
await closureControl();
await assert.rejects(()=>module.openBumbleOAuthReceiver({assessment:assessment(['127.0.0.1']),scope_binding,deadline:Date.now()+5000,host:'127.0.0.1',authorize:null}),{code:'owner_approval_required'});
for(const host of ['127.0.0.1','[::1]']){
 const a=assessment([host]),receiver=await module.openBumbleOAuthReceiver({assessment:a,scope_binding,deadline:Date.now()+5000,host,authorize});
 try{
  assert.equal(receiver.listener_verified,true);assert.equal(new URL(receiver.redirect_uri).hostname,host);assert.equal(receiver.profile.redirect.hosts.length,1);
  const intent=arm(receiver),code=crypto.randomBytes(24).toString('base64url'),good=receiver.redirect_uri+'?'+new URLSearchParams({code,state:intent.state,iss:a.profile.issuer});
  assert.equal((await get(good,{headers:{Host:'localhost:'+receiver.port}})).status,400);
  assert.equal((await get(good+'&state=duplicate')).status,400);
  assert.equal((await get(good.replace('state='+intent.state,'state=wrong'))).status,400);
  assert.equal((await get(good.replace(encodeURIComponent(a.profile.issuer),encodeURIComponent('https://other.example.test')))).status,400);
  assert.equal((await get(good,{method:'POST'})).status,405);
  assert.equal((await get(good.replace('/momm/oauth/callback?','/momm/oauth/callback/?'))).status,400);
  assert.equal((await get(good+'&iss='+encodeURIComponent(a.profile.issuer))).status,400);
  const response=await get(good);assert.equal(response.status,200);assert(!response.body.includes(code));assert(!response.body.includes(intent.state));assert.equal(response.headers['referrer-policy'],'no-referrer');
  const result=await receiver.outcome;assert.equal(result.status,'callback_received');assert.equal(result.listener_closed,true);assert.equal(result.private_material,true);assert.equal(result.exchange_material.body.get('code'),code);assert.equal(result.quorum_votes,0);assert.throws(()=>JSON.stringify(result),/Private callback material/);
  await assert.rejects(()=>get(good),error=>['ECONNREFUSED','ECONNRESET'].includes(error.code),'Original callback cannot be replayed after completion');
  assert.equal((await receiver.cancel()).status,'callback_received','Cancellation cannot overwrite original success');
 }finally{await receiver.cancel();}
}
const pending=await module.openBumbleOAuthReceiver({assessment:assessment(['127.0.0.1']),scope_binding,deadline:Date.now()+5000,host:'127.0.0.1',authorize});arm(pending);assert.equal((await pending.cancel()).status,'cancelled');
assert.equal((await pending.outcome).status,'cancelled');assert.equal((await pending.outcome).listener_closed,true);
const refused=await module.openBumbleOAuthReceiver({assessment:assessment(['127.0.0.1']),scope_binding,deadline:Date.now()+5000,host:'127.0.0.1',authorize}),refusalIntent=arm(refused);
assert.equal((await get(refused.redirect_uri+'?'+new URLSearchParams({error:'access_denied',state:refusalIntent.state,iss:refused.profile.issuer}))).status,400);assert.equal((await refused.outcome).status,'callback_refused');assert.equal((await refused.outcome).listener_closed,true);
const expires=await module.openBumbleOAuthReceiver({assessment:assessment(['127.0.0.1']),scope_binding,deadline:Date.now()+300,host:'127.0.0.1',authorize});arm(expires);assert.equal((await expires.outcome).status,'timeout');
assert.equal((await expires.outcome).listener_closed,true);await assert.rejects(()=>get(expires.redirect_uri),error=>['ECONNREFUSED','ECONNRESET'].includes(error.code));
let approved=true;
const revoked=await module.openBumbleOAuthReceiver({assessment:assessment(['127.0.0.1']),scope_binding,deadline:Date.now()+5000,host:'127.0.0.1',authorize:request=>approved?authorize(request):null}),revokedIntent=arm(revoked);
approved=false;assert.equal((await get(revoked.redirect_uri+'?'+new URLSearchParams({code:crypto.randomBytes(24).toString('base64url'),state:revokedIntent.state,iss:revoked.profile.issuer}))).status,403);
const revokedResult=await revoked.outcome;assert.equal(revokedResult.status,'approval_revoked');assert.equal(revokedResult.listener_closed,true);assert(!Object.hasOwn(revokedResult,'exchange_material'));assert.equal((await revoked.cancel()).status,'approval_revoked');
const flooded=await module.openBumbleOAuthReceiver({assessment:assessment(['127.0.0.1']),scope_binding,deadline:Date.now()+5000,host:'127.0.0.1',authorize});arm(flooded);
for(let n=0;n<8;n++)assert.equal((await get(flooded.redirect_uri,{headers:{Host:'localhost:'+flooded.port}})).status,400);
assert.equal((await get(flooded.redirect_uri)).status,429);const floodResult=await flooded.outcome;assert.equal(floodResult.status,'request_budget');assert.equal(floodResult.listener_closed,true);assert(!Object.hasOwn(floodResult,'exchange_material'));
console.log(JSON.stringify({passed:true,local_requests,external_network_requests:0,model_calls:0,real_login:false,real_credentials_read:false,scope:'literal IPv4/IPv6 ephemeral sockets and generated callback bindings only; real owner/browser/issuer/exchange/driver qualification remains required'}));
