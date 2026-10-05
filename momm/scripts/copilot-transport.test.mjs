// Offline native-shape transport regressions; no accounts or model calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { PEER_CONTRACT, reviewProblem, quotationDiagnostics } from './review-contract.mjs';
import { assemblePrompt } from './guidance.mjs';
import * as reviewAnswer from './review-answer.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives
const source=fs.readFileSync(new URL('./multi-review.mjs',import.meta.url),'utf8');
const start=source.indexOf('function extractJsonObjects('),end=source.indexOf('\nfunction fingerprint(',start);
assert(start>=0&&end>start,'Inspect changed adapter extraction boundaries');
const context=vm.createContext({fs,os,path,process,Buffer,PEER_CONTRACT,reviewProblem,assemblePrompt,
  createEvidenceWorkspace:prefix=>fs.mkdtempSync(path.join(os.tmpdir(),prefix)),
  requirePrivateScratch:()=>{},
  VALID_VERDICTS:new Set(['ACCEPT','MODIFY','REJECT']),VALID_SEVERITIES:new Set(['CRITICAL','WARNING','NITPICK']),
  attachmentRouting:()=>[],attachmentContractSection:()=>'',buildContract:()=> 'Synthetic review contract',
  agentTimeoutMs:(_a,ms)=>ms,cleanOauthEnv:()=>({}),parseUsage:()=>({reported:null}),LOGIN_HINTS:{copilot:'copilot login'},
  sanitizeText:s=>({value:s}),
  // 1.17.1 S1/S2: the adapters read an answer through review-answer.mjs; the real functions.
  ...reviewAnswer});
// 1.17 A4.2: an invalid answer carries private quotation diagnostics; the real helper and validator.
const quoteFrom=source.indexOf('function quotationEvidence('),quoteTo=source.indexOf('\n}\n',quoteFrom)+3;
assert(quoteFrom>=0&&quoteTo>quoteFrom);
context.quotationDiagnostics=quotationDiagnostics;
vm.runInContext(source.slice(quoteFrom,quoteTo),context);
vm.runInContext(source.slice(start,end)+';this.invoke=invokeReviewer;',context);
const artifact='export function average(xs) {\n  return xs.reduce((a, b) => a + b, 0) / xs.length;\n}\n';
const payload={review_status:'complete',reviewed_scope:[{quote:'export function average(xs) {',assessment:'The finite nonempty input case was inspected.'}],
  verdict:'ACCEPT',confidence:0.8,findings:[],summary:'Synthetic valid review.',suggested_improvements:[]};
const event=(type,data={})=>({type,data});
function events(content=JSON.stringify(payload)) {
  return [event('session.info'),event('session.auto_mode_resolved'),event('session.mcp_servers_loaded'),event('session.tools_updated'),
    event('user.message',{content:'SOURCE_SENTINEL'}),event('assistant.turn_start',{turnId:'tool-turn'}),event('model.call_start'),event('model.call_finished'),
    event('assistant.message',{turnId:'tool-turn',content:'',toolRequests:[{name:'view'}]}),event('tool.execution_start'),
    event('tool.execution_complete',{success:true,result:{content:'TOOL_SENTINEL'}}),event('assistant.turn_end',{turnId:'tool-turn'}),
    event('assistant.turn_start',{turnId:'answer-turn'}),event('model.call_start'),event('model.call_finished'),
    event('assistant.message',{turnId:'answer-turn',content,toolRequests:[]}),event('assistant.reasoning',{content:'REASONING_SENTINEL'}),
    event('assistant.turn_end',{turnId:'answer-turn'}),event('session.usage_checkpoint'),event('assistant.idle'),{type:'result',exitCode:0}];
}
const encode=rows=>rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
let invocation;
async function invoke(rows=events(),extra={}) {
  return context.invoke('copilot',artifact,{governor:'codex',timeoutMs:1000,runProcess:async(command,args,options)=>{
    invocation={command,args,options,prompt:fs.readFileSync(path.join(options.cwd,'prompt.txt'),'utf8')};
    return {code:0,stdout:typeof rows==='string'?rows:encode(rows),stderr:'',...extra};
  }});
}
const checks=[];
async function test(name,fn){try{await fn();checks.push({name,passed:true})}catch(e){checks.push({name,passed:false,error:e.message})}}
await test('21-event native shape reaches the unchanged full review contract',async()=>{
  const r=await invoke();assert.equal(r.status,'success',r.detail);assert.equal(r.review.summary,payload.summary);
  assert.equal(r.review.review_contract,PEER_CONTRACT);assert(!JSON.stringify(r).includes('_SENTINEL'));
});
await test('adapter selects machine output without changing read-only permissions or leaking artifact to argv',async()=>{
  await invoke();assert.equal(invocation.args[invocation.args.indexOf('--output-format')+1],'json');
  for(const flag of ['--available-tools=view','--allow-tool=view','--no-custom-instructions','--disable-builtin-mcps','--no-remote-export'])assert(invocation.args.includes(flag));
  assert(!invocation.args.some(a=>a.includes('export function')));assert(invocation.prompt.includes(artifact));
  assert(!fs.existsSync(invocation.options.cwd),'Prompt directory must be cleaned');
});
await test('process error, timeout and output limit never promote a final review',async()=>{
  assert.equal((await invoke(events(),{code:1,stderr:'synthetic error'})).status,'error');
  assert.equal((await invoke(events(),{timedOut:true})).status,'timeout');
  assert.equal((await invoke(events(),{outputLimited:true})).status,'invalid_output');
});
await test('nonzero terminal event overrides an earlier complete assistant review',async()=>{
  const rows=events();rows.at(-1).exitCode=1;assert.equal((await invoke(rows)).status,'error');
});
await test('explicit terminal session error is not a JSON schema failure',async()=>{
  const rows=events();rows.splice(-1,0,event('session.error',{message:'PRIVATE_DIAGNOSTIC'}));
  const r=await invoke(rows);assert.equal(r.status,'error');assert(!JSON.stringify(r).includes('PRIVATE_DIAGNOSTIC'));
});
await test('missing, mistyped, duplicate or non-terminal result is refused',async()=>{
  for(const mutate of [r=>r.pop(),r=>delete r.at(-1).exitCode,r=>r.at(-1).exitCode='0',r=>r.push({...r.at(-1)}),r=>r.push(event('session.info'))]){
    const rows=events();mutate(rows);assert.equal((await invoke(rows)).status,'invalid_output');
  }
});
await test('truncated or malformed JSONL is refused without response recovery',async()=>{
  for(const text of [encode(events())+'{"type":',encode(events()).replace('"session.info"','bad'),encode(events())+'[1]',encode(events())+'null'])assert.equal((await invoke(text)).status,'invalid_output');
});
await test('unknown event vocabulary fails closed instead of ignoring a future terminal event',async()=>{
  const rows=events();rows.splice(-1,0,event('future.state'));assert.equal((await invoke(rows)).status,'invalid_output');
});
await test('tool output and reasoning cannot substitute for an assistant answer',async()=>{
  const rows=events('');rows[10].data.result.content=JSON.stringify(payload);rows[16].data.content=JSON.stringify(payload);
  assert.equal((await invoke(rows)).status,'invalid_output');
});
await test('nonempty tool-request message is not a completed answer',async()=>{
  const rows=events();rows[15].data.toolRequests=[{name:'view'}];assert.equal((await invoke(rows)).status,'invalid_output');
});
await test('uncompleted or mismatched assistant turn cannot be promoted',async()=>{
  for(const mutate of [r=>r.splice(17,1),r=>r[17].data.turnId='other',r=>r[15].data.turnId='other',r=>r.splice(-1,0,event('assistant.turn_start',{turnId:'next'}))]){
    const rows=events();mutate(rows);assert.equal((await invoke(rows)).status,'invalid_output');
  }
});
await test('a later empty or malformed assistant answer cannot rescue an earlier plausible review',async()=>{
  for(const content of ['', '{bad}']){
    const rows=events();rows.splice(-1,0,event('assistant.turn_start',{turnId:'later'}),event('assistant.message',{turnId:'later',content,toolRequests:[]}),event('assistant.turn_end',{turnId:'later'}));
    assert.equal((await invoke(rows)).status,'invalid_output');
  }
});
await test('new user input after an answer invalidates that earlier answer',async()=>{
  const rows=events();rows.splice(-1,0,event('user.message',{content:'later request'}));assert.equal((await invoke(rows)).status,'invalid_output');
});
await test('rendered text, quoted JSON and literal newlines are not repaired',async()=>{
  for(const content of [JSON.stringify(JSON.stringify(payload)),'{"findings":[],"summary":"literal\nnewline"}'])assert.equal((await invoke(events(content))).status,'invalid_output');
  assert.equal((await invoke(JSON.stringify(payload))).status,'invalid_output');
});
await test('wrong scope and incomplete contract remain refused after transport succeeds',async()=>{
  const wrong={...payload,reviewed_scope:[{quote:'NOT_IN_ARTIFACT',assessment:'Synthetic'}]};
  assert.equal((await invoke(events(JSON.stringify(wrong)))).status,'invalid_output');
  assert.equal((await invoke(events(JSON.stringify({...payload,review_status:'pending'})))).status,'invalid_output');
});
await test('CRLF transport preserves review content and supports matching turn IDs',async()=>{
  const r=await invoke(encode(events()).replaceAll('\n','\r\n'));assert.equal(r.status,'success',r.detail);
});
// Gate rev_20260918172020_ehti copilot-jsonl-untested: the transport was already covered
// above (single object at "rendered text ... are not repaired", unknown event, nonzero
// result). The remaining named case is an event-level error marker: it is a terminal
// failure by design, never a schema problem and never echoed.
await test('an error marker on any event is a terminal failure and is not echoed',async()=>{
  for(const mark of [r=>r[7].error={message:'PRIVATE_DIAGNOSTIC'},r=>r[7].is_error=true,r=>r.at(-1).error='PRIVATE_DIAGNOSTIC']){
    const rows=events();mark(rows);const r=await invoke(rows);
    assert.equal(r.status,'error');assert(!r.review);assert(!JSON.stringify(r).includes('PRIVATE_DIAGNOSTIC'));
  }
});
// Gate rev_20260918185005_hwu4 [codex#8]: within one turn the LAST assistant message is the
// answer; an earlier plausible review in the same turn is never promoted over it.
await test('a duplicate assistant message in the same turn replaces, and never rescues, the earlier one',async()=>{
  for(const later of ['','{bad}']){
    const rows=events();rows.splice(16,0,event('assistant.message',{turnId:'answer-turn',content:later,toolRequests:[]}));
    assert.equal((await invoke(rows)).status,'invalid_output');
  }
  const rows=events('{bad}');rows.splice(16,0,event('assistant.message',{turnId:'answer-turn',content:JSON.stringify(payload),toolRequests:[]}));
  assert.equal((await invoke(rows)).status,'success');
});
await test('one JSON object instead of JSONL events is refused whatever it contains',async()=>{
  for(const text of [JSON.stringify(payload),JSON.stringify({type:'result',exitCode:0}),JSON.stringify({response:JSON.stringify(payload)})])assert.equal((await invoke(text)).status,'invalid_output');
});
// 1.17 A3: the dispatcher hands the staged attachments to the reply validator, so an observation
// is accepted only for a digest actually sent in this run and is recorded as unverifiable.
await test('an image observation is checked against the attachments actually sent',async()=>{
  const sha='c'.repeat(64),staging={directory:null,attachments:[{name:'shot.png',staged_path:'attachment-1.png',modality:'image',bytes:4,sha256:sha,width:32,height:16,metadata_stripped:false}]};
  const send=async(entry,sent=staging)=>context.invoke('copilot',artifact,{governor:'codex',timeoutMs:1000,staging:sent,
    runProcess:async()=>({code:0,stdout:encode(events(JSON.stringify({...payload,reviewed_scope:[payload.reviewed_scope[0],entry]}))),stderr:''})});
  const seen={attachment_sha256:sha,observation:'A blue banner spans the top.',assessment:'Consistent with the brief.',region:[0,0,32,8]};
  const ok=await send(seen);assert.equal(ok.status,'success',ok.detail);
  assert.equal(ok.review.reviewed_scope[1].kind,'observation');assert.equal(ok.review.reviewed_scope[1].unverifiable,true);
  assert.equal((await send({...seen,attachment_sha256:'d'.repeat(64)})).status,'invalid_output');
  assert.equal((await send({...seen,region:[0,10,32,8]})).status,'invalid_output');
  assert.equal((await send(seen,{directory:null,attachments:[]})).status,'invalid_output');
});
// 1.17.1: Copilot CLI 1.0.91 adds two events to the JSONL stream (1.0.90 failed the same way on
// 1 October but its events were not captured), seen in a synthetic capture on 4 October 2026 with MOMM's own flags: one leading session.warning (a policy notice) and one
// model.call_final_result after each model call ({model, isByok, result: "success"}). 1.17.0 refused
// every Copilot review as "unrecognized event type". Both are bookkeeping, never an answer; the
// vocabulary stays closed and a model call that does not report success is refused.
function events1091(content=JSON.stringify(payload),callResult='success') {
  const extra=(type,data)=>({type,data,ephemeral:true,id:'00000000-0000-4000-8000-000000000000',timestamp:'2026-10-04T06:00:00.000Z',parentId:null});
  const final=()=>extra('model.call_final_result',{model:'synthetic-model',isByok:false,result:callResult});
  return [extra('session.warning',{message:'WARNING_SENTINEL third-party servers are disabled by policy',warningType:'policy'}),
    event('session.info'),event('session.mcp_servers_loaded'),event('session.tools_updated'),
    event('user.message',{content:'SOURCE_SENTINEL'}),event('assistant.turn_start',{turnId:'tool-turn'}),event('model.call_start'),event('model.call_finished'),
    event('assistant.message',{turnId:'tool-turn',content:'',toolRequests:[{name:'view'}]}),event('assistant.reasoning',{content:'REASONING_SENTINEL'}),
    event('tool.execution_start'),final(),event('tool.execution_complete',{success:true,result:{content:'TOOL_SENTINEL'}}),event('assistant.turn_end',{turnId:'tool-turn'}),
    event('assistant.turn_start',{turnId:'answer-turn'}),event('model.call_start'),event('model.call_finished'),
    event('assistant.message',{turnId:'answer-turn',content,toolRequests:[]}),final(),
    event('assistant.turn_end',{turnId:'answer-turn'}),event('session.usage_checkpoint'),event('assistant.idle'),{type:'result',exitCode:0}];
}
await test('Copilot 1.0.91 shape: a session warning and per-call final results reach the full review contract',async()=>{
  const r=await invoke(events1091());assert.equal(r.status,'success',r.detail);assert.equal(r.review.summary,payload.summary);
  assert.equal(r.review.review_contract,PEER_CONTRACT);assert(!JSON.stringify(r).includes('_SENTINEL'),'no warning, tool or reasoning text may leak');
});
await test('a model call whose final result is not success is refused, and so is one without a result',async()=>{
  // MISSING removes the field: a default parameter would silently turn undefined back into success.
  const MISSING=Symbol('missing');
  for(const bad of ['error','cancelled','','SUCCESS',MISSING,null,{ok:true}]){
    const rows=events1091(JSON.stringify(payload),bad===MISSING?'success':bad);
    if(bad===MISSING)for(const e of rows)if(e.type==='model.call_final_result')delete e.data.result;
    const r=await invoke(rows);
    assert.equal(r.status,'invalid_output','accepted result '+String(JSON.stringify(bad)??'missing'));assert(!r.review);assert.match(r.detail,/model call did not report success/);
  }
});
await test('a session warning or a final result alone is never an answer',async()=>{
  // Every model call stays at "success", so it is the answer gate that refuses this, not the result gate.
  const rows=events1091('');
  rows.find(e=>e.type==='session.warning').data.message=JSON.stringify(payload);
  assert(rows.filter(e=>e.type==='model.call_final_result').every(({data})=>data.result==='success'));
  const r=await invoke(rows);assert.equal(r.status,'invalid_output');assert.match(r.detail,/no completed tool-free assistant answer/);
});
await test('one failed model call among successful ones is refused even with a valid final answer',async()=>{
  for(const which of [0,1]){
    const rows=events1091();rows.filter(e=>e.type==='model.call_final_result')[which].data.result='error';
    const r=await invoke(rows);assert.equal(r.status,'invalid_output','call '+which);assert(!r.review);assert.match(r.detail,/model call did not report success/);
  }
});
await test('the vocabulary stays closed after 1.17.1: a sibling of the new events is still refused',async()=>{
  for(const type of ['session.notice','model.call_retry','session.warning.v2']){
    const rows=events1091();rows.splice(-1,0,event(type));assert.equal((await invoke(rows)).status,'invalid_output',type);
  }
});
// 1.17.1: when the vocabulary drifts again, the refusal names the unrecognised event types (plain
// lower-case names only, at most three), so the cause is visible without a capture. Anything that is
// not a plain name is counted, never echoed.
await test('an unrecognised event is named in the refusal; a name that is not plain is never echoed',async()=>{
  const rows=events1091();rows.splice(-1,0,event('model.call_retry'),event('session.notice'),event('model.call_retry'));
  const r=await invoke(rows);assert.equal(r.status,'invalid_output');
  assert.match(r.detail,/unrecognized event type/);assert.match(r.detail,/model\.call_retry/);assert.match(r.detail,/session\.notice/);
  const odd=events1091();odd.splice(-1,0,event('PRIVATE path C:/x & "quoted"'),event('x'.repeat(80)));
  const o=await invoke(odd);assert.equal(o.status,'invalid_output');
  assert(!o.detail.includes('PRIVATE')&&!o.detail.includes('quoted')&&!o.detail.includes('xxxx'),o.detail);
  assert.match(o.detail,/2 with names not shown/);
  const many=events1091();many.splice(-1,0,...['a.one','a.two','a.three','a.four','a.five'].map(type=>event(type)));
  const m=await invoke(many);assert.match(m.detail,/a\.one, a\.two, a\.three; and 2 more/);
});
// 1.17.1: on 4 October 2026 Copilot (CLI 1.0.91) answered a real 10 KB review, twice, with its whole
// answer inside one Markdown code fence, against the contract's "no markdown fences". Every other
// route already extracts the object from such an answer; this adapter refused it. A fence is a
// wrapper, not content: an answer that holds exactly one fenced block is unwrapped and its inside is
// parsed as strictly as before. The same day, on a 108 KB review, Copilot answers put a sentence of
// narration before that block; narration around the one block is ignored. Nothing is repaired and
// nothing is searched for: a second block, any other fence line, another fence character, narration
// around a bare answer or broken JSON inside are all still refused.
const FENCE='```';
const fenced=(body,lang='json')=>FENCE+lang+'\n'+body+'\n'+FENCE;
await test('an answer that is exactly one fenced JSON block is unwrapped and held to the full contract',async()=>{
  for(const content of [fenced(JSON.stringify(payload)),fenced(JSON.stringify(payload,null,2)),fenced(JSON.stringify(payload),''),
    fenced(JSON.stringify(payload),'JSON'),fenced(JSON.stringify(payload),'Json'),
    fenced(JSON.stringify(payload)+' ') /* trailing space before the closing fence: JSON allows it */,
    '\n'+fenced(JSON.stringify(payload))+'\n',fenced(JSON.stringify(payload)).replaceAll('\n','\r\n')]){
    const r=await invoke(events1091(content));assert.equal(r.status,'success',JSON.stringify(content.slice(0,24))+' '+r.detail);
    assert.equal(r.review.summary,payload.summary);assert.equal(r.review.review_contract,PEER_CONTRACT);
  }
  const quoting={...payload,summary:'The note shows a block: '+FENCE+'js then code then '+FENCE+' inside a string.'};
  const q=await invoke(events1091(fenced(JSON.stringify(quoting))));assert.equal(q.status,'success',q.detail);assert.equal(q.review.summary,quoting.summary);
});
await test('narration around the one fenced block is ignored, and the block is held to the full contract',async()=>{
  const good=JSON.stringify(payload);
  for(const content of ['Good, I have everything needed to complete the review.\n\n'+fenced(good),
    'Exact text confirmed. Now producing the final review.\n\n'+fenced(JSON.stringify(payload,null,2)),
    'Here is my review:\n'+fenced(good),fenced(good)+'\nHope that helps.',('Done.\n'+fenced(good)+'\nThanks.').replaceAll('\n','\r\n')]){
    const r=await invoke(events1091(content));assert.equal(r.status,'success',JSON.stringify(content.slice(0,24))+' '+r.detail);
    assert.equal(r.review.summary,payload.summary);assert.equal(r.review.review_contract,PEER_CONTRACT);
  }
  const wrong={...payload,reviewed_scope:[{quote:'NOT_IN_ARTIFACT',assessment:'Synthetic'}]};
  assert.equal((await invoke(events1091('Here is my review:\n'+fenced(JSON.stringify(wrong))))).status,'invalid_output');
  // The narration is not the answer: a review object in it is never read.
  const decoy={...payload,verdict:'REJECT',summary:'A decoy in the narration.'};
  const d=await invoke(events1091('I considered '+JSON.stringify(decoy)+' first.\n'+fenced(good)));
  assert.equal(d.status,'success',d.detail);assert.equal(d.review.verdict,payload.verdict);assert.equal(d.review.summary,payload.summary);
});
await test('a fence is never a licence to repair: a second block, other fences, narration around a bare answer and broken JSON are refused',async()=>{
  const good=JSON.stringify(payload);
  for(const content of ['Here is my review:\n'+good,good+'\nHope that helps.','Here is my review:\n'+FENCE+'json\n'+good,
    'An example:\n'+fenced('x = 1','')+'\n'+fenced(good),'Here is my review:\n  '+FENCE+'json\n'+good+'\n  '+FENCE,
    'Here is my review:\n'+fenced(good,'javascript'),'Here is my review:\n~~~json\n'+good+'\n~~~',FENCE+'json\n'+good+'\n'+FENCE+' done',
    'Here is my review:\n'+fenced('{bad}'),fenced(good)+'\n'+fenced(good),
    fenced('{bad}'),fenced(''),fenced(JSON.stringify(good)),FENCE+'json\n'+good,good+'\n'+FENCE,'~~~json\n'+good+'\n~~~',
    FENCE+'json '+good+' '+FENCE,fenced(good,'javascript'),fenced(good,'jsonc'),fenced('['+good+']'),
    fenced(good)+'\n'+FENCE /* a second fence on its own closing line */,fenced(good+'\n'+FENCE+'\n'+good)]){
    const r=await invoke(events1091(content));assert.equal(r.status,'invalid_output','accepted '+JSON.stringify(content.slice(0,40)));assert(!r.review);
  }
});
await test('a fenced answer with a wrong quote or an incomplete contract is still refused after unwrapping',async()=>{
  const wrong={...payload,reviewed_scope:[{quote:'NOT_IN_ARTIFACT',assessment:'Synthetic'}]};
  assert.equal((await invoke(events1091(fenced(JSON.stringify(wrong))))).status,'invalid_output');
  assert.equal((await invoke(events1091(fenced(JSON.stringify({...payload,review_status:'pending'}))))).status,'invalid_output');
});
console.log(JSON.stringify({passed:checks.filter(c=>c.passed).length,total:checks.length,checks},null,2));
if(checks.some(c=>!c.passed))process.exitCode=1;
