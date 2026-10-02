import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-runner-report-'));
try {
  const put = (name, content) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
  };
  put('scripts/run-ci-suites.mjs', fs.readFileSync(new URL('./run-ci-suites.mjs', import.meta.url)));
  put('.github/workflows/self-test.yml', 'run: node scripts/ok.mjs\nrun: node scripts/bad.mjs\n');
  put('scripts/ok.mjs', 'process.exitCode = 0;');
  put('scripts/bad.mjs', "console.log('EARLY-FAILED-ASSERTION'); for(let i=0;i<20;i++) console.log('later passing scenario '+i); console.error('stderr detail'); process.exitCode=1;");
  // Fixture only: actual native permission enforcement is tested in evidence-permissions-native.
  put('momm/scripts/evidence-permissions.mjs', "import fs from 'node:fs'; export function preparePrivateEvidence(p){ fs.mkdirSync(p,{mode:0o700,recursive:true}); }");
  const run = (...args) => spawnSync(process.execPath, [path.join(root,'scripts/run-ci-suites.mjs'), ...args], { encoding:'utf8', timeout:30000, windowsHide:true });
  const sha = '1'.repeat(40);
  const invalid = run('--save-report'); assert.equal(invalid.status,2);
  assert.match(invalid.stderr,/requires --commit/);
  assert.equal(fs.existsSync(path.join(root,'.ensemble_reviews')),false);
  const loneCommit=run('--commit',sha); assert.equal(loneCommit.status,2);
  const first = run('--save-report','--commit',sha);
  assert.equal(first.status,1); assert.match(first.stdout,/RUN 1\/2 scripts\/ok/);
  assert.match(first.stdout,/1 of 2 suites passed/);
  const folder = path.join(root,'.ensemble_reviews',fs.readdirSync(path.join(root,'.ensemble_reviews')).find(n=>n.startsWith('ci-')));
  const report = JSON.parse(fs.readFileSync(path.join(folder,'report.json'),'utf8'));
  assert.equal(report.commit,sha); assert.match(report.commit_basis,/caller supplied/);
  assert.equal(path.basename(folder),'ci-'+report.run_id);
  assert.equal(report.results[1].stdout_sha256.length,64);
  assert.equal(report.results[1].capture_incomplete,false);
  assert.equal(report.failed,1); assert.equal(report.results.length,2);
  assert.match(fs.readFileSync(path.join(folder,report.results[1].stdout_file),'utf8'),/EARLY-FAILED-ASSERTION/);
  assert.match(fs.readFileSync(path.join(folder,report.results[1].stderr_file),'utf8'),/stderr detail/);
  assert.equal(report.results[1].rerun,'node scripts/bad.mjs');
  const original = fs.readFileSync(path.join(folder,'report.json'),'utf8');
  const second = run('--save-report','--commit',sha,'--grep','ok'); assert.equal(second.status,0);
  assert.equal(fs.readdirSync(path.join(root,'.ensemble_reviews')).filter(n=>n.startsWith('ci-')).length,2);
  assert.equal(fs.readFileSync(path.join(folder,'report.json'),'utf8'),original);
  put('momm/scripts/evidence-permissions.mjs', "export function preparePrivateEvidence(){throw new Error('permission inspection refused');}");
  const refused=run('--save-report','--commit',sha); assert.notEqual(refused.status,0);
  assert.doesNotMatch(refused.stdout,/RUN|PASS/);
  console.log('PASS: progress, argument validation, full captured failures, original-result retention, and permission refusal');
} finally { fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
