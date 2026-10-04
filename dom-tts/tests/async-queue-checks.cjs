// Deterministic experimental queue checks: no audio or host/model invocation.
const assert = require('node:assert/strict');
const { NarrationQueue } = require('../scripts/experimental/narration-queue');
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (segmentId, text, extra = {}) => ({ schema: 'dom-tts-segment/1',
  sessionId: 'selected', turnId: 'turn', generationId: 'gen', messageId: 'message',
  segmentId, sequence: Number(segmentId.slice(1)), role: 'assistant', phase: 'final_answer', text, ...extra });
module.exports = async function(check = fn => fn()) {
  let release; const heard = [];
  const queue = new NarrationQueue({ selectedSessions: ['selected', 'second'],
    play: async text => { heard.push(text); if (text === 'First.') await new Promise(r => { release = r; }); } });
  check(() => assert.equal(queue.accept(event('s0', 'First.')).state, 'queued'));
  await tick();
  check(() => assert.equal(typeof release, 'function'));
  // Admission is synchronous while the first player is deliberately unresolved.
  check(() => assert.equal(queue.accept(event('s1', 'Second.')).state, 'queued'));
  check(() => assert.equal(queue.accept(event('s0', 'First.')).state, 'duplicate'));
  check(() => assert.throws(() => queue.accept(event('s0', 'Changed.')), /conflicting replay/));
  check(() => assert.throws(() => queue.accept(event('s3', 'Gap.')), /sequence gap/));
  check(() => assert.throws(() => queue.accept(event('s0', 'Other.', { sessionId: 'unselected' })), /session not selected/));
  check(() => assert.throws(() => queue.accept(event('s2', 'Private.', { role: 'user' })), /assistant final/));
  check(() => assert(!JSON.stringify(queue.status()).includes('First.')));
  release(); await queue.idle();
  check(() => assert.deepEqual(heard, ['First.', 'Second.']));
  check(() => assert.equal(queue.status().completed, 2));

  let attempts = 0;
  const retry = new NarrationQueue({ selectedSessions: ['selected'], play: async () => { if (++attempts === 1) throw new Error('private raw provider error'); } });
  retry.accept(event('s0', 'Retry.')); await retry.idle();
  check(() => assert.equal(retry.status().failed, 1));
  check(() => assert(!JSON.stringify(retry.status()).includes('private raw')));
  check(() => assert.equal(retry.retry(event('s0', 'Retry.')).state, 'queued'));
  await retry.idle();
  check(() => assert.equal(attempts, 2));
  check(() => assert.equal(retry.status().completed, 1));

  let finish, signal;
  const cancelled = new NarrationQueue({ selectedSessions: ['selected'],
    play: async (_text, context) => { signal = context.signal; await new Promise(r => { finish = r; }); } });
  cancelled.accept(event('s0', 'Active.')); cancelled.accept(event('s1', 'Pending.'));
  await tick(); cancelled.cancel({ sessionId: 'selected', turnId: 'turn', generationId: 'gen' });
  check(() => assert.equal(signal.aborted, true));
  check(() => assert.throws(() => cancelled.accept(event('s2', 'Late.')), /generation cancelled/));
  finish(); await cancelled.idle();
  check(() => assert.equal(cancelled.status().cancelled, 2));
  check(() => assert.equal(cancelled.status().completed, 0));

  const bounded = new NarrationQueue({ selectedSessions: ['selected'], maxTracked: 1, maxBytes: 4, play: async () => {} });
  check(() => assert.throws(() => bounded.accept(event('s0', '12345')), /byte limit/));
  bounded.accept(event('s0', '1234')); await bounded.idle();
  check(() => assert.throws(() => bounded.accept(event('s1', 'Next')), /history limit/));
  check(() => assert.equal(bounded.status().bytes, 0));
  // A failed first segment blocks its own message, but not other selected sessions.
  const order = [];
  const fair = new NarrationQueue({ selectedSessions: ['selected', 'second'], play: async text => { order.push(text); if (text === 'Fail.') throw new Error('failure'); } });
  fair.accept(event('s0', 'Fail.')); fair.accept(event('s1', 'Blocked.'));
  fair.accept(event('s0', 'Other session.', { sessionId: 'second' })); await fair.idle();
  check(() => assert.deepEqual(order, ['Fail.', 'Other session.']));
  // Round robin across three sessions and no later-message leapfrogging a failure.
  const rounds = [];
  const round = new NarrationQueue({ selectedSessions: ['selected', 'second', 'third'], play: async text => { rounds.push(text); } });
  for (const [sessionId, text] of [['selected','A'], ['second','B'], ['third','C']]) {
    round.accept(event('s0', text + '0', { sessionId }));
    round.accept(event('s1', text + '1', { sessionId }));
  }
  await round.idle();
  check(() => assert.deepEqual(rounds, ['A0','B0','C0','A1','B1','C1']));
  const messages = [];
  const blocked = new NarrationQueue({ selectedSessions: ['selected','second'], play: async text => { messages.push(text); if (text === 'Failure.') throw new Error('failed'); } });
  blocked.accept(event('s0','Failure.'));
  blocked.accept(event('s0','Later message.', { messageId: 'later' }));
  blocked.accept(event('s0','Unrelated.', { sessionId: 'second' }));
  await blocked.idle();
  check(() => assert.deepEqual(messages, ['Failure.','Unrelated.']));
  check(() => assert.throws(() => queue.accept(event('s2','.', { generationId: '../bad' })), /invalid event identity/));
  check(() => assert.throws(() => queue.accept(event('s2','.', { sequence: -1 })), /invalid stable segment/));
};
if (require.main === module) { let count = 0; module.exports(fn => { fn(); count++; })
  .then(() => console.log('PASS: ' + count + ' experimental queue assertions; injected playback, no native audio'))
  .catch(error => { console.error(error.message); process.exitCode = 1; }); }
