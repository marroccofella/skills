import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'momm/scripts/setup-ui.mjs'), 'utf8');
const start = source.indexOf('async function serveLedger(');
const end = source.indexOf('// Ledger -> Setup Center:', start);
assert(start >= 0 && end > start);
const serve = vm.runInNewContext(source.slice(start, end) + ';serveLedger', { fs, path, process, LEDGER_FILES: ['review-log.jsonl'], securityHeaders: () => ({}), ledgerHeaders: () => ({}), safeDetail: String, escapeHtml: String, ledgerMissingPage: () => 'No ledger' });
const results = [];
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
for (const scenario of ['source-only-change', 'thrown-rebuild', 'failed-child', 'failed-watcher']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-ledger-serving-'));
  try {
    const er = path.join(dir, '.ensemble_reviews'); fs.mkdirSync(er);
    fs.writeFileSync(path.join(er, 'ledger.html'), '<p>Old validated result</p>');
    fs.writeFileSync(path.join(dir, 'source.js'), 'changed source');
    if (scenario !== 'source-only-change') {
      const log = path.join(er, 'review-log.jsonl'); fs.writeFileSync(log, '{}\n');
      const future = new Date(Date.now() + 10000); fs.utimesSync(log, future, future);
    }
    let called = 0;
    const rebuild = async () => {
      called++;
      if (scenario === 'thrown-rebuild') throw Error('fixture failure');
      if (scenario === 'failed-child') return { code: 1 };
      if (scenario === 'failed-watcher') return { last_error: 'fixture failure' };
      fs.writeFileSync(path.join(er, 'ledger.html'), '<p>Current source is stale</p>');
      return { code: 0 };
    };
    const res = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    await serve(res, { cwd: dir, rebuild });
    assert.equal(called, 1, 'Every refresh must revalidate source, not merely telemetry mtimes');
    if (scenario === 'source-only-change') { assert.equal(res.status, 200); assert.match(res.body, /Current source is stale/); }
    else { assert.equal(res.status, 503); assert.doesNotMatch(res.body, /Old validated result/); }
    results.push({ scenario, passed: true });
  } catch (error) { results.push({ scenario, passed: false, error: error.message }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-ledger-concurrency-'));
  try {
    const er = path.join(dir, '.ensemble_reviews'); fs.mkdirSync(er);
    fs.writeFileSync(path.join(er, 'ledger.html'), '<p>Current snapshot</p>');
    let calls = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    const rebuild = async () => { calls++; await gate; return { code: 0 }; };
    const response = () => ({ writeHead(status) { this.status = status; }, end(body) { this.body = body; } });
    const a = response(), b = response();
    const requests = [serve(a, { cwd: dir, rebuild }), serve(b, { cwd: dir, rebuild })];
    await Promise.resolve();
    release();
    await Promise.all(requests);
    assert.equal(calls, 1, 'Concurrent requests must share one rebuild without a watcher');
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    await serve(response(), { cwd: dir, rebuild });
    assert.equal(calls, 2, 'Settled rebuild must not become a stale permanent cache');
    results.push({ scenario: 'concurrent-rebuilds', passed: true });
  } catch (error) { results.push({ scenario: 'concurrent-rebuilds', passed: false, error: error.message }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const watcherStart = source.indexOf('function createLedgerWatcher(');
const watcherEnd = source.indexOf('function isLoopback(', watcherStart);
assert(watcherStart >= 0 && watcherEnd > watcherStart);
const makeWatcher = vm.runInNewContext(source.slice(watcherStart, watcherEnd) + ';createLedgerWatcher', { fs, path, safeDetail: String, LEDGER_FILES: new Set(['review-log.jsonl', 'dispositions.jsonl']), LEDGER_MIN_GAP_MS: 5000 });
for (const nextCode of [1, 0]) for (const order of [[0, 1], [1, 0]]) {
  const scenario = `watcher-timer-overlap-exit-${nextCode}-order-${order.join('-')}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-ledger-overlap-'));
  let watcher, release, request;
  try {
    const er = path.join(dir, '.ensemble_reviews'); fs.mkdirSync(er);
    const page = path.join(er, 'ledger.html');
    fs.writeFileSync(page, '<p>Old validated result</p>');
    let time = 100000, calls = 0;
    const timers = [];
    const gate = new Promise(resolve => { release = resolve; });
    watcher = makeWatcher({ dir: er, now: () => time,
      setTimer: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; }, clearTimer: () => {},
      watch: () => ({ on() {}, close() {} }),
      run: async () => {
        if (++calls === 1) return { code: nextCode === 0 ? 1 : 0 };
        await gate;
        if (nextCode === 0) fs.writeFileSync(page, '<p>Current snapshot</p>');
        return { code: nextCode };
      }
    });
    watcher.start(); await watcher.rebuild();
    time = 100100; watcher.notify('review-log.jsonl');
    const res = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    request = serve(res, { cwd: dir, rebuild: () => watcher.rebuild() });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timers.length, 2);
    assert(timers.every(timer => timer.delay === 4900));
    time = 105000;
    timers[order[0]].fn(); timers[order[1]].fn();
    await new Promise(resolve => setImmediate(resolve));
    const prematureStatus = res.status;
    release(); await request;
    assert.equal(prematureStatus, undefined, 'HTTP must wait for the rebuild that won the timer race');
    assert.equal(res.status, nextCode === 0 ? 200 : 503);
    assert.doesNotMatch(res.body, /Old validated result/);
    if (nextCode === 0) assert.match(res.body, /Current snapshot/);
    results.push({ scenario, passed: true });
  } catch (error) { results.push({ scenario, passed: false, error: error.message }); }
  finally { release?.(); await request; watcher?.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
}
{
  const scenario = 'late-reader-awaits-new-snapshot';
  let watcher, release, reader;
  try {
    let time = 100000, calls = 0, revision = 'old', published;
    const timers = [];
    watcher = makeWatcher({ dir: '.', now: () => time,
      setTimer: (fn, delay) => { const t = { fn, delay }; timers.push(t); return t; }, clearTimer: () => {},
      watch: () => ({ on() {}, close() {} }), run: async () => {
        const snapshot = revision;
        if (++calls === 1) await new Promise(resolve => { release = resolve; });
        published = snapshot; return { code: 0 };
      }
    });
    watcher.start(); watcher.notify('review-log.jsonl');
    const background = timers.shift().fn();
    await new Promise(resolve => setImmediate(resolve));
    revision = 'new'; watcher.notify('review-log.jsonl');
    let settled = false;
    reader = watcher.rebuild().then(() => { settled = true; });
    release(); await background;
    await new Promise(resolve => setImmediate(resolve));
    const premature = settled && published === 'old';
    time += 5000;
    for (const timer of timers.splice(0)) await timer.fn();
    await reader;
    assert.equal(premature, false);
    assert.equal(published, 'new');
    assert.equal(calls, 2, 'queued notification and late reader share one fresh rebuild');
    results.push({ scenario, passed: true });
  } catch (error) { results.push({ scenario, passed: false, error: error.message }); }
  finally { release?.(); watcher?.stop(); }
}
await new Promise(resolve => setImmediate(resolve));
process.removeListener('unhandledRejection', onUnhandled);
assert.deepEqual(unhandled, [], 'Rebuild rejection must have its handler attached before a turn elapses');
results.push({scenario:'no-unhandled-rebuild-rejection',passed:true});
console.log(JSON.stringify({ passed: results.every(r => r.passed), results }, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
