const assert=require('node:assert/strict');
const {createBrowserQueue}=require('../scripts/experimental/browser-queue');
const {createSession}=require('../scripts/experimental/browser-session');
const {request}=require('../scripts/browser-speak');
const tick=()=>new Promise(r=>setImmediate(r));
const base=sessionId=>({schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',sessionId,turnId:'turn',generationId:'generation',messageId:'message',format:'plain'});
function fixture(){let serial=0,automatic=true;const receipts=new Map(),played=[];const queue=createBrowserQueue({transport:{status:()=>({connected:true}),submit({text}){const id=String(++serial);played.push(text);receipts.set(id,{state:automatic?'completed':'queued'});return{id};},receipt:id=>receipts.get(id),stopOwned:id=>receipts.set(id,{state:'cancelled'})}});return{queue,played,receipts,manual:()=>{automatic=false;},automatic:()=>{automatic=true;}};}
(async()=>{
 const rolling=fixture();try{
  for(let i=0;i<240;i++){const sessionId='supplied-chat-'+i;const result=rolling.queue.command('select-source',{sessionId});assert.equal(result.state,'source-selected');assert(result.selectedSources<=32);const b=base(sessionId);rolling.queue.command('event',{...b,kind:'start',sequence:0});rolling.queue.command('event',{...b,kind:'complete',sequence:1,text:'Supplied paragraph '+i+'.'});await rolling.queue.settled();}
  assert.equal(rolling.played.length,240);assert(rolling.queue.status().selectedSessions.length<=32);assert(rolling.queue.status().stream.messages<=64);assert.equal(rolling.queue.status().queue.bytes,0);
  assert(rolling.queue.status().selectedSessions.includes('manual'));rolling.queue.command('enqueue',{text:'The original manual source still works.'});await rolling.queue.settled();assert(rolling.played.includes('The original manual source still works.'));
  assert.throws(()=>rolling.queue.command('event',{...base('not-registered'),kind:'start',sequence:0}),/session not selected/);
 }finally{rolling.queue.close();await rolling.queue.settled();}
 const isolated=fixture();try{
  isolated.queue.command('select-source',{sessionId:'failed-chat'});isolated.manual();isolated.queue.command('enqueue',{sessionId:'failed-chat',text:'Fail only this supplied chat.'});await tick();isolated.receipts.set('1',{state:'failed'});await new Promise(r=>setTimeout(r,70));assert.equal(isolated.queue.status().admission.state,'blocked-failure');
  isolated.automatic();isolated.queue.command('select-source',{sessionId:'healthy-chat'});isolated.queue.command('enqueue',{sessionId:'healthy-chat',text:'A healthy chat still speaks.'});await isolated.queue.settled();assert(isolated.played.includes('A healthy chat still speaks.'));assert.equal(isolated.queue.status().queue.failed,1);
  for(let i=0;i<60;i++){const sessionId='new-chat-'+i;isolated.queue.command('select-source',{sessionId});isolated.queue.command('enqueue',{sessionId,text:'Fresh paragraph.'});await isolated.queue.settled();}
  assert(isolated.queue.status().selectedSessions.includes('failed-chat'));assert.equal(isolated.queue.status().queue.failed,1);
 }finally{isolated.queue.close();await isolated.queue.settled();}
 const full=fixture();try{
  full.queue.command('event',{...base('manual'),kind:'start',sequence:0});for(let i=0;i<31;i++){const sessionId='open-chat-'+i;full.queue.command('select-source',{sessionId});full.queue.command('event',{...base(sessionId),kind:'start',sequence:0});}
  assert.equal(full.queue.status().selectedSessions.length,32);assert.throws(()=>full.queue.command('select-source',{sessionId:'no-eviction'}),/browser-source-capacity/);assert.equal(full.queue.status().stream.messages,32);
  full.queue.command('stop');assert.throws(()=>full.queue.command('select-source',{sessionId:'no-auto-restart'}),/restart-required/);assert.equal(full.queue.status().stream.retainedBytes,0);full.queue.command('restart');assert.equal(full.queue.command('select-source',{sessionId:'explicitly-restarted'}).state,'source-selected');
 }finally{full.queue.close();await full.queue.settled();}
 // Registration uses the existing token-authenticated HTTP route. An identity
 // supplies scheduler isolation only; knowing it alone never authenticates.
 const s=createSession(),client='d'.repeat(32);await new Promise(r=>s.server.listen(0,'127.0.0.1',r));const conn={port:s.server.address().port,token:s.token};
 try{s.enable({client,voice:'injected local voice',rate:1.8});await assert.rejects(request({...conn,token:'a'.repeat(64)},'/api/queue/select-source',{sessionId:'supplied-chat'}),/authentication-required/);assert.equal((await request(conn,'/api/queue/select-source',{sessionId:'supplied-chat'})).state,'source-selected');await assert.rejects(request(conn,'/api/queue/select-source',{sessionId:'bad source'}),/invalid-source-identity/);await request(conn,'/api/stop',{});await assert.rejects(request(conn,'/api/queue/select-source',{sessionId:'still-stopped'}),/restart-required/);
 }finally{s.close();await s.queue.settled();await new Promise(r=>s.server.close(r));}
 console.log('PASS: authenticated explicit scheduler registration, 240 sequential supplied chats with32-source bound, failed-chat isolation, idle-only source retirement, open/failed source preservation, unselected refusal and authoritative Stop. Injected playback; no chat discovery or hearing claim.');
})().catch(error=>{console.error(error);process.exitCode=1;});
