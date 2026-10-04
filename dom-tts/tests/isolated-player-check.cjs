const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createIsolatedNativePlayer } = require('../scripts/experimental/isolated-native-player');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-isolated-'));
  const dir = path.join(root, 'private-state');
  try {
    assert.throws(() => createIsolatedNativePlayer({ options: { command: 'unsafe' } }), /configuration/);
    assert.throws(() => createIsolatedNativePlayer({ options: { voice: () => {} } }), /configuration/);
    assert.throws(() => createIsolatedNativePlayer({ options: { voice: 'x'.repeat(8193) } }), /configuration/);
    const player = createIsolatedNativePlayer({ dir, options: { mode: 'full' } });
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(player('Public text.', { signal: aborted.signal }), /cancelled/);
    assert.equal(fs.existsSync(dir), false);
    await assert.rejects(player('x'.repeat(1048577)), /bounded/);
    await assert.rejects(createIsolatedNativePlayer({ dir, options: { mode: 'invalid-private-fixture' } })(''),
      error => error.message === 'Isolated native playback failed');
    assert.equal(fs.existsSync(dir), false);
    const listeners = ['SIGINT','SIGTERM'].map(name => process.listenerCount(name));
    // Empty text exercises actual private-state/lock/cleanup, without an audio engine.
    let settled = false;
    const completion = player('').then(result => { settled = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'worker permission checks must not synchronously block the host');
    assert.deepEqual(await completion, { state: 'completed' });
    assert.equal(fs.existsSync(path.join(dir, 'playback.lock')), false);
    assert.deepEqual(['SIGINT','SIGTERM'].map(name => process.listenerCount(name)), listeners);
    console.log('PASS: isolated real permission/lock cleanup, asynchronous host, pre-abort and input bounds; no audio');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
