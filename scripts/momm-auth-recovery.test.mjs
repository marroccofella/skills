import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../momm/scripts/multi-review.mjs',import.meta.url),'utf8');
const extract=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);};
const context=vm.createContext({});
vm.runInContext(extract('function extractJsonObjects(', '\nfunction clipped(')
 +extract('function clipped(', '\nfunction normalizeReview(')
 +extract('function classifyFailure(', '\nasync function invokeReviewer('),context);
const result={code:1,stdout:JSON.stringify({type:'result',is_error:true,result:'Failed to authenticate: OAuth session expired and could not be refreshed',session_id:'synthetic-private-marker'}),stderr:''};
context.input=result;
const failure=vm.runInContext('classifyFailure(input)',context);
assert.equal(failure.status,'authentication_required','Expired OAuth sessions need official browser-login guidance');
assert(!failure.detail.includes('synthetic-private-marker'),'Auth diagnostics must not echo the provider envelope');
for(const [text,status] of [['OAuth session refreshed successfully; unrelated failure','error'],['OAuth session expired; 503 service unavailable','provider_unavailable'],['Please sign in to continue','authentication_required']]){
 context.input={code:1,stdout:text,stderr:''};assert.equal(vm.runInContext('classifyFailure(input).status',context),status);
}
context.input={...result,timedOut:true};assert.equal(vm.runInContext('classifyFailure(input).status',context),'timeout');
// A CLI that echoes its session banner and the whole prompt to stderr before failing puts the real
// error LAST. Keeping the first 1200 characters stored the banner and the prompt and never the error:
// every codex failure on 23 and 24 September 2026 looked exactly like that, so neither the governor
// nor an independent reviewer could say why the route failed.
{
  const echoed = 'OpenAI Codex v0.154.0\n--------\nworkdir: /synthetic\nuser\n' + 'You are a read-only peer code reviewer. '.repeat(400);
  context.input = { code: 1, stdout: '', stderr: echoed + '\nERROR: synthetic-final-diagnostic: the run ended unexpectedly' };
  const failure = vm.runInContext('classifyFailure(input)', context);
  assert.equal(failure.status, 'error');
  assert.match(failure.detail, /synthetic-final-diagnostic/, 'the end of the output, where the error is, must survive');
  assert.ok(failure.detail.length <= 1200, 'the detail stays bounded');
  context.input = { code: 1, stdout: '', stderr: 'short failure' };
  assert.equal(vm.runInContext('classifyFailure(input)', context).detail, 'short failure', 'short output is kept whole, with no marker');
}
console.log('Expired OAuth sessions receive safe browser-login guidance; outage and timeout precedence remain unchanged.');
