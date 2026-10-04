const assert = require('node:assert/strict');
const { SourceReader } = require('../scripts/experimental/source-reader');
const { SegmentStream } = require('../scripts/experimental/segment-stream');
const { NarrationQueue } = require('../scripts/experimental/narration-queue');
const event = (i, extra = {}) => ({ schema: 'dom-tts-segment/1', sessionId: 'selected', turnId: 'turn',
  generationId: 'gen', messageId: 'message', segmentId: 's'+i, sequence: i, role: 'assistant', phase: 'final_answer', text: 'Hello 🙂 '+i, ...extra });
module.exports = async function() {
  const heard = []; const queue = new NarrationQueue({ selectedSessions: ['selected'], play: async text => heard.push(text) });
  let chunk;
  const source = new SourceReader({ revokeSession: id => queue.revokeSession(id) });
  const token = source.grant({ sessionId: 'selected', read: async () => chunk });
  const stream = new SegmentStream({ source, token, sessionId: 'selected', queue });
  const line = Buffer.from(JSON.stringify(event(0))+'\n');
  for (const byte of line) { chunk = Buffer.from([byte]); await stream.pump(); }
  await queue.idle(); assert.equal(heard.length, 1); assert.equal(stream.status().admitted, 1);
  chunk = line; await stream.pump(); await queue.idle(); assert.equal(heard.length, 1); assert.equal(stream.status().duplicates, 1);
  // Valid prefix is admitted even when a following record cannot be framed.
  chunk = Buffer.from(JSON.stringify(event(1))+'\n{bad}\n');
  const prefix = await stream.pump(); assert.equal(prefix.admitted, 2); assert.equal(prefix.framingError, 'invalid-json');
  await assert.rejects(stream.pump(), /reconciliation/); await queue.idle(); assert.equal(heard.length, 2);
  await stream.revoke(); assert.equal(stream.status().pending, 0); await assert.rejects(stream.pump(), /revoked/);
  // Foreign-session admission stays visibly pending; no further reads skip it.
  const otherQueue = new NarrationQueue({ selectedSessions: ['selected', 'foreign'], play: async () => { throw new Error('must not play'); } });
  const otherSource = new SourceReader({ revokeSession: id => otherQueue.revokeSession(id) });
  const otherToken = otherSource.grant({ sessionId: 'selected', read: async () => Buffer.from(JSON.stringify(event(0, {sessionId: 'foreign'}))+'\n') });
  const other = new SegmentStream({ source: otherSource, token: otherToken, sessionId: 'selected', queue: otherQueue });
  const refused = await other.pump(); assert.equal(refused.pending, 1); assert.equal(refused.admissionError, 'admission-refused');
  assert.equal(refused.admitted, 0); assert(refused.syntacticBytes > 0);
  await assert.rejects(other.pump(), /reconciliation/); assert.equal(other.retryPending().pending, 1);
  await other.revoke(); assert.equal(other.status().pending, 0);
  console.log('PASS: injected-source framing/admission, byte splits, replay, valid prefix plus error, foreign refusal and revoke');
};
if (require.main === module) module.exports().catch(() => { console.error('Segment stream checks failed'); process.exitCode = 1; });
