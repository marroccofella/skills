const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {NarrationQueue}=require('./narration-queue');
const {DeltaNarrator}=require('./delta-narrator');
const {createIsolatedNativePlayer}=require('./isolated-native-player');
const {prepare}=require('../speak');
const {ROOT,stateDir,ensurePrivate,readObject,writeObject,parseCli,safeEnv}=require('../runtime');
class ControlledQueue extends NarrationQueue{
 next(){return this.paused?undefined:super.next();}
 pause(){this.paused=true;return {state:'paused-after-current',activeContinues:!!this.active};}
 resume(){if(this.externallyStopped)throw new Error('explicit restart required');this.paused=false;this.schedule();return {state:'resumed'};}
 skip(){const job=this.active;if(!job)return {state:'nothing-active'};job.state='cancelling';job.controller.abort();return {state:'skip-requested'};}
 stop(){this.externallyStopped=true;for(const session of [...this.sessions])this.revokeSession(session);this.paused=false;return {state:'stop-requested'};}
}
function queryDoctor(){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[path.join(ROOT,'scripts','doctor.js'),'--voices','true'],{windowsHide:true,shell:false,env:safeEnv(),stdio:['ignore','pipe','ignore']});
 let output='',settled=false;const timer=setTimeout(()=>{child.kill();finish(new Error('doctor-check-timeout'));},15000);
 const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
 child.stdout.on('data',data=>{output+=data;if(Buffer.byteLength(output)>65536){child.kill();finish(new Error('doctor-check-failed'));}});
 child.on('error',()=>finish(new Error('doctor-check-failed')));
 child.on('exit',()=>{try{const data=JSON.parse(output);if(!data||!Array.isArray(data.voices)||data.voices.some(v=>typeof v!=='string'||v.length>256))throw Error();finish(null,{voices:data.voices,playback:data.playback});}catch{finish(new Error('doctor-check-failed'));}});
});}
function createControls({sessions=['manual'],dir=stateDir,playerFactory=createIsolatedNativePlayer,doctorQuery=queryDoctor,persist=false}={}){
 if(!Array.isArray(sessions)||!sessions.length||sessions.length>32||sessions.some(id=>typeof id!=='string'||!/^[\w.-]{1,128}$/.test(id))||new Set(sessions).size!==sessions.length||!path.isAbsolute(dir))throw new Error('invalid selected sessions');
 const token=crypto.randomBytes(32).toString('hex');
 const file=path.join(dir,'control-settings.json');let settings=persist?readObject(file,{}):{};
 const allowed=new Set(['mode','profile','voice','speed','maxChunkChars']);
 function validate(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.has(k)))throw new Error('invalid settings');prepare({...value,text:'Settings validation.'},{settings:{}});if(value.voice!==undefined&&(typeof value.voice!=='string'||value.voice.length>256))throw Error('invalid voice');return {...value};}
 settings=validate(settings);
 let queue,adapter;
 function reset(){
  if(queue?.active)throw new Error('owned playback still settling');
  if(queue)for(const session of sessions)adapter.revokeSession(session);
  queue=new ControlledQueue({selectedSessions:sessions,play:(text,context)=>playerFactory({dir,options:{...settings,mode:'full'}})(text,context)});
  adapter=new DeltaNarrator({queue,selectedSessions:sessions,mode:settings.mode||'informative'});
 }
 reset();
 const status=()=>({queue:queue.status(),stream:adapter.status(),paused:!!queue.paused,stopped:!!queue.externallyStopped,selectedSessions:[...queue.sessions],settings});
 const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 const read=req=>new Promise((resolve,reject)=>{let buffers=[],bytes=0,failed=false;req.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){failed=true;buffers=[];reject(new Error('request-too-large'));}else if(!failed)buffers.push(chunk);});req.on('end',()=>{if(failed)return;try{resolve(JSON.parse(Buffer.concat(buffers).toString('utf8')));}catch{reject(new Error('invalid-json'));}});req.on('error',()=>reject(new Error('request-failed')));req.on('aborted',()=>reject(new Error('request-failed')));});
 const server=http.createServer(async(req,res)=>{
  const address=server.address();const host='127.0.0.1:'+address.port;
  if(req.headers.host!==host||req.headers.origin&&req.headers.origin!=='http://'+host)return json(res,403,{error:'origin-refused'});
  const pathname=req.url?.split('?')[0];
  const staticFiles={'/':'control.html','/control.js':'control.js','/control.css':'control.css'};
  if(req.method==='GET'&&Object.hasOwn(staticFiles,pathname)){
   res.writeHead(200,{'Content-Type':pathname.endsWith('.js')?'text/javascript; charset=utf-8':pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
   return res.end(fs.readFileSync(path.join(ROOT,'assets','control',staticFiles[pathname])));
  }
  const provided=req.headers['x-dom-tts-token'];
  if(typeof provided!=='string'||! /^[a-f0-9]{64}$/.test(provided)||!crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(token)))return json(res,401,{error:'authentication-required'});
  try{
   if(req.method==='GET'&&pathname==='/api/status')return json(res,200,status());
   if(req.method==='GET'&&pathname==='/api/voices')return json(res,200,await doctorQuery());
   if(req.method!=='POST'||req.headers['content-type']!=='application/json')return json(res,400,{error:'json-post-required'});
   const data=await read(req);
   if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid request');
   if(pathname==='/api/speak'){
    if(queue.externallyStopped)throw Error('restart required');
    if(typeof data.text!=='string'||!data.text.trim()||!queue.sessions.has(data.sessionId))throw Error('selected session and text required');
    const id=crypto.randomBytes(12).toString('hex'),base={schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',sessionId:data.sessionId,turnId:id,generationId:id,messageId:id,format:'markdown'};
    adapter.accept({...base,kind:'start',sequence:0});const result=adapter.accept({...base,kind:'complete',sequence:1,text:data.text});
    return json(res,202,{...result,messageId:id});
   }
   if(pathname==='/api/event')return json(res,202,adapter.accept(data));
   if(pathname==='/api/flush')return json(res,202,adapter.flush(data));
   if(pathname==='/api/retry'){
    let retried=0;for(const job of queue.jobs.values())if(job.state==='failed'&&job.event){queue.retry(job.event);retried++;}
    return json(res,202,{state:'retry-requested',retried});
   }
   if(pathname==='/api/pause')return json(res,202,queue.pause());
   if(pathname==='/api/resume')return json(res,202,queue.resume());
   if(pathname==='/api/skip')return json(res,202,queue.skip());
   if(pathname==='/api/stop'){for(const session of sessions)adapter.revokeSession(session);return json(res,202,queue.stop());}
   if(pathname==='/api/restart'){if(!queue.externallyStopped)throw Error('stop before restart');reset();return json(res,200,{state:'restarted'});}
   if(pathname==='/api/settings'){
    if(queue.active||queue.status().bytes||adapter.status().retainedBytes)throw Error('settings require idle queue');
    const next=validate({...settings,...data});if(persist)writeObject(file,next);settings=next;reset();return json(res,200,{state:'saved'});
   }
   json(res,404,{error:'unknown-route'});
  }catch{json(res,400,{error:'request-refused'});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 return {token,server,status,stop:()=>{for(const session of sessions)adapter.revokeSession(session);queue.stop();},close:async()=>{for(const session of sessions)adapter.revokeSession(session);queue.stop();await queue.idle();await new Promise(resolve=>server.close(resolve));}};
}
if(require.main===module){
 try{
  const args=parseCli(process.argv.slice(2),{},['sessions','port']);const port=Number(args.port||0);if(!Number.isInteger(port)||port<0||port>65535)throw Error('invalid port');
  ensurePrivate(stateDir);const controls=createControls({sessions:(args.sessions||'manual').split(','),persist:true});
  controls.server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+controls.server.address().port+'/#'+controls.token,scope:'explicit selected sessions only',development:true})));
  controls.server.on('error',()=>{console.error('Local controls listener is unavailable.');controls.stop();process.exitCode=1;});
  let closing=false;const close=()=>{if(closing)return;closing=true;controls.close().then(()=>process.exit(0),()=>process.exit(1));};process.on('SIGINT',close);process.on('SIGTERM',close);
 }catch{console.error('Local controls could not start; inspect settings and private-state permissions.');process.exitCode=1;}
}
module.exports={createControls,ControlledQueue};
