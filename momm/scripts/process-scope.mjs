// Own only supervised children; deliberately excludes user terminals/browsers.
// POSIX groups contain ordinary descendants, not helpers that detach themselves.
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';

export function createProcessScope(deps = {}) {
  const proc = deps.process ?? process, launch = deps.spawn ?? spawn;
  const launchSync = deps.spawnSync ?? spawnSync;
  const later = deps.setTimeout ?? setTimeout, cancel = deps.clearTimeout ?? clearTimeout;
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
        const killer = launch('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide:true,stdio:'ignore'});
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
          if (Date.now() < deadline) result = launchSync('taskkill', ['/pid',String(child.pid),'/T','/F'],
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
      const child = launch(command, args, {...options,detached:proc.platform !== 'win32'});
      owned.set(child, {timer:null,terminating:false});
      child.once('exit', () => release(child));
      // An error with a PID can mean failed kill/IPC, not a terminated process.
      child.on('error', () => { if (!child.pid) release(child); });
      return child;
    }, terminate, release, stop, force, installSignalHandlers,
  };
}
