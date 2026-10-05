const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {MODES,applyMode,chunkText}=require('./summarize'),{parseArgs,prepare,playback}=require('./speak'),{safeEnv,readObject}=require('./runtime'),{selectProvider,commandFor}=require('./providers/native'),watch=require('./watch-codex'),{stop}=require('./stop');
// Platform-specific checks are counted apart so results from different hosts can be compared.
let checks=0;const only={posix:{run:0,skipped:0},windows:{run:0,skipped:0}};function check(fn){fn();checks++;}
check.on=(tag,fn)=>{if((tag==='windows')!==(process.platform==='win32')){only[tag].skipped++;return;}fn();checks++;only[tag].run++;};
async function main(){
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'dom-tts-test-'));try{
 const corpus=JSON.parse(fs.readFileSync(path.join(__dirname,'../tests/corpus/golden.json'),'utf8').replace(/^\uFEFF/,''));assert(corpus.length>=60);
 for(const item of corpus)for(const mode of MODES)check(()=>assert.equal(applyMode(item.input,mode),item.expected[mode],mode+': '+item.input));
 for(const word of ['Git','Node','npm','Python','cd','PowerShell'])check(()=>assert.equal(applyMode(word+' is useful.'),word+' is useful.'));
 for(const input of ['git push origin main','npm test','node app.js','python script.py','cd ./src'])check(()=>assert.equal(applyMode(input),''));
 check(()=>assert(!applyMode('Hello\n```js\nprivateCode();').includes('privateCode')));
 check(()=>assert(!applyMode('Hello\n~~~js\nprivateCode();\n~~~').includes('privateCode')));
 check(()=>assert.equal(applyMode('Use e.g. apples. Keep this sentence. And this one.','summary'),'Use e.g. apples. Keep this sentence. And this one.'));
 check(()=>assert.equal(applyMode('Error: failed.\nReady.','errors-only'),'Error: failed.'));
 check(()=>assert.equal(applyMode('Warning: deprecated.\nReady.','warnings-only'),'Warning: deprecated.'));
 check(()=>assert.equal(applyMode('diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n-old\n+new','diff-summary'),'Diff summary. Files touched: a.js. 1 added lines and 1 removed lines.'));
 for(const mode of MODES)check(()=>assert.equal(typeof applyMode('x'.repeat(1048576),mode),'string'));
 let seed=12345;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let i=0;i<1000;i++){const limit=40+next()%100,text=Array.from({length:1+next()%100},()=> 'a'.repeat(1+next()%15)+(next()%4===0?'.':'')).join(' '),chunks=chunkText(text,limit);check(()=>assert(chunks.every(x=>x.length<=limit)));check(()=>assert.equal(chunks.join('').replace(/\s/g,''),text.replace(/\s/g,'')));for(const chunk of chunks)check(()=>assert(chunk.split(/\s+/).every(word=>text.split(/\s+/).includes(word))));}
 check(()=>assert(chunkText('x'.repeat(3000),4000).every(x=>x.length<=720)));
 check(()=>assert(chunkText('😀'.repeat(1000),41).every(x=>!/[\uD800-\uDBFF]$/.test(x))));
 for(const speed of [0.5,1,2])check(()=>assert(chunkText('a'.repeat(4000),4000,speed).every(x=>x.length<=8*speed*90)));
 check(()=>assert.throws(()=>chunkText('hello',0)));check(()=>assert.throws(()=>prepare({text:'Hello',mode:'invalid'})));check(()=>assert.throws(()=>prepare({text:'Hello',profile:'invalid'})));
 check(()=>assert.throws(()=>prepare({text:'Hello',speed:0.49})));check(()=>assert.throws(()=>prepare({text:'Hello',speed:2.01})));check(()=>assert.deepEqual(parseArgs(['--text=--verbose']),{text:'--verbose'}));
 for(const args of [['--max-chunk-chars','100'],['--maxChunkChars','100']])check(()=>assert.equal(parseArgs(args).maxChunkChars,'100'));
 check(()=>assert.throws(()=>parseArgs(['--unknown','x'])));check(()=>assert.equal(parseArgs(['--dry-run','false']).dryRun,false));
 const text='Résumé and iPhone.',input=path.join(fixture,'input.txt');fs.writeFileSync(input,text);
 const run=args=>spawnSync(process.execPath,[path.join(__dirname,'speak.js'),'--dry-run',...args],{encoding:'utf8',input:text,timeout:10000});
 const direct=run(['--text',text]);check(()=>assert.equal(direct.status,0));check(()=>assert.equal(run(['--text-file',input]).stdout,direct.stdout));check(()=>assert.equal(run(['--stdin','true']).stdout,direct.stdout));
 for(const platform of ['win32','darwin','linux'])check(()=>assert.equal(selectProvider('auto',platform),{win32:'sapi',darwin:'say',linux:'espeak-ng'}[platform]));
 check(()=>assert.throws(()=>selectProvider('sapi','darwin')));check(()=>assert.equal(commandFor('say',{speed:1,voice:'Alex'}).file,'/usr/bin/say'));
 const old={};for(const key of ['API_KEY','GITHUB_TOKEN','AWS_SECRET_ACCESS_KEY','my_password']){old[key]=process.env[key];process.env[key]='PRIVATE';}check(()=>{const env=safeEnv();for(const key of Object.keys(old))assert(!Object.hasOwn(env,key));});for(const [key,val]of Object.entries(old)){if(val===undefined)delete process.env[key];else process.env[key]=val;}
 const bad=path.join(fixture,'bad.json');for(const value of ['{bad','null','[]']){fs.writeFileSync(bad,value);check(()=>assert.deepEqual(readObject(bad),{}));}
 const record={type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Synthetic answer.'}]}};
 check(()=>assert.equal(watch.outputTextFromRecord(record),'Synthetic answer.'));check(()=>assert.equal(watch.outputTextFromRecord({...record,payload:{...record.payload,role:'user'}}),''));
 const commentary={...record,payload:{...record.payload,phase:'commentary'}};check(()=>assert.equal(watch.outputTextFromRecord(commentary,'all',false),''));check(()=>assert.equal(watch.outputTextFromRecord(commentary,'all',true),'Synthetic answer.'));
 check(()=>assert.throws(()=>watch.parseArgs(['--phase','all'])));check(()=>assert.equal(watch.outputTextFromRecord({type:'assistant',message:{role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:'Claude reply.'}]}},'final_answer',false,'claude'),'Claude reply.'));
 check(()=>assert.equal(watch.outputTextFromRecord({role:'assistant',phase:'final_answer',text:'Any model.'},'final_answer',false,'generic'),'Any model.'));
 const transcript=path.join(fixture,'transcript.jsonl'),encoded=JSON.stringify(record)+'\r\n',keys=new Set();fs.writeFileSync(transcript,encoded.slice(0,20));check(()=>assert.equal(watch.completeLines(Buffer.from(encoded.slice(0,20))).bytes,0));fs.appendFileSync(transcript,encoded.slice(20));
 const args={format:'codex',phase:'final_answer',dryRun:false};
 const failed=await watch.processNewLines(transcript,0,args,keys,{dir:fixture,speak:async()=>false});check(()=>assert.equal(failed.cursor,0));check(()=>assert.equal(failed.failed,true));check(()=>assert.equal(keys.size,0));
 const success=await watch.processNewLines(transcript,0,args,keys,{dir:fixture,speak:async()=>true});check(()=>assert.equal(success.spoken,1));check(()=>assert.equal(success.cursor,Buffer.byteLength(encoded)));fs.appendFileSync(transcript,encoded);const duplicate=await watch.processNewLines(transcript,success.cursor,args,keys,{dir:fixture,speak:async()=>true});check(()=>assert.equal(duplicate.spoken,0));
 fs.writeFileSync(transcript,'');const truncated=await watch.processNewLines(transcript,success.cursor,args,keys,{dir:fixture});check(()=>assert.equal(truncated.cursor,0));fs.unlinkSync(transcript);const deleted=await watch.processNewLines(transcript,0,args,keys,{dir:fixture});check(()=>assert.equal(deleted.spoken,0));
 check(()=>assert.throws(()=>watch.completeLines(Buffer.alloc(1048576,65))));
 const many=Array.from({length:1205},(_,id)=>JSON.stringify({...record,id})+'\n').join('');fs.writeFileSync(transcript,many);const cap=new Set();await watch.processNewLines(transcript,0,{...args,dryRun:true},cap,{dir:fixture});check(()=>assert.equal(cap.size,1200));
 fs.writeFileSync(path.join(fixture,'stop.flag'),'test');const discarded=await watch.processNewLines(transcript,0,args,new Set(),{dir:fixture});check(()=>assert.equal(discarded.spoken,0));fs.unlinkSync(path.join(fixture,'stop.flag'));
 let released;const fakePlay=async(chunks,options,context)=>new Promise(resolve=>{released=()=>resolve();context.setChild({kill:released});context.progress(0);});
 const playing=playback({chunks:['Synthetic private text.'],mode:'informative',profile:'conversational',provider:'sapi',waitMs:0},{dir:fixture,privacy:()=>{},play:fakePlay});
 for(let i=0;i<100&&!released;i++)await new Promise(r=>setTimeout(r,10));assert(released);
 const now=Date.now(),stopped=await stop(fixture);await playing;check(()=>assert.equal(stopped.state,'stopped'));check(()=>assert(Date.now()-now<500));check(()=>assert(!fs.existsSync(path.join(fixture,'playback.lock'))));check(()=>assert(!fs.readFileSync(path.join(fixture,'status.json'),'utf8').includes('Synthetic private text')));
 const support=spawnSync(process.execPath,[path.join(__dirname,'support-safety.test.js')],{encoding:'utf8',timeout:10000});check(()=>assert.equal(support.status,0,support.stderr));
 const skill=fs.readFileSync(path.join(__dirname,'../SKILL.md'),'utf8');check(()=>assert(/^---\r?\nname: dom-tts\r?\ndescription: [^\n]{1,1024}\r?\n---/.test(skill)));
 for(const file of fs.readdirSync(__dirname).filter(x=>x.endsWith('.js')))check(()=>assert.equal(spawnSync(process.execPath,['--check',path.join(__dirname,file)],{encoding:'utf8'}).status,0));
 const extra=await require('../tests/recovery-checks.cjs')(check);
 require('../tests/evolution-checks.cjs')(check);
 require('../tests/permission-cache-checks.cjs')(check);
 await require('../tests/async-queue-checks.cjs')(check);
 require('../tests/event-framing-checks.cjs')(check);
 const ran=only.posix.run+only.windows.run,skipped=only.posix.skipped+only.windows.skipped;
 console.log('PASS: '+checks+' assertions on '+process.platform+' ('+(checks-ran)+' on every platform + '+only.posix.run+' POSIX-only + '+only.windows.run+' Windows-only; '+skipped+' platform-specific skipped here); '+corpus.length+' golden inputs and '+extra.replies+' realistic replies × 8 modes; 1,000 seeded chunk properties; watcher failure/retry; IPC stop; permission-check failures; stale-lock recovery and live-owner preservation; tables; diagnostics and CLI.');
 }finally{fs.rmSync(fixture,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
