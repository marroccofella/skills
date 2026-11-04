// Supplied host events only. Never discovers sessions, transcripts, tools or models.
const {createHash}=require('node:crypto');
const sourceId=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x20\x7f]/.test(value);
const stableId=value=>/^[\w.-]{1,128}$/.test(value)?value:'host-'+createHash('sha256').update(value).digest('hex');
const SOURCES=['codex-exec','codex-app-server','claude-stop','openclaw-message-sent'];
class HarnessAdapter{
 constructor({source,selectedSessions,emit,maxBytes=65536,maxTurns=64}={}){
  if(!SOURCES.includes(source)||!Array.isArray(selectedSessions)||!selectedSessions.length||selectedSessions.length>32||selectedSessions.some(id=>!sourceId(id))||typeof emit!=='function')throw Error('explicit host and selected sources required');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>1048576||!Number.isSafeInteger(maxTurns)||maxTurns<1||maxTurns>128)throw Error('invalid host bounds');
  Object.assign(this,{source,maxBytes,maxTurns,emit});this.sessions=new Set(selectedSessions);this.selectedSessionIds=selectedSessions.map(stableId);this.turns=new Map();this.execSession=null;this.execCount=0;this.hooks=new Map();
 }
 text(value){if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>this.maxBytes)throw Error('host text refused');return value;}
 turn(session,id){if(!sourceId(id))throw Error('invalid host turn');const key=JSON.stringify([session,id]);let turn=this.turns.get(key);if(!turn){if(this.turns.size>=this.maxTurns)throw Error('host history limit');turn={session,id,messages:new Map(),state:'active',bytes:0};this.turns.set(key,turn);}return turn;}
 message(turn,id){if(!sourceId(id))throw Error('invalid host item');let message=turn.messages.get(id);if(!message){if(turn.messages.size>=64)throw Error('host message limit');message={id,sequence:0,started:false,text:'',final:null};turn.messages.set(id,message);}return message;}
 event(turn,message,kind,text){const event={schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',format:'markdown',sessionId:stableId(turn.session),turnId:stableId(turn.id),generationId:stableId(turn.id),messageId:stableId(message.id),kind,sequence:message.sequence++,...(text===undefined?{}:{text})};return this.emit(event);}
 start(turn,message){if(!message.started){message.started=true;this.event(turn,message,'start');}}
 retain(turn,message,text){text=this.text(text);const bytes=turn.bytes-Buffer.byteLength(message.text,'utf8')+Buffer.byteLength(text,'utf8');if(bytes>this.maxBytes)throw Error('host retained-text limit');turn.bytes=bytes;message.text=text;}
 completeTurn(turn,success){if(turn.state!=='active')throw Error('host turn already settled');turn.state=success?'complete':'cancelled';for(const message of turn.messages.values()){if(success&&message.final!==null){this.start(turn,message);this.event(turn,message,'complete',message.final);}else if(message.started)this.event(turn,message,'cancel');message.text='';message.final=null;}turn.bytes=0;}
 accept(record){if(!record||typeof record!=='object'||Array.isArray(record))throw Error('host event required');if(this.source==='codex-exec')return this.codexExec(record);if(this.source==='codex-app-server')return this.codexServer(record);return this.hook(record);}
 codexExec(record){
  if(record.type==='thread.started'){if(!sourceId(record.thread_id)||!this.sessions.has(record.thread_id)||this.execSession)throw Error('selected exec thread required');this.execSession=record.thread_id;return {state:'selected'};}
  if(!this.execSession)throw Error('exec thread start required');
  if(record.type==='turn.started'){if(this.currentExec?.state==='active')throw Error('overlapping exec turn');this.currentExec=this.turn(this.execSession,'exec-'+(++this.execCount));return {state:'started'};}
  const turn=this.currentExec;if(!turn||turn.state!=='active')return {state:'ignored'};
  if(record.type==='item.completed'&&record.item?.type==='agent_message'){
   const item=record.item;if(item.phase!==undefined&&item.phase!==null&&!['commentary','final_answer'].includes(item.phase))throw Error('unsupported exec phase');
   if(item.phase==='commentary')return {state:'ignored'};
   // Exec's public JSON format has no promised phase. Retain the last candidate;
   // only turn.completed makes its successful final output eligible for speech.
   for(const previous of turn.messages.values()){previous.text='';previous.final=null;}turn.bytes=0;
   const message=this.message(turn,item.id);this.retain(turn,message,item.text);message.final=message.text;return {state:'held'};
  }
  if(['turn.completed','turn.failed','error'].includes(record.type)){this.completeTurn(turn,record.type==='turn.completed');return {state:turn.state};}
  return {state:'ignored'};
 }
 codexServer(record){
  if(typeof record.method!=='string'||!record.params||typeof record.params!=='object')return {state:'ignored'};
  const p=record.params;if(!sourceId(p.threadId)||!this.sessions.has(p.threadId))return {state:'ignored'};
  if(record.method==='turn/started'){if(!sourceId(p.turn?.id))throw Error('host turn identity required');this.turn(p.threadId,p.turn.id);return {state:'started'};}
  const turnId=p.turnId||p.turn?.id;if(!sourceId(turnId))return {state:'ignored'};
  const turn=this.turns.get(JSON.stringify([p.threadId,turnId]));if(!turn||turn.state!=='active')return {state:'ignored'};
  if(record.method==='turn/completed'){if(!['completed','failed','interrupted'].includes(p.turn?.status))throw Error('unsupported turn outcome');this.completeTurn(turn,p.turn.status==='completed');return {state:turn.state};}
  if(['item/started','item/completed'].includes(record.method)&&p.item?.type==='agentMessage'){
   const item=p.item;if(item.phase!=='final_answer'){const previous=turn.messages.get(item.id);if(previous?.started){this.completeTurn(turn,false);return {state:'cancelled'};}return {state:'ignored'};}
   const message=this.message(turn,item.id);this.start(turn,message);
   if(record.method==='item/completed'){this.text(item.text);const bytes=turn.bytes-Buffer.byteLength(message.text,'utf8')+Buffer.byteLength(item.text,'utf8');if(bytes>this.maxBytes)throw Error('host retained-text limit');this.retain(turn,message,item.text);message.final=message.text;return {state:'held'};}
   if(item.text){this.retain(turn,message,item.text);this.event(turn,message,'delta',item.text);}return {state:'started'};
  }
  if(record.method==='item/agentMessage/delta'){
   const message=turn.messages.get(p.itemId);if(!message?.started)return {state:'ignored'};if(message.final!==null)throw Error('delta after authoritative item');
   this.retain(turn,message,message.text+this.text(p.delta));this.event(turn,message,'delta',p.delta);return {state:'admitted'};
  }
  return {state:'ignored'};
 }
 hook(record){
  let session,messageId,text;
  if(this.source==='claude-stop'){
   if(record.hook_event_name!=='Stop'||record.stop_hook_active===true)return {state:'ignored'};
   session=record.session_id;if(!this.sessions.has(session))return {state:'ignored'};
   if(record.stop_hook_active!==false)throw Error('explicit Stop state required');text=this.text(record.last_assistant_message);
   // Claude Stop does not expose a turn/message id. One invocation is one event;
   // no durable exactly-once claim across separately invoked hook processes.
   messageId='stop-'+(++this.execCount);
  }else{
   if(record.type!=='message'||record.action!=='sent'||record.context?.success!==true)return {state:'ignored'};
   session=record.sessionKey;if(!this.sessions.has(session))return {state:'ignored'};
   messageId=record.context.messageId;if(!sourceId(messageId))throw Error('delivery message identity required');text=this.text(record.context.content);
   const key=JSON.stringify([session,messageId]),hash=createHash('sha256').update(text).digest('hex');
   if(this.hooks.has(key)){if(this.hooks.get(key)!==hash)throw Error('conflicting hook replay');return {state:'duplicate'};}
   if(this.hooks.size>=this.maxTurns)throw Error('hook history limit');this.hooks.set(key,hash);
  }
  if(!text.trim())return {state:'ignored'};
  const turn=this.turn(session,messageId),message=this.message(turn,messageId);message.final=text;this.completeTurn(turn,true);return {state:'admitted'};
 }
 finish(){return this.status();}
 revoke(){for(const turn of this.turns.values())if(turn.state==='active')this.completeTurn(turn,false);}
 status(){return {source:this.source,turns:this.turns.size,unfinished:[...this.turns.values()].filter(t=>t.state==='active').length,cancelledTurns:[...this.turns.values()].filter(t=>t.state==='cancelled').length,retainedBytes:[...this.turns.values()].reduce((n,t)=>n+t.bytes,0)};}
}
module.exports={HarnessAdapter,SOURCES,stableId};
