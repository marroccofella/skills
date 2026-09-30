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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/self-test.yml'), 'utf8');
const commands = [...new Set([...workflow.matchAll(/node ((?:momm\/scripts|scripts)\/[A-Za-z0-9_./-]+\.mjs)([^\n"]*)/g)]
  .map((m) => [m[1], ...m[2].trim().split(/\s+/).filter(Boolean)].join(' ')))];
const args = process.argv.slice(2), grep = args.includes('--grep') ? args[args.indexOf('--grep') + 1] : null;
// A filter that names nothing, or matches nothing, is an error: "0 of 0 suites passed" is not a pass.
if (args.includes('--grep') && (!grep || grep.startsWith('--'))) { process.stderr.write('--grep needs a value: part of a suite path, such as --grep ledger\n'); process.exit(2); }
const selected = commands.filter((c) => !grep || c.includes(grep));
if (!selected.length) { process.stderr.write(`no suite in .github/workflows/self-test.yml matches ${JSON.stringify(grep)}; nothing was run\n`); process.exit(1); }
if (args.includes('--list')) { process.stdout.write(selected.join('\n') + '\n'); process.exit(0); }
// Same launch guard the workflow relies on; the security suites unset it themselves where they must.
const env = { ...process.env, NO_UPDATE_CHECK: '1', MOMM_NO_UPDATE_CHECK: '1' };
delete env.NoDefaultCurrentDirectoryInExePath;
let failed = 0;
for (const command of selected) {
  const [file, ...rest] = command.split(' ');
  const t0 = Date.now();
  // Both streams are kept (many suites print their assertion failures on stdout) and only a tail of each is
  // shown on failure; the buffer is large so a chatty suite is never killed for its output.
  const r = spawnSync(process.execPath, [path.join(root, file), ...rest], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 15 * 60_000, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  const code = r.status ?? (r.signal ? `signal ${r.signal}` : 'error');
  if (code !== 0) failed++;
  process.stdout.write(`${code === 0 ? 'PASS' : 'FAIL'} ${String(code).padStart(3)} ${Math.round((Date.now() - t0) / 1000)}s ${command}\n`);
  const tail = (text, label) => { const lines = String(text ?? '').trimEnd().split('\n').filter((l) => l.trim()).slice(-8); if (lines.length) process.stdout.write(`      ${label}:\n` + lines.map((l) => '      ' + l).join('\n') + '\n'); };
  // A suite the runner itself stopped (its timer, the output buffer, a failed spawn) says which.
  if (code !== 0 && r.error) process.stdout.write(`      spawn error: ${r.error.code ?? 'unknown'} (${String(r.error.message).split('\n')[0]})\n`);
  if (code !== 0) { tail(r.stdout, 'stdout (last lines)'); tail(r.stderr, 'stderr (last lines)'); }
}
process.stdout.write(`${selected.length - failed} of ${selected.length} suites passed on ${process.platform} ${process.arch}, Node ${process.version}\n`);
process.exitCode = failed ? 1 : 0;
