import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-runner-report-'));
const externalHome = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-runner-home-'));
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
  put('momm/scripts/evidence-location.mjs', fs.readFileSync(new URL('../momm/scripts/evidence-location.mjs',import.meta.url)));
  const run = (...args) => spawnSync(process.execPath, [path.join(root,'scripts/run-ci-suites.mjs'), ...args], { encoding:'utf8', timeout:30000, windowsHide:true, env:{...process.env,MOMM_EVIDENCE_HOME:''} });
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
  const external = spawnSync(process.execPath,[path.join(root,'scripts/run-ci-suites.mjs'),'--save-report','--commit',sha,'--grep','ok'],{
    encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,MOMM_EVIDENCE_HOME:externalHome}
  });
  assert.equal(external.status,0,external.stderr);
  const externalProjects=fs.readdirSync(externalHome);
  assert.equal(externalProjects.length,1,'configured evidence home must receive one project folder');
  const externalProject=path.join(externalHome,externalProjects[0]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(externalProject,'project.json'),'utf8')).schema,'momm-evidence-home/1');
  assert.equal(fs.readdirSync(externalProject).filter(n=>n.startsWith('ci-')).length,1);
  assert.equal(fs.readdirSync(path.join(root,'.ensemble_reviews')).filter(n=>n.startsWith('ci-')).length,2,'external saving must not allocate in the checkout');
  put('scripts/remove-sink.mjs', "import fs from 'node:fs'; import path from 'node:path'; const home=path.join(process.cwd(),'.ensemble_reviews'); for(const n of fs.readdirSync(home)) if(n.startsWith('ci-')) fs.rmSync(path.join(home,n),{recursive:true,force:true}); console.log('SINK-REMOVAL-FAILURE'); process.exitCode=1;");
  put('.github/workflows/self-test.yml','run: node scripts/remove-sink.mjs\n');
  const lostSink=run('--save-report','--commit',sha);
  assert.notEqual(lostSink.status,0); assert.match(lostSink.stdout,/FAIL\s+1 .*scripts\/remove-sink/);
  assert.match(lostSink.stdout,/SINK-REMOVAL-FAILURE/);
  put('.github/workflows/self-test.yml', 'run: node scripts/ok.mjs\nrun: node scripts/bad.mjs\n');
  put('momm/scripts/evidence-permissions.mjs', "export function preparePrivateEvidence(){throw new Error('permission inspection refused');}");
  const refused=run('--save-report','--commit',sha); assert.notEqual(refused.status,0);
  assert.doesNotMatch(refused.stdout,/RUN|PASS/);
  put('momm/scripts/evidence-permissions.mjs', "import path from 'node:path'; import fs from 'node:fs'; export function preparePrivateEvidence(p){if(path.basename(p).startsWith('ci-')) throw new Error('per-run refusal'); fs.mkdirSync(p,{recursive:true,mode:0o700});}");
  const runRefused=run('--save-report','--commit',sha);
  assert.notEqual(runRefused.status,0); assert.match(runRefused.stderr,/per-run refusal/);
  assert.doesNotMatch(runRefused.stdout,/RUN|PASS/);
  // Real native seam, not a stub: both creation and existing-directory inspection.
  for(const name of ['evidence-permissions.mjs','evidence-location.mjs']) {
    put('momm/scripts/'+name, fs.readFileSync(new URL('../momm/scripts/'+name,import.meta.url)));
  }
  // The stub-created home has inherited Windows ACLs, so remove only this test's
  // validated temporary evidence directory before real native creation.
  fs.rmSync(path.join(root,'.ensemble_reviews'),{recursive:true,force:true,maxRetries:5,retryDelay:100});
  const native=run('--save-report','--commit',sha,'--grep','ok');
  assert.equal(native.status,0,native.stderr);
  const nativeAgain=run('--save-report','--commit',sha,'--grep','ok');
  assert.equal(nativeAgain.status,0,nativeAgain.stderr);
  if(process.platform !== 'win32') {
    fs.chmodSync(path.join(root,'.ensemble_reviews'),0o755);
    const broad=run('--save-report','--commit',sha,'--grep','ok');
    assert.notEqual(broad.status,0); assert.doesNotMatch(broad.stdout,/RUN|PASS/);
    assert.equal(fs.statSync(path.join(root,'.ensemble_reviews')).mode & 0o777,0o755,'refusal must not repair permissions');
  }
  console.log('PASS: progress, argument validation, full captured failures, original-result retention, and permission refusal');
} finally {
  for(const owned of [root,externalHome]) fs.rmSync(owned,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
