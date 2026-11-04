const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parseEvent,narrate,summarize}=require('../scripts/codex-notify');
const root=path.resolve(__dirname,'..'),manifest=require('../scripts/package').verify(root),hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'manifest.json'))).digest('hex');
const payload=(turn='turn')=>JSON.stringify({type:'agent-turn-complete','thread-id':'thread','turn-id':turn,'last-assistant-message':'A supplied final reply.','input-messages':['PRIVATE_PROMPT_CANARY'],transcript_path:'C:/do-not-read/transcript.jsonl'});
(async()=>{
 assert.deepEqual(parseEvent(payload()),{thread:'thread',turn:'turn',text:'A supplied final reply.'});assert.equal(parseEvent('{"type":"approval-requested"}'),null);assert.throws(()=>parseEvent('x'.repeat(262145)),/large/);assert.throws(()=>parseEvent('{"type":"agent-turn-complete"}'),/identity/);
 for(const text of ['{"title":"A metadata title"}','<heartbeat><automation_id>x</automation_id><decision>DONT_NOTIFY</decision><message>Silent</message></heartbeat>'])assert.equal(parseEvent(JSON.stringify({...JSON.parse(payload()),'last-assistant-message':text})),null);
 assert(summarize('A supplied sentence. '.repeat(1000)).length<=1000);
 const calls=[],events=new Map();let stopped=false;const send=async(conn,route,data)=>{
  calls.push({route,data});if(route==='/api/status')return {connected:true,version:manifest.version,sourceManifestSha256:hash};if(route==='/api/queue/status')return {stopped};
  if(route==='/api/queue/select-source'){assert.match(data.sessionId,/^codex-[a-f0-9]{24}$/);return {state:'source-selected'};}
  const key=JSON.stringify([data.messageId,data.sequence]);if(events.has(key)){assert.deepEqual(events.get(key),data);return {state:'duplicate'};}events.set(key,data);return {state:data.kind==='start'?'streaming':'sealed'};
 };
 const options={root,connect:()=>({}),send};const first=await narrate(payload(),options);assert.equal(first.state,'queued');assert.equal(first.completed,false);assert.equal((await narrate(payload(),options)).state,'duplicate');assert.equal((await narrate(payload('other-turn'),options)).state,'queued');
 assert(!JSON.stringify(calls).includes('PRIVATE_PROMPT_CANARY'));assert(!JSON.stringify(calls).includes('do-not-read'));stopped=true;const before=calls.length;assert.equal((await narrate(payload('stopped'),options)).state,'silenced');assert.equal(calls.length-before,2);
 await assert.rejects(narrate(payload(),{...options,send:async()=>({connected:false})}),/not-connected/);
 await assert.rejects(narrate(payload(),{...options,send:async()=>({connected:true,version:'wrong',sourceManifestSha256:hash})}),/build-mismatch/);
 console.log('PASS: supplied Codex final events, distinct-turn identity, exact duplicate refusal, bounded speech, prompt/transcript exclusion, metadata silence, Stop and build-mismatch enforcement. Admission only; no global paragraph subscription or hearing claim.');
})().catch(error=>{console.error(error);process.exitCode=1;});
