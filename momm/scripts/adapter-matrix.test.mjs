#!/usr/bin/env node
// MOMM 1.17.1 R2: one regression matrix of CLI output shapes for every route's parser.
//   fixtures/adapters/artifact.txt                        the text every fixture answer reviews
//   fixtures/adapters/<route>/<cli-version>/<case>.jsonl  what that CLI version printed on stdout (or .json)
//   fixtures/adapters/<route>/<cli-version>/expected.json the status each case must produce
// Adding a CLI version is adding a folder: this suite walks the tree, nothing here names a version to
// run. expected.json is { schema, route, cli_version, shape_from, cases: { "<file>": { process?, expect } } }.
// `process` is what the CLI process did besides stdout: exit_code (default 0; null for a killed
// process), stderr, timed_out. `expect` is status, and optionally a part of the detail and the verdict.
// Every fixture is synthetic and mirrors a shape the transport suites or a recorded capture show; the
// tree is kept byte for byte (.gitattributes) and scanned by scripts/momm-release-privacy.test.mjs.
// Zero providers: each case goes through the real adapter with a runProcess that returns the file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PEER_CONTRACT, reviewProblem, quotationDiagnostics } from './review-contract.mjs';
import { assemblePrompt } from './guidance.mjs';
import * as isolation from './route-isolation.mjs';
import * as grokStream from './grok-stream.mjs';
let reviewAnswer = {}; try { reviewAnswer = await import('./review-answer.mjs'); } catch { /* absent before 1.17.1 S1 */ }

const scripts = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(scripts, 'multi-review.mjs'), 'utf8');
const FIXTURES = path.join(scripts, 'fixtures', 'adapters');
const ROUTES = ['antigravity', 'claude', 'codex', 'copilot', 'gemini', 'grok'];
// The closed reviewer status vocabulary (SKILL.md step 5).
const STATUSES = ['success', 'self_excluded', 'authentication_required', 'provider_unavailable', 'ineligible_tier', 'timeout', 'quota', 'cancelled', 'missing', 'invalid_output', 'disabled_no_oauth', 'unsupported', 'not_dispatched', 'error'];
const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: String(error?.message ?? error).split('\n')[0].slice(0, 400) }); }
}
const between = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert(a >= 0 && b > a, `${from} not found`); return source.slice(a, b); };
// The production redaction, not a copy of it.
const sanitizeText = vm.runInNewContext(between('function sanitizeText(', 'function platformCommand(') + ';sanitizeText', {});

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-adapter-matrix-test-'));
let sequence = 0;
// The real adapters, sliced as the transport suites slice them.
function adapter() {
  const temporary = path.join(scratch, `adapter-${++sequence}`); fs.mkdirSync(temporary);
  const context = vm.createContext({ fs, os: { tmpdir: () => temporary, homedir: () => temporary }, path, process, Buffer, PEER_CONTRACT, reviewProblem, assemblePrompt,
    createEvidenceWorkspace: (prefix) => fs.mkdtempSync(path.join(temporary, prefix)), requirePrivateScratch: () => {},
    VALID_VERDICTS: new Set(['ACCEPT', 'MODIFY', 'REJECT']), VALID_SEVERITIES: new Set(['CRITICAL', 'WARNING', 'NITPICK']),
    attachmentRouting: () => [], attachmentContractSection: () => '', buildContract: () => 'Synthetic contract',
    agentTimeoutMs: (_agent, ms) => ms, cleanOauthEnv: () => ({}), parseUsage: () => ({ reported: null }), LOGIN_HINTS: {},
    sanitizeText, antigravityCommand: () => 'agy', grokCommand: () => 'grok', REVIEW_JSON_SCHEMA: { type: 'object' },
    grokIsolationEnv: isolation.grokIsolationEnv, codexIsolationArgs: isolation.codexIsolationArgs, codexReviewArgs: isolation.codexReviewArgs,
    quotationDiagnostics, ...grokStream, ...reviewAnswer });
  vm.runInContext(between('function quotationEvidence(', '\n// Live progress display'), context);
  // classifyFailure and its helpers sit in this range too, so a non-zero exit is classified by production code.
  vm.runInContext(between('function extractJsonObjects(', '\nfunction fingerprint(') + ';this.invoke=invokeReviewer;', context);
  return context;
}

const entries = (dir) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// All zeros, with or without the version and variant digits a UUID parser asks for.
const ZEROED = /^0{8}-0{4}-[04]0{3}-[08]0{3}-0{12}$/;
// Problems a fixture file itself has, whatever its case expects.
function fixtureProblems(text) {
  const problems = [];
  if (sanitizeText(text).redactions) problems.push('holds text the dispatcher would redact as a credential');
  if ((text.match(UUID) ?? []).some((id) => !ZEROED.test(id))) problems.push('holds an id that is not zeroed');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) problems.push('holds a raw control byte');
  return problems;
}

// Walks one fixture tree. Returns the cases found (each runnable) and the problems of the tree itself;
// a problem is a failure, so a stray file, an unlisted case or an unknown route never passes silently.
function readMatrix(dir) {
  const problems = [], cases = [];
  const artifactFile = path.join(dir, 'artifact.txt');
  if (!fs.existsSync(artifactFile)) return { problems: ['artifact.txt is missing'], cases };
  const artifact = fs.readFileSync(artifactFile, 'utf8');
  for (const route of entries(dir)) {
    if (route.isFile() && route.name === 'artifact.txt') continue;
    if (!route.isDirectory() || !ROUTES.includes(route.name)) { problems.push(`${route.name}: not a route folder`); continue; }
    const versions = entries(path.join(dir, route.name));
    if (!versions.length) problems.push(`${route.name}: no CLI version folder`);
    for (const version of versions) {
      const label = `${route.name}/${version.name}`, folder = path.join(dir, route.name, version.name);
      if (!version.isDirectory() || !/^\d+\.\d+\.\d+$/.test(version.name)) { problems.push(`${label}: a version folder is named like 1.0.91`); continue; }
      let expected;
      try { expected = JSON.parse(fs.readFileSync(path.join(folder, 'expected.json'), 'utf8')); } catch { problems.push(`${label}: expected.json is missing or not JSON`); continue; }
      if (expected.schema !== 'momm-adapter-fixtures/1' || expected.route !== route.name || expected.cli_version !== version.name) problems.push(`${label}: expected.json must name this schema, route and version`);
      if (typeof expected.shape_from !== 'string' || !expected.shape_from.trim()) problems.push(`${label}: expected.json must say where the shape comes from (shape_from)`);
      const listed = Object.keys(expected.cases && typeof expected.cases === 'object' && !Array.isArray(expected.cases) ? expected.cases : {});
      const present = entries(folder).filter((entry) => entry.name !== 'expected.json');
      if (!listed.length) problems.push(`${label}: no cases`);
      for (const entry of present) {
        if (!entry.isFile() || !/^[a-z0-9][a-z0-9-]*\.jsonl?$/.test(entry.name)) problems.push(`${label}/${entry.name}: a case is a lower-case .jsonl or .json file`);
        else if (!listed.includes(entry.name)) problems.push(`${label}/${entry.name}: not listed in expected.json`);
      }
      for (const name of listed) {
        const id = `${label}/${name}`, row = expected.cases[name], given = row?.process ?? {}, expect = row?.expect ?? {};
        if (!present.some((entry) => entry.isFile() && entry.name === name)) { problems.push(`${id}: listed in expected.json but the file is missing`); continue; }
        if (!STATUSES.includes(expect.status)) { problems.push(`${id}: expect.status must be a reviewer status`); continue; }
        const unknown = [...Object.keys(row).filter((key) => !['process', 'expect'].includes(key)), ...Object.keys(given).filter((key) => !['exit_code', 'stderr', 'timed_out'].includes(key)),
          ...Object.keys(expect).filter((key) => !['status', 'detail', 'verdict'].includes(key))];
        if (unknown.length) { problems.push(`${id}: unknown field ${unknown[0]}`); continue; }
        const stdout = fs.readFileSync(path.join(folder, name), 'utf8');
        for (const problem of fixtureProblems(stdout)) problems.push(`${id}: ${problem}`);
        cases.push({ id, route: route.name, version: version.name, name, expect, run: async () => {
          const result = await adapter().invoke(route.name, artifact, { governor: 'other', timeoutMs: 60000, grokModelProbe: Promise.resolve(null),
            runProcess: async () => ({ code: Object.hasOwn(given, 'exit_code') ? given.exit_code : 0, stdout, stderr: given.stderr ?? '', timedOut: given.timed_out === true }) });
          assert.equal(result.status, expect.status, `${id}: ${result.status}${result.detail ? ` (${String(result.detail).slice(0, 160)})` : ''}`);
          if (expect.detail) assert(String(result.detail ?? '').includes(expect.detail), `${id}: detail lacks "${expect.detail}": ${String(result.detail).slice(0, 160)}`);
          if (expect.status === 'success') { assert.equal(result.review?.review_contract, PEER_CONTRACT, id); if (expect.verdict) assert.equal(result.review.verdict, expect.verdict, id); }
          else assert(!result.review, `${id}: a refused answer carries no review`);
        } });
      }
    }
  }
  return { problems, cases };
}
async function failures(dir) {
  const { problems, cases } = readMatrix(dir), failed = [...problems];
  for (const one of cases) { try { await one.run(); } catch (error) { failed.push(String(error?.message ?? error).split('\n')[0]); } }
  return { failed, cases: cases.length };
}

try {
  const live = fs.existsSync(FIXTURES) ? readMatrix(FIXTURES) : { problems: ['momm/scripts/fixtures/adapters is missing'], cases: [] };
  await check('the fixture tree is well formed: known routes, version folders, every file listed and every listed file present', () => {
    assert.deepEqual(live.problems, []);
  });
  for (const one of live.cases) await check(`${one.id} is ${one.expect.status}`, one.run);

  // The shapes the plan names must stay in the matrix; more versions and cases are welcome.
  const REQUIRED = {
    'copilot/1.0.85': ['success.jsonl', 'fenced-success.jsonl', 'session-error.jsonl', 'quota-error.jsonl', 'unknown-event.jsonl'],
    // model.call_final_result first appears in the 1.0.91 shape, so the failed model call is a 1.0.91 case.
    'copilot/1.0.91': ['success.jsonl', 'fenced-success.jsonl', 'session-error.jsonl', 'quota-error.jsonl', 'unknown-event.jsonl', 'failed-model-call.jsonl'],
    'grok/1.0.41': ['capture-declined.jsonl', 'error.jsonl', 'timeout-truncated.jsonl'],
    'antigravity/1.2.4': ['success.jsonl', 'error.jsonl'],
  };
  await check('the matrix holds the named shapes: Copilot 1.0.85 and 1.0.91, Grok 1.0.41 with error cases, Antigravity stream', () => {
    const have = new Set(live.cases.map((one) => one.id));
    const missing = Object.entries(REQUIRED).flatMap(([folder, names]) => names.map((name) => `${folder}/${name}`)).filter((id) => !have.has(id));
    assert.deepEqual(missing, []);
  });
  await check('every route in the matrix has a success, a fenced success and a refusal', () => {
    for (const route of new Set(live.cases.map((one) => one.route))) {
      const of = live.cases.filter((one) => one.route === route);
      assert(of.some((one) => one.expect.status === 'success' && !one.name.startsWith('fenced-')), `${route}: no success case`);
      assert(of.some((one) => one.name.startsWith('fenced-') && one.expect.status === 'success'), `${route}: no fenced success case`);
      assert(of.some((one) => one.expect.status !== 'success'), `${route}: no refusal case`);
    }
  });
  // Closing review of 1.17.1: the 1.0.91 description gave narrated-fenced-success as "the shape of refused
  // pieces of a real review", beside a case that expects success. A description may say that a shape was
  // refused once; the sentence that names a case expected to succeed then also says it is accepted.
  const misdescribed = (described, names) => String(described).split(/(?<=\.)\s+/).flatMap((sentence) => names.filter((name) =>
    new RegExp(`(?<![\\w-])${name.replace(/\.jsonl?$/, '')}(?![\\w-])`).test(sentence) && /\brefused\b/.test(sentence) && !/\baccepted\b/.test(sentence)));
  await check('a description never leaves a case that is expected to succeed described as refused', () => {
    for (const folder of new Set(live.cases.map((one) => `${one.route}/${one.version}`))) {
      const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, folder, 'expected.json'), 'utf8'));
      const succeed = live.cases.filter((one) => `${one.route}/${one.version}` === folder && one.expect.status === 'success').map((one) => one.name);
      assert.deepEqual(misdescribed(expected.shape_from, succeed), [], `${folder}: say that the shape is accepted now, or do not call it refused`);
    }
    assert.deepEqual(misdescribed('a-success is the shape of refused pieces of a review. not-json stays refused.', ['a-success.jsonl', 'success.jsonl']), ['a-success.jsonl']);
    assert.deepEqual(misdescribed('a-success was refused in a review and is accepted now.', ['a-success.jsonl']), []);
  });
  await check('the Grok capture in the matrix is the recorded 1.0.41 capture, byte for byte', () => {
    const recorded = fs.readFileSync(path.join(scripts, 'fixtures', 'grok-streaming-json-1.0.41.jsonl'));
    assert(recorded.equals(fs.readFileSync(path.join(FIXTURES, 'grok', '1.0.41', 'capture-declined.jsonl'))));
  });

  // Controls on copies in a temporary tree: the walker, not a list in this file, decides what runs.
  const copy = (from, to) => { fs.mkdirSync(to); for (const entry of entries(from)) { const a = path.join(from, entry.name), b = path.join(to, entry.name); if (entry.isDirectory()) copy(a, b); else fs.copyFileSync(a, b); } };
  const copyTree = (name) => { const to = path.join(scratch, name); copy(FIXTURES, to); return to; };
  const rewrite = (file, change) => { const value = JSON.parse(fs.readFileSync(file, 'utf8')); change(value); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
  await check('adding a CLI version is adding a folder', async () => {
    const tree = copyTree('added-version'), added = path.join(tree, 'copilot', '9.9.9');
    copy(path.join(tree, 'copilot', '1.0.91'), added);
    rewrite(path.join(added, 'expected.json'), (value) => { value.cli_version = '9.9.9'; });
    const before = await failures(FIXTURES), after = await failures(tree);
    assert.deepEqual(after.failed, []);
    assert.equal(after.cases, before.cases + readMatrix(tree).cases.filter((one) => one.version === '9.9.9').length);
    assert(after.cases > before.cases, 'the new folder was run');
  });
  await check('a wrong expectation, a changed fixture and a wrong detail each fail', async () => {
    const wrong = copyTree('wrong-status');
    rewrite(path.join(wrong, 'copilot', '1.0.91', 'expected.json'), (value) => { value.cases['unknown-event.jsonl'].expect.status = 'success'; });
    assert.equal((await failures(wrong)).failed.length, 1);
    const changed = copyTree('changed-fixture'), file = path.join(changed, 'antigravity', '1.2.4', 'success.jsonl');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"SUCCESS"', '"RUNNING"'));
    assert.match((await failures(changed)).failed.join('\n'), /antigravity\/1\.2\.4\/success\.jsonl: error/);
    const detail = copyTree('wrong-detail');
    rewrite(path.join(detail, 'copilot', '1.0.91', 'expected.json'), (value) => { value.cases['failed-model-call.jsonl'].expect.detail = 'unrecognized event type'; });
    assert.match((await failures(detail)).failed.join('\n'), /failed-model-call\.jsonl: detail lacks/);
  });
  await check('the tree is fail-closed: an unlisted file, a missing file, an unknown route, a mismatched version and an unknown field are refused', () => {
    const problemsAfter = (name, change) => { const tree = copyTree(name); change(tree); return readMatrix(tree).problems.join('\n'); };
    assert.match(problemsAfter('unlisted', (tree) => fs.writeFileSync(path.join(tree, 'grok', '1.0.41', 'stray.jsonl'), '{"type":"end"}\n')), /stray\.jsonl: not listed/);
    assert.match(problemsAfter('missing', (tree) => fs.rmSync(path.join(tree, 'grok', '1.0.41', 'error.jsonl'))), /error\.jsonl: listed in expected\.json but the file is missing/);
    assert.match(problemsAfter('route', (tree) => copy(path.join(tree, 'grok'), path.join(tree, 'newroute'))), /newroute: not a route folder/);
    assert.match(problemsAfter('version', (tree) => fs.renameSync(path.join(tree, 'grok', '1.0.41'), path.join(tree, 'grok', '1.0.42'))), /grok\/1\.0\.42: expected\.json must name this schema, route and version/);
    assert.match(problemsAfter('field', (tree) => rewrite(path.join(tree, 'grok', '1.0.41', 'expected.json'), (value) => { value.cases['error.jsonl'].expect.skip = true; })), /error\.jsonl: unknown field skip/);
    assert.match(problemsAfter('status', (tree) => rewrite(path.join(tree, 'grok', '1.0.41', 'expected.json'), (value) => { value.cases['error.jsonl'].expect.status = 'fine'; })), /expect\.status must be a reviewer status/);
    assert.match(problemsAfter('artifact', (tree) => fs.rmSync(path.join(tree, 'artifact.txt'))), /artifact\.txt is missing/);
  });
  await check('a fixture that holds a credential-looking string, a live-looking id or a control byte is refused', () => {
    const token = ['gh', 'p_'].join('') + 'q'.repeat(30), id = ['3f2a9c1e', '7b4d', '4e8a', '9c1f', '5d6e7f8a9b0c'].join('-');
    assert.match(fixtureProblems(`{"type":"text","data":"${token}"}`).join(), /redact as a credential/);
    assert.match(fixtureProblems(`{"type":"end","sessionId":"${id}"}`).join(), /not zeroed/);
    assert.match(fixtureProblems(`{"type":"text","data":"a${String.fromCharCode(27)}[0m"}`).join(), /control byte/);
    assert.deepEqual(fixtureProblems('{"id":"00000000-0000-4000-8000-000000000000","sessionId":"00000000-0000-0000-0000-000000000000"}\n'), []);
  });
} finally {
  // Real paths on both sides: a hosted runner's temp folder is a short or linked name.
  const resolved = fs.realpathSync.native(scratch), temporary = fs.realpathSync.native(os.tmpdir());
  assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('momm-adapter-matrix-test-'));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

const failed = checks.filter((c) => !c.passed);
console.log(JSON.stringify({ node: process.version, passed: checks.length - failed.length, total: checks.length, checks: failed.length ? failed : undefined }, null, 2));
process.exitCode = failed.length ? 1 : 0;
