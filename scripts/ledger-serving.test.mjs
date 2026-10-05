import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { evidenceDir } from '../momm/scripts/evidence-location.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'momm/scripts/setup-ui.mjs'), 'utf8');
const start = source.indexOf('async function serveLedger(');
const end = source.indexOf('// Ledger -> Setup Center:', start);
assert(start >= 0 && end > start);
// 1.17 A7: serveLedger reads the resolved evidence folder; the real evidenceFolder from setup-ui.mjs
// over the real resolver (default mode here).
const folderStart = source.indexOf('function evidenceFolder('), folderEnd = source.indexOf('\nfunction usageReport(', folderStart);
assert(folderStart >= 0 && folderEnd > folderStart);
const evidenceFolder = vm.runInNewContext(source.slice(folderStart, folderEnd) + ';evidenceFolder', { evidenceDir, process });
const serve = vm.runInNewContext(source.slice(start, end) + ';serveLedger', { fs, path, process, evidenceFolder, LEDGER_FILES: ['review-log.jsonl'], securityHeaders: () => ({}), ledgerHeaders: () => ({}), safeDetail: String, escapeHtml: String, ledgerMissingPage: () => 'No ledger' });
const results = [];
// Fail fast, never hang: a scenario waiting on a promise that never settles (for example a sliced
// context missing an identifier, so serveLedger throws before any rebuild starts while a test server
// keeps the process alive) fails within seconds. Found in 1.17 when a missing evidenceFolder held this
// suite open for 17 minutes.
const SCENARIO_LIMIT_MS = 5000, SUITE_LIMIT_MS = 60_000;
const bounded = (promise, label, ms = SCENARIO_LIMIT_MS) => {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms / 1000} s`)), ms); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
};
const watchdog = setTimeout(() => {
  console.log(JSON.stringify({ passed: false, error: `ledger-serving did not finish within ${SUITE_LIMIT_MS / 1000} s`, results }, null, 2));
  process.exit(1);
}, SUITE_LIMIT_MS);
// Preflight: the sliced serveLedger must run in its context at all, on both its no-ledger and its
// rebuild paths. A missing identifier stops the suite here with the reason, before any scenario waits.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-ledger-preflight-'));
  try {
    const response = () => ({ writeHead(status) { this.status = status; }, end(body) { this.body = body; } });
    const none = response();
    await bounded(serve(none, { cwd: dir, rebuild: async () => ({ code: 0 }) }), 'serveLedger preflight (no ledger)');
    assert.equal(none.status, 404);
    fs.mkdirSync(path.join(dir, '.ensemble_reviews'));
    const built = response();
    await bounded(serve(built, { cwd: dir, rebuild: async () => { fs.writeFileSync(path.join(dir, '.ensemble_reviews', 'ledger.html'), '<p>preflight</p>'); return { code: 0 }; } }), 'serveLedger preflight (rebuild)');
    assert.equal(built.status, 200);
    results.push({ scenario: 'context-preflight', passed: true });
  } catch (error) {
    console.log(JSON.stringify({ passed: false, error: `serveLedger cannot run in its sliced context: ${error.message}`, results }, null, 2));
    process.exit(1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
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
    await bounded(serve(res, { cwd: dir, rebuild }), scenario);
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
    await bounded(Promise.all(requests), 'concurrent-rebuilds');
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
// These controlled timers deliberately assert the shipped policy. Fail loudly
// if production changes instead of silently testing stale injected constants.
assert.match(source, /^const LEDGER_MIN_GAP_MS = 5000;/m, 'fixture constants must match production');
assert.match(source, /^const LEDGER_FILES = new Set\(\["review-log\.jsonl", "dispositions\.jsonl"\]\);/m, 'fixture constants must match production');
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
  finally { release?.(); await Promise.allSettled([request].filter(Boolean)); watcher?.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
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
for (const [oldCode, newCode] of [[0, 1], [1, 0], [0, 0]]) {
  const scenario = `http-late-reader-${oldCode}-then-${newCode}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-ledger-http-'));
  let watcher, server, release, first, second;
  try {
    const er = path.join(dir, '.ensemble_reviews'); fs.mkdirSync(er);
    const file = path.join(er, 'ledger.html');
    fs.writeFileSync(file, '<p>OLD VALIDATED SNAPSHOT</p>');
    let revision = 'old', calls = 0, arrivals = 0, entered, secondArrived;
    const started = new Promise(resolve => { entered = resolve; });
    const arrived = new Promise(resolve => { secondArrived = resolve; });
    watcher = makeWatcher({ dir: er, minGapMs: 0, debounceMs: 10000, setTimer: setTimeout, clearTimer: clearTimeout,
      watch: () => ({ on() {}, close() {} }), run: async () => {
        const snapshot = revision;
        const code = ++calls === 1 ? oldCode : newCode;
        if (calls === 1) { entered(); await new Promise(resolve => { release = resolve; }); }
        if (code === 0) fs.writeFileSync(file, `<p>${snapshot === 'old' ? 'OLD VALIDATED SNAPSHOT' : 'CURRENT SNAPSHOT'}</p>`);
        return { code };
      }
    });
    watcher.start();
    server = http.createServer((req, res) => {
      const work = serve(res, { cwd: dir, rebuild: () => watcher.rebuild() });
      if (++arrivals === 2) secondArrived();
      work.catch(error => res.destroy(error));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const get = () => new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path: '/ledger' }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body })); res.on('error', reject);
      });
      req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Synthetic HTTP test deadline')));
    });
    first = get(); first.catch(() => {}); await bounded(started, `${scenario}: first rebuild`);
    revision = 'new'; watcher.notify('dispositions.jsonl');
    second = get(); second.catch(() => {}); await bounded(arrived, `${scenario}: second request`);
    release();
    const [, result] = await Promise.all([first, second]);
    assert.equal(result.status, newCode === 0 ? 200 : 503);
    assert.doesNotMatch(result.body, /OLD VALIDATED SNAPSHOT/);
    if (newCode === 0) assert.match(result.body, /CURRENT SNAPSHOT/);
    assert.equal(calls, 2, 'Late HTTP readers require one covering rebuild, not a write storm');
    results.push({ scenario, passed: true });
  } catch (error) { results.push({ scenario, passed: false, error: error.message }); }
  finally {
    release?.(); watcher?.stop();
    await Promise.allSettled([first, second].filter(Boolean));
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
await new Promise(resolve => setImmediate(resolve));
process.removeListener('unhandledRejection', onUnhandled);
assert.deepEqual(unhandled, [], 'Rebuild rejection must have its handler attached before a turn elapses');
results.push({scenario:'no-unhandled-rebuild-rejection',passed:true});
clearTimeout(watchdog);
console.log(JSON.stringify({ passed: results.every(r => r.passed), results }, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
