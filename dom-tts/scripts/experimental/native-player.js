// Queue adapter through existing private-state/lock/authenticated-stop playback.
const path = require('node:path');
const { prepare, playback } = require('../speak');
const { stateDir } = require('../runtime');
function createNativePlayer({ options = {}, dir = stateDir, playbackImpl = playback } = {}) {
  const allowed = new Set(['provider','mode','profile','voice','speed','maxChunkChars','includeCodeBlocks','includeCommandBlocks','waitMs']);
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !allowed.has(key)) ||
      !path.isAbsolute(dir) || typeof playbackImpl !== 'function') throw new Error('invalid native player configuration');
  const settings = { ...options };
  return async (text, { signal } = {}) => {
    if (typeof text !== 'string') throw new Error('segment text required');
    // Text stays in the existing bounded in-process input path, never shell interpolation.
    const prepared = prepare({ ...settings, text }, { settings: {} });
    return await playbackImpl(prepared, { dir, abortSignal: signal });
  };
}
module.exports = { createNativePlayer };
