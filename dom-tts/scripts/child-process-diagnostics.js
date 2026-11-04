'use strict';
// Metadata only. Never copy raw error messages, command arguments or environment.
const errorCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ENOBUFS', 'EINVAL', 'EMFILE', 'ENFILE', 'ENOMEM', 'EAGAIN', 'UNKNOWN']);
const signals = new Set(['SIGABRT', 'SIGALRM', 'SIGBREAK', 'SIGBUS', 'SIGFPE', 'SIGHUP', 'SIGILL', 'SIGINT', 'SIGKILL', 'SIGPIPE', 'SIGSEGV', 'SIGTERM', 'SIGTRAP', 'SIGUSR1', 'SIGUSR2']);
function outputBytes(value) { return typeof value === 'string' ? Buffer.byteLength(value) : Buffer.isBuffer(value) ? value.length : 0; }
function describeChildFailure(result) {
  result = result && typeof result === 'object' ? result : {};
  const stdoutBytes = outputBytes(result.stdout), stderrBytes = outputBytes(result.stderr);
  const exitStatus = Number.isSafeInteger(result.status) && result.status >= -2147483648 && result.status <= 4294967295 ? result.status : null;
  const errorCode = result.error ? errorCodes.has(result.error.code) ? result.error.code : 'UNKNOWN' : null;
  const signal = result.signal ? signals.has(result.signal) ? result.signal : 'UNKNOWN' : null;
  if (!result.error && !signal && exitStatus === 0 && stdoutBytes > 0) return null;
  const code = errorCode === 'ETIMEDOUT' ? 'default-speech-command-timeout'
    : errorCode === 'ENOBUFS' ? 'default-speech-output-limit'
      : result.error ? 'default-speech-command-unavailable'
        : signal ? 'default-speech-command-terminated'
          : stdoutBytes === 0 && stderrBytes === 0 ? 'default-speech-command-empty-result'
            : 'default-speech-command-exited';
  return {schema: 'dom-tts-launch-diagnostic/1', state: 'failed', code, errorCode, signal, exitStatus, stdoutBytes, stderrBytes, admission: 'unknown', completed: false, retry: false};
}
module.exports = {describeChildFailure};
