const assert = require('node:assert/strict');
const { SourceReader } = require('../scripts/experimental/source-reader');
module.exports = async function() {
  const revoked = []; let calls = 0, signal, release;
  const gate = new SourceReader({ revokeSession: id => revoked.push(id), maxBytes: 8 });
  const token = gate.grant({ sessionId: 'selected', read: async options => {
    calls++; signal = options.signal; return new Promise(resolve => { release = resolve; });
  } });
  await assert.rejects(gate.read({}, 'selected'), /not authorized/);
  await assert.rejects(gate.read(token, 'foreign'), /not authorized/);
  assert.equal(calls, 0);
  assert.throws(() => gate.grant({ sessionId: 'selected', read() {} }), /duplicate/);
  const pending = gate.read(token, 'selected');
  await assert.rejects(gate.read(token, 'selected'), /already active/);
  assert.deepEqual(await gate.revoke(token), { revoked: true, downstream: 'acknowledged' }); assert.equal(signal.aborted, true);
  assert.deepEqual(revoked, ['selected']); assert.deepEqual(await gate.revoke(token), { revoked: false, downstream: 'not-requested' });
  release(Buffer.from('text')); await assert.rejects(pending, /revoked/);
  await assert.rejects(gate.read(token, 'selected'), /not authorized/);
  const other = gate.grant({ sessionId: 'other', read: async () => Buffer.from('hello') });
  assert.equal((await gate.read(other, 'other')).toString(), 'hello');
  const oversized = gate.grant({ sessionId: 'large', read: async () => Buffer.alloc(9) });
  await assert.rejects(gate.read(oversized, 'large'), /oversized/);
  const invalid = gate.grant({ sessionId: 'invalid', read: async () => 'text' });
  await assert.rejects(gate.read(invalid, 'invalid'), /invalid/);
  const failing = gate.grant({ sessionId: 'failed', read: async () => { throw new Error('private-source-path'); } });
  await assert.rejects(gate.read(failing, 'failed'), /^Error: source read failed$/);
  // Exercise the actual queue revocation hook, not only a callback spy.
  const { NarrationQueue } = require('../scripts/experimental/narration-queue');
  let finishPlayer, playerSignal; const played = [];
  const queue = new NarrationQueue({ selectedSessions: ['wired', 'independent'], play: async (text, options) => {
    played.push(text);
    if (text === 'active') { playerSignal = options.signal; await new Promise(resolve => { finishPlayer = resolve; }); }
  } });
  const wiredGate = new SourceReader({ revokeSession: id => queue.revokeSession(id) });
  const wired = wiredGate.grant({ sessionId: 'wired', read: async () => Buffer.from('source') });
  const segment = (sessionId, sequence, text) => ({ schema: 'dom-tts-segment/1', role: 'assistant', phase: 'final_answer',
    sessionId, turnId: 'turn', generationId: 'generation', messageId: 'message', segmentId: 's'+sequence, sequence, text });
  await wiredGate.read(wired, 'wired');
  queue.accept(segment('wired', 0, 'active'));
  await new Promise(resolve => setImmediate(resolve));
  queue.accept(segment('wired', 1, 'pending'));
  queue.accept(segment('independent', 0, 'other'));
  await wiredGate.revoke(wired);
  assert.equal(playerSignal.aborted, true);
  assert.throws(() => queue.accept(segment('wired', 2, 'late')), /not selected/);
  assert.equal(queue.delivery(segment('wired', 1, 'pending')).state, 'cancelled');
  finishPlayer(); await queue.idle();
  assert.deepEqual(played, ['active', 'other']); assert.equal(queue.status().bytes, 0);
  let acknowledge;
  const asyncGate = new SourceReader({ revokeSession: () => new Promise(resolve => { acknowledge = resolve; }) });
  const asyncToken = asyncGate.grant({ sessionId: 'async', read: async () => Buffer.from('data') });
  let acknowledged = false;
  const acknowledgement = asyncGate.revoke(asyncToken).then(result => { acknowledged = true; return result; });
  await assert.rejects(asyncGate.read(asyncToken, 'async'), /not authorized/);
  assert.equal(acknowledged, false);
  acknowledge(); assert.deepEqual(await acknowledgement, { revoked: true, downstream: 'acknowledged' });
  for (const revokeSession of [() => { throw new Error('private-path'); }, async () => { throw new Error('private-path'); }]) {
    const failedGate = new SourceReader({ revokeSession });
    const failedToken = failedGate.grant({ sessionId: 'failed-hook', read: async () => Buffer.from('data') });
    assert.deepEqual(await failedGate.revoke(failedToken), { revoked: true, downstream: 'failed' });
    await assert.rejects(failedGate.read(failedToken, 'failed-hook'), /not authorized/);
  }
  console.log('PASS: source capability identity, foreign-session refusal, concurrent read, revocation, bounds and selected-reader isolation');
};
if (require.main === module) module.exports().catch(() => { console.error('Source gate checks failed'); process.exitCode = 1; });
