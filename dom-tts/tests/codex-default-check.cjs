'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {suppliedSpeechArgs} = require('../scripts/codex-default');
const {ensurePrivate, writeObject} = require('../scripts/runtime');
const {createSession} = require('../scripts/experimental/browser-session');
const script = path.resolve(__dirname, '../scripts/codex-default.js');

function run(dir, args, threadId) {
  return new Promise((resolve, reject) => {
    const env = {...process.env, DOM_TTS_STATE_DIR: dir};
    delete env.CODEX_THREAD_ID;
    if (threadId !== undefined) env.CODEX_THREAD_ID = threadId;
    const child = spawn(process.execPath, [script, ...args], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('exit', code => resolve({code, stdout, stderr}));
  });
}

(async () => {
  const supplied = suppliedSpeechArgs(['--text', 'Supplied text.'], 'explicit-chat-a');
  assert.deepEqual(supplied.slice(2, 4), ['--enqueue', 'true']);
  assert.match(supplied.at(-1), /^codex-[a-f0-9]{24}$/);
  assert.notEqual(supplied.at(-1), suppliedSpeechArgs(['--text', 'Supplied text.'], 'explicit-chat-b').at(-1));
  assert.deepEqual(suppliedSpeechArgs(['--command', 'stop'], 'invalid identity'), ['--command', 'stop']);
  assert.deepEqual(suppliedSpeechArgs(['--command', 'status'], 'explicit-chat-a'), ['--command', 'status']);
  assert.deepEqual(suppliedSpeechArgs(['--text', 'A', '--enqueue', 'false'], 'explicit-chat-a'), ['--text', 'A', '--enqueue', 'false']);
  assert.deepEqual(suppliedSpeechArgs(['--text', 'A'], undefined), ['--text', 'A', '--enqueue', 'true']);
  assert.deepEqual(suppliedSpeechArgs(['--text', 'A', '--session-id', 'chosen'], 'explicit-chat-a'), ['--text', 'A', '--session-id', 'chosen', '--enqueue', 'true']);
  assert.throws(() => suppliedSpeechArgs(['--text', 'A'], 'invalid identity'), /invalid-supplied-chat-identity/);

  const root = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(root, 'dom-codex-default-'));
  const privateDir = path.join(dir, 'private');
  ensurePrivate(privateDir);
  const client = 'a'.repeat(32);
  const session = createSession({dir: privateDir, persist: true, leaseMs: 600000, deadlineMs: 300000});
  await new Promise(resolve => session.server.listen(0, '127.0.0.1', resolve));
  writeObject(path.join(privateDir, 'browser-session.json'), {schema: 'dom-tts-browser/1', pid: process.pid, port: session.server.address().port, token: session.token});
  try {
    session.enable({client, voice: 'injected local test voice', rate: 1.8});
    const status = await run(privateDir, ['--command', 'status'], 'explicit-chat-a');
    assert.equal(status.code, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).connected, true);
    assert.deepEqual(session.queue.status().selectedSessions, ['manual']);
    for (const identity of ['explicit-chat-a', 'explicit-chat-b']) {
      const first = await run(privateDir, ['--text', 'Public supplied paragraph.', '--wait', 'false'], identity);
      assert.equal(first.code, 0, first.stderr);
      const job = JSON.parse(first.stdout);
      assert.equal(job.state, 'queued');
      assert(['queued', 'speaking'].includes(session.queue.command('receipt', {id: job.id}).state));
      assert(!first.stdout.includes('Public supplied paragraph'));
      const poll = session.poll({client});
      assert.equal(poll.action, 'speak');
      session.accept({client, id: poll.id, state: 'completed', startObserved: true, elapsedMs: 10, localService: true});
      await session.queue.settled();
      assert.equal(session.queue.command('receipt', {id: job.id}).state, 'completed');
    }
    const selected = session.queue.status().selectedSessions;
    assert.equal(selected.length, 3);
    assert(selected.includes(supplied.at(-1)));
    const stopped = await run(privateDir, ['--command', 'stop'], 'explicit-chat-c');
    assert.equal(stopped.code, 0, stopped.stderr);
    assert(['idle', 'stop-requested'].includes(JSON.parse(stopped.stdout).state));
    assert.equal(session.queue.status().stopped, true);
    assert.deepEqual(session.queue.status().selectedSessions, []);
    const refused = await run(privateDir, ['--text', 'Must remain silent.'], 'explicit-chat-c');
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /restart-required/);
    const invalid = await run(privateDir, ['--text', 'Invalid identity.'], 'invalid identity');
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /invalid-supplied-chat-identity/);
  } finally {
    session.close();
    await new Promise(resolve => session.server.close(resolve));
    const target = fs.realpathSync(dir);
    if (path.dirname(target) !== root || !path.basename(target).startsWith('dom-codex-default-') || fs.lstatSync(dir).isSymbolicLink()) throw Error('Refused unexpected cleanup path');
    fs.rmSync(target, {recursive: true, force: true});
  }
  console.log('PASS: portable default actual CLI, shared private state, supplied chat isolation, nonwaiting admission, status without registration, authoritative Stop and invalid identity refusal. Real local HTTP and OS private-state checks; injected browser receipts, no Desktop attachment or hearing claim.');
})().catch(error => { console.error(error); process.exitCode = 1; });
