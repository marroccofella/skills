const assert=require('node:assert/strict');
const {createBrowserQueue}=require('../scripts/experimental/browser-queue');
const {applyMode}=require('../scripts/summarize');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(sessions=['manual']){let serial=0,automatic=true;const receipts=new Map(),played=[];const queue=createBrowserQueue({sessions,transport:{status:()=>({connected:true}),submit({text}){const id=String(++serial);played.push(text);receipts.set(id,{state:automatic?'completed':'queued'});return{id};},receipt:id=>receipts.get(id),stopOwned:id=>receipts.set(id,{state:'cancelled'})}});return {queue,played,receipts,setAutomatic:value=>{automatic=value;}};}
const base=(sessionId,messageId)=>({schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',sessionId,turnId:'shared-turn',generationId:'shared-generation',messageId,format:'plain'});
const submit=(queue,b,text)=>{queue.command('event',{...b,kind:'start',sequence:0});return queue.command('event',{...b,kind:'complete',sequence:1,text});};
(async()=>{
 // Reproduce a normal burst while playback is paused: all retained unsaid input
 // must drain when capacity recovers, and partial admission cannot mean completion.
 const f=fixture();try{
  f.queue.command('pause');assert.equal(f.queue.status().admission.state,'paused');const texts=[],ids=[];
  for(let i=0;i<12;i++){const text=('Paragraph '+i+'. ').repeat(400).slice(0,5900);texts.push(applyMode(text,'informative'));ids.push(f.queue.command('enqueue',{text}).id);}
  assert(f.queue.status().stream.pending>0);assert.equal(f.queue.command('receipt',{id:ids.at(-1)}).state,'queued');assert.equal(f.queue.command('receipt',{id:ids.at(-1)}).terminal,false);
  f.queue.command('resume');assert.equal(f.queue.status().admission.state,'backpressure');await f.queue.settled();
  assert.equal(f.queue.status().stream.pending,0);assert.equal(f.queue.status().stream.retainedBytes,0);assert.equal(f.queue.status().queue.bytes,0);assert.equal(f.queue.status().admission.state,'ready');assert.equal(f.queue.command('receipt',{id:ids.at(-1)}).state,'completed');
  assert.equal(f.played.join(''),texts.join(''));assert(f.played.length>128);assert(f.queue.status().queue.completed<=128);
 }finally{f.queue.close();await f.queue.settled();}
 // Text from newer messages in the same generation cannot overtake a retained
 // tail, or seal that predecessor before its unsaid segments have been admitted.
 const shared=fixture();try{
  shared.queue.command('pause');const texts=[];
  for(let i=0;i<12;i++){const text=('Shared message '+i+'. ').repeat(330).slice(0,5800);texts.push(text);submit(shared.queue,base('manual','message-'+i),text);}
  assert(shared.queue.status().stream.pending>0);shared.queue.command('resume');await shared.queue.settled();assert.equal(shared.played.join(''),texts.join(''));assert.equal(shared.queue.status().stream.pending,0);
 }finally{shared.queue.close();await shared.queue.settled();}
 // Same display/message identity in two explicitly selected chats must never mix
 // their receipts. One is playing, the other remains an open, silent producer.
 const selected=fixture(['chat-a','chat-b']);try{
  const a=base('chat-a','same-message'),b=base('chat-b','same-message');submit(selected.queue,a,'Chat A sentence.');selected.queue.command('event',{...b,kind:'start',sequence:0});await selected.queue.settled();
  const receiptA=selected.queue.command('reply-receipt',a),receiptB=selected.queue.command('reply-receipt',b);assert.equal(receiptA.terminal,true);assert.equal(receiptA.state,'completed');assert.equal(receiptB.terminal,false);assert.notEqual(receiptB.state,'completed');assert.equal(receiptB.segments,0);
  submit(selected.queue,base('chat-a','another-message'),'Chat A second sentence.');selected.queue.command('event',{...b,kind:'complete',sequence:1,text:'Chat B sentence.'});await selected.queue.settled();assert(selected.played.includes('Chat B sentence.'));
 }finally{selected.queue.close();await selected.queue.settled();}
 // A single input larger than its entire segment receipt window is refused
 // before any part of this event is admitted. A smaller correction remains valid.
 const bounded=fixture();try{
  const b=base('manual','oversized');bounded.queue.command('event',{...b,kind:'start',sequence:0});assert.throws(()=>bounded.queue.command('event',{...b,kind:'complete',sequence:1,text:'a'.repeat(60000)}),/reply-segment-limit/);assert.equal(bounded.queue.status().stream.retainedBytes,0);assert.equal(bounded.played.length,0);
  bounded.queue.command('event',{...b,kind:'complete',sequence:1,text:'Small correction.'});await bounded.queue.settled();assert.deepEqual(bounded.played,['Small correction.']);
  bounded.queue.command('stop');assert.equal(bounded.queue.status().admission.state,'stopped');assert.throws(()=>bounded.queue.command('enqueue',{text:'Do not implicitly restart.'}));
 }finally{bounded.queue.close();await bounded.queue.settled();}
 // An unexpected external playback stop also revokes retained producer tails;
 // the admission-drain hook must never leave or restart that text implicitly.
 const external=fixture();try{
  const b=base('manual','external-stop');external.queue.command('event',{...b,kind:'start',sequence:0});external.queue.command('event',{...b,kind:'delta',sequence:1,text:'First sentence. '});await external.queue.settled();
  // fixture receipts normally complete; use an explicit transport cancellation
  // for a newly playing segment and retain a suffix while it is unsettled.
  external.setAutomatic(false);external.queue.command('event',{...b,kind:'delta',sequence:2,text:'Second sentence. '});await tick();external.queue.command('event',{...b,kind:'delta',sequence:3,text:'Unsaid fragment'});external.receipts.set('2',{state:'cancelled'});await new Promise(r=>setTimeout(r,70));
  assert.equal(external.queue.status().stopped,true);assert.equal(external.queue.status().stream.retainedBytes,0);assert.equal(external.queue.status().stream.pending,0);assert.equal(external.queue.status().selectedSessions.length,0);
 }finally{external.queue.close();await external.queue.settled();}
 await tick();console.log('PASS: retained paragraph burst drains past128 segments without replay/drop, partial receipts remain nonterminal, shared-generation FIFO, selected-chat receipt isolation, atomic oversize refusal, bounded memory and Stop. Injected playback only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
