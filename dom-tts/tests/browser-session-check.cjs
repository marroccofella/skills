const assert=require('node:assert/strict');
const {createSession}=require('../scripts/experimental/browser-session');
const {request}=require('../scripts/browser-speak');
let clock=0;
(async()=>{
 {
  let ackClock=1000;const late=createSession({leaseMs:50,deadlineMs:20,now:()=>ackClock}),owner='c'.repeat(32),foreign='d'.repeat(32),settled=[];
  try{
   late.enable({client:owner,voice:'local fixture',rate:1});
   for(const state of ['completed','cancelled','failed']){const item=late.submit({text:'owned terminal fixture'});late.accept({client:owner,id:item.id,state,startObserved:true,elapsedMs:3,localService:true});settled.push(item.id);}
   ackClock+=10;
   for(const id of settled){const before=late.status(),receipt=late.receipt(id);assert.deepEqual(late.accept({client:owner,id,state:'speaking'}),{accepted:true,duplicate:true});assert.deepEqual(late.status(),before);assert.deepEqual(late.receipt(id),receipt);}
   const overdue=late.submit({text:'deadline acknowledgement fixture'});ackClock+=21;assert.equal(late.receipt(overdue.id).state,'failed');const overdueBefore=late.status();assert.deepEqual(late.accept({client:owner,id:overdue.id,state:'speaking'}),{accepted:true,duplicate:true});assert.deepEqual(late.status(),overdueBefore);late.accept({client:owner,id:overdue.id,state:'cancelled',startObserved:false,elapsedMs:21,localService:true});assert.equal(late.receipt(overdue.id).state,'failed');assert.equal(late.status().active,null);
   const disconnected=late.submit({text:'expired lease acknowledgement fixture'});ackClock+=51;assert.equal(late.receipt(disconnected.id).state,'failed');const disconnectedBefore=late.status();assert.equal(disconnectedBefore.connected,false);assert.deepEqual(late.accept({client:owner,id:disconnected.id,state:'speaking'}),{accepted:true,duplicate:true});assert.deepEqual(late.status(),disconnectedBefore);assert.equal(late.poll({client:owner}).action,'cancel');late.accept({client:owner,id:disconnected.id,state:'cancelled',startObserved:false,elapsedMs:51,localService:true});assert.equal(late.receipt(disconnected.id).state,'failed');assert.equal(late.poll({client:owner}).action,'idle');assert.equal(late.status().connected,true);
   const current=late.submit({text:'different active fixture'}),before=late.status();
   assert.deepEqual(late.accept({client:owner,id:settled[0],state:'speaking'}),{accepted:true,duplicate:true});assert.deepEqual(late.status(),before);assert.equal(late.status().active.id,current.id);assert.equal(late.status().active.state,'queued');
   assert.throws(()=>late.accept({client:foreign,id:settled[0],state:'speaking'}),/stale/);assert.throws(()=>late.accept({client:owner,id:'f'.repeat(32),state:'speaking'}),/stale/);assert.throws(()=>late.accept({client:owner,id:settled[0],state:'unknown'}),/stale/);
   late.globalStop();late.accept({client:owner,id:current.id,state:'cancelled',startObserved:false,elapsedMs:1,localService:true});const stopped=late.status();assert.deepEqual(late.accept({client:owner,id:settled[0],state:'speaking'}),{accepted:true,duplicate:true});assert.deepEqual(late.status(),stopped);assert.equal(late.queue.status().stopped,true);
   late.disable({client:owner});assert.throws(()=>late.accept({client:owner,id:settled[0],state:'speaking'}),/stale/);assert.equal(late.status().connected,false);
  }finally{late.close();}
 }
 const s=createSession({leaseMs:25,deadlineMs:15,now:()=>clock}),client='a'.repeat(32),other='b'.repeat(32);
 assert.throws(()=>s.submit({text:'private test'}),/not-connected/);s.enable({client,voice:'local David',rate:0.9});assert.throws(()=>s.enable({client:other,voice:'local',rate:1}),/already-connected/);
 clock+=30;assert.equal(s.status().connected,false);assert.deepEqual(s.poll({client}),{action:'idle',reconnected:true});assert.equal(s.status().connected,true);assert.equal(s.poll({client:other}).action,'disconnect');
 const job=s.submit({text:'private test'});assert.throws(()=>s.submit({text:'overlap'}),/busy/);assert.equal(s.poll({client:other}).action,'disconnect');assert.equal(s.poll({client}).text,'private test');assert(!JSON.stringify(s.status()).includes('private test'));
 assert.throws(()=>s.accept({client:other,id:job.id,state:'speaking'}),/stale/);s.accept({client,id:job.id,state:'speaking'});s.stop();assert.equal(s.poll({client}).action,'cancel');s.accept({client,id:job.id,state:'cancelled',startObserved:true,elapsedMs:10,localService:true});assert.equal(s.receipt(job.id).cancelRequested,true);assert.equal(s.receipt(job.id).state,'cancelled');assert(!JSON.stringify(s.receipt(job.id)).includes('private test'));
 const clearing=s.submit({text:'SUPPLIED_STOP_PRIVACY_SENTINEL'});s.stop();const cancel=s.poll({client});assert.equal(cancel.action,'cancel');assert.equal(cancel.text,null);assert(!JSON.stringify(cancel).includes('SUPPLIED_STOP_PRIVACY_SENTINEL'));assert.throws(()=>s.submit({text:'No overlap before acknowledgement'}),/busy/);s.accept({client,id:clearing.id,state:'cancelled',startObserved:false,elapsedMs:1,localService:true});
 const timeout=s.submit({text:'timeout'});clock+=18;assert.equal(s.receipt(timeout.id).code,'speech-timeout');assert.equal(s.poll({client}).action,'cancel');assert.throws(()=>s.submit({text:'not settled'}),/busy/);s.accept({client,id:timeout.id,state:'cancelled',startObserved:false,elapsedMs:18,localService:true});assert.equal(s.receipt(timeout.id).state,'failed');
 s.enable({client,voice:'local David',rate:0.9});const lost=s.submit({text:'disconnect'});clock+=30;assert.equal(s.status().connected,false);assert.equal(s.receipt(lost.id).code,'browser-disconnected');assert.throws(()=>s.submit({text:'lost'}),/not-connected/);assert.equal(s.poll({client}).action,'cancel');s.accept({client,id:lost.id,state:'cancelled',startObserved:false,elapsedMs:30,localService:true});s.enable({client,voice:'local David',rate:0.9});s.disable({client});assert.equal(s.status().connected,false);
 assert.equal(s.poll({client}).action,'disconnect');assert.throws(()=>s.submit({text:'no reenable'}),/not-connected/);s.enable({client:other,voice:'local Zira',rate:1.1});assert.equal(s.poll({client}).action,'disconnect');assert.deepEqual(s.getPreferences(),{voice:'local Zira',rate:1.1});s.disable({client:other});
 await new Promise(resolve=>s.server.listen(0,'127.0.0.1',resolve));const conn={port:s.server.address().port,token:s.token};try{
  await assert.rejects(request({...conn,token:'0'.repeat(64)},'/api/status'),/browser-server-identity-unverified/);
  assert.equal((await request(conn,'/api/status')).provider,'browser-local');await request(conn,'/api/enable',{client,voice:'David',rate:0.9});const live=await request(conn,'/api/speak',{text:'HTTP test'});await request(conn,'/api/receipt',{client,id:live.id,state:'completed',startObserved:true,elapsedMs:5,localService:true});assert.equal((await request(conn,'/api/receipt/'+live.id)).state,'completed');
  assert.deepEqual(await request(conn,'/api/receipt',{client,id:live.id,state:'speaking'}),{accepted:true,duplicate:true});
  await assert.rejects(request(conn,'/api/receipt',{client:other,id:live.id,state:'speaking'}),/stale/);await assert.rejects(request(conn,'/api/receipt',{client,id:'f'.repeat(32),state:'speaking'}),/stale/);
  assert.deepEqual(await request(conn,'/api/preferences'),{voice:'David',rate:0.9});
  await assert.rejects(request(conn,'/api/speak',{text:'x'.repeat(1001)}),/invalid-text/);
  const foreign=await fetch('http://127.0.0.1:'+conn.port+'/api/status',{headers:{Origin:'https://evil.invalid','x-dom-tts-token':conn.token}});assert.equal(foreign.status,403);
  const html=await fetch('http://127.0.0.1:'+conn.port+'/');assert.match(html.headers.get('content-security-policy'),/connect-src 'self'/);const page=await html.text();assert.match(page,/Enable spoken replies/);assert(page.includes('Dom TTS '+require('../package.json').version));assert(!page.includes('{{DOM_TTS_VERSION}}'));
 }finally{s.close();await new Promise(resolve=>s.server.close(resolve));}
 console.log('PASS: browser companion admission, ownership, receipts, stop, timeout, disconnect, authentication and origin checks (injected events; no audio claim).');
})().catch(error=>{console.error(error);process.exitCode=1;});
