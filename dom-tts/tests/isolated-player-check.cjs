const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createIsolatedNativePlayer } = require('../scripts/experimental/isolated-native-player');
let phase='configuration';
(async () => {
  // macOS temporary paths can contain /var -> /private/var. Keep the existing
  // no-link state policy: canonicalize our owned fixture, never weaken playback.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dti-'));
  const root = fs.realpathSync(temporary);
  const dir = path.join(root, 's');
  try {
    assert.throws(() => createIsolatedNativePlayer({ options: { command: 'unsafe' } }), /configuration/);
    assert.throws(() => createIsolatedNativePlayer({ options: { voice: () => {} } }), /configuration/);
    assert.throws(() => createIsolatedNativePlayer({ options: { voice: 'x'.repeat(8193) } }), /configuration/);
    const player = createIsolatedNativePlayer({ dir, options: { mode: 'full' } });
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(player('Public text.', { signal: aborted.signal }), /cancelled/);
    assert.equal(fs.existsSync(dir), false);
    phase='linked-state';
    const target = path.join(root, 'target'), alias = path.join(root, 'alias');
    fs.mkdirSync(target); fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const linkedState = path.join(alias, 's');
    await assert.rejects(createIsolatedNativePlayer({ dir: linkedState })(''),
      error => error.message === 'Isolated native playback failed' && error.code === 'state-path-linked');
    assert.equal(fs.existsSync(linkedState), false, 'linked state must still fail before creation');
    await assert.rejects(player('x'.repeat(1048577)), /bounded/);
    phase='invalid-options';
    await assert.rejects(createIsolatedNativePlayer({ dir, options: { mode: 'invalid-private-fixture' } })(''),
      error => error.message === 'Isolated native playback failed' && error.code === 'invalid-options');
    assert.equal(fs.existsSync(dir), false);
    const listeners = ['SIGINT','SIGTERM'].map(name => process.listenerCount(name));
    // Empty text exercises actual private-state/lock/cleanup, without an audio engine.
    phase='empty-playback';
    let settled = false;
    const completion = player('').then(result => { settled = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'worker permission checks must not synchronously block the host');
    assert.deepEqual(await completion, { state: 'completed' });
    assert.equal(fs.existsSync(path.join(dir, 'playback.lock')), false);
    phase='timed-wait';
    const lock = path.join(dir, 'playback.lock');
    const owner = JSON.stringify({ pid: process.pid, token: 'a'.repeat(32) });
    fs.writeFileSync(lock, owner, { mode: 0o600, flag: 'wx' });
    const waitingAbort = new AbortController();
    const waiting = createIsolatedNativePlayer({ dir, options: { mode: 'full', waitMs: 10000 } })
      ('Public waiting fixture.', { signal: waitingAbort.signal });
    const timer = setTimeout(() => waitingAbort.abort(), 50);
    try {
      assert.deepEqual(await waiting, { state: 'stopped' });
      assert.equal(fs.readFileSync(lock, 'utf8'), owner, 'abort must preserve the other live owner record');
    } finally { clearTimeout(timer); fs.unlinkSync(lock); }
    phase='synchronized-wait';
    await require('./isolated-wait-check.cjs').check(dir);
    assert.deepEqual(['SIGINT','SIGTERM'].map(name => process.listenerCount(name)), listeners);
    console.log('PASS: isolated real permission/lock cleanup, asynchronous host, pre-abort/bounds, linked-state refusal, timed and synchronized lock-wait owner-preserving abort; no audio');
    console.log('Temporary fixture canonicalized: ' + (temporary !== root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(JSON.stringify(require('./isolated-check-diagnostic.cjs').diagnostic(phase,error))); process.exitCode = 1; });
