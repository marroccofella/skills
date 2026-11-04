// Experimental injected-source -> JSONL -> stable-segment admission composition.
// Refused records remain pending; framing offsets never stand in for speech receipts.
const { JsonlFramer } = require('./event-framer');
class SegmentStream {
  constructor({ source, token, sessionId, queue } = {}) {
    if (!source || typeof source.read !== 'function' || typeof source.revoke !== 'function' ||
        !queue || typeof queue.accept !== 'function' || typeof queue.revokeSession !== 'function' ||
        typeof sessionId !== 'string' || !/^[\w.-]{1,128}$/.test(sessionId)) throw new Error('explicit source and queue required');
    this.source = source; this.token = token; this.sessionId = sessionId; this.queue = queue;
    this.framer = new JsonlFramer(); this.pending = []; this.busy = false; this.revoked = false;
    this.framingError = null; this.admissionError = null; this.admitted = 0; this.duplicates = 0;
  }
  status() { return { admitted: this.admitted, duplicates: this.duplicates, pending: this.pending.length,
    syntacticBytes: this.framer.committedBytes, framingError: this.framingError,
    admissionError: this.admissionError, revoked: this.revoked }; }
  retryPending() {
    if (this.revoked) throw new Error('source revoked');
    this.admissionError = null;
    while (this.pending.length) {
      const event = this.pending[0];
      try {
        if (event.sessionId !== this.sessionId) throw new Error('foreign session');
        const receipt = this.queue.accept(event);
        if (receipt.state === 'duplicate') this.duplicates++; else this.admitted++;
        this.pending.shift();
      } catch { this.admissionError = 'admission-refused'; break; }
    }
    return this.status();
  }
  async pump() {
    if (this.revoked) throw new Error('source revoked');
    if (this.busy || this.pending.length || this.framingError) throw new Error('stream requires reconciliation');
    this.busy = true;
    try {
      const bytes = await this.source.read(this.token, this.sessionId);
      if (this.revoked) throw new Error('source revoked');
      const result = this.framer.push(bytes);
      this.pending = result.records; this.framingError = result.error;
      return this.retryPending();
    } finally { this.busy = false; }
  }
  finish() {
    if (this.revoked || this.busy || this.pending.length) throw new Error('stream requires reconciliation');
    const result = this.framer.finish(); this.framingError = result.error; return this.status();
  }
  async revoke() {
    if (this.revocation) return this.revocation;
    this.revoked = true; this.pending = []; this.framer.reset();
    let queueResult;
    try { queueResult = Promise.resolve(this.queue.revokeSession(this.sessionId)).then(() => 'acknowledged', () => 'failed'); }
    catch { queueResult = Promise.resolve('failed'); }
    // Start source invalidation even while queue acknowledgement is pending/failing.
    let sourceResult;
    try { sourceResult = Promise.resolve(this.source.revoke(this.token)).catch(() => ({ revoked: false, downstream: 'failed' })); }
    catch { sourceResult = Promise.resolve({ revoked: false, downstream: 'failed' }); }
    this.revocation = Promise.all([queueResult, sourceResult]).then(([queue, source]) => ({
      revoked: source.revoked, source: source.downstream, queue,
      downstream: queue === 'acknowledged' && source.downstream !== 'failed' ? 'acknowledged' : 'failed'
    }));
    return this.revocation;
  }
}
module.exports = { SegmentStream };
