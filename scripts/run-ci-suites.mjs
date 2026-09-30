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
const selected = commands.filter((c) => !grep || c.includes(grep));
if (args.includes('--list')) { process.stdout.write(selected.join('\n') + '\n'); process.exit(0); }
// Same launch guard the workflow relies on; the security suites unset it themselves where they must.
const env = { ...process.env, NO_UPDATE_CHECK: '1', MOMM_NO_UPDATE_CHECK: '1' };
delete env.NoDefaultCurrentDirectoryInExePath;
let failed = 0;
for (const command of selected) {
  const [file, ...rest] = command.split(' ');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(root, file), ...rest], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 15 * 60_000, windowsHide: true });
  const code = r.status ?? (r.signal ? `signal ${r.signal}` : 'error');
  if (code !== 0) failed++;
  process.stdout.write(`${code === 0 ? 'PASS' : 'FAIL'} ${String(code).padStart(3)} ${Math.round((Date.now() - t0) / 1000)}s ${command}\n`);
  if (code !== 0 && r.stderr) process.stdout.write(r.stderr.split('\n').slice(-8).map((l) => '      ' + l).join('\n') + '\n');
}
process.stdout.write(`${selected.length - failed} of ${selected.length} suites passed on ${process.platform} ${process.arch}, Node ${process.version}\n`);
process.exitCode = failed ? 1 : 0;
