// Diagnostic only: no permission weakening, retries, installs or speech.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const {spawnSync}=require('node:child_process');
const {ensurePrivate}=require('../scripts/runtime');
if(process.platform!=='win32'){console.log('SKIP: Windows permission timing probe');process.exit(0);}
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'dt-probe-'));
const results=[];
try{
 const dir=path.join(fixture,'state');
 for(const phase of ['new-private-child','existing-private-child']){
  const start=performance.now();let error=null,commandMs=null;
  const run=(exe,args,options)=>{
   const timed=[...args];
   timed[timed.length-1]="$domProbeTimer=[Diagnostics.Stopwatch]::StartNew(); try { "+timed[timed.length-1]+" } finally { [Console]::Error.WriteLine('DOM_TTS_PROBE_EXEC_MS='+$domProbeTimer.ElapsedMilliseconds) }";
   const result=spawnSync(exe,timed,options);
   const match=String(result.stderr||'').match(/^DOM_TTS_PROBE_EXEC_MS=(\d+)\r?$/m);
   if(match)commandMs=Number(match[1]);
   return result;
  };
  try{ensurePrivate(dir,{run});}catch(e){const message=String(e.message);error=/timed out/.test(message)?'timeout':/grants access/.test(message)?'not-private':/contain links/.test(message)?'link-refusal':'permission-check-failed';}
  const elapsedMs=Math.round(performance.now()-start);
  results.push({phase,elapsedMs,commandMs,launchAndExitMs:commandMs===null?null:Math.max(0,elapsedMs-commandMs),passed:error===null,error});
  if(error){process.exitCode=1;break;}
 }
 console.log(JSON.stringify({schema:'dom-tts-permission-probe/1',node:process.version,platform:process.platform,arch:process.arch,results}));
}finally{fs.rmSync(fixture,{recursive:true,force:true});}
