import './launch-guard.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createProcessScope, desktopTool, pathEntryOutside} from './process-scope.mjs';
import {stateDir} from './update.mjs';
import {acquireLock} from './update-clock.mjs';
import {providers} from './reviewer-providers.mjs';

const dispatcher = fileURLToPath(new URL('./multi-review.mjs', import.meta.url));
export const standardReviewers = Object.freeze(['codex', 'claude', 'copilot', 'antigravity', 'grok']);

// Older updaters and migration helpers also invoke this release's installer.
// Their transaction covers only the saved harness links.
function linksUnderRecovery(root, customDirs) {
  if (customDirs.some(dir => fs.existsSync(path.join(dir, '.momm-migration.lock')))) return true;
  try { return fs.existsSync(path.join(stateDir(root), 'transaction.json')); }
  catch { return false; } // A standalone skill directory has no Git receipt.
}

function discover(agents) {
  const result = spawnSync(process.execPath, [dispatcher, '--preflight', '--governor', 'other', '--reviewers', agents.join(',')], {
    encoding: 'utf8', windowsHide: true, timeout: 60_000, env: {...process.env, NO_UPDATE_CHECK: '1'}
  });
  if (result.status !== 0) return [];
  try {
    const report = JSON.parse(result.stdout);
    return report.model_calls_made === false && Array.isArray(report.routes) ? report.routes : [];
  } catch { return []; }
}

let installerScope;
async function install(command, timeoutMs) {
  if (!installerScope) {
    installerScope = createProcessScope();
    installerScope.installSignalHandlers();
  }
  const windows = process.platform === 'win32';
  const shell = desktopTool(windows ? 'powershell.exe' : 'bash');
  const args = windows
    ? ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; " + command + (command.startsWith('npm.cmd ') ? '; exit $LASTEXITCODE' : '')]
    : ['-o', 'pipefail', '-c', command];
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|LOCALAPPDATA|APPDATA|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|PATHEXT|LANG|NPM_CONFIG_PREFIX|HTTPS?_PROXY|NO_PROXY|XDG_(CONFIG|DATA|BIN)_HOME)$/i.test(key)) env[key] = value;
  }
  // Both Windows native installers select their download from these OS variables.
  if (windows) {
    for (const key of ['PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432']) {
      if (process.env[key]) env[key] = process.env[key];
    }
  }
  env.PATH = (process.env.PATH || '').split(path.delimiter).filter(dir => pathEntryOutside(dir, process.cwd())).join(path.delimiter);
  env.NoDefaultCurrentDirectoryInExePath = '1';
  // A project .npmrc or shell startup file must not choose what a first-run installer downloads.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-cli-'));
  try {
    const child = installerScope.spawn(shell, args, {cwd, env, windowsHide:true, stdio:['ignore', 2, 2]});
    return await new Promise(resolve => {
      let timeoutReason = null;
      let hardStop;
      const timer = setTimeout(() => {
        timeoutReason = installerScope.stopInstallerTree(child) ? 'ETIMEDOUT' : 'cleanup_unconfirmed';
        hardStop = setTimeout(() => {
          child.unref();
          resolve('cleanup_unconfirmed');
        }, 5000);
      }, timeoutMs);
      function finish(reason) {
        clearTimeout(timer);
        clearTimeout(hardStop);
        resolve(timeoutReason || reason);
      }
      child.once('error', error => finish(error.code || 'installer_unavailable'));
      child.once('close', (code, signal) => finish(code === 0 ? null : signal || 'exit ' + code));
    });
  } finally {
    try { fs.rmdirSync(cwd); } catch { /* preserve any installer diagnostics left in the temporary directory */ }
  }
}

export async function setupReviewerClis({apply = false, includeGemini = false, inspect = discover, execute = install, onlyStandardReviewer, installerTimeoutMs = 300_000,
  lockFile = path.join(os.homedir(), '.momm', 'reviewer-install')} = {}) {
  if (onlyStandardReviewer !== undefined && !standardReviewers.includes(onlyStandardReviewer)) throw Error('Unknown standard reviewer');
  const agents = onlyStandardReviewer ? [onlyStandardReviewer] : includeGemini ? [...standardReviewers, 'gemini'] : standardReviewers;
  const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  // A single apply worker discovers the program inside the install lock.
  const singleApply = apply && onlyStandardReviewer !== undefined;
  const snapshot = singleApply ? [] : inspect(agents);
  const rows = [];
  const detected = r => r?.installed === true && typeof r.version === 'string' && Boolean(r.version.trim());
  const missing = r => r?.installed === false && r.readiness_status === 'launcher_not_found';
  let cleanupUnconfirmed = false;
  for (const agent of agents) {
    const before = snapshot.find(r => r.agent === agent);
    const row = {agent, status: 'discovery_inconclusive'};
    rows.push(row);
    if (detected(before)) { Object.assign(row, {status:'already_installed', version:before.version}); continue; }
    if (!singleApply && !missing(before)) continue;
    const command = providers[agent].install[platform];
    if (cleanupUnconfirmed) { row.status = 'deferred'; continue; }
    if (!apply) { Object.assign(row, {status:'would_install', command}); continue; }
    let lock;
    try { lock = acquireLock(lockFile); }
    catch { row.status = 'lock_unavailable'; continue; }
    if (!lock) { row.status = 'installer_busy'; continue; }
    try {
      // Another installer may have completed while earlier providers were being installed.
      const fresh = inspect([agent]).find(r => r.agent === agent);
      if (detected(fresh)) { Object.assign(row, {status:'already_installed', version:fresh.version}); continue; }
      if (!missing(fresh)) continue;
      process.stderr.write('Installing ' + providers[agent].label + ': ' + command + '\n');
      let failure;
      try { failure = await execute(command, installerTimeoutMs); } catch (error) { failure = error.code || 'installer_unavailable'; }
      const after = inspect([agent]).find(r => r.agent === agent);
      if (failure) {
        cleanupUnconfirmed = failure === 'cleanup_unconfirmed';
        Object.assign(row, {status:'install_failed', reason:failure});
        if (detected(after)) row.version = after.version;
      } else if (detected(after)) Object.assign(row, {status:'installed_verified', version:after.version});
      else row.status = 'version_unverified';
    } finally { lock.release(); }
  }
  const complete = rows.every(r => ['already_installed','installed_verified'].includes(r.status));
  let nextStep = 'Open MOMM Setup Center, sign in where prompted and choose Verify connection to run a sample review.';
  if (!complete) nextStep = cleanupUnconfirmed
    ? 'Check that the interrupted vendor installer has stopped. Then reopen Setup Center and choose Install everything to recheck.'
    : 'Open MOMM Setup Center and choose Install everything to check each program and repair missing reviewers.';
  return {mode:apply ? 'install' : 'preview', complete, reviewers:rows, next_step:nextStep};
}


export async function prepareReviewerSetup(options, root) {
  if (options.reviewerMode === 'skip' || linksUnderRecovery(root, options.customDirs)) return null;
  const targets = options.targets;
  if (!targets.every(target => ['auto','all','codex','gemini','claude','antigravity'].includes(target))) return null;
  const report = await setupReviewerClis({apply:!options.dryRun, includeGemini:targets.includes('gemini') || targets.includes('all')});
  if (options.dryRun && !report.complete) report.next_step = 'Apply this installation without --dry-run to install the missing CLIs. Setup Center also offers individual repairs.';
  return report;
}
