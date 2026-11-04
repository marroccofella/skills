const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {createControls}=require('../scripts/experimental/control-server');
(async()=>{
 const launched=[];let release,fail=false;
 const controls=createControls({dir:path.resolve(os.tmpdir(),'not-used-control-fixture'),sessions:['manual','selected'],doctorQuery:async()=>({voices:['Fixture voice'],playback:{state:'blocked'}}),playerFactory:()=>async(text,{signal})=>{
  launched.push(text);if(fail){fail=false;throw Error('PRIVATE_PROVIDER_ERROR');}
  await new Promise(resolve=>{release=resolve;signal.addEventListener('abort',resolve,{once:true});});return {state:signal.aborted?'stopped':'completed'};
 }});
 await new Promise(resolve=>controls.server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+controls.server.address().port;
 const request=async(route,data,headers={})=>{const res=await fetch(url+route,{method:data===undefined?'GET':'POST',headers:{'x-dom-tts-token':controls.token,...(data===undefined?{}:{'content-type':'application/json'}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});const body=await res.json();return {status:res.status,body};};
 try{
  assert.equal((await fetch(url+'/')).status,200);
  assert.equal((await fetch(url+'/api/status')).status,401);
  assert.equal((await request('/api/status',undefined,{'x-dom-tts-token':'é'.repeat(64)})).status,401);
  assert.equal((await request('/api/status',undefined,{origin:'https://foreign.example'})).status,403);
  const foreignHost=await new Promise((resolve,reject)=>{const req=require('node:http').get(url+'/api/status',{headers:{Host:'foreign.example','x-dom-tts-token':controls.token}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(foreignHost,403);
  assert.equal((await request('/api/voices')).body.playback.state,'blocked');
  assert.equal((await request('/api/speak',{sessionId:'foreign',text:'Must not speak'})).status,400);
  assert.equal((await request('/api/pause',{})).status,202);
  await request('/api/speak',{sessionId:'manual',text:'Public first sentence.'});await request('/api/speak',{sessionId:'selected',text:'Public second sentence.'});
  assert.equal(launched.length,0);assert.equal((await request('/api/status')).body.queue.queued,2);
  await request('/api/resume',{});assert.equal(launched.length,1);
  // HTTP admission/status remains responsive while injected playback is held.
  assert.equal((await request('/api/status')).body.queue.playing,1);
  assert.equal((await request('/api/settings',{speed:1.2})).status,400);
  await request('/api/skip',{});await new Promise(r=>setImmediate(r));assert.equal(launched.length,2);
  assert.equal((await request('/api/status')).body.queue.cancelled,1);
  await request('/api/stop',{});await new Promise(r=>setImmediate(r));assert.equal((await request('/api/status')).body.queue.cancelled,2);
  assert.equal((await request('/api/speak',{sessionId:'manual',text:'No automatic restart.'})).status,400);
  await request('/api/restart',{});await request('/api/settings',{speed:1.2});assert.equal((await request('/api/status')).body.settings.speed,1.2);
  assert.equal((await request('/api/settings',{endpoint:'https://unapproved.example'})).status,400);
  fail=true;await request('/api/speak',{sessionId:'manual',text:'Public retry fixture.'});await new Promise(r=>setImmediate(r));assert.equal((await request('/api/status')).body.queue.failed,1);
  assert.equal((await request('/api/retry',{})).body.retried,1);release();await new Promise(r=>setImmediate(r));assert.equal((await request('/api/status')).body.queue.completed,1);
  assert(!JSON.stringify((await request('/api/status')).body).includes('Public retry fixture'));
  assert.equal((await request('/api/speak',{sessionId:'manual',text:'x'.repeat(70000)})).status,400);
  console.log('PASS: real loopback HTTP auth/origin/host bounds, responsive admission, selected-session controls, boundary pause/resume, skip, stop/restart, settings and explicit failed retry; injected player, no audio');
 }finally{await controls.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
