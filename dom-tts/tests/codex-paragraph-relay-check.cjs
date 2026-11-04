'use strict';
const assert=require('node:assert/strict');
const {createSession}=require('../scripts/experimental/browser-session');
const {request}=require('../scripts/browser-speak');
const {createReplyRelay}=require('../scripts/reply-stream');
const {createCodexParagraphRelay,createCodexParagraphForwarder}=require('../scripts/codex-paragraph-relay');
const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
const turn=(threadId,turnId='turn',status)=>({method:status?'turn/completed':'turn/started',params:{threadId,turn:{id:turnId,...(status?{status}:{})}}});
const item=(threadId,phase,text='',completed=false,turnId='turn',itemId='same-item')=>({method:completed?'item/completed':'item/started',params:{threadId,turnId,item:{type:'agentMessage',id:itemId,...(phase?{phase}:{}),text}}});
const delta=(threadId,text,turnId='turn',itemId='same-item')=>({method:'item/agentMessage/delta',params:{threadId,turnId,itemId,delta:text}});
(async()=>{
 const s=createSession({leaseMs:600000});await new Promise(resolve=>s.server.listen(0,'127.0.0.1',resolve));const conn={port:s.server.address().port,token:s.token},client='e'.repeat(32),receipts=[],display=[];
 const sourceIds=new Set(),createRelay=options=>{sourceIds.add(options.sessionId);return createReplyRelay({...options,connect:()=>conn});};
 const relay=createCodexParagraphForwarder({selectedThreads:['one','two'],finalReplyRoute:'host-relay',createRelay,onReceipt:r=>receipts.push(r),renderEvent:event=>display.push(event.method)});
 async function hear(expected){await tick();const command=s.poll({client});assert.equal(command.action,'speak');assert.equal(command.text,expected);s.accept({client,id:command.id,state:'completed',startObserved:true,elapsedMs:1,localService:true});await tick();}
 try{
  s.enable({client,voice:'injected local voice',rate:1.8});
  // Whitespace may open an HTTP relay, but empty completion must close it.
  for(let n=0;n<80;n++){const id='empty-'+n;relay.onHostEvent(turn('one',id));relay.onHostEvent(item('one','commentary','',false,id));relay.onHostEvent(delta('one','\n\n',id));relay.onHostEvent(item('one','commentary','\n\n',true,id));relay.onHostEvent(turn('one',id,'completed'));await relay.flush();assert.equal(s.queue.status().stream.unfinished,0);assert.equal(s.queue.status().stream.retainedBytes,0);}display.length=0;
  assert.equal(relay.status().automaticDesktopSubscription,false);assert.equal(relay.status().hostForwardingRequired,true);
  relay.onHostEvent(turn('one'));relay.onHostEvent(item('one','commentary'));relay.onHostEvent(delta('one','First progress paragraph.\n\nAn unfinished tail'));
  await relay.flush();assert.deepEqual(display,['turn/started','item/started','item/agentMessage/delta']);assert.equal(receipts.at(-1).state,'admitted');
  // Real HTTP speech admission happens before either item or turn completion.
  await hear('First progress paragraph.');assert.equal(s.queue.status().stream.unfinished,1);
  // Identical host item/turn IDs in another selected chat have distinct delivery IDs.
  relay.onHostEvent(turn('two'));relay.onHostEvent(item('two','partial_answer'));relay.onHostEvent(delta('two','Other chat paragraph.\n\n'));await relay.flush();await hear('Other chat paragraph.');
  assert.equal(sourceIds.size,2);assert([...sourceIds].every(id=>/^codex-[a-f0-9]{24}$/.test(id)));
  relay.onHostEvent(item('one','commentary','First progress paragraph.\n\nAn unfinished tail.',true));await relay.flush();await hear('An unfinished tail.');
  const count=s.queue.status().queue.completed;relay.onHostEvent(item('one','commentary','First progress paragraph.\n\nAn unfinished tail.',true));await relay.flush();assert.equal(receipts.at(-1).state,'duplicate');assert.equal(s.queue.status().queue.completed,count);
  relay.onHostEvent(item('two','partial_answer','Other chat paragraph.\n\n',true));await relay.flush();assert.equal(s.queue.status().queue.completed,count);
  relay.onHostEvent(turn('one','turn','completed'));relay.onHostEvent(turn('two','turn','completed'));await relay.flush();
  // Reasoning, tools and unselected chats never become speech.
  assert.equal(relay.onHostEvent(delta('unselected','Private hidden text.\n\n')).state,'ignored');
  assert.equal(relay.onHostEvent({method:'item/reasoning/textDelta',params:{threadId:'one',turnId:'turn',delta:'Hidden reasoning'}}).state,'ignored');
  relay.onHostEvent(turn('one','unknown-phase'));relay.onHostEvent(item('one',undefined,'',false,'unknown-phase'));relay.onHostEvent(delta('one','Withheld unknown phase.\n\n','unknown-phase'));await relay.flush();assert.equal(s.poll({client}).action,'idle');
  relay.onHostEvent(item('one','final_answer','Authoritative final paragraph.',true,'unknown-phase'));await relay.flush();await hear('Authoritative final paragraph.');
  // Revised prefixes cancel the owned generation; no edited text is replayed.
  relay.onHostEvent(turn('one','revision'));relay.onHostEvent(item('one','final_answer','',false,'revision'));relay.onHostEvent(delta('one','Held incomplete text','revision'));await relay.flush();relay.onHostEvent(item('one','final_answer','Rewritten text.',true,'revision'));await relay.flush();assert(receipts.some(r=>r.code==='authoritative-prefix-revised'));assert.equal(s.queue.status().queue.bytes,0);
  // A failed turn cancels even a sealed but not yet played item.
  relay.onHostEvent(turn('two','failed'));relay.onHostEvent(item('two','commentary','Will be cancelled.',true,'failed'));await relay.flush();await tick();const cancelledSpeech=s.poll({client});assert.equal(cancelledSpeech.action,'speak');
  relay.onHostEvent(turn('two','failed','failed'));await relay.flush();await tick();assert.equal(s.poll({client}).action,'cancel');s.accept({client,id:cancelledSpeech.id,state:'cancelled',startObserved:false,elapsedMs:0,localService:true});await tick();assert.equal(s.queue.status().queue.bytes,0);
  // A provider failure in one selected chat must not stall the other chat.
  relay.onHostEvent(turn('one','provider-failed'));relay.onHostEvent(item('one','commentary','One chat fails.',true,'provider-failed'));await relay.flush();await tick();const broken=s.poll({client});assert.equal(broken.action,'speak');s.accept({client,id:broken.id,state:'failed',startObserved:false,elapsedMs:1,localService:true});await tick();assert.equal(s.queue.status().queue.failed,1);
  relay.onHostEvent(turn('two','independent'));relay.onHostEvent(item('two','partial_answer','Other chat still speaks.',true,'independent'));await relay.flush();await hear('Other chat still speaks.');assert.equal(s.queue.status().queue.failed,1);
  // Stop is shared and authoritative. Forwarding cannot implicitly restart it.
  await request(conn,'/api/stop',{});relay.onHostEvent(turn('two','stopped'));relay.onHostEvent(item('two','final_answer','Must not restart speech.',true,'stopped'));await relay.flush();assert.equal(s.queue.status().stopped,true);assert(receipts.some(r=>r.state==='failed'));
  assert(!JSON.stringify(receipts).includes('First progress paragraph'));assert(!JSON.stringify(relay.status()).includes('Private hidden text'));
  relay.onHostEvent({method:'thread/closed',params:{threadId:'two'}});await relay.flush();assert.equal(relay.onHostEvent(turn('two','after-close')).state,'ignored');
 }finally{await relay.close();s.close();await s.queue.settled();await new Promise(resolve=>s.server.close(resolve));}
 // A slow admission cannot hold the host display callback or grow without bound.
 let release;const gate=new Promise(resolve=>release=resolve),seen=[];const slow=createCodexParagraphForwarder({selectedThreads:['one'],maxPendingEvents:2,maxPendingBytes:20,renderEvent:event=>seen.push(event.method),createRelay:async()=>{await gate;return {id:'synthetic',append:async()=>{},finish:async()=>{},cancel:async()=>{}};}});
 slow.onHostEvent(turn('one'));slow.onHostEvent(item('one','commentary'));slow.onHostEvent(delta('one','A paragraph.\n\n'));await new Promise(resolve=>setImmediate(resolve));
 slow.onHostEvent(delta('one','next'));const refused=slow.onHostEvent(delta('one','x'.repeat(30)));assert.equal(refused.state,'backpressure');assert.equal(seen.length,5);assert(slow.status().pendingBytes<=20);release();await slow.flush();await slow.close();
 // Closed items/turns roll out of the client window during a long host session.
 let issued=0;const long=createCodexParagraphRelay({selectedThreads:['one'],maxItems:4,createRelay:async()=>({id:String(++issued),append:async()=>{},finish:async()=>{},cancel:async()=>{}})});
 for(let n=0;n<300;n++){long.observe(turn('one','t'+n));long.observe(item('one','partial_answer','Supplied completed paragraph.',true,'t'+n));long.observe(turn('one','t'+n,'completed'));await long.flush();assert(long.status().retainedItems<=4);assert(long.status().retiredItems<=256);}assert.equal(issued,300);assert.equal(long.status().failures,0);await long.close();
 // The safe default delegates final answers to the existing completion notifier.
 let finalCalls=0;const finalDefault=createCodexParagraphRelay({selectedThreads:['one'],createRelay:async()=>{finalCalls++;throw Error('unexpected-final-route');}});
 finalDefault.observe(turn('one'));finalDefault.observe(item('one','final_answer'));finalDefault.observe(delta('one','Final paragraph.\n\n'));finalDefault.observe(item('one','final_answer','Final paragraph.\n\n',true));await finalDefault.flush();assert.equal(finalCalls,0);assert.equal(finalDefault.status().finalReplyRoute,'completion-notify');assert.equal(finalDefault.status().finalAnswerStreaming,false);await finalDefault.close();
 // Live cancellation must outlast the 256-entry replay cache during creation.
 for(const path of ['delta','started','completed']){
  let releaseCreate,appends=0,finishes=0,cancels=0;const createGate=new Promise(resolve=>releaseCreate=resolve);
  const race=createCodexParagraphRelay({selectedThreads:['one'],createRelay:async()=>{await createGate;return {id:'late-owned',append:async()=>{appends++;},finish:async()=>{finishes++;},cancel:async()=>{cancels++;}};}});
  race.observe(turn('one','active'));
  if(path==='delta'){race.observe(item('one','commentary','',false,'active'));race.observe(delta('one','Cancelled paragraph.\n\n','active'));}
  else race.observe(item('one','commentary','Cancelled paragraph.\n\n',path==='completed','active'));
  await new Promise(resolve=>setImmediate(resolve));race.observe(turn('one','active','failed'));
  for(let n=0;n<300;n++)race.observe(turn('one','failed-'+n,'failed'));
  releaseCreate();await race.flush();await race.close();assert.equal(appends,0,path);assert.equal(finishes,0,path);assert.equal(cancels,1,path);assert.equal(race.status().failures,0,path);assert.equal(race.status().liveControls,0,path);
 }
 // Queued starts keep their own token while an unrelated item is inflight.
 let releaseHolder;const holderGate=new Promise(resolve=>releaseHolder=resolve),openedSources=[];
 const queued=createCodexParagraphRelay({selectedThreads:['holder','one'],createRelay:async options=>{openedSources.push(options.sessionId);await holderGate;return {id:'held',append:async()=>{},finish:async()=>{},cancel:async()=>{}};}});
 queued.observe(turn('holder','hold'));queued.observe(item('holder','commentary','',false,'hold'));queued.observe(delta('holder','Held paragraph.\n\n','hold'));await new Promise(resolve=>setImmediate(resolve));
 queued.observe(turn('one','queued'));queued.observe(item('one','commentary','Cancelled queued paragraph.',true,'queued'));queued.observe(turn('one','queued','failed'));for(let n=0;n<300;n++)queued.observe(turn('one','later-'+n,'failed'));releaseHolder();await queued.flush();assert.equal(openedSources.length,1);await queued.close();
 // Failure and thread-close issue owned cancellation while append is awaiting.
 for(const closeThread of [false,true]){
  let releaseAppend,cancels=0;const appendGate=new Promise(resolve=>releaseAppend=resolve);
  const inflight=createCodexParagraphRelay({selectedThreads:['one'],createRelay:async()=>({id:'pending',append:async()=>appendGate,finish:async()=>{},cancel:async()=>{cancels++;}})});
  inflight.observe(turn('one'));inflight.observe(item('one','commentary'));inflight.observe(delta('one','Pending paragraph.\n\n'));await new Promise(resolve=>setImmediate(resolve));
  inflight.observe(closeThread?{method:'thread/closed',params:{threadId:'one'}}:turn('one','turn','failed'));await new Promise(resolve=>setImmediate(resolve));assert.equal(cancels,1);releaseAppend();await inflight.flush();await inflight.close();assert.equal(cancels,1);
 }
 // Closing before creation finishes still cancels the late-created owner once.
 let releaseClose,cancelledLate=0,lateAppend=0;const closeGate=new Promise(resolve=>releaseClose=resolve);const late=createCodexParagraphRelay({selectedThreads:['one'],createRelay:async()=>{await closeGate;return {id:'late',append:async()=>{lateAppend++;},finish:async()=>{},cancel:async()=>{cancelledLate++;}};}});
 late.observe(turn('one'));late.observe(item('one','commentary'));late.observe(delta('one','Cancelled.\n\n'));await new Promise(resolve=>setImmediate(resolve));const closing=late.close();releaseClose();await closing;assert.equal(cancelledLate,1);assert.equal(lateAppend,0);
 const cancelReceipts=[];let releaseError;const errorGate=new Promise(resolve=>releaseError=resolve);const uncertain=createCodexParagraphRelay({selectedThreads:['one'],onReceipt:r=>cancelReceipts.push(r),createRelay:async()=>({id:'uncertain',append:async()=>errorGate,finish:async()=>{},cancel:async()=>{throw Error('injected');}})});
 uncertain.observe(turn('one'));uncertain.observe(item('one','commentary'));uncertain.observe(delta('one','Cancelled.\n\n'));await new Promise(resolve=>setImmediate(resolve));uncertain.observe(turn('one','turn','failed'));await new Promise(resolve=>setImmediate(resolve));assert(cancelReceipts.some(r=>r.state==='cancel-unconfirmed'));releaseError();await uncertain.flush();await uncertain.close();
 console.log('PASS: host display-first nonblocking forwarding, real HTTP early paragraphs, public phases, selected cross-chat failure isolation, suffix/duplicate handling, 80 empty inputs, cancellation through cache eviction/queued starts/gated creation and append, late-close cleanup, visible cancellation failure, Stop no restart, bounded backpressure and long-session metadata. Injected browser receipts; no Desktop attachment or hearing claim.');
})().catch(error=>{console.error(error);process.exitCode=1;});
