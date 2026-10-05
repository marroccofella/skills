const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { playback } = require('../scripts/speak');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-abort-'));
  let release, kills = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  const controller = new AbortController();
  try {
    const options = { mode: 'informative', profile: 'conversational', provider: 'auto', chunks: ['public fixture'], waitMs: 0 };
    const playing = playback(options, { dir, privacy: () => {}, abortSignal: controller.signal,
      play: async (chunks, settings, context) => {
        context.setChild({ kill: () => { kills++; } }); started();
        await new Promise(resolve => { release = resolve; }); context.setChild(null);
      } });
    await ready; controller.abort(); release(); await playing;
    assert.equal(kills, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'status.json'))).state, 'stopped');
    assert.equal(fs.existsSync(path.join(dir, 'playback.lock')), false);
    let privacyCalls = 0;
    await assert.rejects(playback(options, { dir, abortSignal: controller.signal, privacy: () => { privacyCalls++; } }), /cancelled before start/);
    assert.equal(privacyCalls, 0);
    console.log('PASS: injected playback AbortSignal stop, lock cleanup and pre-aborted refusal');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
