#!/usr/bin/env node
// 1.17 A4.2: when an answer fails the quotation rule, the PRIVATE attempt record keeps, for each
// failing quote, its SHA-256, its length and its first 80 characters after the usual redaction, plus
// the normalisation steps tried. Never the whole answer, and nothing new in the public report.
// Synthetic answers only, through the real invokeWithRetry and attempt seams; no provider is asked.
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
import * as contract from './review-contract.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives

const source = fs.readFileSync(fileURLToPath(new URL('./multi-review.mjs', import.meta.url)), 'utf8');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: String(error?.message ?? error).split('\n')[0].slice(0, 400) }); }
}
// The production redaction, not a copy of it.
const sanitizeText = vm.runInNewContext(source.slice(source.indexOf('function sanitizeText('), source.indexOf('function platformCommand(')) + ';sanitizeText', {});
const secret = 'ghp_' + 'z'.repeat(32);
const artifact = 'function mean(a) {\n  return a.reduce((s, x) => s + x, 0) / a.length;\n}\n';
const invented = `const token = "${secret}"; // this line was never in the artifact, and it is long enough to be clipped at eighty`;
const answer = (scope) => ({ review_status: 'complete', verdict: 'ACCEPT', confidence: 0.5, summary: 'SUMMARY_MARKER the mean is assessed.', reviewed_scope: scope,
  findings: [], suggested_improvements: ['IMPROVEMENT_MARKER keep the divisor'] });
const invalid = answer([{ quote: 'a.length', assessment: 'ASSESSMENT_MARKER the divisor.' }, { quote: invented, assessment: 'ASSESSMENT_MARKER invented.' }]);

await check('quotationDiagnostics describes only the failing quote: hash, length, redacted 80-character prefix, steps tried', () => {
  assert.equal(typeof contract.quotationDiagnostics, 'function', 'review-contract.mjs must export quotationDiagnostics');
  assert(contract.reviewProblem(invalid, artifact), 'the synthetic answer must fail the quotation rule');
  const rows = contract.quotationDiagnostics(invalid, artifact, { redact: (text) => sanitizeText(text).value });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.index, 1);
  assert.equal(row.reason, 'not_found');
  assert.equal(row.sha256, sha(invented));
  assert.equal(row.length, [...invented].length);
  assert.equal([...row.prefix].length, 80);
  assert.equal(row.prefix, [...sanitizeText(invented).value].slice(0, 80).join(''));
  assert(!row.prefix.includes(secret) && row.prefix.includes('[REDACTED]'));
  assert.deepEqual(row.steps_tried, ['exact', 'line_endings', 'look_alikes_and_whitespace']);
  assert.deepEqual(Object.keys(row).sort(), ['index', 'length', 'prefix', 'reason', 'sha256', 'steps_tried']);
});
// Peer contract /3: an attachment observation is not a quote. It is judged by reviewProblem against the
// attachments sent (its own parameter) and never described as a failing quote.
await check('contract /3: attachment observations are skipped; only the failing quote is described, by its own index', () => {
  const attachment = { sha256: 'b'.repeat(64), modality: 'image', width: 64, height: 64 };
  const observation = { attachment_sha256: attachment.sha256, observation: 'OBSERVATION_MARKER a red square', assessment: 'ASSESSMENT_MARKER matches the brief' };
  const payload = answer([{ quote: 'a.length', assessment: 'fine' }, observation, { quote: invented, assessment: 'ASSESSMENT_MARKER invented.' }]);
  assert.equal(contract.reviewProblem({ ...payload, reviewed_scope: payload.reviewed_scope.slice(0, 2) }, artifact, { attachments: [attachment] }), null, 'the observation alone is valid with its attachment');
  assert(contract.reviewProblem(payload, artifact, { attachments: [attachment] }), 'the invented quote is refused');
  const rows = contract.quotationDiagnostics(payload, artifact, { redact: (text) => sanitizeText(text).value });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].index, 2);
  assert.equal(rows[0].sha256, sha(invented));
  assert(!JSON.stringify(rows).includes('OBSERVATION_MARKER'));
  assert(contract.reviewProblem(payload, artifact), 'an observation with no attachment sent is still refused');
  assert.equal(contract.quotationDiagnostics({ ...payload, reviewed_scope: payload.reviewed_scope.slice(0, 2) }, artifact).length, 0, 'a refused observation is not a quotation failure');
});
await check('a valid answer, or one refused for another reason, has no quotation diagnostics', () => {
  const rows = (payload) => contract.quotationDiagnostics(payload, artifact, { redact: (t) => sanitizeText(t).value });
  assert.deepEqual(rows(answer([{ quote: 'a.length', assessment: 'fine' }])), []);
  assert.deepEqual(rows({ ...answer([{ quote: 'a.length', assessment: 'fine' }]), verdict: 'MAYBE' }), []);
  const odd = rows(answer([{ quote: 42, assessment: 'not text' }]));
  assert.equal(odd.length, 1); assert.equal(odd[0].reason, 'not_text'); assert.equal(odd[0].sha256, null); assert.equal(odd[0].prefix, null);
});

// The real retry seam and the real attempt writer, with an invoker that returns what the dispatcher
// returns for this refusal (the production line is asserted below).
const seam = vm.runInNewContext(source.slice(source.indexOf('const PROVIDER_RETRY_DELAY_MS'), source.indexOf('function createUi(')) + ';({invokeWithRetry, quotationEvidence: typeof quotationEvidence === "function" ? quotationEvidence : null})',
  { setTimeout, sanitizeText, reviewProblem: contract.reviewProblem, quotationDiagnostics: contract.quotationDiagnostics });
const root = privateTestFixture('momm-quotation-diagnostics-test-');
try {
  preparePrivateEvidence(path.join(root, '.ensemble_reviews'));
  await check('the production refusal carries the diagnostics from the validator to the attempt seam', () => {
    assert.equal(typeof seam.quotationEvidence, 'function', 'multi-review.mjs must define quotationEvidence beside invokeWithRetry');
    const refusal = source.slice(source.indexOf('  const problem = result.outputLimited ?'), source.indexOf('\n', source.indexOf('\n', source.indexOf('  const problem = result.outputLimited ?')) + 1));
    assert.match(refusal, /quotationEvidence\(payload, artifact\)/, 'the invalid_output return must attach quotationEvidence(payload, artifact)');
  });
  const saved = [];
  let returned = null;
  await check('a synthetic invalid answer through invokeWithRetry writes the diagnostics to the private attempt record only', async () => {
    let calls = 0;
    const invoker = async (agent, text) => {
      calls += 1;
      const problem = contract.reviewProblem(invalid, text);
      return { agent, status: 'invalid_output', detail: problem, ...seam.quotationEvidence(invalid, text) };
    };
    const options = { retryInvalid: true, onAttempt: (row) => {
      const record = attemptRecord(row, { runId: 'rev_quotation_fixture', piece: 'whole', inputHash: sha(artifact), pieceHash: sha(artifact), ordinal: row.ordinal, durationMs: row.duration_ms, startedAt: row.started_at });
      saved.push(persistAttempt(root, record));
    } };
    returned = await seam.invokeWithRetry(invoker, 'codex', artifact, options, null, async () => {});
    assert.equal(calls, 2, 'one retry with --retry-invalid');
    assert.equal(saved.length, 2);
    for (const reference of saved) {
      const text = fs.readFileSync(path.join(root, reference.path), 'utf8'), record = JSON.parse(text);
      assert.equal(record.outcome, 'invalid_output');
      assert.equal(record.quotation_diagnostics.length, 1);
      const [row] = record.quotation_diagnostics;
      assert.equal(row.sha256, sha(invented)); assert.equal(row.length, [...invented].length); assert.equal([...row.prefix].length, 80);
      assert.deepEqual(row.steps_tried, ['exact', 'line_endings', 'look_alikes_and_whitespace']);
      for (const marker of [secret, 'SUMMARY_MARKER', 'ASSESSMENT_MARKER', 'IMPROVEMENT_MARKER', invented.slice(0, 81)]) assert(!text.includes(marker), `attempt record must not keep ${marker.slice(0, 20)}`);
    }
  });
  await check('nothing new reaches the returned (public) result or the in-memory history', () => {
    assert(returned, 'seam result');
    const text = JSON.stringify(returned);
    assert.equal(Object.hasOwn(returned, 'quotation_diagnostics'), false);
    assert(!text.includes('quotation_diagnostics') && !text.includes(sha(invented)));
    assert.equal(returned.status, 'invalid_output');
    assert.equal(returned.retried_after, 'invalid_output');
  });
  // The report binds each attempt by its file's sha256 and repeats the record's public fields; the
  // private diagnostics stay out of the report and the completion validator and cumulative audit
  // still accept the binding.
  await check('the dispatcher binds attempts in the report without the private diagnostics', () => {
    const from = source.indexOf('        const reference = persistAttempt(process.cwd(), record);');
    assert(from > 0, 'attempt persistence line');
    const block = source.slice(from, source.indexOf('\n      },', from));
    assert.match(block, /quotation_diagnostics: _privateQuotes, \.\.\.bound/);
    assert.match(block, /attemptEvidence\.push\(\{ \.\.\.bound, evidence: reference \}\)/);
  });
  await check('governor and attempt-audit accept a record whose private diagnostics are absent from the report', async () => {
    const { inspectCompletion } = await import('./governor.mjs');
    const { auditAttempts } = await import('./attempt-audit.mjs');
    const reference = saved[0];
    const stored = JSON.parse(fs.readFileSync(path.join(root, reference.path), 'utf8'));
    const { quotation_diagnostics: _hidden, ...bound } = stored;
    const runId = 'rev_quotation_fixture';
    fs.writeFileSync(path.join(root, 'mean.js'), artifact);
    const { captureSourceSnapshot } = await import('./governor.mjs');
    const report = { run_id: runId, input_sha256: sha(artifact), governor: 'claude', reviewers: [{ agent: 'codex', status: 'invalid_output' }], findings: [],
      source_snapshot: captureSourceSnapshot(root, artifact, 'mean.js'), quorum: { required: 1, achieved: 0, met: false }, gate_policy: { strict: false, quorum_required: 1, requested_routes: ['codex'] },
      attempt_evidence: [{ ...bound, evidence: reference }] };
    const text = JSON.stringify(report, null, 2) + '\n';
    assert(!text.includes('quotation_diagnostics') && !text.includes(sha(invented)), 'the report carries nothing new');
    fs.mkdirSync(path.join(root, '.ensemble_reviews', 'reports'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(root, '.ensemble_reviews', 'reports', `${runId}.json`), text, { mode: 0o600 });
    fs.writeFileSync(path.join(root, '.ensemble_reviews', 'review-log.jsonl'), JSON.stringify({ run_id: runId, report_path: `.ensemble_reviews/reports/${runId}.json`, report_sha256: sha(text), input_sha256: sha(artifact) }) + '\n', { mode: 0o600 });
    const state = inspectCompletion(root, runId);
    assert(!state.errors.some((e) => /attempt/.test(e)), JSON.stringify(state.errors));
    assert.deepEqual(state.attempts, [reference]);
    const audit = auditAttempts(root, [runId]);
    assert.equal(audit.attempts.length, 1);
  });
  await check('attemptRecord keeps only the diagnostic fields, bounded', () => {
    const hostile = { agent: 'codex', status: 'invalid_output', quotation_diagnostics: Array.from({ length: 30 }, (_, i) => ({ index: i, reason: 'not_found', sha256: 'a'.repeat(64), length: 5, prefix: 'x'.repeat(500), steps_tried: ['exact'], answer: 'WHOLE_ANSWER_MARKER' })) };
    const record = attemptRecord(hostile, { runId: 'rev_quotation_fixture', piece: 'whole', inputHash: sha('x'), pieceHash: sha('x'), ordinal: 1, durationMs: 1, startedAt: new Date().toISOString() });
    assert.equal(record.quotation_diagnostics.length, 12);
    assert(!JSON.stringify(record).includes('WHOLE_ANSWER_MARKER'));
    assert(record.quotation_diagnostics.every((row) => [...row.prefix].length <= 80));
    const plain = attemptRecord({ agent: 'codex', status: 'success' }, { runId: 'rev_quotation_fixture', piece: 'whole', inputHash: sha('x'), pieceHash: sha('x'), ordinal: 1, durationMs: 1, startedAt: new Date().toISOString() });
    assert.equal(Object.hasOwn(plain, 'quotation_diagnostics'), false, 'records without a quotation failure are unchanged');
  });
} finally {
  const resolved = path.resolve(root), temporary = path.resolve(os.tmpdir());
  assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('momm-quotation-diagnostics-test-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
// 1.17 A4.2 follow-through: the gate-3 diagnostic run (rev_20260930003709_e5847282134d) showed that 31
// of Codex's 55 refused quotes were several lines of one side of a diff copied without the diff's
// one-character line markers. Such a quote is an exact excerpt of the new (or old) file, which the
// diff fully determines, so it counts; a quote that mixes sides or crosses hunks never does.
const diffArtifact = [
  'diff --git a/src/a.mjs b/src/a.mjs',
  '--- a/src/a.mjs',
  '+++ b/src/a.mjs',
  '@@ -1,4 +1,5 @@',
  ' export function mean(a) {',
  '-  return a.reduce((s, x) => s + x, 0) / a.length;',
  '+  if (!a.length) return null;',
  '+  return a.reduce((s, x) => s + x, 0) / a.length;',
  ' }',
  '@@ -20,2 +21,2 @@',
  ' const tail = 1;',
  '+const next = 2;',
  '',
].join('\n');
const scoped = (quote) => [{ quote, assessment: 'ASSESSMENT_MARKER the change.' }];
await check('a markerless quote of the new side of one hunk counts', () => {
  const quote = 'export function mean(a) {\n  if (!a.length) return null;\n  return a.reduce((s, x) => s + x, 0) / a.length;';
  assert.equal(diffArtifact.includes(quote), false, 'the fixture quote must not match the raw diff');
  assert.equal(contract.scopeProblem(scoped(quote), diffArtifact), null);
  assert.deepEqual(contract.quotationDiagnostics(answer(scoped(quote)), diffArtifact), []);
});
await check('a markerless quote of the old side of one hunk counts', () => {
  const quote = 'export function mean(a) {\n  return a.reduce((s, x) => s + x, 0) / a.length;\n}';
  assert.equal(contract.scopeProblem(scoped(quote), diffArtifact), null);
});
await check('a quote that mixes removed and added lines is refused, and its diagnostic names the diff step', () => {
  const quote = '  return a.reduce((s, x) => s + x, 0) / a.length;\n  if (!a.length) return null;';
  assert.match(contract.scopeProblem(scoped(quote), diffArtifact) ?? '', /quote the supplied artifact exactly/);
  const [row] = contract.quotationDiagnostics(answer(scoped(quote)), diffArtifact);
  assert.equal(row?.reason, 'not_found');
  assert.deepEqual(row.steps_tried, ['exact', 'line_endings', 'look_alikes_and_whitespace', 'diff_one_side']);
});
// Final review of 1.17.0 (rev_20260930034635_c08cfb6df42f, governor note): attempts.mjs kept only the first three
// step names, so the private attempt record understated the comparisons tried for a diff artifact.
await check('the private attempt record keeps the diff step the diagnostic reports, and still drops unknown steps', () => {
  const quote = '  return a.reduce((s, x) => s + x, 0) / a.length;\n  if (!a.length) return null;';
  const rows = contract.quotationDiagnostics(answer(scoped(quote)), diffArtifact);
  const record = attemptRecord({ agent: 'codex', status: 'invalid_output', quotation_diagnostics: [{ ...rows[0], steps_tried: [...rows[0].steps_tried, 'invented_step'] }] },
    { runId: 'rev_quotation_fixture', piece: 'whole', inputHash: sha('x'), pieceHash: sha('x'), ordinal: 1, durationMs: 1, startedAt: new Date().toISOString() });
  assert.deepEqual(record.quotation_diagnostics[0].steps_tried, ['exact', 'line_endings', 'look_alikes_and_whitespace', 'diff_one_side']);
});
await check('a markerless quote that crosses two hunks is refused', () => {
  assert.match(contract.scopeProblem(scoped('}\nconst tail = 1;'), diffArtifact) ?? '', /quote the supplied artifact exactly/);
});
await check('text that is not a unified diff gets no markerless comparison', () => {
  const notDiff = 'notes\n+ first point\n+ second point\n';
  assert.match(contract.scopeProblem(scoped('first point\n second point'), notDiff) ?? '', /quote the supplied artifact exactly/);
  assert.match(contract.scopeProblem(scoped(' first point\n second point'), notDiff) ?? '', /quote the supplied artifact exactly/);
});

const failed = checks.filter((c) => !c.passed);
console.log(JSON.stringify({ node: process.version, passed: checks.length - failed.length, total: checks.length, checks }, null, 2));
process.exitCode = failed.length ? 1 : 0;
