#!/usr/bin/env node
// MOMM 1.16 E7 — modality capability registry: baseline plus per-machine overlay.
//
// Two layers, never one file (references/plan-1.16.0-e7-modalities.md):
//   - Baseline  references/capabilities.json — shipped, machine-independent. Levels come
//     from --help captures (`verified`, evidence.help_capture + help_version) or vendor docs
//     (`documented`); never from probes, so no cli_version lives on a baseline route.
//   - Overlay   ~/.momm/capabilities-<machine>.json — written only by probes on THIS
//     machine: `verified` upgrades and blockers (auth_tier, quota, zdr, probe_failed...),
//     each bound to { machine_id, cli_version, login_identity_sha256, at, expires_at }.
//     Writes are serialised by `<file>.lock` (O_EXCL, owner pid) so concurrent probes merge.
//
// The routing source of truth is the EFFECTIVE cell = overlay entry ?? baseline cell
// (effectiveMatrix()). A cell is routable only when its level is verified|documented AND
// its blocker is null. The overlay can raise a level (never a baseline `no` cell, which has
// no invocation to route on) or add a blocker; it never lowers a baseline level, so
// `probe_failed` on any non-`no` cell (even a baseline `verified` one) leaves the level
// standing and blocks routing. An entry whose binding no longer holds (CLI upgraded, login
// changed, other machine), whose binding could not be checked (no installed-version map), or
// whose expiry has passed never silently unblocks: a blocker it carried becomes the derived
// blocker `reprobe` ("probe before routing"); a `verified` upgrade it carried is not applied.
// Zero dependencies. Nothing here runs a CLI except the module CLI's version detection.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const BASELINE_SCHEMA = "momm-capabilities/1";
export const OVERLAY_SCHEMA = "momm-capabilities-overlay/1";
export const EFFECTIVE_SCHEMA = "momm-capabilities-effective/1";
export const LEVELS = Object.freeze(["verified", "documented", "model-only", "no"]);
export const BLOCKERS = Object.freeze(["auth_tier", "zdr", "allowlist", "missing_flag", "quota", "probe_failed", "reprobe"]);
// What a probe may write. `reprobe` is derived from a stale or invalidated entry, never written.
export const PROBE_BLOCKERS = Object.freeze(BLOCKERS.filter((b) => b !== "reprobe"));
// Blockers that describe THIS machine or THIS account; they belong in the overlay only.
export const MACHINE_BLOCKERS = Object.freeze(["auth_tier", "zdr", "missing_flag", "quota", "probe_failed", "reprobe"]);
// Overlay expiry by blocker class; null = until the next probe replaces the entry.
const HOUR = 3_600_000, DAY = 24 * HOUR;
export const OVERLAY_EXPIRY_MS = Object.freeze({ quota: DAY, zdr: 7 * DAY, allowlist: 7 * DAY, auth_tier: 7 * DAY, missing_flag: 7 * DAY, probe_failed: null });
export const DIRECTIONS = Object.freeze(["input", "output"]);
export const INPUT_MODALITIES = Object.freeze(["text", "image", "pdf", "audio", "video", "speech"]);
export const OUTPUT_MODALITIES = Object.freeze(["text", "image_gen", "video_gen", "speech", "code_exec", "web"]);
// Modalities whose output is a file the runner harvests (the cell must name harvest + mime).
export const GENERATIVE_OUTPUTS = Object.freeze(["image_gen", "video_gen", "speech"]);
export const TEMPLATE_PLACEHOLDERS = Object.freeze(["file", "dir"]);
export const OVERLAY_LOCK_TIMEOUT_MS = 5_000;
const LEVEL_RANK = { verified: 3, documented: 2, "model-only": 1, no: 0 };
const HELP_CAPTURE = /^references\/cli\/help\/[A-Za-z0-9._-]+\.txt:\d+$/;
// Any brace group is a placeholder candidate; only {file} and {dir} are bindable.
const PLACEHOLDER = /\{([^}]*)\}/g;
const TRANSIENT = new Set(["EEXIST", "EPERM", "EBUSY", "EACCES"]);

const here = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = path.resolve(here, "..", "references", "capabilities.json");
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const toMs = (d) => (typeof d === "function" ? d() : new Date(d)).getTime();
const semver = (text) => String(text ?? "").match(/\d+\.\d+\.\d+/)?.[0] ?? null;
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; } };
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The exact action that clears each blocker, specialised per route where the route has
// its own switch. Overlay entries may add a free-text `reason` beside it.
export const CLEARING_ACTIONS = Object.freeze({
  auth_tier: { gemini: "Use a Standard or Enterprise Code Assist licence (gemini, then /auth); individual tiers were retired 2026-06-18. For Nano Banana or Gemini models under an account login, route through antigravity instead.", "*": "Sign in with an account tier the provider still serves; the route's login hint names the browser flow." },
  zdr: { grok: "Inside grok run /privacy to turn zero data retention off, or configure a user-hosted storage bucket in ~/.grok/managed_config.toml (https://docs.x.ai/build/settings/zdr-video-storage).", "*": "Relax the provider's zero-data-retention setting for this tool, or supply the storage the provider asks for." },
  allowlist: { antigravity: "Add command(<target>) under permissions.allow in ~/.gemini/antigravity-cli/settings.json (MOMM never passes --dangerously-skip-permissions).", copilot: "Add a shell(command) or url(...) permission rule, or pass --allow-tool / --allow-url for the exact target.", "*": "Grant the permission rule the CLI's headless mode asks for in its settings file." },
  missing_flag: { "*": "Bind the flag or directory grant the cell's `how`/`requires` templates name ({file}, {dir}); a template with any other placeholder cannot be bound and must be fixed in the registry." },
  quota: { copilot: "Wait for the monthly Copilot allowance to reset, or change the plan; nothing on this machine clears it sooner.", "*": "Wait for the provider's allowance to reset or change the plan." },
  probe_failed: { "*": "Re-run `node momm/scripts/probes.mjs <cli> --modalities`; the baseline level stands until a probe confirms or the registry is revised." },
  reprobe: { "*": "Probe before routing: run `node momm/scripts/probes.mjs <cli> --modalities` (the recorded result expired, its CLI version / login binding no longer holds, or the binding could not be checked)." },
});
export function clearingAction(blocker, route) {
  if (!blocker) return null;
  const table = CLEARING_ACTIONS[blocker];
  if (!table) return `Unknown blocker ${blocker}: consult references/plan-1.16.0-e7-modalities.md.`;
  return (table[route] ?? table["*"]).replace("<cli>", route ?? "<cli>");
}
// Why a level below `documented` cannot be routed and what (if anything) would change it.
export function levelAction(level) {
  if (level === "model-only") return "No headless path under an account login: the model can, the CLI exposes no non-interactive flag or tool. Not clearable by configuration; wait for a CLI release or use another route.";
  if (level === "no") return "No path found for this modality on this route.";
  return null;
}

// ---- binding templates ---------------------------------------------------------------------
// Input cells describe how a staged file is bound: templates in `how` and `requires` use
// {file} (repeated per artefact) and {dir} (the step's work directory). Anything else cannot be
// bound and is reported as `missing_flag` by the planner and runner.
export const templatesOf = (cell) => [cell?.how, ...(Array.isArray(cell?.requires) ? cell.requires : [])].filter((t) => typeof t === "string");
export function bindingProblem(cell) {
  for (const template of templatesOf(cell)) {
    for (const match of template.matchAll(PLACEHOLDER)) if (!TEMPLATE_PLACEHOLDERS.includes(match[1])) return `template "${template}" uses unknown placeholder {${match[1]}}`;
  }
  return null;
}

// ---- baseline ---------------------------------------------------------------------------------
export function loadBaseline(file = BASELINE_PATH) {
  const baseline = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = validateBaseline(baseline);
  if (problems.length) throw new Error(`Invalid capabilities baseline ${file}:\n  ${problems.join("\n  ")}`);
  return baseline;
}
export function routesOf(registry) { return Object.keys(registry.routes ?? {}); }

// Structural validation of a baseline document. Returns a list of problems (empty = valid) and
// never throws on malformed input. `helpRoot` lets the self-test confirm that every cited
// help-capture line exists (captures are read once per call).
export function validateBaseline(baseline, { helpRoot = path.resolve(here, "..") } = {}) {
  const problems = [];
  if (!isPlainObject(baseline)) return ["baseline is not an object"];
  if (baseline.schema !== BASELINE_SCHEMA) problems.push(`schema must be ${BASELINE_SCHEMA}`);
  for (const [direction, expected] of [["input", INPUT_MODALITIES], ["output", OUTPUT_MODALITIES]]) {
    const declared = baseline.modalities?.[direction];
    if (!Array.isArray(declared) || declared.length !== expected.length || new Set(declared).size !== expected.length || !expected.every(m => declared.includes(m))) {
      problems.push(`modalities.${direction} must declare exactly the supported vocabulary`);
    }
  }
  if (!isPlainObject(baseline.routes) || !Object.keys(baseline.routes).length) return [...problems, "routes must be a non-empty object"];
  const captures = new Map();
  const captureLines = (file) => {
    if (!captures.has(file)) { const full = path.join(helpRoot, file); captures.set(file, fs.existsSync(full) ? fs.readFileSync(full, "utf8").split(/\r?\n/) : null); }
    return captures.get(file);
  };
  const checkEvidence = (at, ev, { verified = false, documented = false } = {}) => {
    const hasHelp = isPlainObject(ev) && typeof ev.help_capture === "string";
    const hasDocs = isPlainObject(ev) && Array.isArray(ev.docs) && ev.docs.length > 0 && ev.docs.every((u) => /^https?:\/\/\S+$/.test(u));
    if (!hasHelp && !hasDocs) problems.push(`${at}: needs evidence.help_capture or evidence.docs`);
    if (hasHelp) {
      if (typeof ev.help_version !== "string" || !/^\d+\.\d+\.\d+/.test(ev.help_version)) problems.push(`${at}: help_capture needs evidence.help_version (the CLI version whose --help was captured)`);
      if (!HELP_CAPTURE.test(ev.help_capture)) problems.push(`${at}: help_capture must look like references/cli/help/<file>.txt:<line>`);
      else if (helpRoot) {
        const [file, line] = ev.help_capture.split(":");
        const lines = captureLines(file);
        if (!lines) problems.push(`${at}: help capture ${file} not found`);
        else { const n = Number(line); if (n < 1 || n > lines.length || !lines[n - 1].trim()) problems.push(`${at}: ${ev.help_capture} is not a non-empty line`); }
      }
    }
    // `verified` in the baseline only ever comes from a help capture (the flag is in --help).
    if (verified && !hasHelp) problems.push(`${at}: verified without a help_capture (a probe result belongs in the overlay; docs-only evidence is documented)`);
    if (documented && !hasDocs) problems.push(`${at}: documented without docs (help-only evidence does not establish the documented level)`);
  };
  for (const [route, entry] of Object.entries(baseline.routes)) {
    if (!isPlainObject(entry)) { problems.push(`${route}: not an object`); continue; }
    if ("cli_version" in entry) problems.push(`${route}: cli_version does not belong on a baseline route (versions live in evidence.help_version; the installed version is machine state)`);
    if (!isPlainObject(entry.models)) problems.push(`${route}: models missing`);
    else if (entry.models.evidence) checkEvidence(`${route}.models`, entry.models.evidence);
    for (const direction of DIRECTIONS) {
      const expected = direction === "input" ? INPUT_MODALITIES : OUTPUT_MODALITIES;
      const cells = entry[direction];
      if (!isPlainObject(cells)) { problems.push(`${route}.${direction}: missing`); continue; }
      for (const modality of expected) if (!(modality in cells)) problems.push(`${route}.${direction}.${modality}: cell missing`);
      for (const [modality, cell] of Object.entries(cells)) {
        const at = `${route}.${direction}.${modality}`;
        if (!expected.includes(modality)) { problems.push(`${at}: unknown modality`); continue; }
        if (!isPlainObject(cell)) { problems.push(`${at}: cell must be an object`); continue; }
        if (!LEVELS.includes(cell.level)) { problems.push(`${at}: level must be one of ${LEVELS.join("|")}`); continue; }
        if ("blocker" in cell && cell.blocker !== null) {
          if (!BLOCKERS.includes(cell.blocker)) problems.push(`${at}: blocker must be one of ${BLOCKERS.join("|")}`);
          else if (MACHINE_BLOCKERS.includes(cell.blocker)) problems.push(`${at}: machine-specific blocker ${cell.blocker} belongs in the overlay, never in the baseline`);
        }
        if (cell.level === "no") continue;
        if (typeof cell.how !== "string" || !cell.how.trim()) problems.push(`${at}: non-no cell needs a how`);
        checkEvidence(at, cell.evidence, { verified: cell.level === "verified", documented: cell.level === "documented" });
        if (direction === "output" && GENERATIVE_OUTPUTS.includes(modality)) {
          if (typeof cell.harvest !== "string" || !cell.harvest.includes("/")) problems.push(`${at}: generative cell needs a harvest glob`);
          if (typeof cell.mime !== "string" || !cell.mime.includes("/")) problems.push(`${at}: generative cell needs a mime type`);
        }
        const requiresOk = !("requires" in cell) || (Array.isArray(cell.requires) && cell.requires.every((r) => typeof r === "string"));
        if (!requiresOk) problems.push(`${at}: requires must be a string list`);
        if (direction === "input" && requiresOk) { const problem = bindingProblem(cell); if (problem) problems.push(`${at}: ${problem}`); }
      }
    }
  }
  return problems;
}

// ---- machine identity and overlay file --------------------------------------------------------
export function machineId({ hostname = os.hostname(), platform = process.platform, homedir = os.homedir() } = {}) {
  return sha256(`${hostname}\n${platform}\n${homedir}`).slice(0, 16);
}
export function overlayPath(home = os.homedir(), machine = machineId()) {
  return path.join(home, ".momm", `capabilities-${machine}.json`);
}
const identityHash = (value) => (value == null ? null : /^[0-9a-f]{64}$/.test(String(value)) ? String(value) : sha256(String(value)));

function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
}
function readOverlayFile(file) {
  if (!fs.existsSync(file)) return { schema: OVERLAY_SCHEMA, entries: [] };
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isPlainObject(value) || value.schema !== OVERLAY_SCHEMA || !Array.isArray(value.entries)) throw new Error("not an overlay document");
    return value;
  } catch (e) { throw new Error(`Capabilities overlay ${file} is unreadable (${e.message}); delete it and re-run the probes`); }
}
const sameCell = (a, b) => a.route === b.route && a.direction === b.direction && a.modality === b.modality;
// Serialises overlay writers across processes (the guidance.mjs trust-lock discipline): the lock
// holds the owner's pid. Never steal a lock: PID checks and unlink are not atomic.
function withOverlayLock(file, timeoutMs, fn) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { fs.writeFileSync(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); break; } catch (e) {
      if (!TRANSIENT.has(e?.code)) throw e;
      // Every failed acquisition observes the deadline, even during churn.
      if (Date.now() >= deadline) throw new Error(`Capabilities overlay lock ${lock} requires waiting or explicit recovery. Stop all MOMM writers, including older versions, and independently confirm none remain before removing only this lock; retry afterward. PID or age alone does not prove safe recovery.`);
      sleepMs(20);
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch { /* already gone */ } }
}

// Records one probe result. `level` (an upgrade) and/or `blocker` (null clears a baseline
// blocker on this machine); `reason` is free text shown beside the blocker. The entry is
// bound to this machine, the CLI version probed and the (hashed) login identity, and
// carries an `expires_at` by blocker class (OVERLAY_EXPIRY_MS; null = until the next probe).
// The read-modify-write runs under the overlay lock so concurrent probes never drop each other.
export function writeOverlayEntry(home, entry, { now = new Date(), machine = machineId(), baseline = null, lockTimeoutMs = OVERLAY_LOCK_TIMEOUT_MS } = {}) {
  const { route, direction, modality, level, blocker, reason, cli_version, login_identity_sha256 } = entry ?? {};
  if (typeof route !== "string" || !route) throw new Error("overlay entry needs a route");
  if (!DIRECTIONS.includes(direction)) throw new Error(`overlay entry direction must be ${DIRECTIONS.join("|")}`);
  const modalities = direction === "input" ? INPUT_MODALITIES : OUTPUT_MODALITIES;
  if (!modalities.includes(modality)) throw new Error(`overlay entry modality must be one of ${modalities.join("|")} for ${direction}`);
  if (level !== undefined && !LEVELS.includes(level)) throw new Error(`overlay entry level must be one of ${LEVELS.join("|")}`);
  if (blocker === "reprobe") throw new Error("reprobe is derived from a stale or invalidated entry; a probe never writes it");
  if (blocker !== undefined && blocker !== null && !PROBE_BLOCKERS.includes(blocker)) throw new Error(`overlay entry blocker must be one of ${PROBE_BLOCKERS.join("|")}`);
  if (level === undefined && blocker === undefined) throw new Error("overlay entry needs a level or a blocker");
  if (typeof cli_version !== "string" || !cli_version) throw new Error("overlay entry needs the probed cli_version");
  if (baseline) {
    const cell = baseline.routes?.[route]?.[direction]?.[modality];
    if (!cell) throw new Error(`overlay entry names unknown cell ${route}.${direction}.${modality}`);
    if (cell.level === "no") throw new Error(`${route}.${direction}.${modality} is a no cell in the baseline: it carries no invocation, harvest or mime, so a probe can neither promote nor block it`);
  }
  const nowMs = toMs(now);
  const ttl = blocker ? OVERLAY_EXPIRY_MS[blocker] ?? null : null;
  const written = {
    route, direction, modality,
    ...(level !== undefined ? { level } : {}),
    ...(blocker !== undefined ? { blocker } : {}),
    ...(reason ? { reason: String(reason).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, 400) } : {}),
    machine_id: machine, cli_version, login_identity_sha256: identityHash(login_identity_sha256),
    at: new Date(nowMs).toISOString(), expires_at: ttl ? new Date(nowMs + ttl).toISOString() : null,
  };
  const file = overlayPath(home, machine);
  return withOverlayLock(file, lockTimeoutMs, () => {
    const doc = readOverlayFile(file);
    doc.machine_id = machine;
    doc.entries = [...doc.entries.filter((e) => !sameCell(e, written)), written];
    writePrivate(file, `${JSON.stringify(doc, null, 2)}\n`);
    return { path: file, entry: written };
  });
}

// Reads the overlay and sorts entries into `entries` (binding holds, not expired),
// `invalidated` (machine, CLI version or login changed, or could not be checked) and `stale`
// (expired). `installedVersions` maps route -> version string and is REQUIRED for an entry to
// count: without the map every entry is `version_unchecked`. `loginIdentity` maps route ->
// identity (raw or sha256); when supplied, a route missing from it is `login_unknown`; when
// omitted the login dimension is not checked (probes bind a null identity when none is known).
export function readOverlay(home = os.homedir(), { installedVersions, loginIdentity, machine = machineId(), now = new Date() } = {}) {
  const file = overlayPath(home, machine);
  const doc = readOverlayFile(file);
  const nowMs = toMs(now);
  const entries = [], invalidated = [], stale = [];
  for (const entry of doc.entries) {
    let reason = null;
    if (entry.machine_id !== machine) reason = "machine_mismatch";
    else if (!isPlainObject(installedVersions)) reason = "version_unchecked";
    else if (!Object.hasOwn(installedVersions, entry.route) || !installedVersions[entry.route]) reason = "cli_version_unknown";
    else if (installedVersions[entry.route] !== entry.cli_version) reason = "cli_version_changed";
    else if (isPlainObject(loginIdentity)) {
      if (!Object.hasOwn(loginIdentity, entry.route)) reason = "login_unknown";
      else if (identityHash(loginIdentity[entry.route]) !== (entry.login_identity_sha256 ?? null)) reason = "login_changed";
    }
    if (reason) { invalidated.push({ entry, reason }); continue; }
    if (entry.expires_at && Date.parse(entry.expires_at) <= nowMs) { stale.push({ entry, reason: "expired" }); continue; }
    entries.push(entry);
  }
  return { path: file, machine_id: machine, entries, invalidated, stale };
}

// ---- effective matrix ---------------------------------------------------------------------------
function baselineCell(cell) {
  return {
    level: cell.level, blocker: cell.blocker ?? null, how: cell.how ?? null, requires: Array.isArray(cell.requires) ? cell.requires : [],
    harvest: cell.harvest ?? null, mime: cell.mime ?? null, evidence: cell.evidence ?? null, reason: null, source: "baseline",
  };
}
export function effective({ home = os.homedir(), installedVersions, loginIdentity, baseline = loadBaseline(), overlay, machine = machineId(), now = new Date() } = {}) {
  const read = overlay ?? readOverlay(home, { installedVersions, loginIdentity, machine, now });
  const result = {
    schema: EFFECTIVE_SCHEMA, machine_id: machine, captured_at: baseline.captured_at ?? null,
    binding: { versions: isPlainObject(installedVersions), login: isPlainObject(loginIdentity) },
    overlay: { path: read.path ?? null, applied: 0, reprobe: 0, invalidated: read.invalidated ?? [], stale: read.stale ?? [] },
    routes: {},
  };
  for (const [route, entry] of Object.entries(baseline.routes)) {
    result.routes[route] = { installed_version: installedVersions?.[route] ?? null, models: clone(entry.models ?? {}), input: {}, output: {} };
    for (const direction of DIRECTIONS) for (const [modality, cell] of Object.entries(entry[direction] ?? {})) if (isPlainObject(cell)) result.routes[route][direction][modality] = baselineCell(cell);
  }
  const stamp = (cell, entry) => { cell.source = "overlay"; cell.overlay = { cli_version: entry.cli_version, at: entry.at, expires_at: entry.expires_at ?? null }; };
  for (const entry of read.entries ?? []) {
    const cell = result.routes[entry.route]?.[entry.direction]?.[entry.modality];
    // A baseline `no` cell carries no how/harvest/mime: nothing to route on, so the overlay cannot touch it.
    if (!cell || cell.level === "no") continue;
    let applied = false;
    // Levels only ever go up: a probe can prove more than the documentation, never less.
    if (entry.level && LEVEL_RANK[entry.level] > LEVEL_RANK[cell.level]) { cell.level = entry.level; applied = true; }
    // A blocker applies to ANY non-no cell, baseline `verified` included; the level stands.
    if ("blocker" in entry) { cell.blocker = entry.blocker ?? null; applied = true; }
    if (applied) { stamp(cell, entry); cell.reason = entry.reason ?? null; result.overlay.applied++; }
  }
  // Never silently unblock: a blocker whose entry expired, lost its binding or could not be checked
  // becomes `reprobe`. A `verified` upgrade in the same position is simply not applied.
  for (const { entry, reason } of [...(read.invalidated ?? []), ...(read.stale ?? [])]) {
    const cell = result.routes[entry.route]?.[entry.direction]?.[entry.modality];
    if (!cell || !entry.blocker || cell.level === "no") continue;
    cell.blocker = "reprobe";
    cell.reason = `${entry.blocker} recorded ${entry.at} is ${reason}; probe before routing${entry.reason ? ` (${entry.reason})` : ""}`;
    stamp(cell, entry);
    result.overlay.reprobe++;
  }
  return result;
}
export const effectiveMatrix = effective;
export const effectiveCell = (matrix, route, direction, modality) => matrix?.routes?.[route]?.[direction]?.[modality] ?? null;
export const routable = (cell) => !!cell && (cell.level === "verified" || cell.level === "documented") && (cell.blocker ?? null) === null;

// The dispatcher-shaped table { route: { modality: how } } of routable INPUT cells. A derived
// baseline projection kept for MODALITY_SUPPORT compatibility and the self-test; routing itself
// reads effective cells. Accepts a baseline document or an effective matrix.
export function projection(registry) {
  const out = {};
  for (const [route, entry] of Object.entries(registry.routes)) {
    out[route] = {};
    for (const [modality, cell] of Object.entries(entry.input ?? {})) if (routable(cell)) out[route][modality] = cell.how;
  }
  return out;
}

// `--reviewers auto` with attachments: the routes routable for text AND every attached
// modality. An empty intersection is a refusal with the per-modality options listed.
export function autoReviewers(matrix, attachedModalities = [], { pool = null } = {}) {
  const modalities = [...new Set(["text", ...attachedModalities])];
  const routes = Object.keys(matrix.routes).filter((r) => !pool || pool.includes(r));
  const per_modality = {};
  for (const modality of modalities) per_modality[modality] = routes.filter((r) => routable(matrix.routes[r].input[modality]));
  const reviewers = routes.filter((r) => modalities.every((m) => per_modality[m].includes(r)));
  const unroutable = {};
  for (const modality of modalities) unroutable[modality] = routes.filter((r) => !per_modality[modality].includes(r)).map((r) => {
    const cell = matrix.routes[r].input[modality] ?? { level: "no", blocker: null };
    return { route: r, level: cell.level, blocker: cell.blocker ?? null, action: cell.blocker ? clearingAction(cell.blocker, r) : levelAction(cell.level) };
  });
  return reviewers.length ? { empty: false, reviewers, per_modality, unroutable } : { empty: true, reviewers: [], per_modality, unroutable };
}

// ---- installed versions (binding input for the CLI; the dispatcher has its own preflight) ----------
// Runs `<cli> --version` per route through the probes' secret-scrubbed spawn (imported lazily so
// the registry itself never depends on it) and returns { route: semver | null }.
export async function detectInstalledVersions(routes, { exec, resolveCommand, timeoutMs = 30_000 } = {}) {
  if (!exec || !resolveCommand) { const probes = await import("./probes.mjs"); exec ??= probes.defaultExec; resolveCommand ??= probes.resolveCommand; }
  const boundedExec = async (command, args, options) => {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => exec(command, args, options)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error("version probe deadline exceeded"), { code: "ETIMEDOUT" })), timeoutMs);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  };
  const versions = {};
  await Promise.all(routes.map(async (route) => {
    try { const r = await boundedExec(resolveCommand(route), ["--version"], { timeout: timeoutMs, input: "" }); versions[route] = semver(`${r.stdout ?? ""}\n${r.stderr ?? ""}`); }
    catch { versions[route] = null; }
  }));
  return versions;
}

// ---- rendering ------------------------------------------------------------------------------------
const LEVEL_MARK = { verified: "verified", documented: "documented", "model-only": "model-only", no: "-" };
export function renderMatrix(matrix, { json = false } = {}) {
  if (json) return `${JSON.stringify(matrix, null, 2)}\n`;
  const routes = Object.keys(matrix.routes);
  const lines = [];
  const width = Math.max(5, ...routes.map((r) => r.length));
  const mark = (cell) => {
    if (!cell) return "?";
    let text = LEVEL_MARK[cell.level] ?? cell.level;
    if (cell.blocker) text += `!${cell.blocker}`;
    if (cell.source === "overlay") text += "*";
    return text;
  };
  const table = (direction, modalities) => {
    // Column widths follow the widest cell text (a blocker suffix can be long), never a fixed size.
    const rows = routes.map((route) => modalities.map((m) => mark(matrix.routes[route][direction][m])));
    const cols = modalities.map((m, i) => Math.max(m.length, 10, ...rows.map((r) => r[i].length)));
    lines.push(`${direction.toUpperCase().padEnd(width + 2)}${modalities.map((m, i) => m.padEnd(cols[i] + 2)).join("")}`.trimEnd());
    routes.forEach((route, r) => lines.push(`${route.padEnd(width + 2)}${rows[r].map((text, i) => text.padEnd(cols[i] + 2)).join("")}`.trimEnd()));
    lines.push("");
  };
  lines.push(`MOMM modality capabilities (effective for machine ${matrix.machine_id ?? "?"}; baseline captured ${matrix.captured_at ?? "?"})`, "");
  table("input", INPUT_MODALITIES);
  table("output", OUTPUT_MODALITIES);
  lines.push("Legend: verified | documented = routable when no blocker; model-only = no headless path; - = no path; !blocker = not usable here; * = set by this machine's probe overlay.", "");
  const blocked = [];
  for (const route of routes) for (const direction of DIRECTIONS) for (const [modality, cell] of Object.entries(matrix.routes[route][direction])) {
    if (cell.blocker) blocked.push(`  ${route} ${direction}.${modality}: ${cell.blocker}${cell.reason ? ` (${cell.reason})` : ""} -> ${clearingAction(cell.blocker, route)}`);
  }
  if (blocked.length) lines.push("Blockers and what clears them:", ...blocked, "");
  lines.push("Invocation and evidence per cell:");
  for (const route of routes) for (const direction of DIRECTIONS) for (const [modality, cell] of Object.entries(matrix.routes[route][direction])) {
    if (cell.level === "no") continue;
    const ev = cell.evidence ?? {};
    const cite = [ev.help_capture ? `help ${ev.help_capture}${ev.help_version ? ` (v${ev.help_version})` : ""}` : null, ev.docs?.length ? `docs ${ev.docs.join(" ")}` : null].filter(Boolean).join("; ");
    lines.push(`  ${route} ${direction}.${modality} [${cell.level}${cell.blocker ? ` !${cell.blocker}` : ""}] ${cell.how}${cell.requires?.length ? ` (requires ${cell.requires.join(", ")})` : ""}${cell.harvest ? ` -> ${cell.harvest}` : ""}${cite ? ` | ${cite}` : ""}`);
  }
  const ignored = [...(matrix.overlay?.invalidated ?? []), ...(matrix.overlay?.stale ?? [])];
  if (ignored.length) lines.push("", `Overlay entries no longer trusted (blockers among them show as reprobe): ${ignored.map((d) => `${d.entry.route} ${d.entry.direction}.${d.entry.modality} (${d.reason})`).join(", ")}`);
  if (matrix.binding) lines.push("", `Binding checked: installed versions ${matrix.binding.versions ? "yes" : "NO (every overlay entry shows as reprobe)"}; login identity ${matrix.binding.login ? "yes" : "not checked"}.`);
  return `${lines.join("\n")}\n`;
}

// ---- CLI: node capabilities.mjs [--json] [--home <dir>] [--versions <json>] [--logins <json>] -------------
// Without --versions the installed CLIs are asked for their versions so the overlay binding is
// checked; the login dimension is only checked when --logins supplies route -> identity.
async function main(argv) {
  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean", default: false }, home: { type: "string" }, versions: { type: "string" }, logins: { type: "string" } }, strict: true });
  const home = values.home ?? os.homedir();
  const baseline = loadBaseline();
  let installedVersions;
  if (values.versions) { installedVersions = JSON.parse(values.versions); process.stderr.write(`installed versions read from --versions: ${Object.entries(installedVersions).map(([r, v]) => `${r} ${v}`).join(", ")}\n`); }
  else {
    installedVersions = await detectInstalledVersions(routesOf(baseline));
    process.stderr.write(`installed versions detected from the CLIs: ${Object.entries(installedVersions).map(([r, v]) => `${r} ${v ?? "(not found)"}`).join(", ")}\n`);
  }
  const loginIdentity = values.logins ? JSON.parse(values.logins) : undefined;
  if (!loginIdentity) process.stderr.write("login identity binding not checked (pass --logins '{\"route\":\"identity\"}' to bind overlay entries to a login)\n");
  process.stdout.write(renderMatrix(effective({ home, baseline, installedVersions, loginIdentity }), { json: values.json }));
}
function isEntrypoint() { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }
if (isEntrypoint()) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
}
