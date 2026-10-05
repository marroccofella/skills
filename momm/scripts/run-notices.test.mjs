// MOMM 1.17.1 S3 and S4: the repeated-status notice and the gate-review guard. Notices only: the
// review runs as before. Zero providers: the real dispatcher runs below with the governor as its only
// known route, or with a route name that has no adapter, so no reviewer CLI is ever started.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { privateTestFixture } from './private-test-fixture.mjs';
import { resolveGit } from './governor.mjs';
import { evidenceLocation } from './evidence-location.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives
let notices = {}; try { notices = await import('./run-notices.mjs'); } catch { /* absent before S3/S4: every check below then fails by name */ }
const need = (name) => { assert.equal(typeof notices[name], 'function', `run-notices.mjs must export ${name}`); return notices[name]; };
const scripts = path.dirname(fileURLToPath(import.meta.url));
const dispatcher = path.join(scripts, 'multi-review.mjs');
// Git by resolved absolute path, never a bare name: see executable-resolution.test.mjs.
const GIT = resolveGit(path.resolve(scripts, '../..'));
if (!GIT) throw new Error('no trusted Git was found outside the checkout; this suite never launches a bare name');
const root = privateTestFixture('momm-run-notices-test-');
const checks = []; let sequence = 0;
async function test(name, fn) { try { await fn(); checks.push({ name, passed: true }); } catch (e) { checks.push({ name, passed: false, error: e.message }); } }
const folder = (name = 'project') => { const dir = path.join(root, `${name}-${++sequence}`); fs.mkdirSync(dir, { recursive: true }); return dir; };
const git = (cwd, ...args) => { const r = spawnSync(GIT, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 20000 }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
const DIFF = ['diff --git a/src/app.js b/src/app.js', 'index 1111111..2222222 100644', '--- a/src/app.js', '+++ b/src/app.js', '@@ -1,2 +1,2 @@', ' const a = 1;', '-const b = 2;', '+const b = 3;', ''].join('\n');
// A real dispatcher run. HOME is a synthetic folder, so nothing reads or writes the real profile.
function run(cwd, args, env = {}) {
  const home = path.join(root, 'home'); fs.mkdirSync(home, { recursive: true });
  const result = spawnSync(process.execPath, [dispatcher, '--no-ui', ...args], { cwd, encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 4_000_000,
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_UPDATE_CHECK: '1', MOMM_NO_UPDATE_CHECK: '1', DO_NOT_TRACK: '1', MULTI_LLM_REVIEW_DEPTH: '0', GOVERNING_AGENT: '', MOMM_EVIDENCE_HOME: '', ...env } });
  let report = null; try { report = JSON.parse(result.stdout); } catch { /* asserted by the caller */ }
  return { status: result.status, stderr: result.stderr ?? '', report };
}
const logLine = (timestamp, statuses, extra = {}) => JSON.stringify({ timestamp, run_id: `rev_${timestamp.replace(/\D/g, '')}`, governor: 'claude', reviewer_status: statuses, ...extra });
function evidence(lines) { const dir = folder('evidence'); fs.writeFileSync(path.join(dir, 'review-log.jsonl'), lines.map((l) => `${l}\n`).join('')); return dir; }
const repeated = (lines, results, extra = {}) => need('repeatedStatusNotices')({ dir: evidence(lines), results, governor: 'claude', ...extra });
try {
  // ---- S3: repeated-status notice ----
  await test('S3: the same failure in the last three recorded runs is a notice with route, status, since and class', () => {
    const out = repeated([logLine('2026-10-01T09:00:00.000Z', { codex: 'success', grok: 'success' }), logLine('2026-10-02T09:00:00.000Z', { codex: 'invalid_output', grok: 'success' }), logLine('2026-10-03T09:00:00.000Z', { codex: 'invalid_output', grok: 'success' })],
      [{ agent: 'codex', status: 'invalid_output' }, { agent: 'grok', status: 'success' }]);
    assert.equal(out.length, 1, JSON.stringify(out));
    for (const part of ['codex', 'invalid_output', 'last 3 recorded runs', '2026-10-02T09:00:00.000Z', 'CLI output change']) assert.ok(out[0].includes(part), `${part}: ${out[0]}`);
    assert.match(out[0], /Nothing is routed on this notice/);
  });
  await test('S3: a longer run of failures counts them all and dates the first', () => {
    const lines = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'].map((day) => logLine(`${day}T09:00:00.000Z`, { copilot: 'quota' }));
    const out = repeated(lines, [{ agent: 'copilot', status: 'quota' }]);
    assert.equal(out.length, 1); assert.ok(out[0].includes('last 5 recorded runs') && out[0].includes('2026-09-27T09:00:00.000Z'), out[0]);
  });
  await test('S3: two in a row, a success in between, a different status, or a success now give no notice', () => {
    const day = (n, statuses) => logLine(`2026-10-0${n}T09:00:00.000Z`, statuses);
    assert.deepEqual(repeated([day(1, { codex: 'timeout' })], [{ agent: 'codex', status: 'timeout' }]), [], 'two in a row');
    assert.deepEqual(repeated([day(1, { codex: 'timeout' }), day(2, { codex: 'success' }), day(3, { codex: 'timeout' })], [{ agent: 'codex', status: 'timeout' }]), [], 'a success in between');
    assert.deepEqual(repeated([day(1, { codex: 'timeout' }), day(2, { codex: 'error' })], [{ agent: 'codex', status: 'timeout' }]), [], 'a different status in between');
    assert.deepEqual(repeated([day(1, { codex: 'timeout' }), day(2, { codex: 'timeout' })], [{ agent: 'codex', status: 'error' }]), [], 'a different status now');
    assert.deepEqual(repeated([day(1, { codex: 'timeout' }), day(2, { codex: 'timeout' }), day(3, { codex: 'timeout' })], [{ agent: 'codex', status: 'success' }]), [], 'a success now ends it');
    assert.deepEqual(repeated([day(1, { codex: 'timeout' }), day(2, { codex: 'timeout' })], [{ agent: 'grok', status: 'timeout' }]), [], 'another route');
  });
  await test('S3: self-excluded and not-dispatched rows do not count, in the log or now', () => {
    const day = (n, statuses) => logLine(`2026-10-0${n}T09:00:00.000Z`, statuses);
    // They neither add to the count nor break it.
    const out = repeated([day(1, { codex: 'quota' }), day(2, { codex: 'self_excluded' }), day(3, { codex: 'not_dispatched' }), day(4, { codex: 'quota' }), day(5, { grok: 'success' })], [{ agent: 'codex', status: 'quota' }]);
    assert.equal(out.length, 1); assert.ok(out[0].includes('last 3 recorded runs') && out[0].includes('2026-10-01T09:00:00.000Z'), out[0]);
    for (const status of ['self_excluded', 'not_dispatched']) {
      assert.deepEqual(repeated([day(1, { codex: status }), day(2, { codex: status }), day(3, { codex: status })], [{ agent: 'codex', status }]), [], status);
      assert.deepEqual(repeated([day(1, { codex: 'quota' }), day(2, { codex: 'quota' }), day(3, { codex: 'quota' })], [{ agent: 'codex', status }]), [], `not run now (${status}): nothing new to say`);
    }
    assert.deepEqual(need('repeatedStatusNotices')({ dir: evidence([day(1, { codex: 'quota' }), day(2, { codex: 'quota' })]), results: [{ agent: 'codex', status: 'quota' }], governor: 'codex' }), [], 'the governor is never a reviewer');
  });
  await test('S3: each status names its likely class', () => {
    const expected = { invalid_output: /CLI output change/, quota: /allowance/, authentication_required: /login/, timeout: /time limit/, provider_unavailable: /provider outage/, ineligible_tier: /account tier/, missing: /not installed/, unsupported: /adapter|launcher/, error: /CLI error/, cancelled: /cancelled/ };
    for (const [status, pattern] of Object.entries(expected)) {
      const out = repeated([logLine('2026-10-01T09:00:00.000Z', { codex: status }), logLine('2026-10-02T09:00:00.000Z', { codex: status })], [{ agent: 'codex', status }]);
      assert.equal(out.length, 1, status); assert.match(out[0], pattern, status);
    }
    const unknown = repeated([logLine('2026-10-01T09:00:00.000Z', { codex: 'brand_new' }), logLine('2026-10-02T09:00:00.000Z', { codex: 'brand_new' })], [{ agent: 'codex', status: 'brand_new' }]);
    assert.equal(unknown.length, 1); assert.ok(unknown[0].includes('brand_new'));
  });
  await test('S3: second-look rows, damaged lines and a missing log are skipped, never fatal', () => {
    const lines = [logLine('2026-10-01T09:00:00.000Z', { codex: 'quota' }), '{"truncated":', logLine('2026-10-02T09:00:00.000Z', { codex: 'success' }, { event: 'second_look' }), 'null', '[]',
      JSON.stringify({ timestamp: '2026-10-02T10:00:00.000Z', reviewer_status: 'quota' }), logLine('2026-10-03T09:00:00.000Z', { codex: 'quota' })];
    const out = repeated(lines, [{ agent: 'codex', status: 'quota' }]);
    assert.equal(out.length, 1); assert.ok(out[0].includes('2026-10-01T09:00:00.000Z'));
    assert.deepEqual(need('repeatedStatusNotices')({ dir: folder('empty'), results: [{ agent: 'codex', status: 'quota' }], governor: 'claude' }), []);
    assert.deepEqual(need('repeatedStatusNotices')({ dir: path.join(root, 'absent'), results: [{ agent: 'codex', status: 'quota' }], governor: 'claude' }), []);
  });
  await test('S3: a route or status that is not a plain name is never echoed, and a long log is read from its end', () => {
    const escape = String.fromCharCode(27);
    assert.deepEqual(repeated([logLine('2026-10-01T09:00:00.000Z', { codex: `quota${escape}[31m` }), logLine('2026-10-02T09:00:00.000Z', { codex: `quota${escape}[31m` })], [{ agent: 'codex', status: `quota${escape}[31m` }]), []);
    const filler = Array.from({ length: 3000 }, (_, i) => logLine(new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), { grok: 'success' }, { finding_ids: Array(40).fill('some-finding-identifier') }));
    const out = repeated([...filler, logLine('2026-10-02T09:00:00.000Z', { codex: 'timeout' }), logLine('2026-10-03T09:00:00.000Z', { codex: 'timeout' })], [{ agent: 'codex', status: 'timeout' }]);
    assert.equal(out.length, 1); assert.ok(out[0].includes('2026-10-02T09:00:00.000Z'));
  });
  // 1.17.1 gate review (rev_20261004083921_b12f1d0fd3bf): the log is read from its last 1 MiB, whole
  // lines only. One damaged line longer than that leaves a tail with no line end in it; here that tail
  // would parse on its own, and it is still not a line of the log.
  await test('S3: a tail that holds no line end holds no whole line, so its fragment is never read as a run', () => {
    const tail = 1024 * 1024, row = (pad) => logLine('2026-10-03T09:00:00.000Z', { codex: 'quota' }, { pad });
    const fragment = row('a'.repeat(tail - Buffer.byteLength(row(''))));
    assert.equal(Buffer.byteLength(fragment), tail, 'the fixture is exactly the tail that is read');
    const dir = folder('evidence'), log = path.join(dir, 'review-log.jsonl'), now = { dir, results: [{ agent: 'codex', status: 'quota' }], governor: 'claude', runs: 2 };
    fs.writeFileSync(log, `not a row ${fragment}`);
    assert.deepEqual(need('repeatedStatusNotices')(now), []);
    // The same row as a whole line of the log is a recorded run.
    fs.writeFileSync(log, `${row('')}\n`);
    assert.equal(need('repeatedStatusNotices')(now).length, 1);
  });
  // Closing review of 1.17.1 (tail-exact-line-dropped): a row that begins exactly where the tail begins
  // is a whole line (the byte before it ends the previous line). It was dropped up to its own line end,
  // or altogether when it had none.
  await test('S3: a row that begins exactly where the tail begins is a whole line and is counted', () => {
    const tail = 1024 * 1024, row = (bytes) => { const empty = logLine('2026-10-03T09:00:00.000Z', { codex: 'quota' }, { pad: '' }), sized = logLine('2026-10-03T09:00:00.000Z', { codex: 'quota' }, { pad: 'a'.repeat(bytes - Buffer.byteLength(empty)) }); assert.equal(Buffer.byteLength(sized), bytes); return sized; };
    const dir = folder('evidence'), log = path.join(dir, 'review-log.jsonl'), now = { dir, results: [{ agent: 'codex', status: 'quota' }], governor: 'claude', runs: 2 };
    // The line before it holds another status, so only the row at the start of the tail can make the notice.
    const before = logLine('2026-10-02T09:00:00.000Z', { codex: 'timeout' });
    fs.writeFileSync(log, `${before}\n${row(tail)}`);
    assert.equal(need('repeatedStatusNotices')(now).length, 1, 'a last row of exactly the tail, with no line end of its own');
    fs.writeFileSync(log, `${before}\n${row(tail - 1)}\n`);
    assert.equal(need('repeatedStatusNotices')(now).length, 1, 'a last row that fills the tail with its line end');
    // Control: one byte longer and the tail starts inside the row, which is then a fragment.
    fs.writeFileSync(log, `${before}\n${row(tail + 1)}`);
    assert.deepEqual(need('repeatedStatusNotices')(now), []);
  });
  // Two real runs in one project, shared by the S3 and S4 checks below (each takes several seconds on
  // Windows): an ordinary file first, then a diff file. Between them the first run's own log line is
  // appended again one minute later, so the second run is the route's third recorded failure.
  let shared = null;
  const realRuns = () => (shared ??= (() => {
    const project = folder(); fs.writeFileSync(path.join(project, 'input.txt'), 'const value = 1;\n'); fs.writeFileSync(path.join(project, 'change.diff'), DIFF);
    const first = run(project, ['--governor', 'codex', '--reviewers', 'no-such-route', '--input', 'input.txt']);
    const log = path.join(project, '.ensemble_reviews', 'review-log.jsonl'), row = JSON.parse(fs.readFileSync(log, 'utf8').trim());
    fs.appendFileSync(log, `${JSON.stringify({ ...row, run_id: `${row.run_id}_again`, timestamp: new Date(Date.parse(row.timestamp) + 60_000).toISOString() })}\n`);
    return { first, row, second: run(project, ['--governor', 'codex', '--reviewers', 'no-such-route', '--input', 'change.diff']) };
  })());
  await test('S3: a real run adds the notice to the report and stderr on its third failure, and nothing is routed on it', () => {
    const { first, row, second } = realRuns();
    assert.equal(first.status, 0, first.stderr.slice(-300));
    // An ordinary file and a first failure: no notice of either kind.
    assert.ok(!('notices' in first.report), JSON.stringify(first.report.notices));
    assert.doesNotMatch(first.stderr, /recorded runs|momm input:/);
    assert.equal(second.status, 0, 'a notice never changes the exit status');
    const notice = (second.report.notices ?? []).find((n) => /recorded runs/.test(n));
    assert.ok(notice, JSON.stringify(second.report.notices));
    for (const part of ['no-such-route', 'unsupported', 'last 3 recorded runs', row.timestamp]) assert.ok(notice.includes(part), notice);
    assert.ok(second.stderr.includes(`momm routes: ${notice}`), 'the same sentence on stderr');
    assert.deepEqual(second.report.reviewers.map((r) => [r.agent, r.status]), [['no-such-route', 'unsupported']], 'the route was asked exactly as before');
    assert.deepEqual(second.report.gate_policy.requested_routes, ['no-such-route']);
  });
  await test('S3: the log is read through the evidence resolver (an evidence home is followed), and --stream gets an event', () => {
    const project = folder(), home = folder('evidence-home'); fs.writeFileSync(path.join(project, 'change.diff'), DIFF);
    const args = ['--governor', 'codex', '--reviewers', 'no-such-route', '--input', 'change.diff', '--evidence-home', home, '--stream'];
    // Two earlier runs are already in the evidence home's log; this run is the third.
    const dir = evidenceLocation({ cwd: project, home }).dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'review-log.jsonl'), ['2026-10-01T09:00:00.000Z', '2026-10-02T09:00:00.000Z'].map((at) => `${logLine(at, { 'no-such-route': 'unsupported' })}\n`).join(''), { mode: 0o600 });
    const third = run(project, args);
    assert.equal(third.status, 0, third.stderr.slice(-300));
    assert.ok((third.report.notices ?? []).some((n) => /no-such-route/.test(n) && /last 3 recorded runs/.test(n) && n.includes('2026-10-01T09:00:00.000Z')), JSON.stringify(third.report.notices));
    const events = third.stderr.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(events.some((e) => e.event === 'status.notice' && /no-such-route/.test(e.notice)), 'stream event');
    // S4 in the same streamed run: an event, and its notice in the report beside the S3 one.
    assert.ok(events.some((e) => e.event === 'input.notice' && /--range/.test(e.notice)), 'input.notice stream event');
    assert.ok(third.report.notices.some((n) => /--range <base>\.\.<head>/.test(n)));
    assert.equal(fs.existsSync(path.join(project, '.ensemble_reviews')), false, 'nothing was read from or written to the project folder');
    const wiring = fs.readFileSync(dispatcher, 'utf8');
    assert.match(wiring, /repeatedStatusNotices\(\{ dir: evidenceAt\.dir, results, governor: options\.governor \}\)/);
  });
  // ---- S4: gate-review guard ----
  await test('S4: a diff file that is not a tracked project file gets the notice naming --range and --range-path', () => {
    const project = folder(); fs.writeFileSync(path.join(project, 'change.diff'), DIFF);
    const notice = need('diffInputNotice')({ cwd: project, input: 'change.diff', range: null, artifact: DIFF });
    assert.equal(typeof notice, 'string');
    for (const part of ['change.diff', 'completion receipt', '--range <base>..<head>', '--range-path']) assert.ok(notice.includes(part), `${part}: ${notice}`);
    assert.ok(!notice.includes(project), 'no absolute path');
    // In a repository, untracked; and a diff kept outside the project.
    git(project, 'init', '-q');
    assert.equal(typeof need('diffInputNotice')({ cwd: project, input: 'change.diff', range: null, artifact: DIFF }), 'string');
    const outside = path.join(folder('outside'), 'gate.patch'); fs.writeFileSync(outside, DIFF);
    assert.ok(need('diffInputNotice')({ cwd: project, input: outside, range: null, artifact: DIFF }).includes('gate.patch'));
  });
  await test('S4: no notice for a tracked diff file, a file with no hunk headers, a range, or no --input', () => {
    const project = folder(); git(project, 'init', '-q');
    fs.mkdirSync(path.join(project, 'patches')); fs.writeFileSync(path.join(project, 'patches', 'vendor.patch'), DIFF);
    git(project, 'add', 'patches/vendor.patch');
    assert.equal(need('diffInputNotice')({ cwd: project, input: 'patches/vendor.patch', range: null, artifact: DIFF }), null, 'a tracked patch is a project source file');
    assert.equal(need('diffInputNotice')({ cwd: project, input: path.join(project, 'patches', 'vendor.patch'), range: null, artifact: DIFF }), null, 'by absolute path too');
    fs.writeFileSync(path.join(project, 'notes.txt'), 'diff --git is mentioned here\n--- not a hunk\n');
    assert.equal(need('diffInputNotice')({ cwd: project, input: 'notes.txt', range: null, artifact: 'diff --git is mentioned here\n--- not a hunk\n' }), null);
    assert.equal(need('diffInputNotice')({ cwd: project, input: undefined, range: null, artifact: DIFF }), null, 'stdin or git diff HEAD');
    assert.equal(need('diffInputNotice')({ cwd: project, input: null, range: { base: 'a', head: 'b' }, artifact: DIFF }), null);
    // A hunk header counts only at the start of a line.
    assert.equal(need('diffInputNotice')({ cwd: project, input: 'notes.txt', range: null, artifact: 'see the "@@ -1,2 +1,2 @@" header\n' }), null);
  });
  await test('S4: a real run prints the notice, adds it to the report, and reviews as before', () => {
    const { first, second } = realRuns();
    assert.equal(second.status, 0, second.stderr.slice(-300));
    const notice = (second.report.notices ?? []).find((n) => /--range <base>\.\.<head>/.test(n));
    assert.ok(notice, JSON.stringify(second.report.notices));
    assert.ok(second.stderr.includes(`momm input: ${notice}`));
    // Not a refusal: the diff file is the snapshot, as before, and the route was asked as before.
    assert.equal(second.report.source_snapshot.complete, true); assert.deepEqual(second.report.source_snapshot.files.map((f) => f.path), ['change.diff']);
    assert.deepEqual(second.report.reviewers.map((r) => r.agent), ['no-such-route']);
    assert.deepEqual(first.report.source_snapshot.files.map((f) => f.path), ['input.txt']);
  });
  await test('S4: the help says where a gate review of a diff belongs', () => {
    const help = spawnSync(process.execPath, [dispatcher, '--help'], { encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, NO_UPDATE_CHECK: '1' } });
    assert.equal(help.status, 0, help.stderr);
    const line = help.stdout.split('\n').find((l) => l.includes('--input, --patch <file>')) ?? '';
    const block = help.stdout.slice(help.stdout.indexOf(line), help.stdout.indexOf('--range <base>..<head>'));
    assert.match(block.replace(/\s+/g, ' '), /diff file.*completion receipt.*--range/);
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ node: process.version, passed: checks.filter((c) => c.passed).length, total: checks.length, checks }, null, 2));
process.exitCode = checks.every((c) => c.passed) ? 0 : 1;
