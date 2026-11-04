'use strict';
// Portable supplied-paragraph helper. It never discovers chats or reads transcripts.
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {ROOT, parseCli} = require('./runtime');
const {describeChildFailure} = require('./child-process-diagnostics');

function suppliedSpeechArgs(argv, threadId) {
  const args = parseCli(argv, {command: 'speak'}, ['command', 'text', 'textFile', 'stdin', 'wait', 'id', 'enqueue', 'sessionId']);
  const result = [...argv];
  if (args.command !== 'speak') return result;
  // Normal conversation admits to the queue and returns without waiting for audio.
  if (args.enqueue === undefined) result.push('--enqueue', 'true');
  if (args.enqueue === false || args.sessionId !== undefined || threadId === undefined || threadId === '') return result;
  if (typeof threadId !== 'string' || threadId.length > 256 || /[\x00-\x20\x7f]/.test(threadId)) throw Error('invalid-supplied-chat-identity');
  result.push('--session-id', 'codex-' + crypto.createHash('sha256').update(threadId).digest('hex').slice(0, 24));
  return result;
}

function launchDefault(argv, {threadId, env = process.env, run = spawnSync, executable = process.execPath, root = ROOT, timeoutMs = 150000, maxBufferBytes = 16384} = {}) {
  const args = suppliedSpeechArgs(argv, threadId);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 150000 || !Number.isSafeInteger(maxBufferBytes) || maxBufferBytes < 256 || maxBufferBytes > 65536) throw Error('invalid-launch-limits');
  let result;
  try {
    result = run(executable, [path.join(root, 'scripts', 'browser-speak.js'), ...args], {
      env: {...env}, windowsHide: true, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', timeout: timeoutMs, maxBuffer: maxBufferBytes, shell: false
    });
  } catch (error) { result = {error, status: null, stdout: null, stderr: null}; }
  const diagnostic = describeChildFailure(result);
  const bounded = value => {
    const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.isBuffer(value) ? value : Buffer.alloc(0);
    // Normalize invalid input before truncation, then retain complete UTF-8 code
    // points: decoding a cut byte sequence can expand it into a replacement char.
    const utf8 = Buffer.from(bytes.toString('utf8'));
    let end = Math.min(utf8.length, maxBufferBytes);
    while (end > 0 && (utf8[end] & 0xc0) === 0x80) end--;
    return utf8.subarray(0, end).toString('utf8');
  };
  return {stdout: bounded(result?.stdout), stderr: bounded(result?.stderr), diagnostic, exitCode: diagnostic ? Number.isSafeInteger(result?.status) && result.status > 0 && result.status <= 255 ? result.status : 1 : 0};
}

function main() {
  const result = launchDefault(process.argv.slice(2), {threadId: process.env.CODEX_THREAD_ID});
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.diagnostic) process.stderr.write(JSON.stringify(result.diagnostic) + '\n');
  process.exitCode = result.exitCode;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(/^[a-z-]+$/.test(error.message || '') ? error.message : 'invalid-default-speech-options');
    process.exitCode = 1;
  }
}
module.exports = {suppliedSpeechArgs, launchDefault};
