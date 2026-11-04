const assert=require('node:assert/strict');
const {createBrowserQueue}=require('../scripts/experimental/browser-queue');
const {createSession}=require('../scripts/experimental/browser-session');
const {request}=require('../scripts/browser-speak');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){let serial=0,completed=true;const receipts=new Map(),played=[];const queue=createBrowserQueue({transport:{status:()=>({connected:true}),submit({text}){const id=String(++serial);played.push(text);receipts.set(id,{state:completed?'completed':'queued'});return {id};},receipt:id=>receipts.get(id),stopOwned(id){receipts.set(id,{state:'cancelled'});}}});return {queue,played,receipts,setAutomatic:value=>{completed=value;}};}
const base=id=>({schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',sessionId:'manual',turnId:id,generationId:id,messageId:id,format:'plain'});
(async()=>{
 const f=fixture();try{
  const oldest=base('oldest');f.queue.command('event',{...oldest,kind:'start',sequence:0});f.queue.command('event',{...oldest,kind:'complete',sequence:1,text:'Only once.'});await f.queue.settled();
  for(let i=0;i<46;i++){f.queue.command('enqueue',{text:'Fill retained history.'});await f.queue.settled();}
  const threshold=base('threshold');f.queue.command('event',{...threshold,kind:'start',sequence:0});
  assert.equal(f.queue.command('event',{...oldest,kind:'start',sequence:0}).state,'duplicate');assert.equal(f.played.filter(x=>x==='Only once.').length,1);
  f.queue.command('event',{...threshold,kind:'complete',sequence:1,text:'Threshold paragraph.'});await f.queue.settled();
  let previous;
  for(let i=0;i<1500;i++){
   if(i%2===0){const b=base('message-'+i);f.queue.command('event',{...b,kind:'start',sequence:0});f.queue.command('event',{...b,kind:'complete',sequence:1,text:'First segment. '+('Another word. '.repeat(40))});previous=b;}
   else f.queue.command('enqueue',{text:'A supplied progress paragraph.'});
   await f.queue.settled();await tick();const status=f.queue.status();assert(status.stream.messages<=64);assert.equal(status.queue.bytes,0);assert(status.queue.completed<=128);
  }
  assert(f.played.length>1500);assert.equal(f.queue.command('event',{...previous,kind:'start',sequence:0}).state,'duplicate');
  // Detailed receipts roll away, but recent retired identities must not replay.
  const b=base('retired-message');f.queue.command('event',{...b,kind:'start',sequence:0});f.queue.command('event',{...b,kind:'complete',sequence:1,text:'Do not replay.'});await f.queue.settled();
  for(let i=0;i<70;i++){f.queue.command('enqueue',{text:'New supplied paragraph.'});await f.queue.settled();}
  const count=f.played.length;assert.throws(()=>f.queue.command('event',{...b,kind:'start',sequence:0}),/history-expired/);assert.equal(f.played.length,count);
  // A still-open producer survives compaction and can append its unsaid tail.
  const open=base('still-open');f.queue.command('event',{...open,kind:'start',sequence:0});f.queue.command('event',{...open,kind:'delta',sequence:1,text:'Open sentence. '});await f.queue.settled();
  for(let i=0;i<100;i++){f.queue.command('enqueue',{text:'Other paragraph.'});await f.queue.settled();}
  f.queue.command('event',{...open,kind:'complete',sequence:2,text:'Open sentence. Final tail.'});await f.queue.settled();assert.equal(f.played.filter(x=>x==='Open sentence. ').length,1);assert(f.played.includes('Final tail.'));
  f.queue.command('stop');assert.throws(()=>f.queue.command('enqueue',{text:'No restart.'}));f.queue.command('restart');assert.equal(f.queue.status().stream.messages,0);
 }finally{f.queue.close();await f.queue.settled();}
 const pending=fixture();try{
  pending.queue.command('pause');for(let i=0;i<64;i++)pending.queue.command('enqueue',{text:'Pending paragraph '+i+'.'});
  assert.throws(()=>pending.queue.command('enqueue',{text:'Too many unfinished messages.'}),/browser-history-full/);assert.equal(pending.queue.status().queue.queued,64);assert.equal(pending.played.length,0);
 }finally{pending.queue.close();await pending.queue.settled();}
 const failed=fixture();try{
  failed.setAutomatic(false);failed.queue.command('enqueue',{text:'Must remain failed.'});await tick();failed.receipts.set('1',{state:'failed'});await new Promise(r=>setTimeout(r,70));
  for(let i=0;i<63;i++)failed.queue.command('enqueue',{text:'Waiting behind failure.'});assert.equal(failed.queue.status().queue.failed,1);assert.equal(failed.played.length,1);assert.throws(()=>failed.queue.command('enqueue',{text:'Cannot evict failed work.'}),/browser-history-full/);
 }finally{failed.queue.close();await failed.queue.settled();}
 // Cross the old ceiling through real HTTP admission and browser receipt routes.
 const s=createSession({leaseMs:600000});await new Promise(r=>s.server.listen(0,'127.0.0.1',r));const client='b'.repeat(32),conn={port:s.server.address().port,token:s.token};
 try{s.enable({client,voice:'injected local voice',rate:1.8});for(let i=0;i<80;i++){
  const job=await request(conn,'/api/queue/enqueue',{text:'Supplied HTTP paragraph '+i+'.'});await tick();const speech=s.poll({client});assert.equal(speech.action,'speak');
  s.accept({client,id:speech.id,state:'completed',startObserved:true,localService:true,elapsedMs:1});await s.queue.settled();assert.equal((await request(conn,'/api/queue/receipt',{id:job.id})).state,'completed');
 }}finally{s.close();await s.queue.settled();await new Promise(r=>s.server.close(r));}
 console.log('PASS: 1500 sequential supplied messages across message/segment history bounds, bounded rolling receipts, recent retired replay refusal, live-stream preservation, stopped refusal, pending/failed work protected. Injected playback, no hearing claim.');
})().catch(e=>{console.error(e);process.exitCode=1;});
