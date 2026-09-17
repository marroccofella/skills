// Offline native-shape transport regressions; no accounts or model calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { PEER_CONTRACT, reviewProblem } from './review-contract.mjs';
import { assemblePrompt } from './guidance.mjs';
const source=fs.readFileSync(new URL('./multi-review.mjs',import.meta.url),'utf8');
const start=source.indexOf('function extractJsonObjects('),end=source.indexOf('\nfunction fingerprint(',start);
assert(start>=0&&end>start,'Inspect changed adapter extraction boundaries');
const context=vm.createContext({fs,os,path,process,Buffer,PEER_CONTRACT,reviewProblem,assemblePrompt,
  createEvidenceWorkspace:prefix=>fs.mkdtempSync(path.join(os.tmpdir(),prefix)),
  VALID_VERDICTS:new Set(['ACCEPT','MODIFY','REJECT']),VALID_SEVERITIES:new Set(['CRITICAL','WARNING','NITPICK']),
  attachmentRouting:()=>[],attachmentContractSection:()=>'',buildContract:()=> 'Synthetic review contract',
  agentTimeoutMs:(_a,ms)=>ms,cleanOauthEnv:()=>({}),parseUsage:()=>({reported:null}),LOGIN_HINTS:{copilot:'copilot login'},
  sanitizeText:s=>({value:s})});
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
await test('rendered text, quoted JSON, fences and literal newlines are not repaired',async()=>{
  for(const content of [JSON.stringify(JSON.stringify(payload)),'```json\n'+JSON.stringify(payload)+'\n```','{"findings":[],"summary":"literal\nnewline"}'])assert.equal((await invoke(events(content))).status,'invalid_output');
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
console.log(JSON.stringify({passed:checks.filter(c=>c.passed).length,total:checks.length,checks},null,2));
if(checks.some(c=>!c.passed))process.exitCode=1;
