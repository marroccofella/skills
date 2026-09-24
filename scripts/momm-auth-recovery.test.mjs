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
// Keeping the END of a failure (above) must not keep what MOMM itself sent. Codex echoes the whole
// prompt, reviewed artifact included, before its error; a report keeps the artifact only with
// --store-input, and a live probe of 13315f2 showed the reviewed code inside a failure detail without
// it. Every line MOMM sent is removed before anything is classified or kept.
{
  const artifact = 'export const add = (a, b) => a + b;\nconst PRIVATE_MARKER_LINE = 42;';
  context.sent = 'You are a read-only peer code reviewer.\n--- ARTIFACT TO REVIEW ---\n' + artifact;
  // Real Codex output carries a long preamble MOMM did not send (banner, workdir, model, session id),
  // so the provider's reason is far from the start; a short fixture would hide which end is kept.
  const preamble = Array.from({ length: 30 }, (_, i) => 'synthetic codex preamble line ' + i + ' that MOMM did not send').join('\n');
  const echo = 'OpenAI Codex v0.154.0\n' + preamble + '\nuser\n' + context.sent + '\n';
  context.input = { code: 1, stdout: '', stderr: echo + 'ERROR: synthetic-final-diagnostic: the run ended unexpectedly' };
  const generic = vm.runInContext('classifyFailure(input, "codex", sent)', context);
  assert.match(generic.detail, /synthetic-final-diagnostic/, 'the provider error survives');
  assert.doesNotMatch(generic.detail, /PRIVATE_MARKER_LINE|export const add/, 'no line of the reviewed artifact is kept without --store-input');
  context.input = { code: 1, stdout: '', stderr: echo + 'ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-6-luna\' model is not supported when using Codex with a ChatGPT account."}}' };
  const model = vm.runInContext('classifyFailure(input, "codex", sent)', context);
  assert.match(model.detail, /CLI\/model compatibility/, 'a model the account cannot use is a configuration error with fixed advice');
  assert.doesNotMatch(model.detail, /PRIVATE_MARKER_LINE|export const add/, 'and it keeps no line of the reviewed artifact');
  assert.match(model.detail, /model is not supported when using Codex with a ChatGPT account/, 'the provider\'s own reason is quoted, not the preamble before it');
}
console.log('Expired OAuth sessions receive safe browser-login guidance; outage and timeout precedence remain unchanged.');
