#!/usr/bin/env node
// MOMM update clock: an event-triggered, adaptive version watcher plus an opt-in
// auto-apply that only ever goes through the signed updater (update.mjs) and the
// official per-CLI update commands. Off by default (~/.momm/settings.json).
//
// Cost model. Nothing polls. Checks run only when an event fires (review start
// or finish, Setup Center open, an OS timer every 6 h, or a manual request) AND a
// source is due. Each due source costs one conditional HTTP GET carrying
// If-None-Match / If-Modified-Since; a 304 answer is a few hundred bytes and is
// treated as "unchanged". Intervals start at 30 min and double after every
// unchanged answer up to 24 h, so a quiet machine settles at roughly one ~1 KB
// request per source per day (about six per day for skill + four npm CLIs +
// grok's local `update --check`), with +/-10 % jitter so installations do not
// synchronise. A detected release pins the interval back to 30 min for 24 h,
// because releases cluster. Errors never tighten the schedule. CPU cost is a
// single Node process for a fraction of a second; there is no daemon.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MANIFEST_URL, newer, atomic, safeText, stateDir, repoRoot } from "./update.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const HOUR = 3_600_000, DAY = 24 * HOUR, MAX_HISTORY = 200;
export const EVENTS = new Set(["review.start", "review.finish", "setup.open", "setup.check", "daily.tick", "manual", "startup"]);
export const FORCED_EVENTS = new Set(["manual", "setup.check"]);
export const CLIS = ["codex", "claude", "gemini", "copilot", "grok", "antigravity"];
export const NPM_PACKAGES = Object.freeze({ codex: "@openai/codex", claude: "@anthropic-ai/claude-code", gemini: "@google/gemini-cli", copilot: "@github/copilot" });
// Same fixed official commands as setup-ui.mjs `providers[*].update` (identical on every platform).
export const UPDATE_COMMANDS = Object.freeze({ codex: "npm install -g @openai/codex@latest", claude: "claude update", gemini: "npm install -g @google/gemini-cli@latest", copilot: "copilot update", grok: "grok update", antigravity: "agy update" });
export const DEFAULT_SETTINGS = Object.freeze({
  auto_update: Object.freeze({ enabled: false, skill: true, clis: true, models: true, accept_protocol: false }),
  clock: Object.freeze({ min_interval_ms: 30 * 60_000, max_interval_ms: DAY }),
});
export function localSkillVersion() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "versions.json"), "utf8")).momm || null; } catch { return null; } }
const USER_AGENT = `momm-update-clock/${localSkillVersion() || "unknown"}`;
const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return fallback; throw e; } };
function writeJSON(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); atomic(file, `${JSON.stringify(value, null, 2)}\n`); }

// ---- settings (~/.momm/settings.json) ---------------------------------------
export const settingsFile = (home = os.homedir()) => path.join(home, ".momm", "settings.json");
export function validateSettings(s) {
  if (!s || typeof s !== "object" || typeof s.auto_update !== "object" || typeof s.clock !== "object") throw new Error("settings must contain auto_update and clock objects");
  for (const k of Object.keys(DEFAULT_SETTINGS.auto_update)) if (typeof s.auto_update[k] !== "boolean") throw new Error(`auto_update.${k} must be true or false`);
  for (const k of Object.keys(DEFAULT_SETTINGS.clock)) if (!Number.isInteger(s.clock[k]) || s.clock[k] < 60_000) throw new Error(`clock.${k} must be an integer >= 60000 ms`);
  if (s.clock.min_interval_ms > s.clock.max_interval_ms) throw new Error("clock.min_interval_ms must not exceed clock.max_interval_ms");
  return s;
}
const merge = (base, patch = {}) => ({ auto_update: { ...base.auto_update, ...(patch.auto_update || {}) }, clock: { ...base.clock, ...(patch.clock || {}) } });
export function readSettings(home) { return validateSettings(merge(DEFAULT_SETTINGS, readJSON(settingsFile(home), {}))); }
export function writeSettings(home, patch) {
  const next = validateSettings(merge(readSettings(home), patch));
  writeJSON(settingsFile(home), next); return next;
}

// ---- state (<clone>/.git/momm/update-clock.json) ----------------------------
export function defaultStateFile() {
  try { return path.join(stateDir(repoRoot(ROOT)), "update-clock.json"); } catch { return path.join(os.homedir(), ".momm", "update-clock.json"); }
}
export function readState(stateFile) {
  const s = readJSON(stateFile, {});
  return { schema: "momm-update-clock/1", sources: s.sources || {}, history: Array.isArray(s.history) ? s.history : [], last_review_start_check_at: s.last_review_start_check_at || null };
}
export function writeState(stateFile, state) { writeJSON(stateFile, { ...state, history: state.history.slice(-MAX_HISTORY) }); }
const freshEntry = min => ({ last_checked_at: null, next_due_at: 0, interval_ms: min, etag: null, last_modified: null, last_seen_version: null, consecutive_unchanged: 0, last_error: null, last_trigger: null, tight_until: 0 });
// Lock file next to the state; a lock whose pid is dead is stale and removed.
function acquireLock(stateFile, isAlive) {
  const file = `${stateFile}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const fd = fs.openSync(file, "wx", 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); fs.closeSync(fd); return () => { try { fs.unlinkSync(file); } catch {} }; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      const pid = readJSON(file, {})?.pid;
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) return null;
      try { fs.unlinkSync(file); } catch {}
    }
  }
  return null;
}
const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; } };

// ---- I/O defaults (all injectable) -------------------------------------------
export function defaultFetcher(url, init = {}) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 10_000);
  return fetch(url, { ...init, signal: c.signal }).finally(() => clearTimeout(t));
}
// Only constant commands from the tables above reach this; the Windows shell is
// needed for npm's .cmd shims. Never pass user input through here.
export function defaultExec(command, args = [], { timeout = 60_000, shell = false } = {}) {
  const p = spawnSync(command, args, { encoding: "utf8", timeout, windowsHide: true, maxBuffer: 8 << 20, shell: shell || process.platform === "win32" });
  return Promise.resolve({ code: p.error ? -1 : p.status, stdout: p.stdout || "", stderr: p.stderr || safeText(p.error?.message || ""), timedOut: p.error?.code === "ETIMEDOUT" });
}
export function defaultRunUpdater(args) {
  const p = spawnSync(process.execPath, [path.join(HERE, "update.mjs"), ...args], { encoding: "utf8", timeout: 600_000, windowsHide: true, maxBuffer: 8 << 20 });
  return Promise.resolve({ code: p.error ? -1 : p.status, output: `${p.stdout || ""}${p.stderr || ""}` });
}
async function conditionalGet(ctx, url, entry) {
  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  if (entry.etag) headers["If-None-Match"] = entry.etag;
  if (entry.last_modified) headers["If-Modified-Since"] = entry.last_modified;
  const res = await ctx.fetcher(url, { headers, redirect: "error" });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("response exceeds 1 MiB");
  return { body: JSON.parse(text), etag: res.headers?.get?.("etag") || null, last_modified: res.headers?.get?.("last-modified") || null };
}
const semver = v => String(v || "").match(/\d+\.\d+\.\d+/)?.[0] || null;

// ---- sources -----------------------------------------------------------------
export const skillSource = () => ({ name: "skill", kind: "skill", url: MANIFEST_URL, async check(ctx, entry) {
  const r = await conditionalGet(ctx, MANIFEST_URL, entry);
  return r.notModified ? r : { latest: semver(r.body.momm), etag: r.etag, last_modified: r.last_modified };
} });
export const npmSource = cli => ({ name: `cli:${cli}`, kind: "cli", cli, url: `https://registry.npmjs.org/${NPM_PACKAGES[cli].replace("/", "%2f")}/latest`, async check(ctx, entry) {
  const r = await conditionalGet(ctx, this.url, entry);
  return r.notModified ? r : { latest: semver(r.body.version), etag: r.etag, last_modified: r.last_modified };
} });
export const grokSource = () => ({ name: "cli:grok", kind: "cli", cli: "grok", async check(ctx) {
  const p = await ctx.exec("grok", ["update", "--check", "--stable", "--json"], { timeout: 20_000 });
  if (p.code !== 0) throw new Error(`grok update --check exited ${p.code}: ${safeText(p.stderr).slice(0, 200)}`);
  const j = JSON.parse(p.stdout);
  if (typeof j.updateAvailable !== "boolean") throw new Error("grok update --check returned no updateAvailable flag");
  return { latest: semver(j.latestVersion), update_available: j.updateAvailable };
} });
export const antigravitySource = () => ({ name: "cli:antigravity", kind: "cli", cli: "antigravity", async check() { return { latest: null, status: "unknown", note: "No check-only command; `agy update` is never run automatically." }; } });
export const modelsSource = () => ({ name: "models", kind: "models", async check(ctx, entry) {
  const previous = entry.models || {}, models = {}, new_models = {};
  let changed = false;
  for (const route of ctx.routes) {
    const list = await ctx.listModels(route);
    if (!Array.isArray(list)) continue;
    const sorted = [...new Set(list.map(String))].sort(), hash = createHash("sha256").update(sorted.join("\n")).digest("hex");
    models[route] = { hash, models: sorted };
    if (previous[route] && previous[route].hash !== hash) { changed = true; new_models[route] = sorted.filter(m => !previous[route].models.includes(m)); }
  }
  return { latest: null, changed, models, new_models };
} });
export const defaultSources = () => [skillSource(), ...Object.keys(NPM_PACKAGES).map(npmSource), grokSource(), antigravitySource(), modelsSource()];

// ---- the clock -----------------------------------------------------------------
export function createUpdateClock({ home, stateFile = defaultStateFile(), installedVersions = { skill: localSkillVersion() }, sources = defaultSources(), fetcher = defaultFetcher, exec = defaultExec, now = Date.now, random = Math.random, listModels = async () => null, routes = CLIS, isAlive = pidAlive } = {}) {
  const installedFor = s => installedVersions[s.cli || (s.kind === "skill" ? "skill" : "")] || null;
  const jitter = ms => Math.round(ms * (0.9 + 0.2 * random()));
  function schedule(entry, outcome, t, clock) {
    if (outcome === "changed") { entry.interval_ms = clock.min_interval_ms; entry.tight_until = t + DAY; }
    else if (outcome === "unchanged") entry.interval_ms = t < entry.tight_until ? clock.min_interval_ms : Math.min(entry.interval_ms * 2, clock.max_interval_ms);
    entry.interval_ms = Math.max(clock.min_interval_ms, Math.min(entry.interval_ms, clock.max_interval_ms));
    entry.next_due_at = t + jitter(entry.interval_ms);
  }
  async function check(source, entry, ctx, t, trigger, settings) {
    entry.last_checked_at = t; entry.last_trigger = trigger;
    let outcome;
    try {
      const r = (await source.check(ctx, entry)) || {};
      if (r.notModified) outcome = "unchanged";
      else {
        const latest = r.latest || null;
        outcome = r.changed || (latest && entry.last_seen_version && latest !== entry.last_seen_version) ? "changed" : "unchanged";
        if (latest) entry.last_seen_version = latest;
        if ("etag" in r) { entry.etag = r.etag; entry.last_modified = r.last_modified; }
        if ("update_available" in r) entry.update_available_hint = r.update_available;
        if (r.status) entry.status = r.status;
        if (r.models) { entry.models = r.models; entry.new_models = r.new_models; }
      }
      entry.consecutive_unchanged = outcome === "unchanged" ? entry.consecutive_unchanged + 1 : 0;
      entry.last_error = null;
    } catch (e) { outcome = "error"; entry.last_error = safeText(e.message).slice(0, 300); }
    schedule(entry, outcome, t, settings.clock);
    return { name: source.name, outcome, latest: entry.last_seen_version, installed: installedFor(source), error: entry.last_error };
  }
  const withLock = async fn => {
    const release = acquireLock(stateFile, isAlive);
    if (!release) return { ran: false, skipped_reason: "locked", results: [] };
    try { return await fn(); } finally { release(); }
  };
  const clock = {
    stateFile, installedVersions,
    settings: () => readSettings(home),
    setInstalled(name, version) { installedVersions[name] = version; },
    updateAvailable(source, entry) {
      if (entry.update_available_hint !== undefined) return entry.update_available_hint;
      const installed = installedFor(source);
      return entry.last_seen_version && installed ? newer(entry.last_seen_version, installed) : null;
    },
    trigger: event => withLock(async () => {
      if (!EVENTS.has(event)) throw new Error(`Unknown update-clock event: ${event}`);
      const settings = readSettings(home), t = now(), state = readState(stateFile), forced = FORCED_EVENTS.has(event);
      if (event === "review.start" && state.last_review_start_check_at && t - state.last_review_start_check_at < settings.clock.min_interval_ms) return { ran: false, skipped_reason: "rate_limited", results: [] };
      for (const s of sources) state.sources[s.name] ||= freshEntry(settings.clock.min_interval_ms);
      const due = sources.filter(s => forced || t >= state.sources[s.name].next_due_at);
      if (!due.length) return { ran: false, skipped_reason: "nothing_due", results: [] };
      if (event === "review.start") state.last_review_start_check_at = t;
      const ctx = { fetcher, exec, listModels, routes: routes.filter(r => installedVersions[r]), now: t };
      const results = [];
      for (const s of due) { results.push(await check(s, state.sources[s.name], ctx, t, event, settings)); state.history.push({ at: t, trigger: event, source: s.name, outcome: results.at(-1).outcome }); }
      writeState(stateFile, state);
      return { ran: true, skipped_reason: null, results };
    }),
    record(entries) { const state = readState(stateFile); state.history.push(...entries); writeState(stateFile, state); },
    status() {
      const settings = readSettings(home), state = readState(stateFile), iso = ms => (ms ? new Date(ms).toISOString() : null);
      const rows = sources.map(s => { const e = state.sources[s.name] || freshEntry(settings.clock.min_interval_ms); return { name: s.name, kind: s.kind, last_checked_at: iso(e.last_checked_at), next_due_at: iso(e.next_due_at), interval_ms: e.interval_ms, latest: e.last_seen_version, installed: installedFor(s), update_available: clock.updateAvailable(s, e), last_error: e.last_error, status: e.status || null, new_models: e.new_models || null, needs_protocol_acceptance: e.needs_protocol_acceptance || false }; });
      return { auto_update: settings.auto_update, clock: settings.clock, sources: rows, overhead_estimate_per_day: rows.filter(r => r.kind !== "models" && r.name !== "cli:antigravity").reduce((n, r) => n + Math.ceil(DAY / r.interval_ms), 0), history_entries: state.history.length };
    },
  };
  return clock;
}

// ---- auto-apply (only when settings.auto_update.enabled) -------------------------
function parsePreview(output) { return { ok: /Preview complete\./.test(output), protocolChanged: /Protocol \/ default-rules \/ persona diff/.test(output) && !/No policy changes\./.test(output) }; }
export async function applyUpdates(clock, { runUpdater = defaultRunUpdater, exec = defaultExec, versionOf = async () => null, postUpdateProbe = null, isManaged = () => false, commands = UPDATE_COMMANDS, now = Date.now } = {}) {
  const out = { applied: [], skipped: [], failed: [], notices: [] }, settings = clock.settings();
  if (!settings.auto_update.enabled) { out.skipped.push({ name: "*", reason: "auto_update.enabled is false" }); return out; }
  const history = [], note = (source, outcome, notice, extra = {}) => { history.push({ at: now(), trigger: "apply", source, outcome, notice, ...extra }); out.notices.push(notice); };
  const status = clock.status();
  for (const row of status.sources) {
    if (row.kind === "skill" && settings.auto_update.skill && row.update_available) {
      const dry = await runUpdater(["--dry-run"]), preview = parsePreview(dry.output || "");
      if (dry.code !== 0 || !preview.ok) { out.failed.push({ name: row.name, reason: "dry-run failed", output: safeText(dry.output || "").slice(-500) }); note(row.name, "failed", `skill ${row.latest}: signed preview failed; nothing applied`); continue; }
      if (preview.protocolChanged && !settings.auto_update.accept_protocol) { out.skipped.push({ name: row.name, reason: "needs_protocol_acceptance" }); note(row.name, "needs_protocol_acceptance", `skill ${row.latest} changes the review protocol; set auto_update.accept_protocol or apply by hand`, { needs_protocol_acceptance: true }); continue; }
      const apply = await runUpdater(["--apply", "--yes", ...(settings.auto_update.accept_protocol ? ["--accept-protocol"] : [])]);
      if (apply.code !== 0) { out.failed.push({ name: row.name, reason: "apply failed (signature or verification not bypassed)", output: safeText(apply.output || "").slice(-500) }); note(row.name, "failed", `skill ${row.latest}: signed apply failed; previous installation retained`); }
      else { out.applied.push({ name: row.name, from: row.installed, to: row.latest }); clock.setInstalled("skill", row.latest); note(row.name, "applied", `skill updated ${row.installed} -> ${row.latest} through the signed updater`); }
    } else if (row.kind === "cli" && settings.auto_update.clis && row.update_available) {
      const cli = row.name.slice(4), command = commands[cli];
      if (isManaged(cli)) { out.skipped.push({ name: row.name, reason: "package-manager-owned installation; update through that package manager" }); note(row.name, "skipped", `${cli}: installation is package-manager owned; not touched`); continue; }
      if (!command) { out.skipped.push({ name: row.name, reason: "no fixed update command" }); continue; }
      const [bin, ...args] = command.split(/\s+/), p = await exec(bin, args, { timeout: 600_000 });
      if (p.code !== 0) { out.failed.push({ name: row.name, command, reason: `exit ${p.code}${p.timedOut ? " (timeout)" : ""}`, stderr: safeText(p.stderr || "").slice(-500) }); note(row.name, "failed", `${cli}: '${command}' exited ${p.code}`); continue; }
      const version = semver(await versionOf(cli)), probe = postUpdateProbe ? await postUpdateProbe(cli) : null;
      if (version) clock.setInstalled(cli, version);
      out.applied.push({ name: row.name, command, from: row.installed, to: version, probe });
      note(row.name, "applied", `${cli} updated ${row.installed} -> ${version || "unknown"} via '${command}'${probe ? `; probe ${probe.status || JSON.stringify(probe)}` : ""}`, { probe });
    } else if (row.kind === "models" && settings.auto_update.models && row.new_models) {
      for (const [route, list] of Object.entries(row.new_models)) if (list.length) note(row.name, "recorded", `new models available for ${route}: ${list.join(", ")} (configured models unchanged)`);
    }
  }
  const flagged = history.filter(h => h.needs_protocol_acceptance).map(h => h.source);
  if (history.length) { const state = readState(clock.stateFile); for (const s of flagged) if (state.sources[s]) state.sources[s].needs_protocol_acceptance = true; for (const f of out.failed) if (state.sources[f.name]) state.sources[f.name].last_error = f.reason; state.history.push(...history); writeState(clock.stateFile, state); }
  return out;
}

// ---- OS timer registration (daily.tick when no MOMM process runs) --------------
export function timerCommand(platform, nodePath, scriptPath, home = os.homedir()) {
  const q = s => `"${s}"`, run = `${q(nodePath)} ${q(scriptPath)} trigger daily.tick`;
  if (platform === "win32") return { platform, install: `schtasks /Create /SC HOURLY /MO 6 /TN MOMM-UpdateClock /TR "${run.replaceAll('"', '\\"')}"`, remove: "schtasks /Delete /TN MOMM-UpdateClock /F" };
  if (platform === "darwin") {
    const plist_path = path.join(home, "Library", "LaunchAgents", "uk.42.momm.update-clock.plist");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>uk.42.momm.update-clock</string>\n<key>ProgramArguments</key><array><string>${nodePath}</string><string>${scriptPath}</string><string>trigger</string><string>daily.tick</string></array>\n<key>StartInterval</key><integer>21600</integer>\n<key>RunAtLoad</key><false/>\n</dict></plist>\n`;
    return { platform, plist_path, plist, install: `launchctl load ${q(plist_path)}`, remove: `launchctl unload ${q(plist_path)}` };
  }
  const line = `0 */6 * * * ${run} >/dev/null 2>&1 # MOMM-UpdateClock`;
  return { platform: "linux", line, install: `( crontab -l 2>/dev/null | grep -v MOMM-UpdateClock; echo '${line}' ) | crontab -`, remove: "crontab -l 2>/dev/null | grep -v MOMM-UpdateClock | crontab -" };
}
async function timerAction(action, { platform = process.platform, nodePath = process.execPath, scriptPath = fileURLToPath(import.meta.url), home = os.homedir(), exec = defaultExec, confirm = false } = {}) {
  const cmd = timerCommand(platform, nodePath, scriptPath, home);
  if (confirm !== true) return { done: false, reason: "confirm: true required; nothing registered", command: cmd[action] };
  if (action === "install" && cmd.plist_path) { fs.mkdirSync(path.dirname(cmd.plist_path), { recursive: true, mode: 0o700 }); atomic(cmd.plist_path, cmd.plist); }
  const p = await exec(cmd[action], [], { shell: true, timeout: 60_000 });
  return { done: p.code === 0, command: cmd[action], code: p.code, stderr: safeText(p.stderr || "").slice(-300) };
}
export const installTimer = opts => timerAction("install", opts);
export const removeTimer = opts => timerAction("remove", opts);

// ---- CLI entry -----------------------------------------------------------------
export function parseSet(key, value) {
  if (["skill", "clis", "models", "accept_protocol"].includes(key)) { if (!["true", "false"].includes(value)) throw new Error(`${key} must be true or false`); return { auto_update: { [key]: value === "true" } }; }
  if (["min_interval", "max_interval"].includes(key)) { const m = Number(value); if (!Number.isInteger(m) || m < 1) throw new Error(`${key} must be whole minutes`); return { clock: { [`${key}_ms`]: m * 60_000 } }; }
  throw new Error(`Unknown setting ${key}. Use skill|clis|models|accept_protocol true|false or min_interval|max_interval <minutes>`);
}
export async function cliMain(argv, deps = {}) {
  const [cmd, a, b] = argv, home = deps.home, clock = deps.clock || createUpdateClock({ home, ...(deps.clockOptions || {}) });
  switch (cmd) {
    case "status": return clock.status();
    case "trigger": return clock.trigger(a);
    case "enable": return writeSettings(home, { auto_update: { enabled: true } });
    case "disable": return writeSettings(home, { auto_update: { enabled: false } });
    case "set": return writeSettings(home, parseSet(a, b));
    case "timer": if (a === "install") return installTimer({ ...deps.timer, confirm: b === "--confirm" }); if (a === "remove") return removeTimer({ ...deps.timer, confirm: b === "--confirm" }); break;
  }
  throw new Error("Usage: update-clock.mjs status | trigger <event> | enable | disable | set <key> <value> | timer install|remove [--confirm]");
}
function isEntrypoint() { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }
if (isEntrypoint()) {
  cliMain(process.argv.slice(2)).then(r => process.stdout.write(`${JSON.stringify(r, null, 2)}\n`)).catch(e => { process.stderr.write(`MOMM update clock stopped: ${safeText(e.message)}\n`); process.exitCode = 1; });
}
