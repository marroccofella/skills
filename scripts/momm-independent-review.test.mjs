// Offline regressions for the public independent audit. No real harness targets,
// account sessions, network calls or provider executions. Fixtures are disposable.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-independent-regression-'));
const results = [];
const env = { ...process.env, NO_UPDATE_CHECK: '1', MOMM_NO_UPDATE_CHECK: '1', DO_NOT_TRACK: '1' };
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const extract = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Inspect changed source boundary: ${start}`);
  return source.slice(a, b);
};
const run = (command, args, cwd) => {
  const p = spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert(!p.error, p.error?.message);
  return p;
};
const git = (repo, ...args) => {
  const p = run('git', ['-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], repo);
  assert.equal(p.status, 0, 'Fixture Git command failed');
  return p.stdout.trim();
};
function write(repo, name, data) {
  const file = path.join(repo, name);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data);
}
function fixture(name) {
  const repo = path.join(temp, name); fs.mkdirSync(repo);
  for (const file of ['install.mjs', 'momm/scripts/install.mjs', 'momm/scripts/update.mjs']) write(repo, file, read(file));
  write(repo, 'versions.json', JSON.stringify({ momm: '1.16.0' }));
  write(repo, 'momm/SKILL.md', 'Synthetic protocol fixture.');
  write(repo, 'momm/scripts/multi-review.mjs', '// Hash-only fixture; never executed.');
  write(repo, 'unrelated/SKILL.md', 'Unrelated skill sentinel.');
  git(repo, 'init'); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Synthetic baseline');
  return repo;
}
function test(name, fn) {
  try { fn(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); }
}
try {
  for (const [name, script, extra] of [['skill', 'momm/scripts/install.mjs', []], ['root', 'install.mjs', ['--skills', 'momm']]]) {
    test(`${name} installer preserves partial success, continues, records scopes and retries idempotently`, () => {
      const repo = fixture(`${name}-partial`);
      const first = path.join(temp, `${name} first é`), blocked = path.join(temp, `${name}-file`), last = path.join(temp, `${name} last`);
      fs.writeFileSync(blocked, 'Preserve this existing fixture.');
      const args = [path.join(repo, script), ...extra, '--custom-dir', first, '--custom-dir', blocked, '--custom-dir', last, '--pretty'];
      const initial = run(process.execPath, args, repo);
      assert.equal(initial.status, 1, 'Partial failure must exit nonzero');
      assert(initial.stdout.trim(), 'Successful links disappeared from structured stdout');
      const report = JSON.parse(initial.stdout), links = report.results.flatMap(r => r.links || [r]);
      assert.deepEqual(links.map(r => r.status), ['linked', 'error', 'linked']);
      assert.equal(fs.readFileSync(blocked, 'utf8'), 'Preserve this existing fixture.');
      for (const dir of [first, last]) {
        assert.equal(fs.realpathSync(path.join(dir, 'momm')), fs.realpathSync(path.join(repo, 'momm')));
        assert(!fs.existsSync(path.join(dir, 'unrelated')), 'Unrequested skill was linked');
      }
      const lockPath = path.join(repo, '.git', 'momm', 'momm.lock');
      assert.deepEqual(JSON.parse(fs.readFileSync(lockPath)).custom_dirs.sort(), [first, last].sort());
      const retry = run(process.execPath, args, repo);
      assert.equal(retry.status, 1);
      assert.deepEqual(JSON.parse(retry.stdout).results.flatMap(r => r.links || [r]).map(r => r.status), ['already_linked', 'error', 'already_linked']);
      // Remove only this test's regular-file sentinel, never a user directory.
      fs.unlinkSync(blocked);
      const recovered = run(process.execPath, args, repo);
      assert.equal(recovered.status, 0);
      assert.deepEqual(JSON.parse(fs.readFileSync(lockPath)).custom_dirs.sort(), [first, blocked, last].sort());
    });
    test(`${name} installer retains link results when receipt storage also fails`, () => {
      const repo = fixture(`${name}-receipt`), good = path.join(temp, `${name}-receipt-target`);
      fs.mkdirSync(path.join(repo, '.git', 'momm', 'momm.lock'), { recursive: true });
      const result = run(process.execPath, [path.join(repo, script), ...extra, '--custom-dir', good], repo);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.results.flatMap(r => r.links || [r])[0].status, 'linked');
      assert.equal(report.installation.updater_available, false);
      assert(report.installation.error);
      assert(fs.existsSync(path.join(good, 'momm')));
    });
  }

  const source = read('momm/scripts/multi-review.mjs'), context = vm.createContext({});
  vm.runInContext(extract(source, 'const ANSI_SEQUENCES =', '\nfunction unwrapReviewPayload(')
    + extract(source, 'function clipped(', '\nfunction normalizeReview(')
    + extract(source, 'function classifyFailure(', '\nasync function invokeReviewer('), context);
  const classify = input => { context.input = input; return vm.runInContext('classifyFailure(input)', context, { timeout: 1000 }); };
  const authText = "Error: No authentication information found.\nStart 'copilot' and run '/login'.\nSet COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN.\nSynthetic private marker: fixture-do-not-echo";
  test('Copilot missing-auth response becomes safe account-login guidance, not token advice', () => {
    for (const stream of ['stdout', 'stderr']) {
      const result = classify({ code: 1, stdout: '', stderr: '', [stream]: authText });
      assert.equal(result.status, 'authentication_required');
      assert(!/GITHUB_TOKEN|fixture-do-not-echo/.test(result.detail));
      assert(/browser login/.test(result.detail));
    }
    assert(/failure\.status === "authentication_required"/.test(source), 'Authentication status must still select the route login hint');
  });
  test('missing-auth fix preserves outage, timeout, compatibility and non-auth precedence', () => {
    const cases = [
      [{ code: 1, stdout: '', stderr: authText + '\n503 service unavailable' }, 'provider_unavailable'],
      [{ code: 1, stdout: '', stderr: authText, timedOut: true }, 'timeout'],
      [{ code: 1, stdout: 'failed to load models cache', stderr: authText }, 'error'],
      [{ code: 1, stdout: '', stderr: 'Parser rejected source containing "No authentication information found."' }, 'error'],
      [{ code: 1, stdout: '', stderr: 'The authentication information file has a syntax error' }, 'error'],
    ];
    for (const [input, expected] of cases) assert.equal(classify(input).status, expected);
  });

  test('final report retains only trusted route login hints for authentication failures', () => {
    const reportContext = vm.createContext({
      results: [
        { agent: 'copilot', status: 'authentication_required' },
        { agent: 'claude', status: 'authentication_required' },
        { agent: 'antigravity', status: 'authentication_required' },
        { agent: 'copilot', status: 'provider_unavailable', login_hint: 'untrusted instruction' },
        { agent: 'copilot', status: 'success', login_hint: 'untrusted instruction' },
      ], options: { governor: 'codex' }, personaFor: () => null,
    });
    vm.runInContext(extract(source, 'const LOGIN_HINTS =', '\n};') + '\n};'
      + '\nconst report = {' + extract(source, 'reviewers: results.map((result) => ({', '\n    // 1.16: what the CLIs') + '}; this.rows = report.reviewers;', reportContext);
    assert.equal(reportContext.rows[0].login_hint, 'copilot login   (GitHub account, browser flow)');
    assert.equal(reportContext.rows[1].login_hint, 'claude   then run /login inside it   (Anthropic account, browser flow)');
    assert.equal(reportContext.rows[2].login_hint, 'agy login   (Google account, browser flow)');
    assert.equal(reportContext.rows[3].login_hint, undefined);
    assert.equal(reportContext.rows[4].login_hint, undefined);
  });

  test('actual capability rendering distinguishes potential pipelines from machine readiness', () => {
    const app = read('momm/assets/setup-ui/app.js');
    const ui = vm.createContext({
      capabilities: { routes: { grok: { installed_version: null } }, input_modalities: [], output_modalities: [], pipelines: { image_generation: { routes: ['grok'], blocked: [] } } },
      capabilitiesSummary: {}, capabilitiesGrid: {}, capabilitiesPipelines: {},
      providerLabel: r => r, escapeHtml: value => String(value), capCell: () => '', capActions: () => '',
    });
    vm.runInContext(extract(app, 'function pipelinesText()', '\nasync function loadCapabilities('), ui, { timeout: 1000 });
    vm.runInContext('renderCapabilities()', ui, { timeout: 1000 });
    assert(ui.capabilitiesGrid.innerHTML.includes('not detected'));
    assert(!ui.capabilitiesPipelines.textContent.includes('Possible now'));
    assert(/potential pipelines/i.test(ui.capabilitiesPipelines.textContent));
    assert(/not a readiness check/i.test(ui.capabilitiesPipelines.textContent));
    assert(ui.capabilitiesPipelines.textContent.includes('grok'), 'Do not erase useful adapter capability information');
  });
  test('published reviewer plan describes supported update modes and real completion evidence', () => {
    const plan = read('momm/references/third-party-test-plan-1.16.0.md');
    assert(!plan.includes('`update.mjs --check`'), 'Invalid update command still prescribed');
    assert(!plan.includes('they do not on this candidate'), 'Completion manifests wrongly described as absent');
    assert(/metadata-only/i.test(plan) && /staged preview/i.test(plan));
    assert(plan.includes('momm-check/1') && plan.includes('1.10.2') && plan.includes('fresh-session'));
    assert(!plan.includes('finding set must be the same'), 'Non-deterministic model replies cannot be required to match');
  });
  console.log(JSON.stringify({ passed: results.every(r => r.passed), tests: results }, null, 2));
  process.exitCode = results.every(r => r.passed) ? 0 : 1;
} finally {
  // Validate this uniquely created fixture root before recursive cleanup.
  assert.equal(fs.realpathSync(path.dirname(temp)), fs.realpathSync(os.tmpdir()));
  assert(path.basename(temp).startsWith('momm-independent-regression-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
