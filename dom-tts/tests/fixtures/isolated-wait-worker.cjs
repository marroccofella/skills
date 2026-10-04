// Test-only instrumentation. Run the actual fixed production worker unchanged.
const fs = require('node:fs'), path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const open = fs.openSync;
let conflict = false;
fs.openSync = function (file, flags, ...args) {
  try { return open.call(fs, file, flags, ...args); }
  catch (error) {
    if (file === path.join(workerData.dir, 'playback.lock') && flags === 'wx' && error.code === 'EEXIST')
      conflict = true;
    throw error;
  }
};
const schedule = global.setTimeout;
global.setTimeout = function (callback, milliseconds, ...args) {
  const timer = schedule(callback, milliseconds, ...args);
  // Signal only after the actual acquisition loop registered its wait timer.
  if (conflict && milliseconds === 100) {
    conflict = false; parentPort.postMessage({ fixture: 'lock-wait-entered' });
  }
  return timer;
};
require('../../scripts/experimental/isolated-playback-worker');
