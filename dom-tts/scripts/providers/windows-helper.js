const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {ROOT,powershell,psQuote,safeEnv}=require('../runtime');
function signature(file,{run=spawnSync}={}){
 const command="$ErrorActionPreference='Stop'; $env:PSModulePath=Join-Path $PSHOME 'Modules'; $s=Get-AuthenticodeSignature -LiteralPath "+psQuote(file)+"; [ordered]@{status=[string]$s.Status;thumbprint=if($s.SignerCertificate){[string]$s.SignerCertificate.Thumbprint}else{''}}|ConvertTo-Json -Compress";
 try{
  const result=run(powershell,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:8192,env:safeEnv()});
  if(result.error||result.status!==0)return {status:'UnknownError',thumbprint:''};
  const value=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
  if(!['Valid','NotSigned','HashMismatch','NotTrusted','UnknownError'].includes(value.status)||typeof value.thumbprint!=='string'||value.thumbprint&&!/^[a-f0-9]{40}$/i.test(value.thumbprint))return {status:'UnknownError',thumbprint:''};
  return {status:value.status,thumbprint:value.thumbprint.toUpperCase()};
 }catch{return {status:'UnknownError',thumbprint:''};}
}
function helperInfo({root=ROOT,verifySignature=signature,component='speech'}={}){
 if(!['speech','tray'].includes(component))throw Error('invalid native component');
 const base=path.join(root,'scripts','providers','windows'),dir=component==='tray'?path.join(base,'tray'):base,file=path.join(dir,component==='tray'?'TrayCompanion.exe':'NativeSpeech.exe'),metadata=path.join(dir,'release.json');
 if(!fs.existsSync(file))return {state:'absent'};
 try{
  for(const item of [root,path.join(root,'scripts'),path.join(root,'scripts','providers'),base,dir,file,metadata])if(fs.lstatSync(item).isSymbolicLink())throw Error();
  if(!fs.lstatSync(file).isFile()||fs.statSync(file).size>1048576||!fs.lstatSync(metadata).isFile()||fs.statSync(metadata).size>4096)throw Error();
  const release=JSON.parse(fs.readFileSync(metadata,'utf8'));
  if(release.schema!==(component==='tray'?'dom-tts-windows-tray/1':'dom-tts-windows-helper/1')||release.protocol!==1||release.version!==JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version||!/^[a-f0-9]{64}$/.test(release.sha256)||!/^[a-f0-9]{40}$/i.test(release.signerThumbprint))throw Error();
  const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(hash!==release.sha256)throw Error();
  const trust=verifySignature(file);
  if(trust.status!=='Valid'||trust.thumbprint!==release.signerThumbprint.toUpperCase())return {state:'blocked',code:'helper-signature-refused'};
  return {state:'verified',file,protocol:1};
 }catch{return {state:'blocked',code:'helper-integrity-refused'};}
}
module.exports={signature,helperInfo};
