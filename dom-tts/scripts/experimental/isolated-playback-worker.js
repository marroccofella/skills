const { parentPort, workerData, isMainThread } = require('node:worker_threads');
if (isMainThread || !parentPort) throw new Error('Owned playback thread required');
const { createNativePlayer } = require('./native-player');
const { classify } = require('./isolated-errors');
const controller = new AbortController();
parentPort.on('message', message => { if (message?.action === 'stop') controller.abort(); });
(async () => {
  try {
    const player = createNativePlayer({ options: workerData.options, dir: workerData.dir });
    const outcome = await player(workerData.text, { signal: controller.signal });
    parentPort.postMessage(outcome);
  } catch (error) {
    parentPort.postMessage(controller.signal.aborted ? { state: 'stopped' } : { state: 'failed', code: classify(error) });
  } finally { parentPort.close(); }
})();
