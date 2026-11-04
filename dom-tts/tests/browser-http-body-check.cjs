const assert=require('node:assert/strict'),http=require('node:http');
const {createSession}=require('../scripts/experimental/browser-session'),{request}=require('../scripts/browser-speak');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const session=createSession(),client='e'.repeat(32);session.enable({client,voice:'Hélène',rate:.9});await new Promise(r=>session.server.listen(0,'127.0.0.1',r));const conn={port:session.server.address().port,token:session.token};
 const post=(body,split)=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:conn.port,path:'/api/speak',method:'POST',headers:{'content-type':'application/json','x-dom-tts-token':conn.token}},res=>{const parts=[];res.on('data',c=>parts.push(c));res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(parts).toString('utf8'))}));});req.on('error',reject);req.write(body.subarray(0,split));setTimeout(()=>req.end(body.subarray(split)),20);});
 try{
  const body=Buffer.from(JSON.stringify({text:'A café in Zürich.'})),split=body.indexOf(Buffer.from('é'))+1,result=await post(body,split);assert.equal(result.status,202);assert.equal(session.poll({client}).text,'A café in Zürich.');session.accept({client,id:result.data.id,state:'completed',startObserved:true,elapsedMs:1,localService:true});
  const malformed=Buffer.concat([Buffer.from('{"text":"'),Buffer.from([0xc3,0x28]),Buffer.from('"}')]);assert.equal((await post(malformed,10)).status,400);assert.equal(session.status().active,null);
  // An incomplete authenticated upload is cancelled by global Stop, never admitted later.
  const slow=http.request({hostname:'127.0.0.1',port:conn.port,path:'/api/speak',method:'POST',headers:{'content-type':'application/json','x-dom-tts-token':conn.token}});const closed=new Promise(r=>slow.once('close',r));slow.on('error',()=>{});slow.write('{"text":"late');await delay(30);await request(conn,'/api/stop',{});await Promise.race([closed,delay(1000).then(()=>{throw Error('pending-upload-not-cancelled');})]);assert.equal(session.status().active,null);assert.equal(session.queue.status().queue.bytes,0);assert.equal(session.queue.status().stream.retainedBytes,0);
  const fresh=await request(conn,'/api/speak',{text:'Fresh explicit request.'});assert.equal(session.poll({client}).text,'Fresh explicit request.');session.accept({client,id:fresh.id,state:'completed',startObserved:true,elapsedMs:1,localService:true});
 }finally{session.close();session.server.closeAllConnections?.();await new Promise(r=>session.server.close(r));}
 // The CLI response reader also preserves split UTF-8 and refuses malformed UTF-8.
 let invalid=false;const responseServer=http.createServer((req,res)=>{const body=invalid?Buffer.from([0x7b,0x22,0xc3,0x28,0x22,0x7d]):Buffer.from(JSON.stringify({voice:'Hélène'}));const at=invalid?3:body.indexOf(Buffer.from('é'))+1;res.writeHead(200,{'Content-Type':'application/json'});res.write(body.subarray(0,at));setTimeout(()=>res.end(body.subarray(at)),20);});await new Promise(r=>responseServer.listen(0,'127.0.0.1',r));
 try{const connection={port:responseServer.address().port,token:'fixture'};assert.equal((await request(connection,'/api/status')).voice,'Hélène');invalid=true;await assert.rejects(request(connection,'/api/status'));}finally{await new Promise(r=>responseServer.close(r));}
 console.log('PASS: actual loopback split UTF-8 in both directions, malformed UTF-8 refusal, Stop cancels incomplete upload, fresh explicit request; injected receipts, no audio claim.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
