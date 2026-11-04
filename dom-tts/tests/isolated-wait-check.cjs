const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const threads = require('node:worker_threads');
const { playback } = require('../scripts/speak');
async function check(dir) {
  const modulePath = require.resolve('../scripts/experimental/isolated-native-player');
  const originalEntry = require.cache[modulePath], OriginalWorker = threads.Worker;
  let observed, rejectReady;
  const ready = new Promise((resolve, reject) => { observed = resolve; rejectReady = reject; });
  class ObservedWorker extends OriginalWorker {
    constructor(file, options) {
      assert.equal(file, path.resolve(__dirname, '../scripts/experimental/isolated-playback-worker.js'));
      super(path.join(__dirname, 'fixtures/isolated-wait-worker.cjs'), options);
      super.on('message', message => { if (message?.fixture === 'lock-wait-entered') observed(); });
      super.once('exit', () => rejectReady(new Error('worker exited before observed lock wait')));
    }
    on(name, listener) {
      return super.on(name, name === 'message' ? message => {
        if (message?.fixture !== 'lock-wait-entered') listener(message);
      } : listener);
    }
  }
  let factory;
  try {
    threads.Worker = ObservedWorker; delete require.cache[modulePath];
    factory = require(modulePath).createIsolatedNativePlayer;
  } finally {
    threads.Worker = OriginalWorker;
    if (originalEntry) require.cache[modulePath] = originalEntry; else delete require.cache[modulePath];
  }
  const lock = path.join(dir, 'playback.lock'), status = path.join(dir, 'status.json');
  let started, releaseOwner, ownerKills = 0, ownerSettled = false;
  const ownerReady = new Promise(resolve => { started = resolve; });
  // The surrounding check already validated this disposable directory. The owner
  // uses actual playback IPC/lock/status with an injected non-audible engine.
  const owning = playback({ mode: 'full', profile: 'conversational', provider: 'auto',
    chunks: ['Public owner fixture.'], waitMs: 0 }, { dir, privacy: () => {},
    play: async (chunks, options, context) => {
      context.setChild({ kill: () => { ownerKills++; } }); context.progress(0); started();
      await new Promise(resolve => { releaseOwner = resolve; }); context.setChild(null);
    } }).then(result => { ownerSettled = true; return result; });
  await Promise.race([ownerReady, owning.then(() => { throw new Error('owner ended before readiness'); })]);
  const owner = fs.readFileSync(lock, 'utf8'), previousStatus = fs.readFileSync(status, 'utf8');
  const controller = new AbortController();
  const waiting = factory({ dir, options: { mode: 'full', waitMs: 10000 } })
    ('Public synchronized waiting fixture.', { signal: controller.signal });
  // Rejection may occur before the readiness assertion; attach a handler promptly.
  waiting.catch(() => {});
  const timer = setTimeout(() => rejectReady(new Error('lock wait not observed')), 65000);
  try {
    await ready; controller.abort();
    assert.deepEqual(await waiting, { state: 'stopped' });
    assert.equal(fs.readFileSync(lock, 'utf8'), owner);
    assert.equal(fs.readFileSync(status, 'utf8'), previousStatus);
    assert.equal(ownerKills, 0); assert.equal(ownerSettled, false);
  } finally {
    clearTimeout(timer); controller.abort(); await waiting.catch(() => {});
    releaseOwner(); assert.deepEqual(await owning, { state: 'completed' });
    assert.equal(fs.existsSync(lock), false);
  }
}
module.exports = { check };
