#!/usr/bin/env node
// update-clock tests: temp home + state, fake fetcher/exec/clock, no network.
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import util from "node:util";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as UC from "./update-clock.mjs";
import { createUpdateClock, applyUpdates, readSettings, writeSettings, DEFAULT_SETTINGS, skillSource, npmSource, grokSource, antigravitySource, modelsSource, timerCommand, installTimer, parseSet, cliMain, UPDATE_COMMANDS, CLIS, readState, writeState, defaultFetcher, defaultExec, defaultRunUpdater } from "./update-clock.mjs";
import { MANIFEST_URL } from "./update.mjs";
const defaultApplyDeps = (...a) => UC.defaultApplyDeps(...a);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "momm-update-clock-"));
const passed = [], failures = [];
let n = 0;
// A test that cannot run on this platform returns { skip: reason }: it is listed under
// `skipped`, never under `passed`, so a no-op is not reported as a green Windows case.
const skipped = {};
async function test(name, fn) { try { const r = await fn(); if (r?.skip) skipped[name] = r.skip; else passed.push(name); } catch (e) { failures.push({ name, error: e.message }); } }
const MIN = DEFAULT_SETTINGS.clock.min_interval_ms, MAX = DEFAULT_SETTINGS.clock.max_interval_ms;
function env(overrides = {}) {
  const dir = path.join(fixture, `case-${n++}`); fs.mkdirSync(dir);
  const home = path.join(dir, "home"), stateFile = path.join(dir, "git", "momm", "update-clock.json");
  const time = { t: 1_800_000_000_000 }, calls = [];
  const responses = overrides.responses || {};
  const fetcher = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = typeof responses[url] === "function" ? await responses[url](init) : responses[url];
    if (!r) return { status: 404, ok: false, headers: new Headers(), text: async () => "" };
    if (r.throw) throw new Error(r.throw);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: new Headers(r.headers || {}), text: async () => JSON.stringify(r.body || {}) };
  };
  const clock = createUpdateClock({ home, stateFile, fetcher, env: overrides.env || {}, now: () => time.t, random: overrides.random || (() => 0.5), installedVersions: overrides.installed || { skill: "1.15.1", codex: "0.154.0" }, sources: overrides.sources || [skillSource(), npmSource("codex")], exec: overrides.exec, listModels: overrides.listModels, routes: overrides.routes, isAlive: overrides.isAlive });
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
  // skill: 1.16.0 newer than the installed 1.15.1 on first sight is a detected release (stays at MIN); codex: unchanged, doubled.
  assert.equal(typeof s.overhead_estimate_per_day, "number"); assert.equal(s.overhead_estimate_per_day, Math.ceil(MAX / MIN) + Math.ceil(MAX / (MIN * 2)));
  assert.equal(skill.last_checked_at, new Date(e.time.t).toISOString(), "the injected clock, not the wall clock, stamps the check");
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
  assert.equal(s.overhead_estimate_per_day, Math.ceil(MAX / MIN), "antigravity costs nothing; grok's newer-than-installed first sighting pins to MIN");
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
  assert.equal(e.clock.status().sources[0].needs_protocol_acceptance, false, "flag cleared once the protocol change is applied with --accept-protocol");
});

await test("needs_protocol_acceptance is cleared by any later successful skill apply, even without --accept-protocol", async () => {
  const diff = PREVIEW.replace("No policy changes.", "--- a/momm/SKILL.md\n+++ b/momm/SKILL.md\n+new rule");
  const e = env({ responses: { [MANIFEST_URL]: ok("1.16.0") }, sources: [skillSource()] });
  writeSettings(e.home, { auto_update: { enabled: true } }); await e.clock.trigger("manual");
  await applyUpdates(e.clock, { runUpdater: async () => ({ code: 0, output: diff }) });
  assert.equal(e.clock.status().sources[0].needs_protocol_acceptance, true, "precondition: flag set by the blocked apply");
  const calls = [];
  const out = await applyUpdates(e.clock, { runUpdater: async args => { calls.push(args); return { code: 0, output: args[0] === "--dry-run" ? PREVIEW : "Installed" }; } });
  assert.deepEqual(calls, [["--dry-run"], ["--apply", "--yes"]]); assert.equal(out.applied.length, 1);
  assert.equal(e.clock.status().sources[0].needs_protocol_acceptance, false, "a release without protocol changes applies and clears the stale flag");
  assert.equal(readState(e.stateFile).sources.skill.needs_protocol_acceptance, false, "cleared in the persisted state, not only in memory");
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
  const mac = timerCommand("darwin", "/usr/local/bin/node", "/s/update-clock.mjs", "/opt/x");
  assert.equal(mac.plist_path, "/opt/x/Library/LaunchAgents/uk.42.momm.update-clock.plist".split("/").join(path.sep));
  assert.equal(mac.install, `launchctl load '${mac.plist_path}'`); assert.match(mac.plist, /<integer>21600<\/integer>/); assert.match(mac.plist, /<string>daily.tick<\/string>/);
  const lin = timerCommand("linux", "/usr/bin/node", "/s/update-clock.mjs");
  assert.equal(lin.line, "0 */6 * * * '/usr/bin/node' '/s/update-clock.mjs' trigger daily.tick >/dev/null 2>&1 # MOMM-UpdateClock");
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

// ---- momm run rev_20260913144715_1e05 reproductions --------------------------
// A pid-less lock older than the 2 s publication grace is a crashed writer, not one still publishing its pid.
const aged = file => { const past = new Date(Date.now() - 10_000); fs.utimesSync(file, past, past); };
await test("lock: aged empty or truncated lock file is corrupt -> removed with a recorded notice, never thrown", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.15.1") }, sources: [skillSource()] });
  fs.mkdirSync(path.dirname(e.stateFile), { recursive: true });
  fs.writeFileSync(`${e.stateFile}.lock`, ""); aged(`${e.stateFile}.lock`);
  const first = await e.clock.trigger("manual");
  assert.equal(first.ran, true, "0-byte lock (crash right after openSync) is stale; the run proceeds");
  assert.equal(fs.existsSync(`${e.stateFile}.lock`), false, "lock released after run");
  fs.writeFileSync(`${e.stateFile}.lock`, '{"pid": 12'); aged(`${e.stateFile}.lock`);
  assert.equal((await e.clock.trigger("manual")).ran, true, "truncated JSON lock is stale too");
  fs.writeFileSync(`${e.stateFile}.lock`, JSON.stringify({ pid: "not-a-pid" })); aged(`${e.stateFile}.lock`);
  assert.equal((await e.clock.trigger("manual")).ran, true, "lock without a usable pid is stale");
  const notices = readState(e.stateFile).history.filter(h => h.source === "lock");
  assert.equal(notices.length, 3, "each removal is recorded in history");
  for (const h of notices) { assert.equal(h.outcome, "stale_lock_removed"); assert.match(h.notice, /empty|corrupt|unreadable/i); assert.equal(h.trigger, "manual"); }
  const e2 = env({ responses: { [MANIFEST_URL]: ok("1.15.1") }, sources: [skillSource()] });
  fs.mkdirSync(path.dirname(e2.stateFile), { recursive: true }); fs.writeFileSync(`${e2.stateFile}.lock`, ""); aged(`${e2.stateFile}.lock`);
  await e2.clock.trigger("manual"); e2.time.t += 60_000; fs.writeFileSync(`${e2.stateFile}.lock`, ""); aged(`${e2.stateFile}.lock`);
  const idle = await e2.clock.trigger("review.finish");
  assert.equal(idle.skipped_reason, "nothing_due"); assert.equal(fs.existsSync(`${e2.stateFile}.lock`), false);
  assert.equal(readState(e2.stateFile).history.filter(h => h.source === "lock").length, 2, "notice recorded even when nothing was due");
});

await test("applyUpdates takes the clock lock: live-pid lock -> skipped_reason locked; cannot interleave with an in-flight trigger", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.16.0") }, sources: [skillSource()] });
  writeSettings(e.home, { auto_update: { enabled: true } });
  await e.clock.trigger("manual");
  const historyBefore = readState(e.stateFile).history.length;
  fs.writeFileSync(`${e.stateFile}.lock`, JSON.stringify({ pid: process.pid }));
  let ran = false;
  const locked = await applyUpdates(e.clock, { runUpdater: async () => { ran = true; return { code: 0, output: PREVIEW }; } });
  assert.equal(locked.skipped_reason, "locked"); assert.equal(ran, false, "updater never invoked under a foreign live lock");
  assert.deepEqual([locked.applied, locked.skipped, locked.failed, locked.notices], [[], [], [], []], "module's own result shape, so setup-ui renders it");
  assert.equal(readState(e.stateFile).history.length, historyBefore, "state untouched");
  assert.equal(fs.existsSync(`${e.stateFile}.lock`), true, "a lock we do not own is left alone");
  fs.unlinkSync(`${e.stateFile}.lock`);
  let release; const gate = new Promise(r => { release = r; });
  e.responses[MANIFEST_URL] = async () => { await gate; return ok("1.16.0", '"v3"'); };
  const inflight = e.clock.trigger("manual");
  await new Promise(r => setImmediate(r));
  const during = await applyUpdates(e.clock, { runUpdater: async a => ({ code: 0, output: a[0] === "--dry-run" ? PREVIEW : "Installed" }) });
  assert.equal(during.skipped_reason, "locked", "a trigger holding the lock blocks applyUpdates instead of racing its state write");
  release(); assert.equal((await inflight).ran, true);
  const out = await applyUpdates(e.clock, { runUpdater: async a => ({ code: 0, output: a[0] === "--dry-run" ? PREVIEW : "Installed" }) });
  assert.equal(out.applied.length, 1); assert.equal(out.skipped_reason, null);
  assert.equal(readState(e.stateFile).history.at(-1).outcome, "applied", "sequential apply after the trigger keeps its history");
  assert.equal(fs.existsSync(`${e.stateFile}.lock`), false, "applyUpdates releases the lock");
});

await test("grok: a successful update clears the stale hint; update_available compares the re-read version against latest", async () => {
  const exec = async (cmd, args) => cmd === "grok" && args[1] === "--check" ? { code: 0, stdout: JSON.stringify({ updateAvailable: true, latestVersion: "1.0.31" }), stderr: "" } : { code: 0, stdout: "", stderr: "" };
  const e = env({ sources: [grokSource()], exec, installed: { grok: "1.0.30" } });
  writeSettings(e.home, { auto_update: { enabled: true } });
  await e.clock.trigger("manual");
  assert.equal(e.clock.status().sources[0].update_available, true, "1.0.30 installed, 1.0.31 latest");
  e.clock.setInstalled("grok", "1.0.31");
  assert.equal(e.clock.status().sources[0].update_available, false, "installed == latest means no update, whatever the recorded hint says");
  e.clock.setInstalled("grok", "1.0.30");
  const execs = [];
  const applyExec = async (cmd, args) => { execs.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; };
  const first = await applyUpdates(e.clock, { exec: applyExec, versionOf: async () => "grok 1.0.31 (deadbeef)" });
  assert.deepEqual(execs, [["grok", "update"]]); assert.deepEqual(first.applied.map(a => [a.from, a.to]), [["1.0.30", "1.0.31"]]);
  const second = await applyUpdates(e.clock, { exec: applyExec, versionOf: async () => "grok 1.0.31 (deadbeef)" });
  assert.deepEqual(execs, [["grok", "update"]], "no second `grok update` once the re-read version matches latest");
  assert.deepEqual(second.applied, []);
  assert.equal(readState(e.stateFile).sources["cli:grok"].update_available_hint, undefined, "hint cleared in the persisted state");
  const fresh = createUpdateClock({ home: e.home, stateFile: e.stateFile, env: {}, sources: [grokSource()], exec, now: () => e.time.t, installedVersions: { grok: "1.0.31" } });
  assert.equal(fresh.status().sources[0].update_available, false, "a new process over the same state does not re-update");
  const unknown = createUpdateClock({ home: e.home, stateFile: e.stateFile, env: {}, sources: [grokSource()], exec, now: () => e.time.t, installedVersions: {} });
  assert.equal(unknown.status().sources[0].update_available, null, "unknown installed version and no hint -> unknown, not a loop");
});

await test("models source runs against every CLI route when installedVersions knows only the skill", async () => {
  const seen = [];
  const e = env({ sources: [modelsSource()], installed: { skill: "1.15.1" }, listModels: async r => { seen.push(r); return r === "grok" ? ["grok-4"] : null; } });
  const r = await e.clock.trigger("manual");
  assert.equal(r.results[0].outcome, "unchanged");
  assert.deepEqual(seen, CLIS, "routes default to the CLI list, not the empty set");
  assert.deepEqual(Object.keys(readState(e.stateFile).sources.models.models), ["grok"]);
  assert.equal(e.clock.status().sources[0].update_available, null, "models stay record-only");
  const seen2 = [];
  const e2 = env({ sources: [modelsSource()], installed: { skill: "1.15.1", codex: "0.154.0" }, listModels: async r => { seen2.push(r); return null; } });
  await e2.clock.trigger("manual");
  assert.deepEqual(seen2, ["codex"], "known installations still narrow the route list");
});

await test("timerCommand win32: /TR quoting for spaced paths is exact and survives cmd.exe -> CRT argv parsing", async () => {
  const node = "C:\\Program Files\\nodejs\\node.exe", script = "D:\\1code projects\\Claude\\momm\\scripts\\update-clock.mjs";
  const win = timerCommand("win32", node, script);
  assert.equal(win.install, 'schtasks /Create /SC HOURLY /MO 6 /TN MOMM-UpdateClock /TR "\\"C:\\Program Files\\nodejs\\node.exe\\" \\"D:\\1code projects\\Claude\\momm\\scripts\\update-clock.mjs\\" trigger daily.tick"');
  if (process.platform !== "win32") return;
  // schtasks.exe and node.exe both split argv with the Windows CRT rules, so swapping `schtasks` for a node
  // argv echo shows exactly what schtasks receives as its /TR value once cmd.exe has processed the line.
  const echo = spawnSync(`"${process.execPath}" -e "console.log(JSON.stringify(process.argv.slice(1)))" ${win.install.slice("schtasks ".length)}`, { shell: true, encoding: "utf8" });
  assert.equal(echo.status, 0, echo.stderr);
  const argv = JSON.parse(echo.stdout);
  assert.deepEqual(argv.slice(0, 8), ["/Create", "/SC", "HOURLY", "/MO", "6", "/TN", "MOMM-UpdateClock", "/TR"]);
  assert.equal(argv[8], `"${node}" "${script}" trigger daily.tick`, "the /TR value arrives as one argument with its inner quotes intact");
  assert.equal(argv.length, 9);
  // The inner command must itself launch a script whose path contains spaces.
  const dir = path.join(fixture, "spaced dir"); fs.mkdirSync(dir, { recursive: true });
  const spaced = path.join(dir, "echo args.mjs"); fs.writeFileSync(spaced, "console.log(JSON.stringify(process.argv.slice(2)))\n");
  const inner = timerCommand("win32", process.execPath, spaced).install.match(/\/TR "(.*)"$/)[1].replaceAll('\\"', '"');
  const run = spawnSync(inner, { shell: true, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), ["trigger", "daily.tick"]);
});

// ---- momm run rev_20260913152448_qqdw reproductions --------------------------
const CLAUDE_URL = "https://registry.npmjs.org/@anthropic-ai%2fclaude-code/latest";
const sh = (() => { try { return spawnSync("sh", ["-c", "echo ok"], { encoding: "utf8" }).stdout?.trim() === "ok"; } catch { return false; } })();

await test("scheduled-trigger-never-auto-applies: CLI `trigger <event>` applies after the check when enabled; says so when off; --no-apply checks only", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.16.0") }, sources: [skillSource()] });
  writeSettings(e.home, { auto_update: { enabled: true } });
  let calls = [];
  const runUpdater = async args => { calls.push(args); return { code: 0, output: args[0] === "--dry-run" ? PREVIEW : "Installed and verified 1.16.0." }; };
  const deps = { home: e.home, clock: e.clock, apply: { runUpdater } };
  const tick = await cliMain(["trigger", "daily.tick"], deps);
  assert.equal(tick.ran, true, "the check still runs");
  assert.deepEqual(calls, [["--dry-run"], ["--apply", "--yes"]], "the OS timer's daily.tick goes on to apply through the signed updater");
  assert.deepEqual(tick.apply.applied, [{ name: "skill", from: "1.15.1", to: "1.16.0" }]);
  assert.equal(readState(e.stateFile).history.at(-1).outcome, "applied");
  calls = [];
  const nothingDue = await cliMain(["trigger", "startup"], deps);
  assert.equal(nothingDue.skipped_reason, "nothing_due"); assert.deepEqual(calls, [], "nothing pending after the update: no updater run");
  assert.deepEqual(nothingDue.apply.applied, []);
  const e2 = env({ responses: { [MANIFEST_URL]: ok("1.16.0") }, sources: [skillSource()] });
  writeSettings(e2.home, { auto_update: { enabled: true } });
  calls = [];
  const checkOnly = await cliMain(["trigger", "daily.tick", "--no-apply"], { home: e2.home, clock: e2.clock, apply: { runUpdater } });
  assert.equal(checkOnly.ran, true); assert.deepEqual(calls, [], "--no-apply never reaches the updater");
  assert.equal(checkOnly.apply.skipped_reason, "no_apply"); assert.match(checkOnly.apply.note, /--no-apply/);
  writeSettings(e2.home, { auto_update: { enabled: false } });
  const off = await cliMain(["trigger", "manual"], { home: e2.home, clock: e2.clock, apply: { runUpdater: async () => { throw new Error("must not run while disabled"); } } });
  assert.equal(off.ran, true); assert.equal(off.apply.skipped_reason, "auto_update_disabled");
  assert.match(off.apply.note, /auto-update is off/i); assert.match(off.apply.skipped[0].reason, /enabled is false/);
  assert.equal(e2.clock.status().sources[0].update_available, true, "the pending release is still reported, just not applied");
});

await test("default apply deps: signed updater, async exec, `<cli> --version`, probes.mjs post-update probe, package-manager ownership", async () => {
  const execs = [];
  const d = await defaultApplyDeps({ exec: async (cmd, args, o) => { execs.push({ cmd, args, timeout: o.timeout }); return { code: 0, stdout: "codex-cli 0.155.0\n", stderr: "" }; } });
  assert.equal(d.runUpdater, defaultRunUpdater);
  assert.equal(await d.versionOf("codex"), "codex-cli 0.155.0");
  assert.deepEqual(execs[0].args, ["--version"]); assert.equal(execs[0].cmd, "codex"); assert(execs[0].timeout <= 30_000);
  await d.versionOf("antigravity");
  assert.match(path.basename(execs[1].cmd), /^agy/, "antigravity's binary is agy");
  assert.equal(typeof d.postUpdateProbe, "function", "probes.mjs is importable here, so post-update probes are wired");
  assert.equal(typeof d.isManaged("codex"), "boolean");
  assert.equal(d.isManaged("codex", { path: "/opt/u/.volta/bin/codex" }), true, "volta/scoop/... path fragments mean package-manager owned");
  assert.equal(d.isManaged("codex", { path: "/opt/homebrew/Cellar/codex/1/bin/codex" }), true, "homebrew too");
  assert.equal(d.isManaged("codex", { path: "/usr/local/lib/node_modules/@openai/codex/bin/codex" }), false);
  const fallback = await defaultApplyDeps({ exec: async () => ({ code: 1, stdout: "", stderr: "not found" }) });
  assert.equal(await fallback.versionOf("grok"), null, "a failed --version is unknown, not a version");
});

await test("timer-unescaped-paths: apostrophes, ampersands and $ in paths are escaped for sh, cron and plist XML", async () => {
  const node = "/opt/o'reilly & co/node", script = "/tmp/Alice's repo/a<b>$HOME/update-clock.mjs";
  const lin = timerCommand("linux", node, script);
  assert.equal(lin.line.includes(`'${script}'`), false, "the raw path is never dropped into single quotes");
  assert.match(lin.line, /^0 \*\/6 \* \* \* '\/opt\/o'\\''reilly & co\/node' '\/tmp\/Alice'\\''s repo\/a<b>\$HOME\/update-clock\.mjs' trigger daily\.tick >\/dev\/null 2>&1 # MOMM-UpdateClock$/);
  assert.match(lin.install, /^\( crontab -l 2>\/dev\/null \| grep -v MOMM-UpdateClock; echo '.*' \) \| crontab -$/s);
  const pct = timerCommand("linux", "/usr/bin/node", "/srv/100%/update-clock.mjs");
  assert.match(pct.line, /\/srv\/100\\%\/update-clock\.mjs/, "cron turns an unescaped % into a newline");
  if (sh) {
    for (const c of [lin, pct]) assert.equal(spawnSync("sh", ["-n", "-c", c.install], { encoding: "utf8" }).status, 0, `install line parses: ${c.install}`);
    const echo = spawnSync("sh", ["-c", lin.install.match(/; (echo .*) \) \| crontab -$/s)[1]], { encoding: "utf8" });
    assert.equal(echo.stdout, `${lin.line}\n`, "echo reproduces the crontab line byte for byte");
    const argv = spawnSync("sh", ["-c", `printf '%s\\n' ${lin.line.split(" ").slice(5).join(" ").replace(/ trigger daily\.tick.*$/, "")}`], { encoding: "utf8" });
    assert.deepEqual(argv.stdout.split("\n").slice(0, 2), [node, script], "the shell hands node and the script path back intact");
  }
  const mac = timerCommand("darwin", node, script, "/opt/x y");
  assert.equal(mac.plist.includes(node), false); assert.equal(mac.plist.includes(script), false);
  assert.match(mac.plist, /<string>\/opt\/o&apos;reilly &amp; co\/node<\/string><string>\/tmp\/Alice&apos;s repo\/a&lt;b&gt;\$HOME\/update-clock\.mjs<\/string>/);
  assert.equal(mac.install, `launchctl load '${mac.plist_path}'`);
  const quoted = timerCommand("darwin", "/n", "/s", "/opt/it's");
  assert.equal(quoted.install, `launchctl load '${quoted.plist_path.replaceAll("'", "'\\''")}'`);
  const win = timerCommand("win32", "C:\\Program Files\\nodejs\\node.exe", "D:\\1code projects\\Claude\\momm\\scripts\\update-clock.mjs");
  assert.equal(win.install, 'schtasks /Create /SC HOURLY /MO 6 /TN MOMM-UpdateClock /TR "\\"C:\\Program Files\\nodejs\\node.exe\\" \\"D:\\1code projects\\Claude\\momm\\scripts\\update-clock.mjs\\" trigger daily.tick"', "the verified Windows CRT quoting is unchanged");
});

await test("first-seen-skips-tight-window: a first sighting newer than the installed version is a detected release", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.16.0"), [CODEX_URL]: ok("0.154.0") } });
  await e.clock.trigger("manual");
  const skill = readState(e.stateFile).sources.skill, codex = readState(e.stateFile).sources["cli:codex"];
  assert.equal(skill.interval_ms, MIN, "1.16.0 > installed 1.15.1 pins the interval");
  assert.equal(skill.tight_until, e.time.t + 24 * 3_600_000, "and opens the 24 h release window");
  assert.equal(skill.consecutive_unchanged, 0);
  assert.equal(codex.interval_ms, MIN * 2, "latest == installed on first sight stays a baseline");
  const older = env({ responses: { [MANIFEST_URL]: ok("1.15.0") }, sources: [skillSource()] });
  await older.clock.trigger("manual");
  assert.equal(readState(older.stateFile).sources.skill.interval_ms, MIN * 2, "a latest older than installed (pinned/prerelease install) is not a release");
  const unknown = env({ responses: { [MANIFEST_URL]: ok("1.16.0") }, sources: [skillSource()], installed: {} });
  await unknown.clock.trigger("manual");
  assert.equal(readState(unknown.stateFile).sources.skill.interval_ms, MIN * 2, "unknown installed version: nothing to compare, baseline");
});

await test("corrupt-settings-state-throws: unparseable settings.json or state -> defaults plus a recorded notice, never a throw", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.15.1") }, sources: [skillSource()] });
  fs.mkdirSync(path.join(e.home, ".momm"), { recursive: true }); fs.writeFileSync(path.join(e.home, ".momm", "settings.json"), "{");
  assert.deepEqual(readSettings(e.home), DEFAULT_SETTINGS, "defaults stand in for the corrupt file");
  const r = await e.clock.trigger("review.start");
  assert.equal(r.ran, true, "the review is not failed by a truncated settings file");
  const notice = readState(e.stateFile).history.find(h => h.source === "settings");
  assert.equal(notice?.outcome, "corrupt_settings_ignored"); assert.match(notice.notice, /settings\.json/); assert.equal(notice.trigger, "review.start");
  assert.equal(e.clock.status().auto_update.enabled, false, "status also reads through");
  fs.writeFileSync(path.join(e.home, ".momm", "settings.json"), JSON.stringify({ auto_update: { enabled: "yes" } }));
  assert.equal((await e.clock.trigger("manual")).ran, true, "an invalid value is ignored the same way");
  assert.equal(readState(e.stateFile).history.filter(h => h.source === "settings" && /enabled must be true or false/.test(h.notice || "")).length, 1, "the invalid value is recorded once, wherever the row lands");
  writeSettings(e.home, { auto_update: { clis: false } });
  assert.deepEqual(readSettings(e.home).auto_update, { ...DEFAULT_SETTINGS.auto_update, clis: false }, "writeSettings heals the file from defaults");
  fs.writeFileSync(e.stateFile, '{"sources": {"skill": {');
  const s = e.clock.status(); assert.equal(s.history_entries, 0, "corrupt state reads as fresh");
  const again = await e.clock.trigger("manual");
  assert.equal(again.ran, true);
  const st = readState(e.stateFile);
  assert.equal(st.history[0].source, "state"); assert.equal(st.history[0].outcome, "corrupt_state_reset"); assert.match(st.history[0].notice, /update-clock\.json/);
  assert.equal(st.sources.skill.last_seen_version, "1.15.1", "state rebuilt and persisted");
  fs.writeFileSync(e.stateFile, "not json");
  writeSettings(e.home, { auto_update: { enabled: true } });
  const applied = await applyUpdates(e.clock, { runUpdater: async () => ({ code: 0, output: PREVIEW }) });
  assert.equal(applied.skipped_reason, null, "applyUpdates survives a corrupt state file too");
  assert.equal((await e.clock.record([{ at: 1, trigger: "x", source: "y", outcome: "z" }])).recorded, true);
});

await test("probe-exception-loses-update-accounting: a failing probe or version read is recorded on the applied row and the batch continues", async () => {
  const e = env({ responses: { [CODEX_URL]: ok("0.155.0"), [CLAUDE_URL]: ok("2.0.0") }, sources: [npmSource("codex"), npmSource("claude")], installed: { skill: "1.15.1", codex: "0.154.0", claude: "1.0.0" } });
  writeSettings(e.home, { auto_update: { enabled: true } }); await e.clock.trigger("manual");
  const execs = [];
  const out = await applyUpdates(e.clock, {
    exec: async (cmd, args) => { execs.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; },
    versionOf: async cli => cli === "codex" ? "codex-cli 0.155.0" : "2.0.0 (Claude Code)",
    postUpdateProbe: async cli => { if (cli === "codex") throw new Error("probe timeout"); return { status: "contained" }; },
  });
  assert.deepEqual(execs, [["npm", "install", "-g", "@openai/codex@latest"], ["claude", "update"]], "the second CLI still updates");
  assert.equal(out.applied.length, 2); assert.deepEqual(out.failed, []);
  assert.equal(out.applied[0].to, "0.155.0"); assert.equal(out.applied[0].probe.status, "error"); assert.match(out.applied[0].probe.error, /probe timeout/);
  assert.deepEqual(out.applied[1].probe, { status: "contained" });
  const rows = e.clock.status().sources;
  assert.equal(rows[0].installed, "0.155.0"); assert.equal(rows[0].update_available, false, "the finished update is not retried");
  assert.equal(rows[1].installed, "2.0.0");
  const h = readState(e.stateFile).history.filter(x => x.outcome === "applied");
  assert.equal(h.length, 2); assert.match(h[0].notice, /probe error/);
  const e2 = env({ responses: { [CODEX_URL]: ok("0.155.0") }, sources: [npmSource("codex")] });
  writeSettings(e2.home, { auto_update: { enabled: true } }); await e2.clock.trigger("manual");
  const out2 = await applyUpdates(e2.clock, { exec: async () => ({ code: 0 }), versionOf: async () => { throw new Error("--version hung"); } });
  assert.equal(out2.applied.length, 1); assert.equal(out2.applied[0].to, null); assert.match(out2.notices[0], /unknown/);
});

await test("response-body-outlives-fetch-deadline: the abort timer covers the body; a headers-only server cannot hold the check open", async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.flushHeaders(); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/`;
  const started = Date.now();
  const outcome = await Promise.race([
    defaultFetcher(url, {}, { timeoutMs: 400 }).then(r => r.text()).then(() => "completed", e => `aborted: ${e.message}`),
    new Promise(r => setTimeout(() => r("still pending after 5 s"), 5_000)),
  ]);
  server.closeAllConnections(); server.close();
  assert.match(outcome, /^aborted/, outcome); assert(Date.now() - started < 4_000, "the deadline, not the 5 s guard, ended the read");
  assert.match(outcome, /timed out|abort/i);
});

await test("body-cap-after-slurp: the body is read as a stream and aborted past 1 MiB instead of being buffered whole", async () => {
  let sent = 0, closedEarly = false, clientClosed;
  const closed = new Promise(r => { clientClosed = r; });
  const CHUNK = Buffer.alloc(64 * 1024, 0x78), TOTAL = 16 * 1024 * 1024;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.on("error", () => {}); // a write racing the client's abort is expected, not a test failure
    res.on("close", () => { if (sent < TOTAL) closedEarly = true; clientClosed(); });
    const pump = () => { while (sent < TOTAL && !res.destroyed) { sent += CHUNK.length; if (!res.write(CHUNK)) { res.once("drain", pump); return; } } if (!res.destroyed) res.end(); };
    pump();
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/`;
  await assert.rejects(defaultFetcher(url).then(r => r.text()), /1 MiB|exceeds/);
  // The close must come from the CLIENT's abort: it is awaited (bounded) and judged
  // BEFORE closeAllConnections(), which would otherwise set the same flag itself.
  let bound; const observed = await Promise.race([closed.then(() => true), new Promise(r => { bound = setTimeout(() => r(false), 5_000); })]);
  clearTimeout(bound); // a prompt client close must not leave a 5 s handle behind
  const abortedByClient = observed && closedEarly;
  server.closeAllConnections(); server.close();
  assert.equal(abortedByClient, true, `client aborted mid-body (server had sent ${sent} of ${TOTAL} bytes)`);
  assert(sent < TOTAL / 2, `server was stopped well short of the full body: ${sent}`);
  const small = http.createServer((req, res) => { res.writeHead(200, { etag: '"e1"' }); res.end(JSON.stringify({ version: "1.2.3" })); });
  small.listen(0, "127.0.0.1"); await once(small, "listening");
  const r = await defaultFetcher(`http://127.0.0.1:${small.address().port}/`);
  assert.equal(r.status, 200); assert.equal(r.headers.get("etag"), '"e1"'); assert.deepEqual(JSON.parse(await r.text()), { version: "1.2.3" });
  small.closeAllConnections(); small.close();
});

await test("unavailable-model-list-erases-baseline: a null list keeps the route's baseline so later additions are still detected", async () => {
  const source = modelsSource();
  const replies = [["a"], null, ["a", "b"]];
  const ctx = { routes: ["codex"], listModels: async () => replies.shift() };
  const entry = {}; let result;
  for (let i = 0; i < 3; i++) { result = await source.check(ctx, entry); entry.models = result.models; }
  assert.deepEqual(result.new_models, { codex: ["b"] }); assert.equal(result.changed, true);
  const e = env({ sources: [modelsSource()], routes: ["grok"], installed: { grok: "1.0.30" }, listModels: async () => ["grok-4"] });
  await e.clock.trigger("manual");
  const e2 = createUpdateClock({ home: e.home, stateFile: e.stateFile, env: {}, sources: [modelsSource()], routes: ["grok"], installedVersions: { grok: "1.0.30" }, listModels: async () => null, now: () => e.time.t + 1, fetcher: async () => { throw new Error("no network"); } });
  const st = readState(e.stateFile); st.sources.models.next_due_at = 0; writeState(e.stateFile, st);
  assert.equal((await e2.trigger("manual")).ran, true);
  assert.deepEqual(Object.keys(readState(e.stateFile).sources.models.models), ["grok"], "an unavailable list leaves the stored baseline in place");
});

await test("models-new-models-replay: discoveries are reported once, not on every apply", async () => {
  let lists = { grok: ["grok-4"] };
  const e = env({ sources: [modelsSource()], listModels: async r => lists[r] || null, routes: ["grok"], installed: { grok: "1.0.30" } });
  writeSettings(e.home, { auto_update: { enabled: true } });
  await e.clock.trigger("manual"); lists = { grok: ["grok-4", "grok-5"] }; await e.clock.trigger("manual");
  const count = () => readState(e.stateFile).history.filter(h => /new models available for grok/.test(h.notice || "")).length;
  // Only the models source is configured, so no executor is reachable; the stubs make that a hard guarantee.
  const never = name => async () => { throw new Error(`${name} must never run in this test`); };
  const inert = { runUpdater: never("runUpdater"), exec: never("exec"), versionOf: never("versionOf"), isManaged: () => false };
  const first = await applyUpdates(e.clock, inert);
  assert.equal(first.notices.length, 1); assert.equal(count(), 1);
  const second = await applyUpdates(e.clock, inert);
  assert.equal(second.notices.length, 0, "no replay"); assert.equal(count(), 1, "history holds a single row");
  assert.equal(e.clock.status().sources[0].new_models, null, "the seen set is persisted as reported");
});

await test("lock-owner-publication-race: the pid is published atomically; a young pid-less lock is a writer, not stale; release only removes its own lock", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.15.1") }, sources: [skillSource()] });
  fs.mkdirSync(path.dirname(e.stateFile), { recursive: true });
  const lock = `${e.stateFile}.lock`;
  fs.writeFileSync(lock, "");
  const young = await e.clock.trigger("manual");
  assert.equal(young.skipped_reason, "locked", "an empty lock created moments ago is a process between create and publish");
  assert.equal(fs.existsSync(lock), true, "and it is left alone");
  assert.equal(readState(e.stateFile).history.length, 0, "no stale-lock notice is invented");
  aged(lock);
  assert.equal((await e.clock.trigger("manual")).ran, true, "the same file 10 s later is a crashed writer");
  let seen;
  await e.clock.locked(async () => {
    seen = JSON.parse(fs.readFileSync(lock, "utf8"));
    assert.deepEqual(fs.readdirSync(path.dirname(lock)).filter(f => f.endsWith(".tmp")), [], "no publication temp file lingers while the lock is held");
    fs.writeFileSync(lock, JSON.stringify({ pid: 999_999, at: "x" }));
  });
  assert.equal(seen.pid, process.pid, "our pid is readable the instant the lock exists");
  assert.equal(fs.existsSync(lock), true, "release skipped a lock that is no longer ours");
  assert.equal(JSON.parse(fs.readFileSync(lock, "utf8")).pid, 999_999);
  fs.unlinkSync(lock);
  await e.clock.locked(async () => {});
  assert.equal(fs.existsSync(lock), false, "our own lock is released");
});

await test("semver-strips-prerelease: prerelease text survives, so an RC is never mistaken for its stable", async () => {
  const e = env({ responses: { [CODEX_URL]: ok("2.0.0-rc.1") }, sources: [npmSource("codex")], installed: { codex: "2.0.0" } });
  await e.clock.trigger("manual");
  assert.equal(e.clock.status().sources[0].latest, "2.0.0-rc.1");
  assert.equal(e.clock.status().sources[0].update_available, false, "2.0.0-rc.1 is older than the installed 2.0.0");
  e.clock.setInstalled("codex", "1.9.0");
  assert.equal(e.clock.status().sources[0].update_available, true);
  writeSettings(e.home, { auto_update: { enabled: true } });
  const out = await applyUpdates(e.clock, { exec: async () => ({ code: 0 }), versionOf: async () => "codex-cli 2.0.0-rc.1" });
  assert.equal(out.applied[0].to, "2.0.0-rc.1"); assert.equal(e.clock.status().sources[0].installed, "2.0.0-rc.1");
  assert.equal(e.clock.status().sources[0].update_available, false);
  const grok = env({ sources: [grokSource()], exec: async () => ({ code: 0, stdout: JSON.stringify({ updateAvailable: false, latestVersion: "1.0.31-beta.2" }), stderr: "" }), installed: { grok: "1.0.31" } });
  await grok.clock.trigger("manual");
  assert.equal(grok.clock.status().sources[0].latest, "1.0.31-beta.2"); assert.equal(grok.clock.status().sources[0].update_available, false);
});

await test("async-api-uses-spawnsync: defaultExec/defaultRunUpdater return pending promises, honour the timeout and kill the process tree", async () => {
  // Child programs live in files: defaultExec runs through cmd.exe on win32 (npm .cmd shims), where inline JS punctuation is shell syntax.
  const prog = (name, src) => { const f = path.join(fixture, name); fs.writeFileSync(f, src); return f; };
  const sleeper = prog("sleep.cjs", "setTimeout(() => {}, 1200);\n");
  const start = Date.now();
  const p = defaultExec(process.execPath, [sleeper]);
  const mid = Date.now();
  assert(util.inspect(p).includes("pending"), "the promise is still pending when defaultExec returns");
  assert(mid - start < 800, `defaultExec returned after ${mid - start} ms: the event loop was blocked for the child's lifetime`);
  const r = await p;
  assert.equal(r.code, 0, r.stderr); assert.equal(r.timedOut, false); assert(Date.now() - start >= 1_000);
  const echo = await defaultExec(process.execPath, [prog("echo.cjs", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3);\n")]);
  assert.deepEqual([echo.code, echo.stdout, echo.stderr], [3, "out", "err"]);
  const missing = await defaultExec("momm-no-such-binary-xyz", ["--version"], { timeout: 5_000 });
  assert.notEqual(missing.code, 0, "a missing binary never reports success"); assert.equal(missing.timedOut, false);
  // Grandchild with inherited stdio: only a tree kill lets the timeout resolve, and the grandchild must be gone.
  const tree = prog("tree.cjs", `const { spawn } = require("child_process");\nconst g = spawn(process.execPath, [${JSON.stringify(prog("hang.cjs", "setTimeout(() => {}, 60000);\n"))}], { stdio: "inherit" });\nprocess.stdout.write(String(g.pid) + "\\n");\nsetTimeout(() => {}, 60000);\n`);
  const t0 = Date.now();
  const killed = await defaultExec(process.execPath, [tree], { timeout: 700 });
  assert.equal(killed.timedOut, true); assert.equal(killed.code, -1); assert(Date.now() - t0 < 15_000, "resolved without waiting on the grandchild's pipes");
  const gpid = Number(killed.stdout.trim());
  assert(gpid > 0, `grandchild pid reported: ${JSON.stringify(killed.stdout)}`);
  await new Promise(r => setTimeout(r, 300));
  let alive = true; try { process.kill(gpid, 0); } catch (e) { alive = e.code !== "ESRCH" && process.platform !== "win32" ? true : false; }
  if (process.platform === "win32") { const q = spawnSync("tasklist", ["/FI", `PID eq ${gpid}`, "/NH"], { encoding: "utf8" }); alive = new RegExp(`\\b${gpid}\\b`).test(q.stdout); }
  assert.equal(alive, false, `grandchild ${gpid} survived the tree kill`);
  const u = defaultRunUpdater(["--bogus-option"]);
  assert(util.inspect(u).includes("pending"), "defaultRunUpdater is asynchronous too");
  const ur = await u; assert.equal(ur.code, 1); assert.match(ur.output, /Unknown update option/);
});


// ---- momm run rev_20260919000938_1nkh (gate 3) reproductions -----------------
await test("gate3 [161]: a timeout still resolves when the direct child already exited and a grandchild holds the pipes", async () => {
  const prog = (name, src) => { const f = path.join(fixture, name); fs.writeFileSync(f, src); return f; };
  const pidFile = path.join(fixture, "orphan.pid"), LIFE = 9_000;
  const orphan = prog("orphan-hang.cjs", `setTimeout(() => {}, ${LIFE});\n`);
  const parent = prog("orphan-parent.cjs", `const { spawn } = require("child_process");\nconst g = spawn(process.execPath, [${JSON.stringify(orphan)}], { stdio: ["ignore", "inherit", "inherit"], detached: true });\nrequire("fs").writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));\ng.unref();\n`);
  const t0 = Date.now();
  try {
    const r = await defaultExec(process.execPath, [parent], { timeout: 700 });
    const took = Date.now() - t0;
    assert(took < 5_000, `resolved only after ${took} ms: the promise waited for the grandchild's pipes instead of the deadline`);
    assert.equal(r.timedOut, true); assert.equal(r.code, -1);
    // The reproduction is only load-bearing if the grandchild really existed and outlived its parent.
    assert(fs.existsSync(pidFile), "the parent never spawned the grandchild before the deadline: nothing held the pipes");
    const held = Number(fs.readFileSync(pidFile, "utf8")); let alive = true; try { process.kill(held, 0); } catch (e) { alive = e.code !== "ESRCH"; }
    assert.equal(alive, true, `grandchild ${held} was not alive at the deadline, so the pipe-hold case was not exercised`);
  } finally {
    const gpid = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8") : 0);
    if (gpid > 0) { try { process.kill(gpid, "SIGKILL"); } catch {} }
  }
});
await test("gate3 [163]/[63]: defaultExec starts an absolute .exe without cmd.exe (no %VAR% expansion) and never resolves a bare name from the working directory", async () => {
  if (process.platform !== "win32") return { skip: "Windows cmd.exe and CreateProcess behaviour only" };
  const dir = path.join(fixture, "pct %OS% dir"); fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, "probe.exe"); fs.copyFileSync(process.execPath, probe); // harmless stand-in executable
  const r = await defaultExec(probe, ["--version"], { timeout: 20_000 });
  assert.equal(r.code, 0, `literal percent path must launch: ${r.stderr}`); assert.match(r.stdout, /^v\d+\./);
  // A child with the protective variable removed models a plain user shell.
  const planted = path.join(fixture, "planted-cwd"); fs.mkdirSync(planted, { recursive: true });
  fs.writeFileSync(path.join(planted, "mommgate3planted.cmd"), "@echo PLANTED 9.9.9\r\n");
  const child = path.join(fixture, "planted-child.mjs"), childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) if (key.toLowerCase() === "nodefaultcurrentdirectoryinexepath") delete childEnv[key];
  fs.writeFileSync(child, `import { defaultExec } from ${JSON.stringify(new URL("./update-clock.mjs", import.meta.url).href)};\nprocess.stdout.write(JSON.stringify(await defaultExec("mommgate3planted", ["--version"], { timeout: 15000 })));\n`);
  const p = spawnSync(process.execPath, [child], { cwd: planted, env: childEnv, encoding: "utf8", windowsHide: true, timeout: 40_000 });
  assert.equal(p.status, 0, p.stderr); const ran = JSON.parse(p.stdout);
  assert.doesNotMatch(ran.stdout, /PLANTED/, "a same-named launcher in the working directory must not run"); assert.notEqual(ran.code, 0);
});
await test("gate3 codex#57: npmSource.check does not depend on its receiver", async () => {
  const seen = [], { check } = npmSource("codex");
  const r = await check({ fetcher: async url => { seen.push(url); return { status: 200, ok: true, headers: new Headers(), text: async () => JSON.stringify({ version: "1.2.3" }) }; } }, {});
  assert.equal(r.latest, "1.2.3"); assert.deepEqual(seen, [CODEX_URL]);
});
await test("gate3 [159]: a malformed stored model baseline is rebaselined, never a TypeError that wedges the models source", async () => {
  const lists = { codex: ["m-1", "m-2"] };
  const e = env({ sources: [modelsSource()], installed: { skill: "1.15.1", codex: "0.154.0" }, listModels: async route => lists[route] || null });
  fs.mkdirSync(path.dirname(e.stateFile), { recursive: true });
  fs.writeFileSync(e.stateFile, JSON.stringify({ schema: "momm-update-clock/1", sources: { models: { next_due_at: 0, interval_ms: MIN, consecutive_unchanged: 0, tight_until: 0, models: { codex: { hash: "old", models: null } } } }, history: [] }));
  const first = await e.clock.trigger("manual");
  assert.equal(first.results[0].error, null, `models check failed: ${first.results[0].error}`); assert.notEqual(first.results[0].outcome, "error");
  assert.deepEqual(readState(e.stateFile).sources.models.models.codex.models, ["m-1", "m-2"], "the baseline is healed");
  lists.codex = ["m-1", "m-2", "m-3"];
  const second = await e.clock.trigger("manual");
  assert.equal(second.results[0].outcome, "changed"); assert.deepEqual(readState(e.stateFile).sources.models.new_models, { codex: ["m-3"] });
});
await test("gate3 [165]: a rejected CLI exec or updater is a recorded failure and the remaining sources are still attempted", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.16.0"), [CODEX_URL]: ok("0.155.0") }, sources: [skillSource(), npmSource("codex")] });
  writeSettings(e.home, { auto_update: { enabled: true } });
  await e.clock.trigger("manual");
  const seen = [];
  const out = await applyUpdates(e.clock, { runUpdater: async () => { seen.push("skill"); throw new Error("spawn EPERM"); }, exec: async bin => { seen.push(bin); throw new Error("spawn npm ENOENT"); } });
  assert.deepEqual(seen, ["skill", "npm"], "the second source is attempted after the first rejected");
  assert.deepEqual(out.failed.map(f => f.name), ["skill", "cli:codex"]); assert.equal(out.applied.length, 0);
  assert.match(out.failed[1].reason, /ENOENT/);
  assert.equal(readState(e.stateFile).history.filter(h => h.trigger === "apply" && h.outcome === "failed").length, 2, "both failures are persisted");
  assert.equal(fs.existsSync(`${e.stateFile}.lock`), false);
});
await test("gate3 [166]: auto-update disabled while waiting for the lock is honoured once the lock is held", async () => {
  const e = env({ responses: { [MANIFEST_URL]: ok("1.16.0") }, sources: [skillSource()] });
  writeSettings(e.home, { auto_update: { enabled: true } });
  await e.clock.trigger("manual");
  let ran = false; const locked = e.clock.locked;
  // Model the wait: another process flips the setting between the caller's first read and lock acquisition.
  e.clock.locked = (fn, busy) => { writeSettings(e.home, { auto_update: { enabled: false } }); return locked(fn, busy); };
  const out = await applyUpdates(e.clock, { runUpdater: async () => { ran = true; return { code: 0, output: PREVIEW }; } });
  assert.equal(ran, false, "the updater ran against a setting that was already off"); assert.equal(out.applied.length, 0);
  assert.deepEqual(out.skipped, [{ name: "*", reason: "auto_update.enabled is false" }]);
});
await test("gate3 [164]: a CLI update whose new version cannot be read is not re-run on every later trigger", async () => {
  const e = env({ responses: { [CODEX_URL]: ok("0.155.0") }, sources: [npmSource("codex")] });
  writeSettings(e.home, { auto_update: { enabled: true } });
  await e.clock.trigger("manual");
  let runs = 0; const deps = { exec: async () => { runs += 1; return { code: 0, stdout: "", stderr: "" }; }, versionOf: async () => { throw new Error("version read failed"); } };
  const first = await applyUpdates(e.clock, deps);
  assert.equal(first.applied.length, 1); assert.equal(first.applied[0].to, null); assert.equal(runs, 1);
  const second = await applyUpdates(e.clock, deps);
  assert.equal(runs, 1, "the update command ran again although it already succeeded for this release");
  assert.match(second.skipped[0].reason, /already ran .* 0\.155\.0/);
  e.responses[CODEX_URL] = ok("0.156.0", '"v2"'); e.time.t += 2 * MAX; await e.clock.trigger("manual");
  await applyUpdates(e.clock, deps); assert.equal(runs, 2, "a NEWER release is attempted again");
});

// ---- momm run rev_20260919023950_h6hn (gate 4) reproductions -----------------
await test("gate4 [1]: the timeout tree kill uses System32 taskkill, never a taskkill.exe planted in the working directory", async () => {
  if (process.platform !== "win32") return { skip: "Windows executable search order only" };
  // A direct spawn of a bare name tries the working directory BEFORE PATH unless the
  // CALLING process already carries NoDefaultCurrentDirectoryInExePath (setting it for the
  // child alone changes nothing). The child below runs without it, like a plain user shell.
  // The planted stand-in is a copy of node.exe: it kills nothing, so the DETACHED grandchild
  // (outside every kill-on-close job) survives exactly when the planted file was chosen.
  const dir = path.join(fixture, "planted-taskkill"); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(dir, "taskkill.exe"));
  const hang = path.join(dir, "hang.cjs"), tree = path.join(dir, "tree.cjs"), child = path.join(dir, "child.mjs");
  fs.writeFileSync(hang, "setTimeout(() => {}, 60000);\n");
  fs.writeFileSync(tree, `const { spawn } = require("child_process");\nconst g = spawn(process.execPath, [${JSON.stringify(hang)}], { stdio: "inherit", detached: true });\nprocess.stdout.write(String(g.pid) + "\\n");\nsetTimeout(() => {}, 60000);\n`);
  fs.writeFileSync(child, `import { defaultExec } from ${JSON.stringify(new URL("./update-clock.mjs", import.meta.url).href)};\nconst r = await defaultExec(process.execPath, [${JSON.stringify(tree)}], { timeout: 1500 });\nprocess.stdout.write(JSON.stringify({ timedOut: r.timedOut, gpid: Number(r.stdout.trim()) }));\n`);
  const tasklist = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tasklist.exe");
  let gpid = 0; const bareEnv = { ...process.env };
  for (const key of Object.keys(bareEnv)) if (key.toLowerCase() === "nodefaultcurrentdirectoryinexepath") delete bareEnv[key];
  try {
    const p = spawnSync(process.execPath, [child], { cwd: dir, env: bareEnv, encoding: "utf8", windowsHide: true, timeout: 60_000 });
    assert.equal(p.status, 0, p.stderr); const r = JSON.parse(p.stdout); gpid = r.gpid;
    assert.equal(r.timedOut, true); assert(gpid > 0, `grandchild pid reported: ${p.stdout}`);
    await new Promise(done => setTimeout(done, 400));
    const q = spawnSync(tasklist, ["/FI", `PID eq ${gpid}`, "/NH"], { encoding: "utf8", windowsHide: true });
    assert.equal(new RegExp(`\\b${gpid}\\b`).test(q.stdout), false, `grandchild ${gpid} survived: the planted taskkill.exe ran instead of the System32 tool`);
  } finally { if (gpid > 0) { try { process.kill(gpid, "SIGKILL"); } catch {} } }
});
await test("gate4 [62]: a lock another process published after the stale one was inspected is never deleted", async () => {
  const DEAD = 4_000_001, LIVE = 4_000_002; let swapped = 0, lockFile;
  // isAlive runs between inspection and removal: exactly where a second process can
  // reclaim the stale lock and publish its own.
  const e = env({ responses: { [MANIFEST_URL]: ok("1.15.1") }, sources: [skillSource()], isAlive: pid => {
    if (pid === DEAD && !swapped) { swapped += 1; fs.unlinkSync(lockFile); fs.writeFileSync(lockFile, JSON.stringify({ pid: LIVE, at: "2026-09-19T00:00:00.000Z" })); return false; }
    return pid === LIVE;
  } });
  lockFile = `${e.stateFile}.lock`; fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify({ pid: DEAD, at: "2026-09-18T00:00:00.000Z" }));
  const r = await e.clock.trigger("manual");
  assert.equal(swapped, 1); assert.equal(r.skipped_reason, "locked", "entered the critical section beside the live owner");
  assert.equal(JSON.parse(fs.readFileSync(lockFile, "utf8")).pid, LIVE, "the replacement lock is intact");
  assert.deepEqual(fs.readdirSync(path.dirname(lockFile)).filter(n => /\.(stale|tmp)$/.test(n)), [], "no capture file is left behind");
});
await test("gate4 grok#76: a state row without a finite interval is rescheduled, never parked on NaN", async () => {
  const e = env({ responses: { [MANIFEST_URL]: { status: 304 } }, sources: [skillSource()] });
  fs.mkdirSync(path.dirname(e.stateFile), { recursive: true });
  fs.writeFileSync(e.stateFile, JSON.stringify({ schema: "momm-update-clock/1", sources: { skill: { etag: '"v1"', last_seen_version: "1.15.1", consecutive_unchanged: 3, tight_until: 0 } }, history: [] }));
  assert.equal((await e.clock.trigger("daily.tick")).ran, true);
  const row = readState(e.stateFile).sources.skill;
  assert(Number.isFinite(row.interval_ms) && row.interval_ms >= MIN && row.interval_ms <= MAX, `interval_ms=${row.interval_ms}`);
  assert(Number.isFinite(row.next_due_at) && row.next_due_at > e.time.t, `next_due_at=${row.next_due_at}: a NaN due time is never reached by a passive event`);
  e.time.t = row.next_due_at + 1;
  assert.equal((await e.clock.trigger("daily.tick")).ran, true, "the source comes due again");
});
await test("gate4 [65]: the Windows timer is registered by argv through System32 schtasks, so & % ^ in a path are never cmd.exe syntax", async () => {
  const node = "C:\\A&B\\node.exe", script = "C:\\Users\\me\\100%OS% a^b (x)\\update-clock.mjs", want = `"${node}" "${script}" trigger daily.tick`;
  const seen = [];
  const done = await installTimer({ platform: "win32", nodePath: node, scriptPath: script, confirm: true, exec: async (command, args, options) => { seen.push({ command, args, options }); return { code: 0, stderr: "" }; } });
  assert.equal(done.done, true); assert.equal(seen.length, 1);
  assert.match(seen[0].command, /^[A-Za-z]:\\.*\\System32\\schtasks\.exe$/, "absolute system tool, never a bare name a working directory could shadow");
  assert.notEqual(seen[0].options?.shell, true, "no shell line: cmd.exe would read & as a command separator and expand %OS%");
  assert.deepEqual(seen[0].args, ["/Create", "/SC", "HOURLY", "/MO", "6", "/TN", "MOMM-UpdateClock", "/TR", want]);
  const removed = []; await UC.removeTimer({ platform: "win32", nodePath: node, scriptPath: script, confirm: true, exec: async (command, args) => { removed.push([command, args]); return { code: 0 }; } });
  assert.match(removed[0][0], /\\System32\\schtasks\.exe$/); assert.deepEqual(removed[0][1], ["/Delete", "/TN", "MOMM-UpdateClock", "/F"]);
  if (process.platform !== "win32") return;
  // Parse-only round trip (schtasks is never run): node.exe splits argv with the same CRT rules.
  const echo = await defaultExec(process.execPath, ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", ...seen[0].args], { timeout: 20_000 });
  assert.equal(echo.code, 0, echo.stderr); assert.equal(JSON.parse(echo.stdout)[8], want);
});
await test("gate4 [2]: a hint-only skill update is applied once, not on every later pass", async () => {
  // No shipped source reports a skill hint; an injected one can (sources is a public option).
  const hinted = { name: "skill", kind: "skill", async check() { return { latest: null, update_available: true }; } };
  const e = env({ sources: [hinted] });
  writeSettings(e.home, { auto_update: { enabled: true } });
  await e.clock.trigger("manual");
  assert.equal(e.clock.status().sources[0].update_available, true, "the hint stands in while no version is known");
  let applies = 0; const deps = { runUpdater: async a => { if (a[0] === "--apply") applies += 1; return { code: 0, output: a[0] === "--dry-run" ? PREVIEW : "Installed" }; } };
  const first = await applyUpdates(e.clock, deps);
  assert.equal(first.applied.length, 1); assert.equal(applies, 1);
  assert.equal(e.clock.installedVersions.skill, "1.15.1", "an unknown latest never erases the known installed version");
  const second = await applyUpdates(e.clock, deps);
  assert.equal(applies, 1, "the signed updater ran again for the same hint"); assert.equal(second.applied.length, 0);
  assert.equal(readState(e.stateFile).sources.skill.update_available_hint, undefined, "the pre-update hint is retired by the apply");
});

await test("cliMain trigger never runs real executors under an injected clock, and never applies after a check that did not run (audit safety)", async () => {
  const dir = path.join(fixture, "guard"); fs.mkdirSync(dir, { recursive: true });
  const home = path.join(dir, "home"), stateFile = path.join(dir, "clock.json");
  let execCalls = 0;
  const mk = (extra = {}) => createUpdateClock({ home, stateFile, env: {}, installedVersions: { codex: "1.0.0" }, sources: [npmSource("codex")],
    fetcher: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ version: "2.0.0" }), headers: { get: () => null } }),
    exec: async () => { execCalls++; return { code: 0, stdout: "", stderr: "" }; }, ...extra });
  writeSettings(home, { auto_update: { enabled: true, skill: false } });
  const withClock = await cliMain(["trigger", "daily.tick"], { home, clock: mk() });
  assert.equal(withClock.ran, true);
  assert.equal(withClock.apply.skipped_reason, "no_apply_deps", JSON.stringify(withClock.apply));
  assert.equal(execCalls, 0, "no injected apply deps: nothing may execute");
  // Opt-out: the passive tick must not check, and therefore must not apply.
  const optOut = await cliMain(["trigger", "daily.tick"], { home, clock: mk({ env: { NO_UPDATE_CHECK: "1" }, stateFile: path.join(dir, "optout.json") }) });
  assert.equal(optOut.ran, false); assert.equal(optOut.skipped_reason, "opt_out"); assert.equal(optOut.apply.skipped_reason, "no_check");
  // Forced manual check still runs even with the opt-out, by design (disclosed in the Setup Center).
  const manual = await mk({ env: { NO_UPDATE_CHECK: "1" }, stateFile: path.join(dir, "manual.json") }).trigger("manual");
  assert.equal(manual.ran, true);
});

fs.rmSync(fixture, { recursive: true, force: true });
console.log(JSON.stringify({ passed, failures, skipped }, null, 2));
if (failures.length) process.exitCode = 1;
