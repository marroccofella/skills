#!/usr/bin/env node
// A6b (1.17): a stale update claim left by a killed updater is released only by an explicit,
// token-confirmed command, never automatically. Found by the 1.17 drill rehearsal (GitHub run
// 36635871345): recovery after a crash needed a manual file deletion. Real temporary Git
// repositories only; nothing contacts a provider, the network or the user's installation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as updater from './update.mjs';

const { git, recordInstall, stateDir, update, parse } = updater;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-update-claim-')), results = [];
const write = (file, value) => { const p = path.join(temp, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); };
async function test(name, fn) { try { await fn(); results.push({ name, passed: true }); } catch (e) { results.push({ name, passed: false, error: String(e?.message ?? e).split('\n').slice(0, 4).join(' | ').slice(0, 600) }); } }
// A PID that certainly belonged to a process which has already finished.
const deadPid = () => { const r = spawnSync(process.execPath, ['-e', ''], { windowsHide: true }); assert.equal(r.status, 0); return r.pid; };
// A fresh claim identifier per run, in the shape update.mjs writes (a v4 UUID).
const TOKEN = randomUUID();

try {
  git(temp, 'init');
  write('versions.json', JSON.stringify({ momm: '1.0.0' }));
  for (const f of ['momm/SKILL.md', 'momm/scripts/multi-review.mjs', 'momm/scripts/update.mjs']) write(f, 'fixture only\n');
  git(temp, 'add', '.');
  git(temp, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  recordInstall(temp, 'momm/scripts/install.mjs', [{ target: 'custom', status: 'linked', destination: path.join(temp, 'harness', 'momm') }]);
  const dir = stateDir(temp), claim = path.join(dir, 'update.active'), lock = path.join(dir, 'momm.lock'), journal = path.join(dir, 'transaction.json');
  const retained = path.join(dir, 'update.mjs');
  // An interrupted transaction: the journal and receipt must survive the release byte for byte.
  fs.writeFileSync(journal, JSON.stringify({ schema: 'momm-transaction/1', stage: 'prepared', fixture: true }, null, 2) + '\n');
  const journalBytes = fs.readFileSync(journal), lockBytes = fs.readFileSync(lock);
  const stale = (fields = {}) => fs.writeFileSync(claim, JSON.stringify({ pid: deadPid(), token: TOKEN, started: '2026-09-29T10:00:00.000Z', ...fields }));
  const untouched = () => { assert.deepEqual(fs.readFileSync(journal), journalBytes, 'transaction.json changed'); assert.deepEqual(fs.readFileSync(lock), lockBytes, 'momm.lock changed'); };
  const release = (token, deps = {}) => { const lines = []; return update(['--repo', temp, '--release-claim', token], { log: s => lines.push(s), ...deps }).then(r => ({ r, out: lines.join('\n') })); };

  await test('parse: --release-claim takes a token and combines only with --repo', () => {
    assert.equal(parse(['--release-claim', TOKEN]).release_claim, TOKEN);
    assert.equal(parse(['--release-claim', TOKEN, '--repo', temp]).repo, temp);
    assert.throws(() => parse(['--release-claim']), /Missing value/);
    assert.throws(() => parse(['--release-claim', '--rollback']), /Missing value/);
    for (const other of [['--apply'], ['--dry-run'], ['--rollback'], ['--yes'], ['--check-all'], ['--channel', 'stable'], ['--version', '1.2.3'], ['--accept-protocol']])
      assert.throws(() => parse(['--release-claim', TOKEN, ...other]), /--release-claim/, `accepted ${other[0]}`);
  });

  await test('a wrong token is refused and the claim is kept byte for byte', async () => {
    stale(); const before = fs.readFileSync(claim);
    await assert.rejects(release('00000000-0000-4000-8000-000000000000'), /token/i);
    await assert.rejects(release(TOKEN.toUpperCase()), /token/i, 'the token must match exactly');
    assert.deepEqual(fs.readFileSync(claim), before); untouched();
  });

  await test('a running PID is refused even with the right token', async () => {
    fs.writeFileSync(claim, JSON.stringify({ pid: process.pid, token: TOKEN, started: '2026-09-29T10:00:00.000Z' }));
    const before = fs.readFileSync(claim);
    await assert.rejects(release(TOKEN), /still running/i);
    assert.deepEqual(fs.readFileSync(claim), before); untouched();
  });

  await test('EPERM means the process exists, so the claim is kept', async () => {
    stale(); const before = fs.readFileSync(claim);
    const kill = () => { throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); };
    await assert.rejects(release(TOKEN, { kill }), /still running/i);
    assert.deepEqual(fs.readFileSync(claim), before); untouched();
  });

  await test('an unreadable or incomplete claim is never released', async () => {
    for (const body of ['', '{"pid":', JSON.stringify({ token: TOKEN }), JSON.stringify({ pid: -4, token: TOKEN }), JSON.stringify({ pid: 12.5, token: TOKEN })]) {
      fs.writeFileSync(claim, body);
      await assert.rejects(release(TOKEN), /cannot be confirmed/i, `released ${JSON.stringify(body)}`);
      assert.equal(fs.readFileSync(claim, 'utf8'), body);
    }
    untouched();
  });

  await test('no claim: nothing to release, nothing changes', async () => {
    fs.rmSync(claim, { force: true });
    await assert.rejects(release(TOKEN), /No update claim/i);
    assert.equal(fs.existsSync(claim), false); untouched();
  });

  await test('a dead PID and the exact token remove only the claim and say what was removed', async () => {
    stale(); const pid = JSON.parse(fs.readFileSync(claim, 'utf8')).pid;
    const listing = fs.readdirSync(dir).sort();
    const { out } = await release(TOKEN);
    assert.equal(fs.existsSync(claim), false, 'claim still present');
    assert.deepEqual(fs.readdirSync(dir).sort(), listing.filter(n => n !== 'update.active'), 'only update.active may disappear');
    untouched();
    assert(out.includes(claim), out); assert(out.includes(String(pid)), out); assert(out.includes(TOKEN), out);
    assert.match(out, /--rollback --yes/, 'the recovery command follows because a transaction is pending');
  });

  await test('the refusal prints the exact release command with the token, then the recovery command', async () => {
    stale();
    let message = '';
    await assert.rejects(update(['--repo', temp, '--rollback', '--yes'], { log() {}, reinstall() {}, inventory() {} }), e => { message = e.message; return true; });
    assert.match(message, /Existing update claim/);
    assert.match(message, /confirm no updater is running/i, 'the instruction to confirm must stay');
    const command = `node "${retained}" --release-claim ${TOKEN}`;
    assert(message.includes(command), message);
    const recovery = `node "${retained}" --rollback --yes`;
    assert(message.indexOf(recovery) > message.indexOf(command), 'recovery command must follow the release command');
    untouched(); assert(fs.existsSync(claim), 'refusal must never remove the claim');
  });

  await test('the printed command, run as printed through the retained updater, releases the claim', () => {
    // The retained copy in the Git state folder is what a user has after a crash.
    const r = spawnSync(process.execPath, [retained, '--release-claim', TOKEN], { encoding: 'utf8', windowsHide: true, timeout: 30_000, cwd: os.tmpdir() });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(fs.existsSync(claim), false); untouched();
    assert.match(r.stdout, /Released update claim/i);
  });

  await test('a claim whose token is not a plain identifier is never pasted into a command', async () => {
    fs.writeFileSync(claim, JSON.stringify({ pid: deadPid(), token: 'x" & calc & "', started: 'now' }));
    let message = '';
    await assert.rejects(update(['--repo', temp, '--rollback', '--yes'], { log() {}, reinstall() {}, inventory() {} }), e => { message = e.message; return true; });
    assert.match(message, /Existing update claim/);
    assert(!message.includes('--release-claim'), message);
    assert(!message.includes('calc'), message);
    fs.unlinkSync(claim); untouched();
  });

  console.log(JSON.stringify({ passed: results.every(r => r.passed), release_claim: results }, null, 2));
  assert(results.every(r => r.passed), 'release-claim regression failed');
} finally {
  assert.equal(fs.realpathSync(path.dirname(temp)), fs.realpathSync(os.tmpdir()));
  assert(path.basename(temp).startsWith('momm-update-claim-'));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
