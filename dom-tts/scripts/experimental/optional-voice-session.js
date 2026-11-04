// Separate studio: no shared state, no microphone activation, no cloud by default.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createProvider,maxAudioBytes}=require('./optional-voice-provider');
const assetRoot=path.resolve(__dirname,'../../assets/optional-voice');
function readBody(req,limit,signal){return new Promise((resolve,reject)=>{
 const parts=[];let bytes=0,settled=false;
 const cleanup=()=>{parts.length=0;bytes=0;req.removeListener('data',data);req.removeListener('end',end);req.removeListener('aborted',aborted);req.removeListener('error',error);signal.removeEventListener('abort',cancel);};
 const finish=(failure,value)=>{if(settled)return;settled=true;cleanup();if(failure)reject(Error(failure));else resolve(value);};
 const cancel=()=>{finish('operation-cancelled');req.destroy();};
 const aborted=()=>finish('operation-cancelled');const error=()=>finish('request-refused');
 const data=part=>{bytes+=part.length;if(bytes>limit){finish('request-too-large');req.destroy();return;}parts.push(part);};
 const end=()=>finish(null,Buffer.concat(parts));
 req.on('data',data);req.once('end',end);req.once('aborted',aborted);req.once('error',error);signal.addEventListener('abort',cancel,{once:true});
 if(signal.aborted)cancel();
 });}
function createSession({provider=createProvider()}={}){
 const token=crypto.randomBytes(32).toString('hex');let active=null;
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const files={'/':'optional.html','/optional.css':'optional.css','/microphone.js':'microphone.js','/optional-screen.js':'optional-screen.js'};
 const server=http.createServer(async(req,res)=>{
  const host='127.0.0.1:'+server.address().port;
  if(req.headers.host!==host||req.headers.origin&&req.headers.origin!=='http://'+host)return json(res,403,{error:'origin-refused'});
  if(req.method==='GET'&&Object.hasOwn(files,req.url)){
   res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Permissions-Policy':'camera=(), microphone=(self)','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; media-src blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});return res.end(fs.readFileSync(path.join(assetRoot,files[req.url])));
  }
  const supplied=req.headers['x-dom-tts-token'];if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return json(res,401,{error:'authentication-required'});
  if(req.method==='GET'&&req.url==='/api/capabilities')return json(res,200,provider.capabilities());
  if(req.method==='POST'&&req.url==='/api/stop'){active?.abort();return json(res,200,{state:active?'stop-requested':'idle'});}
  if(req.method!=='POST'||!['/api/speak','/api/transcribe','/api/turn'].includes(req.url))return json(res,404,{error:'not-found'});
  if(req.headers['x-dom-tts-consent']!=='true')return json(res,403,{error:'request-consent-required'});
  if(active)return json(res,409,{error:'operation-busy'});
  const controller=new AbortController();active=controller;const context={signal:controller.signal,consent:true};const timeout=setTimeout(()=>controller.abort(),90000);const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnected);
  try{
   const body=await readBody(req,req.url==='/api/speak'?20000:maxAudioBytes,controller.signal),mime=req.headers['content-type']||'';
   if(controller.signal.aborted)throw Error('operation-cancelled');
   if(req.url==='/api/speak'){
    if(mime!=='application/json'||body.length>20000)throw Error('invalid-text');const data=JSON.parse(body.toString('utf8'));const result=await provider.speak(data.text,context);if(controller.signal.aborted)throw Error('operation-cancelled');res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'no-store'});res.end(result);
   }else if(req.url==='/api/transcribe'){
    const transcript=await provider.transcribe(body,mime,context);if(controller.signal.aborted)throw Error('operation-cancelled');json(res,200,{transcript});
   }else{
    const result=await provider.turn(body,mime,context);if(controller.signal.aborted)throw Error('operation-cancelled');json(res,200,{transcript:result.transcript,answer:result.answer,audio:result.audio.toString('base64'),mime:'audio/mpeg'});
   }
  }catch(error){if(!res.destroyed&&!res.writableEnded){const known=new Set(['request-too-large','invalid-audio','audio-type-refused','invalid-text','provider-not-configured','reply-model-required','operation-cancelled','provider-request-failed','provider-result-invalid','provider-empty-result','provider-result-too-large','provider-audio-type-refused']);json(res,error.message==='operation-cancelled'?409:400,{error:known.has(error.message)?error.message:'request-refused'});}}
  finally{clearTimeout(timeout);res.removeListener('close',disconnected);if(active===controller)active=null;}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 return {server,token,close(){active?.abort();server.closeAllConnections?.();server.close();}};
}
async function main(argv=process.argv.slice(2)){
 const options={};for(let i=0;i<argv.length;i+=2){const key=argv[i];if(!['--provider','--allow-cloud','--voice','--reply-model'].includes(key)||argv[i+1]===undefined)throw Error('Invalid studio option');if(Object.hasOwn(options,key))throw Error('Duplicate studio option');options[key]=argv[i+1];}
 if(options['--allow-cloud']!==undefined&&!['true','false'].includes(options['--allow-cloud']))throw Error('--allow-cloud requires true or false');
 const provider=createProvider({provider:options['--provider']||'none',allowCloud:options['--allow-cloud']==='true',apiKey:process.env.DOM_TTS_OPENAI_API_KEY||'',voice:options['--voice']||'coral',replyModel:options['--reply-model']||''});const session=createSession({provider});await new Promise((resolve,reject)=>{session.server.once('error',reject);session.server.listen(0,'127.0.0.1',resolve);});
 console.log('Open optional voice studio: http://127.0.0.1:'+session.server.address().port+'/#'+session.token);console.log('Microphone is off. Cloud enabled: '+provider.capabilities().cloudEnabled+'. No requests are sent until you explicitly act.');
 const close=()=>{session.close();process.exitCode=0;};process.once('SIGINT',close);process.once('SIGTERM',close);
}
if(require.main===module)main().catch(()=>{console.error('Optional studio unavailable. Check provider selection, explicit cloud opt-in and required environment key. No fallback was started.');process.exitCode=1;});
module.exports={createSession,main};
