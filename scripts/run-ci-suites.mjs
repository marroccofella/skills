#!/usr/bin/env node
// Runs every `node <suite>` command the self-test workflow runs, in order, on this machine, and prints one
// line per suite with its exit code and time. For reviewers who want the offline CI locally (MOMM 1.17
// reviewer pack, section 3). It runs only repository test files named in the workflow; it contacts no
// provider, installs nothing and changes nothing outside the temporary folders the suites create.
//   node scripts/run-ci-suites.mjs            run all
//   node scripts/run-ci-suites.mjs --list     print the commands only
//   node scripts/run-ci-suites.mjs --grep ledger   run the suites whose path contains "ledger"
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/self-test.yml'), 'utf8');
const commands = [...new Set([...workflow.matchAll(/node ((?:momm\/scripts|scripts)\/[A-Za-z0-9_./-]+\.mjs)([^\n"]*)/g)]
  .map((m) => [m[1], ...m[2].trim().split(/\s+/).filter(Boolean)].join(' ')))];
const args = process.argv.slice(2), grep = args.includes('--grep') ? args[args.indexOf('--grep') + 1] : null;
const save = args.includes('--save-report');
const commit = args.includes('--commit') ? args[args.indexOf('--commit') + 1] : null;
if (args.includes('--commit') && !save) {
  process.stderr.write('--commit requires --save-report; otherwise no commit-bound report is saved.\n'); process.exit(2);
}
if (save && !/^[a-f0-9]{40}$/.test(commit ?? '')) {
  process.stderr.write('--save-report requires --commit <full SHA>; this is caller-supplied identity, not automatic Git verification.\n'); process.exit(2);
}
// A filter that names nothing, or matches nothing, is an error: "0 of 0 suites passed" is not a pass.
if (args.includes('--grep') && (!grep || grep.startsWith('--'))) { process.stderr.write('--grep needs a value: part of a suite path, such as --grep ledger\n'); process.exit(2); }
const selected = commands.filter((c) => !grep || c.includes(grep));
if (!selected.length) { process.stderr.write(`no suite in .github/workflows/self-test.yml matches ${JSON.stringify(grep)}; nothing was run\n`); process.exit(1); }
if (args.includes('--list')) { process.stdout.write(selected.join('\n') + '\n'); process.exit(0); }
let reportDir = null;
const runId = randomUUID();
if (save) {
  const { preparePrivateEvidence } = await import('../momm/scripts/evidence-permissions.mjs');
  const home = path.join(root, '.ensemble_reviews');
  preparePrivateEvidence(home);
  reportDir = path.join(home, `ci-${runId}`);
  fs.mkdirSync(reportDir, { mode: 0o700 });
  preparePrivateEvidence(reportDir);
}
const report = { schema: 'momm-ci-suites/1', run_id: runId, commit,
  commit_basis: commit ? 'caller supplied; verify HEAD and clean tree separately' : 'not supplied',
  runner_sha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  workflow_sha256: createHash('sha256').update(workflow).digest('hex'),
  platform: process.platform, arch: process.arch, node: process.version,
  started_at: new Date().toISOString(), filter: grep, selected: selected.length, results: [] };
const persist = () => {
  if (!reportDir) return;
  const temporary = path.join(reportDir, `report-${randomUUID()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, path.join(reportDir, 'report.json'));
};
persist();
// Same launch guard the workflow relies on; the security suites unset it themselves where they must.
const env = { ...process.env, NO_UPDATE_CHECK: '1', MOMM_NO_UPDATE_CHECK: '1' };
delete env.NoDefaultCurrentDirectoryInExePath;
let failed = 0;
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
  if (reportDir && code !== 0) {
    entry.stdout_file = `${index + 1}.stdout.txt`; entry.stderr_file = `${index + 1}.stderr.txt`;
    fs.writeFileSync(path.join(reportDir, entry.stdout_file), r.stdout ?? '', { mode: 0o600 });
    fs.writeFileSync(path.join(reportDir, entry.stderr_file), r.stderr ?? '', { mode: 0o600 });
    entry.stdout_sha256 = createHash('sha256').update(r.stdout ?? '').digest('hex');
    entry.stderr_sha256 = createHash('sha256').update(r.stderr ?? '').digest('hex');
    entry.capture_incomplete = Boolean(r.error || r.signal);
    process.stdout.write(`      captured failure output saved${entry.capture_incomplete ? ' (suite stopped; capture may be incomplete)' : ''}: ${path.relative(root, path.join(reportDir, entry.stdout_file))} and ${path.relative(root, path.join(reportDir, entry.stderr_file))} (private; inspect before sharing)\n`);
  }
  report.results.push(entry); persist();
  process.stdout.write(`${code === 0 ? 'PASS' : 'FAIL'} ${String(code).padStart(3)} ${Math.round((Date.now() - t0) / 1000)}s ${command}\n`);
  const tail = (text, label) => { const lines = String(text ?? '').trimEnd().split('\n').filter((l) => l.trim()).slice(-8); if (lines.length) process.stdout.write(`      ${label}:\n` + lines.map((l) => '      ' + l).join('\n') + '\n'); };
  // A suite the runner itself stopped (its timer, the output buffer, a failed spawn) says which.
  if (code !== 0 && r.error) process.stdout.write(`      spawn error: ${r.error.code ?? 'unknown'} (${String(r.error.message).split('\n')[0]})\n`);
  if (code !== 0) { tail(r.stdout, 'stdout (last lines)'); tail(r.stderr, 'stderr (last lines)'); }
}
process.stdout.write(`${selected.length - failed} of ${selected.length} suites passed on ${process.platform} ${process.arch}, Node ${process.version}\n`);
report.finished_at = new Date().toISOString(); report.passed = selected.length - failed; report.failed = failed; persist();
if (reportDir) process.stdout.write(`Private original-run report: ${path.relative(root, reportDir)}/report.json\n`);
process.exitCode = failed ? 1 : 0;
