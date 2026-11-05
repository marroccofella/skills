// Explicitly enabled, local-only browser companion. No native-policy fallback.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,stateDir,ensurePrivate,readObject,writeObject,alive}=require('../runtime');
const {createBrowserQueue}=require('./browser-queue');
const {speechDeadline}=require('../../assets/browser/player');
const {proofMac,validateIntentTick,PROOF_SCHEMA,PROOF_ROUTE}=require('./browser-client');
const {createBrowserRpc,requiresControlEpoch,assertControlEpoch,ROUTE:RPC_ROUTE}=require('./browser-rpc');
const terminal=new Set(['completed','cancelled','failed']);
function createSession({leaseMs=30000,deadlineMs,now=()=>Date.now(),dir=stateDir,persist=false,sessions=['manual'],sourceManifestSha256}={}){
 if(deadlineMs!==undefined&&(!Number.isFinite(deadlineMs)||deadlineMs<=0||deadlineMs>300000))throw Error('invalid-deadline');
 const version=require('../../package.json').version;if(sourceManifestSha256!==undefined&&!/^[a-f0-9]{64}$/.test(sourceManifestSha256))throw Error('invalid-source-manifest-hash');
 const token=crypto.randomBytes(32).toString('hex');let connection=null,active=null,closed=false,stopEpoch=0,lastStopTick=0n,proofBucket={at:now(),count:0};const proofCredits=new WeakMap(),receipts=new Map(),pendingSpeech=new Set();
 let browserState='not-enabled';const transitions=[{state:browserState,at:now()}];
 function transition(state){if(browserState===state)return;browserState=state;transitions.push({state,at:now()});while(transitions.length>24)transitions.shift();}
 const cancelPendingSpeech=()=>{for(const controller of pendingSpeech)controller.abort();pendingSpeech.clear();};
 const preferencesFile=path.join(dir,'browser-preferences.json');
 function validPreferences(data){return data&&typeof data.voice==='string'&&data.voice.length>0&&data.voice.length<=256&&Number.isFinite(data.rate)&&data.rate>=0.5&&data.rate<=2;}
 let preferences=persist?readObject(preferencesFile,null):null;
 if(persist&&fs.existsSync(preferencesFile)&&!validPreferences(preferences))throw Error('invalid-preferences');
 const getPreferences=()=>preferences?{voice:preferences.voice,rate:preferences.rate}:{};
 function finish(state,code,extra={}){if(!active)return;const receipt={id:active.id,state,code,...extra};receipts.set(active.id,receipt);while(receipts.size>128)receipts.delete(receipts.keys().next().value);active.text=null;active.receipt=receipt;}
 function check(){if(connection&&now()-connection.seen>leaseMs){if(active&&!active.receipt){finish('failed','browser-disconnected');active.cancel=true;}connection.expired=true;transition('lease-expired');}if(active&&!active.receipt&&now()-active.began>(active.state==='queued'?Math.min(45000,active.deadlineMs):active.deadlineMs)){finish('failed','speech-timeout');active.cancel=true;}}
 function status(){check();return {provider:'browser-local',version,stopEpoch,...(sourceManifestSha256?{sourceManifestSha256}:{}),connected:!!connection&&!connection.expired,voice:connection?.voice||null,rate:connection?.rate||null,active:active?{id:active.id,state:active.receipt?.state||active.state}:null,health:{browserState,lastPollAgeMs:connection?Math.max(0,now()-connection.seen):null,leaseMs,transitions:transitions.map(x=>({...x}))}};}
 function enable(data){check();if(typeof data.client!=='string'||!/^[a-f0-9]{32}$/.test(data.client)||!validPreferences(data))throw Error('invalid-enable');if(connection&&!connection.expired&&connection.client!==data.client)throw Error('browser-already-connected');if(active)throw Error('previous-speech-unsettled');if(queue.status().stopped)queue.command('restart');const selected={voice:data.voice,rate:data.rate};if(persist)writeObject(preferencesFile,selected);preferences=selected;connection={client:data.client,...selected,seen:now()};transition('connected');return status();}
 function disable(data){if(!connection||connection.client!==data.client)throw Error('stale-receipt');advanceStopEpoch();cancelPendingSpeech();queue.command('stop');if(active&&!active.receipt)finish('failed','browser-disabled');active=null;connection=null;transition('disabled');return {state:'disabled'};}
 function poll(data){check();if(!connection||data.client!==connection.client){return {action:'disconnect'};}connection.seen=now();if(connection.expired&&!active){connection.expired=false;transition('connected');return {action:'idle',reconnected:true};}return active?{action:active.cancel?'cancel':'speak',id:active.id,text:active.text,voice:connection.voice,rate:connection.rate}:{action:'idle'};}
 function submit(data,fromQueue=false){check();if(!connection||connection.expired)throw Error('browser-not-connected');if(active||!fromQueue&&queue.occupied())throw Error('speech-busy');if(typeof data.text!=='string'||!data.text.trim()||data.text.length>1000)throw Error('invalid-text');active={id:crypto.randomBytes(16).toString('hex'),text:data.text,began:now(),deadlineMs:deadlineMs??speechDeadline(data.text,connection.rate),state:'queued',cancel:false};return {id:active.id,state:'queued',provider:'browser-local'};}
 function stop(){check();if(active&&!active.receipt){active.cancel=true;active.text=null;active.state='cancelling';active.stopAt??=now();}return {state:active&&!active.receipt?'stop-requested':'idle'};}
 function advanceStopEpoch(){if(stopEpoch>=Number.MAX_SAFE_INTEGER)throw Error('browser-control-epoch-stale');stopEpoch++;lastStopTick=process.hrtime.bigint();}
 function globalStop(){advanceStopEpoch();cancelPendingSpeech();queue.command('stop');return stop();}
 function stopOwned(id){if(active?.id===id)return stop();return {state:'idle'};}
 function accept(data){check();if(!connection||data.client!==connection.client)throw Error('stale-receipt');
  // A completed acknowledgement can overtake its earlier speaking request.
  // Known settled duplicates neither refresh the lease nor touch another job.
  if(receipts.has(data.id)&&(data.state==='speaking'||terminal.has(data.state)&&active?.id!==data.id))return {accepted:true,duplicate:true};
  if(!active||data.id!==active.id)throw Error('stale-receipt');connection.seen=now();if(data.state==='speaking'){if(!active.receipt)active.state='speaking';return {accepted:true};}if(!terminal.has(data.state)||typeof data.startObserved!=='boolean'||data.localService!==true||!Number.isFinite(data.elapsedMs)||data.elapsedMs<0||data.elapsedMs>330000)throw Error('invalid-receipt');const code=data.state==='cancelled'?'owned-stop':data.state==='failed'?'browser-speech-failed':undefined;const cancelRequested=active.cancel;if(!active.receipt)finish(data.state,code,{startObserved:data.startObserved,elapsedMs:data.elapsedMs,localService:true,humanHearing:'unconfirmed',cancelRequested,...(active.stopAt!==undefined?{stopAcknowledgmentMs:Math.max(0,now()-active.stopAt)}:{})});active=null;return {accepted:true};}
 function receipt(id){check();if(!/^[a-f0-9]{32}$/.test(id))throw Error('invalid-id');return receipts.get(id)||(active?.id===id?{id,state:active.state}:null);}
 const timer=setInterval(check,500);timer.unref();
 const queue=createBrowserQueue({transport:{submit,status,receipt,stopOwned},sessions,now});
 function close(){if(closed)return;closed=true;advanceStopEpoch();clearInterval(timer);cancelPendingSpeech();queue.close();stop();connection=null;active=null;receipts.clear();}
 const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 const read=(req,signal,limit=32768)=>new Promise((resolve,reject)=>{
  let chunks=[],bytes=0,large=false,settled=false;
  const clean=()=>{chunks=[];req.off('data',data);req.off('end',end);req.off('aborted',aborted);req.off('error',failed);signal?.removeEventListener('abort',cancel);};
  const finish=(error,value)=>{if(settled)return;settled=true;clean();error?reject(error):resolve(value);};
  const data=chunk=>{bytes+=chunk.length;if(bytes>limit){large=true;chunks=[];}else if(!large)chunks.push(chunk);};
  const end=()=>{try{if(large)throw Error();const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes));finish(null,JSON.parse(text));}catch{finish(Error('invalid-json'));}};
  const aborted=()=>finish(Error('request-aborted')),failed=()=>finish(Error('request-failed'));
  const cancel=()=>{finish(Error('request-aborted'));req.destroy();};
  req.on('data',data);req.on('end',end);req.on('aborted',aborted);req.on('error',failed);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 });
 const rpcTransport=createBrowserRpc({token,port:()=>server.address().port});
 const routes={'/':'browser.html','/rpc.js':'rpc.js','/player.js':'player.js','/screen.js':'screen.js','/queue-screen.js':'queue-screen.js','/style.css':'style.css'};
 const server=http.createServer(async(req,res)=>{
  const host='127.0.0.1:'+server.address().port;if(req.headers.host!==host||req.headers.origin&&req.headers.origin!=='http://'+host)return json(res,403,{error:'origin-refused'});
  if(req.url===PROOF_ROUTE){
   // A bounded unauthenticated proof reveals no token and grants no command authority.
   try{
    const length=req.headers['content-length'];if(req.method!=='POST'||req.headers['content-type']!=='application/json'||req.headers['transfer-encoding']!==undefined||req.headers['x-dom-tts-token']!==undefined||typeof length!=='string'||!/^\d{1,3}$/.test(length)||Number(length)<1||Number(length)>128)throw Error();
    const at=now();if(at<proofBucket.at||at-proofBucket.at>=1000)proofBucket={at,count:0};if(proofBucket.count>=256){res.setHeader('Connection','close');return json(res,429,{error:'server-proof-refused'});}proofBucket.count++;const chargedBucket=proofBucket;
    req.setTimeout(3000,()=>req.destroy());const data=await read(req,undefined,128);
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join(',')!=='intentTick,nonce'||typeof data.nonce!=='string'||!/^[a-f0-9]{64}$/.test(data.nonce))throw Error();
    const intentTick=validateIntentTick(data.intentTick);proofCredits.set(req.socket,{bucket:chargedBucket,epoch:stopEpoch,intentTick});return json(res,200,{schema:PROOF_SCHEMA,nonce:data.nonce,intentTick:data.intentTick,port:server.address().port,mac:proofMac(token,data.nonce,server.address().port,data.intentTick)});
   }catch{if(!res.destroyed)return json(res,400,{error:'server-proof-refused'});return;}
  }
  if(req.method==='GET'&&Object.hasOwn(routes,req.url)){res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});const bytes=fs.readFileSync(path.join(ROOT,'assets','browser',routes[req.url]));return res.end(req.url==='/'?bytes.toString('utf8').replace('{{DOM_TTS_VERSION}}',version.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))):bytes);}
  let rpc=null;
  if(req.url===RPC_ROUTE){
   const controller=new AbortController();
   try{const length=req.headers['content-length'];if(req.method!=='POST'||req.headers['content-type']!=='application/json'||req.headers['x-dom-tts-token']!==undefined||req.headers['transfer-encoding']!==undefined||typeof length!=='string'||!/^\d{1,5}$/.test(length)||Number(length)<1||Number(length)>65536)throw Error();pendingSpeech.add(controller);rpc=rpcTransport.open(await read(req,controller.signal,65536));}catch{if(!res.destroyed)json(res,400,{error:'browser-rpc-refused'});return;}finally{pendingSpeech.delete(controller);}
  }
  const route=rpc?rpc.route:req.url,method=rpc?rpc.method:req.method,reply=(code,data)=>rpc?json(res,200,rpcTransport.seal(rpc.nonce,code,data,stopEpoch)):json(res,code,data);
  const provided=req.headers['x-dom-tts-token'];if(!rpc&&(typeof provided!=='string'||!/^[a-f0-9]{64}$/.test(provided)||!crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(token))))return json(res,401,{error:'authentication-required'});
  // Retire exactly one proof only after its same socket proves token possession.
  // Object identity prevents old/rolled-back time buckets from refunding a new one.
  let proofEpoch,proofIntentTick;if(!rpc){const credit=proofCredits.get(req.socket);if(credit){proofCredits.delete(req.socket);proofEpoch=credit.epoch;proofIntentTick=credit.intentTick;if(credit.bucket===proofBucket)proofBucket.count=Math.max(0,proofBucket.count-1);}}
  try{
   if(closed)throw Error('browser-control-epoch-stale');
   if(method==='GET'&&route==='/api/status')return reply(200,status());
   if(method==='GET'&&route==='/api/preferences')return reply(200,getPreferences());
   if(method==='GET'&&route==='/api/queue/status')return reply(200,queue.status());
   if(method==='GET'&&route.startsWith('/api/receipt/')){const value=receipt(route.slice('/api/receipt/'.length));return reply(value?200:404,value||{error:'receipt-unavailable'});}
   if(method!=='POST'||req.headers['content-type']!=='application/json')throw Error('json-post-required');
   const controller=['/api/speak','/api/queue/enqueue','/api/queue/event'].includes(route)?new AbortController():null;if(controller)pendingSpeech.add(controller);
   let data;try{data=rpc?rpc.data:await read(req,controller?.signal);}finally{if(controller)pendingSpeech.delete(controller);}if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid-json');
   if(closed)throw Error('browser-control-epoch-stale');assertControlEpoch(route,rpc?rpc.epoch:proofEpoch,stopEpoch);if(!rpc&&requiresControlEpoch(route)&&(typeof proofIntentTick!=='bigint'||proofIntentTick<=lastStopTick))throw Error('browser-control-epoch-stale');
   if(route==='/api/enable')return reply(200,enable(data));
   if(route==='/api/disable')return reply(200,disable(data));
   if(route==='/api/poll')return reply(200,poll(data));
   if(route==='/api/speak')return reply(202,submit(data));
   if(route==='/api/stop')return reply(200,globalStop());
   if(route==='/api/stop-owned'){if(typeof data.id!=='string'||!/^[a-f0-9]{32}$/.test(data.id))throw Error('invalid-id');return reply(200,stopOwned(data.id));}
   if(route.startsWith('/api/queue/')){if(route==='/api/queue/stop'){advanceStopEpoch();cancelPendingSpeech();}return reply(200,queue.command(route.slice('/api/queue/'.length),data));}
   if(route==='/api/receipt')return reply(200,accept(data));
   return reply(404,{error:'not-found'});
  }catch(error){if(res.destroyed)return;const known=new Set(['browser-control-epoch-stale','restart-required','browser-source-capacity','invalid-source-identity','reply-segment-limit','browser-history-full','reply-history-expired','invalid-enable','browser-already-connected','previous-speech-unsettled','browser-not-connected','speech-busy','invalid-text','stale-receipt','invalid-receipt','invalid-id','invalid-json','json-post-required']);return reply(400,{error:known.has(error.message)?error.message:'request-refused'});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 return {server,token,status,enable,poll,submit,stop,globalStop,stopOwned,accept,receipt,disable,getPreferences,queue,close};
}
async function main(){
 require('../package').verify();
 ensurePrivate();const file=path.join(stateDir,'browser-session.json'),lock=path.join(stateDir,'browser-session.lock'),old=readObject(file,{});if(alive(old.pid))throw Error('A browser companion already owns this state directory.');
 const sourceManifestSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'manifest.json'))).digest('hex');
 const session=createSession({persist:true,sourceManifestSha256});const owner=require('./browser-owner').acquireOwner({dir:stateDir,token:session.token});
 try{await new Promise((resolve,reject)=>{session.server.once('error',reject);session.server.listen(0,'127.0.0.1',resolve);});}catch(error){session.close();owner.release();throw error;}
 const port=session.server.address().port;writeObject(file,{schema:'dom-tts-browser/1',pid:process.pid,port,token:session.token});
 console.log('Open the local voice page: http://127.0.0.1:'+port+'/#'+session.token);
 let closing=false;const close=()=>{if(closing)return;closing=true;session.close();if(readObject(file,{}).token===session.token)fs.unlinkSync(file);owner.release();session.server.close(()=>process.exit(0));};process.on('SIGINT',close);process.on('SIGTERM',close);
}
if(require.main===module)main().catch(()=>{console.error('Browser companion could not start; check private state permissions and session ownership.');process.exitCode=1;});
module.exports={createSession,main};
