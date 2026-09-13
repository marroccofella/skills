#!/usr/bin/env node
// update-clock tests: temp home + state, fake fetcher/exec/clock, no network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createUpdateClock, applyUpdates, readSettings, writeSettings, DEFAULT_SETTINGS, skillSource, npmSource, grokSource, antigravitySource, modelsSource, timerCommand, installTimer, parseSet, cliMain, UPDATE_COMMANDS, readState, writeState } from "./update-clock.mjs";
import { MANIFEST_URL } from "./update.mjs";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "momm-update-clock-"));
const passed = [], failures = [];
let n = 0;
async function test(name, fn) { try { await fn(); passed.push(name); } catch (e) { failures.push({ name, error: e.message }); } }
const MIN = DEFAULT_SETTINGS.clock.min_interval_ms, MAX = DEFAULT_SETTINGS.clock.max_interval_ms;
function env(overrides = {}) {
  const dir = path.join(fixture, `case-${n++}`); fs.mkdirSync(dir);
  const home = path.join(dir, "home"), stateFile = path.join(dir, "git", "momm", "update-clock.json");
  const time = { t: 1_800_000_000_000 }, calls = [];
  const responses = overrides.responses || {};
  const fetcher = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = typeof responses[url] === "function" ? responses[url](init) : responses[url];
    if (!r) return { status: 404, ok: false, headers: new Headers(), text: async () => "" };
    if (r.throw) throw new Error(r.throw);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: new Headers(r.headers || {}), text: async () => JSON.stringify(r.body || {}) };
  };
  const clock = createUpdateClock({ home, stateFile, fetcher, now: () => time.t, random: overrides.random || (() => 0.5), installedVersions: overrides.installed || { skill: "1.15.1", codex: "0.154.0" }, sources: overrides.sources || [skillSource(), npmSource("codex")], exec: overrides.exec, listModels: overrides.listModels, routes: overrides.routes, isAlive: overrides.isAlive });
  return { home, stateFile, time, calls, clock, responses };
}
const ok = (version, etag = '"v1"') => ({ status: 200, headers: { etag, "last-modified": "Sat, 12 Sep 2026 10:00:00 GMT" }, body: { momm: version, version } });
const CODEX_URL = "https://registry.npmjs.org/@openai%2fcodex/latest";

await test("defaults: auto_update off, intervals 30 min / 24 h, validation rejects bad types", () => {
  const { home } = env();
  const s = readSettings(home);
  assert.equal(s.auto_update.enabled, false); assert.equal(s.auto_update.accept_protocol, false);
  assert.equal(s.clock.min_interval_ms, 30 * 60_000); assert.equal(s.clock.max_interval_ms, 24 * 3_600_000);
  assert.throws(() => writeSettings(home, { auto_update: { enabled: "yes" } }), /true or false/);
  assert.throws(() => writeSettings(home, { clock: { min_interval_ms: 48 * 3_600_000 } }), /must not exceed/);
  writeSettings(home, { auto_update: { enabled: true } });
  assert.equal(readSettings(home).auto_update.enabled, true);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(home, ".momm", "settings.json")).mode & 0o777, 0o600);
});

await test("first trigger runs due sources; review.finish before due is nothing_due; manual forces", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.15.1"), [CODEX_URL]: ok("0.154.0") } });
  const first = await e.clock.trigger("startup");
  assert.equal(first.ran, true); assert.equal(first.results.length, 2);
  assert.equal(e.calls[0].headers["User-Agent"].startsWith("momm-update-clock/"), true);
  assert.equal(e.calls[0].headers["If-None-Match"], undefined);
  e.time.t += 60_000;
  const again = await e.clock.trigger("review.finish");
  assert.equal(again.ran, false); assert.equal(again.skipped_reason, "nothing_due");
  const forced = await e.clock.trigger("manual");
  assert.equal(forced.ran, true); assert.equal(forced.results.length, 2);
  assert.equal(e.calls[2].headers["If-None-Match"], '"v1"', "second request is conditional");
  assert.equal(e.calls[2].headers["If-Modified-Since"], "Sat, 12 Sep 2026 10:00:00 GMT");
  assert.equal((await e.clock.trigger("setup.check")).ran, true);
});

await test("review.start is rate-limited to one check per min_interval overall", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.15.1"), [CODEX_URL]: ok("0.154.0") } });
  assert.equal((await e.clock.trigger("review.start")).ran, true);
  const st = readState(e.stateFile); for (const s of Object.values(st.sources)) s.next_due_at = 0; writeState(e.stateFile, st);
  e.time.t += MIN - 1;
  assert.equal((await e.clock.trigger("review.start")).skipped_reason, "rate_limited");
  assert.equal((await e.clock.trigger("review.finish")).ran, true, "other events are not gated by the review.start limiter");
  const st2 = readState(e.stateFile); for (const s of Object.values(st2.sources)) s.next_due_at = 0; writeState(e.stateFile, st2);
  e.time.t += 2;
  assert.equal((await e.clock.trigger("review.start")).ran, true);
});

await test("adaptive interval: doubles to max on unchanged (304), resets to min on change, unchanged on error", async () => {
  let mode = "baseline";
  const e = env({ responses: { [MANIFEST_URL]: () => mode === "baseline" ? ok("1.15.1") : mode === "304" ? { status: 304 } : mode === "error" ? { throw: "socket hang up" } : ok("1.16.0", '"v2"') }, sources: [skillSource()] });
  await e.clock.trigger("manual");
  const iv = () => readState(e.stateFile).sources.skill.interval_ms;
  assert.equal(iv(), MIN * 2, "first observation is a baseline and counts as unchanged");
  mode = "304"; await e.clock.trigger("manual");
  assert.equal(iv(), MIN * 4, "a 304 doubles again");
  for (let i = 0; i < 10; i++) await e.clock.trigger("manual");
  assert.equal(iv(), MAX, "capped at max_interval");
  mode = "error"; await e.clock.trigger("manual");
  assert.equal(iv(), MAX, "error keeps the interval"); assert.match(readState(e.stateFile).sources.skill.last_error, /socket hang up/);
  mode = "200"; await e.clock.trigger("manual");
  const s = readState(e.stateFile).sources.skill;
  assert.equal(s.interval_ms, MIN, "detected release pins to min"); assert.equal(s.last_seen_version, "1.16.0"); assert.equal(s.etag, '"v2"'); assert.equal(s.last_error, null);
  mode = "304"; await e.clock.trigger("manual");
  assert.equal(iv(), MIN, "stays at min inside the 24 h release window");
  e.time.t += 25 * 3_600_000; await e.clock.trigger("manual");
  assert.equal(iv(), MIN * 2, "doubling resumes after the window");
});

await test("jitter keeps next_due_at within +/-10 % of the interval", async () => {
  for (const r of [0, 0.25, 0.5, 0.75, 1]) {
    const e = env({ responses: { [MANIFEST_URL]: ok("1.15.1") }, sources: [skillSource()], random: () => r });
    await e.clock.trigger("manual");
    const s = readState(e.stateFile).sources.skill, delay = s.next_due_at - e.time.t;
    assert(delay >= s.interval_ms * 0.9 - 1 && delay <= s.interval_ms * 1.1 + 1, `delay ${delay} for r=${r}`);
    assert.equal(delay, Math.round(s.interval_ms * (0.9 + 0.2 * r)));
  }
});

await test("lock: live pid blocks a concurrent run; dead-pid lock is cleared", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.15.1") }, sources: [skillSource()] });
  fs.mkdirSync(path.dirname(e.stateFile), { recursive: true });
  fs.writeFileSync(`${e.stateFile}.lock`, JSON.stringify({ pid: process.pid }));
  assert.equal((await e.clock.trigger("manual")).skipped_reason, "locked");
  const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
  fs.writeFileSync(`${e.stateFile}.lock`, JSON.stringify({ pid: dead }));
  assert.equal((await e.clock.trigger("manual")).ran, true, "stale lock removed and run proceeds");
  assert.equal(fs.existsSync(`${e.stateFile}.lock`), false, "lock released after run");
  const e2 = env({ responses: { [MANIFEST_URL]: ok("1.15.1") }, sources: [skillSource()], isAlive: () => true });
  fs.mkdirSync(path.dirname(e2.stateFile), { recursive: true }); fs.writeFileSync(`${e2.stateFile}.lock`, JSON.stringify({ pid: 4242 }));
  assert.equal((await e2.clock.trigger("manual")).skipped_reason, "locked");
});

await test("status shape, update_available, overhead estimate", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.16.0"), [CODEX_URL]: ok("0.154.0") } });
  await e.clock.trigger("manual");
  const s = e.clock.status();
  assert.deepEqual(Object.keys(s).sort(), ["auto_update", "clock", "history_entries", "overhead_estimate_per_day", "sources"]);
  const skill = s.sources.find(r => r.name === "skill"), codex = s.sources.find(r => r.name === "cli:codex");
  for (const k of ["name", "last_checked_at", "next_due_at", "interval_ms", "latest", "installed", "update_available", "last_error"]) assert(k in skill, k);
  assert.equal(skill.update_available, true); assert.equal(skill.latest, "1.16.0"); assert.equal(skill.installed, "1.15.1");
  assert.equal(codex.update_available, false);
  assert.equal(s.auto_update.enabled, false);
  assert.equal(typeof s.overhead_estimate_per_day, "number"); assert.equal(s.overhead_estimate_per_day, 2 * Math.ceil(MAX / (MIN * 2)));
  assert.match(skill.last_checked_at, /^\d{4}-\d\d-\d\dT/);
});

await test("grok and antigravity sources: check-only JSON vs unknown, never running an updater", async () => {
  const execs = [];
  const exec = async (cmd, args) => { execs.push([cmd, ...args]); return { code: 0, stdout: JSON.stringify({ updateAvailable: true, latestVersion: "1.0.31" }), stderr: "" }; };
  const e = env({ sources: [grokSource(), antigravitySource()], exec, installed: { grok: "1.0.30", antigravity: "1.2.2" } });
  await e.clock.trigger("manual");
  assert.deepEqual(execs, [["grok", "update", "--check", "--stable", "--json"]]);
  const s = e.clock.status();
  assert.equal(s.sources[0].update_available, true); assert.equal(s.sources[0].latest, "1.0.31");
  assert.equal(s.sources[1].status, "unknown"); assert.equal(s.sources[1].update_available, null);
  assert.equal(s.overhead_estimate_per_day, Math.ceil(MAX / (MIN * 2)), "antigravity costs nothing");
});

await test("applyUpdates does nothing while disabled", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.16.0") }, sources: [skillSource()] });
  await e.clock.trigger("manual");
  let ran = false;
  const out = await applyUpdates(e.clock, { runUpdater: async () => { ran = true; return { code: 0, output: "" }; } });
  assert.equal(ran, false); assert.deepEqual(out.applied, []); assert.match(out.skipped[0].reason, /enabled is false/);
});

const PREVIEW = "Protocol / default-rules / persona diff (full dispatcher diff for conservative coverage):\nNo policy changes.\nPreview complete. No installed files, refs, links or receipt changed.\n";
await test("skill: applies only after a successful dry-run; failed dry-run or apply never bypasses", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.16.0") }, sources: [skillSource()] });
  writeSettings(e.home, { auto_update: { enabled: true } });
  await e.clock.trigger("manual");
  let calls = [];
  const runUpdater = async args => { calls.push(args); return args[0] === "--dry-run" ? { code: 0, output: PREVIEW } : { code: 0, output: "Installed and verified 1.16.0." }; };
  const out = await applyUpdates(e.clock, { runUpdater });
  assert.deepEqual(calls, [["--dry-run"], ["--apply", "--yes"]]);
  assert.deepEqual(out.applied, [{ name: "skill", from: "1.15.1", to: "1.16.0" }]);
  assert.equal(readState(e.stateFile).history.at(-1).outcome, "applied");
  const e2 = env({ responses: { [MANIFEST_URL]: ok("1.16.0") }, sources: [skillSource()] });
  writeSettings(e2.home, { auto_update: { enabled: true } }); await e2.clock.trigger("manual");
  calls = [];
  const failed = await applyUpdates(e2.clock, { runUpdater: async args => { calls.push(args); return { code: 1, output: "Trusted release signature not verified." }; } });
  assert.deepEqual(calls, [["--dry-run"]], "no --apply after a failed dry-run");
  assert.equal(failed.failed[0].reason, "dry-run failed"); assert.deepEqual(failed.applied, []);
  assert.match(readState(e2.stateFile).sources.skill.last_error, /dry-run failed/);
  assert.equal(readSettings(e2.home).auto_update.enabled, true, "failure disables nothing");
  calls = [];
  const applyFail = await applyUpdates(e2.clock, { runUpdater: async args => { calls.push(args); return args[0] === "--dry-run" ? { code: 0, output: PREVIEW } : { code: 1, output: "Previous installation restored; update not applied." }; } });
  assert.equal(applyFail.failed[0].name, "skill"); assert.equal(calls.length, 2);
});

await test("protocol change blocks unless accept_protocol, then passes --accept-protocol", async () => {
  const diff = PREVIEW.replace("No policy changes.", "--- a/momm/SKILL.md\n+++ b/momm/SKILL.md\n+new rule");
  const e = env({ responses: { [MANIFEST_URL]: ok("1.16.0") }, sources: [skillSource()] });
  writeSettings(e.home, { auto_update: { enabled: true } }); await e.clock.trigger("manual");
  let calls = [];
  const runUpdater = async args => { calls.push(args); return { code: 0, output: args[0] === "--dry-run" ? diff : "Installed" }; };
  const blocked = await applyUpdates(e.clock, { runUpdater });
  assert.deepEqual(calls, [["--dry-run"]]); assert.equal(blocked.skipped[0].reason, "needs_protocol_acceptance");
  assert.equal(e.clock.status().sources[0].needs_protocol_acceptance, true);
  assert.match(blocked.notices[0], /changes the review protocol/);
  writeSettings(e.home, { auto_update: { accept_protocol: true } }); calls = [];
  const applied = await applyUpdates(e.clock, { runUpdater });
  assert.deepEqual(calls, [["--dry-run"], ["--apply", "--yes", "--accept-protocol"]]); assert.equal(applied.applied.length, 1);
});

await test("cli: exact official command, re-read version, probe recorded, managed installs refused", async () => {
  const e = env({ responses: { [CODEX_URL]: ok("0.155.0") }, sources: [npmSource("codex")] });
  writeSettings(e.home, { auto_update: { enabled: true } }); await e.clock.trigger("manual");
  const execs = [], probes = [];
  const out = await applyUpdates(e.clock, {
    exec: async (cmd, args, o) => { execs.push({ cmd, args, timeout: o.timeout }); return { code: 0, stdout: "", stderr: "" }; },
    versionOf: async cli => `codex-cli 0.155.0`, postUpdateProbe: async cli => { probes.push(cli); return { status: "contained" }; },
  });
  assert.deepEqual(execs, [{ cmd: "npm", args: ["install", "-g", "@openai/codex@latest"], timeout: 600_000 }]);
  assert.equal(`${execs[0].cmd} ${execs[0].args.join(" ")}`, UPDATE_COMMANDS.codex);
  assert.deepEqual(probes, ["codex"]);
  assert.deepEqual(out.applied, [{ name: "cli:codex", command: UPDATE_COMMANDS.codex, from: "0.154.0", to: "0.155.0", probe: { status: "contained" } }]);
  assert.equal(e.clock.status().sources[0].installed, "0.155.0"); assert.equal(e.clock.status().sources[0].update_available, false);
  const e2 = env({ responses: { [CODEX_URL]: ok("0.155.0") }, sources: [npmSource("codex")] });
  writeSettings(e2.home, { auto_update: { enabled: true } }); await e2.clock.trigger("manual");
  let ran = false;
  const refused = await applyUpdates(e2.clock, { exec: async () => { ran = true; return { code: 0 }; }, isManaged: () => true });
  assert.equal(ran, false); assert.match(refused.skipped[0].reason, /package-manager-owned/);
  writeSettings(e2.home, { auto_update: { clis: false } });
  const off = await applyUpdates(e2.clock, { exec: async () => { ran = true; return { code: 0 }; } });
  assert.equal(ran, false); assert.deepEqual(off.applied, []);
});

await test("models: hash recorded, new models surfaced as notices, nothing mutated", async () => {
  let lists = { grok: ["grok-4", "grok-4-fast"] };
  const e = env({ sources: [modelsSource()], listModels: async r => lists[r] || null, routes: ["grok", "codex"], installed: { grok: "1.0.30", codex: "0.154.0" } });
  writeSettings(e.home, { auto_update: { enabled: true } });
  await e.clock.trigger("manual");
  const s1 = readState(e.stateFile).sources.models;
  assert.equal(Object.keys(s1.models).join(), "grok"); assert.equal(s1.consecutive_unchanged, 1, "first observation is a baseline, not a change");
  lists = { grok: ["grok-4", "grok-4-fast", "grok-5"] };
  await e.clock.trigger("manual");
  const s2 = readState(e.stateFile).sources.models;
  assert.equal(s2.interval_ms, MIN, "changed model list tightens"); assert.deepEqual(s2.new_models, { grok: ["grok-5"] });
  const settingsBefore = JSON.stringify(readSettings(e.home));
  const out = await applyUpdates(e.clock, { exec: async () => { throw new Error("must not exec"); }, runUpdater: async () => { throw new Error("must not run updater"); } });
  assert.deepEqual(out.applied, []); assert.match(out.notices[0], /new models available for grok: grok-5/);
  assert.equal(JSON.stringify(readSettings(e.home)), settingsBefore);
  assert.equal(e.clock.status().sources[0].update_available, null);
});

await test("history is capped at 200 entries", async () => {
  const e = env({ responses: { [MANIFEST_URL]: { status: 304 } }, sources: [skillSource()] });
  const st = readState(e.stateFile); st.history = Array.from({ length: 199 }, (_, i) => ({ at: i, trigger: "manual", source: "skill", outcome: "unchanged" })); writeState(e.stateFile, st);
  await e.clock.trigger("manual"); assert.equal(readState(e.stateFile).history.length, 200);
  await e.clock.trigger("manual"); await e.clock.trigger("manual");
  const h = readState(e.stateFile).history;
  assert.equal(h.length, 200); assert.equal(h[0].at, 2, "oldest entries dropped first");
});

await test("timerCommand strings per platform; installTimer refuses without confirm", async () => {
  const win = timerCommand("win32", "C:\\node.exe", "D:\\skills\\momm\\scripts\\update-clock.mjs");
  assert.equal(win.install, 'schtasks /Create /SC HOURLY /MO 6 /TN MOMM-UpdateClock /TR "\\"C:\\node.exe\\" \\"D:\\skills\\momm\\scripts\\update-clock.mjs\\" trigger daily.tick"');
  assert.equal(win.remove, "schtasks /Delete /TN MOMM-UpdateClock /F");
  const mac = timerCommand("darwin", "/usr/local/bin/node", "/s/update-clock.mjs", "/Users/x");
  assert.equal(mac.plist_path, "/Users/x/Library/LaunchAgents/uk.42.momm.update-clock.plist".split("/").join(path.sep));
  assert.equal(mac.install, `launchctl load "${mac.plist_path}"`); assert.match(mac.plist, /<integer>21600<\/integer>/); assert.match(mac.plist, /<string>daily.tick<\/string>/);
  const lin = timerCommand("linux", "/usr/bin/node", "/s/update-clock.mjs");
  assert.equal(lin.line, '0 */6 * * * "/usr/bin/node" "/s/update-clock.mjs" trigger daily.tick >/dev/null 2>&1 # MOMM-UpdateClock');
  assert.match(lin.install, /\| crontab -$/); assert.match(lin.remove, /grep -v MOMM-UpdateClock \| crontab -/);
  const execs = [];
  const exec = async cmd => { execs.push(cmd); return { code: 0, stdout: "", stderr: "" }; };
  const refused = await installTimer({ platform: "linux", nodePath: "/usr/bin/node", scriptPath: "/s/update-clock.mjs", exec });
  assert.equal(refused.done, false); assert.deepEqual(execs, []); assert.equal(refused.command, lin.install);
  const done = await installTimer({ platform: "linux", nodePath: "/usr/bin/node", scriptPath: "/s/update-clock.mjs", exec, confirm: true });
  assert.equal(done.done, true); assert.deepEqual(execs, [lin.install]);
});

await test("CLI entry: set parses keys and minutes, enable/disable toggle, status/trigger dispatch", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.15.1") }, sources: [skillSource()] });
  assert.deepEqual(parseSet("clis", "false"), { auto_update: { clis: false } });
  assert.deepEqual(parseSet("min_interval", "45"), { clock: { min_interval_ms: 45 * 60_000 } });
  assert.throws(() => parseSet("skill", "maybe"), /true or false/); assert.throws(() => parseSet("max_interval", "1.5"), /whole minutes/); assert.throws(() => parseSet("bogus", "1"), /Unknown setting/);
  const deps = { home: e.home, clock: e.clock };
  assert.equal((await cliMain(["enable"], deps)).auto_update.enabled, true);
  assert.equal((await cliMain(["disable"], deps)).auto_update.enabled, false);
  assert.equal((await cliMain(["set", "accept_protocol", "true"], deps)).auto_update.accept_protocol, true);
  assert.equal((await cliMain(["set", "max_interval", "720"], deps)).clock.max_interval_ms, 12 * 3_600_000);
  assert.equal((await cliMain(["trigger", "manual"], deps)).ran, true);
  assert.equal((await cliMain(["status"], deps)).sources[0].latest, "1.15.1");
  await assert.rejects(cliMain(["trigger", "bogus"], deps), /Unknown update-clock event/);
  await assert.rejects(cliMain(["frobnicate"], deps), /Usage/);
  const timer = await cliMain(["timer", "install"], { ...deps, timer: { platform: "linux", nodePath: "/n", scriptPath: "/s", exec: async () => ({ code: 0 }) } });
  assert.equal(timer.done, false);
  const direct = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "update-clock.mjs"), "set", "models", "sideways"], { encoding: "utf8", env: { ...process.env, HOME: e.home, USERPROFILE: e.home } });
  assert.equal(direct.status, 1); assert.match(direct.stderr, /must be true or false/);
});

fs.rmSync(fixture, { recursive: true, force: true });
console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
