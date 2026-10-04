// Experimental stable-segment queue. No host discovery, native engine or persistence.
// A supplied player must honour AbortSignal and own/contain its child processes.
const { createHash } = require('node:crypto');
const key = parts => JSON.stringify(parts);
const fingerprint = event => createHash('sha256').update(JSON.stringify(event)).digest('hex');
class NarrationQueue {
  constructor({ selectedSessions, play, maxTracked = 128, maxBytes = 65536 } = {}) {
    if (!Array.isArray(selectedSessions) || selectedSessions.length < 1 || selectedSessions.length > 32 ||
        selectedSessions.some(id => typeof id !== 'string' || !/^[\w.-]{1,128}$/.test(id)) || typeof play !== 'function')
      throw new Error('explicit selected sessions and player required');
    if (!Number.isSafeInteger(maxTracked) || maxTracked < 1 || maxTracked > 4096 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) throw new Error('invalid queue bounds');
    this.sessions = new Set(selectedSessions); this.play = play;
    this.maxTracked = maxTracked; this.maxBytes = maxBytes;
    this.jobs = new Map(); this.groups = new Map(); this.cancelled = new Set();
    this.messageCursor = new Map(); this.sealedMessages = new Set();
    this.bytes = 0; this.active = null; this.scheduled = false; this.waiters = []; this.lastGroup = null;
  }
  validate(event) {
    if (!event || event.schema !== 'dom-tts-segment/1' || event.role !== 'assistant' || event.phase !== 'final_answer')
      throw new Error('only assistant final stable segments accepted');
    for (const field of ['sessionId', 'turnId', 'generationId', 'messageId', 'segmentId'])
      if (typeof event[field] !== 'string' || !/^[\w.-]{1,128}$/.test(event[field])) throw new Error('invalid event identity');
    if (!this.sessions.has(event.sessionId)) throw new Error('session not selected');
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 || typeof event.text !== 'string' || !event.text.trim())
      throw new Error('invalid stable segment');
    // Normalize only declared fields: prototypes and unrelated adapter metadata are not retained.
    if (Buffer.byteLength(event.text, 'utf8') > this.maxBytes) throw new Error('queue byte limit reached');
    return Object.fromEntries(['schema','sessionId','turnId','generationId','messageId','segmentId','sequence','role','phase','text']
      .map(field => [field, event[field]]));
  }
  identities(e) {
    const generation = key([e.sessionId, e.turnId, e.generationId]);
    const group = key([e.sessionId, e.turnId, e.generationId, e.messageId]);
    return { generation, group, job: key([group, e.segmentId]) };
  }
  accept(input) {
    const event = this.validate(input), ids = this.identities(event), hash = fingerprint(event);
    if (this.cancelled.has(ids.generation)) throw new Error('generation cancelled');
    const old = this.jobs.get(ids.job);
    if (old) { if (old.hash !== hash) throw new Error('conflicting replay'); return { state: 'duplicate', playbackState: old.state }; }
    if (this.sealedMessages.has(ids.group)) throw new Error('message sealed; late text requires adapter reconciliation');
    if (this.jobs.size >= this.maxTracked) throw new Error('history limit reached; create a new explicitly selected queue');
    const bytes = Buffer.byteLength(event.text, 'utf8');
    if (bytes > this.maxBytes || this.bytes + bytes > this.maxBytes) throw new Error('queue byte limit reached');
    const group = this.groups.get(ids.group) || [];
    if (event.sequence !== group.length) throw new Error('sequence gap or conflicting sequence');
    // Admission of a new message closes append admission to its predecessor in this
    // generation. Existing queued segments/retries still run; exact replay stays idempotent.
    const previous = this.messageCursor.get(ids.generation);
    if (previous && previous !== ids.group) this.sealedMessages.add(previous);
    this.messageCursor.set(ids.generation, ids.group);
    const job = { ...ids, hash, event, bytes, state: 'queued', controller: null };
    group.push(job); this.groups.set(ids.group, group); this.jobs.set(ids.job, job); this.bytes += bytes;
    this.schedule(); return { state: 'queued' };
  }
  retry(input) {
    const event = this.validate(input), ids = this.identities(event), job = this.jobs.get(ids.job);
    if (this.cancelled.has(ids.generation)) throw new Error('generation cancelled');
    if (!job || job.hash !== fingerprint(event)) throw new Error('retry must match retained segment');
    if (job.state !== 'failed') throw new Error('only failed segments can retry');
    job.state = 'queued'; this.schedule(); return { state: 'queued' };
  }
  cancel({ sessionId, turnId, generationId }) {
    for (const value of [sessionId, turnId, generationId])
      if (typeof value !== 'string' || !/^[\w.-]{1,128}$/.test(value)) throw new Error('invalid cancel identity');
    if (!this.sessions.has(sessionId)) throw new Error('session not selected');
    const generation = key([sessionId, turnId, generationId]);
    if (!this.cancelled.has(generation) && this.cancelled.size >= this.maxTracked) throw new Error('cancel history limit');
    this.cancelled.add(generation);
    for (const job of this.jobs.values()) if (job.generation === generation) {
      if (job.state === 'playing') { job.state = 'cancelling'; job.controller.abort(); }
      else if (job.state === 'queued' || job.state === 'failed') { job.state = 'cancelled'; this.forgetText(job); }
    }
    this.schedule(); return { state: this.active?.generation === generation ? 'cancelling' : 'cancelled' };
  }
  forgetText(job) { if (job.event) { this.bytes -= job.bytes; job.event = null; } }
  revokeSession(sessionId) {
    if (typeof sessionId !== 'string' || !/^[\w.-]{1,128}$/.test(sessionId)) throw new Error('invalid session identity');
    // Construction requires trusted explicit selection. A source ID alone never grants it.
    this.sessions.delete(sessionId);
    for (const job of this.jobs.values()) if (JSON.parse(job.group)[0] === sessionId) {
      if (job.state === 'playing' || job.state === 'cancelling') { job.state = 'cancelling'; job.controller.abort(); }
      else if (job.state === 'queued' || job.state === 'failed') job.state = 'cancelled';
      this.forgetText(job);
    }
    this.schedule();
    return { state: 'revoked' }; // Acoustic stop still depends on the supplied player.
  }
  next() {
    const eligible = [], considered = new Set();
    for (const [id, jobs] of this.groups) {
      const first = jobs.find(job => !['completed', 'cancelled'].includes(job.state));
      if (!first) continue;
      const session = JSON.parse(id)[0];
      // An earlier pending/failed message blocks later messages only in its session.
      if (considered.has(session)) continue;
      considered.add(session);
      if (first.state === 'queued') eligible.push({ id, session, job: first });
    }
    const order = [...this.sessions], last = order.indexOf(this.lastGroup);
    for (let offset = 1; offset <= order.length; offset++) {
      const session = order[(last + offset) % order.length];
      const item = eligible.find(item => item.session === session);
      if (item) return item.job;
    }
  }
  schedule() {
    if (this.scheduled || this.active) return;
    this.scheduled = true; queueMicrotask(() => { this.scheduled = false; this.pump(); });
  }
  async pump() {
    if (this.active) return;
    const job = this.next();
    if (!job) { for (const resolve of this.waiters.splice(0)) resolve(); return; }
    this.active = job; this.lastGroup = job.event.sessionId; job.state = 'playing'; job.controller = new AbortController();
    try {
      await this.play(job.event.text, { signal: job.controller.signal,
        sessionId: job.event.sessionId, turnId: job.event.turnId, generationId: job.event.generationId,
        messageId: job.event.messageId, segmentId: job.event.segmentId });
      job.state = job.controller.signal.aborted ? 'cancelled' : 'completed';
    } catch { job.state = job.controller.signal.aborted ? 'cancelled' : 'failed'; }
    finally {
      if (job.state !== 'failed') this.forgetText(job);
      job.controller = null; this.active = null; this.schedule();
    }
  }
  idle() {
    if (!this.active && !this.scheduled && !this.next()) return Promise.resolve();
    return new Promise(resolve => this.waiters.push(resolve));
  }
  status() {
    const result = { queued: 0, playing: 0, completed: 0, failed: 0, cancelling: 0, cancelled: 0, bytes: this.bytes };
    for (const job of this.jobs.values()) result[job.state]++;
    return result;
  }
  delivery(input) {
    if (!input || typeof input!=='object') throw new Error('delivery identity required');
    for (const field of ['sessionId','turnId','generationId','messageId','segmentId'])
      if (typeof input[field]!=='string' || !/^[\w.-]{1,128}$/.test(input[field])) throw new Error('invalid delivery identity');
    const job=this.jobs.get(this.identities(input).job);
    if (!job) return {state:'unknown',terminal:false};
    return {state:job.state,terminal:['completed','failed','cancelled'].includes(job.state),messageSealed:this.sealedMessages.has(job.group),
      ...(job.state==='failed'?{error:'playback-failed'}:{})};
  }
}
module.exports = { NarrationQueue };
