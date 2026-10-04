// Fixed diagnostic categories only; raw errors, paths and text never cross the port.
const CODES = new Set(['state-path-linked','state-path-too-long','state-permission-timeout',
  'state-permission-refused','invalid-options','lock-unavailable','playback-failed']);
function classify(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message === 'State directories must not contain links') return 'state-path-linked';
  if (message.startsWith('State directory path is too long for the local stop socket')) return 'state-path-too-long';
  if (message.startsWith('Private state directory unavailable: Windows permission check timed out')) return 'state-permission-timeout';
  if (message.startsWith('Private state directory unavailable:') || message === 'State directory must be owner-only (0700)')
    return 'state-permission-refused';
  if (/^(Unknown narration |Unknown speech provider|waitMs must |Code and command inclusion settings |Input exceeds )/.test(message))
    return 'invalid-options';
  if (/^(Another playback owns the lock|Malformed playback lock)/.test(message)) return 'lock-unavailable';
  return 'playback-failed';
}
module.exports = { isKnown: value => CODES.has(value), classify };
