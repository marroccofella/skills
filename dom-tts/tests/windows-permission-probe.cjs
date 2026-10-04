// Diagnostic only: no permission weakening, retries, installs or speech.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const {ensurePrivate}=require('../scripts/runtime');
if(process.platform!=='win32'){console.log('SKIP: Windows permission timing probe');process.exit(0);}
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'dt-probe-'));
const results=[];
try{
 const dir=path.join(fixture,'state');
 for(const phase of ['new-private-child','existing-private-child']){
  const start=performance.now();let error=null;
  try{ensurePrivate(dir);}catch(e){const message=String(e.message);error=/timed out/.test(message)?'timeout':/grants access/.test(message)?'not-private':/contain links/.test(message)?'link-refusal':'permission-check-failed';}
  results.push({phase,elapsedMs:Math.round(performance.now()-start),passed:error===null,error});
  if(error){process.exitCode=1;break;}
 }
 console.log(JSON.stringify({schema:'dom-tts-permission-probe/1',node:process.version,platform:process.platform,arch:process.arch,results}));
}finally{fs.rmSync(fixture,{recursive:true,force:true});}
