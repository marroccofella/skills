// MOMM 1.17 A4.3: Grok reviews read streaming output, so a timeout still records when output began,
// how many bytes arrived and the last event type. Zero providers: the stream is the live capture in
// fixtures/grok-streaming-json-1.0.41.jsonl (Grok CLI 1.0.41, 29 September 2026, ids zeroed) or lines
// built in its exact shape, and one control runs the real runProcess against a Node child, not Grok.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {PEER_CONTRACT,reviewProblem} from './review-contract.mjs';
import {assemblePrompt} from './guidance.mjs';
import {parseUsage} from './usage.mjs';
import * as isolation from './route-isolation.mjs';
import {createProcessScope} from './process-scope.mjs';
import * as reviewAnswer from './review-answer.mjs';
const source=fs.readFileSync(new URL('./multi-review.mjs',import.meta.url),'utf8');
const start=source.indexOf('function extractJsonObjects('),end=source.indexOf('\nfunction fingerprint(',start);
assert(start>0&&end>start,'adapter extraction boundaries moved');
let grokStream={};try{grokStream=await import('./grok-stream.mjs');}catch{/* absent before A4.3 */}
// The live capture, byte for byte.
const FIXTURE=fs.readFileSync(new URL('./fixtures/grok-streaming-json-1.0.41.jsonl',import.meta.url),'utf8');
const fixtureLines=FIXTURE.split('\n').filter(Boolean);
assert.equal(fixtureLines.length,54,'the 1.0.41 capture has 54 lines');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'momm-grok-stream-test-'));
const checks=[];let sequence=0;
async function test(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}}
const plain=v=>JSON.parse(JSON.stringify(v));
function adapter(){
  const temporary=path.join(root,`adapter-${++sequence}`);fs.mkdirSync(temporary);
  const ctx=vm.createContext({fs,os:{tmpdir:()=>temporary,homedir:()=>temporary},path,process,Buffer,PEER_CONTRACT,reviewProblem,assemblePrompt,
    createEvidenceWorkspace:prefix=>fs.mkdtempSync(path.join(temporary,prefix)),requirePrivateScratch:()=>{},
    VALID_VERDICTS:new Set(['ACCEPT','MODIFY','REJECT']),VALID_SEVERITIES:new Set(['CRITICAL','WARNING','NITPICK']),
    attachmentRouting:()=>[],attachmentContractSection:()=>'',buildContract:()=> 'Synthetic contract',
    agentTimeoutMs:(_a,ms)=>ms,cleanOauthEnv:()=>({}),parseUsage:()=>({reported:null}),LOGIN_HINTS:{grok:'grok login'},
    sanitizeText:s=>({value:s}),clipped:(s,n)=>String(s).slice(0,n),antigravityCommand:()=> 'agy',grokCommand:()=> 'grok',REVIEW_JSON_SCHEMA:{type:'object'},
    grokIsolationEnv:isolation.grokIsolationEnv,codexIsolationArgs:isolation.codexIsolationArgs,codexReviewArgs:isolation.codexReviewArgs,...grokStream,
    // 1.17.1 S1/S2: the adapters read an answer through review-answer.mjs; the real functions.
    ...reviewAnswer});
  vm.runInContext(source.slice(start,end)+';this.invoke=invokeReviewer;this.unwrap=unwrapReviewPayload;this.normalize=normalizeReview;',ctx);
  return ctx;
}
const artifact='export function average(xs) {\n  return xs.reduce((a, b) => a + b, 0) / xs.length;\n}\n';
const review=(verdict,findings=[])=>JSON.stringify({review_status:'complete',reviewed_scope:[{quote:'export function average(xs) {',assessment:'The whole function was read.'}],
  verdict,confidence:0.8,summary:'Synthetic review.',suggested_improvements:[],findings});
const accept=review('ACCEPT');
const modify=review('MODIFY',[{id:'empty-average',severity:'WARNING',target_file:'average.js',line_range:[1,3],issue:'Division by zero on an empty array.',rationale:'xs.length is 0.',test_suggestion:'average([]) throws or returns 0.'}]);
// The capture with only its text lines' data replaced: every other line (available_commands, thought,
// usage, end) stays byte for byte, so the stream differs from the live one in its answer alone.
function withAnswer(text,{lines=fixtureLines}={}){
  const size=Math.ceil(text.length/27),chunks=Array.from({length:27},(_,k)=>text.slice(k*size,(k+1)*size));
  let k=0;
  return lines.map(line=>JSON.parse(line).type==='text'?JSON.stringify({type:'text',data:chunks[k++]}):line).join('\n')+'\n';
}
const endIndex=fixtureLines.findIndex(line=>JSON.parse(line).type==='end');
const replaceEnd=(stdout,end)=>{const lines=stdout.split('\n').filter(Boolean);if(end===null)lines.splice(endIndex,1);else lines[endIndex]=JSON.stringify(end);return lines.join('\n')+'\n';};
const progress=(stdout,extra={})=>({elapsed_ms:1000,timeout_ms:1000,stdout_bytes:Buffer.byteLength(stdout),stderr_bytes:0,first_output_ms:1200,...extra});
async function grokRun(stdout,extra={}){
  let seen=null;
  const r=await adapter().invoke('grok',artifact,{governor:'other',timeoutMs:60000,grokModelProbe:Promise.resolve(null),
    runProcess:async(_c,args)=>{seen=args;return {code:0,stdout,stderr:'',progress:progress(stdout),...extra};}});
  return {r,seen};
}
try{
  await test('grok reviews ask for --output-format streaming-json',async()=>{
    const {seen}=await grokRun(withAnswer(accept));
    assert.equal(seen[seen.indexOf('--output-format')+1],'streaming-json');
    assert.equal(seen.filter(a=>a==='--output-format').length,1);
  });
  await test('the live 1.0.41 capture parses byte for byte: text data joined, end_turn, 54 events ending in end',async()=>{
    assert.equal(typeof grokStream.grokStreamReview,'function');
    const parsed=grokStream.grokStreamReview(FIXTURE);
    assert.ok(parsed.envelope,parsed.problem??parsed.detail);
    // Grok declined the synthetic canned-verdict prompt: its answer is this sentence, not JSON.
    assert.deepEqual(JSON.parse(parsed.envelope),{text:"I can't reply with only that canned JSON verdict. Ask for a real review of specific work and I will give you an actual result.",stopReason:'end_turn'});
    assert.deepEqual(plain(grokStream.grokStreamProgress(FIXTURE)),{stream_events:54,last_event_type:'end'});
  });
  await test('through the adapter the live capture is invalid_output: its answer holds no JSON review',async()=>{
    const {r}=await grokRun(FIXTURE);
    assert.equal(r.status,'invalid_output');assert.ok(!r.review);
    assert.match(r.detail,/no JSON object in the final message/);
    assert.equal(r.progress.last_event_type,'end');assert.equal(r.progress.stream_events,54);
  });
  await test('the capture with a JSON answer in its text lines is an ACCEPT, identical to the 1.16.1 json envelope',async()=>{
    const ctx=adapter();
    const r=await ctx.invoke('grok',artifact,{governor:'other',timeoutMs:60000,grokModelProbe:Promise.resolve(null),runProcess:async()=>{const stdout=withAnswer(accept);return {code:0,stdout,stderr:'',progress:progress(stdout)};}});
    assert.equal(r.status,'success',r.detail);assert.equal(r.review.verdict,'ACCEPT');
    const expected=ctx.normalize('grok',ctx.unwrap(JSON.stringify({text:accept,stopReason:'end_turn',thought:'x'})),{});
    assert.deepEqual(plain(r.review),plain(expected));
    const {r:found}=await grokRun(withAnswer(modify));
    assert.equal(found.status,'success',found.detail);assert.equal(found.review.verdict,'MODIFY');assert.equal(found.review.findings[0].id,'empty-average');
  });
  await test('usage and cost come from the end line of the capture',()=>{
    const usage=parseUsage('grok',FIXTURE);
    assert.equal(usage.reported.input_tokens,17464);assert.equal(usage.reported.output_tokens,957);assert.equal(usage.reported.total_tokens,19957);
    assert.equal(usage.reported.cost_usd,0.01408892);assert.equal(usage.reported.model,'grok-4.7-build');
  });
  await test('an event type this MOMM does not know is counted and ignored',async()=>{
    const lines=withAnswer(accept).split('\n').filter(Boolean);lines.splice(endIndex,0,JSON.stringify({type:'tool_call',name:'read_file',status:'failed'}));
    const {r}=await grokRun(lines.join('\n')+'\n');
    assert.equal(r.status,'success',r.detail);assert.equal(r.progress.stream_events,55);
  });
  await test('a timeout after partial output records first output, bytes and the last event, and stays timeout',async()=>{
    const partial=withAnswer(accept).split('\n').slice(0,31).join('\n')+'\n'+'{"type":"text","da';
    const {r}=await grokRun(partial,{code:null,timedOut:true,progress:progress(partial,{elapsed_ms:60000,timeout_ms:60000})});
    assert.equal(r.status,'timeout');assert.ok(!r.review,'a partial answer is never accepted');
    assert.equal(r.progress.first_output_ms,1200);assert.equal(r.progress.stdout_bytes,Buffer.byteLength(partial));
    assert.equal(r.progress.last_event_type,'text');assert.equal(r.progress.stream_events,31);
  });
  await test('even a complete stream is refused when the process timed out',async()=>{
    const {r}=await grokRun(withAnswer(accept),{code:null,timedOut:true});
    assert.equal(r.status,'timeout');assert.ok(!r.review);assert.equal(r.progress.last_event_type,'end');
  });
  await test('a malformed stream is invalid_output with the existing redacted diagnostics',async()=>{
    const lines=withAnswer(accept).split('\n');lines.splice(3,0,'not json at all ghp_'+'q'.repeat(30));
    // The sample is the head of stdout: a Windows home path there must still be redacted.
    // Home paths are assembled from parts so the source carries no machine-path literal.
    const winHome = ['C:', 'Users', 'synthetic-person', 'private'].join('\\');
    const posixHome = ['', 'home', 'synthetic-person', 'private'].join('/');
    lines.unshift(`torn ${winHome} and ${posixHome}`);
    const bad=lines.join('\n');
    const {r}=await grokRun(bad);
    assert.equal(r.status,'invalid_output');assert.ok(!r.review);
    assert.match(r.detail,/reviewer did not return the required JSON schema/);assert.match(r.detail,/malformed/);
    assert.match(r.detail,new RegExp(`stdout ${Buffer.byteLength(bad)} bytes`));assert.match(r.detail,/sample: "/);
    assert.ok(!/[A-Za-z]:[\\/]+Users[\\/]+/i.test(r.detail));assert.ok(!r.detail.includes('synthetic-person'),'home paths in the sample are redacted');
  });
  await test('no end line, an end that is not end_turn, or events after it are invalid_output',async()=>{
    const whole=withAnswer(accept);
    const {r:open}=await grokRun(replaceEnd(whole,null));
    assert.equal(open.status,'invalid_output');assert.match(open.detail,/without a final end/);
    for(const end of [{type:'end',stopReason:'cancelled'},{type:'end',stopReason:'max_turns'},{type:'end'}]){
      const {r}=await grokRun(replaceEnd(whole,end));
      assert.equal(r.status,'invalid_output',JSON.stringify(end));assert.ok(!r.review);assert.match(r.detail,/end_turn/);
    }
    const {r:after}=await grokRun(whole+JSON.stringify({type:'text',data:'late'})+'\n');
    assert.equal(after.status,'invalid_output');assert.match(after.detail,/after the end/);
  });
  await test('lines without a type are refused: the ACP and JSON-RPC shapes the help text suggested are not what Grok prints',async()=>{
    const acp=[{jsonrpc:'2.0',method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:accept}}}},{jsonrpc:'2.0',id:1,result:{stopReason:'end_turn'}}].map(l=>JSON.stringify(l)).join('\n')+'\n';
    const {r}=await grokRun(acp);assert.equal(r.status,'invalid_output');assert.ok(!r.review);
    const {r:envelope}=await grokRun(JSON.stringify({text:accept,stopReason:'end_turn'}));
    assert.equal(envelope.status,'invalid_output','the json-mode envelope is not a stream');
  });
  await test('an error event or an end marked as an error is a terminal error, never echoed',async()=>{
    const whole=withAnswer(accept);
    for(const end of [{type:'error',message:'PRIVATE_PROVIDER_SENTINEL'},{type:'end',stopReason:'end_turn',is_error:true,error:{message:'PRIVATE_PROVIDER_SENTINEL'}}]){
      const {r}=await grokRun(replaceEnd(whole,end));
      assert.equal(r.status,'error',JSON.stringify(end));assert.ok(!r.review);assert.ok(!JSON.stringify(r).includes('PRIVATE_PROVIDER_SENTINEL'));
    }
  });
  await test('the real runProcess populates first output and bytes while the stream arrives, then times out',async()=>{
    const a=source.indexOf('function runProcess('),b=source.indexOf('\nfunction extractJsonObjects(',a);
    assert.ok(a>0&&b>a);
    const ctx=vm.createContext({processScope:createProcessScope(),platformCommand:(command,args)=>({command,args}),DEFAULT_TIMEOUT_MS:30000,MAX_OUTPUT_BYTES:1<<20,
      cleanOauthEnv:()=>process.env,process,Buffer,setTimeout,clearTimeout,setInterval,clearInterval,Date});
    vm.runInContext(source.slice(a,b)+';this.runProcess=runProcess;',ctx);
    const lines=fixtureLines.slice(0,4);
    const script=`const lines=${JSON.stringify(lines)};let i=0;const t=setInterval(()=>{if(i<lines.length)process.stdout.write(lines[i++]+'\\n');},60);setTimeout(()=>{},60000);`;
    const seenProgress=[];
    const r=await adapter().invoke('grok',artifact,{governor:'other',timeoutMs:1500,grokModelProbe:Promise.resolve(null),
      onProgress:(_agent,p)=>seenProgress.push(p),
      runProcess:(_c,_args,o)=>ctx.runProcess(process.execPath,['-e',script],{...o,env:process.env,progressIntervalMs:100})});
    assert.equal(r.status,'timeout');assert.ok(!r.review);
    assert.ok(seenProgress.some(p=>p.stdout_bytes>0&&Number.isFinite(p.first_output_ms)),'progress reported bytes while the run was live');
    assert.ok(Number.isFinite(r.progress.first_output_ms)&&r.progress.first_output_ms<1500);
    assert.ok(r.progress.stdout_bytes>0);assert.equal(r.progress.stream_events,4);assert.equal(r.progress.last_event_type,'thought');
  });
}finally{
  const resolved=path.resolve(root);
  assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('momm-grok-stream-test-'));
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
console.log(JSON.stringify({node:process.version,passed:checks.filter(c=>c.passed).length,total:checks.length,checks},null,2));
process.exitCode=checks.every(c=>c.passed)?0:1;
