#!/usr/bin/env node
// MOMM 1.17.1 S1 and S2. S1: the whole-answer fence rule lives in review-answer.mjs and one matrix of
// answers (bare, fenced, fenced with prose, two blocks, tilde fence, other language tag, broken JSON)
// runs against every route's parser. Two kinds of parser exist and the matrix records what each kind
// accepts: Copilot and Antigravity read one answer string strictly; Claude, Codex, Gemini and Grok
// extract the last review object from text (unchanged). Nothing is repaired on either.
// S2: an answer refused as not JSON leaves its shape (length, fence at the start and end, parser error
// position, redacted 80-character prefix) in the PRIVATE attempt record only. Never the answer, and
// nothing new in the returned result, the in-memory history or the report.
// Synthetic answers only, through the real adapters, retry seam and attempt writer; no provider is asked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { privateTestFixture } from './private-test-fixture.mjs';
import { preparePrivateEvidence } from './evidence-permissions.mjs';
import { attemptRecord, persistAttempt } from './attempts.mjs';
import { PEER_CONTRACT, reviewProblem, quotationDiagnostics } from './review-contract.mjs';
import { assemblePrompt } from './guidance.mjs';
import * as isolation from './route-isolation.mjs';
import * as grokStream from './grok-stream.mjs';
let reviewAnswer = {}; try { reviewAnswer = await import('./review-answer.mjs'); } catch { /* absent before 1.17.1 S1 */ }

const source = fs.readFileSync(fileURLToPath(new URL('./multi-review.mjs', import.meta.url)), 'utf8');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: String(error?.message ?? error).split('\n')[0].slice(0, 400) }); }
}
const between = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert(a >= 0 && b > a, `${from} not found`); return source.slice(a, b); };
// The production redaction, not a copy of it.
const sanitizeText = vm.runInNewContext(between('function sanitizeText(', 'function platformCommand(') + ';sanitizeText', {});

const root = privateTestFixture('momm-review-answer-test-');
let sequence = 0;
// The real adapters, sliced as the transport suites slice them, with the real shared functions.
function adapter() {
  const temporary = path.join(root, `adapter-${++sequence}`); fs.mkdirSync(temporary);
  const context = vm.createContext({ fs, os: { tmpdir: () => temporary, homedir: () => temporary }, path, process, Buffer, PEER_CONTRACT, reviewProblem, assemblePrompt,
    createEvidenceWorkspace: (prefix) => fs.mkdtempSync(path.join(temporary, prefix)), requirePrivateScratch: () => {},
    VALID_VERDICTS: new Set(['ACCEPT', 'MODIFY', 'REJECT']), VALID_SEVERITIES: new Set(['CRITICAL', 'WARNING', 'NITPICK']),
    attachmentRouting: () => [], attachmentContractSection: () => '', buildContract: () => 'Synthetic contract',
    agentTimeoutMs: (_agent, ms) => ms, cleanOauthEnv: () => ({}), parseUsage: () => ({ reported: null }), LOGIN_HINTS: {},
    sanitizeText, antigravityCommand: () => 'agy', grokCommand: () => 'grok', REVIEW_JSON_SCHEMA: { type: 'object' },
    grokIsolationEnv: isolation.grokIsolationEnv, codexIsolationArgs: isolation.codexIsolationArgs, codexReviewArgs: isolation.codexReviewArgs,
    quotationDiagnostics, ...grokStream, ...reviewAnswer });
  vm.runInContext(between('function quotationEvidence(', '\n// Live progress display'), context);
  vm.runInContext(between('function extractJsonObjects(', '\nfunction fingerprint(') + ';this.invoke=invokeReviewer;this.antigravityPayload=antigravityStreamPayload;', context);
  return context;
}

const artifact = 'export function average(xs) {\n  return xs.reduce((a, b) => a + b, 0) / xs.length;\n}\n';
const payload = { review_status: 'complete', reviewed_scope: [{ quote: 'export function average(xs) {', assessment: 'The whole function was read.' }],
  verdict: 'ACCEPT', confidence: 0.8, findings: [], summary: 'Synthetic valid review.', suggested_improvements: [] };
const good = JSON.stringify(payload), earlier = JSON.stringify({ ...payload, summary: 'An earlier block.' });
const FENCE = '`'.repeat(3), TILDE = '~'.repeat(3);
const fenced = (body, tag = 'json', mark = FENCE) => `${mark}${tag}\n${body}\n${mark}`;

// One matrix for every route. `strict` is what the whole-answer rule accepts (Copilot, Antigravity);
// `extracting` is what the object-extracting routes accept today (Claude, Codex, Gemini, Grok).
const MATRIX = [
  { name: 'bare', answer: good, strict: true, extracting: true },
  { name: 'fenced', answer: fenced(good), strict: true, extracting: true },
  { name: 'fenced, no language tag', answer: fenced(good, ''), strict: true, extracting: true },
  { name: 'fenced, tag in capitals', answer: fenced(good, 'JSON'), strict: true, extracting: true },
  { name: 'fenced, CRLF line endings', answer: fenced(good).replaceAll('\n', '\r\n'), strict: true, extracting: true },
  { name: 'fenced with prose before', answer: `Here is my review:\n${fenced(good)}`, strict: false, extracting: true },
  { name: 'fenced with prose after', answer: `${fenced(good)}\nHope that helps.`, strict: false, extracting: true },
  // The extracting routes take the last review object; the strict rule refuses a second block.
  { name: 'two blocks', answer: `${fenced(earlier)}\n${fenced(good)}`, strict: false, extracting: true },
  { name: 'a fence line inside the block', answer: fenced(`${earlier}\n${FENCE}\n${good}`), strict: false, extracting: true },
  { name: 'tilde fence', answer: fenced(good, 'json', TILDE), strict: false, extracting: true },
  { name: 'other language tag', answer: fenced(good, 'javascript'), strict: false, extracting: true },
  { name: 'broken JSON', answer: fenced(good.slice(0, -1)), strict: false, extracting: false },
  { name: 'broken JSON, bare', answer: good.slice(0, -1), strict: false, extracting: false },
  { name: 'JSON text of the review as a string', answer: fenced(JSON.stringify(good)), strict: false, problem: 'not_object', extracting: false },
];

// Each route's own output shape around one answer string, as its transport suite builds it.
const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
const copilotStream = (content) => jsonl([{ type: 'session.info', data: {} }, { type: 'user.message', data: { content: 'SOURCE' } },
  { type: 'assistant.turn_start', data: { turnId: 'answer-turn' } }, { type: 'model.call_start', data: {} }, { type: 'model.call_finished', data: {} },
  { type: 'assistant.message', data: { turnId: 'answer-turn', content, toolRequests: [] } },
  { type: 'model.call_final_result', data: { model: 'synthetic-model', isByok: false, result: 'success' } },
  { type: 'assistant.turn_end', data: { turnId: 'answer-turn' } }, { type: 'assistant.idle', data: {} }, { type: 'result', exitCode: 0 }]);
const antigravityStream = (response) => jsonl([{ event: 'init', init: { cwd: 'synthetic' } }, { event: 'step_update', step_update: { text_delta: 'progress' } }, { event: 'result', result: { status: 'SUCCESS', response } }]);
const grokLines = (text) => { const size = Math.ceil(text.length / 5) || 1; return jsonl([{ type: 'thought', data: 'thinking' },
  ...Array.from({ length: 5 }, (_unused, k) => ({ type: 'text', data: text.slice(k * size, (k + 1) * size) })), { type: 'end', stopReason: 'end_turn' }]); };
const ROUTES = {
  copilot: { kind: 'strict', stdout: copilotStream },
  antigravity: { kind: 'strict', stdout: antigravityStream },
  claude: { kind: 'extracting', stdout: (answer) => JSON.stringify({ type: 'result', is_error: false, result: answer }) },
  gemini: { kind: 'extracting', stdout: (answer) => JSON.stringify({ response: answer }) },
  codex: { kind: 'extracting', stdout: (answer) => answer },
  grok: { kind: 'extracting', stdout: grokLines },
};
const run = (route, stdout, extra = {}) => adapter().invoke(route, artifact, { governor: 'other', timeoutMs: 60000, grokModelProbe: Promise.resolve(null), ...extra,
  runProcess: async () => ({ code: 0, stdout, stderr: '' }) });

// What the parser was given decides the position; this Node's own message is the reference.
const runtimePosition = (text) => { try { JSON.parse(text); return null; } catch (error) { const m = / in JSON at position (\d+)(?: \(line \d+ column \d+\))?$/.exec(String(error.message)); return m ? Number(m[1]) : null; } };
const SHAPE_KEYS = ['ends_with_fence', 'length', 'parse_error_position', 'prefix', 'starts_with_fence'];
const secret = 'ghp_' + 'z'.repeat(32);
const notJson = `I could not complete this review; the token ${secret} was in the notes. ${'padding '.repeat(8)}ANSWER_TAIL_MARKER and more text after it.`;

try {
  preparePrivateEvidence(path.join(root, '.ensemble_reviews'));

  // ---- S1 ----
  await check('S1: review-answer.mjs exports the one whole-answer rule, and it is pure', () => {
    assert.equal(typeof reviewAnswer.strictAnswer, 'function', 'review-answer.mjs must export strictAnswer');
    const before = fenced(good), first = reviewAnswer.strictAnswer(before), second = reviewAnswer.strictAnswer(before);
    assert.deepEqual(first, second); assert.deepEqual(first.payload, payload);
    assert.equal(reviewAnswer.strictAnswer(fenced('[1]')).problem, 'not_object');
    assert.equal(reviewAnswer.strictAnswer('null').problem, 'not_object');
    assert.equal(reviewAnswer.strictAnswer(fenced('{bad}')).problem, 'not_json');
    for (const value of [undefined, null, 5, {}, []]) assert.equal(reviewAnswer.strictAnswer(value).problem, 'not_json', 'only a string is an answer');
  });
  for (const row of MATRIX) {
    await check(`S1 matrix, the rule alone: ${row.name}`, () => {
      assert.equal(typeof reviewAnswer.strictAnswer, 'function', 'review-answer.mjs must export strictAnswer');
      const result = reviewAnswer.strictAnswer(row.answer);
      assert.equal(Boolean(result.payload), row.strict);
      if (row.strict) assert.deepEqual(result.payload, payload, 'the inside is returned unchanged');
      else assert.equal(result.problem, row.problem ?? 'not_json');
    });
    for (const [route, { kind, stdout }] of Object.entries(ROUTES)) {
      await check(`S1 matrix, ${route} (${kind}): ${row.name}`, async () => {
        const result = await run(route, stdout(row.answer));
        assert.equal(result.status, row[kind] ? 'success' : 'invalid_output', result.detail);
        if (row[kind]) { assert.equal(result.review.summary, payload.summary, 'nothing repaired, and the last block is the review'); assert.equal(result.review.review_contract, PEER_CONTRACT); }
        else assert(!result.review);
      });
    }
  }
  await check('S1: the Antigravity single-object path (attachments) reads its answer by the same rule', () => {
    const context = adapter();
    for (const row of MATRIX) {
      const parsed = context.antigravityPayload(JSON.stringify({ status: 'SUCCESS', response: row.answer }), false);
      assert.equal(Boolean(parsed.payload), row.strict, row.name);
      if (!row.strict) assert.equal(parsed.status, 'invalid_output', row.name);
    }
  });
  await check('S1: a fenced answer is still held to the full contract on both strict routes', async () => {
    const wrongQuote = { ...payload, reviewed_scope: [{ quote: 'NOT_IN_ARTIFACT', assessment: 'Synthetic' }] };
    for (const route of ['copilot', 'antigravity']) {
      assert.equal((await run(route, ROUTES[route].stdout(fenced(JSON.stringify(wrongQuote))))).status, 'invalid_output', route);
      assert.equal((await run(route, ROUTES[route].stdout(fenced(JSON.stringify({ ...payload, review_status: 'pending' }))))).status, 'invalid_output', route);
    }
  });
  await check('S1: the dispatcher holds no second copy of the fence rule', () => {
    const adapters = between('function copilotReviewPayload(', '\nfunction clipped(');
    assert(!adapters.includes('`'.repeat(3)), 'the fence pattern must live in review-answer.mjs only');
    assert.equal(adapters.split('strictAnswer(').length - 1, 2, 'Copilot and Antigravity each read their answer through strictAnswer');
    assert.equal(adapters.split('JSON.parse(').length - 1, 3, 'only the event lines are parsed here; the answer is parsed by strictAnswer');
  });

  // ---- S2 ----
  await check('S2: answerShape describes an answer without keeping it', () => {
    assert.equal(typeof reviewAnswer.answerShape, 'function', 'review-answer.mjs must export answerShape');
    const shape = reviewAnswer.answerShape(notJson, { redact: (text) => sanitizeText(text).value });
    assert.deepEqual(Object.keys(shape).sort(), SHAPE_KEYS);
    assert.equal(shape.length, [...notJson].length);
    assert.equal(shape.starts_with_fence, false); assert.equal(shape.ends_with_fence, false);
    assert.equal(shape.parse_error_position, runtimePosition(notJson));
    assert.equal(shape.prefix, [...sanitizeText(notJson).value].slice(0, 80).join(''));
    assert.equal([...shape.prefix].length, 80);
    assert(shape.prefix.includes('[REDACTED]') && !shape.prefix.includes(secret) && !JSON.stringify(shape).includes('ANSWER_TAIL_MARKER'));
  });
  await check('S2: fences are seen at either end, lengths are in characters, and the position is the parser\'s own', () => {
    assert.equal(typeof reviewAnswer.answerShape, 'function', 'review-answer.mjs must export answerShape');
    const prose = reviewAnswer.answerShape(`Here is my review:\n${fenced(good)}\n`);
    assert.equal(prose.starts_with_fence, false); assert.equal(prose.ends_with_fence, true);
    const trailing = reviewAnswer.answerShape(`\n${fenced(good)}\nHope that helps.`);
    assert.equal(trailing.starts_with_fence, true); assert.equal(trailing.ends_with_fence, false);
    const tilde = reviewAnswer.answerShape(fenced(good, 'json', TILDE));
    assert.equal(tilde.starts_with_fence, true); assert.equal(tilde.ends_with_fence, true);
    // The inside of a whole-answer fence is what the parser was given.
    const broken = reviewAnswer.answerShape(fenced('{"a":1,}'));
    assert.equal(broken.parse_error_position, runtimePosition('{"a":1,}'));
    assert([7, null].includes(broken.parse_error_position), 'a position is a character offset, or absent when this Node gives none');
    const astral = String.fromCodePoint(0x1F600).repeat(100);
    assert.equal(reviewAnswer.answerShape(astral).length, 100);
    assert.equal([...reviewAnswer.answerShape(astral).prefix].length, 80);
    // A number in the answer is never mistaken for the parser's position.
    assert.equal(reviewAnswer.answerShape('xposition 5').parse_error_position, runtimePosition('xposition 5'));
    assert.equal(reviewAnswer.answerShape('').length, 0);
  });
  const refusals = {
    copilot: /assistant answer is not strict JSON/, antigravity: /terminal answer is not strict JSON/, grok: /no JSON object in the final message/,
    claude: /JSON present but no findings\[\] object/, gemini: /JSON present but no findings\[\] object/, codex: /no JSON object in stdout/,
  };
  for (const [route, { stdout }] of Object.entries(ROUTES)) {
    await check(`S2: ${route} refuses a non-JSON answer and describes its shape for the private record`, async () => {
      const result = await run(route, stdout(notJson));
      assert.equal(result.status, 'invalid_output'); assert.match(result.detail, refusals[route]);
      assert(result.answer_shape, 'the refusal must carry answer_shape');
      assert.deepEqual(Object.keys(result.answer_shape).sort(), SHAPE_KEYS);
      assert.equal(result.answer_shape.length, [...notJson].length);
      assert.equal(result.answer_shape.prefix, [...sanitizeText(notJson).value].slice(0, 80).join(''));
      assert(!JSON.stringify(result.answer_shape).includes(secret) && !JSON.stringify(result.answer_shape).includes('ANSWER_TAIL_MARKER'));
      const brokenFence = await run(route, stdout(fenced(good.slice(0, -1))));
      assert.equal(brokenFence.status, 'invalid_output');
      assert.equal(brokenFence.answer_shape?.starts_with_fence, true); assert.equal(brokenFence.answer_shape?.ends_with_fence, true);
    });
  }
  await check('S2: a refusal for any other reason, and a success, carry no answer shape', async () => {
    const wrongQuote = JSON.stringify({ ...payload, reviewed_scope: [{ quote: 'NOT_IN_ARTIFACT', assessment: 'Synthetic' }] });
    for (const [route, { stdout }] of Object.entries(ROUTES)) {
      assert.equal(Object.hasOwn(await run(route, stdout(good)), 'answer_shape'), false, `${route} success`);
      const contract = await run(route, stdout(wrongQuote));
      assert.equal(contract.status, 'invalid_output'); assert.equal(Object.hasOwn(contract, 'answer_shape'), false, `${route} contract refusal`);
      // JSON that is not a review is JSON: the refusal says so and no shape is kept.
      const other = await run(route, stdout('{"plan":"first read the file"}'));
      assert.equal(other.status, 'invalid_output'); assert.equal(Object.hasOwn(other, 'answer_shape'), false, `${route} JSON without a review`);
      assert.equal(Object.hasOwn(await run(route, ''), 'answer_shape'), false, `${route} empty output`);
    }
    const list = await run('copilot', copilotStream('[1,2]'));
    assert.match(list.detail, /must be a JSON object/); assert.equal(Object.hasOwn(list, 'answer_shape'), false);
    const drift = await run('copilot', copilotStream(notJson).replace('"assistant.idle"', '"future.state"'));
    assert.match(drift.detail, /unrecognized event type/); assert.equal(Object.hasOwn(drift, 'answer_shape'), false);
    const torn = await run('grok', grokLines(notJson).replace('{"type":"end","stopReason":"end_turn"}\n', ''));
    assert.match(torn.detail, /without a final end/); assert.equal(Object.hasOwn(torn, 'answer_shape'), false);
  });
  // A second look (1.17 B5) is not written through the attempt seam, so nothing private may ride on it.
  await check('S2: a reply-contract call carries no answer shape', async () => {
    const replyContract = { contract: 'Synthetic second-look contract', problem: () => null, normalize: (value) => value };
    for (const [route, { stdout }] of Object.entries(ROUTES)) {
      const result = await run(route, stdout(notJson), { replyContract });
      assert.equal(result.status, 'invalid_output', route); assert.equal(Object.hasOwn(result, 'answer_shape'), false, route);
    }
  });

  // The real adapter, retry seam and attempt writer together.
  const seam = vm.runInNewContext(between('const PROVIDER_RETRY_DELAY_MS', 'function createUi(') + ';({invokeWithRetry})', { setTimeout, sanitizeText, reviewProblem, quotationDiagnostics });
  const saved = [];
  let returned = null;
  await check('S2: a non-JSON answer through invokeWithRetry writes its shape to the private attempt record only', async () => {
    let calls = 0;
    const invoker = (agent, text, options) => { calls += 1; return adapter().invoke(agent, text, { ...options, governor: 'other', timeoutMs: 60000, runProcess: async () => ({ code: 0, stdout: copilotStream(notJson), stderr: '' }) }); };
    const options = { retryInvalid: true, onAttempt: (row) => {
      const record = attemptRecord(row, { runId: 'rev_nonjson_fixture', piece: 'whole', inputHash: sha(artifact), pieceHash: sha(artifact), ordinal: row.ordinal, durationMs: row.duration_ms, startedAt: row.started_at });
      saved.push(persistAttempt(root, record));
    } };
    returned = await seam.invokeWithRetry(invoker, 'copilot', artifact, options, null, async () => {});
    assert.equal(calls, 2, 'one retry with --retry-invalid');
    assert.equal(saved.length, 2);
    for (const reference of saved) {
      const text = fs.readFileSync(path.join(root, reference.path), 'utf8'), record = JSON.parse(text);
      assert.equal(record.outcome, 'invalid_output');
      assert.deepEqual(Object.keys(record.answer_shape).sort(), SHAPE_KEYS);
      assert.equal(record.answer_shape.length, [...notJson].length);
      assert.equal(record.answer_shape.starts_with_fence, false); assert.equal(record.answer_shape.ends_with_fence, false);
      assert.equal(record.answer_shape.parse_error_position, runtimePosition(notJson));
      assert.equal([...record.answer_shape.prefix].length, 80);
      for (const marker of [secret, 'ANSWER_TAIL_MARKER', notJson.slice(0, 81)]) assert(!text.includes(marker), `attempt record must not keep ${marker.slice(0, 20)}`);
    }
  });
  await check('S2: nothing new reaches the returned (public) result or the in-memory history', () => {
    assert(returned, 'seam result');
    const text = JSON.stringify(returned);
    assert.equal(Object.hasOwn(returned, 'answer_shape'), false);
    assert(!text.includes('answer_shape') && !text.includes('starts_with_fence') && !text.includes('I could not complete'));
    assert.equal(returned.status, 'invalid_output'); assert.equal(returned.retried_after, 'invalid_output');
    assert.equal(returned.attempt_history.length, 2);
  });
  await check('S2: the dispatcher binds attempts in the report without the answer shape', () => {
    const from = source.indexOf('        const reference = persistAttempt(process.cwd(), record);');
    assert(from > 0, 'attempt persistence line');
    const block = source.slice(from, source.indexOf('\n      },', from));
    assert.match(block, /answer_shape: _privateShape, quotation_diagnostics: _privateQuotes, \.\.\.bound/);
    assert.match(block, /attemptEvidence\.push\(\{ \.\.\.bound, evidence: reference \}\)/);
  });
  await check('S2: governor and attempt-audit accept a record whose answer shape is absent from the report', async () => {
    assert(saved.length, 'an attempt record was written');
    const { inspectCompletion, captureSourceSnapshot } = await import('./governor.mjs');
    const { auditAttempts } = await import('./attempt-audit.mjs');
    const reference = saved[0];
    const stored = JSON.parse(fs.readFileSync(path.join(root, reference.path), 'utf8'));
    assert(stored.answer_shape, 'the stored record keeps the shape');
    const { answer_shape: _hidden, ...bound } = stored;
    const runId = 'rev_nonjson_fixture';
    fs.writeFileSync(path.join(root, 'average.js'), artifact);
    const report = { run_id: runId, input_sha256: sha(artifact), governor: 'claude', reviewers: [{ agent: 'copilot', status: 'invalid_output' }], findings: [],
      source_snapshot: captureSourceSnapshot(root, artifact, 'average.js'), quorum: { required: 1, achieved: 0, met: false }, gate_policy: { strict: false, quorum_required: 1, requested_routes: ['copilot'] },
      attempt_evidence: [{ ...bound, evidence: reference }] };
    const text = JSON.stringify(report, null, 2) + '\n';
    assert(!text.includes('answer_shape'), 'the report carries nothing new');
    fs.mkdirSync(path.join(root, '.ensemble_reviews', 'reports'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(root, '.ensemble_reviews', 'reports', `${runId}.json`), text, { mode: 0o600 });
    fs.writeFileSync(path.join(root, '.ensemble_reviews', 'review-log.jsonl'), JSON.stringify({ run_id: runId, report_path: `.ensemble_reviews/reports/${runId}.json`, report_sha256: sha(text), input_sha256: sha(artifact) }) + '\n', { mode: 0o600 });
    const state = inspectCompletion(root, runId);
    assert(!state.errors.some((e) => /attempt/.test(e)), JSON.stringify(state.errors));
    assert.deepEqual(state.attempts, [reference]);
    assert.equal(auditAttempts(root, [runId]).attempts.length, 1);
  });
  await check('S2: attemptRecord keeps only the known shape fields, bounded and typed', () => {
    const at = { runId: 'rev_nonjson_fixture', piece: 'whole', inputHash: sha('x'), pieceHash: sha('x'), ordinal: 1, durationMs: 1, startedAt: new Date().toISOString() };
    const hostile = attemptRecord({ agent: 'codex', status: 'invalid_output', answer_shape: { length: 9000, starts_with_fence: 'yes', ends_with_fence: true, parse_error_position: -4, prefix: 'x'.repeat(500), answer: 'WHOLE_ANSWER_MARKER', error: 'PARSER_MESSAGE_MARKER' } }, at);
    assert.deepEqual(Object.keys(hostile.answer_shape ?? {}).sort(), SHAPE_KEYS);
    assert.deepEqual({ ...hostile.answer_shape, prefix: null }, { length: 9000, starts_with_fence: false, ends_with_fence: true, parse_error_position: null, prefix: null });
    assert.equal([...hostile.answer_shape.prefix].length, 80);
    assert(!JSON.stringify(hostile).includes('WHOLE_ANSWER_MARKER') && !JSON.stringify(hostile).includes('PARSER_MESSAGE_MARKER'));
    for (const odd of [null, undefined, 'text', [], 7]) assert.equal(Object.hasOwn(attemptRecord({ agent: 'codex', status: 'invalid_output', answer_shape: odd }, at), 'answer_shape'), false);
    assert.equal(Object.hasOwn(attemptRecord({ agent: 'codex', status: 'success' }, at), 'answer_shape'), false, 'records without a non-JSON refusal are unchanged');
  });
} finally {
  // Real paths on both sides: a hosted runner's temp folder is a short or linked name.
  const resolved = fs.realpathSync.native(root), temporary = fs.realpathSync.native(os.tmpdir());
  assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('momm-review-answer-test-'));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

const failed = checks.filter((c) => !c.passed);
console.log(JSON.stringify({ node: process.version, passed: checks.length - failed.length, total: checks.length, checks: failed.length ? failed : undefined }, null, 2));
process.exitCode = failed.length ? 1 : 0;
