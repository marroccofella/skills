// One supervised, non-streamed shadow request. No argv/env credential transfer.
// Native/default adapters remain disabled. Never invoke this worker from peer text.
import './launch-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import tls from 'node:tls';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareBumblePeerRequest} from './bumble-peer-review.mjs';
import {parseBumbleJSON} from './bumble-contract.mjs';
import {validateOpenAIEnvelope, validatePrivateAddress} from './bumble-http-worker.mjs';
const H = value => crypto.createHash('sha256').update(value).digest('hex');
const stop = () => {throw Error('Protected shadow transport refused.');};
const WINDOW_AUDIT = String.raw`
$ErrorActionPreference='Stop'
try {
 Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
 $file=([Console]::In.ReadToEnd()|ConvertFrom-Json).path
 $me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $item=Get-Item -LiteralPath $file -Force
 $acl=Get-Acl -LiteralPath $file
 $ok=(-not $item.PSIsContainer) -and (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) -and ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $me)
 $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
 if($rules.Count -eq 0){$ok=$false}
 foreach($rule in $rules){if($rule.AccessControlType -eq 'Allow' -and @($me,'S-1-5-18','S-1-5-32-544') -notcontains $rule.IdentityReference.Value){$ok=$false}}
 @{verified=$ok}|ConvertTo-Json -Compress
}catch{'{"verified":false}'}
`;
const localProtectedPath=file=>typeof file==='string'&&/^[A-Za-z]:[\\/]/.test(file)&&path.isAbsolute(file)&&!file.slice(2).includes(':');
function ancestors(file) {
  // Reject UNC/device/alternate-stream spellings before any filesystem access.
  // A drive-letter spelling is not itself proof that a drive is local.
  if (!localProtectedPath(file)) stop();
  for (let current=path.resolve(file);;current=path.dirname(current)) { const stat=fs.lstatSync(current); if(stat.isSymbolicLink()) stop(); if(path.dirname(current)===current) break; }
}
function auditCredential(file) {
  if (process.platform !== 'win32') stop(); // Only Windows protected-file pilot is authorized/testable here.
  const executable=path.join(process.env.SystemRoot ?? '', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  if (!path.isAbsolute(executable)) stop();
  const input=JSON.stringify({path:file}).replace(/[^\x20-\x7e]/g,unit=>'\\u'+unit.charCodeAt(0).toString(16).padStart(4,'0'));
  const result=spawnSync(executable,['-NoProfile','-NonInteractive','-Command',WINDOW_AUDIT],{input,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4096});
  try {if(result.status!==0||result.error||JSON.parse(result.stdout.replace(/^\uFEFF/, '')).verified!==true) stop();} catch {stop();}
}
export function readProtectedServiceKey(file) {
  ancestors(file); auditCredential(file);
  const before=fs.lstatSync(file,{bigint:true});
  if(!before.isFile()||before.nlink!==1n||before.ino<=0n||before.size<1n||before.size>16384n) stop();
  const fd=fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    // Win32 path and descriptor dev differ for the same file on Node22.16.
    // Match the existing immutable-file rule; never accept a zero file index.
    const same=stat=>stat.isFile()&&stat.nlink===1n&&stat.ino===before.ino&&(process.platform==='win32'||stat.dev===before.dev)&&stat.size===before.size&&stat.mtimeNs===before.mtimeNs;
    if(!same(fs.fstatSync(fd,{bigint:true}))) stop();
    bytes=Buffer.alloc(Number(before.size)+1); let offset=0;
    while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!count) break;offset+=count;}
    if(offset!==Number(before.size)||!same(fs.fstatSync(fd,{bigint:true}))||!same(fs.lstatSync(file,{bigint:true}))) stop();
    ancestors(file); auditCredential(file);
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,offset)).replace(/^\uFEFF/,'');
    const value=parseBumbleJSON(text), key=value?.api_key;
    if(typeof key!=='string'||key.length<16||key.length>4096||!/^[\x21-\x7e]+$/.test(key)) stop();
    return key;
  } finally { if(bytes) bytes.fill(0); fs.closeSync(fd); }
}
export function validateShadowConnection(value) {
  const fields=['connect_address','port','tls_identity','certificate_file','certificate_sha256','credential_file','model','credential_epoch'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==fields.sort().join(',')) stop();
  const parts=String(value.connect_address).split('.').map(Number);
  if(net.isIP(value.connect_address)!==4||parts[0]!==100||parts[1]<64||parts[1]>127||!Number.isInteger(value.port)||value.port<1||value.port>65535) stop();
  validatePrivateAddress(value.tls_identity);
  if(!localProtectedPath(value.certificate_file)||!localProtectedPath(value.credential_file)||!/^[a-f0-9]{64}$/.test(value.certificate_sha256)||typeof value.model!=='string'||!/^[A-Za-z0-9_.:/-]{1,200}$/.test(value.model)||!Number.isSafeInteger(value.credential_epoch)||value.credential_epoch<1) stop();
  return value;
}
export async function runPeerShadowWorker(job) {
  const started=performance.now();
  const result=(transport,payload,extra={})=>({schema:'momm-bumble-peer-worker-result/1',attempt_id:job?.attempt_id ?? null,transport,payload,finished:false,content:null,...extra,duration_ms:Math.round(performance.now()-started)});
  const fields=['schema','attempt_id','connection','connection_sha256','request_sha256','deadline','frame'];
  if(!job||typeof job!=='object'||Array.isArray(job)||Object.keys(job).sort().join(',')!==fields.sort().join(',')||job.schema!=='momm-bumble-peer-worker/1'||typeof job.attempt_id!=='string'||!/^[a-zA-Z0-9-]{1,128}$/.test(job.attempt_id)||!Number.isSafeInteger(job.deadline)) return result('refused','invalid_handoff');
  let connection,request,certificate,credential;
  const allowance=Math.min(180000,job.deadline-Date.now());
  const remaining=()=>Math.min(job.deadline-Date.now(),allowance-(performance.now()-started));
  try {
    if(allowance<=0) stop();
    connection=validateShadowConnection(job.connection);
    if(H(JSON.stringify(connection))!==job.connection_sha256) stop();
    request=prepareBumblePeerRequest(job.frame);
    if(request.model!==connection.model||request.request_sha256!==job.request_sha256) stop();
    ancestors(connection.certificate_file);
    const stat=fs.lstatSync(connection.certificate_file);
    if(!stat.isFile()||stat.nlink!==1||stat.size>32768) stop();
    certificate=fs.readFileSync(connection.certificate_file);
    if(H(certificate)!==connection.certificate_sha256) stop();
    credential=readProtectedServiceKey(connection.credential_file);
    if(remaining()<=0) stop();
  } catch {return result('refused','protected_preflight_refused');}
  // No ambient proxy, DNS-selected target, redirect, hosts edit or TLS bypass.
  // Certificate identity and socket address deliberately remain distinct pins.
  return new Promise(resolve=>{
    let socketRequest,socketResponse,timer,settled=false,total=0;const chunks=[];
    // Claim the intended classification before destroy() can emit aborted/error.
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);try{socketResponse?.destroy();}catch{}try{socketRequest?.destroy();}catch{}resolve(value);};
    try {
      timer=setTimeout(()=>finish(result('outcome_unknown','deadline')),Math.max(1,remaining()));
      socketRequest=https.request({hostname:connection.connect_address,servername:'',port:connection.port,path:'/v1/chat/completions',method:'POST',agent:false,ca:certificate,rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>tls.checkServerIdentity(connection.tls_identity,cert),headers:{Host:connection.tls_identity+':'+connection.port,Authorization:'Bearer '+credential,'Content-Type':'application/json','Content-Length':Buffer.byteLength(request.request_body),'X-Bab-Client':'Legion-MOMM-Shadow','X-Bab-Session':job.attempt_id}},response=>{
        if(settled){response.destroy();return;}socketResponse=response;
        const reflects=value=>typeof value==='string'&&[credential,Buffer.from(credential).toString('base64'),encodeURIComponent(credential)].some(marker=>value.includes(marker));
        const safeHeader=name=>{const value=response.headers[name];return typeof value==='string'&&/^[\x20-\x7e]{1,200}$/.test(value)&&!reflects(value)?value:null;};
        const metadata={http_status:response.statusCode,request_id:safeHeader('x-bab-request-id')??safeHeader('x-request-id'),retry_after:safeHeader('retry-after')};
        if(Object.values(response.headers).flat().some(reflects))return finish(result('outcome_unknown','credential_reflection',metadata));
        // A gateway 5xx (for example 502/504) does not prove the backend stopped work:
        // keep it an unknown outcome with its status, never a clean refusal.
        if(response.statusCode!==200){const code=response.statusCode;return finish(code>=500&&code<=599?result('outcome_unknown','upstream_error',metadata):result([401,403].includes(code)?'authentication_required':'refused','unavailable',metadata));}
        response.on('data',chunk=>{if(settled)return;total+=chunk.length;if(total>100000)finish(result('outcome_unknown','byte_overflow',metadata));else chunks.push(chunk);});
        response.on('aborted',()=>finish(result('outcome_unknown','incomplete_body',metadata)));
        response.on('error',()=>finish(result('outcome_unknown','incomplete_body',metadata)));
        response.on('end',()=>{
          if(settled)return;
          const raw=Buffer.concat(chunks); const rawText=raw.toString('utf8');
          // Encoded forms are also withheld. This is not universal secret detection.
          if(rawText.includes(Buffer.from(credential).toString('base64'))||rawText.includes(encodeURIComponent(credential))) return finish(result('outcome_unknown','credential_reflection',metadata));
          const envelope=validateOpenAIEnvelope(raw,{model_id:request.model,task_id:job.attempt_id,attempt_id:job.attempt_id,deadline:job.deadline,now:Date.now(),credential});
          if(remaining()<=0) return finish(result('outcome_unknown','deadline',metadata));
          finish(result(envelope.transport==='success'?'success':'outcome_unknown',envelope.payload,{...metadata,finished:envelope.finished,content:envelope.content,reported_usage:envelope.reported_usage??null,raw_envelope_sha256:envelope.raw_envelope_sha256??null}));
        });
      });
      socketRequest.on('error',()=>finish(result('outcome_unknown','socket_failure')));
      socketRequest.end(request.request_body);
    } catch {finish(result('outcome_unknown','socket_failure'));}
  });
}
if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let bytes=0;const chunks=[];const timeout=setTimeout(()=>{process.stdout.write('{"transport":"refused","payload":"stdin_deadline"}\n');process.exit(1);},5000);
  try {
    for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>65536)stop();chunks.push(chunk);}
    clearTimeout(timeout);const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));const result=await runPeerShadowWorker(parseBumbleJSON(text));process.stdout.write(JSON.stringify(result)+'\n');
  } catch {clearTimeout(timeout);process.stdout.write('{"transport":"refused","payload":"invalid_handoff"}\n');process.exitCode=1;}
}
