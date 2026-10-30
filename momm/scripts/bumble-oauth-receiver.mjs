// Local callback component only, not a browser launcher/token exchange or login proof.
// Native deployment must own it inside the existing supervised broker process;
// JavaScript timers here cannot contain an arbitrarily blocked/crashed event loop.
// Transient URLSearchParams/string material cannot be guaranteed zeroized. Never
// publish/log this result; the trusted broker must protect/consume it immediately.
import http from 'node:http';import crypto from 'node:crypto';
import {selectBumbleOAuthCallback} from './bumble-oauth-discovery.mjs';
import {consumeBumbleOAuthCallback} from './bumble-oauth-contract.mjs';
const SHA=/^[a-f0-9]{64}$/,H=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fault=code=>{throw Object.assign(Error('OAuth receiver refused: '+code),{code});};
const closed=(v,fields)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;const ds=Object.getOwnPropertyDescriptors(v),ks=Reflect.ownKeys(ds);return ks.length===fields.length&&ks.every(k=>typeof k==='string'&&fields.includes(k)&&ds[k].enumerable&&Object.hasOwn(ds[k],'value'));};
export async function openBumbleOAuthReceiver(options){
 if(!closed(options,['assessment','scope_binding','deadline','host','authorize']))fault('invalid_receiver_options');
 const {authorize}=options;if(typeof authorize!=='function')fault('owner_approval_required');
 const {assessment,scope_binding,deadline,host}=options,now=Date.now();
 if(!SHA.test(scope_binding)||!Number.isSafeInteger(deadline)||deadline<=now||deadline-now>600000)fault('invalid_receiver_window');
 // This owned assessment check is local metadata validation only. No socket or
 // credential operation occurs before the trusted host approval check below.
 const selection=selectBumbleOAuthCallback(assessment,{host,port:1}),profile=assessment.profile;
 function approval(){let value;try{value=authorize({operation:'open_callback_receiver',scope_binding,profile_sha256:selection.profile_sha256,deadline,now:Date.now()});}catch{fault('owner_approval_unavailable');}
  if(!closed(value,['schema','scope_binding','profile_sha256','policy_sha256','disclosure_sha256','logging_sha256','valid_until'])||value.schema!=='momm-bumble-receiver-approval/1'||value.scope_binding!==scope_binding||value.profile_sha256!==selection.profile_sha256||![value.policy_sha256,value.disclosure_sha256,value.logging_sha256].every(v=>SHA.test(v))||!Number.isSafeInteger(value.valid_until)||value.valid_until<deadline||value.valid_until<=Date.now()||value.valid_until-Date.now()>86400000)fault('owner_approval_required');return H(value);}
 const approval_binding=approval();let armed=null,settled=false,terminal=null,timer=null,requests=0,metadata=null;
 const sockets=new Set();let resolveOutcome;const outcome=new Promise(resolve=>{resolveOutcome=resolve;});
 const server=http.createServer({maxHeaderSize:8192},(req,res)=>{
  const reply=(status,text)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",Connection:'close'});res.end(text);};
  if(settled){reply(410,'Callback closed.');return;}
  requests++;if(requests>8){reply(429,'Callback budget exhausted.');res.once('finish',()=>finish({status:'request_budget'}));return;}
  if(req.method!=='GET'){reply(405,'Request refused.');return;}
  const hostCount=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='host').length;
  if(!armed||hostCount!==1||req.headers.host!==new URL(metadata.redirect_uri).host||typeof req.url!=='string'||req.url.length>16000||!req.url.startsWith('/')||req.url.split('?')[0]!=='/momm/oauth/callback'||req.headers['transfer-encoding']||Number(req.headers['content-length']??0)!==0){reply(400,'Request refused.');return;}
  if(Date.now()>=deadline){reply(410,'Callback expired.');res.once('finish',()=>finish({status:'timeout'}));return;}
  try{if(approval()!==approval_binding)fault('owner_approval_changed');}catch{reply(403,'Approval unavailable.');res.once('finish',()=>finish({status:'approval_revoked'}));return;}
  let material;try{material=consumeBumbleOAuthCallback(armed,metadata.redirect_uri+req.url.slice('/momm/oauth/callback'.length),{now:Date.now()});}catch(error){
   reply(400,'Callback refused.');
   if(['authorization_refused','ambiguous_callback','invalid_code','expired_or_consumed'].includes(error.code))res.once('finish',()=>finish({status:'callback_refused'}));return;
  }
  const result={status:'callback_received',private_material:true,exchange_material:material,listener_verified:true,login_verified:false,quorum_votes:0,completion:false,toJSON(){throw Error('Private callback material is not serializable.');}};
  reply(200,'Callback received. You may close this tab.');res.once('finish',()=>finish(Object.freeze(result)));
 });
 server.maxConnections=4;server.maxRequestsPerSocket=1;server.headersTimeout=5000;server.requestTimeout=10000;server.keepAliveTimeout=1000;
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 function finish(result){
  if(settled)return;settled=true;clearTimeout(timer);
  // Stop accepting callbacks before closing every socket this listener owns.
  // No callback material or terminal observation escapes before the native
  // server close callback. A JavaScript promise is still not OS containment:
  // the deployed broker needs the existing outer process supervisor.
  server.close(error=>{
   terminal=Object.freeze(error?{status:'receiver_error',listener_closed:false,quorum_votes:0,completion:false}:{...result,listener_closed:true,quorum_votes:0,completion:false});
   resolveOutcome(terminal);
  });
  for(const socket of sockets)socket.destroy();
 }
 await new Promise((resolve,reject)=>{const failed=()=>{server.close();for(const socket of sockets)socket.destroy();reject(Object.assign(Error('Loopback binding unavailable.'),{code:'loopback_binding_unavailable'}));};server.once('error',failed);server.listen({host:selection.bind_host,port:0,exclusive:true},()=>{server.removeListener('error',failed);resolve();});});
 const address=server.address();if(!address||typeof address==='string'||address.address!==selection.bind_host||Date.now()>=deadline){server.close();for(const socket of sockets)socket.destroy();fault('loopback_binding_unavailable');}
 metadata=selectBumbleOAuthCallback(assessment,{host,port:address.port});
 server.on('error',()=>finish({status:'receiver_error'}));timer=setTimeout(()=>finish({status:'timeout'}),Math.max(1,deadline-Date.now()));
 return Object.freeze({profile,redirect_uri:metadata.redirect_uri,port:address.port,deadline,listener_verified:true,login_allowed:false,qualified:false,quorum_votes:0,outcome,
  arm(intent){if(settled||armed||!closed(intent,['schema','created_at','deadline','state','challenge','authorization_uri'])||intent.schema!=='momm-bumble-oauth-intent/1'||intent.deadline>deadline||intent.deadline<=Date.now()||typeof intent.authorization_uri!=='string')fault('invalid_arm');let uri;try{uri=new URL(intent.authorization_uri);}catch{fault('invalid_arm');}if(uri.searchParams.get('redirect_uri')!==metadata.redirect_uri)fault('callback_binding_changed');armed=intent;return Object.freeze({armed:true,login_verified:false,permission_granted:false,quorum_votes:0});},
  async cancel(){finish({status:'cancelled'});return outcome;}
 });
}
