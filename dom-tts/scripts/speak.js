const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {ROOT,stateDir,ensurePrivate,readObject,writeObject,parseCli,endpoint,alive}=require('./runtime');
const {applyMode,chunkText,MODES}=require('./summarize');
const native=require('./providers/native');
const PROFILES={conversational:{speed:1,maxChunkChars:420},engineering:{speed:0.95,maxChunkChars:520},concise:{speed:1.15,maxChunkChars:650}};
const OPTIONS=['text','textFile','stdin','provider','mode','profile','voice','speed','maxChunkChars','includeCodeBlocks','includeCommandBlocks','dryRun','waitMs'];
function parseArgs(argv){return parseCli(argv,{},OPTIONS);}
function boundedInput(args){
 let text;if(args.textFile){const stat=fs.statSync(args.textFile);if(stat.size>1048576)throw new Error('Input exceeds 1 MB');text=fs.readFileSync(args.textFile,'utf8');}
 else if(args.stdin||args.text==='-'){const buffers=[];let total=0;const buffer=Buffer.alloc(65536);let count;while((count=fs.readSync(0,buffer,0,buffer.length,null))>0){total+=count;if(total>1048576)throw new Error('Input exceeds 1 MB');buffers.push(Buffer.from(buffer.subarray(0,count)));}text=Buffer.concat(buffers).toString('utf8');}
 else text=args.text||'';if(Buffer.byteLength(text,'utf8')>1048576)throw new Error('Input exceeds 1 MB');return text;
}
function prepare(args){
 const settings=readObject(path.join(ROOT,'assets','settings.json')),profile=args.profile||settings.profile||'conversational';
 if(!Object.hasOwn(PROFILES,profile))throw new Error('Unknown narration profile: '+profile);
 const mode=args.mode||settings.mode||'informative';if(!MODES.includes(mode))throw new Error('Unknown narration mode: '+mode);
 const provider=args.provider||settings.provider||'auto';if(!['auto','sapi','say','espeak-ng'].includes(provider))throw new Error('Unknown speech provider');
 const speed=Number(args.speed??settings.speed??PROFILES[profile].speed),maxChunkChars=Number(args.maxChunkChars??settings.maxChunkChars??PROFILES[profile].maxChunkChars),waitMs=Number(args.waitMs??0);
 if(!Number.isFinite(waitMs)||waitMs<0||waitMs>60000)throw new Error('waitMs must be between 0 and 60000');
 const text=applyMode(boundedInput(args),mode,profile,{includeCodeBlocks:args.includeCodeBlocks??false,includeCommandBlocks:args.includeCommandBlocks??false});
 return {profile,mode,provider,speed,voice:args.voice??settings.voice??'',chunks:chunkText(text,maxChunkChars,speed),waitMs};
}
function stopValue(dir){try{return fs.readFileSync(path.join(dir,'stop.flag'),'utf8');}catch{return '';}}
async function playback(options,{dir=stateDir,play=native.play,privacy=ensurePrivate}={}){
 privacy(dir);const lock=path.join(dir,'playback.lock'),status=path.join(dir,'status.json'),token=crypto.randomBytes(16).toString('hex');
 const previousStop=stopValue(dir),start=Date.now();let acquired=false,child=null,stopped=false,server;
 const setStatus=patch=>writeObject(status,{...patch,updatedAt:new Date().toISOString()});
 while(!acquired){try{const fd=fs.openSync(lock,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,token}));}finally{fs.closeSync(fd);}acquired=true;}catch(error){if(error.code!=='EEXIST')throw error;const owner=readObject(lock);if(!alive(owner.pid))throw new Error('Stale playback lock; run status.js --recover after checking the reported state');if(Date.now()-start>=options.waitMs)throw new Error('Another playback owns the lock; retry or use --wait-ms');if(stopValue(dir)!==previousStop)throw new Error('Playback stopped while waiting');await new Promise(r=>setTimeout(r,100));}}
 const requestStop=()=>{stopped=true;if(child)child.kill();};
 const signal=()=>requestStop();process.on('SIGINT',signal);process.on('SIGTERM',signal);
 try{
  server=net.createServer(socket=>{socket.setTimeout(1000,()=>socket.destroy());let input='';socket.on('error',()=>{});socket.on('data',data=>{input+=data;if(input.length>1024)return socket.destroy();if(!input.includes('\n'))return;try{const message=JSON.parse(input.split('\n')[0]);if(message.token===token&&message.action==='stop'){requestStop();socket.end('stopped\n');}else socket.end('denied\n');}catch{socket.destroy();}});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint(token,dir),resolve);});
  if(process.platform!=='win32')fs.chmodSync(endpoint(token,dir),0o600);
  if(stopValue(dir)!==previousStop)requestStop();
  setStatus({state:'queued',mode:options.mode,profile:options.profile,provider:options.provider,chunks:options.chunks.length});
  if(!stopped&&options.chunks.length)await play(options.chunks,options,{stateDir:dir,stopped:()=>stopped,setChild:value=>{child=value;if(stopped&&child)child.kill();},progress:i=>setStatus({state:'speaking',mode:options.mode,profile:options.profile,provider:options.provider,chunks:options.chunks.length,chunkIndex:i+1})});
  setStatus({state:stopped?'stopped':'idle',mode:options.mode,profile:options.profile,provider:options.provider,chunks:options.chunks.length});
 }catch(error){setStatus({state:stopped?'stopped':'error',error:stopped?undefined:'playback-failed'});if(!stopped)throw error;}
 finally{
  if(child)child.kill();if(server)await new Promise(r=>server.close(r));
  process.off('SIGINT',signal);process.off('SIGTERM',signal);
  if(readObject(lock).token===token){try{fs.unlinkSync(lock);}catch{}}
 }
}
async function main(){const args=parseArgs(process.argv.slice(2)),options=prepare(args);if(args.dryRun){process.stdout.write(options.chunks.join('\n---\n'));return;}options.provider=native.selectProvider(options.provider);await playback(options);}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={parseArgs,prepare,chunkText,playback,PROFILES};

