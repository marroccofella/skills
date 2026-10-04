import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { windowsTool } from '../momm/scripts/process-scope.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-runner-report-'));
const externalHome = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-runner-home-'));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-runner-git-'));
// Each 1.17.1 item is its own named check, so one run shows every item that fails, not only the first.
const failures = [];
const item = (name, body) => { try { body(); } catch (error) { failures.push(name); console.error(`FAILED ${name}\n${error?.stack ?? error}`); } };
// A hosted temp folder is spelled two ways (8.3 short names on Windows, /var and /private/var on
// macOS), so a printed path is compared by what it resolves to, never as text.
const same = (a, b) => fs.realpathSync.native(a) === fs.realpathSync.native(b);
const lastLines = (r, n = 3) => r.stdout.trimEnd().split(/\r?\n/).slice(-n);
const oneLine = (r) => assert.equal(r.stderr.trimEnd().split(/\r?\n/).length, 1, 'one plain line: ' + r.stderr);
const noTrace = (r) => assert.doesNotMatch(r.stderr + r.stdout, /^\s+at |node:internal/m, 'a refusal is a plain message, never a stack trace');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir).sort().map((name) => {
  const file = path.join(dir, name), st = fs.statSync(file);
  return [name, [st.size, st.mtimeMs, digest(fs.readFileSync(file))]];
}));
try {
  const put = (name, content, base = root) => {
    const target = path.join(base, name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
  };
  const home = path.join(root, '.ensemble_reviews');
  const folders = () => (fs.existsSync(home) ? fs.readdirSync(home).filter(n => n.startsWith('ci-')) : []);
  const newest = (before) => { const made = folders().filter(n => !before.includes(n)); assert.equal(made.length, 1, 'one new run folder'); return path.join(home, made[0]); };
  const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  // Fixture only: actual native permission enforcement is tested in evidence-permissions-native.
  const permissive = "import fs from 'node:fs'; export function requirePrivateEvidence(p){ if(!fs.statSync(p).isDirectory()) throw new Error('not a directory'); } export function preparePrivateEvidence(p){ fs.mkdirSync(p,{mode:0o700,recursive:true}); requirePrivateEvidence(p); }";
  const copy = (name, base = root) => put(name, fs.readFileSync(new URL('../' + name, import.meta.url)), base);
  copy('scripts/run-ci-suites.mjs');
  put('.github/workflows/self-test.yml', 'run: node scripts/ok.mjs\nrun: node scripts/bad.mjs\n');
  // Each run of this suite leaves one byte, so a command that must not rerun suites can be held to it.
  put('scripts/ok.mjs', "import fs from 'node:fs'; fs.appendFileSync(new URL('../ok-ran.log', import.meta.url), 'x'); process.exitCode = 0;");
  put('scripts/bad.mjs', "console.log('EARLY-FAILED-ASSERTION'); for(let i=0;i<20;i++) console.log('later passing scenario '+i); console.error('stderr detail'); process.exitCode=1;");
  put('momm/scripts/evidence-permissions.mjs', permissive);
  copy('momm/scripts/evidence-location.mjs'); copy('momm/scripts/process-scope.mjs');
  const runner = path.join(root, 'scripts/run-ci-suites.mjs');
  const run = (...args) => spawnSync(process.execPath, [runner, ...args], { encoding:'utf8', timeout:30000, windowsHide:true, env:{...process.env,MOMM_EVIDENCE_HOME:''} });
  const okRuns = () => (fs.existsSync(path.join(root, 'ok-ran.log')) ? fs.readFileSync(path.join(root, 'ok-ran.log'), 'utf8').length : 0);
  const sha = '1'.repeat(40);
  const invalid = run('--save-report'); assert.equal(invalid.status,2);
  assert.match(invalid.stderr,/requires --commit/);
  assert.equal(fs.existsSync(path.join(root,'.ensemble_reviews')),false);
  const loneCommit=run('--commit',sha); assert.equal(loneCommit.status,2);

  // 1.17.1 R6: `--grpe --list` used to list everything and exit 0.
  item('R6 strict option validation', () => {
    for (const [typed, meant] of [['--grpe', '--grep'], ['--lsit', '--list'], ['--save-reprot', '--save-report'], ['--comit', '--commit'], ['--recover', '--recover-report'], ['--grep=ok', '--grep']]) {
      for (const rest of [['--list'], ['ok'], []]) {
        const typo = run(typed, ...rest);
        assert.equal(typo.status, 2, `${typed} ${rest.join(' ')} must be refused`);
        assert.equal(typo.stdout, '', 'nothing is listed or run');
        assert(typo.stderr.includes(`Unknown option ${typed}. Nearest valid option: ${meant}.`), typo.stderr);
      }
    }
    const stray = run('ok'); assert.equal(stray.status, 2); assert.equal(stray.stdout, ''); assert.match(stray.stderr, /Unexpected argument/);
    const twice = run('--grep', 'ok', '--grep', 'bad'); assert.equal(twice.status, 2); assert.equal(twice.stdout, '');
    assert.equal(okRuns(), 0, 'no suite ran for a refused command line');
    const listed = run('--list'); assert.equal(listed.status, 0); assert.equal(listed.stdout, 'scripts/ok.mjs\nscripts/bad.mjs\n');
    const bare = run('--grep', '--list'); assert.equal(bare.status, 2); assert.match(bare.stderr, /--grep needs a value/);
  });

  // 1.17.1 R5: the last three lines are the outcome, one fact each. The first is the line reviewers already quote.
  item('R5 three-part outcome without a report', () => {
    const plain = run();
    assert.equal(plain.status, 1);
    const [suites, saved, exit] = lastLines(plain);
    assert.match(suites, /^1 of 2 suites passed on \S+ \S+, Node v\d+\.\d+\.\d+$/);
    assert.match(saved, /^Report saved: not requested/);
    assert.equal(exit, 'Exit status: 1');
    const passing = run('--grep', 'ok');
    assert.equal(passing.status, 0);
    assert.deepEqual(lastLines(passing).slice(1).map(l => l.replace(/ \(.*/, '')), ['Report saved: not requested', 'Exit status: 0']);
    assert.match(lastLines(passing)[0], /^1 of 1 suites passed on /);
  });

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
  item('R5 three-part outcome with a saved report', () => {
    const [suites, saved, exit] = lastLines(first);
    assert.match(suites, /^1 of 2 suites passed on \S+ \S+, Node v\d+\.\d+\.\d+$/);
    const named = saved.match(/^Report saved: yes, (.+report\.json) \(private; inspect before sharing\)$/);
    assert(named, saved); assert(same(named[1], path.join(folder, 'report.json')), 'the saved line names the report');
    assert.equal(exit, 'Exit status: 1');
  });
  // 1.17.1 R9: this fixture is not a Git checkout, so the report says HEAD is unknown instead of repeating the label.
  item('R9 a folder Git cannot describe is recorded as unknown', () => {
    assert.equal(report.checkout.available, false); assert.equal(typeof report.checkout.reason, 'string');
    assert.equal(report.checkout.head, null); assert.equal(report.checkout.clean, null);
    assert.equal(report.label_matches_head, null);
    assert.match(lastLines(first, 4)[0], /^Checkout: Git could not confirm this checkout/);
  });
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
  // 1.17.1 R7 hand-off: evidenceLocation's refusals reach the user as the library's one line, and the
  // remedy that line names (--evidence-home) is one this command takes.
  item('R7 a refused evidence home is one plain line before any suite, and --evidence-home is honoured', () => {
    const ran = okRuns(), before = folders();
    const withHome = (value, ...args) => spawnSync(process.execPath, [runner, '--save-report', '--commit', sha, '--grep', 'ok', ...args], { encoding:'utf8', timeout:30000, windowsHide:true, env:{...process.env,MOMM_EVIDENCE_HOME:value} });
    for (const [r, why] of [[withHome(path.join(root, 'home-inside')), /The evidence home must lie outside the project/], [withHome('relative-home'), /must be an absolute path/],
      [withHome('', '--evidence-home', path.join(root, 'home-inside')), /The evidence home must lie outside the project/]]) {
      assert.equal(r.status, 1, r.stderr); noTrace(r); oneLine(r); assert.doesNotMatch(r.stdout, /RUN|PASS/); assert.match(r.stderr, why);
    }
    assert.equal(fs.existsSync(path.join(root, 'home-inside')), false); assert.equal(okRuns(), ran, 'no suite ran');
    const flagHome = path.join(externalHome, 'named-by-flag');
    const flagged = withHome('', '--evidence-home', flagHome);
    assert.equal(flagged.status, 0, flagged.stderr);
    const project = fs.readdirSync(flagHome); assert.equal(project.length, 1);
    const saved = lastLines(flagged)[1].match(/^Report saved: yes, (.+report\.json) /);
    assert(saved && same(path.dirname(path.dirname(saved[1])), path.join(flagHome, project[0])), 'the report is where --evidence-home says');
    assert.deepEqual(folders(), before, 'nothing was saved in the checkout');
    for (const usage of [['--evidence-home'], ['--evidence-home', flagHome], ['--evidence-home', flagHome, '--list']]) { const r = run(...usage); assert.equal(r.status, 2, usage.join(' ')); assert.equal(r.stdout, ''); }
  });
  put('scripts/remove-sink.mjs', "import fs from 'node:fs'; import path from 'node:path'; const home=path.join(process.cwd(),'.ensemble_reviews'); for(const n of fs.readdirSync(home)) if(n.startsWith('ci-')) fs.rmSync(path.join(home,n),{recursive:true,force:true}); console.log('SINK-REMOVAL-FAILURE'); process.exitCode=1;");
  put('.github/workflows/self-test.yml','run: node scripts/remove-sink.mjs\n');
  const lostSink=run('--save-report','--commit',sha);
  assert.notEqual(lostSink.status,0); assert.match(lostSink.stdout,/FAIL\s+1 .*scripts\/remove-sink/);
  assert.match(lostSink.stdout,/SINK-REMOVAL-FAILURE/);
  item('R5 a run whose storage vanished still ends with the three-part outcome', () => {
    noTrace(lostSink);
    const [suites, saved, exit] = lastLines(lostSink);
    assert.match(suites, /^0 of 1 suites passed on /); assert.match(saved, /^Report saved: no \(/); assert.equal(exit, 'Exit status: 1');
  });
  put('.github/workflows/self-test.yml', 'run: node scripts/ok.mjs\nrun: node scripts/bad.mjs\n');
  put('momm/scripts/evidence-permissions.mjs', "const refusal=()=>Object.assign(new Error('permission inspection refused'),{code:'MOMM_EVIDENCE_PERMISSIONS'}); export function requirePrivateEvidence(){throw refusal();} export function preparePrivateEvidence(){throw refusal();}");
  const refused=run('--save-report','--commit',sha); assert.notEqual(refused.status,0);
  assert.doesNotMatch(refused.stdout,/RUN|PASS/);
  put('momm/scripts/evidence-permissions.mjs', "import path from 'node:path'; import fs from 'node:fs'; export function requirePrivateEvidence(){} export function preparePrivateEvidence(p){if(path.basename(p).startsWith('ci-')) throw Object.assign(new Error('per-run refusal'),{code:'MOMM_EVIDENCE_PERMISSIONS'}); fs.mkdirSync(p,{recursive:true,mode:0o700});}");
  const runRefused=run('--save-report','--commit',sha);
  assert.notEqual(runRefused.status,0); assert.match(runRefused.stderr,/per-run refusal/);
  assert.doesNotMatch(runRefused.stdout,/RUN|PASS/);

  // A fault injected into this process's own file calls: the suites the runner starts do not load it.
  put('fault.cjs', `const fs=require('node:fs'),path=require('node:path');const mode=process.env.MOMM_TEST_FAULT;
const deny=(code,call,file)=>Object.assign(new Error(code+': operation not permitted, '+call+" '"+file+"'"),{code,syscall:call,path:file});
const final=(file)=>{try{return fs.readFileSync(file,'utf8').includes('"finished_at"');}catch{return false;}};
const rename=fs.renameSync,write=fs.writeFileSync;
fs.renameSync=function(from,to){if(mode==='final-rename'&&path.basename(String(to))==='report.json'&&final(from))throw deny('EPERM','rename',String(from));return rename.apply(this,arguments);};
fs.writeFileSync=function(file,data){const pending=/^report-.*\\.tmp$/.test(path.basename(String(file)));
if(pending&&(mode==='every-write'||(mode==='final-write'&&String(data).includes('"finished_at"'))))throw deny('EACCES','open',String(file));return write.apply(this,arguments);};
`);
  const faulty = (fault, ...args) => spawnSync(process.execPath, ['--require', path.join(root, 'fault.cjs'), runner, ...args], { encoding:'utf8', timeout:30000, windowsHide:true, env:{...process.env,MOMM_EVIDENCE_HOME:'',MOMM_TEST_FAULT:fault} });
  const pendingIn = (dir) => fs.readdirSync(dir).filter(n => /^report-.*\.tmp$/.test(n));

  // 1.17.1 R3: the reason is printed plainly, before any RUN line.
  item('R3 report storage is checked before the first suite', () => {
    for (const r of [refused, runRefused]) { noTrace(r); oneLine(r); assert.match(r.stderr, /Report storage refused before any suite ran/); }
    assert.match(refused.stderr, /permission inspection refused/);
    put('momm/scripts/evidence-permissions.mjs', permissive);
    const ran = okRuns();
    const unwritable = faulty('every-write', '--save-report', '--commit', sha);
    assert.equal(unwritable.status, 1); noTrace(unwritable);
    assert.doesNotMatch(unwritable.stdout, /RUN|PASS/);
    assert.match(unwritable.stderr, /Report storage refused before any suite ran: .*EACCES/); oneLine(unwritable);
    // Only a refusal is printed as one: an error that is neither the library's nor the file system's is a defect.
    put('momm/scripts/evidence-permissions.mjs', "export function requirePrivateEvidence(){} export function preparePrivateEvidence(){throw new TypeError('not a refusal');}");
    const defect = run('--save-report', '--commit', sha);
    assert.notEqual(defect.status, 0); assert.doesNotMatch(defect.stdout, /RUN|PASS/);
    assert.match(defect.stderr, /TypeError: not a refusal/); assert.doesNotMatch(defect.stderr, /Report storage refused/);
    assert.equal(okRuns(), ran, 'no suite ran');
  });
  put('momm/scripts/evidence-permissions.mjs', permissive);
  put('.github/workflows/self-test.yml', 'run: node scripts/ok.mjs\n');

  // 1.17.1 R3, second half: storage that stops being private during the run is not written to again.
  let uncheckedFolder = null;
  item('R3 report storage is checked again when saving', () => {
    const marker = path.join(root, 'deny-now');
    put('scripts/deny.mjs', "import fs from 'node:fs'; fs.writeFileSync(new URL('../deny-now', import.meta.url), 'x');");
    put('.github/workflows/self-test.yml', 'run: node scripts/deny.mjs\n');
    put('momm/scripts/evidence-permissions.mjs', `import fs from 'node:fs'; import path from 'node:path';
export function requirePrivateEvidence(p){ if(path.basename(p).startsWith('ci-') && fs.existsSync(${JSON.stringify(marker)})) throw Object.assign(new Error('storage changed during the run'),{code:'MOMM_EVIDENCE_PERMISSIONS',reason:'additional_principal'}); }
export function preparePrivateEvidence(p){ fs.mkdirSync(p,{recursive:true,mode:0o700}); requirePrivateEvidence(p); }`);
    try {
      const before = folders();
      const changed = run('--save-report', '--commit', sha);
      assert.equal(changed.status, 1); noTrace(changed);
      const [suites, saved, exit] = lastLines(changed);
      assert.match(suites, /^1 of 1 suites passed on /);
      assert.match(saved, /^Report saved: no \(not verified private: additional_principal\)/);
      assert.equal(exit, 'Exit status: 1');
      uncheckedFolder = newest(before);
      assert.equal(readJson(path.join(uncheckedFolder, 'report.json')).finished_at, undefined, 'nothing more is written to storage that failed its check');
      assert.deepEqual(pendingIn(uncheckedFolder), []);
    } finally {
      fs.rmSync(marker, { force: true });
      put('momm/scripts/evidence-permissions.mjs', permissive);
      put('.github/workflows/self-test.yml', 'run: node scripts/ok.mjs\n');
    }
  });

  // 1.17.1 R4. The real case: 93 of 93 suites passed, then renameSync of report.json failed with EPERM
  // in a OneDrive-synced checkout and the process exited 1 with a stack trace.
  let lostFolder = null;
  item('R4 a failed final rename keeps the attempt and says where the results are', () => {
    const before = folders();
    const lost = faulty('final-rename', '--save-report', '--commit', sha);
    assert.equal(lost.status, 1); noTrace(lost);
    assert.match(lost.stdout, /PASS\s+0 .*scripts\/ok/);
    const [suites, saved, exit] = lastLines(lost);
    assert.match(suites, /^1 of 1 suites passed on \S+ \S+, Node v\d+\.\d+\.\d+$/);
    assert.match(saved, /^Report saved: no \(EPERM on rename\)/);
    assert.equal(exit, 'Exit status: 1');
    lostFolder = newest(before);
    const kept = readJson(path.join(lostFolder, 'report.json'));
    assert.equal(kept.finished_at, undefined, 'the last good report.json is left as it was'); assert.equal(kept.results.length, 1);
    const pending = pendingIn(lostFolder); assert.equal(pending.length, 1, 'the complete report stays where it was written');
    assert.equal(typeof readJson(path.join(lostFolder, pending[0])).finished_at, 'string');
    const where = lost.stdout.match(/^Complete results: (.+)$/m);
    assert(where && same(where[1], path.join(lostFolder, pending[0])), 'the output names the file that holds the complete results');
    const named = lost.stdout.match(/^Run folder: (.+)$/m);
    assert(named && same(named[1], lostFolder)); assert.match(lost.stdout, /--recover-report <run folder> --to <private dir>/);
  });
  item('R4 --recover-report completes the record elsewhere', () => {
    assert(lostFolder, 'needs the run folder of the failed save');
    const kept = readJson(path.join(lostFolder, 'report.json')), pending = pendingIn(lostFolder)[0];
    const frozen = snapshot(lostFolder), ran = okRuns(), dest = path.join(externalHome, 'recovered');
    for (const usage of [['--recover-report', lostFolder], ['--to', dest], ['--recover-report', lostFolder, '--to', dest, '--list'], ['--recover-report', '--to', dest]]) {
      const r = run(...usage); assert.equal(r.status, 2, usage.join(' ')); assert.equal(r.stdout, '');
    }
    const within = run('--recover-report', lostFolder, '--to', path.join(lostFolder, 'out'));
    assert.equal(within.status, 1); assert.match(within.stderr, /outside the run folder/); noTrace(within);
    assert.equal(fs.existsSync(dest), false);
    const recovered = run('--recover-report', lostFolder, '--to', dest);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.doesNotMatch(recovered.stdout, /^(RUN|PASS|FAIL) /m);
    const out = path.join(dest, `ci-${kept.run_id}-recovered.json`), done = readJson(out);
    assert.match(recovered.stdout, /^1 of 1 suites passed in the recovered run/m);
    const told = recovered.stdout.match(/^Recovered report: (.+)$/m); assert(told && same(told[1], out));
    assert.equal(done.passed, 1); assert.equal(done.failed, 0); assert.equal(typeof done.finished_at, 'string');
    assert.equal(done.run_id, kept.run_id); assert.equal(done.commit, sha); assert.deepEqual(done.results, kept.results);
    assert.equal(done.recovery.source_file, pending); assert.equal(done.recovery.suites_rerun, false);
    assert.equal(done.recovery.totals, 'recorded by the run');
    assert.equal(done.recovery.source_sha256, digest(fs.readFileSync(path.join(lostFolder, pending))));
    assert.deepEqual(snapshot(lostFolder), frozen, 'recovery never modifies the original folder');
    assert.equal(okRuns(), ran, 'recovery reruns nothing');
    const again = run('--recover-report', lostFolder, '--to', dest);
    assert.equal(again.status, 1); assert.match(again.stderr, /already exists/); noTrace(again);
    assert.deepEqual(readJson(out), done, 'an existing recovered report is never overwritten');
    // A run that never finished has no complete record to recover.
    const partial = path.join(externalHome, 'ci-partial');
    put('report.json', JSON.stringify({ schema: 'momm-ci-suites/1', run_id: randomUUID(), selected: 2, results: [{ command: 'scripts/ok.mjs', status: 'passed' }] }), partial);
    const unfinished = run('--recover-report', partial, '--to', path.join(externalHome, 'recovered-partial'));
    assert.equal(unfinished.status, 1); assert.match(unfinished.stderr, /1 of 2 suites/); noTrace(unfinished);
    assert.equal(fs.existsSync(path.join(externalHome, 'recovered-partial')), false);
  });
  item('R4 a failed final write is recovered from the last saved results', () => {
    const before = folders();
    const unwritten = faulty('final-write', '--save-report', '--commit', sha);
    assert.equal(unwritten.status, 1); noTrace(unwritten);
    assert.match(lastLines(unwritten)[1], /^Report saved: no \(EACCES on open\)/);
    const source = newest(before);
    assert.deepEqual(pendingIn(source), []);
    for (const [from, to] of [[source, 'recovered-unwritten'], [uncheckedFolder, 'recovered-unchecked']]) {
      assert(from, 'needs the run folder'); const frozen = snapshot(from);
      const r = run('--recover-report', from, '--to', path.join(externalHome, to));
      assert.equal(r.status, 0, r.stderr);
      const done = readJson(path.join(externalHome, to, `ci-${readJson(path.join(from, 'report.json')).run_id}-recovered.json`));
      assert.equal(done.passed, 1); assert.equal(done.failed, 0); assert.equal(done.recovery.source_file, 'report.json');
      assert.equal(done.recovery.totals, 'derived from the saved results');
      assert.deepEqual(snapshot(from), frozen);
    }
  });
  // The second half of the real case: the synced files then carried reparse-point attributes, so the
  // next run refused that evidence folder as linked_entry. Recovery reads the folder without that audit.
  item('R4 a folder the permission audit now refuses can still be recovered', () => {
    assert(lostFolder, 'needs the run folder of the failed save');
    put('momm/scripts/evidence-permissions.mjs', `import fs from 'node:fs';
export function requirePrivateEvidence(p){ if(String(p).includes('.ensemble_reviews')) throw Object.assign(new Error('MOMM cannot verify private evidence-folder permissions (linked_entry): it contains a link or junction.'),{code:'MOMM_EVIDENCE_PERMISSIONS',reason:'linked_entry'}); }
export function preparePrivateEvidence(p){ requirePrivateEvidence(p); fs.mkdirSync(p,{recursive:true,mode:0o700}); }`);
    try {
      const ran = okRuns(), frozen = snapshot(lostFolder);
      const later = run('--save-report', '--commit', sha);
      assert.equal(later.status, 1); noTrace(later); assert.doesNotMatch(later.stdout, /RUN|PASS/);
      assert.match(later.stderr, /Report storage refused before any suite ran: .*linked_entry/);
      const rescued = run('--recover-report', lostFolder, '--to', path.join(externalHome, 'recovered-after-refusal'));
      assert.equal(rescued.status, 0, rescued.stderr);
      const refusedTarget = run('--recover-report', lostFolder, '--to', path.join(home, 'recovered-here'));
      assert.equal(refusedTarget.status, 1); noTrace(refusedTarget); assert.match(refusedTarget.stderr, /not verified private \(linked_entry\)/);
      assert.equal(fs.existsSync(path.join(home, 'recovered-here')), false);
      assert.deepEqual(snapshot(lostFolder), frozen); assert.equal(okRuns(), ran);
    } finally { put('momm/scripts/evidence-permissions.mjs', permissive); }
  });

  // Real native seam, not a stub: both creation and existing-directory inspection.
  for(const name of ['evidence-permissions.mjs','evidence-location.mjs']) {
    put('momm/scripts/'+name, fs.readFileSync(new URL('../momm/scripts/'+name,import.meta.url)));
  }
  // The stub-created home has inherited Windows ACLs, so remove only this test's
  // validated temporary evidence directory before real native creation.
  fs.rmSync(path.join(root,'.ensemble_reviews'),{recursive:true,force:true,maxRetries:5,retryDelay:100});
  const native=run('--save-report','--commit',sha,'--grep','ok');
  assert.equal(native.status,0,native.stderr);
  const nativeFolder = newest([]);
  const nativeAgain=run('--save-report','--commit',sha,'--grep','ok');
  assert.equal(nativeAgain.status,0,nativeAgain.stderr);
  item('R4 native recovery into a new private folder', () => {
    const frozen = snapshot(nativeFolder), target = path.join(externalHome, 'recovered-native');
    const r = run('--recover-report', nativeFolder, '--to', target);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readJson(path.join(target, `ci-${path.basename(nativeFolder).slice(3)}-recovered.json`)).recovery.source_file, 'report.json');
    assert.deepEqual(snapshot(nativeFolder), frozen);
    if (process.platform === 'win32') {
      // A junction inside the evidence folder is what the Windows audit calls linked_entry.
      const link = path.join(home, 'linked');
      fs.symlinkSync(externalHome, link, 'junction');
      try {
        const later = run('--save-report', '--commit', sha, '--grep', 'ok');
        assert.equal(later.status, 1); noTrace(later); assert.doesNotMatch(later.stdout, /RUN|PASS/);
        assert.match(later.stderr, /Report storage refused before any suite ran: .*linked_entry/);
        const rescued = run('--recover-report', nativeFolder, '--to', path.join(externalHome, 'recovered-native-linked'));
        assert.equal(rescued.status, 0, rescued.stderr);
        assert.deepEqual(snapshot(nativeFolder), frozen);
      } finally { fs.rmdirSync(link); }
    }
  });
  if(process.platform !== 'win32') {
    fs.chmodSync(path.join(root,'.ensemble_reviews'),0o755);
    const broad=run('--save-report','--commit',sha,'--grep','ok');
    assert.notEqual(broad.status,0); assert.doesNotMatch(broad.stdout,/RUN|PASS/);
    assert.equal(fs.statSync(path.join(root,'.ensemble_reviews')).mode & 0o777,0o755,'refusal must not repair permissions');
    item('R3/R4 native refusals are plain, and a non-private recovery folder is refused unchanged', () => {
      noTrace(broad); assert.match(broad.stderr, /Report storage refused before any suite ran: .*permissions_not_private/);
      const rescued = run('--recover-report', nativeFolder, '--to', path.join(externalHome, 'recovered-native-broad'));
      assert.equal(rescued.status, 0, rescued.stderr);
      const open = path.join(externalHome, 'open'); fs.mkdirSync(open); fs.chmodSync(open, 0o755);
      const exposed = run('--recover-report', nativeFolder, '--to', open);
      assert.equal(exposed.status, 1); noTrace(exposed); assert.match(exposed.stderr, /not verified private \(permissions_not_private\)/);
      assert.deepEqual(fs.readdirSync(open), []); assert.equal(fs.statSync(open).mode & 0o777, 0o755, 'refusal must not repair permissions');
    });
  }

  // 1.17.1 R9: a real temporary Git checkout. The stub keeps this part about identity, not permissions.
  item('R9 the report records what Git says HEAD is, beside the caller label', () => {
    for (const name of ['scripts/run-ci-suites.mjs', 'momm/scripts/evidence-location.mjs', 'momm/scripts/process-scope.mjs']) copy(name, repo);
    put('momm/scripts/evidence-permissions.mjs', permissive, repo);
    put('.github/workflows/self-test.yml', 'run: node scripts/ok.mjs\n', repo);
    put('scripts/ok.mjs', 'process.exitCode = 0;', repo);
    put('.gitignore', '.ensemble_reviews/\n', repo);
    // Never a bare name: the Git that builds the fixture comes from outside this checkout too.
    const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    let tool; try { tool = windowsTool('git', { cwd: here, project: here }); } catch { tool = 'git-not-found-outside-the-checkout'; }
    const git = (...args) => { const r = spawnSync(tool, args, { cwd: repo, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
    git('-c', 'init.templateDir=', 'init', '-q', '.'); git('config', 'core.autocrlf', 'false');
    git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture');
    const head = git('rev-parse', 'HEAD'), repoHome = path.join(repo, '.ensemble_reviews');
    const saved = (label, env = {}) => {
      const before = fs.existsSync(repoHome) ? fs.readdirSync(repoHome) : [];
      const r = spawnSync(process.execPath, [path.join(repo, 'scripts/run-ci-suites.mjs'), '--save-report', '--commit', label], { encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, MOMM_EVIDENCE_HOME: '', ...env } });
      assert.equal(r.status, 0, r.stderr);
      const made = fs.readdirSync(repoHome).filter(n => !before.includes(n)); assert.equal(made.length, 1);
      return { r, report: readJson(path.join(repoHome, made[0], 'report.json')), summary: lastLines(r, 4)[0] };
    };
    const match = saved(head);
    assert.equal(match.report.commit, head); assert.match(match.report.commit_basis, /caller supplied/);
    assert.deepEqual(match.report.checkout, { source: 'git', available: true, head, clean: true });
    assert.equal(match.report.label_matches_head, true);
    assert.equal(match.summary, `Checkout: HEAD ${head}, clean tree; the --commit label matches.`);
    assert(match.r.stdout.indexOf('Checkout: ') < match.r.stdout.indexOf('RUN 1/1'), 'the checkout is stated before the first suite as well');
    const mismatch = saved(sha);
    assert.equal(mismatch.report.commit, sha, 'the label is kept as the caller gave it');
    assert.equal(mismatch.report.checkout.head, head); assert.equal(mismatch.report.label_matches_head, false);
    assert.equal(mismatch.summary, `Checkout: HEAD ${head}, clean tree; the --commit label ${sha} does not match HEAD.`);
    // Git is asked about this checkout whatever the caller's environment points at.
    const redirected = saved(head, { GIT_DIR: externalHome, GIT_WORK_TREE: externalHome });
    assert.equal(redirected.report.checkout.head, head); assert.equal(redirected.report.label_matches_head, true);
    put('untracked.txt', 'x', repo);
    const dirty = saved(head);
    assert.equal(dirty.report.checkout.clean, false); assert.equal(dirty.report.label_matches_head, true);
    assert.match(dirty.summary, /uncommitted or untracked changes/);
    fs.rmSync(path.join(repo, 'untracked.txt'));
    // No Git on PATH: say so, never guess from the label.
    const empty = path.join(externalHome, 'empty-path'); fs.mkdirSync(empty);
    const without = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'path'));
    const noGit = spawnSync(process.execPath, [path.join(repo, 'scripts/run-ci-suites.mjs'), '--save-report', '--commit', head], { encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...without, PATH: empty, MOMM_EVIDENCE_HOME: '' } });
    assert.equal(noGit.status, 0, noGit.stderr);
    assert.match(lastLines(noGit, 4)[0], /^Checkout: Git could not confirm this checkout \(git_not_found\)/);
    const unknown = fs.readdirSync(repoHome).map(n => readJson(path.join(repoHome, n, 'report.json'))).filter(r => r.checkout.available === false);
    assert.equal(unknown.length, 1);
    assert.deepEqual(unknown[0].checkout, { source: 'git', available: false, reason: 'git_not_found', head: null, clean: null });
    assert.equal(unknown[0].label_matches_head, null); assert.equal(unknown[0].commit, head);
    if (process.platform !== 'win32') {
      // A git the checkout itself supplies is never the one that vouches for it: its answer would
      // match this label. With that PATH entry refused, the system Git answers, or none does.
      const forged = 'f'.repeat(40);
      put('bin/git', `#!/bin/sh\ncase "$*" in *--show-prefix*) echo;; *status*) ;; *) echo ${forged};; esac\n`, repo); fs.chmodSync(path.join(repo, 'bin/git'), 0o755);
      const planted = spawnSync(process.execPath, [path.join(repo, 'scripts/run-ci-suites.mjs'), '--save-report', '--commit', forged], { encoding: 'utf8', timeout: 60000, env: { ...without, PATH: path.join(repo, 'bin'), MOMM_EVIDENCE_HOME: '' } });
      assert.equal(planted.status, 0, planted.stderr);
      const vouched = fs.readdirSync(repoHome).map(n => readJson(path.join(repoHome, n, 'report.json'))).filter(r => r.commit === forged);
      assert.equal(vouched.length, 1);
      assert.notEqual(vouched[0].checkout.head, forged); assert.notEqual(vouched[0].label_matches_head, true);
      assert.doesNotMatch(lastLines(planted, 4)[0], /label matches/);
    }
  });

  // 1.17.1 S9: one CI run shows every failing suite. These read the real workflow.
  const workflow = fs.readFileSync(new URL('../.github/workflows/self-test.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const steps = workflow.split('\n      - ').slice(1);
  const keepGoing = `failed=0; trap 'echo "::error::Suite failed: $BASH_COMMAND"; failed=1' ERR; set +e`;
  const lists = steps.filter(s => /^ {8}shell: bash$/m.test(s) && /^ {8}run: \|$/m.test(s))
    .map(s => s.split('\n').filter(l => l.startsWith(' '.repeat(10))).map(l => l.slice(10)))
    .filter(lines => lines.filter(l => /^node \S+\.mjs/.test(l)).length > 1);
  item('S9 the listed commands are what they were: a file and plain flags', () => {
    const listed = spawnSync(process.execPath, [fileURLToPath(new URL('./run-ci-suites.mjs', import.meta.url)), '--list'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(listed.status, 0, listed.stderr);
    const commands = listed.stdout.trimEnd().split('\n');
    assert(commands.length > 80, 'the suite list was found');
    for (const command of commands) {
      const [file, ...flags] = command.split(' ');
      assert(fs.existsSync(new URL('../' + file, import.meta.url)), `listed command is not a repository file: ${command}`);
      for (const flag of flags) assert.match(flag, /^--[a-z-]+$/, `listed command carries shell text: ${command}`);
      assert(!file.endsWith('run-ci-suites.mjs'), 'the runner never lists itself');
    }
  });
  item('S9 every step still runs after an earlier step failed, and the job still fails', () => {
    const running = steps.filter(s => /^ {8}run:/m.test(s));
    assert(running.length > 50, 'the workflow steps were found');
    for (const step of running) assert.match(step, /^ {8}if: \$\{\{ !cancelled\(\) \}\}$/m, `step stops being run after an earlier failure: ${step.split('\n')[0]}`);
    assert.doesNotMatch(workflow, /continue-on-error/, 'a failing suite must still fail the job');
  });
  item('S9 a step that lists suites runs all of them and fails if any failed', () => {
    assert(lists.length >= 2, 'the suite-list steps were found');
    for (const lines of lists) {
      assert.equal(lines[0], keepGoing); assert.equal(lines.at(-1), 'exit $failed');
      for (const line of lines.slice(1, -1)) assert.match(line, /^node [\w./-]+\.mjs( --[a-z-]+)*$/, `unexpected line in a suite list: ${line}`);
    }
    if (process.platform === 'win32' || !fs.existsSync('/bin/bash')) return;
    // The step's own text, run the way GitHub runs `shell: bash`, with a stand-in for node.
    const bin = path.join(externalHome, 'bin'), log = path.join(externalHome, 'stub.log');
    put('bin/node', '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$STUB_LOG"\ncase " $STUB_FAIL " in *" $1 "*) echo "stub failure in $1"; exit 1;; esac\nexit 0\n', externalHome);
    fs.chmodSync(path.join(bin, 'node'), 0o755);
    for (const [index, lines] of lists.entries()) {
      const script = path.join(externalHome, `step-${index}.sh`), suites = lines.slice(1, -1).map(l => l.slice(5));
      fs.writeFileSync(script, lines.join('\n') + '\n');
      const step = (failing) => {
        fs.rmSync(log, { force: true });
        const r = spawnSync('/bin/bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], { encoding: 'utf8', timeout: 30000, env: { PATH: `${bin}:/usr/bin:/bin`, STUB_LOG: log, STUB_FAIL: failing.map(s => s.split(' ')[0]).join(' ') } });
        assert.deepEqual(fs.readFileSync(log, 'utf8').trimEnd().split('\n'), suites, 'every suite ran, in order');
        return r;
      };
      assert.equal(step([]).status, 0);
      const failing = [suites[1], suites.at(-2)], r = step(failing);
      assert.equal(r.status, 1, 'a failure in the middle fails the step even though the last suite passed');
      for (const suite of failing) assert(r.stdout.includes(`::error::Suite failed: node ${suite}`), `the failing suite is named: ${suite}`);
      assert.equal(r.stdout.match(/::error::/g).length, 2);
    }
  });

  if (failures.length) { console.error(`FAILED: ${failures.length} check(s): ${failures.join('; ')}`); process.exitCode = 1; }
  else console.log('PASS: progress, strict options, full captured failures, original-result retention, storage precheck and recheck, failed-save recovery, three-part outcome, verified checkout identity, and a CI run that shows every failing suite');
} finally {
  for(const owned of [root,externalHome,repo]) fs.rmSync(owned,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
