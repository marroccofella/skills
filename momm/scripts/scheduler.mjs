// MOMM 1.16.0 E5 — lane scheduler, adaptive timeouts, early-exit decision.
// Zero dependencies, Node 18+. Pure logic: no processes are spawned here; the
// dispatcher passes a task function that owns its own CLI process.

export const HARD_JOB_CAP = 6;
export const DEFAULT_ROUTE_CAPS = Object.freeze({ antigravity: 2, grok: 2 });

// jobs: omitted (undefined/null) means HARD_JOB_CAP — perRoute entries are
// per-route ceilings and never lower the global cap. Any value that is given
// must be a positive number; it is floored and capped at HARD_JOB_CAP. Zero,
// negatives and non-numbers throw: "no concurrency" must never silently
// become "maximum concurrency".
function clampJobs(jobs) {
  if (jobs === undefined || jobs === null) return HARD_JOB_CAP;
  const n = typeof jobs === "number" ? jobs : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new RangeError(`createScheduler: jobs must be a positive number (1-${HARD_JOB_CAP}); got ${String(jobs)}`);
  return Math.min(Math.max(Math.floor(n), 1), HARD_JOB_CAP);
}

// schedule(route, pieceId, fn): fn receives { pieceId, route, onCancel(cb),
// cancelled } and returns a value or promise. Global cap `jobs` (≤ 6), per
// route caps (antigravity 2, grok 2 by default; others bounded only by jobs),
// FIFO within a route and across routes in arrival order (skipping routes at
// their cap). cancel(pieceId) rejects a queued task with { cancelled: true }
// or, for a running task, calls the onCancel callbacks it registered; the
// task then settles itself and is counted as cancelled rather than done. A
// callback registered AFTER cancel() (fn runs in a later microtask than
// schedule(), so an immediate cancel beats its registration) is invoked at
// once with the recorded reason, so such a task still settles and drain()
// still completes.
export function createScheduler({ jobs, perRoute = {}, now = Date.now } = {}) {
  const maxJobs = clampJobs(jobs);
  const capFor = (route) => {
    const cap = perRoute[route] ?? DEFAULT_ROUTE_CAPS[route] ?? maxJobs;
    return Math.min(Math.max(Math.floor(Number(cap)) || 1, 1), maxJobs);
  };
  const queue = [];
  const running = new Map(); // pieceId -> task
  const counts = new Map(); // route -> { running, queued, done, cancelled }
  const timings = [];
  const drainWaiters = [];
  let done = 0;
  let cancelled = 0;
  const routeCounts = (route) => {
    if (!counts.has(route)) counts.set(route, { running: 0, queued: 0, done: 0, cancelled: 0 });
    return counts.get(route);
  };
  const settleWaiters = () => {
    if (queue.length || running.size) return;
    while (drainWaiters.length) drainWaiters.shift()();
  };
  const finish = (task, outcome) => {
    running.delete(task.pieceId);
    routeCounts(task.route).running -= 1;
    task.finishedAt = now();
    timings.push({ pieceId: task.pieceId, route: task.route, queuedMs: task.startedAt - task.queuedAt, runMs: task.finishedAt - task.startedAt, outcome });
    if (task.cancelled) { cancelled += 1; routeCounts(task.route).cancelled += 1; }
    else { done += 1; routeCounts(task.route).done += 1; }
    pump();
    settleWaiters();
  };
  const start = (task) => {
    task.startedAt = now();
    running.set(task.pieceId, task);
    const rc = routeCounts(task.route);
    rc.queued -= 1;
    rc.running += 1;
    const ctx = {
      pieceId: task.pieceId,
      route: task.route,
      get cancelled() { return task.cancelled; },
      onCancel(cb) {
        if (typeof cb !== "function") return;
        if (task.cancelled) { try { cb(task.cancelReason); } catch {} } // cancelled before registration: fire now
        else task.onCancel.push(cb);
      },
    };
    Promise.resolve()
      .then(() => task.fn(ctx))
      .then((value) => { finish(task, task.cancelled ? "cancelled" : "done"); task.resolve(value); },
        (error) => { finish(task, task.cancelled ? "cancelled" : "failed"); task.reject(error); });
  };
  function pump() {
    for (let i = 0; i < queue.length && running.size < maxJobs;) {
      const task = queue[i];
      if (routeCounts(task.route).running < capFor(task.route)) { queue.splice(i, 1); start(task); }
      else i += 1;
    }
  }
  return {
    jobs: maxJobs,
    capFor,
    schedule(route, pieceId, fn) {
      if (typeof fn !== "function") return Promise.reject(new TypeError("schedule: fn must be a function"));
      if (running.has(pieceId) || queue.some((t) => t.pieceId === pieceId)) return Promise.reject(new Error(`schedule: duplicate pieceId ${pieceId}`));
      return new Promise((resolve, reject) => {
        queue.push({ route, pieceId, fn, resolve, reject, cancelled: false, onCancel: [], queuedAt: now() });
        routeCounts(route).queued += 1;
        pump();
      });
    },
    cancel(pieceId, reason = "cancelled") {
      const index = queue.findIndex((t) => t.pieceId === pieceId);
      if (index >= 0) {
        const [task] = queue.splice(index, 1);
        routeCounts(task.route).queued -= 1;
        cancelled += 1;
        routeCounts(task.route).cancelled += 1;
        task.reject({ cancelled: true, pieceId, route: task.route, reason });
        pump();
        settleWaiters();
        return true;
      }
      const task = running.get(pieceId);
      if (!task) return false;
      if (!task.cancelled) { task.cancelled = true; task.cancelReason = reason; for (const cb of task.onCancel) { try { cb(reason); } catch {} } }
      return true;
    },
    stats() {
      const perRouteStats = {};
      for (const [route, c] of counts) perRouteStats[route] = { ...c, cap: capFor(route) };
      return { running: running.size, queued: queue.length, done, cancelled, jobs: maxJobs, perRoute: perRouteStats, timings: timings.slice() };
    },
    drain() {
      return new Promise((resolve) => { drainWaiters.push(resolve); settleWaiters(); });
    },
  };
}

// Base timeout scaled by piece size using the route's median seconds per KB,
// applied only with at least 10 completed dispatches in that bucket; floored
// at baseMs and capped at 2*baseMs. Oversize pieces always get the cap.
export function adaptiveTimeoutMs({ baseMs, pieceBytes, medianSecPerKb, n, oversize = false }) {
  const base = Math.max(0, Number(baseMs) || 0);
  if (oversize) return 2 * base;
  if (!(Number(n) >= 10) || medianSecPerKb === null || medianSecPerKb === undefined || !Number.isFinite(Number(medianSecPerKb))) return base;
  const scaled = (Math.max(0, Number(pieceBytes) || 0) / 1024) * Number(medianSecPerKb) * 1000;
  return Math.round(Math.min(Math.max(scaled, base), 2 * base));
}

export const EARLY_EXIT_REASONS = Object.freeze({
  cancel: "quorum met, route silent past its median first-output time",
  protectedRoute: "route protected: no-early-exit bit",
  noQuorum: "quorum not met",
  producedOutput: "route has produced output",
  withinMedian: "route silent but within its median first-output time",
  noHistory: "no timing history",
});

// Cancel only when quorum is met, the route has sent nothing, it is past its
// median first-output time, and its track record has not set the
// no-early-exit bit. Without a measured median (null/undefined/non-finite)
// there is no threshold to be past, so the route is never cancelled.
export function earlyExitDecision({ quorumMet, route, bytesReceived, elapsedMs, medianFirstOutputMs, noEarlyExitRoutes }) {
  const protectedRoutes = noEarlyExitRoutes instanceof Set ? noEarlyExitRoutes : new Set(Array.isArray(noEarlyExitRoutes) ? noEarlyExitRoutes : []);
  if (protectedRoutes.has(route)) return { cancel: false, reason: EARLY_EXIT_REASONS.protectedRoute };
  if (!quorumMet) return { cancel: false, reason: EARLY_EXIT_REASONS.noQuorum };
  if (Number(bytesReceived) !== 0) return { cancel: false, reason: EARLY_EXIT_REASONS.producedOutput };
  if (typeof medianFirstOutputMs !== "number" || !Number.isFinite(medianFirstOutputMs)) return { cancel: false, reason: EARLY_EXIT_REASONS.noHistory };
  if (!(Number(elapsedMs) > medianFirstOutputMs)) return { cancel: false, reason: EARLY_EXIT_REASONS.withinMedian };
  return { cancel: true, reason: EARLY_EXIT_REASONS.cancel };
}
