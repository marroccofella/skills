const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fork,spawnSync}=require('node:child_process');
const {powershell,safeEnv,ROOT}=require('../runtime');
function selectProvider(provider='auto',platform=process.platform){
 const native={win32:'sapi',darwin:'say',linux:'espeak-ng'}[platform];
 if(!native)throw new Error('No native speech adapter for platform '+platform);
 if(provider!=='auto'&&provider!==native)throw new Error('Provider '+provider+' is unavailable on '+platform+'; use '+native);
 return native;
}
function commandFor(provider,options,inputFile){
 if(provider==='sapi')return {file:powershell,args:['-NoProfile','-File',path.join(ROOT,'scripts','providers','sapi.ps1'),'-InputFile',inputFile]};
 if(provider==='say')return {file:'/usr/bin/say',args:['-r',String(Math.round(175*options.speed)),...(options.voice?['-v',options.voice]:[]),'-f','-']};
 if(provider==='espeak-ng')return {file:findEspeak(),args:['--stdin','-s',String(Math.round(175*options.speed)),...(options.voice?['-v',options.voice]:[])]};
 throw new Error('Unknown native provider');
}
function findEspeak(){
 // Only absolute PATH entries outside the project may supply executable files.
 // Scripts/symlinks are allowed for package-managed launchers; PATH is a user trust boundary.
 for(const dir of (process.env.PATH||'').split(path.delimiter).filter(Boolean)){
  if(!path.isAbsolute(dir))continue;
  const file=path.resolve(dir,'espeak-ng');
  const inside=(base,target)=>{const rel=path.relative(base,target);return !rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
  if(inside(process.cwd(),file)||inside(ROOT,file))continue;
  try{if(inside(process.cwd(),fs.realpathSync(file))||inside(ROOT,fs.realpathSync(file)))continue;const stat=fs.lstatSync(file);if(stat.isFile()||stat.isSymbolicLink()){fs.accessSync(file,fs.constants.X_OK);return file;}}catch{}
 }
 throw new Error('espeak-ng was not found on trusted absolute PATH entries outside this project. Install it through your OS package manager, then run doctor again.');
}
function available(provider){try{if(provider==='espeak-ng')findEspeak();else fs.accessSync(provider==='sapi'?powershell:'/usr/bin/say',fs.constants.F_OK);return true;}catch{return false;}}
function failureMessage(stderr=''){
 if(/PSSecurityException|running scripts is disabled|execution polic(?:y|ies)/i.test(stderr))
  return 'Windows speech script was blocked by execution policy; use an administrator-approved signed script or policy. Dom TTS does not bypass policy.';
 return 'Native speech failed'+(stderr.includes('SelectVoice')?': requested voice is unavailable':'; check doctor and your audio device');
}
function runChild(command,input,context,onProgress){
 return new Promise((resolve,reject)=>{
  if(context.stopped())return resolve();
  const child=fork(path.join(__dirname,'native-worker.js'),[],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:safeEnv(),execArgv:[]});
  const cancel=()=>{if(child.connected)child.send({action:'stop'},()=>{});};context.setChild({kill:cancel});
  let done=false,stderr='',buffer='';
  let timer=setTimeout(()=>{cancel();finish(new Error('Native speech chunk exceeded 120 seconds'));},120000);
  function finish(error){if(done)return;done=true;clearTimeout(timer);context.setChild(null);error&&!context.stopped()?reject(error):resolve();}
  child.send({action:'start',command,input:input||''},error=>{if(error)finish(new Error('Native speech IPC failed'));});
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(-4096);});
  child.stdout.on('data',data=>{buffer+=data;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);const match=line.match(/^CHUNK (\d+)$/);if(match){clearTimeout(timer);timer=setTimeout(()=>{cancel();finish(new Error('Native speech chunk exceeded 120 seconds'));},120000);onProgress(Number(match[1]));}}});
  child.on('error',error=>finish(new Error(error.code==='ENOENT'?'Native speech executable is missing':'Native speech could not start')));
  child.on('exit',code=>finish(code===0?null:new Error(failureMessage(stderr))));
 });
}
async function play(chunks,options,context){
 const provider=selectProvider(options.provider);if(!available(provider))throw new Error('Native speech engine is missing; run doctor');
 if(provider==='sapi'){
  const file=path.join(context.stateDir,'speech-'+crypto.randomBytes(12).toString('hex')+'.json');
  fs.writeFileSync(file,JSON.stringify({chunks,voice:options.voice||'',rate:Math.max(-10,Math.min(10,Math.round((options.speed-1)*10)))}),{encoding:'utf8',mode:0o600,flag:'wx'});
  try{await runChild(commandFor(provider,options,file),'',context,context.progress);}finally{try{fs.unlinkSync(file);}catch{}}
 }else{
  for(let i=0;i<chunks.length&&!context.stopped();i++){context.progress(i);await runChild(commandFor(provider,options),chunks[i],context,()=>{});}
 }
 return provider;
}
function voices(provider){
 const command=provider==='sapi'?{file:powershell,args:['-NoProfile','-Command',"Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name } } finally { $s.Dispose() }"]}:provider==='say'?{file:'/usr/bin/say',args:['-v','?']}:{file:findEspeak(),args:['--voices']};
 const result=spawnSync(command.file,command.args,{encoding:'utf8',windowsHide:true,timeout:10000,env:safeEnv()});if(result.error||result.status!==0)throw new Error('Voice discovery failed');return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}
module.exports={selectProvider,commandFor,available,play,voices,runChild,failureMessage,findEspeak};
