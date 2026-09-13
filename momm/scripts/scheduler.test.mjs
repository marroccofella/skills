// Tests for scheduler.mjs (MOMM 1.16.0 E5). Run: node momm/scripts/scheduler.test.mjs
import assert from "node:assert/strict";
import { createScheduler, adaptiveTimeoutMs, earlyExitDecision, EARLY_EXIT_REASONS, HARD_JOB_CAP } from "./scheduler.mjs";

const failures = [], passed = [];
async function test(name, fn) {
  try { await fn(); passed.push(name); } catch (e) { failures.push({ test: name, error: e.message }); }
}
const tick = () => new Promise((r) => setImmediate(r));
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
// Fake task: records start order, resolves when the test says so, and
// registers an onCancel hook that settles it early.
function fakeTask(log, route, id) {
  const d = deferred();
  const fn = (ctx) => {
    log.push({ route, id, startedAt: ctx.pieceId });
    ctx.onCancel((reason) => d.resolve({ id, aborted: reason }));
    return d.promise;
  };
  return { fn, d };
}
function assertCaps(scheduler, jobs) {
  const s = scheduler.stats();
  assert.ok(s.running <= jobs, `running ${s.running} > jobs ${jobs}`);
  for (const [route, c] of Object.entries(s.perRoute)) assert.ok(c.running <= c.cap, `${route} running ${c.running} > cap ${c.cap}`);
}

await test("caps: never more than jobs running, never more than per-route cap; FIFO within a route", async () => {
  let clock = 0;
  const scheduler = createScheduler({ jobs: 3, perRoute: { codex: 1 }, now: () => clock });
  assert.equal(scheduler.capFor("antigravity"), 2);
  assert.equal(scheduler.capFor("grok"), 2);
  assert.equal(scheduler.capFor("codex"), 1);
  assert.equal(scheduler.capFor("gemini"), 3);
  const log = [];
  const tasks = [];
  const plan = [["antigravity", 4], ["grok", 3], ["codex", 2], ["gemini", 3]];
  for (const [route, count] of plan) for (let i = 0; i < count; i += 1) {
    const id = `${route}-${i}`;
    const t = fakeTask(log, route, id);
    tasks.push({ id, route, ...t, promise: scheduler.schedule(route, id, t.fn) });
  }
  await tick();
  assertCaps(scheduler, 3);
  assert.equal(scheduler.stats().running, 3);
  assert.equal(scheduler.stats().queued, 9);
  // arrival order across routes: antigravity-0, antigravity-1 (cap 2), then grok-0
  assert.deepEqual(log.map((l) => l.id), ["antigravity-0", "antigravity-1", "grok-0"]);
  // release tasks one at a time in scheduling order, checking caps after each
  for (const task of tasks) {
    clock += 10;
    task.d.resolve(`ok ${task.id}`);
    await tick();
    assertCaps(scheduler, 3);
  }
  await scheduler.drain();
  const results = await Promise.all(tasks.map((t) => t.promise));
  assert.deepEqual(results, tasks.map((t) => `ok ${t.id}`));
  for (const [route] of plan) {
    const started = log.filter((l) => l.route === route).map((l) => l.id);
    assert.deepEqual(started, tasks.filter((t) => t.route === route).map((t) => t.id), `FIFO broken for ${route}`);
  }
  const s = scheduler.stats();
  assert.deepEqual({ running: s.running, queued: s.queued, done: s.done, cancelled: s.cancelled }, { running: 0, queued: 0, done: 12, cancelled: 0 });
  assert.equal(s.timings.length, 12);
  assert.ok(s.timings.every((t) => t.runMs >= 0 && t.queuedMs >= 0 && t.outcome === "done"));
});

await test("hard cap 6 and default jobs", () => {
  assert.equal(createScheduler({ jobs: 50 }).jobs, HARD_JOB_CAP);
  assert.equal(createScheduler({ jobs: 0 }).jobs, HARD_JOB_CAP);
  assert.equal(createScheduler({ perRoute: { a: 1, b: 1, c: 1 } }).jobs, 3);
  assert.equal(createScheduler({ jobs: 2, perRoute: { gemini: 9 } }).capFor("gemini"), 2);
});

await test("cancel: queued task rejects with { cancelled: true } and never starts", async () => {
  const scheduler = createScheduler({ jobs: 1 });
  const log = [];
  const first = fakeTask(log, "grok", "g0"), second = fakeTask(log, "grok", "g1");
  const p0 = scheduler.schedule("grok", "g0", first.fn);
  const p1 = scheduler.schedule("grok", "g1", second.fn);
  await tick();
  assert.equal(scheduler.cancel("g1"), true);
  await assert.rejects(p1, (e) => e.cancelled === true && e.pieceId === "g1");
  assert.equal(scheduler.cancel("nope"), false);
  first.d.resolve("done");
  assert.equal(await p0, "done");
  await scheduler.drain();
  assert.deepEqual(log.map((l) => l.id), ["g0"]);
  const s = scheduler.stats();
  assert.equal(s.done, 1);
  assert.equal(s.cancelled, 1);
  assert.equal(s.perRoute.grok.cancelled, 1);
});

await test("cancel: running task gets its onCancel hook and counts as cancelled, not done", async () => {
  const scheduler = createScheduler({ jobs: 2 });
  const log = [];
  const t = fakeTask(log, "antigravity", "a0");
  const p = scheduler.schedule("antigravity", "a0", t.fn);
  await tick();
  assert.equal(scheduler.stats().running, 1);
  assert.equal(scheduler.cancel("a0", "quorum met"), true);
  const result = await p;
  assert.deepEqual(result, { id: "a0", aborted: "quorum met" });
  await scheduler.drain();
  const s = scheduler.stats();
  assert.deepEqual({ done: s.done, cancelled: s.cancelled, running: s.running }, { done: 0, cancelled: 1, running: 0 });
  assert.equal(s.timings[0].outcome, "cancelled");
});

await test("drain: resolves immediately when idle and after all work otherwise; failures propagate", async () => {
  const scheduler = createScheduler({ jobs: 2 });
  await scheduler.drain();
  let drained = false;
  const d = deferred();
  const p = scheduler.schedule("codex", "c0", () => d.promise);
  const failing = scheduler.schedule("codex", "c1", () => Promise.reject(new Error("boom")));
  await assert.rejects(failing, /boom/);
  const drain = scheduler.drain().then(() => { drained = true; });
  await tick();
  assert.equal(drained, false);
  d.resolve(1);
  await drain;
  assert.equal(await p, 1);
  assert.equal(drained, true);
  await assert.rejects(scheduler.schedule("codex", "c2", "not a function"), TypeError);
});

await test("adaptiveTimeoutMs: n<10 rule, null median, clamp bounds, oversize cap", () => {
  const base = 60_000;
  assert.equal(adaptiveTimeoutMs({ baseMs: base, pieceBytes: 200_000, medianSecPerKb: 5, n: 9 }), base);
  assert.equal(adaptiveTimeoutMs({ baseMs: base, pieceBytes: 200_000, medianSecPerKb: null, n: 50 }), base);
  assert.equal(adaptiveTimeoutMs({ baseMs: base, pieceBytes: 200_000, medianSecPerKb: undefined, n: 50 }), base);
  // 4 KB * 1 s/KB = 4 s -> floored at base
  assert.equal(adaptiveTimeoutMs({ baseMs: base, pieceBytes: 4096, medianSecPerKb: 1, n: 10 }), base);
  // 64 KB * 1.25 s/KB = 80 s -> in range
  assert.equal(adaptiveTimeoutMs({ baseMs: base, pieceBytes: 64 * 1024, medianSecPerKb: 1.25, n: 10 }), 80_000);
  // 400 KB * 1 s/KB = 400 s -> capped at 2x
  assert.equal(adaptiveTimeoutMs({ baseMs: base, pieceBytes: 400 * 1024, medianSecPerKb: 1, n: 100 }), 2 * base);
  assert.equal(adaptiveTimeoutMs({ baseMs: base, pieceBytes: 100, medianSecPerKb: 1, n: 100, oversize: true }), 2 * base);
  assert.equal(adaptiveTimeoutMs({ baseMs: base, pieceBytes: 100, medianSecPerKb: null, n: 0, oversize: true }), 2 * base);
});

await test("earlyExitDecision: truth table", () => {
  const protectedRoutes = new Set(["gemini"]);
  const base = { route: "grok", bytesReceived: 0, elapsedMs: 5000, medianFirstOutputMs: 4000, noEarlyExitRoutes: protectedRoutes };
  assert.deepEqual(earlyExitDecision({ ...base, quorumMet: true }), { cancel: true, reason: "quorum met, route silent past its median first-output time" });
  assert.deepEqual(earlyExitDecision({ ...base, quorumMet: false }), { cancel: false, reason: "quorum not met" });
  assert.deepEqual(earlyExitDecision({ ...base, quorumMet: true, bytesReceived: 1 }), { cancel: false, reason: "route has produced output" });
  assert.deepEqual(earlyExitDecision({ ...base, quorumMet: true, route: "gemini" }), { cancel: false, reason: "route protected: no-early-exit bit" });
  assert.deepEqual(earlyExitDecision({ ...base, quorumMet: true, elapsedMs: 4000 }), { cancel: false, reason: EARLY_EXIT_REASONS.withinMedian });
  // protection wins even when everything else says cancel; array form accepted; missing set means unprotected
  assert.equal(earlyExitDecision({ ...base, quorumMet: true, route: "gemini", noEarlyExitRoutes: ["gemini"] }).cancel, false);
  assert.equal(earlyExitDecision({ ...base, quorumMet: true, noEarlyExitRoutes: undefined }).cancel, true);
  // exhaustive: cancel iff all four conditions hold
  for (const quorumMet of [true, false]) for (const bytesReceived of [0, 12]) for (const elapsedMs of [3000, 5000]) for (const route of ["grok", "gemini"]) {
    const expected = quorumMet && bytesReceived === 0 && elapsedMs > 4000 && !protectedRoutes.has(route);
    assert.equal(earlyExitDecision({ ...base, quorumMet, bytesReceived, elapsedMs, route }).cancel, expected);
  }
});

console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
