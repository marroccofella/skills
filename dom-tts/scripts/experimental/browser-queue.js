// Selected supplied text only. Browser transport owns the one actual utterance.
const crypto=require('node:crypto');
const {NarrationQueue}=require('./narration-queue');
const {DeltaNarrator}=require('./delta-narrator');
const {applyMode}=require('../summarize');
class BrowserQueue extends NarrationQueue{
 accept(input){if(this.admissionAllowed&&!this.admissionAllowed(input))throw Error('pending-prior-message');return super.accept(input);}
 next(){return this.paused?undefined:super.next();}
 pause(){this.paused=true;return {state:'paused-after-current',activeContinues:!!this.active};}
 resume(){if(this.externallyStopped)throw Error('restart-required');this.paused=false;this.schedule();return {state:'resumed'};}
 skip(){if(this.active){this.active.state='cancelling';this.active.controller.abort();return {state:'skip-requested'};}const blocked=[...this.jobs.values()].find(j=>j.state==='failed');if(blocked){const [sessionId,turnId,generationId]=JSON.parse(blocked.generation);this.cancel({sessionId,turnId,generationId});return {state:'failed-message-skipped'};}return {state:'idle'};}
 async pump(){await super.pump();for(const job of this.jobs.values())if(job.state==='failed')this.forgetText(job);this.onDrain?.();}
 stop(){this.externallyStopped=true;this.paused=false;for(const id of [...this.sessions])this.revokeSession(id);return {state:'queue-stop-requested'};}
}
function createBrowserQueue({transport,sessions=['manual'],maxQueueAgeMs=120000,now=()=>Date.now()}={}){
 let queue,adapter,closed=false,draining=false;const admitted=new Map(),retired=new Map();
 function retireable(key,message){return ['sealed','cancelled','revision-refused'].includes(message.state)&&!message.pending.length&&(queue.groups.get(key)||[]).every(job=>job!==queue.active&&['completed','cancelled'].includes(job.state));}
 function forgetMessage(key,message){
  const jobs=queue.groups.get(key)||[];for(const job of jobs)queue.jobs.delete(job.job);
  queue.groups.delete(key);queue.sealedMessages.delete(key);
  adapter.bytes-=Buffer.byteLength(message.text,'utf8');adapter.messages.delete(key);admitted.delete(key);
  const generation=JSON.stringify([message.base.sessionId,message.base.turnId,message.base.generationId]);
  if(queue.messageCursor.get(generation)===key)queue.messageCursor.delete(generation);
  if(![...adapter.messages.values()].some(m=>JSON.stringify([m.base.sessionId,m.base.turnId,m.base.generationId])===generation))queue.cancelled.delete(generation);
  retired.set(key,true);while(retired.size>256)retired.delete(retired.keys().next().value);
 }
 // Receipts are a rolling window, not a lifetime admission quota. Only forget
 // closed input whose entire playback has settled successfully or was cancelled.
 // Failed messages still block until explicitly skipped; open streams stay live.
 function trimHistory(protectedKey){
  if(adapter.messages.size<48&&queue.jobs.size<96)return;
  for(const [key,message] of adapter.messages){
   if(adapter.messages.size<32&&queue.jobs.size<64)break;
   if(key===protectedKey)continue;
   if(!retireable(key,message))continue;
   // Text-free tombstones reject delayed retries after detailed receipts roll out.
   forgetMessage(key,message);
  }
 }
 function drainPending(){
  if(draining||closed)return;
  if(queue.externallyStopped){for(const id of [...adapter.sessions])adapter.revokeSession(id);return;}
  if(!transport.status().connected)return;
  draining=true;try{for(const message of adapter.messages.values())if(message.pending.length){trimHistory();adapter.flushMessage(message);}}finally{draining=false;}
 }
 function reset(){if(queue?.active)throw Error('previous-speech-unsettled');if(queue)for(const id of [...queue.sessions])adapter.revokeSession(id);admitted.clear();retired.clear();queue=new BrowserQueue({selectedSessions:sessions,play:async(text,{signal})=>{
  if(signal.aborted)throw Error('cancelled');
  const job=transport.submit({text},true);let stopping=false;const cancel=()=>{stopping=true;transport.stopOwned(job.id);};signal.addEventListener('abort',cancel,{once:true});
  try{return await new Promise((resolve,reject)=>{const poll=()=>{const receipt=transport.receipt(job.id);if(!receipt)return reject(Error('receipt-unavailable'));if(receipt.state==='failed')return reject(Error('browser-playback-failed'));if(receipt.state==='completed')return resolve(receipt);if(receipt.state==='cancelled')return resolve({state:stopping?'cancelled':'stopped'});setTimeout(poll,50);};poll();});}finally{signal.removeEventListener('abort',cancel);}
 }});adapter=new DeltaNarrator({queue,selectedSessions:sessions,mode:'informative',incrementalMarkdown:true,segmentBytes:420,maxSegments:queue.maxTracked});
 queue.admissionAllowed=input=>{for(const [key,message]of adapter.messages){if(key===JSON.stringify([input.sessionId,input.turnId,input.generationId,input.messageId]))return true;if(message.base.sessionId===input.sessionId&&message.pending.length)return false;}return true;};
 queue.onDrain=drainPending;
 }
 reset();
 const status=()=>{const q=queue.status(),stream=adapter.status();let reclaimMessages=0,reclaimJobs=0;for(const [key,message]of adapter.messages)if(retireable(key,message)){reclaimMessages++;reclaimJobs+=(queue.groups.get(key)||[]).length;}const state=queue.externallyStopped?'stopped':queue.paused?'paused':q.failed?'blocked-failure':stream.pending||adapter.messages.size-reclaimMessages>=adapter.maxMessages||queue.jobs.size-reclaimJobs>=queue.maxTracked?'backpressure':'ready';return {queue:q,stream,paused:!!queue.paused,stopped:!!queue.externallyStopped,selectedSessions:[...queue.sessions],maxQueueAgeMs,admission:{state,code:{ready:'browser-queue-ready',stopped:'browser-queue-stopped',paused:'browser-queue-paused','blocked-failure':'browser-queue-failed',backpressure:'browser-queue-backpressure'}[state]}};};
 function event(data){if(closed||!transport.status().connected)throw Error('browser-not-connected');const key=JSON.stringify([data.sessionId,data.turnId,data.generationId,data.messageId]);if(retired.has(key))throw Error('reply-history-expired');trimHistory(key);if(data.kind==='start'&&!adapter.messages.has(key)&&adapter.messages.size>=adapter.maxMessages)throw Error('browser-history-full');const result=adapter.accept(data);if(data.kind==='start'&&!admitted.has(key))admitted.set(key,{at:now(),identity:{sessionId:data.sessionId,turnId:data.turnId,generationId:data.generationId}});return result;}
 // This authenticated command selects only a scheduler label for text supplied
 // by the caller. It grants no transcript/file discovery or access to other chats.
 function selectSource(data){
  if(closed||!transport.status().connected)throw Error('browser-not-connected');if(queue.externallyStopped)throw Error('restart-required');
  if(typeof data.sessionId!=='string'||! /^[\w.-]{1,128}$/.test(data.sessionId))throw Error('invalid-source-identity');
  if(!queue.sessions.has(data.sessionId)&&queue.sessions.size>=32){
   let removed=false;for(const source of queue.sessions){if(sessions.includes(source))continue;const messages=[...adapter.messages.entries()].filter(([,m])=>m.base.sessionId===source);if(messages.some(([key,message])=>!retireable(key,message)))continue;
    for(const [key,message]of messages)forgetMessage(key,message);queue.sessions.delete(source);adapter.sessions.delete(source);removed=true;break;
   }
   if(!removed)throw Error('browser-source-capacity');
  }
  queue.sessions.add(data.sessionId);adapter.sessions.add(data.sessionId);return {state:'source-selected',sessionId:data.sessionId,selectedSources:queue.sessions.size};
 }
 function enqueue(data){if(typeof data.text!=='string'||!data.text.trim()||data.text.length>6000||!applyMode(data.text,'informative').trim())throw Error('invalid-text');const id=crypto.randomBytes(16).toString('hex'),base={schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',sessionId:data.sessionId||'manual',turnId:id,generationId:id,messageId:id,format:'markdown'};event({...base,kind:'start',sequence:0});const result=event({...base,kind:'complete',sequence:1,text:data.text});return {...result,id,state:'queued',provider:'browser-local-queue'};}
 function delivery(data){const key=['sessionId','turnId','generationId','messageId'].every(k=>typeof data[k]==='string')?JSON.stringify([data.sessionId,data.turnId,data.generationId,data.messageId]):null,messages=[...adapter.messages.entries()].filter(([id,m])=>key?id===key:m.base.messageId===data.id),jobs=[...queue.jobs.values()].filter(j=>key?j.group===key:JSON.parse(j.group)[3]===data.id),unfinished=messages.some(([,m])=>m.pending.length||['streaming','completing'].includes(m.state));if(!jobs.length)return {id:data.id,state:unfinished?'queued':'unknown',terminal:false,segments:0};const states=jobs.map(j=>j.state);return {id:data.id,state:states.includes('failed')?'failed':states.some(s=>['playing','cancelling'].includes(s))?'speaking':states.includes('queued')||unfinished?'queued':states.includes('cancelled')?'cancelled':'completed',terminal:!unfinished&&states.every(s=>['failed','completed','cancelled'].includes(s)),segments:jobs.length};}
 function selectedMessage(data){for(const field of ['sessionId','turnId','generationId','messageId'])if(typeof data[field]!=='string'||! /^[\w.-]{1,128}$/.test(data[field]))throw Error('invalid-reply-identity');if(!adapter.sessions.has(data.sessionId))throw Error('session-not-selected');const message=adapter.messages.get(JSON.stringify([data.sessionId,data.turnId,data.generationId,data.messageId]));if(!message)throw Error('unknown-reply');return message;}
 function replyReceipt(data){const message=selectedMessage(data),result=delivery({...data,id:data.messageId}),closedInput=['sealed','cancelled','revision-refused'].includes(message.state);if(result.state==='unknown')return {...result,state:closedInput?(message.state==='sealed'?'completed':'cancelled'):'streaming',segments:0,pendingSegments:message.pending.length,inputState:message.state,inputSealed:message.state==='sealed',terminal:closedInput};return {...result,pendingSegments:message.pending.length,inputState:message.state,inputSealed:message.state==='sealed',terminal:result.terminal&&closedInput};}
 function seal(data){const message=selectedMessage(data);if(message.state==='sealed')return replyReceipt(data);if(message.state!=='streaming'||message.pending.length)throw Error('reply-not-sealable');event({...message.base,kind:'complete',sequence:message.next,text:message.text});return replyReceipt(data);}
 function cancelReply(data){selectedMessage(data);return adapter.cancelGeneration(data);}
 function command(action,data={}){if(action==='status')return status();if(action==='select-source')return selectSource(data);if(action==='enqueue')return enqueue(data);if(action==='event')return event(data);if(action==='flush')return adapter.flush(data);if(action==='receipt')return delivery(data);if(action==='reply-receipt')return replyReceipt(data);if(action==='seal')return seal(data);if(action==='cancel-reply')return cancelReply(data);if(action==='pause')return queue.pause();if(action==='resume')return queue.resume();if(action==='skip')return queue.skip();if(action==='stop'){for(const id of [...queue.sessions])adapter.revokeSession(id);return queue.stop();}if(action==='restart'){if(!queue.externallyStopped)throw Error('stop-before-restart');reset();return {state:'restarted'};}throw Error('invalid-queue-command');}
 const timer=setInterval(()=>{for(const [id,item]of admitted){const message=adapter.messages.get(id),jobs=queue.groups.get(id)||[];if(message&&['sealed','cancelled','revision-refused'].includes(message.state)&&jobs.every(j=>['completed','cancelled'].includes(j.state))){admitted.delete(id);continue;}if(now()-item.at>maxQueueAgeMs){try{adapter.cancelGeneration(item.identity);}catch{}admitted.delete(id);}}drainPending();},250);timer.unref();
 return {status,command,occupied:()=>!!queue.active||queue.status().queued>0||adapter.status().pending>0,close(){closed=true;clearInterval(timer);command('stop');},settled:async()=>{for(;;){drainPending();await queue.idle();drainPending();if(!queue.active&&!queue.scheduled&&!queue.next())return;}}};
}
module.exports={createBrowserQueue};
