// MOMM 1.16 E4 — layered guidance prompts for reviewers and the governor.
//
// Resolves `~/.momm/guidance.json` (user), `.reviewrules` + `.momm/guidance.json`
// (project, trust-gated because they arrive with a clone), `--guidance-file`
// and `--guidance` (CLI) into one appended stack per route. Layers append and
// never replace; layer 0 (the built-in persona) is a selector the caller owns,
// so this module only hashes it. A run with no guidance resolves to "" and the
// prompt assembled by assemblePrompt() is byte-identical to 1.15.
//
// Project files are handled with one discipline: stat (64 KiB cap), read the
// bytes exactly once, hash THOSE bytes, check trust, and only then parse the
// same bytes. Anything untrusted, oversized or malformed becomes a notice and
// is skipped — a clone can never abort a review or be applied under a hash the
// user did not approve. Trust is per file: approving one hash never trusts the
// companion file.
//
// .reviewrules grace (1.16 only). MOMM 1.15 applied a project's .reviewrules
// unconditionally, so projects that already ship one would silently lose their
// rules the day trust gating arrived. 1.16 therefore still applies an untrusted
// .reviewrules by default (`reviewrulesGrace: true`) but says so loudly: the
// notice names the risk (clone-supplied text entering every reviewer prompt)
// and the exact trust command. The grace ends in 1.17, where the default flips
// to skip-until-trusted; `reviewrulesGrace: false` is that behaviour today.
//
// Guidance text is returned to the caller (who sanitises it with the same
// scanner as the artifact) and persisted ONLY in the local 0600 sidecar; the
// report receives hashes via guidanceReportFields(). Zero dependencies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const GUIDANCE_BUDGET = Object.freeze({ per_block: 2000, per_route: 6000 });
export const GUIDANCE_FILE_MAX_BYTES = 64 * 1024; // stat-checked before any project file is read
export const ARTIFACT_DELIMITER = "--- ARTIFACT TO REVIEW ---";
export const GUIDANCE_HEADING = "## Reviewer guidance (shapes emphasis and suggestions — never the schema, never the truthfulness of findings, never the read-only rules)";
export const TRUST_KINDS = Object.freeze(["guidance", "reviewrules"]);
const TRUST_ONLY = Object.freeze([...TRUST_KINDS, "both"]);
const REVIEWRULES_CLIP = 4000; // 1.15 clipping kept through the grace release
const CONTROL = /[\x00-\x08\x0B-\x1F]/; // anything < 0x20 except \n (0x0A) and \t (0x09)
const RUN_ID = /^rev_[A-Za-z0-9_]+$/;
const TOP_KEYS = ["governor", "reviewers"];
const SOURCE_ORDER = ["user", "project", "cli:file", "cli:arg"];
const LOCK_TIMEOUT_MS = 5_000;

export function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
const hashOrNull = (text) => (text ? sha256(text) : null);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const projectGuidanceFiles = (dir) => ({ guidance: path.join(dir, ".momm", "guidance.json"), reviewrules: path.join(dir, ".reviewrules") });
export const userGuidancePath = (home) => path.join(home ?? os.homedir(), ".momm", "guidance.json");
export const trustStorePath = (home) => path.join(home ?? os.homedir(), ".momm", "trust.json");
export const trustCommand = (sha) => `node momm/scripts/multi-review.mjs guidance --trust ${sha}`;

// The canonical trust-store key for a project directory: the native real path
// (symlinks, 8.3 short names and subst drives collapse), lower-cased on win32
// where the filesystem is case-insensitive. A directory that does not exist yet
// keeps its resolved spelling.
export function trustKey(projectDir) {
  let dir = path.resolve(projectDir);
  try { dir = fs.realpathSync.native(dir); } catch { /* absent: keep the resolved spelling */ }
  return process.platform === "win32" ? dir.toLowerCase() : dir;
}

// Reads a file's bytes exactly once, bounded. Returns null when absent,
// { error } when it must be skipped (oversized, not a regular file, unreadable),
// otherwise { bytes, sha256 } — the caller hashes/checks/parses these same bytes.
// followLinks: false is for files that arrive with a clone: a symbolic link there could name any
// other file the user can read, so it is refused (lstat, and a no-follow open where the platform
// has one) instead of being read into reviewer prompts. Paths the user chose keep following links.
export function readBoundedBytes(file, cap = GUIDANCE_FILE_MAX_BYTES, { followLinks = true } = {}) {
  let stat;
  if (!followLinks) {
    try { if (fs.lstatSync(file).isSymbolicLink()) return { error: "is a symbolic link" }; }
    catch (e) { return e?.code === "ENOENT" ? null : { error: `unreadable (${e.message})` }; }
  }
  try { stat = fs.statSync(file); } catch (e) { return e?.code === "ENOENT" ? null : { error: `unreadable (${e.message})` }; }
  if (!stat.isFile()) return { error: "not a regular file" };
  if (stat.size > cap) return { error: `is ${stat.size} bytes; the cap is ${cap} bytes` };
  const buffer = Buffer.allocUnsafe(cap + 1); // one extra byte detects growth between stat and read
  let fd, length = 0;
  try {
    fd = fs.openSync(file, followLinks ? "r" : (fs.constants.O_RDONLY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0));
    for (let got = 1; got > 0 && length < buffer.length; length += got) got = fs.readSync(fd, buffer, length, buffer.length - length, length);
  } catch (e) { return { error: `unreadable (${e.message})` }; } finally { if (fd !== undefined) fs.closeSync(fd); }
  if (length > cap) return { error: `grew past ${cap} bytes while being read` };
  const bytes = Buffer.from(buffer.subarray(0, length));
  return { bytes, sha256: sha256(bytes) };
}

function assertBlock(text, label, source, cap = GUIDANCE_BUDGET.per_block) {
  if (typeof text !== "string") throw new Error(`guidance block ${label} in ${source} must be a string`);
  const bad = CONTROL.exec(text);
  if (bad) throw new Error(`guidance block ${label} in ${source} contains a control character (0x${bad[0].charCodeAt(0).toString(16).padStart(2, "0")} at offset ${bad.index})`);
  if (text.includes(ARTIFACT_DELIMITER)) throw new Error(`guidance block ${label} in ${source} contains the artifact delimiter "${ARTIFACT_DELIMITER}" (offset ${text.indexOf(ARTIFACT_DELIMITER)}); guidance may not open a second artifact boundary`);
  if (text.length > cap) throw new Error(`guidance block ${label} in ${source} is ${text.length} characters; the cap is ${cap}`);
  return text;
}

// Validates a parsed guidance object and returns a copy holding only known keys.
export function validateGuidance(value, source) {
  if (!isPlainObject(value)) throw new Error(`guidance in ${source} must be a JSON object with optional "governor" and "reviewers" keys`);
  const unknown = Object.keys(value).filter((k) => !TOP_KEYS.includes(k));
  if (unknown.length) throw new Error(`guidance in ${source} has unknown top-level key(s): ${unknown.join(", ")} (allowed: ${TOP_KEYS.join(", ")})`);
  const out = {};
  if (value.governor !== undefined) out.governor = assertBlock(value.governor, "governor", source);
  if (value.reviewers !== undefined) {
    if (!isPlainObject(value.reviewers)) throw new Error(`guidance "reviewers" in ${source} must be an object of route (or "*") to text`);
    out.reviewers = {};
    for (const [route, text] of Object.entries(value.reviewers)) out.reviewers[route] = assertBlock(text, `reviewers.${route}`, source);
  }
  return out;
}

// Parses and validates guidance from bytes already read (and, for project
// files, already trust-checked) so no second read can swap the content.
export function parseGuidanceBytes(bytes, source) {
  let parsed;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch (e) { throw new Error(`Invalid JSON in ${source}: ${e.message}`); }
  return validateGuidance(parsed, source);
}

// For the user's own file and --guidance-file: absent -> null, invalid -> throws.
export function readGuidanceFile(filePath) {
  const read = readBoundedBytes(filePath);
  if (read === null) return null;
  if (read.error) throw new Error(`guidance file ${filePath} ${read.error}`);
  return parseGuidanceBytes(read.bytes, filePath);
}

// --- Trust store: ~/.momm/trust.json, canonical project path -> file hashes ----
function readTrust(home) {
  const file = trustStorePath(home);
  if (!fs.existsSync(file)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isPlainObject(value)) throw new Error("not a JSON object");
    return value;
  } catch (e) { throw new Error(`Trust store ${file} is unreadable (${e.message}); repair or delete it`); }
}

function writePrivate(file, text, dirMode) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: dirMode });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
}

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Serialises trust-store writers across processes: `trust.json.lock` is created
// with O_EXCL and holds the owner's pid. Age never overrides a live owner.
// Existing records, including dead/malformed owners, are never automatically
// removed: no filesystem compare-and-unlink primitive protects a replacement.
function withTrustLock(home, timeoutMs, fn) {
  const lock = `${trustStorePath(home)}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  // Transient EPERM/EBUSY/EACCES on Windows mean another process is creating or
  // removing the lock this instant: treat them like EEXIST and retry.
  const TRANSIENT = new Set(["EEXIST", "EPERM", "EBUSY", "EACCES"]);
  for (;;) {
    try { fs.writeFileSync(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); break; } catch (e) {
      if (!TRANSIENT.has(e?.code)) throw e;
      if (Date.now() >= deadline) throw new Error(`Trust store lock ${lock} requires waiting or explicit recovery. Stop all MOMM writers, including older versions, and independently confirm none remain before removing only this lock; retry afterward. PID or age alone does not prove safe recovery.${e?.code && e.code !== "EEXIST" ? ` The lock could not be created (${e.code}); if no lock file exists, check that this folder is writable.` : ""}`);
      sleepMs(20);
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch { /* already gone */ } }
}

const fileHash = (file) => { const read = readBoundedBytes(file); return read && !read.error ? read.sha256 : null; };

// Records trust for the project's guidance files, one file at a time.
//   expect: (from `guidance --trust <sha256>`) trusts ONLY the file whose
//           current bytes hash to it; the companion file keeps its previous entry.
//   only:   without `expect` (the Setup Center trusting what it just saved),
//           which file to trust: "guidance" (default), "reviewrules" or "both".
// The store is re-read inside the lock so concurrent writers merge, never clobber.
export function trustProject(projectDir, { home, expect, only, lockTimeoutMs = LOCK_TIMEOUT_MS } = {}) {
  const dir = trustKey(projectDir);
  const files = projectGuidanceFiles(dir);
  const current = { guidance: fileHash(files.guidance), reviewrules: fileHash(files.reviewrules) };
  let kinds;
  if (expect !== undefined) {
    if (typeof expect !== "string" || !expect) throw new Error("expect must be the sha256 hex digest shown in the notice");
    kinds = TRUST_KINDS.filter((k) => current[k] !== null && current[k] === expect && (only === undefined || only === "both" || only === k));
    if (!kinds.length) throw new Error(`No guidance file in ${dir} currently has sha256 ${expect}; nothing trusted`);
  } else {
    const which = only ?? "guidance";
    if (!TRUST_ONLY.includes(which)) throw new Error(`Unknown trust target: ${JSON.stringify(only)} (expected ${TRUST_ONLY.map((k) => `"${k}"`).join(", ")})`);
    kinds = which === "both" ? [...TRUST_KINDS] : [which];
    if (!kinds.some((k) => current[k] !== null)) throw new Error(`No ${kinds.map((k) => path.basename(files[k])).join(" or ")} in ${dir} to trust; nothing trusted`);
  }
  return withTrustLock(home, lockTimeoutMs, () => {
    const store = readTrust(home);
    const previous = isPlainObject(store[dir]) ? store[dir] : {};
    const entry = { guidance_sha256: previous.guidance_sha256 ?? null, reviewrules_sha256: previous.reviewrules_sha256 ?? null };
    for (const kind of kinds) entry[`${kind}_sha256`] = current[kind];
    entry.trusted_at = new Date().toISOString();
    store[dir] = entry;
    writePrivate(trustStorePath(home), `${JSON.stringify(store, null, 2)}\n`, 0o700);
    return entry;
  });
}

const trustedIn = (store, key, kind, sha) => typeof sha === "string" && !!sha && isPlainObject(store[key]) && store[key][`${kind}_sha256`] === sha;

export function isTrusted(projectDir, kind, sha, { home } = {}) {
  if (!TRUST_KINDS.includes(kind)) throw new Error(`Unknown trust kind: ${kind} (expected ${TRUST_KINDS.join(" or ")})`);
  if (typeof sha !== "string" || !sha) return false;
  return trustedIn(readTrust(home), trustKey(projectDir), kind, sha);
}

// --- Resolution -----------------------------------------------------------------
function stack(layers, scope) {
  let text = "";
  const meta = [];
  for (const layer of layers) {
    const next = text ? `${text}\n\n${layer.text}` : layer.text;
    if (next.length > GUIDANCE_BUDGET.per_route) {
      throw new Error(`guidance for ${scope} exceeds ${GUIDANCE_BUDGET.per_route} characters at layer ${layer.name} (${next.length} joined); trim that layer or an earlier one`);
    }
    text = next;
    meta.push({ name: layer.name, sha256: sha256(layer.text), chars: layer.text.length });
  }
  return { layers: meta, text, sha256: hashOrNull(text) };
}

export function resolveGuidance({ cwd = process.cwd(), home, routes, personas = {}, cli = {}, reviewrulesGrace = true } = {}) {
  const dir = path.resolve(cwd);
  const key = trustKey(dir);
  const routeList = routes ?? Object.keys(personas);
  const notices = [];
  const sources = { user: readGuidanceFile(userGuidancePath(home)), project: null, "cli:file": null, "cli:arg": null };
  const files = projectGuidanceFiles(dir);
  const trust = readTrust(home); // one snapshot for both project files

  // .reviewrules: stat -> read once -> hash -> trust -> validate the same bytes.
  let rules = null, rulesTrusted = false;
  const rulesRead = readBoundedBytes(files.reviewrules, GUIDANCE_FILE_MAX_BYTES, { followLinks: false });
  if (rulesRead?.error) notices.push(`.reviewrules skipped: file ${rulesRead.error}`);
  else if (rulesRead) {
    const sha = rulesRead.sha256;
    const trusted = rulesTrusted = trustedIn(trust, key, "reviewrules", sha);
    if (trusted || reviewrulesGrace) {
      try {
        rules = assertBlock(rulesRead.bytes.toString("utf8").replace(/\r\n/g, "\n").trim().slice(0, REVIEWRULES_CLIP), ".reviewrules", files.reviewrules, REVIEWRULES_CLIP);
        if (!trusted) notices.push(`.reviewrules applied WITHOUT trust (1.16 grace period): text that arrived with this clone is being injected into every reviewer prompt unreviewed (sha256 ${sha}). MOMM 1.17 will skip it until trusted. Read the file, then run: ${trustCommand(sha)}`);
      } catch (e) { rules = null; notices.push(`.reviewrules skipped: ${e.message}`); }
    } else {
      notices.push(`.reviewrules skipped: not trusted (sha256 ${sha}). To apply it run: ${trustCommand(sha)}`);
    }
  }

  // .momm/guidance.json: same single-read discipline; parsed only once trusted.
  const projectRead = readBoundedBytes(files.guidance, GUIDANCE_FILE_MAX_BYTES, { followLinks: false });
  if (projectRead?.error) notices.push(`.momm/guidance.json skipped: file ${projectRead.error}`);
  else if (projectRead) {
    const sha = projectRead.sha256;
    if (!trustedIn(trust, key, "guidance", sha)) notices.push(`.momm/guidance.json skipped: not trusted (sha256 ${sha}). To apply it run: ${trustCommand(sha)}`);
    else {
      try { sources.project = parseGuidanceBytes(projectRead.bytes, files.guidance); } catch (e) { notices.push(`.momm/guidance.json skipped: ${e.message}`); }
    }
  }

  if (cli.guidanceFile !== undefined) {
    sources["cli:file"] = readGuidanceFile(cli.guidanceFile);
    if (!sources["cli:file"]) throw new Error(`--guidance-file ${cli.guidanceFile} not found`);
  }
  const arg = {};
  if (typeof cli.guidance === "string") arg.reviewers = { "*": cli.guidance };
  else if (cli.guidance !== undefined) arg.reviewers = cli.guidance;
  if (cli.governor !== undefined) arg.governor = cli.governor;
  if (Object.keys(arg).length) sources["cli:arg"] = validateGuidance(arg, "--guidance arguments");

  const add = (out, name, text) => { if (typeof text === "string" && text.trim()) out.push({ name, text }); };
  const resolvedRoutes = {};
  for (const route of routeList) {
    const layers = [];
    for (const prefix of SOURCE_ORDER) {
      if (prefix === "project") add(layers, "project:.reviewrules", rules);
      const reviewers = sources[prefix]?.reviewers;
      if (!reviewers) continue;
      if (Object.hasOwn(reviewers, "*")) add(layers, `${prefix}:*`, reviewers["*"]);
      if (route !== "*" && Object.hasOwn(reviewers, route)) add(layers, `${prefix}:${route}`, reviewers[route]);
    }
    let resolved;
    try { resolved = stack(layers, `route ${route}`); }
    catch (error) {
      // Text that arrived with a clone and was never trusted must not be able to abort the review:
      // drop it for this route, say so, and let the owner's own layers stand or fail on their own.
      const withoutRules = layers.filter((layer) => layer.name !== "project:.reviewrules");
      if (rulesTrusted || withoutRules.length === layers.length) throw error;
      resolved = stack(withoutRules, `route ${route}`);
      notices.push(`.reviewrules skipped for route ${route}: applying this untrusted file would exceed the ${GUIDANCE_BUDGET.per_route}-character route budget.`);
    }
    const persona = personas[route];
    if (typeof persona === "string" && persona) resolved.layers.unshift({ name: "persona", sha256: sha256(persona), chars: persona.length });
    resolvedRoutes[route] = resolved;
  }

  const governorLayers = [];
  for (const prefix of SOURCE_ORDER) add(governorLayers, `${prefix}:governor`, sources[prefix]?.governor);
  const governor = governorLayers.length ? stack(governorLayers, "the governor") : null;

  return { routes: resolvedRoutes, governor, notices, budget: { ...GUIDANCE_BUDGET } };
}

// --- Persistence and reporting ------------------------------------------------
// The sidecar is the ONLY place resolved guidance text is written.
export function writeGuidanceSidecar(cwd, runId, resolved) {
  if (typeof runId !== "string" || !RUN_ID.test(runId)) throw new Error(`Refusing guidance sidecar for run id ${JSON.stringify(runId)}: expected /^rev_[A-Za-z0-9_]+$/`);
  const file = path.join(path.resolve(cwd), ".ensemble_reviews", "guidance", `${runId}.json`);
  const body = { run_id: runId, written_at: new Date().toISOString(), budget: resolved.budget, notices: resolved.notices, routes: resolved.routes, governor: resolved.governor };
  // Owner-only, like the trust store: the evidence folder is inspected again after this write, and
  // on POSIX a directory created with the default mode would fail that inspection.
  writePrivate(file, `${JSON.stringify(body, null, 2)}\n`, 0o700);
  return file;
}

// Hashes only — safe for the report object and for public export.
export function guidanceReportFields(resolved) {
  const routes = {};
  for (const [route, r] of Object.entries(resolved.routes)) {
    routes[route] = { sha256: r.sha256, layers: r.layers.map((l) => ({ name: l.name, sha256: l.sha256 })) };
  }
  return { guidance: { routes, governor_sha256: resolved.governor?.sha256 ?? null } };
}

// --- Prompt assembly ------------------------------------------------------------
// The dispatcher and the dashboard preview both call assemblePrompt, so layer
// order and delimiter placement cannot drift between them. With empty guidance
// the output equals 1.15's `${contract}\n\n--- ARTIFACT TO REVIEW ---\n${artifact}`.
// Validation already rejects the delimiter inside guidance; this is the last line
// of defence for callers that assemble text from elsewhere.
export function assemblePrompt(contractText, routeGuidanceText, artifactText) {
  if (typeof routeGuidanceText === "string" && routeGuidanceText.includes(ARTIFACT_DELIMITER)) {
    throw new Error(`Refusing to assemble a prompt: guidance contains the artifact delimiter "${ARTIFACT_DELIMITER}" and would open a second artifact boundary`);
  }
  const guidance = routeGuidanceText ? `\n\n${GUIDANCE_HEADING}\n${routeGuidanceText}` : "";
  return `${contractText}${guidance}\n\n${ARTIFACT_DELIMITER}\n${artifactText}`;
}

export function formatEffectivePrompt(contractText, routeGuidanceText, artifactBytes) {
  if (!Number.isInteger(artifactBytes) || artifactBytes < 0) throw new Error(`artifactBytes must be a non-negative integer, got ${artifactBytes}`);
  return assemblePrompt(contractText, routeGuidanceText, `<artifact omitted: ${artifactBytes} bytes>`);
}
