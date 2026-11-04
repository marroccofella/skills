'use strict';
// Host-owned live notifications only. No socket discovery or transcript access.
const crypto=require('node:crypto');
const {createReplyRelay}=require('./reply-stream');
const phases=new Set(['commentary','partial_answer','final_answer']);
const key=(...parts)=>JSON.stringify(parts);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex').slice(0,24);
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x20\x7f]/.test(value);

function createCodexParagraphRelay({selectedThreads,finalReplyRoute='completion-notify',createRelay=options=>createReplyRelay(options),onReceipt=()=>{},maxPendingBytes=65536,maxPendingEvents=4096,maxItems=64}={}){
 if(!Array.isArray(selectedThreads)||!selectedThreads.length||selectedThreads.length>32||selectedThreads.some(id=>!validId(id)))throw Error('explicit-thread-selection-required');
 if(!['completion-notify','host-relay'].includes(finalReplyRoute)||typeof createRelay!=='function'||typeof onReceipt!=='function'||!Number.isSafeInteger(maxPendingBytes)||maxPendingBytes<1||maxPendingBytes>1048576||!Number.isSafeInteger(maxPendingEvents)||maxPendingEvents<1||maxPendingEvents>4096||!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>128)throw Error('invalid-paragraph-relay-options');
 const eligiblePhase=phase=>phases.has(phase)&&(phase!=='final_answer'||finalReplyRoute==='host-relay');
 const selected=new Set(selectedThreads),items=new Map(),turns=new Map(),retired=new Map(),blocked=new Map(),controls=new Map(),pending=[],waiters=[];
 let pendingBytes=0,running=false,closed=false,failures=0;
 const emit=(record,state,extra={})=>{const receipt={source:'codex-app-server',state,...(record?.threadId?{threadDigest:digest(record.threadId)}:{}),...(record?.itemId?{itemDigest:digest(key(record.threadId,record.turnId,record.itemId))}:{}),...extra};try{onReceipt(receipt);}catch{}return receipt;};
 const remember=(map,id,value,limit=256)=>{map.set(id,value);while(map.size>limit)map.delete(map.keys().next().value);};
 const turnKey=e=>key(e.threadId,e.turnId),itemKey=e=>key(e.threadId,e.turnId,e.itemId);
 // Live cancellation belongs to the queued/inflight work, not the rolling replay
 // cache. A failure flood may evict tombstones but cannot revoke this token.
 function cancelControl(id){const control=controls.get(id);if(control)control.cancelled=true;const turn=turns.get(id);if(turn?.control)turn.control.cancelled=true;}
 function cleanupControl(id,control){if(control&&control.pending===0&&control.inflight===0&&!turns.get(id)?.active&&controls.get(id)===control)controls.delete(id);}
 const isCancelled=item=>closed||item.cancelled||item.control?.cancelled||!selected.has(item.threadId);
 function trim(){
  for(const [id,item]of items){if(items.size<maxItems)break;if(item.closed){items.delete(id);remember(retired,id,true);}}
  for(const [id,turn]of turns){if(turns.size<maxItems)break;if(!turn.active)turns.delete(id);}
 }
 function normalize(record){
  if(!record||typeof record!=='object'||Array.isArray(record)||record.id!==undefined||typeof record.method!=='string')return null;
  const p=record.params;if(!p||!selected.has(p.threadId))return null;
  const base={threadId:p.threadId};
  if(['thread/closed','thread/archived','thread/deleted'].includes(record.method))return {...base,kind:'thread-closed'};
  const turnId=p.turnId||p.turn?.id;if(!validId(turnId))return null;base.turnId=turnId;
  if(record.method==='turn/started')return {...base,kind:'turn-started'};
  if(record.method==='turn/completed')return {...base,kind:'turn-completed',successful:p.turn?.status==='completed'};
  if(['item/started','item/completed'].includes(record.method)){
   if(p.item?.type!=='agentMessage'||!validId(p.item.id))return null;
   if(p.item.phase!==undefined&&!phases.has(p.item.phase))return null;
   if(p.item.text!==undefined&&typeof p.item.text!=='string')throw Error('invalid-agent-message');
   return {...base,itemId:p.item.id,kind:record.method==='item/started'?'item-started':'item-completed',phase:p.item.phase,...(typeof p.item.text==='string'?{text:p.item.text}:{})};
  }
  if(record.method==='item/agentMessage/delta'){
   if(!validId(p.itemId)||typeof p.delta!=='string')throw Error('invalid-agent-delta');
   return {...base,itemId:p.itemId,kind:'delta',text:p.delta};
  }
  return null;
 }
 async function cancelItem(item){item.cancelled=true;item.closed=true;item.text='';
  // Creation may finish after an earlier cancellation with no relay yet.
  if(item.relay&&item.cancelledRelay!==item.relay){const ownedRelay=item.relay;item.cancelledRelay=ownedRelay;item.cancelPromise=Promise.resolve().then(()=>ownedRelay.cancel()).catch(()=>{failures++;emit(item,'cancel-unconfirmed',{code:'paragraph-cancel-unconfirmed'});});}
  if(item.cancelPromise)await item.cancelPromise;
 }
 async function cancelTurn(id){const control=controls.get(id);cancelControl(id);const turn=turns.get(id);if(turn)turn.active=false;await Promise.all([...items.values()].filter(item=>turnKey(item)===id).map(cancelItem));cleanupControl(id,control);}
 function requireLive(item){if(isCancelled(item))throw Error('paragraph-source-cancelled');}
 async function openRelay(item){
  requireLive(item);
  if(!item.relay)item.relay=await createRelay({format:'markdown',sessionId:'codex-'+digest(item.threadId)});
  requireLive(item);
  return item.relay;
 }
 async function append(item,text){const relay=await openRelay(item);requireLive(item);await relay.append(text);requireLive(item);return relay;}
 async function processEvent(e){
  const tk=e.turnId?turnKey(e):null;
  if(e.kind==='thread-closed'){selected.delete(e.threadId);for(const [id,turn]of turns)if(turn.threadId===e.threadId){remember(blocked,id,true);await cancelTurn(id);}return emit(e,'cancelled');}
  if(!selected.has(e.threadId))return emit(e,'ignored');
  if(e.kind==='turn-started'){
   if(e.control?.cancelled||blocked.has(tk)||turns.has(tk))return emit(e,'duplicate');trim();if(turns.size>=maxItems)throw Error('live-turn-limit');turns.set(tk,{threadId:e.threadId,active:true,control:e.control});return emit(e,'selected');
  }
  if(e.kind==='turn-completed'){
   const turn=turns.get(tk);if(!turn||!turn.active)return emit(e,'ignored');
   if(!e.successful){await cancelTurn(tk);return emit(e,'cancelled');}
   // A missing authoritative item completion is not permission to speak its tail.
   for(const item of items.values())if(turnKey(item)===tk&&!item.closed)await cancelItem(item);
   turn.active=false;return emit(e,'turn-completed');
  }
  if(e.control?.cancelled||blocked.has(tk)||!turns.get(tk)?.active)return emit(e,'ignored');
  const ik=itemKey(e);if(retired.has(ik))return emit(e,'ignored',{code:'retired-item'});
  let item=items.get(ik);
  if(e.kind==='item-started'){
   if(item)return emit(e,'duplicate');trim();if(items.size>=maxItems)throw Error('live-item-limit');
   item={...e,text:'',phase:e.phase,closed:false,relay:null};items.set(ik,item);
   if(eligiblePhase(e.phase)&&e.text){await append(item,e.text);requireLive(item);item.text=e.text;}
   return emit(e,eligiblePhase(e.phase)?'item-opened':'phase-withheld');
  }
  if(e.kind==='delta'){
   if(!item||item.closed||!eligiblePhase(item.phase))return emit(e,'ignored');
   if(Buffer.byteLength(item.text+e.text)>16000)throw Error('paragraph-item-byte-limit');
   const relay=await append(item,e.text);requireLive(item);item.text+=e.text;
   return emit(e,'admitted',{id:relay.id});
  }
  if(e.kind==='item-completed'){
   const eligible=e.phase||item?.phase;if(!eligiblePhase(eligible)){if(item)await cancelItem(item);return emit(e,'phase-withheld');}
   if(typeof e.text!=='string')throw Error('authoritative-item-text-required');
   const hash=digest(e.text);
   if(item?.closed)return emit(e,item.finalHash===hash?'duplicate':'ignored');
   if(!item){trim();if(items.size>=maxItems)throw Error('live-item-limit');item={...e,text:'',phase:eligible,closed:false,relay:null};items.set(ik,item);}
   if(item.phase&&e.phase&&item.phase!==e.phase)throw Error('agent-phase-changed');
   if(!e.text.startsWith(item.text))throw Error('authoritative-prefix-revised');
   if(Buffer.byteLength(e.text)>16000)throw Error('paragraph-item-byte-limit');
   if(e.text.trim()){
    const relay=await openRelay(item);const tail=e.text.slice(item.text.length);if(tail)await append(item,tail);
    requireLive(item);await relay.finish();requireLive(item);item.finalHash=hash;item.text='';item.closed=true;return emit(e,'sealed',{id:relay.id});
   }
   if(item.relay)await cancelItem(item);item.finalHash=hash;item.text='';item.closed=true;return emit(e,'empty');
  }
 }
 async function drain(){
  if(running)return;running=true;
  try{while(pending.length&&!closed){const {record,bytes}=pending.shift(),control=record.control;pendingBytes-=bytes;if(control){control.pending--;control.inflight++;}
   try{await processEvent(record);}catch(error){const cancelled=error.message==='paragraph-source-cancelled';if(!cancelled)failures++;if(record.turnId){remember(blocked,turnKey(record),true);await cancelTurn(turnKey(record));}emit(record,cancelled?'cancelled':'failed',{code:/^[a-z-]+$/.test(error.message||'')?error.message:'paragraph-delivery-failed'});}
   finally{if(control){control.inflight--;cleanupControl(turnKey(record),control);}}
  }}
  finally{running=false;if(!pending.length||closed)for(const resolve of waiters.splice(0))resolve();}
 }
 function observe(record){
  if(closed)return {state:'closed'};let event;try{event=normalize(record);}catch(error){failures++;return emit(null,'refused',{code:error.message});}
  if(!event)return {state:'ignored'};const bytes=Buffer.byteLength(event.text||'');
  if(bytes>16000||pendingBytes+bytes>maxPendingBytes||pending.length>=maxPendingEvents){failures++;
   if(event.turnId){remember(blocked,turnKey(event),true);void cancelTurn(turnKey(event));}
   else if(event.kind==='thread-closed'){selected.delete(event.threadId);for(const [id,control]of controls)if(control.threadId===event.threadId){control.cancelled=true;void cancelTurn(id);}}
   return emit(event,'backpressure',{code:'paragraph-buffer-full'});
  }
  const cancellation=event.kind==='thread-closed'||event.kind==='turn-completed'&&!event.successful;
  if(cancellation){
   if(event.turnId){remember(blocked,turnKey(event),true);void cancelTurn(turnKey(event));}
   else {selected.delete(event.threadId);for(const [id,control]of controls)if(control.threadId===event.threadId){control.cancelled=true;remember(blocked,id,true);void cancelTurn(id);}}
  }
  if(event.turnId){const id=turnKey(event);let control=controls.get(id);if(!control){control={threadId:event.threadId,cancelled:cancellation||blocked.has(id),pending:0,inflight:0};controls.set(id,control);}event.control=control;control.pending++;}
  if(cancellation){
   pending.unshift({record:event,bytes});
  }else pending.push({record:event,bytes});pendingBytes+=bytes;void drain();return {state:'queued',completed:false};
 }
 return {
  observe,
  flush(){return !running&&!pending.length?Promise.resolve():new Promise(resolve=>waiters.push(resolve));},
  async close(){closed=true;for(const control of controls.values())control.cancelled=true;pending.length=0;pendingBytes=0;await Promise.all([...items.values()].map(cancelItem));if(running)await new Promise(resolve=>waiters.push(resolve));controls.clear();},
  status(){return {mode:'supplied-live-events',automaticDesktopSubscription:false,hostForwardingRequired:true,transcriptAccess:false,finalReplyRoute,finalAnswerStreaming:finalReplyRoute==='host-relay',completionNotifyMustExcludeSelectedThreads:finalReplyRoute==='host-relay',selectedThreadCount:selected.size,pendingEvents:pending.length,pendingBytes,liveControls:controls.size,retainedItems:items.size,retiredItems:retired.size,failures,closed};}
 };
}

// Ready to wire at the host's existing event dispatch point: display first.
function createCodexParagraphForwarder({renderEvent,...options}={}){
 if(typeof renderEvent!=='function')throw Error('host-render-callback-required');const relay=createCodexParagraphRelay(options);
 return {...relay,onHostEvent(event){renderEvent(event);return relay.observe(event);}};
}
module.exports={createCodexParagraphRelay,createCodexParagraphForwarder};
