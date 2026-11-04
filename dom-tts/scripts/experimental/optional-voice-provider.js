// Explicit opt-in cloud service. Never selected by the default local speech path.
const stockVoices=new Set(['alloy','ash','ballad','coral','echo','fable','onyx','nova','sage','shimmer','verse','marin','cedar']);
const maxAudioBytes=5*1024*1024;
const fail=code=>Object.assign(Error(code),{code});
function configure({provider='none',allowCloud=false,apiKey='',voice='coral',replyModel='',baseURL='https://api.openai.com/v1/',fixture=false}={}){
 if(provider==='none')return {provider,enabled:false};
 if(provider!=='openai')throw fail('provider-unsupported');
 if(allowCloud!==true)throw fail('cloud-opt-in-required');
 if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>4096||/[\r\n]/.test(apiKey))throw fail('provider-key-required');
 if(!stockVoices.has(voice))throw fail('stock-voice-required');
 if(replyModel&&(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(replyModel)))throw fail('invalid-reply-model');
 let url;try{url=new URL(baseURL);}catch{throw fail('provider-endpoint-refused');}
 const production=url.href==='https://api.openai.com/v1/';
 const local=fixture===true&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/v1/'&&url.port;
 if((!production&&!local)||url.username||url.password||url.search||url.hash)throw fail('provider-endpoint-refused');
 return {provider,enabled:true,apiKey,voice,replyModel,baseURL:url.href};
}
async function boundedBody(response,max,signal){
 const length=Number(response.headers.get('content-length'));if(length>max){await response.body?.cancel();throw fail('provider-result-too-large');}
 if(!response.body)throw fail('provider-empty-result');
 const chunks=[];let bytes=0;try{for await(const part of response.body){if(signal?.aborted)throw fail('operation-cancelled');bytes+=part.length;if(bytes>max)throw fail('provider-result-too-large');chunks.push(Buffer.from(part));}if(bytes===0)throw fail('provider-empty-result');return Buffer.concat(chunks);}finally{chunks.length=0;}
}
function createProvider(options={},fetcher=fetch){
 const config=configure(options);
 const capabilities=()=>({provider:config.provider,cloudEnabled:config.enabled,stockSpeech:config.enabled,transcription:config.enabled,twoWay:config.enabled&&!!config.replyModel,customVoice:false,replyModelConfigured:!!config.replyModel});
 async function request(route,body,{signal,consent,contentType='application/json',binary=false}={}){
  if(!config.enabled)throw fail('provider-not-configured');
  if(consent!==true)throw fail('request-consent-required');
  if(signal?.aborted)throw fail('operation-cancelled');
  const controller=new AbortController(),relay=()=>controller.abort();signal?.addEventListener('abort',relay,{once:true});const timer=setTimeout(relay,45000);
  try{
   const response=await fetcher(config.baseURL+route,{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,...(contentType?{'Content-Type':contentType}:{})},body,signal:controller.signal,redirect:'error'});
   if(!response.ok){await response.body?.cancel();throw fail('provider-request-failed');}
   if(binary&&!/^audio\/(mpeg|mp3)(;|$)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw fail('provider-audio-type-refused');}
   const data=await boundedBody(response,binary?maxAudioBytes:65536,controller.signal);
   if(binary)return data;
   try{return JSON.parse(data.toString('utf8'));}catch{throw fail('provider-result-invalid');}
  }catch(error){if(controller.signal.aborted)throw fail('operation-cancelled');if(error.code)throw error;throw fail('provider-request-failed');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',relay);}
 }
 const text=value=>{if(typeof value!=='string'||!value.trim()||value.length>4000)throw fail('invalid-text');return value;};
 async function speak(value,context){return request('audio/speech',JSON.stringify({model:'gpt-4o-mini-tts',input:text(value),voice:config.voice,response_format:'mp3'}),{...context,binary:true});}
 async function transcribe(audio,mime,context){
  if(!Buffer.isBuffer(audio)||!audio.length||audio.length>maxAudioBytes)throw fail('invalid-audio');
  const extensions={'audio/webm':'webm','audio/mp4':'m4a','audio/wav':'wav','audio/mpeg':'mp3'};const type=String(mime).split(';')[0];if(!extensions[type])throw fail('audio-type-refused');
  const form=new FormData();form.set('model','gpt-4o-mini-transcribe');form.set('file',new Blob([audio],{type}), 'recording.'+extensions[type]);
  const result=await request('audio/transcriptions',form,{...context,contentType:null});return text(result.text);
 }
 async function reply(value,context){
  if(!config.replyModel)throw fail('reply-model-required');
  const result=await request('responses',JSON.stringify({model:config.replyModel,input:text(value),instructions:'You are Hal, a concise spoken assistant. Reply in plain text in at most three short sentences.',store:false,max_output_tokens:256}),context);
  return text((result.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text).join('\n'));
 }
 async function turn(audio,mime,context){const transcript=await transcribe(audio,mime,context);if(context?.signal?.aborted)throw fail('operation-cancelled');const answer=await reply(transcript,context);if(context?.signal?.aborted)throw fail('operation-cancelled');const audioResult=await speak(answer,context);return {transcript,answer,audio:audioResult};}
 return {capabilities,speak,transcribe,reply,turn};
}
module.exports={configure,createProvider,maxAudioBytes,stockVoices};
