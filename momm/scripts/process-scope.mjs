// Own only supervised children; deliberately excludes user terminals/browsers.
// POSIX groups contain ordinary descendants, not helpers that detach themselves.
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import nodeFs from 'node:fs';
import nodePath from 'node:path';
// Windows launch guard (see launch-guard.mjs): a bare command launched without a shell is looked up in
// THIS process's current directory before PATH unless this process carries the variable. Kept inline so
// a script copied on its own still runs.
if (process.platform === "win32" && !process.env.NoDefaultCurrentDirectoryInExePath) process.env.NoDefaultCurrentDirectoryInExePath = "1";

// Windows tool resolution. The variable above is honoured by cmd.exe and by the libuv in Node 22 and
// later; Node 18 and Node 20 ignore it, so on those runtimes a bare command name handed to spawn is
// looked up in the child's working directory first, and a git.exe planted in a reviewed project was
// started (CI run 35459186774, windows-latest, Node 20.20.2). A bare name is therefore never handed
// to spawn on Windows. System tools come from System32; anything else is searched for on the absolute
// PATH entries that lie outside the working directory; a name found nowhere becomes an absolute path
// that cannot exist, so the launch fails as an ordinary ENOENT instead of finding a planted file.
const SYSTEM_TOOLS = new Map([['cmd', 'cmd.exe'], ['cmd.exe', 'cmd.exe'],
  ...['taskkill', 'tasklist', 'schtasks', 'where', 'icacls'].flatMap(n => [[n, n + '.exe'], [n + '.exe', n + '.exe']]),
  ['powershell.exe', 'WindowsPowerShell\\v1.0\\powershell.exe'], ['powershell', 'WindowsPowerShell\\v1.0\\powershell.exe']]);
export function windowsTool(command, { env = process.env, cwd = process.cwd(), platform = process.platform, fs: files = nodeFs } = {}) {
  const name = String(command);
  if (platform !== 'win32' || /[\\/]/.test(name)) return command;
  const win = nodePath.win32, value = key => Object.entries(env ?? {}).find(([k]) => k.toLowerCase() === key)?.[1];
  const system32 = win.join(value('systemroot') || value('windir') || 'C:\\Windows', 'System32');
  const system = SYSTEM_TOOLS.get(name.toLowerCase());
  if (system) return win.join(system32, system);
  const real = p => { try { return String(files.realpathSync.native(p)); } catch { return win.resolve(p); } };
  const inside = (root, p) => { const rel = win.relative(root, p); return rel === '' || (rel !== '..' && !rel.startsWith('..\\') && !win.isAbsolute(rel)); };
  const root = real(win.resolve(String(cwd || '.'))).toLowerCase();
  const extensions = win.extname(name) ? [''] : ['.exe', '.com'];
  for (const entry of String(value('path') ?? '').split(';').map(d => d.replace(/^"|"$/g, '')).filter(d => d && win.isAbsolute(d))) {
    for (const extension of extensions) {
      const candidate = win.join(entry, name + extension);
      try {
        if (!files.statSync(candidate).isFile()) continue;
        if (inside(root, real(candidate).toLowerCase())) continue;
        return candidate;
      } catch { /* not here */ }
    }
  }
  return win.join(system32, 'momm-tool-not-found', name + (win.extname(name) ? '' : '.exe'));
}

// The child's PATH, without relative entries and without entries inside the working directory. The
// guard variable only stops cmd.exe's implicit working-directory search; an explicit "." or an in-project
// entry would still let cmd.exe, or a grandchild on an older runtime, pick a planted file.
export function windowsChildEnv(sourceEnv, { cwd = process.cwd(), fs: files = nodeFs } = {}) {
  const win = nodePath.win32, env = { ...(sourceEnv ?? {}), NoDefaultCurrentDirectoryInExePath: '1' };
  const real = p => { try { return String(files.realpathSync.native(p)); } catch { return win.resolve(p); } };
  const root = real(win.resolve(String(cwd || '.'))).toLowerCase();
  const inside = p => { const rel = win.relative(root, real(p).toLowerCase()); return rel === '' || (rel !== '..' && !rel.startsWith('..\\') && !win.isAbsolute(rel)); };
  const keys = Object.keys(env).filter(k => k.toLowerCase() === 'path');
  if (keys.length) {
    const cleaned = keys.flatMap(k => String(env[k] ?? '').split(';')).filter(d => { const bare = d.replace(/^"|"$/g, ''); return bare && win.isAbsolute(bare) && !inside(bare); }).join(';');
    for (const k of keys.slice(1)) delete env[k];
    env[keys[0]] = cleaned;
  }
  return env;
}

export function createProcessScope(deps = {}) {
  const proc = deps.process ?? process, launch = deps.spawn ?? spawn;
  const launchSync = deps.spawnSync ?? spawnSync;
  const later = deps.setTimeout ?? setTimeout, cancel = deps.clearTimeout ?? clearTimeout;
  // A direct spawn of a bare name tries the working directory BEFORE PATH on Windows
  // unless the CALLING process already carries NoDefaultCurrentDirectoryInExePath,
  // which cannot be assumed. Reviews run inside untrusted projects, so the tree killer
  // is always named by its absolute System32 path; a planted taskkill.exe never runs.
  const taskkill = () => [proc.env?.SystemRoot || proc.env?.windir || 'C:\\Windows', 'System32', 'taskkill.exe'].join('\\');
  const owned = new Map();
  let stopping = false, signalInstalled = false;
  function direct(child) { try { child.kill('SIGKILL'); } catch { /* hard settle remains */ } }
  function group(child, signal) {
    // These PIDs came only from detached spawns in this scope. Never target 0.
    if (!Number.isInteger(child.pid) || child.pid <= 1 || child.pid === proc.pid) return;
    try { proc.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') direct(child); }
  }
  function terminate(child, { graceful = false } = {}) {
    const record = owned.get(child); if (!record || record.terminating) return;
    record.terminating = true;
    if (proc.platform === 'win32') {
      if (!child.pid) return;
      try {
        const killer = launch(taskkill(), ['/pid', String(child.pid), '/T', '/F'], {windowsHide:true,stdio:'ignore'});
        killer.on('error', () => direct(child)); killer.unref?.();
      } catch { direct(child); }
      record.timer = later(() => { if (owned.has(child)) direct(child); }, 2000);
      record.timer.unref?.();
    } else {
      group(child, graceful ? 'SIGTERM' : 'SIGKILL');
      // A nested MOMM dispatcher handles TERM by killing its separately owned
      // reviewer groups. Never remove this escalation merely because pipes close.
      if (graceful) record.timer = later(() => { if (owned.has(child)) group(child, 'SIGKILL'); }, 1000);
    }
  }
  function release(child) {
    const record = owned.get(child); if (!record) return;
    // The leader may exit normally while ignored-stdio helpers remain. Kill the
    // residual group now, then cancel the timer so a reused PGID is never hit later.
    if (proc.platform !== 'win32') group(child, 'SIGKILL');
    if (record.timer) cancel(record.timer);
    owned.delete(child);
  }
  function stop({ graceful = false } = {}) {
    stopping = true;
    for (const child of owned.keys()) terminate(child, {graceful});
  }
  function force() {
    stopping = true;
    const deadline = Date.now() + 2000;
    for (const child of [...owned.keys()]) {
      if (proc.platform === 'win32' && Number.isInteger(child.pid) && child.pid > 1 && child.pid !== proc.pid) {
        // Exit callbacks cannot await an unref'd taskkill. Finish tree enumeration
        // before killing its leader; share a two-second budget across this scope.
        let result;
        try {
          if (Date.now() < deadline) result = launchSync(taskkill(), ['/pid',String(child.pid),'/T','/F'],
            {windowsHide:true,stdio:'ignore',timeout:Math.max(1,deadline-Date.now())});
        } catch { /* Permission/OS failure keeps the direct-child backstop. */ }
        if (!result || result.error || result.status !== 0) direct(child);
      }
      release(child);
    }
  }
  function installSignalHandlers(onSignal = code => proc.exit(code), {graceful = false} = {}) {
    if (signalInstalled) return;
    signalInstalled = true;
    let signalled = false;
    for (const [signal, code] of [['SIGINT',130],['SIGTERM',143]]) proc.on(signal, () => {
      if (signalled) return; signalled = true;
      stop({graceful});
      // A dispatcher kills reviewer groups synchronously on TERM, before its
      // enclosing Setup Center's one-second escalation can kill the dispatcher.
      if (graceful) later(() => { force(); onSignal(code); }, 1100);
      else { force(); onSignal(code); }
    });
    proc.on('exit', force);
  }
  return {
    spawn(command, args, options = {}) {
      if (stopping) throw Object.assign(new Error('MOMM is stopping; refusing a new subprocess'), {code:'MOMM_STOPPING'});
      if (proc.platform === 'win32') {
        // The child's own environment decides its PATH; the guard variable rides along for cmd.exe
        // (which honours it on every Windows) and for newer runtimes.
        const cwd = options.cwd ?? proc.cwd?.(), files = deps.fs ?? nodeFs;
        const env = windowsChildEnv(options.env ?? proc.env, { cwd, fs: files });
        const where = { env, cwd, platform: 'win32', fs: files };
        if (options.shell) options = { ...options, env, shell: windowsTool(typeof options.shell === 'string' ? options.shell : 'cmd.exe', where) };
        else { command = windowsTool(command, where); options = { ...options, env }; }
      }
      const child = launch(command, args, {...options,detached:proc.platform !== 'win32'});
      owned.set(child, {timer:null,terminating:false});
      child.once('exit', () => release(child));
      // An error with a PID can mean failed kill/IPC, not a terminated process.
      child.on('error', () => { if (!child.pid) release(child); });
      return child;
    }, terminate, release, stop, force, installSignalHandlers,
  };
}
