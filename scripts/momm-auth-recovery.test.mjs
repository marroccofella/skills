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
// The synthetic artifact avoids names that read as credentials (secret, token, key, password):
// the publication scanner refuses such assignments in any file, and it refused an earlier draft.
// Line-exact removal is not enough (independent review of 7212f33): a CLI may prefix, timestamp,
// JSON-escape or wrap what it echoes, and each of those kept the reviewed code in the stored detail.
// Whatever the echo looks like, no fragment of the artifact may be kept, and the error must survive.
{
  const artifact = ['export function transferFunds(fromAccount, toAccount, amountInPence) {', '  const ROUTING_MARKER_FOR_TEST = "ledger-route-7731";', '  return ledger.move(fromAccount, toAccount, amountInPence);', '}'].join('\n');
  context.sent = 'You are a read-only peer code reviewer.\n--- ARTIFACT TO REVIEW ---\n' + artifact;
  const error = 'ERROR: synthetic-final-diagnostic: the run ended unexpectedly';
  const shapes = {
    'exact lines': context.sent,
    'prefixed lines': context.sent.split('\n').map((l) => '> ' + l).join('\n'),
    'timestamped log lines': context.sent.split('\n').map((l) => '2026-09-24T20:00:00Z INFO ' + l).join('\n'),
    'one JSON-escaped event line': JSON.stringify({ type: 'user_message', text: context.sent }),
    'lines wrapped at 40 columns': context.sent.replace(/(.{40})/g, '$1\n'),
  };
  for (const [shape, echo] of Object.entries(shapes)) {
    context.input = { code: 1, stdout: '', stderr: echo + '\n' + error };
    const detail = vm.runInContext('classifyFailure(input, "codex", sent)', context).detail;
    for (const marker of ['ROUTING_MARKER_FOR_TEST', 'transferFunds', 'ledger.move', 'ledger-route-7731']) assert.ok(!detail.includes(marker), `${shape}: "${marker}" from the reviewed code was kept`);
    assert.match(detail, /synthetic-final-diagnostic/, `${shape}: the provider's own error survives`);
  }
}
// Delta review of 238584b (codex): a sent line shorter than eight characters, echoed with a prefix,
// survived, because only longer sent lines are searched for inside other lines. A prefix is now
// stripped and the rest must not equal ANY sent line. The provider error must still survive even
// though it ends in "}}" and the artifact holds a bare "}" line.
{
  const artifact = ['function check(input) {', '  pin=42;', '  x = 1;', '}'].join('\n');
  context.sent = 'You are a read-only peer code reviewer.\n--- ARTIFACT TO REVIEW ---\n' + artifact;
  const error = 'ERROR: {"type":"error","status":400,"error":{"message":"synthetic-final-diagnostic"}}';
  for (const [shape, echo] of Object.entries({
    'prefixed lines': context.sent.split('\n').map((l) => '> ' + l).join('\n'),
    'timestamped log lines': context.sent.split('\n').map((l) => '2026-09-24T20:00:00Z INFO ' + l).join('\n'),
  })) {
    context.input = { code: 1, stdout: '', stderr: echo + '\n' + error };
    const detail = vm.runInContext('classifyFailure(input, "codex", sent)', context).detail;
    assert.ok(!detail.includes('pin=42'), `${shape}: a short sent line was kept`);
    assert.ok(!/(^|\n)(> |\S+ INFO )x = 1;/.test(detail), `${shape}: a short sent line was kept`);
    assert.match(detail, /synthetic-final-diagnostic/, `${shape}: the provider's own error survives`);
  }
  // When every line is filtered, the compatibility branch says so instead of ending in 'Provider said: '.
  // The provider line is classified (it survives exact-line removal) but carries a sent line, so the
  // quote filter removes it and nothing is left to quote.
  context.input = { code: 1, stdout: '', stderr: 'function check(input) { -- The model is not supported when using Codex with a ChatGPT account.' };
  const allSent = vm.runInContext('classifyFailure(input, "codex", sent)', context).detail;
  assert.match(allSent, /CLI\/model compatibility/, 'the case reaches the compatibility branch');
  assert.doesNotMatch(allSent, /Provider said: *$/, 'no dangling Provider said:');
  assert.ok(!allSent.includes('function check'), 'and the sent line is still not quoted');
}
// Codex, 23 and 24 September 2026: "model is not supported when using Codex with a ChatGPT account" was
// the CLI being too old for the model the desktop app had selected, not a model the plan lacked. The
// advice must say to update the CLI, and must warn that the config is shared with the desktop app.
{
  context.sent = '';
  context.input = { code: 1, stdout: '', stderr: 'ERROR: {"type":"error","status":400,"error":{"message":"The \'gpt-6-luna\' model is not supported when using Codex with a ChatGPT account."}}' };
  const codex = vm.runInContext('classifyFailure(input, "codex", sent)', context);
  assert.equal(codex.status, 'error');
  assert.match(codex.detail, /CLI\/model compatibility/);
  assert.match(codex.detail, /npm install -g @openai\/codex@latest/, 'names the Codex CLI update');
  assert.match(codex.detail, /shared with the Codex desktop app/, 'warns against changing the shared model');
  const other = vm.runInContext('classifyFailure(input, "antigravity", sent)', context);
  assert.doesNotMatch(other.detail, /@openai\/codex/, 'Codex advice is never given for another route');
}
// Deferred from the delta review of 7a970f7 (antigravity): short sent lines behind a bracketed log
// level, a numeric timezone offset, or nested quote markers.
{
  context.sent = 'You are a read-only peer code reviewer.\n--- ARTIFACT TO REVIEW ---\nfunction check(input) {\n  pin=42;\n}';
  const error = 'ERROR: {"type":"error","status":400,"error":{"message":"synthetic-final-diagnostic"}}';
  for (const [shape, prefix] of [['bracketed level', '[INFO] '], ['timezone offset', '2026-09-24T20:00:00+01:00 INFO '], ['nested quotes', '> > '], ['bracketed level after a timestamp', '2026-09-24T20:00:00Z [warn] ']]) {
    context.input = { code: 1, stdout: '', stderr: context.sent.split('\n').map((l) => prefix + l).join('\n') + '\n' + error };
    const detail = vm.runInContext('classifyFailure(input, "codex", sent)', context).detail;
    assert.ok(!detail.includes('pin=42'), `${shape}: a short sent line was kept`);
    assert.match(detail, /synthetic-final-diagnostic/, `${shape}: the provider's own error survives`);
  }
}
console.log('Expired OAuth sessions receive safe browser-login guidance; outage and timeout precedence remain unchanged.');
