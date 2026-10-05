// Found on the released 1.17.1: a tester had MOMM_EVIDENCE_HOME set, as the documentation invites, and 23
// of the 97 commands of the suite pack failed. A suite builds fixture projects with their own
// .ensemble_reviews; a suite that inherited the variable had the product look for that evidence under the
// tester's home instead, and some suites wrote their fixtures' evidence into that home.
// Three things now prevent it: scripts/run-ci-suites.mjs starts suites without the variable, every suite
// drops it in its first statement after the imports, and scripts/source-hygiene.test.mjs requires that
// statement by its text. None of the three shows the statement working: a run through the runner never
// hands a suite the variable, and the text check reads the line without running it. So this suite starts
// a few suites the way a person does, `node <suite>`, with MOMM_EVIDENCE_HOME naming a new empty folder
// outside the checkout, and holds each to two things: it passes, and the folder is as it was handed over:
// still there, the same folder, never added to, and empty. A folder that is gone was used as much as one
// that was filled. Each is first started without the variable (the control), so a failure with it is the
// variable's doing.
// Zero provider calls, zero network.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realTempDir } from './private-test-fixture.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Six suites that failed on the released 1.17.1 when started this way. Each takes a few seconds at most,
// and each reaches the evidence resolver by a different road. The first three do not import the
// test-support module (private-test-fixture.mjs): their own first statement is all that is exercised.
const CHILDREN = [
  'momm/scripts/scorecard-roster.test.mjs', // the scorecard, read from a fixture's reports, decisions and checks
  'scripts/ledger-serving.test.mjs', // the Setup Center serving a fixture's ledger, inside the suite's own process
  'momm/scripts/probes.test.mjs', // probe records; on 1.17.1 it also wrote them into the caller's home
  'momm/scripts/cover.test.mjs', // cover votes recounted from a fixture's evidence by the completion check
  'momm/scripts/quotation-diagnostics.test.mjs', // the private attempt record of a refused answer
  'scripts/ledger-media.test.mjs', // ledger.mjs started in a fixture project that holds media evidence
];
const CHILD_LIMIT_MS = 120_000;
// The environment the runner and the workflow give a suite: no evidence home under any spelling (Windows
// names ignore case), no update check, and no launch-guard variable from this process. The runs with a
// home differ from the control in that one variable and in nothing else.
const plain = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'MOMM_EVIDENCE_HOME'));
Object.assign(plain, { NO_UPDATE_CHECK: '1', MOMM_NO_UPDATE_CHECK: '1' });
delete plain.NoDefaultCurrentDirectoryInExePath;
const start = (args, env) => {
  const began = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: CHILD_LIMIT_MS, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { exit: r.status, ended: r.status !== null ? `exit ${r.status}` : (r.error?.code === 'ETIMEDOUT' ? `no exit within ${CHILD_LIMIT_MS / 1000} s` : r.signal ? `signal ${r.signal}` : `spawn error ${r.error?.code ?? 'unknown'}`),
    ms: Date.now() - began, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
};
// What a failed child said last goes to stderr, so the reason is in this suite's own output on a hosted runner.
const said = (label, run) => {
  for (const stream of ['stdout', 'stderr']) {
    const lines = run[stream].split(/\r?\n/).filter((line) => line.trim()).slice(-25).map((line) => '    ' + line.slice(0, 300));
    if (lines.length) console.error(`${label}, ${stream} (last lines):\n${lines.join('\n')}`);
  }
};
// Everything under a folder, as relative names; a link is named, never followed.
const listing = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
  .flatMap((entry) => (entry.isDirectory() ? [`${prefix}${entry.name}/`, ...listing(path.join(dir, entry.name), `${prefix}${entry.name}/`)] : [prefix + entry.name]));
const inside = (base, target) => { const relative = path.relative(base, target); return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); };
// A new empty folder under its real name (a hosted temp folder is spelled two ways), removed whatever happens.
// Its modification time is first set to a date long past. A file system moves that time when an entry is
// added to a folder or removed from it, so a child that wrote there and tidied up afterwards is seen too,
// however coarse the file system's clock is. The body is given the folder and what it looked like then.
const LONG_PAST = new Date('2001-01-01T00:00:00Z');
const withHome = (body) => {
  const home = realTempDir('momm-evidence-home-isolation-');
  try { fs.utimesSync(home, new Date(), LONG_PAST); return body(home, fs.lstatSync(home, { bigint: true })); }
  finally { fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
};
// What was done to an evidence home since it was handed over, one phrase each; none when it is the same
// folder, never added to, and empty. Reading it leaves no mark and is not seen here.
const usedHome = (home, before) => {
  let now;
  try { now = fs.lstatSync(home, { bigint: true }); } catch (error) { return [`removed the caller's evidence home (${error?.code ?? 'no error code'})`]; }
  if (!now.isDirectory() || now.dev !== before.dev || now.ino !== before.ino) return ['replaced the caller\'s evidence home with another entry of that name'];
  const left = listing(home);
  if (left.length) return [`left ${left.length} ${left.length === 1 ? 'entry' : 'entries'} in the caller's evidence home: ${left.slice(0, 12).join(', ')}${left.length > 12 ? ', ...' : ''}`];
  return now.mtimeNs === before.mtimeNs ? [] : ['wrote to the caller\'s evidence home and left it empty (the folder\'s modification time moved: an entry was added and removed, or the folder was removed and made again)'];
};
const results = [];
const check = (name, body) => {
  const result = { name, passed: false };
  try { body(result); result.passed = true; } catch (error) { result.error = String(error?.message ?? error).slice(0, 1500); }
  results.push(result);
};

// The harness itself: if a child did not receive the home, every check below would pass and show nothing.
check('a child started here sees the evidence home it is given, and the control sees none', () => withHome((home) => {
  assert(!inside(fs.realpathSync.native(root), home), 'the evidence home must lie outside the checkout: the temp folder is inside it');
  const seen = (env) => { const r = start(['-e', 'process.stdout.write(JSON.stringify(process.env.MOMM_EVIDENCE_HOME ?? null))'], env); assert.equal(r.exit, 0, r.stderr); return JSON.parse(r.stdout); };
  assert.equal(seen(plain), null, 'the control is started without the variable');
  assert.equal(seen({ ...plain, MOMM_EVIDENCE_HOME: home }), home, 'the other run is started with it');
  assert.equal(process.env.MOMM_EVIDENCE_HOME, undefined, 'this suite dropped its own caller\'s evidence home');
}));
// The other half of the harness: what it calls a used evidence home. Review rev_20261005085544_5f04d7ebefc8
// (deleted-evidence-home-passes): a folder that was gone counted as left empty, so a child that removed the
// home it was given, or wrote there and tidied up, passed. Stand-in children do each of those things here.
const STAND_INS = [
  ['leaves it alone', '', null],
  ['only reads it', 'fs.readdirSync(process.env.MOMM_EVIDENCE_HOME);', null],
  ['leaves an entry in it', 'fs.writeFileSync(path.join(process.env.MOMM_EVIDENCE_HOME, "left.json"), "{}");', /^left 1 entry in the caller's evidence home: left\.json$/],
  ['removes it', 'fs.rmSync(process.env.MOMM_EVIDENCE_HOME, { recursive: true });', /^removed the caller's evidence home/],
  ['removes it and makes it again', 'fs.rmSync(process.env.MOMM_EVIDENCE_HOME, { recursive: true }); fs.mkdirSync(process.env.MOMM_EVIDENCE_HOME);', /^(?:replaced|wrote to) the caller's evidence home/],
  ['puts a file in its place', 'fs.rmSync(process.env.MOMM_EVIDENCE_HOME, { recursive: true }); fs.writeFileSync(process.env.MOMM_EVIDENCE_HOME, "");', /^replaced the caller's evidence home/],
  ['writes a folder there and removes it', 'const made = path.join(process.env.MOMM_EVIDENCE_HOME, "made"); fs.mkdirSync(made); fs.rmdirSync(made);', /^wrote to the caller's evidence home and left it empty/],
  ['writes a file there and removes it', 'const made = path.join(process.env.MOMM_EVIDENCE_HOME, "made.json"); fs.writeFileSync(made, "{}"); fs.unlinkSync(made);', /^wrote to the caller's evidence home and left it empty/],
];
check('a child that removes, replaces, fills or writes to the evidence home it is given is reported; one that leaves it alone is not', () => {
  for (const [does, code, reported] of STAND_INS) withHome((home, before) => {
    const r = start(['-e', `const fs = require('node:fs'), path = require('node:path'); ${code}`], { ...plain, MOMM_EVIDENCE_HOME: home });
    assert.equal(r.exit, 0, `the stand-in child that ${does} did not run: ${r.ended} ${r.stderr.slice(0, 300)}`);
    const used = usedHome(home, before);
    if (reported === null) assert.deepEqual(used, [], `a child that ${does} is not reported`);
    else assert(used.length === 1 && reported.test(used[0]), `a child that ${does} must be reported as that; got ${JSON.stringify(used)}`);
  });
});

// One at a time: several of these suites time their own children, and a hosted runner has few cores.
for (const suite of CHILDREN) {
  check(suite, (result) => withHome((home, before) => {
    const control = start([path.join(root, suite)], plain);
    const homed = start([path.join(root, suite)], { ...plain, MOMM_EVIDENCE_HOME: home });
    const used = usedHome(home, before);
    Object.assign(result, { without_evidence_home: { exit: control.exit, ms: control.ms }, with_evidence_home: { exit: homed.exit, ms: homed.ms, evidence_home: used.length ? used.join('; ') : 'as handed over: the same folder, never added to, empty' } });
    const problems = [];
    if (control.exit !== 0) { said(`${suite} without MOMM_EVIDENCE_HOME`, control); problems.push(`${suite} fails without MOMM_EVIDENCE_HOME (${control.ended}), so its run with the variable shows nothing about the variable.`); }
    if (homed.exit !== 0) { said(`${suite} with MOMM_EVIDENCE_HOME set`, homed); problems.push(`${suite} ${control.exit === 0 ? 'passes on its own but fails' : 'fails'} when started with MOMM_EVIDENCE_HOME set (${homed.ended}): a suite drops the caller's evidence home in its first statement after the imports.`); }
    for (const what of used) problems.push(`${suite} ${what}.`);
    assert(!problems.length, problems.join(' '));
  }));
}

const failed = results.filter((result) => !result.passed);
console.log(JSON.stringify({ passed: failed.length === 0, children: CHILDREN.length, results }, null, 2));
if (failed.length) { console.error(`FAILED: ${failed.length} check(s): ${failed.map((result) => result.name).join('; ')}`); process.exitCode = 1; }
