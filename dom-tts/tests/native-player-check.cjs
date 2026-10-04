const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createNativePlayer } = require('../scripts/experimental/native-player');
const { NarrationQueue } = require('../scripts/experimental/narration-queue');
const { playback } = require('../scripts/speak');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-player-'));
  let started; const ready = new Promise(resolve => { started = resolve; }); const seen = [];
  try {
    assert.throws(() => createNativePlayer({ options: { command: 'unsafe' } }), /configuration/);
    assert.throws(() => createNativePlayer({ dir: 'relative' }), /configuration/);
    const player = createNativePlayer({ dir, options: { mode: 'full' }, playbackImpl: (options, dependencies) =>
      playback(options, { ...dependencies, privacy: () => {}, play: async (chunks, settings, context) => {
        seen.push(...chunks);
        if (chunks[0] === 'First.') await new Promise(resolve => { context.setChild({ kill: resolve }); started(); });
        context.setChild(null);
      } }) });
    const queue = new NarrationQueue({ selectedSessions: ['selected','other'], play: player });
    const event = (sessionId, sequence, text) => ({ schema: 'dom-tts-segment/1', sessionId, turnId: 'turn', generationId: 'gen',
      messageId: 'message', segmentId: 's'+sequence, sequence, role: 'assistant', phase: 'final_answer', text });
    queue.accept(event('selected', 0, 'First.')); await ready;
    queue.accept(event('selected', 1, 'Pending.')); queue.accept(event('other', 0, 'Other.'));
    queue.revokeSession('selected'); await queue.idle();
    assert.deepEqual(seen, ['First.','Other.']); assert.equal(fs.existsSync(path.join(dir,'playback.lock')), false);
    assert.equal(queue.delivery(event('selected',0,'First.')).state, 'cancelled');
    assert.equal(queue.delivery(event('other',0,'Other.')).state, 'completed');
    console.log('PASS: queue native-player adapter through real playback lock/status/abort; injected engine only');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
