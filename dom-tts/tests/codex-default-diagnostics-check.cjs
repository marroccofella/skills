'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {describeChildFailure} = require('../scripts/child-process-diagnostics');
const {launchDefault} = require('../scripts/codex-default');

const canary = 'PRIVATE_TEXT_PATH_TOKEN_ENV_CANARY';
for (const code of ['ENOENT', 'EPERM', 'EACCES', 'ETIMEDOUT', 'ENOBUFS']) {
  const result = {error: {code, message: canary, path: canary, spawnargs: [canary]}, signal: null, status: null, stdout: '', stderr: ''};
  const diagnostic = describeChildFailure(result);
  assert.equal(diagnostic.errorCode, code);
  assert.equal(diagnostic.admission, 'unknown');
  assert.equal(diagnostic.completed, false);
  assert.equal(diagnostic.retry, false);
  assert(!JSON.stringify(diagnostic).includes(canary));
}
const malicious = describeChildFailure({error: {code: canary, message: canary}, signal: canary, status: canary, stdout: canary, stderr: canary});
assert.equal(malicious.errorCode, 'UNKNOWN');
assert.equal(malicious.signal, 'UNKNOWN');
assert.equal(malicious.exitStatus, null);
assert(!JSON.stringify(malicious).includes(canary));
assert.equal(malicious.stdoutBytes, Buffer.byteLength(canary));
assert.equal(describeChildFailure({status: null, signal: 'SIGTERM'}).code, 'default-speech-command-terminated');
assert.equal(describeChildFailure({status: 7, stdout: '', stderr: ''}).code, 'default-speech-command-empty-result');
assert.equal(describeChildFailure({status: 0, stdout: '', stderr: ''}).code, 'default-speech-command-empty-result');
assert.equal(describeChildFailure({status: 0, stdout: '{"state":"queued"}\n', stderr: ''}), null);
assert.equal(describeChildFailure({status: 3221225477}).exitStatus, 3221225477);

let calls = 0;
const thrown = launchDefault(['--text', canary], {threadId: 'explicit-test-chat', env: {PRIVATE_ENV: canary}, run() { calls++; throw Object.assign(Error(canary), {code: 'EPERM', path: canary}); }});
assert.equal(calls, 1);
assert.equal(thrown.exitCode, 1);
assert.equal(thrown.stdout, '');
assert.equal(thrown.stderr, '');
assert.equal(thrown.diagnostic.errorCode, 'EPERM');
assert(!JSON.stringify(thrown).includes(canary));
const signal = launchDefault(['--command', 'status'], {run: () => ({status: null, signal: 'SIGKILL', stdout: null, stderr: null})});
assert.equal(signal.diagnostic.signal, 'SIGKILL');
assert.equal(signal.exitCode, 1);
const limited = launchDefault(['--command', 'status'], {maxBufferBytes: 256, run: () => ({status: 2, stdout: 'x'.repeat(1000), stderr: 'y'.repeat(1000)})});
assert.equal(Buffer.byteLength(limited.stdout), 256);
assert.equal(Buffer.byteLength(limited.stderr), 256);
assert.equal(limited.exitCode, 2);
for (const value of ['€'.repeat(100), '😀'.repeat(100), Buffer.alloc(300, 0xff)]) {
  const multibyte = launchDefault(['--command', 'status'], {maxBufferBytes: 256, run: () => ({status: 2, stdout: value, stderr: value})});
  assert(Buffer.byteLength(multibyte.stdout) <= 256);
  assert(Buffer.byteLength(multibyte.stderr) <= 256);
  assert(!/[\uD800-\uDBFF]$/.test(multibyte.stdout));
}
const fullReceipt = JSON.stringify({state: 'queued', completed: false, voice: 'Local € 😀'});
assert.equal(launchDefault(['--command', 'status'], {maxBufferBytes: 256, run: () => ({status: 0, stdout: fullReceipt, stderr: ''})}).stdout, fullReceipt);

const temp = fs.realpathSync(os.tmpdir());
const dir = fs.mkdtempSync(path.join(temp, 'dom-child-diagnostics-'));
const scriptDir = path.join(dir, 'scripts');
fs.mkdirSync(scriptDir);
const script = path.join(scriptDir, 'browser-speak.js');
try {
  // Actual deterministic child processes: no browser, model, transcript or audio.
  const missing = launchDefault(['--command', 'status'], {executable: path.join(dir, 'missing-node'), root: dir});
  assert.equal(missing.diagnostic.errorCode, 'ENOENT');
  assert(!JSON.stringify(missing.diagnostic).includes(dir));
  fs.writeFileSync(script, 'process.exit(7);\n');
  const empty = launchDefault(['--command', 'status'], {root: dir});
  assert.equal(empty.exitCode, 7);
  assert.equal(empty.diagnostic.code, 'default-speech-command-empty-result');
  fs.writeFileSync(script, 'setInterval(() => {}, 1000);\n');
  const timeout = launchDefault(['--command', 'status'], {root: dir, timeoutMs: 200});
  assert.equal(timeout.diagnostic.errorCode, 'ETIMEDOUT');
  assert.equal(timeout.diagnostic.admission, 'unknown');
  fs.writeFileSync(script, 'process.stdout.write("x".repeat(1000000));\n');
  const overflow = launchDefault(['--command', 'status'], {root: dir, maxBufferBytes: 256});
  assert.equal(overflow.diagnostic.errorCode, 'ENOBUFS');
  assert(Buffer.byteLength(overflow.stdout) <= 256);
  fs.writeFileSync(script, 'console.log(JSON.stringify({state:"queued",completed:false,id:"a".repeat(32)}));\n');
  const success = launchDefault(['--command', 'status'], {root: dir});
  assert.equal(success.exitCode, 0);
  assert.equal(success.diagnostic, null);
  assert.equal(JSON.parse(success.stdout).completed, false);
} finally {
  const target = fs.realpathSync(dir);
  if (path.dirname(target) !== temp || !path.basename(target).startsWith('dom-child-diagnostics-') || fs.lstatSync(dir).isSymbolicLink()) throw Error('Refused unexpected cleanup path');
  fs.rmSync(target, {recursive: true, force: true});
}
console.log('PASS: safe child-launch diagnostics for ENOENT/EPERM/EACCES, timeout, signals, silent nonzero/empty success and bounded output; private canaries excluded; single launch/no retry and admission remains unknown. Actual missing executable, exit, timeout, overflow and successful receipt children; no audio or model calls.');
