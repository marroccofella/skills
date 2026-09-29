#!/usr/bin/env node
// MOMM signed lifecycle drill: fresh signed install, upgrades from older signed releases, rollback, an
// upgrade interrupted mid-transaction and recovered with the retained updater (1.17 A6),
// re-upgrade and refusal of a damaged payload, each in a disposable user profile, against REAL signed
// tags verified with gitsign. No mocked verifier, no self-signing, no bypass. It never touches the
// real home folder, a real harness, or any repository other than the disposable clones it makes.
//
//   node scripts/momm-lifecycle-drill.mjs --target momm-1.16.0 --expect 1.16.0 --from momm-1.15.1 --out <dir>
//   node scripts/momm-lifecycle-drill.mjs --checkpoint <main-commit> --expect 1.16.1 --from momm-1.16.0,momm-1.15.1 --out <dir>
//
// --target installs a stable signed tag; --checkpoint installs the signed development checkpoint
// momm-main-<commit> through the updater's main channel. The receipt (JSON) is written to --out and
// the process exits 1 if any required step failed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const drillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE = 'https://github.com/marroccofella/skills.git';
const SIGNER = 'https://github.com/marroccofella/skills/.github/workflows/momm-release.yml@refs/heads/main';
const ISSUER = 'https://token.actions.githubusercontent.com';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--target', '--checkpoint', '--expect', '--from', '--out'].includes(args[i]) || args[i + 1] === undefined) throw new Error(`Unknown or incomplete option ${args[i]}`);
  opt[args[i].slice(2)] = args[i + 1];
}
if (!!opt.target === !!opt.checkpoint) throw new Error('Give exactly one of --target momm-x.y.z or --checkpoint <main-commit>');
if (opt.target && !/^momm-\d+\.\d+\.\d+$/.test(opt.target)) throw new Error('--target must be momm-x.y.z');
if (opt.checkpoint && !/^[0-9a-f]{40}$/.test(opt.checkpoint)) throw new Error('--checkpoint must be a full commit id');
if (!/^\d+\.\d+\.\d+$/.test(opt.expect || '')) throw new Error('--expect x.y.z is required');
const froms = (opt.from || '').split(',').filter(Boolean);
if (froms.some(f => !/^momm-\d+\.\d+\.\d+$/.test(f))) throw new Error('--from takes momm-x.y.z tags, comma-separated');
const out = path.resolve(opt.out || 'lifecycle-receipt');
fs.mkdirSync(out, { recursive: true });

const targetTag = opt.target || `momm-main-${opt.checkpoint}`;
const work = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'momm-drill-'));
const receipt = { schema: 'momm-lifecycle-drill/1', target: targetTag, expect: opt.expect, from: froms,
  platform: process.platform, arch: process.arch, node: process.version, started_at: new Date().toISOString(), steps: [] };

const run = (cmd, argv, { cwd, env, allowFail = false } = {}) => {
  const r = spawnSync(cmd, argv, { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 600_000, maxBuffer: 32_000_000 });
  const res = { cmd: [path.basename(cmd), ...argv].join(' '), code: r.status, full: r.stdout || '', out: (r.stdout || '').slice(-4000), err: (r.stderr || '').slice(-4000) };
  if (!allowFail && r.status !== 0) throw Object.assign(new Error(`${res.cmd} exited ${r.status}\n${res.err || res.out}`), { res });
  return res;
};
const git = (cwd, ...a) => run('git', a, { cwd }).full.trim();
const homeEnv = (home) => {
  for (const d of ['AppData/Roaming', 'AppData/Local', '.config']) fs.mkdirSync(path.join(home, d), { recursive: true });
  return { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), XDG_CONFIG_HOME: path.join(home, '.config'), NO_UPDATE_CHECK: '1', MOMM_NO_UPDATE_CHECK: '1' };
};
const step = async (name, fn) => {
  const s = { step: name, ok: false, at: new Date().toISOString() };
  try { Object.assign(s, await fn() || {}); s.ok = true; } catch (e) { s.error = String(e.message).slice(0, 3000); }
  receipt.steps.push(s);
  process.stdout.write(`${s.ok ? 'PASS' : 'FAIL'} ${name}${s.ok ? '' : ': ' + s.error.split('\n')[0]}\n`);
  return s.ok;
};
const verifyTag = (repo, tag) => run('gitsign', ['verify-tag', '--certificate-identity', SIGNER, '--certificate-oidc-issuer', ISSUER,
  '--certificate-github-workflow-repository', 'marroccofella/skills', '--certificate-github-workflow-ref', 'refs/heads/main', tag], { cwd: repo });
// Every MOMM version keeps its receipt in the clone's git directory (update.mjs stateDir).
const lockPath = (repo) => path.resolve(repo, git(repo, 'rev-parse', '--git-path', 'momm'), 'momm.lock');
const lock = (repo) => JSON.parse(fs.readFileSync(lockPath(repo), 'utf8'));
const lockSummary = (repo) => { const l = lock(repo); return { version: l.current?.version, commit: l.current?.commit, verified: l.current?.verified, previous: l.previous?.version ?? null }; };
// The drill copy's own read-only inventory (1.16.1 --doctor --versions) reads what the isolated harness loads.
const doctor = (home, expect) => {
  const r = run(process.execPath, [path.join(drillRoot, 'momm/scripts/multi-review.mjs'), '--doctor', '--versions', '--expect', expect], { cwd: home, env: homeEnv(home), allowFail: true });
  if (r.code !== 0) throw new Error(`doctor --versions --expect ${expect} exited ${r.code}: ${(r.out + r.err).slice(-800)}`);
  return { doctor_expect: expect, doctor_exit: r.code };
};
// A signed install exactly as the bootstrap guide describes: clone, fetch the tag, verify it with
// gitsign against the release workflow's identity, check the sealed package hash, then install.
const signedInstall = async (home, tag) => {
  const repo = path.join(home, 'skills');
  run('git', ['clone', '--no-checkout', '--quiet', REMOTE, repo]);
  git(repo, 'fetch', '--quiet', '--no-tags', 'origin', `refs/tags/${tag}:refs/tags/${tag}`);
  verifyTag(repo, tag);
  const commit = git(repo, 'rev-parse', `${tag}^{commit}`);
  if (tag.startsWith('momm-main-') && commit !== tag.slice('momm-main-'.length)) throw new Error('checkpoint tag does not name its commit');
  const manifest = JSON.parse(git(repo, 'show', `${commit}:versions.json`));
  const version = manifest.momm, release = manifest.momm_releases.find(r => r.version === version);
  const { treeHash } = await import(pathToFileURL(path.join(drillRoot, 'momm/scripts/update.mjs')).href);
  if (!release?.sha256 || treeHash(repo, commit) !== release.sha256) throw new Error(`sealed package hash does not match ${tag}`);
  git(repo, 'checkout', '--quiet', '--detach', tag);
  // The codex target links into ~/.agents/skills without needing a harness command installed (the claude
  // target is skipped when the claude command is absent, as on a bare CI runner). Same in 1.15.1 to 1.16.1.
  const inst = run(process.execPath, ['install.mjs', '--target', 'codex'], { cwd: repo, env: homeEnv(home) });
  if (!fs.existsSync(lockPath(repo))) throw new Error(`install wrote no receipt: ${(inst.out + inst.err).slice(-800)}`);
  return { repo, version, commit };
};
const applyArgs = opt.checkpoint ? ['--channel', 'main'] : ['--version', opt.expect];

try {
  await step('environment', () => ({ gitsign: run('gitsign', ['--version']).out.split('\n')[0], git: git(drillRoot, '--version') }));
  await step(`fresh signed install of ${targetTag}`, async () => {
    const home = path.join(work, 'fresh'); const i = await signedInstall(home, targetTag);
    if (i.version !== opt.expect) throw new Error(`installed ${i.version}, expected ${opt.expect}`);
    return { installed: i.version, commit: i.commit, lock: lockSummary(i.repo), ...doctor(home, opt.expect) };
  });
  for (const from of froms) {
    const home = path.join(work, 'from-' + from); let repo;
    const fromVersion = from.slice('momm-'.length);
    if (!await step(`signed install of ${from}`, async () => { const i = await signedInstall(home, from); repo = i.repo; return { installed: i.version, lock: lockSummary(repo), ...doctor(home, fromVersion) }; })) continue;
    const updater = () => path.join(repo, 'momm/scripts/update.mjs');
    const upgrade = async (label) => step(`${label} ${from} -> ${targetTag}`, () => {
      const r = run(process.execPath, [updater(), '--repo', repo, ...applyArgs, '--apply', '--yes', '--accept-protocol'], { cwd: repo, env: homeEnv(home) });
      const l = lockSummary(repo);
      if (l.version !== opt.expect || l.verified !== true) throw new Error(`receipt after upgrade: ${JSON.stringify(l)}`);
      return { lock: l, ...doctor(home, opt.expect), log_tail: r.out.slice(-600) };
    });
    if (!await upgrade('upgrade')) continue;
    await step(`rollback ${targetTag} -> ${from}`, () => {
      run(process.execPath, [updater(), '--repo', repo, '--rollback', '--yes'], { cwd: repo, env: homeEnv(home) });
      const l = lockSummary(repo);
      if (l.version !== fromVersion) throw new Error(`receipt after rollback: ${JSON.stringify(l)}`);
      return { lock: l, ...doctor(home, fromVersion) };
    });
    if (!await upgrade('re-upgrade')) continue;
    // 1.17 A6: recovery from an update interrupted mid-transaction (not drilled in 1.16.1, not waived).
    // Roll back to the older release, start an upgrade, kill it as soon as its transaction journal exists,
    // then recover with the updater retained in the state directory and verify the original install.
    await step(`interrupted upgrade ${from} -> ${targetTag} recovers with the retained updater`, async () => {
      run(process.execPath, [updater(), '--repo', repo, '--rollback', '--yes'], { cwd: repo, env: homeEnv(home) });
      if (lockSummary(repo).version !== fromVersion) throw new Error('could not return to the older release before the interruption');
      const stateDir = path.resolve(repo, git(repo, 'rev-parse', '--git-path', 'momm'));
      const journal = path.join(stateDir, 'transaction.json');
      const headBefore = git(repo, 'rev-parse', 'HEAD');
      const child = spawn(process.execPath, [updater(), '--repo', repo, ...applyArgs, '--apply', '--yes', '--accept-protocol'], { cwd: repo, env: homeEnv(home), stdio: 'ignore', windowsHide: true });
      const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
      let stage = null;
      const deadline = Date.now() + 600_000;
      while (Date.now() < deadline) {
        if (fs.existsSync(journal)) { try { stage = JSON.parse(fs.readFileSync(journal, 'utf8')).stage ?? 'unknown'; } catch { stage = 'partial'; } child.kill('SIGKILL'); break; }
        if (child.exitCode !== null) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      const end = await exited;
      if (!stage) throw new Error(`the upgrade finished (exit ${end.code}) before a transaction journal appeared; nothing was interrupted`);
      if (!fs.existsSync(journal)) throw new Error('the journal vanished although the process was killed mid-transaction');
      const retained = path.join(stateDir, 'update.mjs');
      if (!fs.existsSync(retained)) throw new Error('no retained updater in the state directory');
      const rec = run(process.execPath, [retained, '--repo', repo, '--rollback', '--yes'], { cwd: repo, env: homeEnv(home), allowFail: true });
      if (rec.code !== 0) throw new Error(`recovery exited ${rec.code}: ${(rec.out + rec.err).slice(-800)}`);
      const l = lockSummary(repo);
      if (l.version !== fromVersion) throw new Error(`receipt after recovery: ${JSON.stringify(l)}`);
      if (git(repo, 'rev-parse', 'HEAD') !== headBefore) throw new Error('checkout after recovery is not the original commit');
      if (fs.existsSync(journal)) throw new Error('the transaction journal remains after recovery');
      return { interrupted_at_stage: stage, killed_by: end.signal ?? `exit ${end.code}`, lock: l, ...doctor(home, fromVersion) };
    });
  }
  await step('damaged payload is refused and nothing changes', async () => {
    // A mirror whose release ref points at an unsigned commit that alters the package. The updater must
    // refuse before installing anything, and the installed receipt and checkout must stay as they were.
    const home = path.join(work, 'damaged'); const base = froms[0] || targetTag;
    const i = await signedInstall(home, base);
    const mirror = path.join(work, 'mirror.git');
    run('git', ['clone', '--quiet', '--bare', REMOTE, mirror]);
    const scratch = path.join(work, 'tamper');
    run('git', ['clone', '--quiet', mirror, scratch]);
    git(scratch, 'config', 'user.email', 'drill@example.invalid'); git(scratch, 'config', 'user.name', 'drill');
    fs.appendFileSync(path.join(scratch, 'momm/scripts/multi-review.mjs'), '\n// tampered by the lifecycle drill\n');
    git(scratch, 'commit', '--quiet', '-am', 'tampered payload (drill)');
    const tampered = git(scratch, 'rev-parse', 'HEAD');
    if (opt.checkpoint) git(scratch, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
    else { git(scratch, 'tag', '-f', targetTag, tampered); git(scratch, 'push', '--quiet', '--force', 'origin', `refs/tags/${targetTag}`); }
    const before = fs.readFileSync(lockPath(i.repo), 'utf8'), headBefore = git(i.repo, 'rev-parse', 'HEAD');
    const { update } = await import(pathToFileURL(path.join(i.repo, 'momm/scripts/update.mjs')).href + `?drill=${Date.now()}`);
    const manifest = JSON.parse(git(mirror, 'show', `${tampered}:versions.json`));
    let refused = null;
    try { await update(['--repo', i.repo, ...applyArgs, '--apply', '--yes', '--accept-protocol'], { remote: mirror, manifest: async () => manifest, log: () => {} }); }
    catch (e) { refused = String(e.message).split('\n')[0].slice(0, 300); }
    if (!refused) throw new Error('a tampered, unsigned payload was accepted');
    if (fs.readFileSync(lockPath(i.repo), 'utf8') !== before || git(i.repo, 'rev-parse', 'HEAD') !== headBefore) throw new Error('refusal changed the installation');
    return { refused_with: refused, installed_unchanged: true };
  });
} finally {
  receipt.finished_at = new Date().toISOString();
  receipt.passed = receipt.steps.length > 0 && receipt.steps.every(s => s.ok);
  const body = JSON.stringify(receipt, null, 2) + '\n';
  const name = `lifecycle-${process.platform}-node${process.versions.node.split('.')[0]}-${targetTag}.json`;
  fs.writeFileSync(path.join(out, name), body);
  fs.writeFileSync(path.join(out, name + '.sha256'), createHash('sha256').update(body).digest('hex') + '  ' + name + '\n');
  try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  process.stdout.write(`${receipt.passed ? 'ALL PASSED' : 'FAILED'}: receipt ${path.join(out, name)}\n`);
  if (!receipt.passed) process.exitCode = 1;
}
