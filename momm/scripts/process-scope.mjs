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
// A PATH directory may supply an executable only if it lies outside the project by BOTH its literal
// path and its real path, and the project is compared in both of its spellings too. Checking only the
// real path let a directory inside the project that is itself a link point anywhere the project
// chose; checking only the literal path let an alias that lands inside the project through. Relative
// entries are never searched, and anything that cannot be resolved is refused, not assumed safe.
// One rule for every resolver: before 1.16.1 each had its own loop, and a fix applied to one of them
// was missed in the next (independent review of 3d7a8be).
// foldCase (final review of 1.17.0): case is folded on every platform, as update.mjs does. On a
// case-insensitive volume (Windows, and macOS by default) a spelling that differs only in case is the
// same folder, so it counts as inside; on a case-sensitive volume folding can only refuse more.
export function pathEntryOutside(entry, root, { platform = process.platform, fs: files = nodeFs } = {}) {
  const win = platform === 'win32', p = win ? nodePath.win32 : nodePath.posix;
  const bare = String(entry ?? '').replace(/^"|"$/g, '');
  if (!bare || !p.isAbsolute(bare)) return false;
  const real = q => { try { return String(win ? files.realpathSync.native(q) : files.realpathSync(q)); } catch { return null; } };
  const key = q => q.toLowerCase(); // case folded on every platform: see foldCase above
  const rootLiteral = p.resolve(String(root || '.')), rootReal = real(rootLiteral);
  if (!rootReal) return false;
  const resolved = real(bare);
  if (!resolved) return false;
  const within = (base, q) => { const rel = p.relative(key(base), key(q)); return rel === '' || (rel !== '..' && !rel.startsWith('..' + p.sep) && !p.isAbsolute(rel)); };
  for (const base of [rootLiteral, rootReal]) if (within(base, p.resolve(bare)) || within(base, resolved)) return false;
  return true;
}

// The resolved executable must also lie outside the project in both of its spellings.
export function executableOutside(resolved, root, { platform = process.platform, fs: files = nodeFs } = {}) {
  const win = platform === 'win32', p = win ? nodePath.win32 : nodePath.posix;
  const real = q => { try { return String(win ? files.realpathSync.native(q) : files.realpathSync(q)); } catch { return null; } };
  const key = q => q.toLowerCase(); // case folded on every platform: see foldCase above
  const rootLiteral = p.resolve(String(root || '.')), rootReal = real(rootLiteral);
  if (!rootReal || !resolved) return false;
  const within = (base, q) => { const rel = p.relative(key(base), key(q)); return rel === '' || (rel !== '..' && !rel.startsWith('..' + p.sep) && !p.isAbsolute(rel)); };
  return !within(rootLiteral, resolved) && !within(rootReal, resolved);
}

// `project` (1.17 A1) is MOMM's own working directory, the reviewed project, when the child runs
// somewhere else (Grok's model listing runs in a private temporary directory): a PATH entry or an
// executable must then lie outside both. Left out, only the working directory counts, as before.
const rootsOf = (cwd, project) => [...new Set([cwd ?? '.', project].filter(r => r != null && r !== '').map(String))];
export function windowsTool(command, { env = process.env, cwd = process.cwd(), project, platform = process.platform, fs: files = nodeFs } = {}) {
  const name = String(command);
  // Off Windows this used to hand the name back unchanged, leaving the choice to the child's PATH
  // (1.17 A1): it now resolves under the POSIX rule, or fails as not installed.
  if (platform !== 'win32') return posixTool(command, { env, cwd, project, fs: files });
  const win = nodePath.win32, value = key => Object.entries(env ?? {}).find(([k]) => k.toLowerCase() === key)?.[1];
  const system32 = win.join(value('systemroot') || value('windir') || 'C:\\Windows', 'System32');
  const real = p => { try { return String(files.realpathSync.native(p)); } catch { return null; } };
  const roots = rootsOf(win.resolve(String(cwd || '.')), project), where = { platform: 'win32', fs: files };
  if (/[\\/]/.test(name)) {
    // A relative location is refused by processScope.spawn before this is reached. An absolute one is
    // launched only by its real path, outside the project (gate-3 review of 1.17.0): a caller that
    // named a link, or a path inside the project, gets the not-found path instead.
    if (!win.isAbsolute(name)) return command;
    const resolved = real(name);
    return resolved && roots.every(root => executableOutside(resolved, root, where) && executableOutside(win.resolve(name), root, where)) ? resolved : win.join(system32, 'momm-tool-not-found', win.basename(name));
  }
  const system = SYSTEM_TOOLS.get(name.toLowerCase());
  if (system) return win.join(system32, system);
  const extensions = win.extname(name) ? [''] : ['.exe', '.com'];
  for (const entry of String(value('path') ?? '').split(';').map(d => d.replace(/^"|"$/g, '')).filter(d => roots.every(root => pathEntryOutside(d, root, where)))) {
    for (const extension of extensions) {
      const candidate = win.join(entry, name + extension);
      try {
        if (!files.statSync(candidate).isFile()) continue;
        // Return the path that was checked. Returning the candidate let a link be followed a
        // second time at exec time, when it need no longer point where it did when checked.
        const resolved = real(candidate);
        if (!resolved || !roots.every(root => executableOutside(resolved, root, where))) continue;
        return resolved;
      } catch { /* not here */ }
    }
  }
  return win.join(system32, 'momm-tool-not-found', name + (win.extname(name) ? '' : '.exe'));
}

// POSIX launch resolution (1.17 A1, 29 September 2026). Until 1.17 a bare `codex`, `claude`, `grok`,
// `agy`, `copilot`, `gemini` or `git` went straight to spawn on macOS and Linux, and execvp took the first
// match on the child's PATH, so an entry inside the reviewed project (a direnv or virtual-environment
// bin, node_modules/.bin, ".", or an empty entry, which means the working directory) could supply the
// reviewer or the Git that verifies the review. The Windows rule now holds here too: a bare name comes
// only from an absolute PATH entry outside the project by literal and real path, as a regular file with
// an execute bit, and the executable's real path must be outside the project as well, so a link outside
// that points inside is refused. What was checked is what is returned, so a link cannot be followed a
// second time at exec time. A command containing "/" must be an absolute path MOMM resolved itself (the
// verified Grok binary, process.execPath), and its real path must lie outside the project too; a relative
// one would be looked up from the working directory, the project, and is refused. Nothing found means a not-installed failure, never a launch: POSIX has no
// path that is guaranteed not to exist, so the Windows trick of an impossible absolute path is not used.
export function notInstalled(command, reason) {
  const name = String(command);
  const why = reason === 'relative' ? `refused: a relative path containing a separator would be looked up from the working directory (the reviewed project); MOMM launches only a name it resolves itself or an absolute path`
    : reason === 'inside' ? 'not installed (only found inside the reviewed project)'
    : 'not installed (not found on an absolute PATH entry outside the reviewed project)';
  // ENOENT keeps every caller's ordinary "missing" classification (classifyFailure, commandVersion).
  return Object.assign(new Error(`${name}: ${why}`), { code: 'ENOENT', errno: -2, syscall: 'spawn ' + name, path: name, momm_not_installed: reason });
}
export function posixTool(command, { env = process.env, cwd = process.cwd(), project, fs: files = nodeFs } = {}) {
  const p = nodePath.posix, name = String(command), where = { platform: 'linux', fs: files }; // any non-win32 value selects POSIX rules
  const roots = rootsOf(p.resolve(String(cwd || '.')), project);
  const real = q => { try { return String(files.realpathSync(q)); } catch { return null; } };
  if (name.includes('/')) {
    if (!p.isAbsolute(name)) throw notInstalled(name, 'relative');
    // An absolute path is held to the same rule as a name found on PATH (gate-3 review of 1.17.0): its
    // real path must lie outside the project, and that real path is what is launched. probes.mjs handed
    // ~/.grok/bin/grok through unchecked, so a link there into the project would have been started. The
    // path as named must lie outside too: a link inside the project would let the project choose.
    const resolved = real(name);
    if (!resolved) throw notInstalled(name, 'absent');
    if (!roots.every(root => executableOutside(resolved, root, where) && executableOutside(p.resolve(name), root, where))) throw notInstalled(name, 'inside');
    return resolved;
  }
  if (!name || name === '.' || name === '..') throw notInstalled(name, 'absent');
  const runnable = q => { try { const st = files.statSync(q); return st.isFile() && (Number(st.mode) & 0o111) !== 0; } catch { return false; } };
  let inside = false;
  // POSIX environment names are case-sensitive; execvp reads PATH and nothing else. With no PATH at all
  // the child's execvp searches the system default directories (libuv and the C library use
  // /usr/bin:/bin), and posixChildEnv removes PATH when nothing survives, so resolve against the same
  // two directories under the same rule; an empty PATH still means the working directory, refused below.
  const searched = env?.PATH === undefined || env?.PATH === null ? '/usr/bin:/bin' : String(env.PATH);
  for (const entry of searched.split(':')) {
    if (!roots.every(root => pathEntryOutside(entry, root, where))) {
      // Only to say WHY nothing was found; a refused entry is never launched. A relative or empty entry
      // is read from the working directory, which is where execvp would have looked.
      if (runnable(p.resolve(roots[0], entry || '.', name))) inside = true;
      continue;
    }
    const candidate = p.join(entry, name);
    if (!runnable(candidate)) continue;
    const resolved = real(candidate);
    if (resolved && roots.every(root => executableOutside(resolved, root, where))) return resolved;
    if (resolved) inside = true;
  }
  throw notInstalled(name, inside ? 'inside' : 'absent');
}

// Desktop helpers the Setup Center starts outside processScope (1.17 A1 follow-up, 29 September 2026):
// osascript and open on macOS, x-terminal-emulator and xdg-open on Linux. They belong to the system, so
// /usr/bin and then /bin are tried first, whatever PATH puts before them; each must still be a regular
// executable whose real path lies outside the project. Anything else falls to the launch rule above, so
// a copy found only inside the project (or on a relative PATH entry) is refused. Windows keeps its own
// resolver (System32 for its system tools).
export function desktopTool(command, { platform = process.platform, env = process.env, cwd = process.cwd(), project, fs: files = nodeFs } = {}) {
  if (platform === 'win32') return windowsTool(command, { env, cwd, project, platform, fs: files });
  const p = nodePath.posix, name = String(command), where = { platform: 'linux', fs: files };
  if (name && !name.includes('/')) {
    const roots = rootsOf(p.resolve(String(cwd || '.')), project);
    for (const dir of ['/usr/bin', '/bin']) {
      if (!roots.every(root => pathEntryOutside(dir, root, where))) continue;
      try {
        const candidate = p.join(dir, name), st = files.statSync(candidate);
        if (!st.isFile() || !(Number(st.mode) & 0o111)) continue;
        const resolved = String(files.realpathSync(candidate));
        if (roots.every(root => executableOutside(resolved, root, where))) return resolved;
      } catch { /* not in this system directory */ }
    }
  }
  return posixTool(command, { env, cwd, project, fs: files });
}

// The child's PATH, without relative entries and without entries inside the working directory. The
// guard variable only stops cmd.exe's implicit working-directory search; an explicit "." or an in-project
// entry would still let cmd.exe, or a grandchild on an older runtime, pick a planted file.
export function windowsChildEnv(sourceEnv, { cwd = process.cwd(), project, fs: files = nodeFs } = {}) {
  const env = { ...(sourceEnv ?? {}), NoDefaultCurrentDirectoryInExePath: '1' };
  const keys = Object.keys(env).filter(k => k.toLowerCase() === 'path');
  if (keys.length) {
    // Same rule as the resolvers: a directory inside the project by its literal OR its real path is
    // removed, so a junction inside the project that points elsewhere no longer survives.
    const roots = rootsOf(cwd, project);
    const cleaned = keys.flatMap(k => String(env[k] ?? '').split(';')).filter(d => roots.every(root => pathEntryOutside(d, root, { platform: 'win32', fs: files }))).join(';');
    for (const k of keys.slice(1)) delete env[k];
    env[keys[0]] = cleaned;
  }
  return env;
}

// The POSIX child's PATH (1.17 A1): the same rule, so a grandchild (a reviewer running `git`, a shell
// line) cannot pick a project binary either. When nothing survives, PATH is removed rather than left
// empty: to execvp an empty PATH is one empty entry, the working directory, while an unset PATH falls
// back to the system default directories.
export function posixChildEnv(sourceEnv, { cwd = process.cwd(), project, fs: files = nodeFs } = {}) {
  const env = { ...(sourceEnv ?? {}) };
  if (!Object.hasOwn(env, 'PATH')) return env;
  const roots = rootsOf(cwd, project);
  const cleaned = String(env.PATH ?? '').split(':').filter(d => roots.every(root => pathEntryOutside(d, root, { platform: 'linux', fs: files }))).join(':');
  if (cleaned) env.PATH = cleaned; else delete env.PATH;
  return env;
}

// A command naming a location relative to the working directory, refused on every platform (1.17 A1):
// the working directory is the reviewed project. Shell command lines are the shell's to parse.
export function relativeCommand(command, platform = process.platform) {
  const name = String(command), win = platform === 'win32';
  return (win ? /[\\/]/ : /\//).test(name) && !(win ? nodePath.win32 : nodePath.posix).isAbsolute(name);
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
      // One resolver for every platform (1.17 A1). The project is the child's working directory AND
      // MOMM's own, which differ when a route runs in a private temporary directory. A failure here is
      // thrown before anything is launched; every caller already settles a synchronous throw.
      const cwd = options.cwd ?? proc.cwd?.(), project = proc.cwd?.(), files = deps.fs ?? nodeFs;
      if (!options.shell && relativeCommand(command, proc.platform)) throw notInstalled(command, 'relative');
      if (proc.platform === 'win32') {
        // The child's own environment decides its PATH; the guard variable rides along for cmd.exe
        // (which honours it on every Windows) and for newer runtimes.
        const env = windowsChildEnv(options.env ?? proc.env, { cwd, project, fs: files });
        const where = { env, cwd, project, platform: 'win32', fs: files };
        if (options.shell) options = { ...options, env, shell: windowsTool(typeof options.shell === 'string' ? options.shell : 'cmd.exe', where) };
        else { command = windowsTool(command, where); options = { ...options, env }; }
      } else {
        // Resolved against the PATH the child is given, the one spawn itself would have searched. A
        // shell (Node's is /bin/sh, absolute) parses its own command line against the scrubbed PATH.
        const env = posixChildEnv(options.env ?? proc.env, { cwd, project, fs: files });
        const where = { env, cwd, project, fs: files };
        if (options.shell) options = { ...options, env, ...(typeof options.shell === 'string' ? { shell: posixTool(options.shell, where) } : {}) };
        else {
          try { command = posixTool(command, where); }
          catch (error) {
            // Only to say WHY: when scrubbing removed every PATH entry that held the name, the scrubbed PATH
            // cannot tell "inside the project" from "absent". Ask the caller's PATH, and never launch from it.
            if (error?.momm_not_installed === 'absent') {
              try { posixTool(command, { ...where, env: options.env ?? proc.env }); }
              catch (why) { if (why?.momm_not_installed === 'inside') throw why; }
            }
            throw error;
          }
          options = { ...options, env };
        }
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
