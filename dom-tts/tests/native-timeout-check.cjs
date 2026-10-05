// Public stand-in only. Shorten the production timeout in this isolated test process.
const assert = require('node:assert/strict'), cp = require('node:child_process');
const originalFork = cp.fork, originalTimer = global.setTimeout;
let worker, exited = false;
cp.fork = (...args) => { worker = originalFork(...args); worker.once('exit', () => { exited = true; }); return worker; };
global.setTimeout = (fn, ms, ...args) => originalTimer(fn, ms === 120000 ? 1000 : ms, ...args);
const native = require('../scripts/providers/native');
(async () => {
  let handle = null, reportedBeforeExit = false;
  try {
    await native.runChild({ file: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }, '',
      { stopped: () => false, setChild: value => { handle = value; } }, () => {});
    throw new Error('Expected timeout');
  } catch (error) {
    assert.match(error.message, /exceeded 120 seconds/);
    reportedBeforeExit = !exited;
  } finally {
    if (worker && !exited) await new Promise(resolve => worker.once('exit', resolve));
    cp.fork = originalFork; global.setTimeout = originalTimer;
  }
  assert.equal(reportedBeforeExit, false, 'timeout completion reported before owned worker exited');
  assert.equal(handle, null); assert.equal(exited, true);
  console.log('PASS: timeout report waits for owned stand-in worker exit');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
