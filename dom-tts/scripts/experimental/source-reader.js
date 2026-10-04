// Explicit capability gate for injected readers; no discovery or filesystem access.
// The caller must obtain human source consent before issuing a grant.
class SourceReader {
  constructor({ revokeSession, maxSources = 32, maxBytes = 65536 } = {}) {
    if (typeof revokeSession !== 'function' || !Number.isSafeInteger(maxSources) || maxSources < 1 || maxSources > 32 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) throw new Error('invalid source gate');
    this.revokeSession = revokeSession; this.maxSources = maxSources; this.maxBytes = maxBytes;
    this.grants = new Map(); this.sessions = new Set();
  }
  grant({ sessionId, read } = {}) {
    if (typeof sessionId !== 'string' || !/^[\w.-]{1,128}$/.test(sessionId) || typeof read !== 'function')
      throw new Error('explicit session and reader required');
    if (this.grants.size >= this.maxSources || this.sessions.has(sessionId)) throw new Error('source limit or duplicate session');
    const token = Object.freeze({});
    this.grants.set(token, { sessionId, read, controller: new AbortController(), busy: false });
    this.sessions.add(sessionId); return token;
  }
  async read(token, sessionId) {
    const grant = this.grants.get(token);
    if (!grant || grant.sessionId !== sessionId) throw new Error('source not authorized');
    if (grant.busy) throw new Error('source read already active');
    grant.busy = true;
    try {
      let bytes;
      try { bytes = await grant.read({ signal: grant.controller.signal, maxBytes: this.maxBytes }); }
      catch { throw new Error(grant.controller.signal.aborted ? 'source revoked' : 'source read failed'); }
      if (grant.controller.signal.aborted || this.grants.get(token) !== grant) throw new Error('source revoked');
      if (!Buffer.isBuffer(bytes) || bytes.length > this.maxBytes) throw new Error('invalid or oversized source result');
      return Buffer.from(bytes);
    } finally { grant.busy = false; }
  }
  revoke(token) {
    const grant = this.grants.get(token); if (!grant) return false;
    this.grants.delete(token); this.sessions.delete(grant.sessionId);
    grant.controller.abort(); grant.read = null;
    this.revokeSession(grant.sessionId); return true;
  }
}
module.exports = { SourceReader };
