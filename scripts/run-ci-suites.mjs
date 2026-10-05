#!/usr/bin/env node
// Runs every `node <suite>` command the self-test workflow runs, in order, on this machine, and prints one
// line per suite with its exit code and time. For reviewers who want the offline CI locally (MOMM 1.17
// reviewer pack, section 3). It runs only repository test files named in the workflow; it contacts no
// provider, installs nothing and changes nothing outside the temporary folders the suites create.
//   node scripts/run-ci-suites.mjs            run all
//   node scripts/run-ci-suites.mjs --list     print the commands only
//   node scripts/run-ci-suites.mjs --grep ledger   run the suites whose path contains "ledger"
//   node scripts/run-ci-suites.mjs --save-report --commit <full SHA>   also keep a private report of the run
//                                             (in MOMM's evidence folder; --evidence-home <dir> or
//                                             MOMM_EVIDENCE_HOME places it outside the checkout)
//   node scripts/run-ci-suites.mjs --recover-report <run folder> --to <private dir>
//                                             complete a report whose final save failed; runs no suite
// Anything else on the command line is refused and nothing runs. A run ends with three lines, one fact
// each: suites passed, whether the report was saved, and the exit status.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/self-test.yml'), 'utf8');
const commands = [...new Set([...workflow.matchAll(/node ((?:momm\/scripts|scripts)\/[A-Za-z0-9_./-]+\.mjs)([^\n"]*)/g)]
  .map((m) => [m[1], ...m[2].trim().split(/\s+/).filter(Boolean)].join(' ')))];
// Strict options (1.17.1 R6): `--grpe --list` used to list every suite and exit 0, and `--grpe` alone
// ran them all. true marks an option that takes a value.
const OPTIONS = { '--list': false, '--grep': true, '--save-report': false, '--commit': true, '--evidence-home': true, '--recover-report': true, '--to': true };
const usage = (message) => {
  process.stderr.write(`${message} Nothing was run.\nOptions: --list | --grep <part of a suite path> | --save-report --commit <full SHA> [--evidence-home <dir>] | --recover-report <run folder> --to <private dir>\n`);
  process.exit(2);
};
const printable = (text) => String(text).replace(/[^\x20-\x7e]/g, '?').slice(0, 80);
const distance = (a, b) => {
  const row = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const above = row[j]; row[j] = Math.min(above + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)); diagonal = above; }
  }
  return row[b.length];
};
// An option typed short (--recover) is nearer to the one it begins than to any other spelling.
const nearest = (typed) => Object.keys(OPTIONS).map((name) => [name.startsWith(typed) ? 0 : distance(typed, name), name]).sort((x, y) => x[0] - y[0])[0][1];
const args = process.argv.slice(2), given = new Map();
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!Object.hasOwn(OPTIONS, arg)) usage(arg.startsWith('-') ? `Unknown option ${printable(arg)}. Nearest valid option: ${nearest(arg.split('=')[0])}.` : `Unexpected argument ${printable(arg)}. To run part of the list, use --grep <part of a suite path>.`);
  if (given.has(arg)) usage(`${arg} was given more than once.`);
  // A value that is itself an option is a missing value; each option says so in its own words below.
  given.set(arg, OPTIONS[arg] ? (args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : null) : true);
}
const grep = given.get('--grep') ?? null;
const save = given.has('--save-report');
const commit = given.get('--commit') ?? null;
// Paths are shown relative to where the command was typed when they lie inside it, so they can be typed back.
const shown = (target) => { const relative = path.relative(process.cwd(), target); return !relative || relative.startsWith('..') || path.isAbsolute(relative) ? target : relative; };
const reasonOf = (error) => (error?.reason ? `not verified private: ${error.reason}` : error?.syscall ? `${error.code} on ${error.syscall}` : String(error?.message ?? error).split('\n')[0].slice(0, 300));
if (given.has('--recover-report') || given.has('--to')) {
  const others = [...given.keys()].filter((name) => name !== '--recover-report' && name !== '--to');
  if (others.length) usage(`--recover-report takes only --to; ${others.join(' and ')} cannot be combined with it.`);
  if (!given.get('--recover-report') || !given.get('--to')) usage('Recovery needs both: --recover-report <run folder> --to <private dir>.');
  await recoverReport(path.resolve(given.get('--recover-report')), path.resolve(given.get('--to')));
}
if (given.has('--commit') && !save) {
  process.stderr.write('--commit requires --save-report; otherwise no commit-bound report is saved.\n'); process.exit(2);
}
if (save && !/^[a-f0-9]{40}$/.test(commit ?? '')) {
  process.stderr.write('--save-report requires --commit <full SHA>; this is caller-supplied identity, not automatic Git verification.\n'); process.exit(2);
}
// The option the evidence refusals name (1.17.1 R7). As in multi-review.mjs it is applied to the
// environment, so every module in this run resolves the same evidence home. The suites are started
// without it (see the environment they are given below).
if (given.has('--evidence-home')) {
  if (!save) usage('--evidence-home is only used with --save-report.');
  if (!given.get('--evidence-home')) usage('--evidence-home needs a directory: --evidence-home <dir>.');
  process.env.MOMM_EVIDENCE_HOME = path.resolve(given.get('--evidence-home'));
}
// A filter that names nothing, or matches nothing, is an error: "0 of 0 suites passed" is not a pass.
if (given.has('--grep') && !grep) { process.stderr.write('--grep needs a value: part of a suite path, such as --grep ledger\n'); process.exit(2); }
const selected = commands.filter((c) => !grep || c.includes(grep));
if (!selected.length) { process.stderr.write(`no suite in .github/workflows/self-test.yml matches ${JSON.stringify(grep)}; nothing was run\n`); process.exit(1); }
if (given.has('--list')) { process.stdout.write(selected.join('\n') + '\n'); process.exit(0); }
let reportDir = null, checkout = null, recheck = () => {}, evidenceRefusal = () => null;
const runId = randomUUID();
// What a storage failure says, in one line: the library's own sentence for a refused evidence location or
// folder (1.17.1 R7), or the call that failed for a file-system error. null means the error is neither;
// a defect is rethrown, never dressed as a refusal.
const storageFailure = (error) => evidenceRefusal(error) ?? (error?.syscall ? `the report folder could not be written (${error.code} on ${error.syscall}).` : null);
// A save that was refused after its rename was retried says so, wherever in the run it failed.
const retriedNote = (error) => (error?.retried ? ` The rename was retried ${error.retried === 1 ? 'once' : `${error.retried} times`}.` : '');
// Storage precheck (1.17.1 R3): private permissions here, write access just below, both before the first
// RUN line. A refusal is one plain line, not a stack trace.
const storageRefused = (error) => {
  const failure = storageFailure(error);
  if (!failure) throw error;
  process.stderr.write(`Report storage refused before any suite ran: ${failure}${retriedNote(error)}${reportDir ? ` An unused run folder may remain: ${shown(reportDir)}` : ''}\n`);
  process.exit(1);
};
if (save) {
  const { evidenceLocation, recordEvidenceProject, evidenceRefusal: refusalOf } = await import('../momm/scripts/evidence-location.mjs');
  evidenceRefusal = refusalOf;
  try {
    const { preparePrivateEvidence, requirePrivateEvidence } = await import('../momm/scripts/evidence-permissions.mjs');
    // The resolver every MOMM command uses: the project's .ensemble_reviews, or the evidence home.
    const location = evidenceLocation({ cwd: root });
    const home = location.dir;
    preparePrivateEvidence(home);
    recordEvidenceProject(location);
    reportDir = path.join(home, `ci-${runId}`);
    fs.mkdirSync(reportDir, { mode: 0o700 });
    preparePrivateEvidence(reportDir);
    recheck = () => requirePrivateEvidence(reportDir);
    checkout = readCheckout(await import('../momm/scripts/process-scope.mjs'));
  } catch (error) { storageRefused(error); }
}
const report = { schema: 'momm-ci-suites/1', run_id: runId, commit,
  commit_basis: commit ? 'caller supplied label; checkout.head is what Git reported for this checkout' : 'not supplied',
  checkout, label_matches_head: checkout?.head ? checkout.head === commit : null,
  runner_sha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  workflow_sha256: createHash('sha256').update(workflow).digest('hex'),
  platform: process.platform, arch: process.arch, node: process.version,
  started_at: new Date().toISOString(), filter: grep, selected: selected.length, results: [] };
let stored = -1; // how many suite results report.json holds; -1 until it has been written once
// A rename refused with one of these is often a file held for a moment by a sync client or a scanner
// (EPERM on the final rename of report.json in a OneDrive-synced checkout, 4 October 2026).
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const pause = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
// Returns how many retries the rename needed. Only the rename is repeated, on the text already written.
// Every save gets the same three more tries, a quarter of a second apart: the precheck, the save after
// each suite and the final one. With none, a brief refusal before the end refused the run or stopped it
// with suites not run (1.17.1 gate review).
const RETRIES = 3;
const persist = () => {
  if (!reportDir) return 0;
  const temporary = path.join(reportDir, `report-${randomUUID()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  for (let retried = 0; ; retried++) {
    try { fs.renameSync(temporary, path.join(reportDir, 'report.json')); stored = report.results.length; return retried; }
    catch (error) {
      if (retried < RETRIES && TRANSIENT.has(error?.code)) { pause(250); continue; }
      // A failed rename leaves the text it could not move where it was written; --recover-report reads it there.
      error.pending = temporary; error.retried = retried; throw error;
    }
  }
};
// Twice: the second save replaces the first, which is the step every later save repeats.
let saveRetries = 0; // renames retried by the saves of this run, the precheck's included
try { saveRetries += persist(); saveRetries += persist(); } catch (error) { storageRefused(error); }
const checkoutLine = !checkout ? null
  : !checkout.available ? `Checkout: Git could not confirm this checkout (${checkout.reason}); HEAD and the tree state are recorded as unknown, and the --commit label is unverified.`
    : `Checkout: HEAD ${checkout.head}, ${checkout.clean === null ? 'tree state unknown' : checkout.clean ? 'clean tree' : 'tree has uncommitted or untracked changes'}; the --commit label ${checkout.head === commit ? 'matches.' : `${commit} does not match HEAD.`}`;
if (checkoutLine) process.stdout.write(checkoutLine + '\n');
// Same launch guard the workflow relies on; the security suites unset it themselves where they must.
const env = { ...process.env, NO_UPDATE_CHECK: '1', MOMM_NO_UPDATE_CHECK: '1' };
delete env.NoDefaultCurrentDirectoryInExePath;
// The evidence home is for this command's own report. A suite builds its own fixture projects and decides
// where their evidence lives; one that inherited the home looked for it there, and 23 of 97 suites failed
// on the released 1.17.1. Windows names ignore case, so every spelling of the name is removed there.
for (const name of Object.keys(env)) if ((process.platform === 'win32' ? name.toUpperCase() : name) === 'MOMM_EVIDENCE_HOME') delete env[name];
let failed = 0, saveError = null;
for (const [index, command] of selected.entries()) {
  process.stdout.write(`RUN ${index + 1}/${selected.length} ${command}\n`);
  const [file, ...rest] = command.split(' ');
  const t0 = Date.now();
  // Both streams are kept (many suites print their assertion failures on stdout) and only a tail of each is
  // shown on failure; the buffer is large so a chatty suite is never killed for its output.
  const r = spawnSync(process.execPath, [path.join(root, file), ...rest], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 15 * 60_000, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  const code = r.status ?? (r.signal ? `signal ${r.signal}` : 'error');
  if (code !== 0) failed++;
  const entry = { command, status: code === 0 ? 'passed' : 'failed', exit_code: r.status,
    signal: r.signal ?? null, spawn_error: r.error?.code ?? null,
    duration_ms: Date.now() - t0, rerun: `node ${command}` };
  // Console results must survive a later evidence-write failure. Saving still
  // fails closed: do not continue while the requested original record is lost.
  process.stdout.write(`${code === 0 ? 'PASS' : 'FAIL'} ${String(code).padStart(3)} ${Math.round((Date.now() - t0) / 1000)}s ${command}\n`);
  const tail = (text, label) => { const lines = String(text ?? '').trimEnd().split('\n').filter((l) => l.trim()).slice(-8); if (lines.length) process.stdout.write(`      ${label}:\n` + lines.map((l) => '      ' + l).join('\n') + '\n'); };
  if (code !== 0 && r.error) process.stdout.write(`      spawn error: ${r.error.code ?? 'unknown'} (${String(r.error.message).split('\n')[0]})\n`);
  if (code !== 0) { tail(r.stdout, 'stdout (last lines)'); tail(r.stderr, 'stderr (last lines)'); }
  report.results.push(entry);
  try {
    if (reportDir && code !== 0) {
      entry.stdout_file = `${index + 1}.stdout.txt`; entry.stderr_file = `${index + 1}.stderr.txt`;
      fs.writeFileSync(path.join(reportDir, entry.stdout_file), r.stdout ?? '', { mode: 0o600 });
      fs.writeFileSync(path.join(reportDir, entry.stderr_file), r.stderr ?? '', { mode: 0o600 });
      entry.stdout_sha256 = createHash('sha256').update(r.stdout ?? '').digest('hex');
      entry.stderr_sha256 = createHash('sha256').update(r.stderr ?? '').digest('hex');
      entry.capture_incomplete = Boolean(r.error || r.signal);
      process.stdout.write(`      captured failure output saved${entry.capture_incomplete ? ' (suite stopped; capture may be incomplete)' : ''}: ${path.relative(root, path.join(reportDir, entry.stdout_file))} and ${path.relative(root, path.join(reportDir, entry.stderr_file))} (private; inspect before sharing)\n`);
    }
    saveRetries += persist();
  } catch (error) { if (!storageFailure(error)) throw error; saveError = error; break; }
}
const ran = report.results.length;
let countUnwritten = null; // why the file does not hold the count the outcome line gives, when it does not
if (!saveError) {
  report.finished_at = new Date().toISOString(); report.passed = selected.length - failed; report.failed = failed;
  // What the earlier saves of this run needed; the final save's own retries are added below.
  report.save_retries = saveRetries;
  try {
    if (reportDir) {
      // Checked again when saving (1.17.1 R3): storage that stopped being private is not written to again.
      recheck();
      // The final rename gets the same three more tries before the save is called failed.
      let last = persist();
      // The report is saved. A save cannot state its own retries, so those of this last save are written
      // into the file with one more save, and that save's with another, until one needs none (closing review
      // of 1.17.1: the retries of the save that wrote the count were dropped). RETRIES more saves at most.
      // If one fails, or the last of them was itself retried, the file still holds an earlier count, and
      // the outcome line gives the count and says it is not in the file.
      for (let more = 0; last; more++) {
        saveRetries += last; report.save_retries = saveRetries;
        if (more === RETRIES) { countUnwritten = 'each save of the count was retried too'; break; }
        try { last = persist(); } catch (error) { if (!storageFailure(error)) throw error; countUnwritten = 'writing the count failed'; break; }
      }
    }
  } catch (error) { if (!storageFailure(error)) throw error; saveError = error; }
}
// Failed-save recovery (1.17.1 R4). Beyond the retried rename the attempt is left exactly as it is: no
// repair, nothing removed. The lines below say where the results are and how to complete the record
// somewhere else.
const afterRetries = !saveRetries ? '' : `after ${saveRetries} ${saveRetries === 1 ? 'retry' : 'retries'}${countUnwritten ? `, not recorded in the file: ${countUnwritten}` : ''}; `;
let reportSaved = !reportDir ? 'not requested (add --save-report --commit <full SHA> to keep a private report)'
  : `yes, ${shown(path.join(reportDir, 'report.json'))} (${afterRetries}private; inspect before sharing)`;
if (saveError) {
  // A rename that failed after the last suite left every result in the file it could not move.
  const complete = saveError.pending && ran === selected.length ? saveError.pending : null;
  const kept = fs.existsSync(path.join(reportDir, 'report.json')) && stored >= 0;
  process.stdout.write(`The report could not be saved (${reasonOf(saveError)}).${retriedNote(saveError)} The run folder was left as it is: nothing was repaired or removed.\n`);
  if (evidenceRefusal(saveError)) process.stdout.write(evidenceRefusal(saveError) + '\n');
  if (ran < selected.length) process.stdout.write(`The run stopped after suite ${ran} of ${selected.length}; the other ${selected.length - ran} were not run.\n`);
  if (complete) process.stdout.write(`Complete results: ${shown(complete)}\n`);
  else if (kept) process.stdout.write(`Saved so far: report.json in the run folder holds the results of ${stored} of ${selected.length} suites${stored === selected.length ? ', without the totals and the finish time' : ''}.\n`);
  else process.stdout.write('No saved copy remains; the results are the lines above.\n');
  process.stdout.write(`Run folder: ${shown(reportDir)}\n`);
  if (complete || (kept && stored === selected.length)) process.stdout.write('To complete the record without rerunning any suite, name a private folder outside the run folder:\n  node scripts/run-ci-suites.mjs --recover-report <run folder> --to <private dir>\n');
  reportSaved = `no (${reasonOf(saveError)}); ${complete ? `complete results: ${shown(complete)}` : kept ? `${stored} of ${selected.length} suite results are in ${shown(path.join(reportDir, 'report.json'))}` : 'no saved copy remains'}`;
}
const exitStatus = failed || saveError ? 1 : 0;
if (checkoutLine) process.stdout.write(checkoutLine + '\n');
// The outcome, one fact a line (1.17.1 R5). The first is the line reviewers and the test plan already quote.
process.stdout.write(`${ran - failed} of ${selected.length} suites passed on ${process.platform} ${process.arch}, Node ${process.version}\n`);
process.stdout.write(`Report saved: ${reportSaved}\n`);
process.stdout.write(`Exit status: ${exitStatus}\n`);
process.exitCode = exitStatus;

// Verified checkout identity (1.17.1 R9). --commit is a label the caller typed; this is what Git says the
// checkout is. Git is resolved the way reviews resolve it (process-scope.mjs: an absolute PATH entry outside
// this checkout, never a file the checkout supplies), is asked about this folder whatever GIT_DIR says,
// and takes no optional lock. When it cannot answer, the report says so; nothing is inferred from the label.
function readCheckout(scope) {
  const unknown = (reason) => ({ source: 'git', available: false, reason, head: null, clean: null });
  const base = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
  const where = { cwd: root, project: root };
  const gitEnv = (process.platform === 'win32' ? scope.windowsChildEnv : scope.posixChildEnv)({ ...base, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, where);
  let tool;
  try { tool = scope.windowsTool('git', { ...where, env: gitEnv }); } catch { return unknown('git_not_found'); }
  const git = (...rest) => spawnSync(tool, ['-c', 'core.fsmonitor=false', ...rest], { cwd: root, env: gitEnv, encoding: 'utf8', timeout: 30_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  // An empty prefix means this folder is the top of a work tree, not a folder inside someone else's.
  const top = git('rev-parse', '--show-prefix');
  if (top.error?.code === 'ENOENT') return unknown('git_not_found');
  if (top.status !== 0 || top.stdout.trim() !== '') return unknown('not_a_git_checkout');
  const head = git('rev-parse', '--verify', 'HEAD^{commit}'), sha = String(head.stdout ?? '').trim();
  if (head.status !== 0 || !/^[a-f0-9]{40,64}$/.test(sha)) return unknown('head_unreadable');
  const status = git('status', '--porcelain', '--untracked-files=normal');
  return { source: 'git', available: true, head: sha, clean: status.status === 0 ? status.stdout.trim() === '' : null };
}

// Failed-save recovery, the other half (1.17.1 R4). In the case this was written for, the synced files
// then carried reparse-point attributes, and the permission audit refused that evidence folder from then
// on (linked_entry). So the run folder is only read, as plain files and without that audit, and nothing
// in it is written, renamed or removed. One new file goes into a private folder the user names.
async function recoverReport(source, target) {
  const refuse = (message) => { process.stderr.write(`Recovery refused: ${message} No report was written and no suite was run.\n`); process.exit(1); };
  let names;
  try { if (!fs.statSync(source).isDirectory()) throw new Error('not a directory'); names = fs.readdirSync(source); }
  catch { refuse(`${shown(source)} is not a readable run folder.`); }
  // A run id is what randomUUID() gives, not any 36 hex digits and hyphens; and the runner never saves a
  // run of no suites ("0 of 0 suites passed" is not a pass), so a report of one is not this runner's.
  const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', isRunId = new RegExp(`^${uuid}$`), leftover = new RegExp(`^report-${uuid}\\.tmp$`);
  const read = (name) => {
    try {
      const file = path.join(source, name), st = fs.lstatSync(file);
      if (!st.isFile() || st.isSymbolicLink() || st.size > 64 * 1024 * 1024) return null;
      const bytes = fs.readFileSync(file), value = JSON.parse(bytes.toString('utf8'));
      const sound = value?.schema === 'momm-ci-suites/1' && typeof value.run_id === 'string' && isRunId.test(value.run_id) && Number.isInteger(value.selected) && value.selected > 0
        && Array.isArray(value.results) && value.results.every((entry) => entry?.status === 'passed' || entry?.status === 'failed');
      return sound ? { name, bytes, value } : null;
    } catch { return null; }
  };
  // report.json first, then anything a failed rename left behind; a file that is not a whole report is skipped.
  const found = ['report.json', ...names.filter((name) => leftover.test(name)).sort()].map(read).filter(Boolean);
  if (!found.length) refuse(`${shown(source)} holds no readable run report.`);
  if (new Set(found.map((entry) => entry.value.run_id)).size > 1) refuse(`${shown(source)} holds reports of more than one run.`);
  const whole = found.filter((entry) => entry.value.results.length === entry.value.selected);
  const chosen = whole.find((entry) => typeof entry.value.finished_at === 'string') ?? whole[0];
  if (!chosen) refuse(`that run did not finish: the fullest saved report has results for ${Math.max(...found.map((entry) => entry.value.results.length))} of ${found[0].value.selected} suites.`);
  const passed = chosen.value.results.filter((entry) => entry.status === 'passed').length, failed = chosen.value.results.length - passed;
  const recorded = Number.isInteger(chosen.value.passed) && Number.isInteger(chosen.value.failed);
  if (recorded && (chosen.value.passed !== passed || chosen.value.failed !== failed)) refuse(`${chosen.name} states totals that its own results do not add up to.`);
  // The deepest existing folder is resolved, so a link cannot place the new file inside the run folder.
  const resolved = (folder) => {
    const tail = [];
    for (let cursor = folder; ;) {
      try { return path.join(fs.realpathSync.native(cursor), ...tail); }
      catch { const parent = path.dirname(cursor); if (parent === cursor) return folder; tail.unshift(path.basename(cursor)); cursor = parent; }
    }
  };
  // Case is folded where the platform's volumes fold it: Windows, and macOS, where a volume may keep case
  // apart and refusing is then the safe side. Elsewhere two names that differ only in case are two folders,
  // and folding them refused a destination that was outside the run folder (1.17.1 gate review).
  const fold = (text) => (process.platform === 'win32' || process.platform === 'darwin' ? text.toLowerCase() : text);
  const inside = (base, candidate) => { const relative = path.relative(fold(base), fold(candidate)); return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); };
  // What the file system says a folder is. It sees through a spelling the text cannot: a volume that ignores
  // case where the platform does not, or a second name for the same place. It can only refuse more.
  const identity = (folder) => { try { const st = fs.statSync(folder, { bigint: true }); return st.ino ? `${st.dev}:${st.ino}` : null; } catch { return null; } };
  const run = identity(source);
  const within = (folder) => {
    if ([folder, resolved(folder)].some((candidate) => inside(source, candidate) || inside(resolved(source), candidate))) return true;
    for (let cursor = folder; run; cursor = path.dirname(cursor)) { if (identity(cursor) === run) return true; if (path.dirname(cursor) === cursor) break; }
    return false;
  };
  const outside = '--to must be outside the run folder; the original attempt is never changed.';
  if (within(target)) refuse(outside);
  const expected = resolved(target);
  const { evidenceRefusal: refusalOf } = await import('../momm/scripts/evidence-location.mjs');
  const permissions = await import('../momm/scripts/evidence-permissions.mjs');
  const unusable = (error) => { if (!refusalOf(error) && !error?.syscall) throw error; refuse(`the folder named with --to is ${error?.reason ? `not verified private (${error.reason})` : `not usable (${reasonOf(error)})`}. Name a new folder, which is created private, or one only your account can open.`); };
  // Checked again where the file will go (1.17.1 gate review). The first check ran before the folder
  // existed and the file was then written through the name as typed, so a link put in that name's place
  // in between was followed. The folder's real path is now taken once it exists: it must be outside the
  // run folder, it must be the folder that was verified private (or is verified again, as it now is),
  // and the file is written to that real path, not to the name.
  let real;
  try { permissions.preparePrivateEvidence(target); real = fs.realpathSync.native(target); } catch (error) { unusable(error); }
  if (within(real)) refuse(outside);
  if (real !== expected) { try { permissions.requirePrivateEvidence(real); } catch (error) { unusable(error); } }
  const file = path.join(real, `ci-${chosen.value.run_id}-recovered.json`);
  // A file its save never moved into place states no retry count of that save.
  const body = JSON.stringify({ ...chosen.value, ...(chosen.name !== 'report.json' && 'save_retries' in chosen.value ? { save_retries: null } : {}), passed, failed, recovery: { schema: 'momm-ci-recovery/1', recovered_at: new Date().toISOString(),
    source_folder: source, source_file: chosen.name, source_sha256: createHash('sha256').update(chosen.bytes).digest('hex'),
    totals: recorded ? 'recorded by the run' : 'derived from the saved results', suites_rerun: false } }, null, 2) + '\n';
  // Written once, never over an existing file, and without the rename that failed in the original folder.
  try { fs.writeFileSync(file, body, { mode: 0o600, flag: 'wx' }); }
  catch (error) { refuse(error?.code === 'EEXIST' ? `${shown(file)} already exists; it was left as it is.` : `${shown(file)} could not be written (${reasonOf(error)}).`); }
  process.stdout.write(`Recovered report: ${shown(file)}\n${passed} of ${chosen.value.selected} suites passed in the recovered run (${recorded ? 'totals recorded by the run' : 'totals derived from the saved results; the finish time was not saved'}).\nSource: ${chosen.name} in ${shown(source)}, read only. The run folder was not changed and no suite was rerun.\n`);
  process.exit(0);
}
