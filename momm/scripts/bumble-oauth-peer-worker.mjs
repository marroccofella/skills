// OAuth sibling of the issued-key shadow worker. No file credential reads.
// Trusted-host component only: frame hashes are consistency, NOT owner approval.
// Normal CLI entry stays policy-closed before stdin; no native activation here.
import './launch-guard.mjs';
import https from 'node:https';import tls from 'node:tls';import net from 'node:net';import crypto from 'node:crypto';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {performance} from 'node:perf_hooks';
import {REMOTE_POLICY_ACTIVE} from './reviewer-registry.mjs';
import {prepareBumblePeerRequest} from './bumble-peer-review.mjs';
import {parseBumbleJSON} from './bumble-contract.mjs';
import {validateOpenAIEnvelope} from './bumble-http-worker.mjs';
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),wall=Date.now.bind(Date),mono=performance.now.bind(performance);
const SHA=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),uint=v=>Number.isSafeInteger(v)&&v>=0;
const closed=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const FRAME=['schema','authentication','config','peer_contract','wire_encoding','model','role','role_version','max_tokens','artifact_sha256','schema_sha256','system_sha256','request_body_base64','request_sha256','access_token_base64','certificate_base64','approval_sha256'];
const CONFIG=['base_url','server_name','certificate_sha256','scope_binding','baseline_report_sha256','association_sha256','validator_sha256','policy_sha256','trust_sha256','disclosure_sha256','logging_sha256','attempt_id','deadline'];
function decode(value,min,max){
 if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error();
 const b=Buffer.from(value,'base64');if(b.length<min||b.length>max||b.toString('base64')!==value){b.fill(0);throw Error();}return b;
}
export async function runBumbleOAuthPeerWorker(privateBytes,{request=https.request}={}){
 const began=mono(),responseBuffers=[];let attempt=null,frameBytes,certificate,token,body,credential='',deadline=0;
 const result=(transport,payload,extra={})=>({schema:'momm-bumble-peer-worker-result/1',attempt_id:attempt,transport,payload,finished:false,content:null,...extra,duration_ms:Math.round(mono()-began)});
 const remaining=()=>Math.min(deadline-wall(),180000-(mono()-began));
 try{
  if(!Buffer.isBuffer(privateBytes)||privateBytes.length<1||privateBytes.length>200000||typeof request!=='function')return result('refused','invalid_handoff');
  frameBytes=Buffer.from(privateBytes);const text=new TextDecoder('utf-8',{fatal:true}).decode(frameBytes);
  // The owned producer uses exact JSON.stringify bytes. Roundtrip equality
  // rejects duplicate keys/nonfinite numbers/alternate encodings without
  // widening the existing100000-byte untrusted response parser limit.
  const v=JSON.parse(text);if(JSON.stringify(v)!==text||!closed(v,FRAME)||v.schema!=='momm-bumble-oauth-peer-private-frame/1'||v.authentication!=='oauth-bearer'||v.peer_contract!=='momm-peer-review/3'||v.wire_encoding!=='utf8-json-stringify/1'||!closed(v.config,CONFIG))throw Error();
  const c=v.config;attempt=c.attempt_id;deadline=c.deadline;
  if(typeof attempt!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(attempt)||!uint(deadline)||deadline<=wall()||deadline-wall()>180000||remaining()<=0)throw Error();
  if(CONFIG.filter(k=>k.endsWith('sha256')||k==='scope_binding').some(k=>!SHA(c[k]))||!['artifact_sha256','schema_sha256','system_sha256','request_sha256','approval_sha256'].every(k=>SHA(v[k])))throw Error();
  if(typeof c.base_url!=='string'||typeof c.server_name!=='string'||c.server_name.length>253||!c.server_name.length||!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(c.server_name))throw Error();
  const url=new URL(c.base_url),parts=url.hostname.split('.').map(Number);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/v1'||net.isIP(url.hostname)!==4||parts[0]!==100||parts[1]<64||parts[1]>127)throw Error();
  certificate=decode(v.certificate_base64,1,32768);token=decode(v.access_token_base64,8,4096);body=decode(v.request_body_base64,1,65536);
  credential=new TextDecoder('utf-8',{fatal:true}).decode(token);
  if(!/^[-A-Za-z0-9._~+/]+=*$/.test(credential)||H(certificate)!==c.certificate_sha256||H(body)!==v.request_sha256)throw Error();
  const wire=new TextDecoder('utf-8',{fatal:true}).decode(body),parsed=parseBumbleJSON(wire),user=parseBumbleJSON(parsed?.messages?.[1]?.content);
  if(!closed(user,['response_schema','artifact']))throw Error();
  const prepared=prepareBumblePeerRequest({artifact:user.artifact,model:v.model,role:v.role,role_version:v.role_version,max_tokens:v.max_tokens});
  if(prepared.request_body!==wire||prepared.request_sha256!==v.request_sha256||prepared.artifact_sha256!==v.artifact_sha256||prepared.schema_sha256!==v.schema_sha256||H(parsed.messages[0].content)!==v.system_sha256||remaining()<=0)throw Error();
  return await new Promise(resolve=>{
   let req,res,timer,settled=false,total=0;const chunks=[];
   const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);try{res?.destroy();}catch{}try{req?.destroy();}catch{}resolve(value);};
   const reflects=value=>typeof value==='string'&&[credential,token.toString('base64'),encodeURIComponent(credential)].some(marker=>value.includes(marker));
   try{
    if(remaining()<=0)return finish(result('refused','protected_preflight_refused'));
    timer=setTimeout(()=>finish(result('outcome_unknown','deadline')),Math.max(1,remaining()));
    req=request({hostname:url.hostname,port:Number(url.port||443),servername:net.isIP(c.server_name)?'':c.server_name,path:'/v1/chat/completions',method:'POST',agent:false,ca:certificate,rejectUnauthorized:true,
     checkServerIdentity:(_name,cert)=>tls.checkServerIdentity(c.server_name,cert),headers:{Host:c.server_name+':'+(url.port||443),Authorization:'Bearer '+credential,'Content-Type':'application/json','Content-Length':body.length,'X-Bab-Client':'Legion-MOMM-OAuth','X-Bab-Session':attempt}},response=>{
     if(settled){response.destroy();return;}res=response;
     const safeHeader=name=>{const value=res.headers[name];return typeof value==='string'&&/^[\x20-\x7e]{1,200}$/.test(value)&&!reflects(value)?value:null;};
     const metadata={http_status:res.statusCode,request_id:safeHeader('x-bab-request-id')??safeHeader('x-request-id'),retry_after:safeHeader('retry-after')};
     if(Object.values(res.headers).flat().some(reflects))return finish(result('outcome_unknown','credential_reflection',metadata));
     if(res.statusCode!==200){const code=res.statusCode;return finish(code>=500&&code<=599?result('outcome_unknown','upstream_error',metadata):result([401,403].includes(code)?'authentication_required':'refused','unavailable',metadata));}
     res.on('data',chunk=>{if(settled)return;total+=chunk.length;if(total>100000)finish(result('outcome_unknown','byte_overflow',metadata));else {const copy=Buffer.from(chunk);chunks.push(copy);responseBuffers.push(copy);}});
     res.on('aborted',()=>finish(result('outcome_unknown','incomplete_body',metadata)));
     res.on('error',()=>finish(result('outcome_unknown','incomplete_body',metadata)));
     res.on('end',()=>{
      if(settled)return;try{const raw=Buffer.concat(chunks);responseBuffers.push(raw);const rawText=raw.toString('utf8');
      if(rawText.includes(token.toString('base64'))||rawText.includes(encodeURIComponent(credential)))return finish(result('outcome_unknown','credential_reflection',metadata));
      const envelope=validateOpenAIEnvelope(raw,{model_id:v.model,task_id:attempt,attempt_id:attempt,deadline,now:wall(),credential});
      if(remaining()<=0)return finish(result('outcome_unknown','deadline',metadata));
      finish(result(envelope.transport==='success'?'success':'outcome_unknown',envelope.payload,{...metadata,finished:envelope.finished,content:envelope.content,reported_usage:envelope.reported_usage??null,raw_envelope_sha256:envelope.raw_envelope_sha256??null}));
      }catch{finish(result('outcome_unknown','invalid_envelope',metadata));}
     });
    });
    req.on('error',()=>finish(result('outcome_unknown','socket_failure')));
    if(remaining()<=0)return finish(result('outcome_unknown','deadline'));
    req.end(body);
   }catch{finish(result('outcome_unknown','socket_failure'));}
  });
 }catch{return result('refused','protected_preflight_refused');}
 finally{for(const b of [frameBytes,certificate,token,body,...responseBuffers])if(b) b.fill(0);credential='';}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const refused=()=>({schema:'momm-bumble-peer-worker-result/1',attempt_id:null,transport:'refused',payload:'protected_preflight_refused',finished:false,content:null,duration_ms:0});
 if(!REMOTE_POLICY_ACTIVE){process.stdout.write(JSON.stringify(refused())+'\n');process.exitCode=2;}
 else{
  let length=0;const chunks=[];const timer=setTimeout(()=>{for(const b of chunks)b.fill(0);process.stdout.write(JSON.stringify(refused())+'\n');process.exit(2);},5000);
  try{for await(const b of process.stdin){length+=b.length;if(length>200000){b.fill(0);throw Error();}chunks.push(b);}clearTimeout(timer);const bytes=Buffer.concat(chunks);try{process.stdout.write(JSON.stringify(await runBumbleOAuthPeerWorker(bytes))+'\n');}finally{bytes.fill(0);}}
  catch{clearTimeout(timer);process.stdout.write(JSON.stringify(refused())+'\n');process.exitCode=2;}
  finally{clearTimeout(timer);for(const b of chunks)b.fill(0);}
 }
}
