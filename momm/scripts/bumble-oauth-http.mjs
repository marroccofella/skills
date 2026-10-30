// Unqualified OAuth client transport component. No CLI, listener, browser,
// credential-file reads, registration, deployment or native activation.
// Only a trusted host may authorize it; receipts/hashes are not owner authority.
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {parseBumbleJSON} from './bumble-contract.mjs';
import {validateBumbleOAuthMetadata,validateBumbleOAuthTokenEnvelope,describeBumbleOAuthExchange,takeBumbleOAuthExchange} from './bumble-oauth-contract.mjs';
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),wall=Date.now.bind(Date),mono=performance.now.bind(performance);
const fail=code=>{throw Object.assign(Error('OAuth HTTP refused: '+code),{code});};
function own(v,keys){
 if(!v||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('invalid_fields');
 const d=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(d);
 if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail('invalid_fields');
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function connection(value,endpoint){
 const c=own(value,['socket_address','port','server_name','certificate_sha256','deadline']),u=new URL(endpoint),parts=String(c.socket_address).split('.').map(Number);
 if(typeof c.socket_address!=='string'||net.isIP(c.socket_address)!==4||parts[0]!==100||parts[1]<64||parts[1]>127||!Number.isSafeInteger(c.port)||c.port<1||c.port>65535||typeof c.server_name!=='string'||!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(c.server_name)||c.server_name.length>253||typeof c.certificate_sha256!=='string'||!/^[a-f0-9]{64}$/.test(c.certificate_sha256)||!Number.isSafeInteger(c.deadline)||c.deadline<=wall()||c.deadline-wall()>30000)fail('invalid_connection');
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.hostname!==c.server_name||Number(u.port||443)!==c.port)fail('endpoint_binding');
 return Object.freeze(c);
}
function approved(authorize,operation,endpoint,profile,c,request_sha256){
 const query=Object.freeze({schema:'momm-bumble-oauth-http-query/1',operation,endpoint,profile_sha256:H(JSON.stringify(profile)),connection_sha256:H(JSON.stringify(c)),request_sha256,deadline:c.deadline});
 let grant;try{grant=own(authorize(query),['schema','operation','endpoint','profile_sha256','connection_sha256','request_sha256','valid_until']);}catch{fail('trusted_host_approval_required');}
 if(grant.schema!=='momm-bumble-oauth-http-approval/1'||['operation','endpoint','profile_sha256','connection_sha256','request_sha256'].some(k=>grant[k]!==query[k])||!Number.isSafeInteger(grant.valid_until)||grant.valid_until<c.deadline||grant.valid_until-wall()>86400000)fail('trusted_host_approval_required');
}
function certificate(value,c){const p=own(value,['certificate']);if(!(p.certificate instanceof Uint8Array)||p.certificate.length<1||p.certificate.length>32768)fail('invalid_certificate');const copy=Buffer.from(p.certificate);if(H(copy)!==c.certificate_sha256){copy.fill(0);fail('certificate_binding');}return copy;}
async function fetchPrivate(endpoint,c,ca,body,request){
 const began=mono(),remaining=()=>Math.min(c.deadline-wall(),30000-(mono()-began)),chunks=[];
 try{return await new Promise((resolve,reject)=>{
  let req,res,timer,settled=false,length=0;
  const finish=(code,value)=>{if(settled)return;settled=true;clearTimeout(timer);try{res?.destroy();}catch{}try{req?.destroy();}catch{}if(code)reject(Object.assign(Error('OAuth HTTP refused: '+code),{code}));else resolve(value);};
  if(typeof request!=='function')return finish('invalid_request_fn');
  if(remaining()<=0)return finish('deadline');
  timer=setTimeout(()=>finish('outcome_unknown'),Math.max(1,remaining()));
  try{
   const u=new URL(endpoint);
   req=request({hostname:c.socket_address,port:c.port,servername:net.isIP(c.server_name)?'':c.server_name,path:u.pathname,method:body?'POST':'GET',agent:false,ca,rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>tls.checkServerIdentity(c.server_name,cert),headers:{Host:u.host,Accept:'application/json',...(body?{'Content-Type':'application/x-www-form-urlencoded','Content-Length':body.length}:{})}},response=>{
    if(settled){response.destroy();return;}res=response;
    if(res.statusCode!==200)return finish(res.statusCode>=500?'outcome_unknown':'http_refused');
    const type=res.headers?.['content-type'];if(typeof type!=='string'||!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(type))return finish('invalid_content_type');
    res.on('data',chunk=>{if(settled)return;length+=chunk.length;if(length>32000)return finish('response_too_large');const b=Buffer.from(chunk);chunks.push(b);});
    res.on('error',()=>finish('outcome_unknown'));res.on('aborted',()=>finish('outcome_unknown'));
    res.on('end',()=>{if(settled)return;if(remaining()<=0)return finish('outcome_unknown');const raw=Buffer.concat(chunks);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{raw.fill(0);return finish('invalid_utf8');}raw.fill(0);finish(null,text);});
   });req.on('error',()=>finish('outcome_unknown'));if(remaining()<=0)return finish('deadline');req.end(body??undefined);
  }catch{finish('outcome_unknown');}
 });}finally{for(const b of chunks)b.fill(0);}
}
function profileCopy(value){const p=own(value,['schema','issuer','resource','client_id','scopes','redirect_uri','config_epoch']);if(!Array.isArray(p.scopes))fail('invalid_profile');return Object.freeze({...p,scopes:Object.freeze([...p.scopes])});}
export async function discoverBumbleOAuth(profile,config,privateInput,{authorize=null,request=https.request}={}){
 if(typeof authorize!=='function')fail('trusted_host_approval_required'); // Before private getters.
 if(typeof request!=='function')fail('invalid_request_fn');
 const p=profileCopy(profile);let issuer;try{if(typeof p.issuer!=='string')fail('invalid_issuer');issuer=new URL(p.issuer);}catch{fail('invalid_issuer');}if(issuer.protocol!=='https:'||issuer.pathname!=='/'||issuer.search||issuer.hash||issuer.username||issuer.password)fail('invalid_issuer');
 const endpoint=new URL('/.well-known/oauth-authorization-server',issuer).href,c=connection(config,endpoint);
 approved(authorize,'discovery',endpoint,p,c,H(''));const ca=certificate(privateInput,c);
 try{const raw=await fetchPrivate(endpoint,c,ca,null,request);approved(authorize,'discovery',endpoint,p,c,H(''));let metadata;try{metadata=parseBumbleJSON(raw);}catch{fail('invalid_metadata_json');}
  const contract=validateBumbleOAuthMetadata(p,metadata);
  if([contract.authorization_endpoint,contract.token_endpoint].some(e=>new URL(e).origin!==issuer.origin))fail('cross_origin_endpoint');
  return contract;
 }finally{ca.fill(0);}
}
export async function exchangeBumbleOAuthCode(contract,exchange,config,privateInput,{authorize=null,request=https.request,minimum_lifetime_ms=180000}={}){
 if(typeof authorize!=='function')fail('trusted_host_approval_required');
 if(typeof request!=='function')fail('invalid_request_fn');
 const descriptor=describeBumbleOAuthExchange(exchange,contract),endpoint=descriptor.token_endpoint,c=connection(config,endpoint),issuer=new URL(contract.profile.issuer);
 if(new URL(endpoint).origin!==issuer.origin)fail('cross_origin_endpoint');
 approved(authorize,'token_exchange',endpoint,contract.profile,c,descriptor.request_sha256);const ca=certificate(privateInput,c);let material;
 try{
  material=takeBumbleOAuthExchange(exchange,contract); // Burn before possibly ambiguous transmission; never retry.
  if(H(material.body)!==descriptor.request_sha256)fail('request_binding');
  const raw=await fetchPrivate(endpoint,c,ca,material.body,request);
  approved(authorize,'token_exchange',endpoint,contract.profile,c,descriptor.request_sha256);
  const token=validateBumbleOAuthTokenEnvelope(raw,{contract,now:wall(),minimum_lifetime_ms});
  if(token.access_token.length>4096){token.access_token.fill(0);fail('token_too_large_for_worker');}
  Object.defineProperty(token,'toJSON',{enumerable:false,value(){throw Error('Private OAuth token material is not serializable.');}});
  return Object.freeze(token);
 }finally{ca.fill(0);material?.body.fill(0);}
}
