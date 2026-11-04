// Codex completion payload only. No transcript, prompt, chat discovery or playback wait.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT}=require('./runtime');
function parseEvent(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>262144)throw Error('notification-too-large');
 const event=JSON.parse(raw);if(!event||typeof event!=='object'||Array.isArray(event))throw Error('invalid-notification');
 if(event.type!=='agent-turn-complete')return null;
 for(const key of ['thread-id','turn-id'])if(typeof event[key]!=='string'||!event[key]||event[key].length>256||/[\x00-\x20\x7f]/.test(event[key]))throw Error('notification-identity-missing');
 let text=event['last-assistant-message'];if(typeof text!=='string'||!text.trim())return null;if(Buffer.byteLength(text)>65536)throw Error('reply-too-large');
 const heartbeat=text.match(/<heartbeat>\s*<automation_id>[^<]+<\/automation_id>\s*<decision>\s*(NOTIFY|DONT_NOTIFY)\s*<\/decision>\s*<message>([\s\S]*?)<\/message>\s*<\/heartbeat>\s*$/u);
 if(heartbeat){if(heartbeat[1]==='DONT_NOTIFY')return null;text=heartbeat[2].trim();if(!text)return null;}
 if(/^\s*<heartbeat>[\s\S]*?<decision>\s*DONT_NOTIFY\s*<\/decision>[\s\S]*?<\/heartbeat>\s*$/u.test(text))return null;
 try{const metadata=JSON.parse(text);if(metadata&&typeof metadata==='object'&&!Array.isArray(metadata)&&Object.keys(metadata).every(key=>['title','slug'].includes(key)))return null;}catch{}
 return {thread:event['thread-id'],turn:event['turn-id'],text};
}
function summarize(text){const {applyMode,chunkText}=require('./summarize');const readable=applyMode(text,'informative').trim();if(readable.length<=1000)return readable;let short=applyMode(text,'summary','concise');if(short.length>900)short=chunkText(short,850)[0];return short+' Additional detail is in the written reply.';}
async function narrate(raw,{root=ROOT,connect,send}={}){
 const event=parseEvent(raw);if(!event)return {state:'ignored',audio:false};const text=summarize(event.text);if(!text)return {state:'ignored',audio:false};
 const browser=require('./browser-speak'),conn=(connect||browser.connection)(),api=send||browser.request;
 const status=await api(conn,'/api/status');if(!status.connected)throw Error('browser-not-connected');
 const manifest=require('./package').verify(root),hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'manifest.json'))).digest('hex');
 if(status.version!==manifest.version||status.sourceManifestSha256!==hash)throw Error('browser-build-mismatch');
 const queue=await api(conn,'/api/queue/status');if(queue.stopped)return {state:'silenced',audio:false};
 const sessionId='codex-'+crypto.createHash('sha256').update(event.thread).digest('hex').slice(0,24);await api(conn,'/api/queue/select-source',{sessionId});
 const id=crypto.createHash('sha256').update(JSON.stringify([event.thread,event.turn])).digest('hex').slice(0,32),base={schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',sessionId,turnId:id,generationId:id,messageId:id,format:'markdown'};
 const opened=await api(conn,'/api/queue/event',{...base,kind:'start',sequence:0});const completed=await api(conn,'/api/queue/event',{...base,kind:'complete',sequence:1,text});
 if(completed.state==='revision-refused')throw Error('notification-admission-refused');
 return {state:opened.state==='duplicate'?'duplicate':'queued',id,audio:true,completed:false,humanHearing:'unconfirmed',...(completed.state==='backpressure'?{admission:'pending'}:{})};
}
if(require.main===module)narrate(process.argv[2]).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(/^[a-z-]+$/.test(error.message)?error.message:'notification-failed');process.exitCode=1;});
module.exports={parseEvent,summarize,narrate};
