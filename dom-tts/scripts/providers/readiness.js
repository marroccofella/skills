// Read-only launcher preflight. Engine presence is separate from actual playback.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, powershell, psQuote, safeEnv } = require('../runtime');
const {helperInfo}=require('./windows-helper');
const policies = new Set(['Restricted','AllSigned','RemoteSigned','Unrestricted','Bypass','Undefined']);
const signatures = new Set(['Valid','NotSigned','HashMismatch','NotTrusted','UnknownError','NotSupportedFileFormat','Incompatible']);
function windowsReadiness({ run = spawnSync } = {}) {
 const helper=helperInfo();
 if(helper.state==='blocked')return {state:'blocked',code:helper.code,launcher:'native-helper'};
 if(helper.state==='verified')return {state:'unverified',code:'playback-test-required',launcher:'signed-native-helper'};
 const script = path.join(ROOT,'scripts','providers','sapi.ps1');
 const code = "$ErrorActionPreference='Stop'; $env:PSModulePath=Join-Path $PSHOME 'Modules'; $file=" + psQuote(script) +
  "; $signature=Get-AuthenticodeSignature -LiteralPath $file; $zone=@(Get-Item -LiteralPath $file -Stream Zone.Identifier -ErrorAction SilentlyContinue).Count -gt 0; " +
  "[ordered]@{policy=[string](Get-ExecutionPolicy);signature=[string]$signature.Status;internetZone=[bool]$zone}|ConvertTo-Json -Compress";
 let result;
 try { result=run(powershell,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:8192,env:safeEnv()}); }
 catch { return {state:'unknown',code:'launcher-check-failed'}; }
 if(result.error||result.status!==0)return {state:'unknown',code:result.error?.code==='ETIMEDOUT'?'launcher-check-timeout':'launcher-check-failed'};
 let data;
 try {data=JSON.parse(result.stdout.replace(/^\uFEFF/,''));}catch{return {state:'unknown',code:'launcher-check-failed'};}
 if(!data||!policies.has(data.policy)||!signatures.has(data.signature)||typeof data.internetZone!=='boolean')return {state:'unknown',code:'launcher-check-failed'};
 const blocked=data.policy==='Restricted'||data.policy==='AllSigned'&&data.signature!=='Valid'||data.policy==='RemoteSigned'&&data.internetZone&&data.signature!=='Valid';
 return {state:blocked?'blocked':'unverified',code:blocked?'execution-policy-blocked':'playback-test-required',...data};
}
function readiness(provider,options={}) {
 return provider==='sapi'?windowsReadiness(options):{state:'unverified',code:'playback-test-required'};
}
module.exports={readiness,windowsReadiness};
