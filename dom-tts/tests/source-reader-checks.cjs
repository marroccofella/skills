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
  assert.equal(gate.revoke(token), true); assert.equal(signal.aborted, true);
  assert.deepEqual(revoked, ['selected']); assert.equal(gate.revoke(token), false);
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
  console.log('PASS: source capability identity, foreign-session refusal, concurrent read, revocation, bounds and selected-reader isolation');
};
if (require.main === module) module.exports().catch(() => { console.error('Source gate checks failed'); process.exitCode = 1; });
