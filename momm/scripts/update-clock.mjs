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
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MANIFEST_URL, newer, atomic, safeText, stateDir, repoRoot, cliBinary, locateBinary } from "./update.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const HOUR = 3_600_000, DAY = 24 * HOUR, MAX_HISTORY = 200, MAX_BODY = 1024 * 1024, LOCK_GRACE_MS = 2_000;
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
// A missing file is the fallback; an unreadable or unparseable one is the fallback
// PLUS a notice, so a truncated settings/state file degrades to defaults instead of
// failing the review that triggered the check. The caller records the notice.
function loadJSON(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { return { value: fallback, notice: e.code === "ENOENT" ? null : `${path.basename(file)} is unreadable (${e.code || safeText(e.message)}); defaults used` }; }
  try { const value = JSON.parse(text); return value && typeof value === "object" ? { value, notice: null } : { value: fallback, notice: `${path.basename(file)} does not hold a JSON object; defaults used` }; }
  catch (e) { return { value: fallback, notice: `${path.basename(file)} is corrupt JSON (${safeText(e.message).slice(0, 120)}); defaults used` }; }
}
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
// { settings, notice }: never throws. A corrupt or invalid file yields the defaults
// and a notice naming the file and the reason.
export function loadSettings(home) {
  const file = settingsFile(home), { value, notice } = loadJSON(file, {});
  if (notice) return { settings: merge(DEFAULT_SETTINGS), notice };
  try { return { settings: validateSettings(merge(DEFAULT_SETTINGS, value)), notice: null }; }
  catch (e) { return { settings: merge(DEFAULT_SETTINGS), notice: `${path.basename(file)} ignored: ${safeText(e.message)}; defaults used` }; }
}
export function readSettings(home) { return loadSettings(home).settings; }
export function writeSettings(home, patch) {
  const next = validateSettings(merge(readSettings(home), patch));
  writeJSON(settingsFile(home), next); return next;
}

// ---- state (<clone>/.git/momm/update-clock.json) ----------------------------
export function defaultStateFile() {
  try { return path.join(stateDir(repoRoot(ROOT)), "update-clock.json"); } catch { return path.join(os.homedir(), ".momm", "update-clock.json"); }
}
const shapeState = s => ({ schema: "momm-update-clock/1", sources: s.sources && typeof s.sources === "object" ? s.sources : {}, history: Array.isArray(s.history) ? s.history : [], last_review_start_check_at: s.last_review_start_check_at || null });
// { state, notice }: a corrupt state file is replaced by a fresh state (the next
// write heals it) and the notice explains the reset.
export function loadState(stateFile) { const { value, notice } = loadJSON(stateFile, {}); return { state: shapeState(value), notice: notice && `${notice.replace("; defaults used", "")}; state reset` }; }
export function readState(stateFile) { return loadState(stateFile).state; }
export function writeState(stateFile, state) { writeJSON(stateFile, { ...state, history: state.history.slice(-MAX_HISTORY) }); }
const freshEntry = min => ({ last_checked_at: null, next_due_at: 0, interval_ms: min, etag: null, last_modified: null, last_seen_version: null, consecutive_unchanged: 0, last_error: null, last_trigger: null, tight_until: 0 });
// Lock file next to the state; a lock whose pid is dead is stale and removed.
// The owner pid is written into a private temp file and published with link(2),
// so the lock never exists without its pid (link fails EEXIST when another
// process won). Filesystems without hard links fall back to an exclusive open
// followed immediately by the write; the 2 s grace below covers that gap, and a
// pid-less lock older than the grace is a crashed writer. A corrupt lock must
// never throw: it would wedge every later run behind an unowned lock.
function readLockOwner(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { return e.code === "ENOENT" ? { gone: true } : { corrupt: "unreadable" }; }
  if (!text.trim()) return { corrupt: "empty" };
  try { const pid = JSON.parse(text)?.pid; return Number.isInteger(pid) && pid > 0 ? { pid } : { corrupt: "corrupt (no usable pid)" }; } catch { return { corrupt: "truncated or corrupt JSON" }; }
}
function lockAgeMs(file) { try { return Date.now() - fs.statSync(file).mtimeMs; } catch { return Infinity; } }
// true when this process now owns `file`; false when another lock already exists.
function publishLock(file, content) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { flag: "wx", mode: 0o600 });
    try { fs.linkSync(temp, file); return true; }
    catch (e) {
      if (e.code === "EEXIST") return false;
      let fd;
      try { fd = fs.openSync(file, "wx", 0o600); } catch (open) { if (open.code === "EEXIST") return false; throw open; }
      try { fs.writeFileSync(fd, content); } finally { fs.closeSync(fd); }
      return true;
    }
  } finally { try { fs.unlinkSync(temp); } catch {} }
}
// Returns { release, notices } or null when a live process holds the lock. Each
// stale/corrupt removal is described in `notices` so callers can record it.
// Release removes the lock only while it still carries our pid: a lock another
// process replaced (after reclaiming ours as stale) belongs to that process.
function acquireLock(stateFile, isAlive) {
  const file = `${stateFile}.lock`, notices = [], owner = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  const release = () => { try { if (readLockOwner(file).pid === process.pid) fs.unlinkSync(file); } catch {} };
  for (let attempt = 0; attempt < 3; attempt++) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (publishLock(file, owner)) return { release, notices };
    const current = readLockOwner(file);
    if (current.gone) continue;
    if (current.pid && isAlive(current.pid)) return null;
    if (current.corrupt && lockAgeMs(file) < LOCK_GRACE_MS) return null; // a writer between create and publish
    notices.push(current.corrupt ? `removed ${current.corrupt} lock file ${path.basename(file)} (crashed or interrupted writer)` : `removed stale lock file ${path.basename(file)} left by dead pid ${current.pid}`);
    try { fs.unlinkSync(file); } catch {}
  }
  return null;
}
const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; } };

// ---- I/O defaults (all injectable) -------------------------------------------
// One abort timer covers headers AND body: fetch() resolves on headers, so the
// body read below stays under the same deadline. The body is read as a stream and
// the request aborted as soon as it passes maxBytes, so an oversized answer is
// never buffered whole. The returned object is the subset conditionalGet uses.
export function defaultFetcher(url, init = {}, { timeoutMs = 10_000, maxBytes = MAX_BODY } = {}) {
  const c = new AbortController(); let timedOut = false;
  const t = setTimeout(() => { timedOut = true; c.abort(); }, timeoutMs);
  const done = () => clearTimeout(t);
  const fail = e => { done(); throw timedOut && e?.name === "AbortError" ? new Error(`request timed out after ${timeoutMs} ms`) : e; };
  return fetch(url, { ...init, signal: c.signal }).then(res => {
    let reading = null;
    const discard = () => { done(); try { res.body?.cancel?.().catch?.(() => {}); } catch {} };
    const text = () => reading ??= readBody(res, c, maxBytes).then(v => { done(); return v; }, fail);
    return { status: res.status, ok: res.ok, headers: res.headers, url: res.url, text, discard };
  }, fail);
}
async function readBody(res, controller, maxBytes) {
  if (!res.body?.getReader) return res.text();
  const reader = res.body.getReader(), chunks = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { controller.abort(); throw new Error(`response exceeds 1 MiB (${maxBytes} bytes); aborted`); }
      chunks.push(value);
    }
  } finally { try { reader.releaseLock(); } catch {} }
  return Buffer.concat(chunks).toString("utf8");
}
// Asynchronous child process with a deadline: the event loop is never blocked for
// the child's lifetime (an apply may run for minutes while the state lock is
// held), and a timeout kills the whole tree (win32: taskkill /T; POSIX: the child's
// own process group), so a grandchild holding the pipes cannot keep us waiting.
function spawnAsync(command, args, { timeout, shell = false, maxBuffer = 8 << 20 } = {}) {
  return new Promise(resolve => {
    const win32 = process.platform === "win32";
    let child;
    try { child = spawn(command, args, { shell, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: !win32 }); }
    catch (e) { resolve({ code: -1, stdout: "", stderr: safeText(e.message), timedOut: false }); return; }
    const out = [], err = []; let bytes = 0, timedOut = false, spawnError = null, settled = false;
    const killTree = () => {
      if (!child.pid) return;
      if (win32) { try { spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore", windowsHide: true, timeout: 10_000 }); } catch {} }
      else { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
      try { child.kill("SIGKILL"); } catch {}
    };
    const finish = status => {
      if (settled) return; settled = true; clearTimeout(timer);
      const error = spawnError || (timedOut ? Object.assign(new Error(`spawn ${command} ETIMEDOUT`), { code: "ETIMEDOUT" }) : null);
      const stderr = Buffer.concat(err).toString("utf8");
      resolve({ code: error ? -1 : status, stdout: Buffer.concat(out).toString("utf8"), stderr: stderr || safeText(error?.message || ""), timedOut });
    };
    const collect = (chunks, chunk) => {
      bytes += chunk.length;
      if (bytes > maxBuffer) { spawnError ??= Object.assign(new Error(`${command} output exceeded ${maxBuffer} bytes`), { code: "ENOBUFS" }); killTree(); return; }
      chunks.push(chunk);
    };
    const timer = setTimeout(() => { timedOut = true; killTree(); }, timeout);
    child.stdout.on("data", d => collect(out, d));
    child.stderr.on("data", d => collect(err, d));
    child.on("error", e => { spawnError = e; if (!child.pid) finish(null); });
    // After a tree kill, do not wait for inherited pipes a straggler might still hold.
    child.on("exit", code => { if (timedOut || spawnError) { child.stdout.destroy(); child.stderr.destroy(); finish(code); } });
    child.on("close", code => finish(code));
  });
}
// Only constant commands from the tables above (plus a located CLI binary for
// `--version`) reach this; the Windows shell is needed for npm's .cmd shims, so an
// executable or argument that cmd.exe would read as syntax (C:\Program Files\...,
// C:\Users\A&B\grok.exe) is quoted, the same rule as update.mjs captureExec. A
// caller's own shell line (shell: true) is passed through untouched. Never pass
// user input through here.
const WIN_SHELL_META = /[\s&|<>^()%!"'`,;=@[\]{}~$]/;
export function defaultExec(command, args = [], { timeout = 60_000, shell = false } = {}) {
  const win32 = process.platform === "win32", q = s => (win32 && !shell && WIN_SHELL_META.test(s) && !/^".*"$/.test(s) ? `"${s}"` : s);
  return spawnAsync(q(command), args.map(q), { timeout, shell: shell || win32 });
}
export function defaultRunUpdater(args) {
  return spawnAsync(process.execPath, [path.join(HERE, "update.mjs"), ...args], { timeout: 600_000 }).then(p => ({ code: p.code, output: `${p.stdout}${p.stderr}` }));
}
async function conditionalGet(ctx, url, entry) {
  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  if (entry.etag) headers["If-None-Match"] = entry.etag;
  if (entry.last_modified) headers["If-Modified-Since"] = entry.last_modified;
  const res = await ctx.fetcher(url, { headers, redirect: "error" });
  if (res.status === 304) { res.discard?.(); return { notModified: true }; }
  if (!res.ok) { res.discard?.(); throw new Error(`HTTP ${res.status}`); }
  const text = await res.text();
  if (Buffer.byteLength(text) > MAX_BODY) throw new Error("response exceeds 1 MiB"); // injected fetchers without a stream
  return { body: JSON.parse(text), etag: res.headers?.get?.("etag") || null, last_modified: res.headers?.get?.("last-modified") || null };
}
// Keeps a prerelease suffix (2.0.0-rc.1) so update.mjs `newer` can rank it below
// its stable instead of an RC being auto-applied as if it were final.
const semver = v => String(v || "").match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/)?.[0] || null;

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
    // An unavailable list (route down, not logged in) keeps the stored baseline;
    // otherwise the next successful answer would look like a first sighting and
    // every model added in between would go unreported.
    if (!Array.isArray(list)) { if (previous[route]) models[route] = previous[route]; continue; }
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
        const latest = r.latest || null, seen = entry.last_seen_version, installed = installedFor(source);
        // A version that differs from the last one seen is a release. On first sight
        // there is nothing seen yet, so a latest newer than the installed version is
        // the release (it opens the 24 h tight window); latest == installed is a baseline.
        const release = latest && (seen ? latest !== seen : Boolean(installed) && newer(latest, installed));
        outcome = r.changed || release ? "changed" : "unchanged";
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
  // Every state read-modify-write goes through here: trigger, record and applyUpdates
  // share one lock so their writes cannot interleave. `fn` receives the lock notices
  // (stale/corrupt lock removals) so it can record them in the state history.
  const withLock = async (fn, lockedResult = { ran: false, skipped_reason: "locked", results: [] }) => {
    const lock = acquireLock(stateFile, isAlive);
    if (!lock) return lockedResult;
    try { return await fn(lock.notices); } finally { lock.release(); }
  };
  const lockHistory = (notices, t, trigger) => notices.map(notice => ({ at: t, trigger, source: "lock", outcome: "stale_lock_removed", notice }));
  // State plus settings, with every degradation (stale lock removed, corrupt state
  // reset, corrupt settings ignored) already queued as history rows.
  const open = (lockNotices, t, trigger) => {
    const { state, notice: stateNotice } = loadState(stateFile), { settings, notice: settingsNotice } = loadSettings(home);
    if (stateNotice) state.history.push({ at: t, trigger, source: "state", outcome: "corrupt_state_reset", notice: stateNotice });
    if (settingsNotice) state.history.push({ at: t, trigger, source: "settings", outcome: "corrupt_settings_ignored", notice: settingsNotice });
    state.history.push(...lockHistory(lockNotices, t, trigger));
    return { state, settings, degraded: Boolean(stateNotice || settingsNotice || lockNotices.length) };
  };
  const clock = {
    stateFile, installedVersions,
    settings: () => readSettings(home),
    setInstalled(name, version) { installedVersions[name] = version; },
    locked: withLock,
    open,
    // A known installed version compared against the latest seen wins; the source's
    // own hint (grok's `update --check`) only stands in while one side is unknown,
    // otherwise a hint recorded before an update would re-trigger it forever.
    updateAvailable(source, entry) {
      const installed = installedFor(source), latest = entry.last_seen_version;
      if (latest && installed) return newer(latest, installed);
      if (entry.update_available_hint !== undefined) return entry.update_available_hint;
      return null;
    },
    trigger: event => withLock(async lockNotices => {
      if (!EVENTS.has(event)) throw new Error(`Unknown update-clock event: ${event}`);
      const t = now(), forced = FORCED_EVENTS.has(event), { state, settings, degraded } = open(lockNotices, t, event);
      const skip = reason => { if (degraded) writeState(stateFile, state); return { ran: false, skipped_reason: reason, results: [] }; };
      if (event === "review.start" && state.last_review_start_check_at && t - state.last_review_start_check_at < settings.clock.min_interval_ms) return skip("rate_limited");
      for (const s of sources) state.sources[s.name] ||= freshEntry(settings.clock.min_interval_ms);
      const due = sources.filter(s => forced || t >= state.sources[s.name].next_due_at);
      if (!due.length) return skip("nothing_due");
      if (event === "review.start") state.last_review_start_check_at = t;
      // Routes narrow to the CLIs with a known installation; when none is known (the
      // default only carries the skill version) every route is asked, so the models
      // source can run at all. Model lists are recorded only, never acted on.
      const known = routes.filter(r => installedVersions[r]);
      const ctx = { fetcher, exec, listModels, routes: known.length ? known : [...routes], now: t };
      const results = [];
      for (const s of due) { results.push(await check(s, state.sources[s.name], ctx, t, event, settings)); state.history.push({ at: t, trigger: event, source: s.name, outcome: results.at(-1).outcome }); }
      writeState(stateFile, state);
      return { ran: true, skipped_reason: null, results };
    }),
    record: entries => withLock(async lockNotices => { const { state } = open(lockNotices, now(), "record"); state.history.push(...entries); writeState(stateFile, state); return { recorded: true, skipped_reason: null }; }, { recorded: false, skipped_reason: "locked" }),
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
// Runs under the clock's lock (the same one `trigger` takes), so its state write can
// never interleave with a check in flight; a lock held by a live process yields
// { skipped_reason: "locked" } in the module's own result shape.
export async function applyUpdates(clock, { runUpdater = defaultRunUpdater, exec = defaultExec, versionOf = async () => null, postUpdateProbe = null, isManaged = () => false, commands = UPDATE_COMMANDS, now = Date.now } = {}) {
  const out = { applied: [], skipped: [], failed: [], notices: [], skipped_reason: null }, settings = clock.settings();
  if (!settings.auto_update.enabled) { out.skipped.push({ name: "*", reason: "auto_update.enabled is false" }); return out; }
  return clock.locked(lockNotices => applyLocked(clock, out, settings, lockNotices, { runUpdater, exec, versionOf, postUpdateProbe, isManaged, commands, now }), { ...out, skipped_reason: "locked" });
}
async function applyLocked(clock, out, settings, lockNotices, { runUpdater, exec, versionOf, postUpdateProbe, isManaged, commands, now }) {
  const history = lockNotices.map(notice => ({ at: now(), trigger: "apply", source: "lock", outcome: "stale_lock_removed", notice }));
  const note = (source, outcome, notice, extra = {}) => { history.push({ at: now(), trigger: "apply", source, outcome, notice, ...extra }); out.notices.push(notice); };
  const status = clock.status(), reportedModels = [];
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
      // The update has happened: a failing version read or probe is recorded on this
      // row, never allowed to lose the accounting or stop the remaining updates.
      let version = null, probe = null;
      try { version = semver(await versionOf(cli)); } catch (e) { probe = { status: "error", error: `version read failed: ${safeText(e.message).slice(0, 200)}` }; }
      if (postUpdateProbe) { try { probe = await postUpdateProbe(cli); } catch (e) { probe = { status: "error", error: safeText(e.message).slice(0, 300) }; } }
      if (version) clock.setInstalled(cli, version);
      out.applied.push({ name: row.name, command, from: row.installed, to: version, probe });
      note(row.name, "applied", `${cli} updated ${row.installed} -> ${version || "unknown"} via '${command}'${probe ? `; probe ${probe.status || JSON.stringify(probe)}${probe.error ? ` (${probe.error})` : ""}` : ""}`, { probe });
    } else if (row.kind === "models" && settings.auto_update.models && row.new_models) {
      for (const [route, list] of Object.entries(row.new_models)) if (list.length) note(row.name, "recorded", `new models available for ${route}: ${list.join(", ")} (configured models unchanged)`);
      reportedModels.push(row.name);
    }
  }
  const flagged = history.filter(h => h.needs_protocol_acceptance).map(h => h.source);
  if (history.length || reportedModels.length) {
    const state = readState(clock.stateFile);
    for (const s of flagged) if (state.sources[s]) state.sources[s].needs_protocol_acceptance = true;
    for (const a of out.applied) {
      const entry = state.sources[a.name];
      if (!entry) continue;
      // A successful skill apply (with or without --accept-protocol) settles any
      // pending acceptance; a successful CLI update retires the source's pre-update
      // hint so the re-read installed version, not the hint, decides what comes next.
      if (a.name === "skill") entry.needs_protocol_acceptance = false;
      else delete entry.update_available_hint;
    }
    // Model discoveries are reported once: the seen set is retired after recording.
    for (const m of reportedModels) if (state.sources[m]) delete state.sources[m].new_models;
    for (const f of out.failed) if (state.sources[f.name]) state.sources[f.name].last_error = f.reason;
    state.history.push(...history);
    writeState(clock.stateFile, state);
  }
  return out;
}
// The dependencies the standalone CLI (OS timer, `trigger` command) applies with:
// the signed updater, the asynchronous exec, `<cli> --version` for the re-read
// version, probes.mjs for the post-update probe when it is importable, and the
// package-manager path fragments (volta, scoop, chocolatey, asdf, mise, homebrew)
// for ownership. `exec` is injectable for tests; `isManaged` accepts a located
// binary for the same reason.
export async function defaultApplyDeps({ exec = defaultExec, root = ROOT } = {}) {
  let probes = null;
  try { probes = await import("./probes.mjs"); } catch { probes = null; }
  const repo = (() => { try { return repoRoot(root); } catch { return root; } })();
  return {
    runUpdater: defaultRunUpdater, exec,
    versionOf: async cli => { const p = await exec(cliBinary(cli), ["--version"], { timeout: 15_000 }); return p.code === 0 ? safeText(p.stdout || p.stderr).trim() : null; },
    postUpdateProbe: probes && typeof probes.runProbes === "function" ? async cli => {
      const r = await probes.runProbes(cli);
      try { probes.recordProbe(repo, r); } catch {}
      return { status: r.verdict, containment: r.containment?.status ?? null, one_line_review: r.one_line_review?.status ?? null, cli_version: r.cli_version ?? null };
    } : null,
    isManaged: (cli, located = locateBinary(cliBinary(cli))) => Boolean(located.package_manager_owned) || /\/(?:\.volta|scoop|chocolatey|\.asdf|\.local\/share\/mise|Cellar|Caskroom)\//i.test(String(located.path || "").replaceAll("\\", "/")),
  };
}

// ---- OS timer registration (daily.tick when no MOMM process runs) --------------
// Each interpolation is escaped for the context it lands in: sh single quotes for
// the cron line and launchctl (a ' in a path becomes '\''), \% for cron's own line
// syntax, XML entities inside the plist. The Windows CRT quoting is unchanged.
const shq = s => `'${String(s).replaceAll("'", "'\\''")}'`;
const xml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
export function timerCommand(platform, nodePath, scriptPath, home = os.homedir()) {
  if (platform === "win32") { const run = `"${nodePath}" "${scriptPath}" trigger daily.tick`; return { platform, install: `schtasks /Create /SC HOURLY /MO 6 /TN MOMM-UpdateClock /TR "${run.replaceAll('"', '\\"')}"`, remove: "schtasks /Delete /TN MOMM-UpdateClock /F" }; }
  if (platform === "darwin") {
    const plist_path = path.join(home, "Library", "LaunchAgents", "uk.42.momm.update-clock.plist");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>uk.42.momm.update-clock</string>\n<key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(scriptPath)}</string><string>trigger</string><string>daily.tick</string></array>\n<key>StartInterval</key><integer>21600</integer>\n<key>RunAtLoad</key><false/>\n</dict></plist>\n`;
    return { platform, plist_path, plist, install: `launchctl load ${shq(plist_path)}`, remove: `launchctl unload ${shq(plist_path)}` };
  }
  const run = `${shq(nodePath)} ${shq(scriptPath)} trigger daily.tick`.replaceAll("%", "\\%");
  const line = `0 */6 * * * ${run} >/dev/null 2>&1 # MOMM-UpdateClock`;
  return { platform: "linux", line, install: `( crontab -l 2>/dev/null | grep -v MOMM-UpdateClock; echo ${shq(line)} ) | crontab -`, remove: "crontab -l 2>/dev/null | grep -v MOMM-UpdateClock | crontab -" };
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
    case "trigger": {
      // The OS timer (daily.tick) and startup reach the clock only through here, so
      // this is where an enabled auto-update actually applies what the check found.
      const result = await clock.trigger(a), flags = argv.slice(2);
      if (flags.includes("--no-apply")) result.apply = { skipped_reason: "no_apply", note: "check only (--no-apply); nothing applied" };
      else if (!clock.settings().auto_update.enabled) result.apply = { applied: [], skipped: [{ name: "*", reason: "auto_update.enabled is false" }], failed: [], notices: [], skipped_reason: "auto_update_disabled", note: "auto-update is off: checks only. Run `update-clock.mjs enable` to apply releases automatically." };
      else result.apply = await applyUpdates(clock, deps.apply || await defaultApplyDeps());
      return result;
    }
    case "enable": return writeSettings(home, { auto_update: { enabled: true } });
    case "disable": return writeSettings(home, { auto_update: { enabled: false } });
    case "set": return writeSettings(home, parseSet(a, b));
    case "timer": if (a === "install") return installTimer({ ...deps.timer, confirm: b === "--confirm" }); if (a === "remove") return removeTimer({ ...deps.timer, confirm: b === "--confirm" }); break;
  }
  throw new Error("Usage: update-clock.mjs status | trigger <event> [--no-apply] | enable | disable | set <key> <value> | timer install|remove [--confirm]");
}
function isEntrypoint() { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }
if (isEntrypoint()) {
  cliMain(process.argv.slice(2)).then(r => process.stdout.write(`${JSON.stringify(r, null, 2)}\n`)).catch(e => { process.stderr.write(`MOMM update clock stopped: ${safeText(e.message)}\n`); process.exitCode = 1; });
}
