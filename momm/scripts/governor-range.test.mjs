// MOMM 1.16.1 A3: a review of a COMMITTED RANGE is bound to that range. 1.16.0 reviewed committed
// ranges in its own release gate and then could not issue a completion receipt for them, because the
// source snapshot only understood `git diff HEAD` and file input. Real temporary Git repository;
// zero provider calls, zero network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureSourceSnapshot, inspectCompletion } from './governor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatcher = path.join(here, 'multi-review.mjs');
const results = [], failures = [];
const test = (name, fn) => { try { fn(); results.push(name); } catch (e) { failures.push({ name, error: String(e?.message ?? e).slice(0, 500) }); } };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const repo = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'momm-range-'));
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
const git = (...args) => { const p = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: gitEnv, windowsHide: true }); if (p.status !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr}`); return p.stdout; };
const write = (rel, text) => { const f = path.join(repo, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary'];
const rangeDiff = (base, head, ...paths) => git('diff', ...FLAGS, base, head, '--', ...paths);

try {
  git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false'); git('config', 'commit.gpgsign', 'false');
  write('src/a.mjs', 'export const a = 1;\n'); write('src/gone.mjs', 'export const gone = true;\n'); write('src/old-name.mjs', 'export const moved = 1;\n'); write('docs/note.md', 'note\n');
  git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD').trim();
  write('src/a.mjs', 'export const a = 2;\n'); write('src/new.mjs', 'export const n = 1;\n'); fs.rmSync(path.join(repo, 'src/gone.mjs'));
  fs.renameSync(path.join(repo, 'src/old-name.mjs'), path.join(repo, 'src/new-name.mjs')); write('docs/note.md', 'note two\n');
  git('add', '-A'); git('commit', '-qm', 'head'); const head = git('rev-parse', 'HEAD').trim();
  const headBytesOfA = fs.readFileSync(path.join(repo, 'src/a.mjs'));
  // The working tree moves on after the reviewed head: the snapshot must still describe the HEAD COMMIT.
  write('src/a.mjs', 'export const a = 3; // later, uncommitted\n');

  test('a committed range is bound to both full commit ids and to the file bytes AT the head commit', () => {
    const artifact = rangeDiff(base, head);
    const snap = captureSourceSnapshot(repo, artifact, null, { base, head });
    assert.equal(snap.complete, true, snap.reason);
    assert.equal(snap.kind, 'git_range'); assert.equal(snap.base, base); assert.equal(snap.head, head);
    const a = snap.files.find(f => f.path === 'src/a.mjs');
    assert.equal(a.sha256, sha(headBytesOfA), 'hash must come from the head commit, not from the later working tree');
    assert.notEqual(a.sha256, sha(fs.readFileSync(path.join(repo, 'src/a.mjs'))));
  });
  test('short names resolve, and what is recorded is always the full id', () => {
    const snap = captureSourceSnapshot(repo, rangeDiff(base, head), null, { base: base.slice(0, 8), head: 'HEAD' });
    assert.equal(snap.complete, true, snap.reason); assert.equal(snap.base, base); assert.equal(snap.head, head);
  });
  test('a deleted file is named as deleted, never silently dropped, and a rename is a delete plus an add', () => {
    const snap = captureSourceSnapshot(repo, rangeDiff(base, head), null, { base, head });
    assert.deepEqual([...snap.deleted].sort(), ['src/gone.mjs', 'src/old-name.mjs']);
    assert(snap.files.some(f => f.path === 'src/new-name.mjs')); assert(snap.files.some(f => f.path === 'src/new.mjs'));
    assert(!snap.files.some(f => f.path === 'src/gone.mjs'));
  });
  test('a diff that is not exactly that range is refused: the receipt would describe the wrong tree', () => {
    const tampered = rangeDiff(base, head).replace('export const a = 2;', 'export const a = 2; // edited after the fact');
    const snap = captureSourceSnapshot(repo, tampered, null, { base, head });
    assert.equal(snap.complete, false); assert.match(snap.reason, /differs from git diff/);
  });
  test('path limits are part of the identity and are honoured', () => {
    const snap = captureSourceSnapshot(repo, rangeDiff(base, head, 'docs'), null, { base, head, paths: ['docs'] });
    assert.equal(snap.complete, true, snap.reason); assert.deepEqual(snap.files.map(f => f.path), ['docs/note.md']); assert.deepEqual(snap.paths, ['docs']);
    const mismatch = captureSourceSnapshot(repo, rangeDiff(base, head), null, { base, head, paths: ['docs'] });
    assert.equal(mismatch.complete, false);
  });
  test('an option-shaped or unknown revision is refused before Git sees it as an option', () => {
    for (const bad of ['--output=pwned', '-p', 'no-such-ref', '', 'HEAD;rm', 'a b']) {
      const snap = captureSourceSnapshot(repo, rangeDiff(base, head), null, { base: bad, head });
      assert.equal(snap.complete, false, JSON.stringify(bad)); assert.equal(fs.existsSync(path.join(repo, 'pwned')), false);
    }
    const badPath = captureSourceSnapshot(repo, rangeDiff(base, head), null, { base, head, paths: ['--output=pwned'] });
    assert.equal(badPath.complete, false);
  });
  test('an empty range is not a reviewed source', () => {
    const snap = captureSourceSnapshot(repo, '', null, { base: head, head });
    assert.equal(snap.complete, false);
  });
  test('the old behaviours are unchanged: a working-tree diff and a file input still snapshot as before', () => {
    const wt = git('diff', '--no-color', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD');
    const snap = captureSourceSnapshot(repo, wt, null);
    assert.equal(snap.complete, true, snap.reason); assert.equal(snap.kind ?? 'git_worktree', 'git_worktree');
    const file = captureSourceSnapshot(repo, fs.readFileSync(path.join(repo, 'docs/note.md'), 'utf8'), 'docs/note.md');
    assert.equal(file.complete, true, file.reason);
  });

  const run = (args, input) => spawnSync(process.execPath, [dispatcher, ...args], { cwd: repo, input, encoding: 'utf8', env: { ...process.env, NO_UPDATE_CHECK: '1', MOMM_NO_UPDATE_CHECK: '1' }, windowsHide: true, timeout: 90000 });
  test('dispatcher --range: MOMM takes the diff itself, and the report names the range it reviewed', () => {
    // The only requested route is the governor, which excludes itself: zero provider calls.
    const p = run(['--governor', 'codex', '--reviewers', 'codex', '--range', `${base}..${head}`], '');
    assert.equal(p.status, 0, p.stderr.slice(-600));
    const report = JSON.parse(p.stdout);
    assert.equal(report.source_snapshot.complete, true, report.source_snapshot.reason);
    assert.equal(report.source_snapshot.kind, 'git_range'); assert.equal(report.source_snapshot.base, base); assert.equal(report.source_snapshot.head, head);
    assert.equal(report.input_bytes, Buffer.byteLength(rangeDiff(base, head)));
    // The completion validator no longer stops at "snapshot missing" for a committed range, and says which tree.
    const state = inspectCompletion(repo, report.run_id);
    assert(!state.errors.some(e => /source snapshot missing/.test(e)), state.errors.join(' | '));
    assert.equal(state.source?.kind, 'git_range'); assert.equal(state.source.base, base); assert.equal(state.source.head, head);
  });
  test('dispatcher --range with a different diff on stdin is refused, never silently preferred', () => {
    const p = run(['--governor', 'codex', '--reviewers', 'codex', '--range', `${base}..${head}`], 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n');
    assert.notEqual(p.status, 0); assert.match(p.stderr + p.stdout, /stdin.*range|range.*stdin/i);
  });
  test('dispatcher --range accepts the identical diff on stdin (how the 1.16.0 gates were fed)', () => {
    const p = run(['--governor', 'codex', '--reviewers', 'codex', '--range', `${base}..${head}`, '--range-path', 'docs'], rangeDiff(base, head, 'docs'));
    assert.equal(p.status, 0, p.stderr.slice(-600)); assert.deepEqual(JSON.parse(p.stdout).source_snapshot.paths, ['docs']);
  });
  test('dispatcher --range refuses malformed ranges and cannot be combined with --input', () => {
    for (const bad of ['HEAD', '..HEAD', 'a...b', 'a..', '--x..HEAD']) assert.notEqual(run(['--governor', 'codex', '--reviewers', 'codex', '--range', bad], '').status, 0, bad);
    assert.notEqual(run(['--governor', 'codex', '--reviewers', 'codex', '--range', `${base}..${head}`, '--input', 'docs/note.md'], '').status, 0);
  });
} finally { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }

console.log(JSON.stringify({ passed: failures.length === 0, checks: results.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
