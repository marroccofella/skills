#!/usr/bin/env node
// 1.17 A7 (owner decision D1): evidence outside the project, opt-in. Synthetic fixtures only; no
// provider CLI is started and no review is dispatched. Every folder is a fresh private temp fixture;
// evidence --protect is never run on a real folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { privateTestFixture } from './private-test-fixture.mjs';
import { preparePrivateEvidence, requirePrivateEvidence, inspectEvidencePermissions, protectEvidence } from './evidence-permissions.mjs';
import { captureSourceSnapshot, digest } from './governor.mjs';
import { attemptRecord, persistAttempt } from './attempts.mjs';
import { buildScorecard } from './scorecard.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const win = process.platform === 'win32';
const real = (p) => (win ? fs.realpathSync.native(p) : fs.realpathSync(p));
// Independent oracle for the folder name: the first 32 hex characters of sha256(project real path).
const expectedDir = (home, project) => path.join(home, createHash('sha256').update(real(project)).digest('hex').slice(0, 32));
let loc = null;
try { loc = await import('./evidence-location.mjs'); } catch (error) { loc = { missing: error.message }; }
const need = (name) => { assert.equal(typeof loc[name], 'function', `evidence-location.mjs must export ${name} (${loc.missing ?? 'not exported'})`); return loc[name]; };

const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: String(error?.message ?? error).split('\n')[0].slice(0, 400) }); }
}
const baseEnv = () => { const env = { ...process.env, NO_UPDATE_CHECK: '1', MOMM_NO_UPDATE_CHECK: '1', DO_NOT_TRACK: '1', MULTI_LLM_REVIEW_DEPTH: '0' }; delete env.MOMM_EVIDENCE_HOME; return env; };
const node = (args, cwd, extraEnv = {}) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 120000, windowsHide: true, env: { ...baseEnv(), ...extraEnv } });
const withEnv = async (value, fn) => {
  const before = process.env.MOMM_EVIDENCE_HOME;
  if (value === undefined) delete process.env.MOMM_EVIDENCE_HOME; else process.env.MOMM_EVIDENCE_HOME = value;
  try { return await fn(); } finally { if (before === undefined) delete process.env.MOMM_EVIDENCE_HOME; else process.env.MOMM_EVIDENCE_HOME = before; }
};

const root = privateTestFixture('momm-evidence-location-test-');
try {
  const mk = (...parts) => { const p = path.join(root, ...parts); fs.mkdirSync(p, { recursive: true }); return p; };
  const projectA = mk('one', 'app'), projectB = mk('two', 'app');
  const home = path.join(root, 'evidence-home');

  await check('default location is unchanged: <cwd>/.ensemble_reviews, byte for byte', () => {
    const evidenceDir = need('evidenceDir');
    assert.equal(evidenceDir({ cwd: projectA, env: {} }), path.join(projectA, '.ensemble_reviews'));
    assert.equal(evidenceDir({ cwd: projectA, env: { MOMM_EVIDENCE_HOME: '' } }), path.join(projectA, '.ensemble_reviews'), 'an empty variable is unset');
    assert.equal(evidenceDir({ cwd: path.relative(process.cwd(), projectA) || '.', env: {} }), path.resolve(projectA, '.ensemble_reviews'));
    assert.equal(need('evidenceLocation')({ cwd: projectA, env: {} }).home, null);
  });
  await check('MOMM_EVIDENCE_HOME gives a hashed per-project folder under the chosen home', () => {
    const got = need('evidenceDir')({ cwd: projectA, env: { MOMM_EVIDENCE_HOME: home } });
    assert.equal(got, expectedDir(home, projectA));
    assert.match(path.basename(got), /^[0-9a-f]{32}$/);
    const location = need('evidenceLocation')({ cwd: projectA, env: { MOMM_EVIDENCE_HOME: home } });
    assert.equal(location.project, real(projectA));
    assert.equal(location.home, path.resolve(home));
    assert.equal(need('evidenceDir')({ cwd: projectA, env: {}, home }), got, 'an explicit home is the same setting');
  });
  await check('two projects with the same folder name never share an evidence folder', () => {
    const a = need('evidenceDir')({ cwd: projectA, env: { MOMM_EVIDENCE_HOME: home } });
    const b = need('evidenceDir')({ cwd: projectB, env: { MOMM_EVIDENCE_HOME: home } });
    assert.equal(path.basename(projectA), path.basename(projectB));
    assert.notEqual(a, b);
    assert.equal(b, expectedDir(home, projectB));
  });
  await check('an evidence home inside the project is refused, naming both paths', () => {
    const inside = path.join(projectA, 'private-evidence');
    assert.throws(() => need('evidenceDir')({ cwd: projectA, env: { MOMM_EVIDENCE_HOME: inside } }), (error) => {
      assert.equal(error.code, 'MOMM_EVIDENCE_LOCATION');
      assert(error.message.includes(projectA) || error.message.includes(real(projectA)), 'names the project');
      assert(error.message.includes(inside), 'names the evidence location');
      return true;
    });
    assert.throws(() => need('evidenceDir')({ cwd: projectA, env: { MOMM_EVIDENCE_HOME: projectA } }), { code: 'MOMM_EVIDENCE_LOCATION' });
  });
  await check('an evidence home that reaches the project through a link or junction is refused (real spelling)', () => {
    const link = path.join(root, 'alias-of-one');
    fs.symlinkSync(path.join(root, 'one'), link, win ? 'junction' : 'dir');
    const aliasHome = path.join(link, 'app', 'evidence');
    assert.equal(path.relative(projectA, aliasHome).startsWith('..'), true, 'literally outside the project');
    assert.throws(() => need('evidenceDir')({ cwd: projectA, env: { MOMM_EVIDENCE_HOME: aliasHome } }), { code: 'MOMM_EVIDENCE_LOCATION' });
    // The project reached through the alias is still the same project, with the same folder.
    assert.equal(need('evidenceDir')({ cwd: path.join(link, 'app'), env: { MOMM_EVIDENCE_HOME: home } }), expectedDir(home, projectA));
  });
  await check('a relative evidence home is refused', () => {
    assert.throws(() => need('evidenceDir')({ cwd: projectA, env: { MOMM_EVIDENCE_HOME: 'relative-evidence' } }), { code: 'MOMM_EVIDENCE_LOCATION' });
  });
  await check('--evidence-home is taken from the command line and sets the variable for the process', () => {
    const take = need('takeEvidenceHomeOption');
    const argv = ['node', 'multi-review.mjs', 'evidence', '--evidence-home', home, '--status'], env = {};
    take(argv, env);
    assert.deepEqual(argv, ['node', 'multi-review.mjs', 'evidence', '--status']);
    assert.equal(env.MOMM_EVIDENCE_HOME, path.resolve(home));
    const eq = ['node', 'x', `--evidence-home=${home}`], env2 = {};
    take(eq, env2); assert.deepEqual(eq, ['node', 'x']); assert.equal(env2.MOMM_EVIDENCE_HOME, path.resolve(home));
    assert.throws(() => take(['node', 'x', '--evidence-home'], {}), { code: 'MOMM_EVIDENCE_LOCATION' });
    assert.throws(() => take(['node', 'x', '--evidence-home', home, '--evidence-home', home], {}), { code: 'MOMM_EVIDENCE_LOCATION' });
    const untouched = ['node', 'x', '--input', 'a.txt'], env3 = {};
    take(untouched, env3); assert.deepEqual(untouched, ['node', 'x', '--input', 'a.txt']); assert.equal(env3.MOMM_EVIDENCE_HOME, undefined);
  });
  await check('logical .ensemble_reviews references map into the resolved folder; project files stay in the project', () => {
    const evidenceFile = need('evidenceFile');
    const dir = expectedDir(home, projectA);
    assert.equal(evidenceFile('.ensemble_reviews/reports/rev_x.json', { root: projectA, dir }), path.join(dir, 'reports', 'rev_x.json'));
    assert.equal(evidenceFile('src/a.js', { root: projectA, dir }), path.join(projectA, 'src', 'a.js'));
    const local = path.join(projectA, '.ensemble_reviews');
    assert.equal(evidenceFile('.ensemble_reviews/reports/rev_x.json', { root: projectA, dir: local }), path.join(projectA, '.ensemble_reviews', 'reports', 'rev_x.json'));
  });

  // A private per-user folder passes; a broadened one is refused exactly as today.
  const homeP = path.join(root, 'home-private');
  await check('a private per-project folder is created under the home, marked with its project, and passes', () => {
    const location = need('evidenceLocation')({ cwd: projectA, env: { MOMM_EVIDENCE_HOME: homeP } });
    const verdict = preparePrivateEvidence(location.dir);
    assert.equal(verdict.verified, true);
    const marker = need('recordEvidenceProject')(location);
    assert.equal(marker.created, true);
    const body = JSON.parse(fs.readFileSync(path.join(location.dir, 'project.json'), 'utf8'));
    assert.equal(body.project, real(projectA));
    assert.equal(requirePrivateEvidence(location.dir).verified, true, 'the marker keeps the folder private');
    if (!win) assert.equal(fs.statSync(path.join(location.dir, 'project.json')).mode & 0o077, 0);
    assert.equal(need('recordEvidenceProject')(location).created, false, 'idempotent');
    assert.equal(need('readEvidenceProject')(location.dir), real(projectA));
  });
  await check('a marker naming another project is refused', () => {
    const location = need('evidenceLocation')({ cwd: projectA, env: { MOMM_EVIDENCE_HOME: homeP } });
    const file = path.join(location.dir, 'project.json'), original = fs.readFileSync(file);
    try {
      fs.writeFileSync(file, JSON.stringify({ schema: 'momm-evidence-home/1', project: real(projectB) }));
      assert.throws(() => need('recordEvidenceProject')(location), { code: 'MOMM_EVIDENCE_LOCATION' });
    } finally { fs.writeFileSync(file, original); }
  });
  await check('a broadened evidence home is refused exactly as a broadened project folder is', () => {
    const location = need('evidenceLocation')({ cwd: projectB, env: { MOMM_EVIDENCE_HOME: homeP } });
    preparePrivateEvidence(location.dir);
    if (win) {
      const grant = spawnSync(path.join(process.env.SystemRoot, 'System32', 'icacls.exe'), [location.dir, '/grant', '*S-1-5-32-545:(OI)(CI)RX'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
      assert.equal(grant.status, 0, 'disposable broad fixture preparation failed');
    } else fs.chmodSync(location.dir, 0o755);
    assert.throws(() => requirePrivateEvidence(location.dir), (error) => error.code === 'MOMM_EVIDENCE_PERMISSIONS' && /MOMM cannot verify private evidence-folder permissions/.test(error.message));
    assert.throws(() => preparePrivateEvidence(location.dir), { code: 'MOMM_EVIDENCE_PERMISSIONS' });
    // The real dispatcher refuses before reading any input, as it does for a broad project folder.
    const run = node([path.join(scripts, 'multi-review.mjs'), '--governor', 'codex', '--reviewers', 'codex', '--input', 'missing-synthetic-input.txt', '--no-ui'], projectB, { MOMM_EVIDENCE_HOME: homeP });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /MOMM cannot verify private evidence-folder permissions/);
    assert.doesNotMatch(run.stderr, /missing-synthetic-input/);
    assert.equal(fs.existsSync(path.join(projectB, '.ensemble_reviews')), false, 'nothing is created in the project');
  });
  await check('the dispatcher refuses an evidence home inside the project before reading input', () => {
    const inside = path.join(projectA, 'ev');
    const run = node([path.join(scripts, 'multi-review.mjs'), '--governor', 'codex', '--reviewers', 'codex', '--input', 'missing-synthetic-input.txt', '--no-ui'], projectA, { MOMM_EVIDENCE_HOME: inside });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /outside the project/);
    assert.doesNotMatch(run.stderr, /missing-synthetic-input/);
    assert.equal(fs.existsSync(inside), false);
    assert.equal(fs.existsSync(path.join(projectA, '.ensemble_reviews')), false);
  });
  await check('evidence --protect accepts a marked evidence-home folder and still refuses any other folder', () => {
    const privateStat = { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false, uid: 1, mode: 0o40700, nlink: 1 };
    const markerStat = { ...privateStat, isDirectory: () => false, isFile: () => true, mode: 0o100600 };
    const key = 'a'.repeat(32), target = path.resolve(root, 'synthetic-home', key);
    const fsx = (withMarker) => ({ lstatSync: (p) => { if (path.basename(p) === 'project.json') { if (withMarker) return markerStat; const e = new Error('absent'); e.code = 'ENOENT'; throw e; } return privateStat; }, readdirSync: () => [] });
    assert.equal(protectEvidence(target, { platform: 'linux', uid: 1, fsx: fsx(true) }).changed, false);
    assert.throws(() => protectEvidence(target, { platform: 'linux', uid: 1, fsx: fsx(false) }), { code: 'MOMM_EVIDENCE_PERMISSIONS' });
    assert.throws(() => protectEvidence(path.resolve(root, 'synthetic-home', 'not-a-key'), { platform: 'linux', uid: 1, fsx: fsx(true) }), { code: 'MOMM_EVIDENCE_PERMISSIONS' });
  });

  // End to end: attempts, checks, governor, ledger, scorecard, stats and status all follow the setting.
  const homeE = path.join(root, 'home-e2e'), project = mk('three', 'app');
  const env = { MOMM_EVIDENCE_HOME: homeE };
  const dir = expectedDir(homeE, project);
  const good = 'module.exports = a => a.reduce((s, x) => s + x, 0) / a.length;\n';
  fs.writeFileSync(path.join(project, 'mean.cjs'), good);
  fs.writeFileSync(path.join(project, 'mean.test.cjs'), "const assert = require('assert'); assert.strictEqual(require('./mean.cjs')([2, 4]), 3); console.log('mean ok');\n");
  const runId = 'rev_evidence_home_e2e';
  const writePrivate = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, text, { mode: 0o600 }); };
  await check('end to end: attempt records, reports and logs live under the evidence home', async () => {
    if (typeof loc.evidenceLocation === 'function') {
      const location = loc.evidenceLocation({ cwd: project, env });
      preparePrivateEvidence(location.dir); loc.recordEvidenceProject(location);
    } else preparePrivateEvidence(dir);
    const inputHash = digest(good), startedAt = new Date().toISOString();
    const record = attemptRecord({ agent: 'claude', status: 'success' }, { runId, piece: 'whole', inputHash, pieceHash: inputHash, ordinal: 1, durationMs: 1, startedAt });
    const reference = await withEnv(homeE, () => persistAttempt(project, record));
    assert.equal(reference.path, `.ensemble_reviews/attempts/${runId}-${record.attempt_id}.json`, 'the reference keeps its logical spelling');
    assert(fs.existsSync(path.join(dir, 'attempts', `${runId}-${record.attempt_id}.json`)), 'attempt written under the home');
    const report = { run_id: runId, input_sha256: inputHash, governor: 'codex', test_fixture: 'synthetic evidence-home fixture; no provider was asked',
      reviewers: [{ agent: 'claude', status: 'success', verdict: 'ACCEPT', review_contract: 'momm-peer-review/2', reviewed_scope: [{ quote: 'a.length', assessment: 'The divisor is the element count.' }], suggested_improvements: [] }],
      findings: [], source_snapshot: captureSourceSnapshot(project, good, 'mean.cjs'), quorum: { required: 1, achieved: 1, met: true },
      gate_policy: { strict: false, quorum_required: 1, requested_routes: ['claude'] }, attempt_evidence: [{ ...record, evidence: reference }] };
    const reportText = JSON.stringify(report, null, 2) + '\n';
    writePrivate(path.join(dir, 'reports', `${runId}.json`), reportText);
    writePrivate(path.join(dir, 'review-log.jsonl'), JSON.stringify({ run_id: runId, governor: 'codex', report_path: `.ensemble_reviews/reports/${runId}.json`, report_sha256: digest(reportText), input_sha256: inputHash, reviewer_status: { claude: 'success' } }) + '\n');
  });
  await check('end to end: checks.mjs records the final check under the evidence home', () => {
    const run = node([path.join(scripts, 'checks.mjs'), '--run', runId, '--phase', 'final', '--test', 'mean.test.cjs'], project, env);
    assert.equal(run.status, 0, (run.stderr || run.stdout).slice(0, 300));
    assert(fs.existsSync(path.join(dir, 'verification', `${runId}.json`)));
    assert.match(JSON.parse(run.stdout).path, /^\.ensemble_reviews\/checks\//);
  });
  await check('end to end: governor.mjs --record validates and records completion under the evidence home and rebuilds its ledger', () => {
    const run = node([path.join(scripts, 'governor.mjs'), '--run', runId, '--record'], project, env);
    assert.equal(run.status, 0, (run.stderr || run.stdout).slice(0, 400));
    const result = JSON.parse(run.stdout);
    assert.equal(result.complete, true, JSON.stringify(result.errors));
    assert.equal(result.receipt_path, `.ensemble_reviews/completions/${runId}.json`);
    assert(fs.existsSync(path.join(dir, 'completions', `${runId}.json`)));
    assert.equal(result.ledger_rebuilt, true);
    assert.equal(fileURLToPath(result.ledger_url), path.join(dir, 'ledger.html'));
  });
  await check('end to end: a checks.mjs mutation record (B4) keeps its reverted-bytes snapshot under the evidence home', () => {
    const run = node([path.join(scripts, 'checks.mjs'), '--run', runId, '--phase', 'mutation', '--item', 'c'.repeat(64), '--test', 'mean.test.cjs', '--artifact', 'mean.cjs'], project, env);
    assert.equal(run.status, 0, (run.stderr || run.stdout).slice(0, 300));
    const recorded = JSON.parse(run.stdout).path;
    assert.match(recorded, /^\.ensemble_reviews\/checks\/[^/]+\/check\.json$/);
    const folder = path.join(dir, ...recorded.split('/').slice(1, -1));
    assert(fs.existsSync(path.join(folder, 'source-0.txt')), 'the reverted bytes are kept under the home');
    const body = JSON.parse(fs.readFileSync(path.join(folder, 'check.json'), 'utf8'));
    assert.equal(body.phase, 'mutation');
    assert.match(body.artifacts[0].snapshot.path, /^\.ensemble_reviews\/checks\//);
    assert.equal(fs.existsSync(path.join(project, '.ensemble_reviews')), false);
  });
  await check('end to end: attempt-audit.mjs reads and writes the evidence home', () => {
    const run = node([path.join(scripts, 'attempt-audit.mjs'), runId], project, env);
    assert.equal(run.status, 0, (run.stderr || run.stdout).slice(0, 300));
    const name = JSON.parse(run.stdout).path;
    assert.match(name, /^\.ensemble_reviews\/attempt-audit-/);
    assert(fs.existsSync(path.join(dir, name.slice('.ensemble_reviews/'.length))));
  });
  await check('end to end: ledger.mjs builds from the evidence home and names the project', () => {
    const run = node([path.join(scripts, 'ledger.mjs')], project, env);
    assert.equal(run.status, 0, (run.stderr || run.stdout).slice(0, 300));
    const html = fs.readFileSync(path.join(dir, 'ledger.html'), 'utf8');
    assert(html.includes(runId));
    assert(html.includes(real(project).replaceAll('\\', '/')), 'the page names the project the folder belongs to');
  });
  await check('end to end: scorecard, --stats and evidence --status follow the setting', async () => {
    const card = await withEnv(homeE, () => buildScorecard(project));
    assert.equal(card.ensemble.runs, 1);
    fs.appendFileSync(path.join(dir, 'dispositions.jsonl'), JSON.stringify({ run_id: runId, reviewer: 'claude', suggestion: 'synthetic', disposition: 'applied', reason: 'synthetic' }) + '\n', { mode: 0o600 });
    const stats = node([path.join(scripts, 'multi-review.mjs'), '--stats'], project, env);
    assert.equal(stats.status, 0);
    assert.match(stats.stdout, /claude/);
    const status = node([path.join(scripts, 'multi-review.mjs'), 'evidence', '--status'], project, env);
    const body = JSON.parse(status.stdout);
    assert.equal(body.evidence, dir);
    assert.equal(body.exists, true);
    assert.equal(body.verified, true, JSON.stringify(body));
    const flag = node([path.join(scripts, 'multi-review.mjs'), 'evidence', '--status', '--evidence-home', homeE], project);
    assert.equal(JSON.parse(flag.stdout).evidence, dir, '--evidence-home sets the same location');
  });
  await check('end to end: nothing was written inside the project', () => {
    assert.equal(fs.existsSync(path.join(project, '.ensemble_reviews')), false);
  });
  await check('default evidence --status still reports <cwd>/.ensemble_reviews', () => {
    const status = node([path.join(scripts, 'multi-review.mjs'), 'evidence', '--status'], project);
    const body = JSON.parse(status.stdout);
    assert.equal(body.evidence, path.join(project, '.ensemble_reviews'));
    assert.equal(body.exists, false);
    assert.equal(Object.hasOwn(body, 'evidence_home'), false, 'default output is unchanged');
  });
  await check('inspection still sees the evidence home as private after the whole flow', () => {
    assert.equal(inspectEvidencePermissions(dir).verified, true);
  });

  // Follow-up: the probe ledger and the updater's review-log search follow the same setting.
  const { recordProbe, latestProbes, latestModalityProbes } = await import('./probes.mjs');
  const probeProject = mk('four', 'app'), probeHome = path.join(root, 'home-probes');
  const probeDir = expectedDir(probeHome, probeProject);
  await check('probes.mjs records to and reads from the evidence home, creating it private', async () => {
    const at = new Date().toISOString();
    const written = await withEnv(probeHome, () => recordProbe(probeProject, { cli: 'codex', schema: 'momm-probe/1', at, verdict: 'pass' }));
    assert.equal(written, path.join(probeDir, 'probes.jsonl'));
    assert.equal(fs.existsSync(path.join(probeProject, '.ensemble_reviews')), false, 'nothing is written inside the project');
    assert.equal(inspectEvidencePermissions(probeDir).verified, true, 'a folder the probe creates is private');
    assert.equal(JSON.parse(fs.readFileSync(path.join(probeDir, 'project.json'), 'utf8')).project, real(probeProject));
    assert.equal((await withEnv(probeHome, () => latestProbes(probeProject))).codex.at, at);
    assert.deepEqual(await withEnv(probeHome, () => latestModalityProbes(probeProject)), {});
    assert.deepEqual(await withEnv(undefined, () => latestProbes(probeProject)), {}, 'the default location is still the project folder');
  });
  await check('probes.mjs refuses an evidence home inside the project and writes nothing', async () => {
    const inside = path.join(probeProject, 'ev');
    await withEnv(inside, () => assert.throws(() => recordProbe(probeProject, { cli: 'codex', schema: 'momm-probe/1', at: new Date().toISOString(), verdict: 'pass' }), { code: 'MOMM_EVIDENCE_LOCATION' }));
    assert.equal(fs.existsSync(inside), false);
    assert.equal(fs.existsSync(path.join(probeProject, '.ensemble_reviews')), false);
  });
  const update = await import('./update.mjs');
  await check('update.mjs keeps its own copy of the location rule, and it agrees with evidence-location.mjs', () => {
    assert.equal(typeof update.reviewLogFor, 'function', 'update.mjs must export reviewLogFor (self-contained copy of the rule)');
    const aliasApp = path.join(root, 'alias-of-one', 'app');
    const cases = [
      [projectA, {}], [projectA, { MOMM_EVIDENCE_HOME: '' }], [projectA, { MOMM_EVIDENCE_HOME: home }], [projectB, { MOMM_EVIDENCE_HOME: home }],
      [aliasApp, { MOMM_EVIDENCE_HOME: home }], [projectA, { MOMM_EVIDENCE_HOME: 'relative-evidence' }], [projectA, { MOMM_EVIDENCE_HOME: path.join(projectA, 'inside') }],
      [projectA, { MOMM_EVIDENCE_HOME: projectA }], [projectA, { MOMM_EVIDENCE_HOME: path.join(aliasApp, 'evidence') }], [path.join(root, 'no-such-project'), { MOMM_EVIDENCE_HOME: home }],
    ];
    for (const [cwd, env] of cases) {
      let expected;
      try { expected = path.join(need('evidenceDir')({ cwd, env }), 'review-log.jsonl'); } catch { expected = null; }
      assert.equal(update.reviewLogFor(cwd, env), expected, `${path.relative(root, cwd)} with ${JSON.stringify(env.MOMM_EVIDENCE_HOME ?? null)}`);
    }
  });
  await check('update.mjs --check-all reads the review log from the evidence home', () => {
    fs.appendFileSync(path.join(dir, 'review-log.jsonl'), JSON.stringify({ timestamp: new Date().toISOString(), run_id: 'rev_evidence_home_later', reviewer_status: { claude: 'success' } }) + '\n');
    const result = update.lastSuccessfulReviews([project], { MOMM_EVIDENCE_HOME: homeE });
    assert.equal(result.present, true);
    assert.equal(result.file, path.join(dir, 'review-log.jsonl'));
    assert.equal(result.routes.claude?.run_id, 'rev_evidence_home_later');
    const refused = update.lastSuccessfulReviews([project], { MOMM_EVIDENCE_HOME: path.join(project, 'inside') });
    assert.equal(refused.present, false, 'a refused setting reads nothing, not the in-project folder');
    assert.deepEqual(refused.searched, []);
  });
} finally {
  const resolved = path.resolve(root), temporary = path.resolve(os.tmpdir());
  assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('momm-evidence-location-test-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
const failed = checks.filter((c) => !c.passed);
console.log(JSON.stringify({ node: process.version, passed: checks.length - failed.length, total: checks.length, checks }, null, 2));
process.exitCode = failed.length ? 1 : 0;
