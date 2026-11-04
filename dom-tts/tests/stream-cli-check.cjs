const assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const base={schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',sessionId:'selected',turnId:'turn',generationId:'generation',messageId:'message',format:'plain'};
const records=[{...base,kind:'start',sequence:0},{...base,kind:'delta',sequence:1,text:'Public Unicode 😀. '},{...base,kind:'complete',sequence:2,text:'Public Unicode 😀. Final suffix.'}];
const run=input=>spawnSync(process.execPath,[path.join(__dirname,'../scripts/stream.js'),'--sessions','selected','--dry-run'],{input,encoding:'utf8',timeout:10000});
const good=run(records.map(e=>JSON.stringify(e)+'\n').join(''));assert.equal(good.status,0,good.stderr);const receipts=good.stdout.trim().split('\n').map(x=>JSON.parse(x));assert.equal(receipts.at(-1).state,'complete');assert.equal(receipts.at(-1).queue.completed,2);assert.equal(receipts.at(-1).audio,false);assert(!good.stdout.includes('Public Unicode'));
const incomplete=run(JSON.stringify(records[0])+'\n');assert.equal(incomplete.status,1);assert.match(incomplete.stdout,/incomplete/);
const foreign=run(JSON.stringify({...records[0],sessionId:'foreign'})+'\n');assert.equal(foreign.status,1);assert.match(foreign.stdout,/event-stream-refused/);
const malformed=run('invalid json\n');assert.equal(malformed.status,1);assert.match(malformed.stdout,/event-stream-refused/);
console.log('PASS: actual generic stdin CLI, selected-session event conversion and terminal receipts; incomplete/foreign/malformed refusal; explicit dry-run, no native audio');
