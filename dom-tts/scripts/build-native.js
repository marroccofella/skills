// Build the optional Windows helper. Signing requires an existing trusted certificate.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {ROOT,parseCli,safeEnv}=require('./runtime');
const {signature}=require('./providers/windows-helper');
function buildNative(args){
 if(process.platform!=='win32')throw Error('Windows helper builds require Windows and installed .NET Framework build tools');
 const out=args.out;if(!out||!path.isAbsolute(out)||path.extname(out).toLowerCase()!=='.exe'||fs.existsSync(out))throw Error('Choose a new absolute --out executable path');
 const development=args.unsigned==='true';
 const component=args.component||'speech';if(!['speech','tray'].includes(component))throw Error('Unknown native component');
 if(args.unsigned!==undefined&&!['true','false'].includes(args.unsigned))throw Error('--unsigned requires true or false');
 if(!development&&(!path.isAbsolute(args.signTool||'')||!/^[a-f0-9]{40}$/i.test(args.certificateThumbprint||'')||!/^https:\/\/[\w.-]+(?:\/[\w./-]*)?$/.test(args.timestampUrl||'')))throw Error('A signed build requires --sign-tool, --certificate-thumbprint and an HTTPS --timestamp-url');
 if(!development&&signature(args.signTool).status!=='Valid')throw Error('Signing tool must have a valid trusted Authenticode signature');
 const windows=process.env.SystemRoot||'C:\\Windows';
 const framework=path.join(windows,'Microsoft.NET','Framework64','v4.0.30319');
 const compiler=path.join(framework,'csc.exe'),speech=path.join(windows,'Microsoft.NET','assembly','GAC_MSIL','System.Speech','v4.0_4.0.0.0__31bf3856ad364e35','System.Speech.dll');
 for(const file of [compiler,speech,path.join(framework,'System.Web.Extensions.dll')])if(!fs.existsSync(file))throw Error('Required .NET Framework build tool or speech assembly is missing; no dependency was downloaded');
 const parent=path.dirname(out);fs.mkdirSync(parent,{recursive:true});
 const temp=path.join(parent,'.dom-native-'+crypto.randomBytes(12).toString('hex')+'.exe');
 const metadata=path.join(parent,'release.json');if(fs.existsSync(metadata))throw Error('Output release metadata already exists');
 try{
  const compilation=spawnSync(compiler,['/nologo','/optimize+',component==='tray'?'/target:winexe':'/target:exe','/out:'+temp,'/reference:'+speech,'/reference:'+path.join(framework,'System.Web.Extensions.dll'),...(component==='tray'?['/reference:'+path.join(framework,'System.Windows.Forms.dll'),'/reference:'+path.join(framework,'System.Drawing.dll')]:[]),path.join(ROOT,'scripts','providers','windows',component==='tray'?'TrayCompanion.cs':'NativeSpeech.cs')],{encoding:'utf8',windowsHide:true,shell:false,timeout:60000,env:safeEnv()});
  if(compilation.error||compilation.status!==0)throw Error('Native helper compilation failed');
  if(!development){
   const signing=spawnSync(args.signTool,['sign','/fd','SHA256','/sha1',args.certificateThumbprint,'/tr',args.timestampUrl,'/td','SHA256',temp],{encoding:'utf8',windowsHide:true,shell:false,timeout:120000,env:safeEnv()});
   if(signing.error||signing.status!==0)throw Error('Native helper signing failed; no unsigned release was produced');
   const trust=signature(temp);if(trust.status!=='Valid'||trust.thumbprint!==args.certificateThumbprint.toUpperCase())throw Error('Signed helper failed the trusted-publisher verification');
  }
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(temp)).digest('hex');
  fs.copyFileSync(temp,out,fs.constants.COPYFILE_EXCL);
  if(!development)fs.writeFileSync(metadata,JSON.stringify({schema:component==='tray'?'dom-tts-windows-tray/1':'dom-tts-windows-helper/1',version:require('../package.json').version,protocol:1,sha256,signerThumbprint:args.certificateThumbprint.toUpperCase()},null,2)+'\n',{flag:'wx'});
  return {state:'built',component,signed:!development,development,sha256,executable:out,nativeAcceptance:'unverified',installed:false};
 }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
if(require.main===module){try{console.log(JSON.stringify(buildNative(parseCli(process.argv.slice(2),{},['out','unsigned','signTool','certificateThumbprint','timestampUrl','component'])),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={buildNative};
