#!/usr/bin/env node
// Owner/governor-chosen local Node tests only. Never takes executable commands from a reviewer.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digest } from './governor.mjs';
import { defaultExec } from './probes.mjs';
import { requirePrivateEvidence } from './evidence-permissions.mjs';
const demand = (ok, why) => { if (!ok) throw new Error(why); };
export async function recordCheck(root, { runId, itemId = 'run', phase = 'final', test, artifacts, args = [], timeout = 120_000 }, execute = defaultExec) {
  root = fs.realpathSync(root);
  demand(/^rev_[A-Za-z0-9_]+$/.test(runId), 'invalid run id');
  demand(['before', 'after', 'investigation', 'final'].includes(phase), 'invalid phase');
  demand(Number.isInteger(timeout) && timeout >= 1000 && timeout <= 900_000, 'timeout must be 1–900 seconds');
  const evidence = path.join(root, '.ensemble_reviews'); requirePrivateEvidence(evidence);
  const local = name => {
    demand(typeof name === 'string' && !name.includes('\\') && !name.includes(':') && !path.isAbsolute(name) && name.split('/').every(x => x && x !== '.' && x !== '..'), 'unsafe path');
    let p = root; for (const bit of name.split('/')) { p = path.join(p, bit); demand(!fs.lstatSync(p).isSymbolicLink(), 'linked path refused'); }
    const stat = fs.statSync(p); demand(stat.isFile() && stat.nlink === 1 && stat.size <= 8_000_000, 'not a bounded unlinked regular file');
    return p;
  };
  const ref = name => ({ path: name, sha256: digest(fs.readFileSync(local(name))) });
  const reportName = `.ensemble_reviews/reports/${runId}.json`, reportRef = ref(reportName);
  const report = JSON.parse(fs.readFileSync(local(reportName), 'utf8'));
  demand(report.run_id === runId && report.source_snapshot?.complete, 'report has no complete source identity');
  const source = report.source_snapshot.files;
  const names = artifacts ?? source.map(f => f.path);
  demand(names.length > 0 && names.length <= 200 && new Set(names).size === names.length && names.every(n => source.some(f => f.path === n)), 'artifacts must select reviewed source files');
  demand(/\.(?:mjs|cjs|js)$/.test(test), 'choose a local Node test file');
  const testRef = ref(test), bound = names.map(ref);
  const id = randomUUID(), folder = `.ensemble_reviews/checks/${id}`;
  const checks = path.join(evidence, 'checks');
  if (!fs.existsSync(checks)) fs.mkdirSync(checks, { mode: 0o700 });
  demand(fs.lstatSync(checks).isDirectory() && !fs.lstatSync(checks).isSymbolicLink(), 'unsafe checks directory');
  fs.mkdirSync(path.join(root, folder), { mode: 0o700 });
  if (phase === 'before') for (const [i, f] of bound.entries()) {
    demand(source.some(s => s.path === f.path && s.sha256 === f.sha256), 'baseline differs from reviewed bytes');
    const name = `${folder}/source-${i}.txt`; fs.writeFileSync(path.join(root, name), fs.readFileSync(local(f.path)), { flag: 'wx', mode: 0o600 }); f.snapshot = ref(name);
  }
  // Only this explicit CLI invocation supplies args. Reports contain data, never commands.
  const result = await execute(process.execPath, [local(test), ...args], { cwd: root, timeout, input: '' });
  requirePrivateEvidence(evidence);
  demand(ref(reportName).sha256 === reportRef.sha256 && ref(test).sha256 === testRef.sha256 && bound.every(f => ref(f.path).sha256 === f.sha256), 'source, report or test changed during the check; no success receipt');
  const outputName = `${folder}/output.txt`;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  demand(Buffer.byteLength(output) <= 8_000_000, 'test output exceeds receipt limit');
  fs.writeFileSync(path.join(root, outputName), output, { flag: 'wx', mode: 0o600 });
  const observation = { schema: 'momm-check/1', producer: 'checks.mjs', producer_sha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), run_id: runId, item_id: itemId,
    report_sha256: reportRef.sha256, input_sha256: report.input_sha256, phase, exit_code: result.timedOut ? 124 : Number.isInteger(result.code) ? result.code : 125,
    observed_at: new Date().toISOString(), command_label: `node ${test} ${args.map(a => JSON.stringify(a)).join(' ')}`.trim(), test: testRef, output: ref(outputName), artifacts: bound,
    attempts: (report.attempt_evidence ?? []).map(a => a.evidence), source: report.source_snapshot.kind ?? 'file', pieces: report.split?.pieces?.map(p => p.id) ?? ['whole'] };
  const observationName = `${folder}/check.json`;
  fs.writeFileSync(path.join(root, observationName), JSON.stringify(observation, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (phase === 'final') {
    const directory = path.join(evidence, 'verification');
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    demand(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'unsafe verification directory');
    const name = `.ensemble_reviews/verification/${runId}.json`, destination = path.join(root, name);
    if (fs.existsSync(destination)) {
      const old = fs.readFileSync(local(name)), archive = path.join(directory, `${runId}.${digest(old)}.json`);
      if (!fs.existsSync(archive)) fs.writeFileSync(archive, old, { flag: 'wx', mode: 0o600 });
      else demand(digest(fs.readFileSync(local(path.relative(root, archive).replaceAll('\\', '/')))) === digest(old), 'archive mismatch');
    }
    const temp = path.join(directory, `${runId}.${id}.tmp`);
    fs.writeFileSync(temp, fs.readFileSync(local(observationName)), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, destination);
  }
  return { ...ref(observationName), exit_code: observation.exit_code };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2), options = {}, artifacts = [];
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]; if (a === '--') { options.args = argv.slice(i + 1); break; }
      demand(['--run','--item','--phase','--test','--artifact','--timeout-seconds'].includes(a), `unknown option ${a}`);
      demand(i + 1 < argv.length, `missing value for ${a}`); const v = argv[++i];
      if (a === '--run') options.runId = v; else if (a === '--item') options.itemId = v; else if (a === '--phase') options.phase = v;
      else if (a === '--test') options.test = v; else if (a === '--artifact') artifacts.push(v); else if (a === '--timeout-seconds') options.timeout = Number(v) * 1000; else throw new Error(`unknown option ${a}`);
    }
    if (artifacts.length) options.artifacts = artifacts;
    const result = await recordCheck(process.cwd(), options); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.exit_code;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
