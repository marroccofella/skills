const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createSession}=require('../scripts/experimental/browser-session');
const {createReplyRelay}=require('../scripts/reply-stream');
const {request}=require('../scripts/browser-speak');
const root=path.resolve(__dirname,'..'),tick=()=>new Promise(r=>setTimeout(r,70));
async function until(test){const deadline=Date.now()+5000;while(Date.now()<deadline){if(test())return;await tick();}throw Error('test-timeout');}
(async()=>{
 const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'manifest.json'))).digest('hex');
 const session=createSession({sourceManifestSha256:hash});await new Promise(r=>session.server.listen(0,'127.0.0.1',r));const conn={port:session.server.address().port,token:session.token},client='b'.repeat(32);
 session.enable({client,voice:'local fixture',rate:0.9});const options={format:'plain',connect:()=>conn};
 const finishAudio=command=>session.accept({client,id:command.id,state:'completed',startObserved:true,elapsedMs:10,localService:true});
 try{
  // Input is not final; real HTTP admission already starts the browser command.
  const relay=await createReplyRelay(options);await relay.append('First sentence. ');await tick();const first=session.poll({client});assert.equal(first.text,'First sentence. ');
  session.accept({client,id:first.id,state:'speaking'});assert.equal((await relay.receipt()).inputSealed,false);
  await relay.append('Second paragraph without punctuation\n\n');assert.equal(session.queue.status().queue.playing,1);assert.equal(session.queue.status().queue.queued,1);
  finishAudio(first);await tick();const second=session.poll({client});assert.equal(second.text,'Second paragraph without punctuation\n\n');finishAudio(second);await tick();assert.equal((await relay.receipt()).terminal,false);
  await relay.append('Last fragment');await relay.finish();await tick();const last=session.poll({client});assert.equal(last.text,'Last fragment');finishAudio(last);await tick();const result=await relay.receipt();assert.equal(result.state,'completed');assert.equal(result.terminal,true);assert.equal(result.segments,3);assert.equal(session.queue.status().stream.retainedBytes,0);
  await assert.rejects(relay.append('No late replay.'),/not-open/);
  // Cancel only this generation, even after an uncertain admission response.
  const kept=await request(conn,'/api/queue/enqueue',{text:'Unrelated supplied message.'});await tick();const owned=await createReplyRelay(options);await owned.append('Owned unfinished sentence. ');await owned.cancel();assert.equal((await request(conn,'/api/queue/receipt',{id:kept.id})).state,'speaking');assert.equal((await owned.receipt()).inputState,'cancelled');finishAudio(session.poll({client}));await tick();
  const before=session.queue.status().queue.bytes;const limited=await createReplyRelay({...options,maxBytes:4});await assert.rejects(limited.append('too much'),/byte-limit/);await limited.cancel();assert.equal(session.queue.status().queue.bytes,before);
  const invalid=await createReplyRelay(options);await assert.rejects(invalid.append('\ud83d'),/invalid-reply-text/);await invalid.cancel();
  const stopped=await createReplyRelay(options);await stopped.append('Stop this active sentence. ');await tick();const active=session.poll({client});await request(conn,'/api/stop',{});session.accept({client,id:active.id,state:'cancelled',startObserved:true,elapsedMs:1,localService:true});await tick();await assert.rejects(stopped.append('Never continue.'),/request-refused/);assert.equal(session.queue.status().stream.retainedBytes,0);assert.equal(session.queue.status().queue.bytes,0);await request(conn,'/api/queue/restart',{});
  const empty=await createReplyRelay(options);await empty.append('  \n');await assert.rejects(empty.finish(),/not-sealable/);await empty.cancel();assert.equal((await empty.receipt()).terminal,true);
  const filtered=await createReplyRelay({...options,format:'markdown'});await filtered.append('---');await filtered.finish();assert.equal((await filtered.receipt()).terminal,true);assert.equal((await filtered.receipt()).segments,0);
  // CLI stdin remains open while actual browser command has started. Split UTF-8
  // byte packets and EOF prove framing, suffix reconciliation and no replay.
  // Scope connection resolution to the test server; retain the real CLI main.
  const fixture=path.join(root,'tests','fixtures','reply-stream-cli.cjs');
  const live=spawn(process.execPath,[fixture,'--format','plain','--wait','true'],{cwd:root,env:{...process.env,DOM_TTS_TEST_PORT:String(conn.port),DOM_TTS_TEST_TOKEN:conn.token},stdio:['pipe','pipe','pipe']});
  let output='',errors='';live.stdout.on('data',c=>output+=c);live.stderr.on('data',c=>errors+=c);const closed=new Promise(r=>live.once('close',(code)=>r(code)));
  await until(()=>output.includes('opened'));const bytes=Buffer.from('CLI first café sentence. ');const accent=bytes.indexOf(Buffer.from('é'));live.stdin.write(bytes.subarray(0,accent+1));await tick();live.stdin.write(bytes.subarray(accent+1));await until(()=>session.poll({client}).action==='speak');const early=session.poll({client});assert.equal(early.text,'CLI first café sentence. ');assert.equal(live.stdin.writableEnded,false);session.accept({client,id:early.id,state:'speaking'});live.stdin.write('CLI second sentence. ');await until(()=>session.queue.status().queue.queued===1);live.stdin.end('Final tail.');await until(()=>output.includes('sealed'));finishAudio(early);await tick();const next=session.poll({client});assert.equal(next.text,'CLI second sentence. ');finishAudio(next);await tick();const tail=session.poll({client});assert.equal(tail.text,'Final tail.');finishAudio(tail);assert.equal(await closed,0);assert.equal(errors,'');assert(!output.includes('café'));assert(output.includes('completed'));assert.equal(session.queue.status().stream.retainedBytes,0);
  await assert.rejects(createReplyRelay({...options,expected:{version:'wrong',sourceManifestSha256:hash}}),/build-mismatch/);
  console.log('PASS: real HTTP sentence/paragraph admission before EOF, ordered concurrent generation, sealed-input receipts, no final replay, owned cancellation, Stop refusal, UTF-8 split CLI input and metadata-only output. Browser events injected; human hearing unconfirmed.');
 }finally{session.close();await session.queue.settled();await new Promise(r=>session.server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
