const {selectProvider,available,voices}=require('./providers/native');
const {parseCli}=require('./runtime');
function doctor(){let provider,error;try{provider=selectProvider();}catch(e){error=e.message;}return {version:require('../package.json').version,platform:process.platform,arch:process.arch,node:process.version,provider,available:provider?available(provider):false,error};}
function browserReadiness(status,{version,sourceManifestSha256},failure){if(!status)return {state:'blocked',code:failure||'browser-companion-unavailable'};if(status.version!==version||status.sourceManifestSha256!==sourceManifestSha256)return {state:'blocked',code:'browser-build-mismatch'};if(!status.connected)return {state:'blocked',code:{'lease-expired':'browser-lease-expired',disabled:'browser-page-disabled','not-enabled':'browser-page-not-enabled'}[status.health?.browserState]||'browser-companion-unavailable'};return {state:'ready',requiresOpenEnabledPage:true};}
function browserQueueReadiness(queue){
 if(!queue||typeof queue!=='object')return {state:'blocked',code:'browser-queue-unobservable'};
 if(queue.stopped)return {state:'blocked',code:'browser-queue-stopped'};
 if(queue.paused)return {state:'blocked',code:'browser-queue-paused'};
 if(queue.queue?.failed>0)return {state:'blocked',code:'browser-queue-failed'};
 if(queue.admission&&queue.admission.state!=='ready')return {state:'blocked',code:queue.admission.code||'browser-queue-backpressure'};
 return {state:'ready',code:'browser-queue-ready'};
}
async function main(){
 const args=parseCli(process.argv.slice(2),{},['voices','browser','playbackTest']);for(const value of Object.values(args))if(!['true','false'].includes(value))throw Error('Doctor flags require true or false');
 if(args.browser==='true'){
  const {connection,request}=require('./browser-speak'),{ROOT}=require('./runtime'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
  require('./package').verify();const version=require('../package.json').version,sourceManifestSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'manifest.json'))).digest('hex');
  let status,failure,conn;try{conn=connection();status=await request(conn,'/api/status');}catch(error){failure=/^browser-[a-z-]+$/.test(error.message)?error.message:'browser-transport-failed';}
  let playback=browserReadiness(status,{version,sourceManifestSha256},failure),queue;
  if(playback.state==='ready'){try{queue=await request(conn,'/api/queue/status');playback={...playback,...browserQueueReadiness(queue)};}catch{playback={state:'blocked',code:'browser-queue-unobservable'};}}
  const info={version,sourceManifestSha256,platform:process.platform,arch:process.arch,node:process.version,provider:'browser-local',available:playback.state==='ready',playback,...(status?.health?{health:status.health}:{}),...(queue?.admission?{admission:queue.admission}:{})};
  if(info.available){info.selectedVoice=status.voice;info.rate=status.rate;}
  if(args.playbackTest==='true'){if(!info.available)info.test={state:'skipped',code:playback.code};else{try{info.test=await require('./experimental/browser-player').createBrowserPlayer()('Dom TTS browser playback test.');}catch{info.test={state:'failed',code:'browser-playback-failed'};}}}
  console.log(JSON.stringify(info,null,2));if(!info.available||info.test&&info.test.state!=='completed')process.exitCode=1;return;
 }
 const info=doctor();if(args.voices==='true')info.voices=voices(info.provider);if(args.playbackTest==='true')throw Error('Use --browser true for this browser playback test');console.log(JSON.stringify(info,null,2));if(!info.available)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});module.exports={doctor,browserReadiness,browserQueueReadiness};
