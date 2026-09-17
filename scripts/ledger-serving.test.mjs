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
await new Promise(resolve => setImmediate(resolve));
process.removeListener('unhandledRejection', onUnhandled);
assert.deepEqual(unhandled, [], 'Rebuild rejection must have its handler attached before a turn elapses');
results.push({scenario:'no-unhandled-rebuild-rejection',passed:true});
console.log(JSON.stringify({ passed: results.every(r => r.passed), results }, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
