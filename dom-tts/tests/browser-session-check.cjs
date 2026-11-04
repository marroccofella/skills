const assert=require('node:assert/strict');
const {createSession}=require('../scripts/experimental/browser-session');
const {request}=require('../scripts/browser-speak');
let clock=0;
(async()=>{
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
  await assert.rejects(request({...conn,token:'0'.repeat(64)},'/api/status'),/authentication-required/);
  assert.equal((await request(conn,'/api/status')).provider,'browser-local');await request(conn,'/api/enable',{client,voice:'David',rate:0.9});const live=await request(conn,'/api/speak',{text:'HTTP test'});await request(conn,'/api/receipt',{client,id:live.id,state:'completed',startObserved:true,elapsedMs:5,localService:true});assert.equal((await request(conn,'/api/receipt/'+live.id)).state,'completed');
  assert.deepEqual(await request(conn,'/api/preferences'),{voice:'David',rate:0.9});
  await assert.rejects(request(conn,'/api/speak',{text:'x'.repeat(1001)}),/invalid-text/);
  const foreign=await fetch('http://127.0.0.1:'+conn.port+'/api/status',{headers:{Origin:'https://evil.invalid','x-dom-tts-token':conn.token}});assert.equal(foreign.status,403);
  const html=await fetch('http://127.0.0.1:'+conn.port+'/');assert.match(html.headers.get('content-security-policy'),/connect-src 'self'/);assert.match(await html.text(),/Enable spoken replies/);
 }finally{s.close();await new Promise(resolve=>s.server.close(resolve));}
 console.log('PASS: browser companion admission, ownership, receipts, stop, timeout, disconnect, authentication and origin checks (injected events; no audio claim).');
})().catch(error=>{console.error(error);process.exitCode=1;});
