// Opt-in isolation of preparation, ACL checks and speech from the host event loop.
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { stateDir, safeEnv } = require('../runtime');
const { createNativePlayer } = require('./native-player');
const { isKnown } = require('./isolated-errors');
function createIsolatedNativePlayer({ options = {}, dir = stateDir } = {}) {
  // Reuse configuration validation without preparing text or inspecting state here.
  createNativePlayer({ options, dir });
  if (Object.values(options).some(value => !['string','number','boolean','undefined'].includes(typeof value)) ||
      Buffer.byteLength(JSON.stringify(options), 'utf8') > 8192) throw new Error('invalid bounded player configuration');
  const settings = { ...options };
  return (text, { signal } = {}) => {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1048576)
      return Promise.reject(new Error('invalid bounded segment text'));
    if (signal?.aborted) return Promise.reject(new Error('Playback cancelled before start'));
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(path.join(__dirname, 'isolated-playback-worker.js'), {
          workerData: { text, options: settings, dir }, env: safeEnv(), execArgv: []
        });
      } catch { reject(new Error('Isolated native playback could not start')); return; }
      let outcome, failed = false, failureCode = 'playback-failed';
      const stop = () => { try { worker.postMessage({ action: 'stop' }); } catch {} };
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      worker.on('message', message => {
        if (message?.state === 'completed' || message?.state === 'stopped') outcome = { state: message.state };
        else {
          failed = true;
          if (message?.state === 'failed' && isKnown(message.code)) failureCode = message.code;
        }
      });
      worker.on('error', () => { failed = true; });
      // A message alone is not completion: retain ownership until the thread exits.
      // Never terminate the thread while its existing playback owns native children.
      worker.once('exit', code => {
        signal?.removeEventListener('abort', stop);
        process.off('SIGINT', stop); process.off('SIGTERM', stop);
        if (code === 0 && !failed && outcome) resolve(outcome);
        else reject(Object.assign(new Error('Isolated native playback failed'), { code: failureCode }));
      });
    });
  };
}
module.exports = { createIsolatedNativePlayer };
