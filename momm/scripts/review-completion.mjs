#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

export const GOVERNOR_ACTIONS_SCHEMA = "momm-governor-actions/1";
export const GOVERNOR_ACTIONS_DERIVATION = "momm-obligations/1";
export const DECISION_DRAFT_SCHEMA = "momm-governor-decisions/1";
export const COMPLETION_SCHEMA = "momm-completion/1";
export const EVIDENCE_ZONE_SCHEMA = "momm-evidence-zone/1";
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const TEXT_LIMIT = 1_000;
const MAX_REPORT_BYTES = 32 * 1024 * 1024;
const MAX_MANAGED_JSON_BYTES = 8 * 1024 * 1024;
const MAX_REVIEW_LOG_BYTES = 64 * 1024 * 1024;
const MAX_LEDGER_BYTES = 32 * 1024 * 1024;
const MAX_OWNER_BYTES = 64 * 1024;
const MAX_GIT_EXCLUDE_BYTES = 8 * 1024 * 1024;
// Bounds governor work and correlation indexes independently of the larger
// byte cap; 10,000 decisions is already far beyond a usable human review.
const MAX_OBLIGATIONS = 10_000;
const FINDING_DISPOSITIONS = new Set(["fixed", "accepted_open", "rejected"]);
const SUGGESTION_DISPOSITIONS = new Set(["applied", "rejected"]);
const SUGGESTION_CLAIM_TYPES = new Set(["behavioral", "style", "documentation", "other"]);
const REPRODUCTION_OUTCOMES = new Set(["reproduced", "not_reproduced", "not_applicable"]);
const VERIFICATION_KINDS = new Set(["test", "lint", "typecheck", "build", "inspection", "manual_probe"]);
const LOCK_SCHEMA = "momm-lock/1";
const LOCK_STALE_MS = 10 * 60_000;
const LOCK_CONTENTION_CODE = "MOMM_LOCK_CONTENTION";
const RETRY_SLEEP = new Int32Array(new SharedArrayBuffer(4));

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const asArray = (value) => Array.isArray(value) ? value : [];
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const canonicalValue = (value) => Array.isArray(value)
  ? value.map((item) => canonicalValue(item))
  : isRecord(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]))
    : value;
const canonicalJson = (value) => JSON.stringify(canonicalValue(value));
const bounded = (value, label, { required = true } = {}) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new Error(`${label} is required`);
  if (text.length > TEXT_LIMIT) throw new Error(`${label} exceeds ${TEXT_LIMIT} characters`);
  return text;
};
const diagnosticText = (value) => {
  const text = String(value?.message ?? value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return text.length <= TEXT_LIMIT ? text : `${text.slice(0, TEXT_LIMIT - 1)}…`;
};
// Subjects are compact ledger/list labels, not evidence prose; full bounded
// reviewer text remains in the digest-anchored report.
const subjectText = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);

function safeRunId(value, label = "run_id") {
  const runId = bounded(value, label);
  if (runId === "." || runId === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
    throw new Error(`${label} contains unsafe path characters`);
  }
  return runId;
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: PRIVATE_DIR_MODE });
  const temp = `${file}.tmp-${randomUUID()}`;
  try {
    fs.writeFileSync(temp, value, { encoding: "utf8", mode: PRIVATE_FILE_MODE, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
  try { fs.chmodSync(file, PRIVATE_FILE_MODE); } catch {}
}

function runGit(cwd, args) {
  try {
    const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
    return result.status === 0 ? String(result.stdout ?? "").trim() : null;
  } catch { return null; }
}

export function discoverGitContext(cwd = process.cwd()) {
  const root = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return null;
  const rawExclude = runGit(root, ["rev-parse", "--git-path", "info/exclude"]);
  const exclude = rawExclude ? (path.isAbsolute(rawExclude) ? rawExclude : path.resolve(root, rawExclude)) : null;
  return { root: path.resolve(root), exclude };
}

function nearestExistingDirectory(value) {
  let cursor = path.resolve(value);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
  try { return fs.statSync(cursor).isDirectory() ? cursor : path.dirname(cursor); }
  catch { return null; }
}

function existingRealPath(value) {
  let cursor = path.resolve(value);
  const suffix = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return path.resolve(value);
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  try { return path.join(fs.realpathSync(cursor), ...suffix); } catch { return path.resolve(value); }
}

export function isEphemeralPath(value) {
  const lower = (item) => process.platform === "win32" ? item.toLowerCase() : item;
  const candidate = lower(existingRealPath(value));
  const temp = lower(existingRealPath(os.tmpdir()));
  return candidate === temp || candidate.startsWith(`${temp}${path.sep}`);
}

export function resolveEvidenceContext({ cwd = process.cwd(), evidenceDir = null } = {}) {
  const projectGit = discoverGitContext(cwd);
  const requested = evidenceDir || process.env.MOMM_EVIDENCE_DIR || null;
  const rawDirectory = requested
    ? path.resolve(cwd, requested)
    : path.join(projectGit?.root ?? path.resolve(cwd), ".ensemble_reviews");
  try {
    if (fs.lstatSync(rawDirectory).isSymbolicLink()) throw new Error(`the evidence directory cannot be a symbolic link or junction: ${rawDirectory}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  // Resolve any pre-existing ancestor junction once, then keep every managed
  // child beneath that canonical root. This supports junction-based workspaces
  // without allowing a repository-controlled child link to redirect writes.
  const directory = existingRealPath(rawDirectory);
  const evidenceParent = nearestExistingDirectory(directory);
  const evidenceGit = requested && evidenceParent ? discoverGitContext(evidenceParent) : projectGit;
  if (evidenceGit && path.resolve(directory) === path.resolve(evidenceGit.root)) {
    throw new Error("the evidence directory cannot be a repository root; choose a dedicated private directory such as .ensemble_reviews");
  }
  return {
    directory,
    project_root: projectGit?.root ?? null,
    source: requested ? "explicit" : projectGit ? "git_root" : "cwd",
    ephemeral: isEphemeralPath(directory),
    git: evidenceGit,
  };
}

export function assertSafeEvidencePath(evidenceDir, relativePath = "") {
  const root = path.resolve(evidenceDir);
  const target = path.resolve(root, relativePath || ".");
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("managed evidence path escapes the evidence directory");
  const components = relative ? relative.split(path.sep).filter(Boolean) : [];
  let cursor = root;
  for (let index = -1; index < components.length; index += 1) {
    if (index >= 0) cursor = path.join(cursor, components[index]);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`managed evidence path is a symbolic link or junction: ${cursor}`);
    if (index === -1 && !stat.isDirectory()) throw new Error(`the evidence root is not a directory: ${cursor}`);
    if (index < components.length - 1 && !stat.isDirectory()) throw new Error(`managed evidence parent is not a directory: ${cursor}`);
  }
  return target;
}

function validateLegacyEvidenceSignature(evidenceDir, entries) {
  let signed = false;
  const parseJsonLines = (relative, validator) => {
    const file = path.join(evidenceDir, relative);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) return;
    const raw = readBoundedText(file, `legacy ${relative}`, MAX_REVIEW_LOG_BYTES);
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return;
    for (const [index, line] of lines.entries()) {
      let row;
      try { row = JSON.parse(line); } catch { throw new Error(`legacy ${relative} contains invalid JSON at line ${index + 1}`); }
      if (!validator(row)) throw new Error(`legacy ${relative} lacks a MOMM record signature at line ${index + 1}`);
    }
    signed = true;
  };
  if (entries.includes("review-log.jsonl")) parseJsonLines("review-log.jsonl", (row) => {
    if (!isRecord(row)) return false;
    try { safeRunId(row.run_id); } catch { return false; }
    if (typeof row.event === "string") return /^[a-f0-9]{64}$/i.test(String(row.report_sha256 ?? row.completion_sha256 ?? ""));
    return isRecord(row.reviewer_status) && (typeof row.timestamp === "string" || Number.isSafeInteger(row.input_bytes));
  });
  if (entries.includes("dispositions.jsonl")) parseJsonLines("dispositions.jsonl", (row) => {
    if (!isRecord(row) || typeof row.reviewer !== "string" || typeof row.disposition !== "string") return false;
    try { safeRunId(row.run_id); return true; } catch { return false; }
  });
  if (entries.includes("reports")) {
    const reportsDir = path.join(evidenceDir, "reports");
    for (const entry of fs.readdirSync(reportsDir)) {
      const file = path.join(reportsDir, entry);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || !entry.endsWith(".json")) throw new Error(`legacy reports entry is not a bounded MOMM report: ${entry}`);
      let report;
      try { report = readBoundedJson(file, `legacy report ${entry}`, MAX_REPORT_BYTES).value; } catch { throw new Error(`legacy report is not valid or bounded JSON: ${entry}`); }
      const expectedRunId = entry.slice(0, -5);
      if (!isRecord(report) || report.report_schema !== "momm-report/1" || report.run_id !== expectedRunId) throw new Error(`legacy report lacks a MOMM schema/run signature: ${entry}`);
      safeRunId(report.run_id);
      signed = true;
    }
  }
  if (entries.includes("ledger.html")) {
    const file = path.join(evidenceDir, "ledger.html");
    const prefix = readBoundedText(file, "legacy ledger", MAX_LEDGER_BYTES).slice(0, 8_192);
    if (prefix && !prefix.includes("<title>My momm ledger</title>") && !prefix.includes("momm-private-ledger/1")) throw new Error("legacy ledger lacks a MOMM page signature");
    if (prefix) signed = true;
  }
  const hasNonemptyContent = entries.some((entry) => {
    const target = path.join(evidenceDir, entry);
    const stat = fs.statSync(target);
    return stat.isDirectory() ? fs.readdirSync(target).length > 0 : stat.size > 0;
  });
  if (hasNonemptyContent && !signed) throw new Error("unmarked legacy evidence has no recognizable MOMM signature");
}

export function ensureEvidenceZone(context, { create = true } = {}) {
  const evidenceDir = context.directory;
  assertSafeEvidencePath(evidenceDir);
  if (!fs.existsSync(evidenceDir)) {
    if (!create) return { status: "missing", marker_path: null };
    fs.mkdirSync(evidenceDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  }
  const markerName = ".momm-evidence-zone.json";
  const markerPath = path.join(evidenceDir, markerName);
  assertSafeEvidencePath(evidenceDir, markerName);
  if (fs.existsSync(markerPath)) {
    const { value } = readJson(markerPath, "evidence zone marker");
    if (!isRecord(value) || value.schema !== EVIDENCE_ZONE_SCHEMA) throw new Error("evidence zone marker schema is invalid");
    return { status: "verified", marker_path: markerPath };
  }
  const known = new Set([markerName, "reports", "review-log.jsonl", "ledger.html", "pending", "completions", "completed-drafts", "dispositions.jsonl", "recovery", ".locks"]);
  const entries = fs.readdirSync(evidenceDir);
  const unknown = entries.filter((entry) => !known.has(entry));
  if (unknown.length) throw new Error(`refusing to adopt a nonempty evidence directory with unknown content: ${unknown.slice(0, 5).join(", ")}`);
  if (entries.length && path.basename(evidenceDir) !== ".ensemble_reviews") throw new Error("refusing to adopt an unmarked nonempty custom evidence directory; choose an empty directory or the existing .ensemble_reviews zone");
  const directoryEntries = new Set(["reports", "pending", "completions", "completed-drafts", "recovery", ".locks"]);
  for (const entry of entries) {
    const stat = fs.lstatSync(path.join(evidenceDir, entry));
    if (stat.isSymbolicLink()) throw new Error(`legacy evidence entry is a symbolic link or junction: ${entry}`);
    if (directoryEntries.has(entry) ? !stat.isDirectory() : !stat.isFile()) throw new Error(`legacy evidence entry has the wrong type: ${entry}`);
  }
  if (entries.length) validateLegacyEvidenceSignature(evidenceDir, entries);
  if (!create) return { status: entries.length ? "legacy_unmarked" : "empty_unmarked", marker_path: null };
  atomicWrite(markerPath, `${JSON.stringify({ schema: EVIDENCE_ZONE_SCHEMA, created_at: new Date().toISOString() }, null, 2)}\n`);
  return { status: "created", marker_path: markerPath };
}

function lockGeneration(evidenceDir, lockRelative) {
  const lockDirectory = assertSafeEvidencePath(evidenceDir, lockRelative);
  const stat = fs.statSync(lockDirectory);
  const ownerRelative = path.join(lockRelative, "owner.json");
  let ownerRaw = "";
  let owner = null;
  try {
    assertSafeEvidencePath(evidenceDir, ownerRelative);
    ownerRaw = readBoundedText(path.join(evidenceDir, ownerRelative), "lock owner", MAX_OWNER_BYTES);
    owner = JSON.parse(ownerRaw);
  } catch {}
  const fingerprint = sha256(Buffer.from(JSON.stringify([
    stat.dev, stat.ino, stat.birthtimeMs, stat.mtimeMs, stat.size, ownerRaw,
  ]))).slice(0, 24);
  return { lockDirectory, stat, owner: isRecord(owner) ? owner : null, fingerprint };
}

function lockOwnerIsLive(owner) {
  if (!isRecord(owner)) return false;
  // Evidence is local by design, but an explicitly shared directory must fail
  // closed: this host cannot prove that a foreign-host owner is dead.
  if (owner.hostname && owner.hostname !== os.hostname()) return true;
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try { process.kill(owner.pid, 0); return true; }
  catch (error) { return error?.code !== "ESRCH"; }
}

function lockIsActive(generation) {
  if (lockOwnerIsLive(generation.owner)) return true;
  return Date.now() - generation.stat.mtimeMs <= LOCK_STALE_MS;
}

function validLockOwner(owner) {
  return isRecord(owner) && owner.schema === LOCK_SCHEMA
    && typeof owner.token === "string" && owner.token.length > 0
    && Number.isSafeInteger(owner.pid) && owner.pid > 0
    && typeof owner.hostname === "string" && owner.hostname.length > 0;
}

function lockContentionError(message) {
  return Object.assign(new Error(message), { code: LOCK_CONTENTION_CODE });
}

function acquireEvidenceLock(evidenceDir, lockRelative, label) {
  // Lock invariant: at most one process owns the canonical .locks/<name>
  // directory at an instant. Atomic mkdir establishes ownership; a retained
  // generation tombstone prevents ABA during stale acquisition; release
  // verifies the random owner token while the canonical directory still
  // excludes every replacement acquirer.
  const lockDirectory = assertSafeEvidencePath(evidenceDir, lockRelative);
  fs.mkdirSync(path.dirname(lockDirectory), { recursive: true, mode: PRIVATE_DIR_MODE });
  const token = randomUUID();
  const owner = { schema: LOCK_SCHEMA, token, pid: process.pid, hostname: os.hostname(), created_at: new Date().toISOString() };
  const createOwnedLock = () => {
    fs.mkdirSync(lockDirectory, { mode: PRIVATE_DIR_MODE });
    try {
      fs.writeFileSync(path.join(lockDirectory, "owner.json"), `${JSON.stringify(owner)}\n`, { mode: PRIVATE_FILE_MODE, flag: "wx" });
    } catch (error) {
      try { fs.rmSync(lockDirectory, { recursive: true, force: true }); } catch {}
      throw error;
    }
  };
  let observed = null;
  for (let attempt = 0; attempt < 3 && !observed; attempt += 1) {
    try {
      createOwnedLock();
      return { lockDirectory, token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    try { observed = lockGeneration(evidenceDir, lockRelative); }
    catch (error) {
      // The holder can release between our EEXIST and stat. Retry the atomic
      // mkdir instead of leaking an opaque ENOENT from ordinary contention.
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (!observed) throw lockContentionError(`${label} lock changed repeatedly during acquisition; retry`);
  if (lockIsActive(observed)) {
    if (observed.owner?.hostname && observed.owner.hostname !== os.hostname()) {
      throw new Error(`another ${label} operation is recorded on host ${observed.owner.hostname}; this host cannot prove it stopped — verify no MOMM process is active there, then remove this lock manually`);
    }
    throw lockContentionError(`another ${label} operation is already in progress`);
  }

  if (!validLockOwner(observed.owner)) {
    throw new Error(`stale ${label} lock has no valid owner metadata; inspect and remove it manually if no MOMM process is active`);
  }

  // The retained nonempty tombstone is the cross-platform ABA guard. Only one
  // contender can rename this exact stale generation to the deterministic
  // destination. It is never removed: a delayed contender therefore cannot
  // rename a replacement canonical lock over it on either POSIX or Windows.
  let current = null;
  try { current = lockGeneration(evidenceDir, lockRelative); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (current && current.fingerprint !== observed.fingerprint) throw lockContentionError(`${label} lock changed during stale recovery; retry`);
  const reclaimedRelative = `${lockRelative}.reclaimed-${observed.fingerprint}`;
  const reclaimedPath = assertSafeEvidencePath(evidenceDir, reclaimedRelative);
  let moved = false;
  if (current) {
    let recoverySettled = false;
    let lastRenameError = null;
    for (let attempt = 0; attempt < 20 && !moved && !recoverySettled; attempt += 1) {
      try {
        fs.renameSync(lockDirectory, reclaimedPath);
        moved = true;
        break;
      } catch (error) {
        lastRenameError = error;
        if (!["ENOENT", "EEXIST", "ENOTEMPTY", "EPERM", "EACCES", "EBUSY"].includes(error?.code)) throw error;
        if (error?.code === "ENOENT") { recoverySettled = true; break; }
        let retained = null;
        try { retained = lockGeneration(evidenceDir, reclaimedRelative); } catch {}
        if (retained?.fingerprint === observed.fingerprint) { recoverySettled = true; break; }
        if (retained) {
          throw new Error(`${label} stale-lock tombstone does not match the observed generation; inspect ${reclaimedPath} and remove it manually only after verifying no MOMM process is active`);
        }
        try {
          const canonical = lockGeneration(evidenceDir, lockRelative);
          if (canonical.fingerprint !== observed.fingerprint) { recoverySettled = true; break; }
        } catch (readError) {
          if (readError?.code === "ENOENT") { recoverySettled = true; break; }
          throw readError;
        }
        // Ten milliseconds lets transient Windows directory handles settle;
        // 20 bounded attempts cap recovery delay at roughly 200ms.
        Atomics.wait(RETRY_SLEEP, 0, 0, 10);
      }
    }
    if (!moved && !recoverySettled) throw lastRenameError;
  }
  if (moved) {
    const retained = lockGeneration(evidenceDir, reclaimedRelative);
    if (retained.fingerprint !== observed.fingerprint) throw new Error(`${label} stale-lock tombstone does not match the observed generation`);
  }

  // A helper may have completed recovery (or crashed after the rename) first.
  // Retry the atomic canonical mkdir; ordinary contention stays a clear status.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      createOwnedLock();
      return { lockDirectory, token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let replacement;
      try {
        replacement = lockGeneration(evidenceDir, lockRelative);
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        throw readError;
      }
      if (lockIsActive(replacement)) throw lockContentionError(`another ${label} operation is already in progress`);
      throw lockContentionError(`${label} lock was replaced by another stale generation; retry`);
    }
  }
  throw lockContentionError(`${label} lock changed repeatedly after stale recovery; retry`);
}

function releaseEvidenceLock(evidenceDir, handle, label) {
  const ownerRelative = path.relative(evidenceDir, path.join(handle.lockDirectory, "owner.json"));
  assertSafeEvidencePath(evidenceDir, ownerRelative);
  let owner;
  try { owner = readBoundedJson(path.join(handle.lockDirectory, "owner.json"), `${label} lock owner`, MAX_OWNER_BYTES).value; }
  catch { throw new Error(`${label} lock ownership was lost before release`); }
  if (!isRecord(owner) || owner.token !== handle.token) throw new Error(`${label} lock ownership changed before release`);
  fs.rmSync(handle.lockDirectory, { recursive: true });
}

function withEvidenceLock(evidenceDir, lockRelative, label, operation) {
  const handle = acquireEvidenceLock(evidenceDir, lockRelative, label);
  let operationError = null;
  try { return operation(); }
  catch (error) { operationError = error; throw error; }
  finally {
    try { releaseEvidenceLock(evidenceDir, handle, label); }
    catch (releaseError) { if (!operationError) throw releaseError; }
  }
}

function runLockInfo(evidenceDir, runId) {
  const safe = safeRunId(runId);
  // Keep per-run locks in their own namespace. A valid run id such as
  // "review-log" must never collide with the global review-log writer lock.
  const lockRelative = path.join(".locks", "runs", `${safe}.lock`);
  const lockDirectory = path.join(evidenceDir, lockRelative);
  assertSafeEvidencePath(evidenceDir, lockRelative);
  let active = false;
  try { active = fs.existsSync(lockDirectory) && lockIsActive(lockGeneration(evidenceDir, lockRelative)); } catch {}
  return { safe, lockRelative, lockDirectory, active };
}

function withRunLock(evidenceDir, runId, operation) {
  const { safe, lockRelative } = runLockInfo(evidenceDir, runId);
  return withEvidenceLock(evidenceDir, lockRelative, `governor operation for ${safe}`, operation);
}

export function withReviewLogLock(evidenceDir, operation) {
  return withEvidenceLock(evidenceDir, path.join(".locks", "review-log.lock"), "review-log update", operation);
}

export function protectEvidenceFromGit(context) {
  if (!context?.git?.root || !context.git.exclude) return { status: "not_a_git_repo", pattern: null };
  const platformRelative = path.relative(context.git.root, context.directory);
  const relative = path.sep === "\\" ? platformRelative.replaceAll("\\", "/") : platformRelative;
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) return { status: "outside_repository", pattern: null };
  if (/[\u0000-\u001f\u007f]/.test(relative)) return { status: "unavailable", pattern: null, error: "evidence path contains characters Git ignore rules cannot represent safely" };
  const escaped = relative.replace(/^\.\//, "").replace(/\/$/, "")
    .replace(/([\\*?\[\]])/g, "\\$1")
    .replaceAll(" ", "\\ ");
  const pattern = `/${escaped}/`;
  const probe = `${relative.replace(/\/$/, "")}/.momm-private-probe`;
  const verify = () => {
    try {
      const result = spawnSync("git", ["-C", context.git.root, "check-ignore", "-q", "--no-index", "--", `./${probe}`], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
      return result.status === 0;
    } catch { return false; }
  };
  try {
    const tracked = spawnSync("git", ["--literal-pathspecs", "-C", context.git.root, "ls-files", "--", relative], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
    if (tracked.status !== 0) throw new Error("Git could not verify whether the evidence directory is tracked");
    if (String(tracked.stdout ?? "").trim()) throw new Error("the evidence directory already contains Git-tracked paths");
    if (fs.existsSync(context.git.exclude) && fs.lstatSync(context.git.exclude).isSymbolicLink()) throw new Error("Git local exclude file is a symbolic link");
    fs.mkdirSync(path.dirname(context.git.exclude), { recursive: true });
    const existing = fs.existsSync(context.git.exclude)
      ? readBoundedText(context.git.exclude, "Git local exclude file", MAX_GIT_EXCLUDE_BYTES)
      : "";
    if (existing.split(/\r?\n/).some((line) => line.trim() === pattern)) {
      if (!verify()) throw new Error("Git did not honor the existing local evidence exclusion");
      return { status: "already_excluded", pattern };
    }
    const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(context.git.exclude, `${prefix}\n# momm: private per-machine review telemetry\n${pattern}\n`, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
    if (!verify()) throw new Error("Git did not honor the local evidence exclusion");
    return { status: "local_exclude_added", pattern };
  } catch (error) {
    return { status: "unavailable", pattern, error: diagnosticText(error) };
  }
}

function itemId(kind, pointer, value) {
  return `${kind}-${sha256(Buffer.from(JSON.stringify([kind, pointer, value]))).slice(0, 16)}`;
}

function reviewerEntries(report) {
  return asArray(report.reviewers).map((reviewer, reviewerIndex) => {
    if (!isRecord(reviewer)) throw new Error(`report.reviewers[${reviewerIndex}] must be an object`);
    return { reviewer, reviewerIndex };
  });
}

function peerCollectionFromReport(report) {
  const entries = reviewerEntries(report);
  const reviewers = entries.map(({ reviewer }) => reviewer);
  if (typeof report.governor !== "string" || !report.governor.trim()) throw new Error("report.governor must identify the active governor");
  const governor = report.governor;
  const reviewerNames = reviewers.map((reviewer) => typeof reviewer.agent === "string" ? reviewer.agent : "");
  if (reviewerNames.some((name) => !name)) throw new Error("report contains a reviewer without an identity");
  if (new Set(reviewerNames).size !== reviewerNames.length) throw new Error("report contains duplicate reviewer identities");
  const governorEntry = reviewers.find((reviewer) => reviewer.agent === governor);
  if (governorEntry && governorEntry.status !== "self_excluded") {
    throw new Error(`governor reviewer entry ${governor} must be self_excluded, not ${String(governorEntry.status ?? "missing status")}`);
  }
  const invalidExternalExclusion = reviewers.find((reviewer) => reviewer.agent !== governor && reviewer.status === "self_excluded");
  if (invalidExternalExclusion) throw new Error(`external reviewer ${invalidExternalExclusion.agent} cannot be self_excluded`);
  if (report.strict !== undefined && typeof report.strict !== "boolean") throw new Error("report.strict must be boolean when present");
  let configuredRequired = null;
  if (report.quorum !== undefined) {
    if (!isRecord(report.quorum) || !Number.isSafeInteger(report.quorum.required) || report.quorum.required <= 0) {
      throw new Error("report.quorum.required must be a positive integer when quorum is present");
    }
    configuredRequired = report.quorum.required;
  }
  const external = reviewers.filter((reviewer) => reviewer.agent !== governor);
  const succeeded = external.filter((reviewer) => reviewer.status === "success").length;
  const strict = report.strict === true;
  const required = strict ? Math.max(1, external.length) : configuredRequired ?? 1;
  const met = external.length > 0 && succeeded >= required && (!strict || succeeded === external.length);
  return {
    reviewers,
    reviewer_entries: entries,
    governor,
    external,
    peer_collection: { requested: external.length, succeeded, required, strict, met },
  };
}

function canonicalFinding(value) {
  if (!isRecord(value)) throw new Error("reviewer finding must be an object");
  return JSON.stringify([
    value.id ?? null,
    value.severity ?? null,
    value.target_file ?? null,
    Array.isArray(value.line_range) ? value.line_range : null,
    value.attachment_id ?? null,
    Array.isArray(value.region) ? value.region : null,
    value.issue ?? null,
    value.rationale ?? null,
    value.test_suggestion ?? null,
  ]);
}

function findingObligations(report, peerFacts = peerCollectionFromReport(report)) {
  // Correlation is integrity metadata, not a replacement for raw evidence.
  // Across canonicalFinding's nine fields, report.findings[].claims must be a
  // per-agent multiset-identical copy of every successful external reviewer's
  // raw findings. Duplicate byte-identical claims therefore remain distinct.
  const claimsByCanonicalKey = new Map();
  let indexedClaimCount = 0;
  asArray(report.findings).forEach((finding, findingIndex) => {
    if (!isRecord(finding)) throw new Error(`report.findings[${findingIndex}] must be an object`);
    const claims = asArray(finding.claims);
    if (!claims.length) throw new Error(`report.findings[${findingIndex}] does not preserve its raw reviewer claims`);
    claims.forEach((claim, claimIndex) => {
      if (indexedClaimCount >= MAX_OBLIGATIONS) throw new Error(`report has more than ${MAX_OBLIGATIONS} governor obligations`);
      indexedClaimCount += 1;
      if (!isRecord(claim) || typeof claim.agent !== "string" || !claim.agent) throw new Error(`report.findings[${findingIndex}].claims[${claimIndex}] is invalid`);
      const key = JSON.stringify([claim.agent, canonicalFinding(claim)]);
      const matches = claimsByCanonicalKey.get(key) ?? [];
      matches.push({ finding, claim, findingIndex, claimIndex, groupPointer: `/findings/${findingIndex}` });
      claimsByCanonicalKey.set(key, matches);
    });
  });

  const obligations = [];
  peerFacts.reviewer_entries.forEach(({ reviewer, reviewerIndex }) => {
    if (reviewer.agent === peerFacts.governor || reviewer.status !== "success") return;
    if (!Array.isArray(reviewer.findings)) throw new Error(`successful reviewer ${reviewer.agent} lacks a raw findings array`);
    reviewer.findings.forEach((rawFinding, rawFindingIndex) => {
      const key = JSON.stringify([reviewer.agent, canonicalFinding(rawFinding)]);
      const matches = claimsByCanonicalKey.get(key) ?? [];
      const matched = matches.shift();
      if (!matched) throw new Error(`raw reviewer finding /reviewers/${reviewerIndex}/findings/${rawFindingIndex} is missing from the correlated claim set`);
      if (matches.length) claimsByCanonicalKey.set(key, matches); else claimsByCanonicalKey.delete(key);
      obligations.push({
        ...matched,
        rawFinding,
        reviewer: reviewer.agent,
        reviewerIndex,
        rawFindingIndex,
        pointer: `/reviewers/${reviewerIndex}/findings/${rawFindingIndex}`,
      });
    });
  });
  const unmatched = [...claimsByCanonicalKey.values()].reduce((total, values) => total + values.length, 0);
  if (unmatched) throw new Error(`correlated finding set contains ${unmatched} claim(s) not present in successful external reviewer evidence`);
  return obligations;
}

function buildGovernorActions(runId, peerFacts, exactFindingObligations) {
  const { reviewer_entries: entries, governor, peer_collection: peerCollection } = peerFacts;
  const items = [];
  const pushItem = (item) => {
    if (items.length >= MAX_OBLIGATIONS) throw new Error(`report has more than ${MAX_OBLIGATIONS} governor obligations`);
    items.push(item);
  };
  exactFindingObligations.forEach(({ finding, rawFinding, reviewer, findingIndex, claimIndex, rawFindingIndex, groupPointer, pointer }) => {
    const severity = typeof rawFinding.severity === "string" ? rawFinding.severity : "WARNING";
    const canonical = [canonicalFinding(rawFinding), reviewer];
    pushItem({
      item_id: itemId("finding", pointer, canonical),
      kind: "finding",
      report_pointer: pointer,
      finding_group_pointer: groupPointer,
      finding_group_index: findingIndex,
      claim_index: claimIndex,
      correlation_id: typeof finding.correlation_id === "string" ? finding.correlation_id : null,
      finding_id: typeof rawFinding.id === "string" ? rawFinding.id : null,
      severity,
      reviewer,
      reviewers: [...new Set(asArray(finding.sources).filter((value) => typeof value === "string"))].sort(),
      raw_finding_index: rawFindingIndex,
      reproduction_required: severity === "CRITICAL" || severity === "WARNING",
      subject: subjectText(rawFinding.issue ?? rawFinding.id ?? `Finding ${findingIndex + 1}`),
    });
  });
  entries.forEach(({ reviewer, reviewerIndex }) => {
    if (reviewer.agent === governor || reviewer.status !== "success") return;
    asArray(reviewer.suggested_improvements).forEach((suggestion, suggestionIndex) => {
      if (typeof suggestion !== "string" || !suggestion.trim()) return;
      const pointer = `/reviewers/${reviewerIndex}/suggested_improvements/${suggestionIndex}`;
      pushItem({
        item_id: itemId("suggestion", pointer, suggestion),
        kind: "suggestion",
        report_pointer: pointer,
        reviewer: typeof reviewer.agent === "string" ? reviewer.agent : "unknown",
        suggestion_index: suggestionIndex,
        subject: subjectText(suggestion),
      });
    });
  });
  const findingCount = items.filter((item) => item.kind === "finding").length;
  const suggestionCount = items.length - findingCount;
  return {
    schema: GOVERNOR_ACTIONS_SCHEMA,
    derivation: GOVERNOR_ACTIONS_DERIVATION,
    state_at_dispatch: peerCollection.met ? "pending" : "blocked_peer_gate",
    final_checks_required: true,
    finding_count: findingCount,
    suggestion_count: suggestionCount,
    item_count: items.length,
    items,
    peer_collection: peerCollection,
    run_id: runId,
  };
}

export function deriveGovernorActions(report) {
  if (!isRecord(report)) throw new Error("report must be an object");
  const runId = safeRunId(report.run_id, "report.run_id");
  const sealed = report.governor_actions;
  if (sealed !== undefined && sealed !== null) {
    if (!isRecord(sealed) || sealed.schema !== GOVERNOR_ACTIONS_SCHEMA) throw new Error(`sealed governor_actions must use ${GOVERNOR_ACTIONS_SCHEMA}`);
    if (sealed.derivation !== GOVERNOR_ACTIONS_DERIVATION) {
      throw new Error(`sealed governor_actions uses unsupported derivation ${String(sealed.derivation ?? "missing")}; expected ${GOVERNOR_ACTIONS_DERIVATION}`);
    }
  }
  const peerFacts = peerCollectionFromReport(report);
  const exactFindingObligations = findingObligations(report, peerFacts);
  const expected = buildGovernorActions(runId, peerFacts, exactFindingObligations);
  if (sealed !== undefined && sealed !== null) {
    if (canonicalJson(sealed) !== canonicalJson(expected)) {
      throw new Error("sealed governor_actions does not canonically match the report's exact raw obligations");
    }
    return JSON.parse(JSON.stringify(sealed));
  }
  return expected;
}

export function decisionDraft(report, reportSha256) {
  if (!/^[a-f0-9]{64}$/i.test(String(reportSha256 ?? ""))) throw new Error("report sha256 is invalid");
  if (report?.report_schema !== "momm-report/1") throw new Error("unsupported report_schema cannot be completed");
  if (report?.governor_actions?.schema !== GOVERNOR_ACTIONS_SCHEMA
      || report?.governor_actions?.derivation !== GOVERNOR_ACTIONS_DERIVATION) {
    throw new Error("legacy reports without the supported sealed governor obligation derivation cannot be completed post hoc");
  }
  const actions = deriveGovernorActions(report);
  return {
    decision_schema: DECISION_DRAFT_SCHEMA,
    run_id: actions.run_id,
    report_sha256: reportSha256,
    instructions: "Fill every disposition, reason, reproduction, verification, and final_checks field with governor-authored evidence. This file is data only; MOMM never executes its contents.",
    allowed_values: {
      finding_dispositions: [...FINDING_DISPOSITIONS],
      suggestion_dispositions: [...SUGGESTION_DISPOSITIONS],
      suggestion_claim_types: [...SUGGESTION_CLAIM_TYPES],
      reproduction_outcomes: [...REPRODUCTION_OUTCOMES],
      verification_kinds: [...VERIFICATION_KINDS],
      verification_outcome: "pass",
    },
    decisions: actions.items.map((item) => item.kind === "finding" ? {
      item_id: item.item_id,
      kind: item.kind,
      report_pointer: item.report_pointer,
      finding_id: item.finding_id,
      severity: item.severity,
      reviewer: item.reviewer,
      reviewers: item.reviewers,
      finding_group_pointer: item.finding_group_pointer,
      correlation_id: item.correlation_id,
      reproduction_required: item.reproduction_required,
      subject: item.subject,
      disposition: "",
      reason: "",
      reproduction: item.reproduction_required ? { method: "", outcome: "", evidence: "" } : null,
      verification: [],
    } : {
      item_id: item.item_id,
      kind: item.kind,
      report_pointer: item.report_pointer,
      reviewer: item.reviewer,
      suggestion_index: item.suggestion_index,
      subject: item.subject,
      claim_type: "",
      disposition: "",
      reason: "",
      reproduction: null,
      verification: [],
    }),
    final_checks: [],
  };
}

export function prepareDraft(evidenceDir, report, reportSha256) {
  const draft = decisionDraft(report, reportSha256);
  return withRunLock(evidenceDir, draft.run_id, () => {
    const target = path.join(evidenceDir, "pending", `${draft.run_id}.json`);
    assertSafeEvidencePath(evidenceDir, path.join("pending", `${draft.run_id}.json`));
    const completionTarget = completionPath(evidenceDir, draft.run_id);
    if (fs.existsSync(completionTarget) || completionEvents(evidenceDir, draft.run_id).length) throw new Error("this run already has completion evidence; inspect --status instead of recreating a pending draft");
    if (!fs.existsSync(target)) {
      atomicWrite(target, `${JSON.stringify(draft, null, 2)}\n`);
      return { draft, path: target, created: true };
    }
    const { value: existing } = readJson(target, "existing decision draft");
    if (!isRecord(existing)
        || existing.decision_schema !== DECISION_DRAFT_SCHEMA
        || existing.run_id !== draft.run_id
        || existing.report_sha256 !== draft.report_sha256) {
      throw new Error("existing decision draft does not match the sealed report; preserve it for inspection and choose a different evidence directory");
    }
    const expected = new Map(draft.decisions.map((decision) => [decision.item_id, decision.kind]));
    const seen = new Set();
    for (const [index, decision] of asArray(existing.decisions).entries()) {
      if (!isRecord(decision) || !expected.has(decision.item_id) || expected.get(decision.item_id) !== decision.kind || seen.has(decision.item_id)) {
        throw new Error(`existing decision draft has stale or duplicate obligation at decisions[${index}]`);
      }
      seen.add(decision.item_id);
    }
    if (seen.size !== expected.size) throw new Error("existing decision draft does not cover the sealed report's exact obligation set");
    return { draft: existing, path: target, created: false };
  });
}

function normalizeVerification(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const kind = bounded(value.kind, `${label}.kind`);
  const outcome = bounded(value.outcome, `${label}.outcome`);
  if (!VERIFICATION_KINDS.has(kind)) throw new Error(`${label}.kind is not supported`);
  if (outcome !== "pass") throw new Error(`${label}.outcome must be pass`);
  return { kind, outcome, evidence: bounded(value.evidence, `${label}.evidence`) };
}

function normalizeReproduction(value, item, label) {
  if (!item.reproduction_required && isRecord(value)
      && [value.method, value.outcome, value.evidence].every((part) => part === null || part === undefined || (typeof part === "string" && !part.trim()))) return null;
  if (!isRecord(value)) {
    if (!item.reproduction_required) return null;
    throw new Error(`${label} is required`);
  }
  const method = bounded(value.method, `${label}.method`);
  if (!VERIFICATION_KINDS.has(method)) throw new Error(`${label}.method is not supported`);
  const outcome = bounded(value.outcome, `${label}.outcome`);
  if (!REPRODUCTION_OUTCOMES.has(outcome)) throw new Error(`${label}.outcome is not supported`);
  return { method, outcome, evidence: bounded(value.evidence, `${label}.evidence`) };
}

export function validateDecisionDocument(report, reportSha256, value) {
  if (!isRecord(value) || value.decision_schema !== DECISION_DRAFT_SCHEMA) throw new Error(`decision_schema must be ${DECISION_DRAFT_SCHEMA}`);
  if (report?.report_schema !== "momm-report/1"
      || report?.governor_actions?.schema !== GOVERNOR_ACTIONS_SCHEMA
      || report?.governor_actions?.derivation !== GOVERNOR_ACTIONS_DERIVATION) {
    throw new Error("completion requires a supported report with the current sealed governor obligation derivation");
  }
  const actions = deriveGovernorActions(report);
  if (value.run_id !== actions.run_id) throw new Error("decision run_id does not match the report");
  if (value.report_sha256 !== reportSha256) throw new Error("decision report_sha256 does not match the sealed report bytes");
  if (!actions.peer_collection.met) throw new Error("peer collection gate was not met; this run cannot be finalized");
  const expected = new Map(actions.items.map((item) => [item.item_id, item]));
  const seen = new Set();
  const decisions = asArray(value.decisions).map((decision, index) => {
    if (!isRecord(decision)) throw new Error(`decisions[${index}] must be an object`);
    const item = expected.get(decision.item_id);
    if (!item) throw new Error(`decisions[${index}] has an unknown item_id`);
    if (seen.has(item.item_id)) throw new Error(`duplicate decision for ${item.item_id}`);
    seen.add(item.item_id);
    if (decision.kind !== item.kind) throw new Error(`decisions[${index}].kind does not match its obligation`);
    const disposition = bounded(decision.disposition, `decisions[${index}].disposition`);
    const reason = bounded(decision.reason, `decisions[${index}].reason`);
    const verification = asArray(decision.verification).map((entry, verifyIndex) => normalizeVerification(entry, `decisions[${index}].verification[${verifyIndex}]`));
    if (item.kind === "suggestion") {
      if (!SUGGESTION_DISPOSITIONS.has(disposition)) throw new Error(`decisions[${index}].disposition is invalid for a suggestion`);
      const claimType = bounded(decision.claim_type, `decisions[${index}].claim_type`);
      if (!SUGGESTION_CLAIM_TYPES.has(claimType)) throw new Error(`decisions[${index}].claim_type is not supported`);
      const reproduction = normalizeReproduction(decision.reproduction, { reproduction_required: disposition === "applied" && claimType === "behavioral" }, `decisions[${index}].reproduction`);
      if (disposition === "applied" && verification.length === 0) throw new Error(`applied suggestion ${item.item_id} requires passing verification`);
      if (disposition === "applied" && claimType === "behavioral" && reproduction?.outcome !== "reproduced") throw new Error(`applied behavioral suggestion ${item.item_id} requires reproduced-before evidence`);
      return { item_id: item.item_id, kind: item.kind, reviewer: item.reviewer, claim_type: claimType, disposition, reason, reproduction, verification };
    }
    if (!FINDING_DISPOSITIONS.has(disposition)) throw new Error(`decisions[${index}].disposition is invalid for a finding`);
    const reproduction = normalizeReproduction(decision.reproduction, item, `decisions[${index}].reproduction`);
    if (disposition === "fixed" && verification.length === 0) throw new Error(`fixed finding ${item.item_id} requires passing-after evidence`);
    if (disposition === "fixed" && item.reproduction_required && reproduction?.outcome !== "reproduced") throw new Error(`fixed finding ${item.item_id} requires reproduced-before evidence`);
    if (disposition === "accepted_open" && item.reproduction_required && reproduction?.outcome !== "reproduced") throw new Error(`accepted_open finding ${item.item_id} must be reproduced`);
    if (disposition === "rejected" && item.reproduction_required && !["not_reproduced", "not_applicable"].includes(reproduction?.outcome)) throw new Error(`rejected finding ${item.item_id} requires not_reproduced or not_applicable evidence`);
    return { item_id: item.item_id, kind: item.kind, finding_id: item.finding_id, severity: item.severity, reviewer: item.reviewer, finding_group_pointer: item.finding_group_pointer, correlation_id: item.correlation_id, disposition, reason, reproduction, verification };
  });
  if (seen.size !== expected.size) {
    const missing = [...expected.keys()].filter((itemId) => !seen.has(itemId));
    throw new Error(`missing ${missing.length} required decision(s): ${missing.join(", ")}`);
  }
  const finalChecks = asArray(value.final_checks).map((entry, index) => normalizeVerification(entry, `final_checks[${index}]`));
  if (finalChecks.length === 0) throw new Error("at least one passing final_checks entry is required");
  return {
    completion_schema: COMPLETION_SCHEMA,
    run_id: actions.run_id,
    report_sha256: reportSha256,
    governor: typeof report.governor === "string" ? report.governor : "other",
    completed_at: new Date().toISOString(),
    decisions,
    final_checks: finalChecks,
  };
}

function readBoundedBytes(file, label, maxBytes) {
  let handle;
  try {
    handle = fs.openSync(file, "r");
    const stat = fs.fstatSync(handle);
    if (!stat.isFile()) throw new Error("is not a regular file");
    if (stat.size > maxBytes) throw new Error(`exceeds ${maxBytes} bytes`);
    // The extra byte detects growth after fstat without allocating past the
    // declared per-kind cap; any byte beyond stat.size makes the read fail.
    const bytes = Buffer.allocUnsafe(stat.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const read = fs.readSync(handle, bytes, total, bytes.length - total, total);
      if (read === 0) break;
      total += read;
    }
    if (total !== stat.size) throw new Error("changed size while it was being read");
    return bytes.subarray(0, total);
  } catch (error) {
    throw new Error(`${label} cannot be read: ${error.message}`);
  } finally {
    if (handle !== undefined) try { fs.closeSync(handle); } catch {}
  }
}

export function readBoundedText(file, label, maxBytes) {
  return readBoundedBytes(file, label, maxBytes).toString("utf8");
}

function readBoundedJson(file, label, maxBytes) {
  const raw = readBoundedText(file, label, maxBytes);
  try { return { raw, value: JSON.parse(raw) }; } catch { throw new Error(`${label} is not valid JSON`); }
}

function readJson(file, label) {
  return readBoundedJson(file, label, MAX_MANAGED_JSON_BYTES);
}

export function readReviewLog(evidenceDir) {
  assertSafeEvidencePath(evidenceDir, "review-log.jsonl");
  const logPath = path.join(evidenceDir, "review-log.jsonl");
  if (!fs.existsSync(logPath)) return { rows: [], degraded_tail: false };
  const raw = readBoundedText(logPath, "review-log.jsonl", MAX_REVIEW_LOG_BYTES);
  const lines = raw.split(/\r?\n/);
  const unterminatedTail = raw.length > 0 && !/\r?\n$/.test(raw);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    try { rows.push(JSON.parse(line)); }
    catch {
      if (unterminatedTail && index === lines.length - 1) return { rows, degraded_tail: true };
      throw new Error(`review-log.jsonl contains invalid JSON at line ${index + 1}`);
    }
  }
  return { rows, degraded_tail: false };
}

export function appendReviewLogEntry(evidenceDir, entry) {
  return withReviewLogLock(evidenceDir, () => {
    assertSafeEvidencePath(evidenceDir, "review-log.jsonl");
    const logPath = path.join(evidenceDir, "review-log.jsonl");
    fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: PRIVATE_DIR_MODE });
    let recoveredTail = null;
    if (fs.existsSync(logPath)) {
      const bytes = readBoundedBytes(logPath, "review-log.jsonl", MAX_REVIEW_LOG_BYTES);
      if (bytes.length && bytes[bytes.length - 1] !== 0x0a) {
        const lastNewline = bytes.lastIndexOf(0x0a);
        const tail = bytes.subarray(lastNewline + 1);
        try {
          JSON.parse(tail.toString("utf8"));
          fs.appendFileSync(logPath, "\n", { encoding: "utf8" });
        } catch {
          const recoveryRelative = path.join("recovery", `review-log-tail-${Date.now()}-${randomUUID()}.txt`);
          const recoveryPath = path.join(evidenceDir, recoveryRelative);
          assertSafeEvidencePath(evidenceDir, recoveryRelative);
          fs.mkdirSync(path.dirname(recoveryPath), { recursive: true, mode: PRIVATE_DIR_MODE });
          fs.writeFileSync(recoveryPath, tail, { mode: PRIVATE_FILE_MODE, flag: "wx" });
          fs.truncateSync(logPath, lastNewline + 1);
          recoveredTail = recoveryPath;
        }
      }
      // A malformed interior record is corruption, not a recoverable crash tail.
      readReviewLog(evidenceDir);
    }
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
    try { fs.chmodSync(logPath, PRIVATE_FILE_MODE); } catch {}
    return { path: logPath, recovered_tail_path: recoveredTail };
  });
}

function reportEvidence(evidenceDir, runId) {
  runId = safeRunId(runId);
  const reportPath = path.join(evidenceDir, "reports", `${runId}.json`);
  assertSafeEvidencePath(evidenceDir, path.join("reports", `${runId}.json`));
  assertSafeEvidencePath(evidenceDir, "review-log.jsonl");
  const { raw, value: report } = readBoundedJson(reportPath, "sealed report", MAX_REPORT_BYTES);
  if (report.run_id !== runId) throw new Error("sealed report run_id does not match its report filename");
  const digest = sha256(Buffer.from(raw));
  const logPath = path.join(evidenceDir, "review-log.jsonl");
  const parsedLog = readReviewLog(evidenceDir);
  const matches = parsedLog.rows.filter((entry) => isRecord(entry) && !entry.event && entry.run_id === runId);
  if (!matches.length) throw new Error("sealed report has no review-log anchor");
  const anchored = matches.some((entry) => entry.report_sha256 === digest);
  if (!anchored) throw new Error("sealed report digest does not match review-log.jsonl");
  return { reportPath, raw, report, digest, log_degraded_tail: parsedLog.degraded_tail };
}

function completionPath(evidenceDir, runId) {
  const safe = safeRunId(runId);
  assertSafeEvidencePath(evidenceDir, path.join("completions", safe, "completion.json"));
  return path.join(evidenceDir, "completions", safe, "completion.json");
}

function validateStoredCompletion(report, reportSha256, completion) {
  if (!isRecord(completion) || completion.completion_schema !== COMPLETION_SCHEMA) throw new Error(`completion_schema must be ${COMPLETION_SCHEMA}`);
  if (completion.governor !== (typeof report.governor === "string" ? report.governor : "other")) throw new Error("completion governor does not match the sealed report");
  if (typeof completion.completed_at !== "string" || !Number.isFinite(Date.parse(completion.completed_at))) throw new Error("completion completed_at is invalid");
  const draftShape = {
    decision_schema: DECISION_DRAFT_SCHEMA,
    run_id: completion.run_id,
    report_sha256: completion.report_sha256,
    decisions: completion.decisions,
    final_checks: completion.final_checks,
  };
  return validateDecisionDocument(report, reportSha256, draftShape);
}

function completionEvents(evidenceDir, runId) {
  return readReviewLog(evidenceDir).rows.filter((row) => isRecord(row) && row.event === "review_completed" && row.run_id === runId);
}

function requireCompletionAnchor(evidenceDir, completionFile, completionRaw, completion, expectedState) {
  const digest = sha256(Buffer.from(completionRaw));
  const relative = path.relative(evidenceDir, completionFile).replaceAll("\\", "/");
  const matched = completionEvents(evidenceDir, completion.run_id).some((row) => row.report_sha256 === completion.report_sha256
        && row.completion_path === relative
        && row.completion_sha256 === digest
        && row.state === expectedState);
  if (!matched) throw new Error("completion sidecar has no matching review-log digest anchor");
}

function appendCompletionEvent(evidenceDir, completionFile, completion) {
  assertSafeEvidencePath(evidenceDir, path.relative(evidenceDir, completionFile));
  assertSafeEvidencePath(evidenceDir, "review-log.jsonl");
  const raw = readBoundedText(completionFile, "completion sidecar", MAX_MANAGED_JSON_BYTES);
  const event = {
    timestamp: new Date().toISOString(),
    event: "review_completed",
    run_id: completion.run_id,
    report_sha256: completion.report_sha256,
    completion_path: path.relative(evidenceDir, completionFile).replaceAll("\\", "/"),
    completion_sha256: sha256(Buffer.from(raw)),
    state: completion.decisions.some((decision) => decision.kind === "finding" && decision.disposition === "accepted_open") ? "complete_with_open_findings" : completion.decisions.length ? "complete_clean" : "complete_no_action",
  };
  const already = readReviewLog(evidenceDir).rows.some((row) => {
    try {
      return row.event === event.event
        && row.run_id === event.run_id
        && row.report_sha256 === event.report_sha256
        && row.completion_path === event.completion_path
        && row.completion_sha256 === event.completion_sha256
        && row.state === event.state;
    } catch { return false; }
  });
  if (!already) appendReviewLogEntry(evidenceDir, event);
  return event;
}

function archivePendingDraft(evidenceDir, runId, draftFile, validatedRaw) {
  const pending = path.join(evidenceDir, "pending", `${runId}.json`);
  if (path.resolve(draftFile) !== path.resolve(pending) || !fs.existsSync(pending)) return { path: null, error: null };
  const relative = path.join("completed-drafts", `${runId}.json`);
  const target = path.join(evidenceDir, relative);
  const submittedRelative = path.join("completed-drafts", `${runId}.submitted.json`);
  const submitted = path.join(evidenceDir, submittedRelative);
  const canonicalRaw = validatedRaw.endsWith("\n") ? validatedRaw : `${validatedRaw}\n`;
  let authoritativeArchiveReady = false;
  try {
    assertSafeEvidencePath(evidenceDir, path.join("pending", `${runId}.json`));
    assertSafeEvidencePath(evidenceDir, relative);
    assertSafeEvidencePath(evidenceDir, submittedRelative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: PRIVATE_DIR_MODE });
    if (fs.existsSync(target)) {
      if (readBoundedText(target, "completed draft archive", MAX_MANAGED_JSON_BYTES) !== canonicalRaw) throw new Error("completed draft archive already exists with different bytes");
      authoritativeArchiveReady = true;
    } else {
      // The authoritative archive is always written from the exact bytes that
      // passed validation. Never make its integrity depend on a later rename
      // of a user-editable pending file.
      atomicWrite(target, canonicalRaw);
      authoritativeArchiveReady = true;
    }
    const currentRaw = readBoundedText(pending, "pending decision draft", MAX_MANAGED_JSON_BYTES);
    if (currentRaw !== validatedRaw) {
      return { path: target, error: "pending draft changed during finalization; the validated bytes were archived and the edited pending file was preserved for inspection" };
    }
    if (fs.existsSync(submitted)) throw new Error("submitted draft preservation file already exists");
    fs.renameSync(pending, submitted);
    const submittedRaw = readBoundedText(submitted, "submitted decision draft", MAX_MANAGED_JSON_BYTES);
    if (submittedRaw !== validatedRaw) {
      return { path: target, error: "pending draft changed during archival; the exact validated bytes remain authoritative and the raced editor copy was preserved separately" };
    }
    try { fs.chmodSync(target, PRIVATE_FILE_MODE); } catch {}
    return { path: target, error: null };
  } catch (error) {
    return { path: authoritativeArchiveReady ? target : null, error: diagnosticText(error) || "draft archive failed without an error message" };
  }
}

export function finalizeDraft(evidenceDir, draftFile) {
  const initial = readJson(draftFile, "decision draft");
  const runId = safeRunId(initial.value?.run_id, "decision run_id");
  return withRunLock(evidenceDir, runId, () => {
  const locked = readJson(draftFile, "decision draft");
  if (locked.raw !== initial.raw) throw new Error("decision draft changed while finalization was acquiring its lock; inspect and retry");
  const draft = locked.value;
  const evidence = reportEvidence(evidenceDir, runId);
  const normalized = validateDecisionDocument(evidence.report, evidence.digest, draft);
  const target = completionPath(evidenceDir, runId);
  if (fs.existsSync(target)) {
    const { value: stored } = readJson(target, "existing completion");
    validateStoredCompletion(evidence.report, evidence.digest, stored);
    const comparable = (value) => canonicalJson({ ...value, completed_at: null });
    if (comparable(stored) !== comparable(normalized)) throw new Error("a different immutable completion already exists for this run");
    const event = appendCompletionEvent(evidenceDir, target, stored);
    const archivedDraft = archivePendingDraft(evidenceDir, runId, draftFile, locked.raw);
    return { completion: stored, path: target, event, already_complete: true, archived_draft_path: archivedDraft.path, draft_archive_error: archivedDraft.error };
  }
  const parent = path.dirname(target);
  fs.mkdirSync(path.dirname(parent), { recursive: true, mode: PRIVATE_DIR_MODE });
  const temporaryDirectory = `${parent}.tmp-${randomUUID()}`;
  fs.mkdirSync(temporaryDirectory, { mode: PRIVATE_DIR_MODE });
  const temporaryFile = path.join(temporaryDirectory, "completion.json");
  fs.writeFileSync(temporaryFile, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: PRIVATE_FILE_MODE, flag: "wx" });
  try {
    fs.renameSync(temporaryDirectory, parent);
  } catch (error) {
    try { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); } catch {}
    if (fs.existsSync(target)) throw new Error("another governor finalized this run concurrently; inspect status before retrying");
    throw error;
  }
  const event = appendCompletionEvent(evidenceDir, target, normalized);
  const archivedDraft = archivePendingDraft(evidenceDir, runId, draftFile, locked.raw);
  return { completion: normalized, path: target, event, already_complete: false, archived_draft_path: archivedDraft.path, draft_archive_error: archivedDraft.error };
  });
}

export function completionStatus(evidenceDir, runId) {
  try { runId = safeRunId(runId); }
  catch (error) { return { run_id: String(runId ?? ""), state: "invalid", complete: false, error: error.message }; }
  try {
    if (runLockInfo(evidenceDir, runId).active) return { run_id: runId, state: "pending", complete: false, operation_in_progress: true, completed: 0, total: 0 };
  } catch (error) { return { run_id: runId, state: "invalid", complete: false, error: error.message }; }
  let evidence;
  try { evidence = reportEvidence(evidenceDir, runId); }
  catch (error) { return { run_id: runId, state: "invalid", complete: false, error: error.message }; }
  const logDegraded = evidence.log_degraded_tail === true;
  if (evidence.report?.report_schema !== "momm-report/1") return { run_id: runId, state: "invalid", complete: false, report_sha256: evidence.digest, log_degraded_tail: logDegraded, error: "unsupported report_schema" };
  const sealedActions = evidence.report.governor_actions;
  if (sealedActions?.schema !== GOVERNOR_ACTIONS_SCHEMA
      || sealedActions?.derivation !== GOVERNOR_ACTIONS_DERIVATION) {
    let legacyActions = null;
    if (sealedActions === undefined || sealedActions === null) {
      try { legacyActions = deriveGovernorActions(evidence.report); } catch {}
    }
    const legacyError = sealedActions?.schema === GOVERNOR_ACTIONS_SCHEMA
      ? `report uses unsupported governor obligation derivation ${String(sealedActions?.derivation ?? "missing")}; expected ${GOVERNOR_ACTIONS_DERIVATION}`
      : "report predates sealed governor obligations and cannot be machine-completed";
    return {
      run_id: runId,
      state: "legacy_unverifiable",
      complete: false,
      actions: legacyActions,
      completed: 0,
      total: legacyActions?.item_count ?? 0,
      report_sha256: evidence.digest,
      log_degraded_tail: logDegraded,
      governor_actions_derivation: sealedActions?.derivation ?? null,
      expected_governor_actions_derivation: GOVERNOR_ACTIONS_DERIVATION,
      error: legacyError,
    };
  }
  let actions;
  try { actions = deriveGovernorActions(evidence.report); }
  catch (error) { return { run_id: runId, state: "invalid", complete: false, error: error.message }; }
  if (!actions.peer_collection.met) return { run_id: runId, state: "blocked_peer_gate", complete: false, actions, report_sha256: evidence.digest, log_degraded_tail: logDegraded };
  const target = completionPath(evidenceDir, runId);
  if (!fs.existsSync(target)) {
    try {
      if (completionEvents(evidenceDir, runId).length) return { run_id: runId, state: "invalid", complete: false, actions, report_sha256: evidence.digest, error: "review-log completion anchor exists but its sidecar is missing" };
    } catch (error) {
      return { run_id: runId, state: "invalid", complete: false, actions, report_sha256: evidence.digest, error: error.message };
    }
    return { run_id: runId, state: "pending", complete: false, actions, completed: 0, total: actions.item_count, report_sha256: evidence.digest, log_degraded_tail: logDegraded };
  }
  try {
    const { raw, value } = readJson(target, "completion");
    const normalized = validateStoredCompletion(evidence.report, evidence.digest, value);
    const open = normalized.decisions.filter((decision) => decision.kind === "finding" && decision.disposition === "accepted_open").length;
    const state = open ? "complete_with_open_findings" : actions.item_count ? "complete_clean" : "complete_no_action";
    requireCompletionAnchor(evidenceDir, target, raw, value, state);
    return { run_id: runId, state, complete: true, clean: open === 0, open_findings: open, completed: actions.item_count, total: actions.item_count, actions, decisions: normalized.decisions, final_checks: normalized.final_checks, report_sha256: evidence.digest, completion_path: target, log_degraded_tail: logDegraded };
  } catch (error) {
    return { run_id: runId, state: "invalid", complete: false, actions, report_sha256: evidence.digest, error: error.message };
  }
}

function toFileUrl(file) {
  return pathToFileURL(path.resolve(file)).href;
}

function rebuildLedger(evidenceDir) {
  try { assertSafeEvidencePath(evidenceDir, "ledger.html"); }
  catch (error) { return { rebuilt: false, error: error.message }; }
  const ledgerScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "ledger.mjs");
  const result = spawnSync(process.execPath, [ledgerScript, "--evidence-dir", evidenceDir], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  const ledgerPath = path.join(evidenceDir, "ledger.html");
  if (result.status !== 0 || !fs.existsSync(ledgerPath)) {
    return { rebuilt: false, error: diagnosticText(result.stderr || result.stdout || `ledger builder exited ${result.status}`) };
  }
  return { rebuilt: true, url: toFileUrl(ledgerPath) };
}

function retainedTombstoneCount(evidenceDir) {
  const root = path.join(evidenceDir, ".locks");
  if (!fs.existsSync(root)) return 0;
  try {
    assertSafeEvidencePath(evidenceDir, ".locks");
    const pending = [root];
    let count = 0;
    while (pending.length) {
      const directory = pending.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`lock telemetry path is a symbolic link: ${target}`);
        if (!entry.isDirectory()) continue;
        if (entry.name.includes(".reclaimed-")) count += 1;
        else pending.push(target);
      }
    }
    return count;
  } catch { return null; }
}

function statusWithLedger(evidenceDir, status, { rebuild = true, privacyError = null, protectionStatus = null, ephemeralHint = null } = {}) {
  let ledger;
  if (privacyError) ledger = { rebuilt: false, error: `private evidence protection failed: ${privacyError}` };
  else if (rebuild) ledger = rebuildLedger(evidenceDir);
  else {
    const ledgerPath = path.join(evidenceDir, "ledger.html");
    try {
      assertSafeEvidencePath(evidenceDir, "ledger.html");
      ledger = fs.existsSync(ledgerPath) ? { rebuilt: false, available: true, url: toFileUrl(ledgerPath) } : { rebuilt: false, available: false, error: "ledger has not been built" };
    } catch (error) { ledger = { rebuilt: false, error: error.message }; }
  }
  const completed = Number.isSafeInteger(status.completed) ? status.completed : 0;
  const total = Number.isSafeInteger(status.total) ? status.total : status.actions?.item_count ?? 0;
  const link = ledger.url ? ` Private local ledger: ${ledger.url}` : ` Ledger unavailable: ${ledger.error || "rebuild failed"}.`;
  const logWarning = status.log_degraded_tail ? " Review-log warning: an incomplete crash-tail record was detected and will be preserved/repaired on the next safe write." : "";
  // The hint can force the warning on, but cannot suppress path-derived risk.
  const durabilityWarning = (ephemeralHint === true || isEphemeralPath(evidenceDir)) ? " TEMPORARY EVIDENCE RISK — this ledger is under the operating-system temporary directory and may be deleted automatically; move or re-run it in a durable project directory." : "";
  const statusGatePassed = status.complete === true && !privacyError && Boolean(ledger.url);
  const gitPrivacyProtected = ["local_exclude_added", "already_excluded"].includes(protectionStatus)
    ? true : protectionStatus === "unavailable" ? false : null;
  let requiredUserMessage;
  if (status.complete && statusGatePassed) {
    const open = status.open_findings ? `; ${status.open_findings} finding(s) remain open` : "";
    requiredUserMessage = `MOMM REVIEW COMPLETE — ${status.state}, ${completed}/${total} governor decisions validated${open}.${link}`;
  } else if (status.complete) {
    requiredUserMessage = `MOMM REVIEW NOT FINISHED — governor completion evidence is valid (${status.state}, ${completed}/${total}), but the required privacy-and-ledger status gate failed.${link}`;
  } else if (status.operation_in_progress) {
    requiredUserMessage = `MOMM REVIEW NOT FINISHED — a governor prepare/finalize operation is in progress; retry the status gate when it completes.${link}`;
  } else if (status.state === "pending") {
    requiredUserMessage = `MOMM REVIEW NOT FINISHED — ${status.state}, ${completed}/${total} governor decisions validated; complete the decision draft and run the final status gate.${link}`;
  } else if (status.state === "legacy_unverifiable") {
    requiredUserMessage = `MOMM REVIEW NOT FINISHED — legacy evidence has no supported sealed obligation derivation and cannot be completed post hoc; re-run peer collection with the current MOMM release.${link}`;
  } else if (status.state === "blocked_peer_gate") {
    requiredUserMessage = `MOMM REVIEW NOT FINISHED — peer gate blocked (${status.actions?.peer_collection?.succeeded ?? 0}/${status.actions?.peer_collection?.required ?? 1} required external reviews); re-run peer collection before adjudication.${link}`;
  } else {
    requiredUserMessage = `MOMM REVIEW INVALID — ${status.error || "completion evidence failed validation"}.${link}`;
  }
  return {
    ...status,
    retained_lock_tombstones: retainedTombstoneCount(evidenceDir),
    privacy_protected: gitPrivacyProtected,
    git_privacy_status: protectionStatus,
    privacy_error: privacyError || null,
    ledger_rebuilt: ledger.rebuilt,
    ledger_available: Boolean(ledger.url),
    ledger_url: ledger.url ?? null,
    ledger_error: ledger.error ?? null,
    status_gate_passed: statusGatePassed,
    review_complete: statusGatePassed,
    required_user_message: `${requiredUserMessage}${logWarning}${durabilityWarning}`,
  };
}

function parseCli(argv) {
  const options = { evidenceDir: null, pretty: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { if (++index >= argv.length) throw new Error(`missing value for ${arg}`); return argv[index]; };
    if (arg === "--prepare") options.prepare = next();
    else if (arg === "--finalize") options.finalize = next();
    else if (arg === "--status") options.status = next();
    else if (arg === "--evidence-dir") options.evidenceDir = next();
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if ([options.prepare, options.finalize, options.status, options.selfTest, options.help].filter(Boolean).length !== 1) throw new Error("choose exactly one of --prepare, --finalize, --status, --self-test, or --help");
  return options;
}

function readRun(evidenceDir, runId) {
  const evidence = reportEvidence(evidenceDir, runId);
  return { ...evidence, prepared: prepareDraft(evidenceDir, evidence.report, evidence.digest) };
}

async function parallelStaleLockProbe(evidenceDir) {
  const lockDirectory = path.join(evidenceDir, ".locks", "review-log.lock");
  fs.mkdirSync(lockDirectory, { recursive: true, mode: PRIVATE_DIR_MODE });
  fs.writeFileSync(path.join(lockDirectory, "owner.json"), `${JSON.stringify({ schema: LOCK_SCHEMA, token: "abandoned", pid: 2_147_483_647, hostname: os.hostname(), created_at: "2000-01-01T00:00:00.000Z" })}\n`, { mode: PRIVATE_FILE_MODE });
  const old = new Date(Date.now() - LOCK_STALE_MS - 60_000);
  fs.utimesSync(lockDirectory, old, old);
  const barrier = new SharedArrayBuffer(4);
  const ownership = new SharedArrayBuffer(8);
  const source = `const { parentPort, workerData } = require("node:worker_threads"); (async () => {
    const api = await import(workerData.moduleUrl);
    parentPort.postMessage({ ready: true });
    const gate = new Int32Array(workerData.barrier);
    Atomics.wait(gate, 0, 0);
    try {
      api.withReviewLogLock(workerData.evidenceDir, () => {
        const counters = new Int32Array(workerData.ownership);
        const active = Atomics.add(counters, 0, 1) + 1;
        let maximum = Atomics.load(counters, 1);
        while (active > maximum) {
          const observed = Atomics.compareExchange(counters, 1, maximum, active);
          if (observed === maximum) break;
          maximum = observed;
        }
        // Hold ownership long enough for all released contenders to observe it;
        // retry sleeps are only 10ms so this detects accidental overlap.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
        Atomics.sub(counters, 0, 1);
      });
      parentPort.postMessage({ entered: true });
    } catch (error) { parentPort.postMessage({ entered: false, error: error.message, error_code: error.code ?? null }); }
  })();`;
  const workers = [];
  const messages = [];
  let ready = 0;
  const workerCount = 8;
  for (let index = 0; index < workerCount; index += 1) {
    const worker = new Worker(source, {
      eval: true,
      execArgv: [],
      workerData: { moduleUrl: pathToFileURL(fileURLToPath(import.meta.url)).href, evidenceDir, barrier, ownership },
    });
    workers.push(worker);
    worker.on("message", (message) => {
      messages.push(message);
      if (message?.ready && ++ready === workerCount) {
        Atomics.store(new Int32Array(barrier), 0, 1);
        Atomics.notify(new Int32Array(barrier), 0);
      }
    });
  }
  const workerFailures = [];
  await Promise.all(workers.map((worker, index) => new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const finish = (failure = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (failure) workerFailures.push(failure);
      resolve();
    };
    const timeout = setTimeout(async () => {
      if (settled) return;
      timedOut = true;
      try { await worker.terminate(); } catch {}
      finish(`parallel lock worker ${index + 1} did not exit within 10 seconds`);
    }, 10_000);
    worker.on("error", (error) => { if (!timedOut) finish(`parallel lock worker ${index + 1} failed: ${diagnosticText(error)}`); });
    worker.on("exit", (code) => { if (!timedOut) finish(code === 0 ? null : `parallel lock worker ${index + 1} exited ${code}`); });
  })));
  const rejected = messages.filter((message) => message?.entered === false);
  return {
    entered: messages.filter((message) => message?.entered === true).length,
    rejected: rejected.length,
    unexpected_errors: [
      ...workerFailures,
      ...rejected.filter((message) => message.error_code !== LOCK_CONTENTION_CODE).map((message) => String(message.error ?? "")),
    ],
    max_concurrent: Atomics.load(new Int32Array(ownership), 1),
    lock_exists: fs.existsSync(lockDirectory),
  };
}

async function selfTest() {
  const sampleFinding = { id: "f1", severity: "WARNING", target_file: "m.py", line_range: [1, 1], attachment_id: null, region: null, issue: "wrong bound", rationale: "", test_suggestion: null };
  const sample = {
    report_schema: "momm-report/1", run_id: "rev_test", governor: "codex",
    reviewers: [
      { agent: "codex", status: "self_excluded", suggested_improvements: null },
      { agent: "grok", status: "success", suggested_improvements: ["same text", "same text"], findings: [sampleFinding] },
    ],
    findings: [{ ...sampleFinding, sources: ["grok"], claims: [{ agent: "grok", ...sampleFinding }] }],
  };
  // Hand-written compatibility fixture: never derive this value with the
  // implementation under test. Changing the v1 obligation contract must
  // therefore either fail this test or introduce a new derivation version.
  const frozenActionsV1 = Object.freeze({
    schema: "momm-governor-actions/1",
    derivation: "momm-obligations/1",
    state_at_dispatch: "pending",
    final_checks_required: true,
    finding_count: 1,
    suggestion_count: 2,
    item_count: 3,
    items: [
      {
        item_id: "finding-ac30e41c71c9bea2", kind: "finding", report_pointer: "/reviewers/1/findings/0",
        finding_group_pointer: "/findings/0", finding_group_index: 0, claim_index: 0, correlation_id: null,
        finding_id: "f1", severity: "WARNING", reviewer: "grok", reviewers: ["grok"], raw_finding_index: 0,
        reproduction_required: true, subject: "wrong bound",
      },
      {
        item_id: "suggestion-48b3f5858b1f8c3a", kind: "suggestion", report_pointer: "/reviewers/1/suggested_improvements/0",
        reviewer: "grok", suggestion_index: 0, subject: "same text",
      },
      {
        item_id: "suggestion-fe24ef4816554916", kind: "suggestion", report_pointer: "/reviewers/1/suggested_improvements/1",
        reviewer: "grok", suggestion_index: 1, subject: "same text",
      },
    ],
    peer_collection: { requested: 1, succeeded: 1, required: 1, strict: false, met: true },
    run_id: "rev_test",
  });
  const actionsA = deriveGovernorActions(sample);
  const actionsB = deriveGovernorActions(JSON.parse(JSON.stringify(sample)));
  const tests = {
    stable_ids_across_repeated_derivation: JSON.stringify(actionsA.items) === JSON.stringify(actionsB.items),
    duplicate_suggestion_text_has_distinct_ids: actionsA.items[1].item_id !== actionsA.items[2].item_id,
    findings_and_suggestions_are_all_counted: actionsA.finding_count === 1 && actionsA.suggestion_count === 2 && actionsA.item_count === 3,
    correlated_raw_claims_remain_separately_adjudicable: (() => {
      const first = { id: "first", severity: "WARNING", issue: "missing validation for lower bound" };
      const second = { id: "second", severity: "WARNING", issue: "missing validation for encoding" };
      const correlated = deriveGovernorActions({
        report_schema: "momm-report/1", run_id: "rev_correlated", governor: "codex",
        reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "claude", status: "success", findings: [first] }, { agent: "grok", status: "success", findings: [second] }],
        findings: [{ id: "validation", severity: "WARNING", issue: "missing validation", sources: ["claude", "grok"], claims: [
          { agent: "claude", ...first },
          { agent: "grok", ...second },
        ] }],
      });
      return correlated.finding_count === 2
        && correlated.items[0].report_pointer === "/reviewers/1/findings/0"
        && correlated.items[1].report_pointer === "/reviewers/2/findings/0"
        && correlated.items[0].item_id !== correlated.items[1].item_id;
    })(),
    nonrecord_reviewer_fails_before_pointer_shift: (() => {
      try {
        deriveGovernorActions({
          report_schema: "momm-report/1", run_id: "rev_shift", governor: "codex",
          reviewers: [null, { agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [sampleFinding], suggested_improvements: ["s"] }],
          findings: [{ ...sampleFinding, sources: ["grok"], claims: [{ agent: "grok", ...sampleFinding }] }],
        });
        return false;
      } catch (error) { return /report\.reviewers\[0\] must be an object/.test(error.message); }
    })(),
    zero_peer_success_is_blocked: deriveGovernorActions({ ...sample, reviewers: [{ agent: "grok", status: "timeout" }], findings: [] }).state_at_dispatch === "blocked_peer_gate",
    evidence_root_discovers_nested_git_root: null,
    local_exclude_does_not_dirty_worktree: null,
    exact_set_and_digest_are_enforced: null,
    validated_draft_archive_is_immune_to_external_edit_race: null,
    archive_path_survives_post_write_failure: null,
    long_archive_failure_remains_structured: null,
    complete_and_open_states_are_distinct: null,
    unsafe_run_ids_fail_closed: (() => { try { deriveGovernorActions({ ...sample, run_id: "../escape" }); return false; } catch { return true; } })(),
    stale_existing_draft_is_rejected: null,
    completion_requires_matching_log_anchor: null,
    logged_completion_with_missing_sidecar_is_invalid: null,
    identical_finalization_is_idempotent: null,
    governor_never_counts_as_external_peer: (() => {
      try { deriveGovernorActions({ report_schema: "momm-report/1", run_id: "rev_governor", governor: "codex", reviewers: [{ agent: "codex", status: "success", suggested_improvements: [], findings: [] }], findings: [] }); return false; }
      catch (error) { return /governor reviewer entry codex must be self_excluded/.test(error.message); }
    })(),
    external_self_exclusion_fails_closed: (() => {
      try {
        deriveGovernorActions({ report_schema: "momm-report/1", run_id: "rev_external_self", governor: "codex", strict: true, reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [] }, { agent: "copilot", status: "self_excluded" }], findings: [] });
        return false;
      } catch (error) { return /external reviewer copilot cannot be self_excluded/.test(error.message); }
    })(),
    malformed_peer_gate_configuration_fails_closed: (() => {
      const base = { report_schema: "momm-report/1", run_id: "rev_bad_gate", governor: "codex", reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [] }, { agent: "copilot", status: "timeout" }], findings: [] };
      let strictRejected = false;
      let quorumRejected = false;
      try { deriveGovernorActions({ ...base, strict: "true" }); } catch (error) { strictRejected = /strict must be boolean/.test(error.message); }
      try { deriveGovernorActions({ ...base, quorum: { required: "2" } }); } catch (error) { quorumRejected = /quorum\.required must be a positive integer/.test(error.message); }
      return strictRejected && quorumRejected;
    })(),
    strict_partial_peer_success_is_blocked: deriveGovernorActions({ report_schema: "momm-report/1", run_id: "rev_strict", governor: "codex", strict: true, reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [] }, { agent: "copilot", status: "timeout" }], findings: [] }).peer_collection.met === false,
    strict_zero_peer_report_remains_validly_blocked: (() => {
      const actions = deriveGovernorActions({ report_schema: "momm-report/1", run_id: "rev_strict_zero", governor: "codex", strict: true, reviewers: [{ agent: "codex", status: "self_excluded" }], findings: [] });
      return actions.state_at_dispatch === "blocked_peer_gate" && actions.peer_collection.required === 1 && deriveGovernorActions({ report_schema: "momm-report/1", run_id: "rev_strict_zero", governor: "codex", strict: true, reviewers: [{ agent: "codex", status: "self_excluded" }], findings: [], governor_actions: actions }).state_at_dispatch === "blocked_peer_gate";
    })(),
    duplicate_reviewer_identity_fails_closed: (() => { try { deriveGovernorActions({ report_schema: "momm-report/1", run_id: "rev_duplicate", governor: "codex", reviewers: [{ agent: "grok", status: "success" }, { agent: "grok", status: "success" }], findings: [] }); return false; } catch { return true; } })(),
    sealed_peer_gate_must_match_reviewer_status: (() => {
      const peerReport = { report_schema: "momm-report/1", run_id: "rev_peer_mismatch", governor: "codex", reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [] }], findings: [] };
      const actions = deriveGovernorActions(peerReport);
      try { deriveGovernorActions({ ...peerReport, reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "timeout" }], governor_actions: actions }); return false; }
      catch { return true; }
    })(),
    raw_reviewer_finding_multiset_is_authoritative: (() => {
      const rawFinding = { id: "raw", severity: "WARNING", issue: "raw defect" };
      try {
        deriveGovernorActions({ report_schema: "momm-report/1", run_id: "rev_raw_gap", governor: "codex", reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [rawFinding] }], findings: [] });
        return false;
      } catch {}
      try {
        deriveGovernorActions({ report_schema: "momm-report/1", run_id: "rev_correlated_extra", governor: "codex", reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [] }], findings: [{ ...rawFinding, sources: ["grok"], claims: [{ agent: "grok", ...rawFinding }] }] });
        return false;
      } catch {}
      const duplicate = deriveGovernorActions({
        report_schema: "momm-report/1", run_id: "rev_duplicate_claims", governor: "codex",
        reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [rawFinding, rawFinding] }],
        findings: [{ ...rawFinding, sources: ["grok"], claims: [{ agent: "grok", ...rawFinding }, { agent: "grok", ...rawFinding }] }],
      });
      try {
        deriveGovernorActions({
          report_schema: "momm-report/1", run_id: "rev_rewritten_claim", governor: "codex",
          reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [rawFinding] }],
          findings: [{ ...rawFinding, sources: ["grok"], claims: [{ agent: "grok", ...rawFinding, id: "rewritten" }] }],
        });
        return false;
      } catch { return duplicate.finding_count === 2 && duplicate.items[0].item_id !== duplicate.items[1].item_id; }
    })(),
    successful_reviewer_requires_raw_findings_array: (() => {
      try { deriveGovernorActions({ report_schema: "momm-report/1", run_id: "rev_null_findings", governor: "codex", reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: null }], findings: [] }); return false; }
      catch (error) { return /lacks a raw findings array/.test(error.message); }
    })(),
    canonical_comparison_ignores_key_insertion_order: canonicalJson({ b: 2, nested: { z: 1, a: 2 }, a: 1 })
      === canonicalJson({ a: 1, nested: { a: 2, z: 1 }, b: 2 }),
    nonmaterial_rejection_does_not_require_reproduction: null,
    nonmaterial_fixed_uses_scaffolded_null_reproduction: null,
    nonmaterial_open_is_never_described_as_reproduced: null,
    applied_behavioral_suggestion_requires_reproduction_and_verification: null,
    malformed_optional_reproduction_is_rejected: null,
    current_derivation_matches_hand_written_v1_fixture: canonicalJson(actionsA) === canonicalJson(frozenActionsV1),
    unsupported_derivation_is_checked_before_current_derivation: (() => {
      try {
        deriveGovernorActions({
          report_schema: "momm-report/1", run_id: "rev_old_derivation", governor: "codex",
          reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: null }],
          findings: [], governor_actions: { schema: GOVERNOR_ACTIONS_SCHEMA, derivation: "momm-obligations/0" },
        });
        return false;
      } catch (error) { return /unsupported derivation momm-obligations\/0/.test(error.message); }
    })(),
    unsupported_derivation_is_legacy_unverifiable: null,
    sealed_actions_reject_noncanonical_fields: null,
    oversized_report_fails_before_read: null,
    bounded_reader_rejects_concurrent_growth: null,
    oversized_pending_draft_fails_before_read: null,
    oversized_git_exclude_fails_closed: null,
    obligation_count_is_bounded: (() => {
      try {
        deriveGovernorActions({
          report_schema: "momm-report/1", run_id: "rev_many", governor: "codex",
          reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [], suggested_improvements: Array(MAX_OBLIGATIONS + 1).fill("bounded suggestion") }],
          findings: [],
        });
        return false;
      } catch (error) { return /more than/.test(error.message); }
    })(),
    correlated_claim_index_is_bounded: (() => {
      const rawFinding = { id: "bounded", severity: "WARNING", issue: "bounded claim" };
      try {
        deriveGovernorActions({
          report_schema: "momm-report/1", run_id: "rev_many_claims", governor: "codex",
          reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [] }],
          findings: [{ ...rawFinding, sources: ["grok"], claims: Array.from({ length: MAX_OBLIGATIONS + 1 }, () => ({ agent: "grok", ...rawFinding })) }],
        });
        return false;
      } catch (error) { return /more than/.test(error.message); }
    })(),
    legacy_report_without_raw_claims_is_unverifiable_not_invalid: null,
    evidence_root_file_is_rejected: null,
    gitignore_metacharacters_are_literal_and_verified: null,
    tracked_evidence_fails_closed: null,
    trailing_crash_tail_is_tolerated_and_repaired: null,
    interior_log_corruption_fails_closed: null,
    run_id_cannot_collide_with_global_log_lock: null,
    parallel_stale_lock_recovery_never_overlaps_owners: null,
    release_blocks_replacement_until_canonical_remove: null,
    release_rejects_changed_owner_token: null,
    retained_tombstone_blocks_delayed_contender: null,
    crash_after_tombstone_is_recoverable: null,
    ownerless_stale_lock_fails_closed: null,
    foreign_host_lock_has_manual_recovery_message: null,
    mismatched_tombstone_fails_closed: null,
    retained_tombstone_count_is_visible: null,
    eexist_release_window_retries_acquisition: null,
    draft_edit_while_acquiring_lock_is_rejected: null,
    finalization_acquires_run_lock_before_log_lock: null,
    completion_relay_repeats_ephemeral_durability_risk: null,
    privacy_failure_preserves_structured_completion_state: null,
    final_status_message_requires_privacy_and_ledger_gate: null,
    non_git_privacy_state_is_not_misreported_as_protected: null,
    unrelated_reserved_directory_is_not_adopted: null,
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "momm-completion-test-"));
  try {
    spawnSync("git", ["init", "-q", root], { windowsHide: true });
    const nested = path.join(root, "src"); fs.mkdirSync(nested);
    const context = resolveEvidenceContext({ cwd: nested });
    const protection = protectEvidenceFromGit(context);
    ensureEvidenceZone(context);
    tests.evidence_root_discovers_nested_git_root = context.project_root === path.resolve(root) && context.directory === path.join(path.resolve(root), ".ensemble_reviews");
    const gitStatus = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8", windowsHide: true });
    tests.local_exclude_does_not_dirty_worktree = protection.status === "local_exclude_added" && gitStatus.stdout.trim() === "";
    const excludeBackup = readBoundedText(context.git.exclude, "Git local exclude fixture", MAX_GIT_EXCLUDE_BYTES);
    const excludeHandle = fs.openSync(context.git.exclude, "w");
    try { fs.ftruncateSync(excludeHandle, MAX_GIT_EXCLUDE_BYTES + 1); } finally { fs.closeSync(excludeHandle); }
    try {
      const oversizedExclude = protectEvidenceFromGit(context);
      tests.oversized_git_exclude_fails_closed = oversizedExclude.status === "unavailable" && /exceeds/.test(oversizedExclude.error);
    } finally { fs.writeFileSync(context.git.exclude, excludeBackup, "utf8"); }
    const relayProbe = statusWithLedger(context.directory, { run_id: "rev_probe", state: "complete_clean", complete: true, completed: 1, total: 1 }, { rebuild: false, protectionStatus: protection.status });
    const staleFalseRelayProbe = statusWithLedger(context.directory, { run_id: "rev_probe", state: "pending", complete: false }, { rebuild: false, protectionStatus: protection.status, ephemeralHint: false });
    tests.completion_relay_repeats_ephemeral_durability_risk = relayProbe.required_user_message.includes("TEMPORARY EVIDENCE RISK")
      && staleFalseRelayProbe.required_user_message.includes("TEMPORARY EVIDENCE RISK");
    const privacyProbe = statusWithLedger(context.directory, { run_id: "rev_probe", state: "complete_clean", complete: true, completed: 1, total: 1 }, { rebuild: false, privacyError: "local exclusion is read-only", protectionStatus: "unavailable" });
    tests.privacy_failure_preserves_structured_completion_state = privacyProbe.state === "complete_clean" && privacyProbe.complete === true
      && privacyProbe.privacy_protected === false && privacyProbe.ledger_url === null
      && privacyProbe.required_user_message.includes("private evidence protection failed");
    tests.final_status_message_requires_privacy_and_ledger_gate = privacyProbe.status_gate_passed === false && privacyProbe.review_complete === false
      && privacyProbe.required_user_message.startsWith("MOMM REVIEW NOT FINISHED") && !privacyProbe.required_user_message.includes("MOMM REVIEW COMPLETE")
      && relayProbe.status_gate_passed === false && relayProbe.required_user_message.startsWith("MOMM REVIEW NOT FINISHED");
    const nonGitProbe = statusWithLedger(context.directory, { run_id: "rev_probe", state: "pending", complete: false }, { rebuild: false, protectionStatus: "not_a_git_repo" });
    tests.non_git_privacy_state_is_not_misreported_as_protected = nonGitProbe.privacy_protected === null && nonGitProbe.git_privacy_status === "not_a_git_repo";
    const unrelatedDirectory = path.join(root, "unrelated", ".ensemble_reviews");
    fs.mkdirSync(unrelatedDirectory, { recursive: true });
    fs.writeFileSync(path.join(unrelatedDirectory, "review-log.jsonl"), `${JSON.stringify({ application: "not-momm", value: 1 })}\n`);
    const unrelatedContext = resolveEvidenceContext({ cwd: root, evidenceDir: unrelatedDirectory });
    try { ensureEvidenceZone(unrelatedContext); }
    catch { tests.unrelated_reserved_directory_is_not_adopted = !fs.existsSync(path.join(unrelatedDirectory, ".momm-evidence-zone.json")); }
    const fileRoot = path.join(root, "evidence-file"); fs.writeFileSync(fileRoot, "not a directory");
    try { assertSafeEvidencePath(fileRoot); } catch { tests.evidence_root_file_is_rejected = true; }
    const bracketContext = resolveEvidenceContext({ cwd: root, evidenceDir: "[secret]" });
    tests.gitignore_metacharacters_are_literal_and_verified = protectEvidenceFromGit(bracketContext).status === "local_exclude_added";
    const trackedDirectory = path.join(root, "tracked-zone"); fs.mkdirSync(trackedDirectory); fs.writeFileSync(path.join(trackedDirectory, "record.txt"), "tracked");
    spawnSync("git", ["-C", root, "add", "tracked-zone/record.txt"], { windowsHide: true });
    const trackedContext = resolveEvidenceContext({ cwd: root, evidenceDir: "tracked-zone" });
    tests.tracked_evidence_fails_closed = protectEvidenceFromGit(trackedContext).status === "unavailable";
    fs.mkdirSync(path.join(context.directory, "reports"), { recursive: true });
    const reportWithActions = { ...sample, governor_actions: JSON.parse(JSON.stringify(frozenActionsV1)) };
    const sealMutations = [
      ["item_id", "finding-deadbeefdeadbeef"],
      ["severity", "NITPICK"],
      ["subject", "rewritten subject"],
      ["finding_id", "forged"],
      ["correlation_id", "forged-correlation"],
      ["reviewers", ["forged"]],
    ];
    tests.sealed_actions_reject_noncanonical_fields = sealMutations.every(([field, replacement]) => {
      const mutated = JSON.parse(JSON.stringify(actionsA));
      mutated.items[0][field] = replacement;
      try { deriveGovernorActions({ ...sample, governor_actions: mutated }); return false; }
      catch (error) { return /does not canonically match/.test(error.message); }
    });
    const appliedDraft = decisionDraft(reportWithActions, "a".repeat(64));
    appliedDraft.decisions = appliedDraft.decisions.map((decision, index) => decision.kind === "finding"
      ? { ...decision, disposition: "fixed", reason: "fixed", reproduction: { method: "test", outcome: "reproduced", evidence: "failed before" }, verification: [{ kind: "test", outcome: "pass", evidence: "passes after" }] }
      : index === 1
        ? { ...decision, claim_type: "behavioral", disposition: "applied", reason: "applied", reproduction: null, verification: [{ kind: "test", outcome: "pass", evidence: "passes after" }] }
        : { ...decision, claim_type: "other", disposition: "rejected", reason: "not suitable", reproduction: null, verification: [] });
    appliedDraft.final_checks = [{ kind: "test", outcome: "pass", evidence: "full suite" }];
    let missingAppliedReproductionRejected = false;
    try { validateDecisionDocument(reportWithActions, "a".repeat(64), appliedDraft); }
    catch (error) { missingAppliedReproductionRejected = /is required|requires reproduced-before evidence/.test(error.message); }
    const appliedWithoutVerification = JSON.parse(JSON.stringify(appliedDraft));
    appliedWithoutVerification.decisions[1].reproduction = { method: "test", outcome: "reproduced", evidence: "failed before" };
    appliedWithoutVerification.decisions[1].verification = [];
    let missingAppliedVerificationRejected = false;
    try { validateDecisionDocument(reportWithActions, "a".repeat(64), appliedWithoutVerification); }
    catch (error) { missingAppliedVerificationRejected = /requires passing verification/.test(error.message); }
    tests.applied_behavioral_suggestion_requires_reproduction_and_verification = missingAppliedReproductionRejected && missingAppliedVerificationRejected;
    const malformedOptional = JSON.parse(JSON.stringify(appliedDraft));
    malformedOptional.decisions[1].reproduction = { method: "test", outcome: "reproduced", evidence: "failed before" };
    malformedOptional.decisions[2].reproduction = { method: 5, outcome: 5, evidence: 5 };
    try { validateDecisionDocument(reportWithActions, "a".repeat(64), malformedOptional); }
    catch (error) { tests.malformed_optional_reproduction_is_rejected = /reproduction\.method is required/.test(error.message); }
    const oversizedPath = path.join(context.directory, "reports", "rev_oversized.json");
    const oversizedHandle = fs.openSync(oversizedPath, "w");
    try { fs.ftruncateSync(oversizedHandle, MAX_REPORT_BYTES + 1); } finally { fs.closeSync(oversizedHandle); }
    const oversizedStatus = completionStatus(context.directory, "rev_oversized");
    tests.oversized_report_fails_before_read = oversizedStatus.state === "invalid" && /exceeds/.test(oversizedStatus.error);
    const growingFile = path.join(root, "growing.json");
    fs.writeFileSync(growingFile, "1234");
    const originalReadForGrowth = fs.readSync;
    let growthInjected = false;
    try {
      fs.readSync = function growBetweenStatAndRead(handle, buffer, offset, length, position) {
        if (!growthInjected) { growthInjected = true; fs.appendFileSync(growingFile, "5"); }
        return originalReadForGrowth.call(this, handle, buffer, offset, length, position);
      };
      try { readBoundedBytes(growingFile, "growing fixture", 100); }
      catch (error) { tests.bounded_reader_rejects_concurrent_growth = growthInjected && /changed size/.test(error.message); }
    } finally { fs.readSync = originalReadForGrowth; }
    const oversizedPendingReport = {
      report_schema: "momm-report/1", run_id: "rev_oversized_pending", governor: "codex",
      reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [], suggested_improvements: [] }],
      findings: [],
    };
    oversizedPendingReport.governor_actions = deriveGovernorActions(oversizedPendingReport);
    fs.mkdirSync(path.join(context.directory, "pending"), { recursive: true });
    const oversizedPendingPath = path.join(context.directory, "pending", "rev_oversized_pending.json");
    const oversizedPendingHandle = fs.openSync(oversizedPendingPath, "w");
    try { fs.ftruncateSync(oversizedPendingHandle, MAX_MANAGED_JSON_BYTES + 1); } finally { fs.closeSync(oversizedPendingHandle); }
    try { prepareDraft(context.directory, oversizedPendingReport, "b".repeat(64)); }
    catch (error) { tests.oversized_pending_draft_fails_before_read = /exceeds/.test(error.message); }
    const legacyReport = {
      report_schema: "momm-report/1", run_id: "rev_legacy_missing_claims", governor: "codex",
      reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: null }],
      findings: [{ id: "legacy", severity: "WARNING", issue: "old correlated summary without raw claims" }],
    };
    const legacyRaw = `${JSON.stringify(legacyReport, null, 2)}\n`;
    const legacyDigest = sha256(Buffer.from(legacyRaw));
    fs.writeFileSync(path.join(context.directory, "reports", "rev_legacy_missing_claims.json"), legacyRaw);
    appendReviewLogEntry(context.directory, { run_id: "rev_legacy_missing_claims", report_sha256: legacyDigest });
    const legacyStatus = completionStatus(context.directory, "rev_legacy_missing_claims");
    tests.legacy_report_without_raw_claims_is_unverifiable_not_invalid = legacyStatus.state === "legacy_unverifiable"
      && /predates sealed governor obligations/.test(legacyStatus.error);
    const unsupportedRunId = "rev_unsupported_derivation";
    const unsupportedReport = {
      ...sample,
      run_id: unsupportedRunId,
      governor_actions: { ...frozenActionsV1, derivation: "momm-obligations/999", run_id: unsupportedRunId },
    };
    const unsupportedRaw = `${JSON.stringify(unsupportedReport, null, 2)}\n`;
    const unsupportedDigest = sha256(Buffer.from(unsupportedRaw));
    fs.writeFileSync(path.join(context.directory, "reports", `${unsupportedRunId}.json`), unsupportedRaw);
    appendReviewLogEntry(context.directory, { run_id: unsupportedRunId, report_sha256: unsupportedDigest });
    const unsupportedStatus = completionStatus(context.directory, unsupportedRunId);
    const unsupportedCli = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--status", unsupportedRunId, "--evidence-dir", context.directory], {
      cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000,
    });
    let unsupportedCliStatus = null;
    try { unsupportedCliStatus = JSON.parse(unsupportedCli.stdout); } catch {}
    tests.unsupported_derivation_is_legacy_unverifiable = unsupportedStatus.state === "legacy_unverifiable"
      && unsupportedStatus.complete === false
      && unsupportedStatus.governor_actions_derivation === "momm-obligations/999"
      && unsupportedStatus.expected_governor_actions_derivation === GOVERNOR_ACTIONS_DERIVATION
      && /unsupported governor obligation derivation/.test(unsupportedStatus.error)
      && unsupportedCli.status === 4
      && unsupportedCliStatus?.state === "legacy_unverifiable"
      && unsupportedCliStatus?.complete === false;
    const nitpickFinding = { id: "style", severity: "NITPICK", issue: "minor style" };
    const nitpick = { report_schema: "momm-report/1", run_id: "rev_nitpick", governor: "codex", reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", suggested_improvements: [], findings: [nitpickFinding] }], findings: [{ ...nitpickFinding, sources: ["grok"], claims: [{ agent: "grok", ...nitpickFinding }] }] };
    nitpick.governor_actions = deriveGovernorActions(nitpick);
    const nitpickDraft = decisionDraft(nitpick, "a".repeat(64));
    nitpickDraft.decisions[0] = { ...nitpickDraft.decisions[0], disposition: "rejected", reason: "Not a defect", reproduction: null, verification: [] };
    nitpickDraft.final_checks = [{ kind: "inspection", outcome: "pass", evidence: "reviewed final file" }];
    try { validateDecisionDocument(nitpick, "a".repeat(64), nitpickDraft); tests.nonmaterial_rejection_does_not_require_reproduction = true; } catch {}
    const nitpickFixedDraft = decisionDraft(nitpick, "a".repeat(64));
    nitpickFixedDraft.decisions[0] = { ...nitpickFixedDraft.decisions[0], disposition: "fixed", reason: "fixed minor issue", verification: [{ kind: "inspection", outcome: "pass", evidence: "verified final file" }] };
    nitpickFixedDraft.final_checks = [{ kind: "inspection", outcome: "pass", evidence: "reviewed final file" }];
    try { validateDecisionDocument(nitpick, "a".repeat(64), nitpickFixedDraft); tests.nonmaterial_fixed_uses_scaffolded_null_reproduction = true; } catch {}
    const nitpickOpenDraft = decisionDraft(nitpick, "a".repeat(64));
    nitpickOpenDraft.decisions[0] = { ...nitpickOpenDraft.decisions[0], disposition: "accepted_open", reason: "minor issue remains open", reproduction: null, verification: [] };
    nitpickOpenDraft.final_checks = [{ kind: "inspection", outcome: "pass", evidence: "reviewed final file" }];
    try {
      const normalizedOpen = validateDecisionDocument(nitpick, "a".repeat(64), nitpickOpenDraft);
      const ledgerFixture = path.join(context.directory, "ledger.html");
      atomicWrite(ledgerFixture, "<!doctype html><meta name=\"momm-private-ledger/1\"><title>My momm ledger</title>\n");
      const openRelay = statusWithLedger(context.directory, { run_id: nitpick.run_id, state: "complete_with_open_findings", complete: true, open_findings: 1, completed: 1, total: 1 }, { rebuild: false, protectionStatus: protection.status });
      tests.nonmaterial_open_is_never_described_as_reproduced = normalizedOpen.decisions[0].reproduction === null
        && openRelay.status_gate_passed === true && openRelay.required_user_message.includes("1 finding(s) remain open")
        && !openRelay.required_user_message.includes("reproduced finding");
      fs.rmSync(ledgerFixture);
    } catch {}
    const raw = `${JSON.stringify(reportWithActions, null, 2)}\n`;
    const digest = sha256(Buffer.from(raw));
    fs.writeFileSync(path.join(context.directory, "reports", "rev_test.json"), raw);
    fs.writeFileSync(path.join(context.directory, "review-log.jsonl"), `${JSON.stringify({ run_id: "rev_test", report_sha256: digest })}\n`);
    const prepared = prepareDraft(context.directory, reportWithActions, digest);
    const staleReport = { ...reportWithActions, run_id: "rev_stale", governor_actions: { ...actionsA, run_id: "rev_stale" } };
    const staleDigest = "f".repeat(64);
    fs.mkdirSync(path.join(context.directory, "pending"), { recursive: true });
    fs.writeFileSync(path.join(context.directory, "pending", "rev_stale.json"), JSON.stringify({ ...decisionDraft(staleReport, staleDigest), report_sha256: "e".repeat(64) }));
    try { prepareDraft(context.directory, staleReport, staleDigest); }
    catch { tests.stale_existing_draft_is_rejected = true; }
    const invalid = JSON.parse(JSON.stringify(prepared.draft));
    invalid.decisions.pop();
    invalid.final_checks = [{ kind: "test", outcome: "pass", evidence: "suite" }];
    let rejected = false;
    try { validateDecisionDocument(reportWithActions, digest, invalid); } catch { rejected = true; }
    const valid = JSON.parse(JSON.stringify(prepared.draft));
    valid.decisions = valid.decisions.map((decision) => decision.kind === "finding"
      ? { ...decision, disposition: "fixed", reason: "fixed", reproduction: { method: "test", outcome: "reproduced", evidence: "failed before" }, verification: [{ kind: "test", outcome: "pass", evidence: "passes after" }] }
      : { ...decision, claim_type: "other", disposition: "rejected", reason: "out of scope", verification: [] });
    valid.final_checks = [{ kind: "test", outcome: "pass", evidence: "full suite" }];
    const validPath = path.join(root, "valid.json"); fs.writeFileSync(validPath, JSON.stringify(valid));
    const before = sha256(fs.readFileSync(path.join(context.directory, "reports", "rev_test.json")));
    finalizeDraft(context.directory, validPath);
    tests.identical_finalization_is_idempotent = finalizeDraft(context.directory, validPath).already_complete === true;
    const after = sha256(fs.readFileSync(path.join(context.directory, "reports", "rev_test.json")));
    tests.exact_set_and_digest_are_enforced = rejected && before === after && completionStatus(context.directory, "rev_test").state === "complete_clean";

    const archiveSample = {
      report_schema: "momm-report/1", run_id: "rev_archive_race", governor: "codex",
      reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [], suggested_improvements: [] }],
      findings: [],
    };
    archiveSample.governor_actions = deriveGovernorActions(archiveSample);
    const archiveRaw = `${JSON.stringify(archiveSample, null, 2)}\n`, archiveDigest = sha256(Buffer.from(archiveRaw));
    fs.writeFileSync(path.join(context.directory, "reports", "rev_archive_race.json"), archiveRaw);
    appendReviewLogEntry(context.directory, { run_id: "rev_archive_race", report_sha256: archiveDigest });
    const archivePrepared = prepareDraft(context.directory, archiveSample, archiveDigest);
    archivePrepared.draft.final_checks = [{ kind: "test", outcome: "pass", evidence: "archive race fixture" }];
    const archiveValidatedRaw = `${JSON.stringify(archivePrepared.draft, null, 2)}\n`;
    fs.writeFileSync(archivePrepared.path, archiveValidatedRaw);
    const originalRename = fs.renameSync;
    try {
      fs.renameSync = function renameWithExternalEdit(source, target) {
        if (path.resolve(source) === path.resolve(archivePrepared.path)) {
          fs.writeFileSync(source, `${JSON.stringify({ ...archivePrepared.draft, external_edit: "raced" }, null, 2)}\n`);
        }
        return originalRename.call(this, source, target);
      };
      const archiveResult = finalizeDraft(context.directory, archivePrepared.path);
      tests.validated_draft_archive_is_immune_to_external_edit_race = fs.readFileSync(archiveResult.archived_draft_path, "utf8") === archiveValidatedRaw
        && archiveResult.draft_archive_error?.includes("raced editor copy was preserved separately") === true;
    } finally { fs.renameSync = originalRename; }

    const reportedArchiveSample = {
      report_schema: "momm-report/1", run_id: "rev_archive_reported", governor: "codex",
      reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [], suggested_improvements: [] }],
      findings: [],
    };
    reportedArchiveSample.governor_actions = deriveGovernorActions(reportedArchiveSample);
    const reportedArchiveRaw = `${JSON.stringify(reportedArchiveSample, null, 2)}\n`, reportedArchiveDigest = sha256(Buffer.from(reportedArchiveRaw));
    fs.writeFileSync(path.join(context.directory, "reports", "rev_archive_reported.json"), reportedArchiveRaw);
    appendReviewLogEntry(context.directory, { run_id: "rev_archive_reported", report_sha256: reportedArchiveDigest });
    const reportedArchivePrepared = prepareDraft(context.directory, reportedArchiveSample, reportedArchiveDigest);
    reportedArchivePrepared.draft.final_checks = [{ kind: "test", outcome: "pass", evidence: "post-write archive fixture" }];
    fs.writeFileSync(reportedArchivePrepared.path, `${JSON.stringify(reportedArchivePrepared.draft, null, 2)}\n`);
    const preexistingSubmitted = path.join(context.directory, "completed-drafts", "rev_archive_reported.submitted.json");
    fs.mkdirSync(path.dirname(preexistingSubmitted), { recursive: true });
    fs.writeFileSync(preexistingSubmitted, "{}\n");
    const reportedArchiveResult = finalizeDraft(context.directory, reportedArchivePrepared.path);
    tests.archive_path_survives_post_write_failure = reportedArchiveResult.archived_draft_path === path.join(context.directory, "completed-drafts", "rev_archive_reported.json")
      && fs.existsSync(reportedArchiveResult.archived_draft_path)
      && /submitted draft preservation file already exists/.test(reportedArchiveResult.draft_archive_error ?? "");

    const longArchiveSample = {
      report_schema: "momm-report/1", run_id: "rev_archive_long_error", governor: "codex",
      reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [], suggested_improvements: [] }],
      findings: [],
    };
    longArchiveSample.governor_actions = deriveGovernorActions(longArchiveSample);
    const longArchiveRaw = `${JSON.stringify(longArchiveSample, null, 2)}\n`, longArchiveDigest = sha256(Buffer.from(longArchiveRaw));
    fs.writeFileSync(path.join(context.directory, "reports", "rev_archive_long_error.json"), longArchiveRaw);
    appendReviewLogEntry(context.directory, { run_id: "rev_archive_long_error", report_sha256: longArchiveDigest });
    const longArchivePrepared = prepareDraft(context.directory, longArchiveSample, longArchiveDigest);
    longArchivePrepared.draft.final_checks = [{ kind: "test", outcome: "pass", evidence: "long diagnostic fixture" }];
    fs.writeFileSync(longArchivePrepared.path, `${JSON.stringify(longArchivePrepared.draft, null, 2)}\n`);
    const originalMkdirForLongArchive = fs.mkdirSync;
    let longArchiveResult = null;
    try {
      fs.mkdirSync = function failArchiveWithLongDiagnostic(target, options) {
        if (path.resolve(target) === path.resolve(path.join(context.directory, "completed-drafts"))) throw new Error(`archive failure ${"x".repeat(TEXT_LIMIT + 500)}`);
        return originalMkdirForLongArchive.call(this, target, options);
      };
      try { longArchiveResult = finalizeDraft(context.directory, longArchivePrepared.path); } catch {}
    } finally { fs.mkdirSync = originalMkdirForLongArchive; }
    tests.long_archive_failure_remains_structured = Boolean(longArchiveResult?.completion)
      && typeof longArchiveResult.draft_archive_error === "string"
      && longArchiveResult.draft_archive_error.length <= TEXT_LIMIT
      && completionStatus(context.directory, "rev_archive_long_error").state === "complete_no_action";

    const editSample = {
      report_schema: "momm-report/1", run_id: "rev_draft_edit", governor: "codex",
      reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [], suggested_improvements: [] }],
      findings: [],
    };
    editSample.governor_actions = deriveGovernorActions(editSample);
    const editRaw = `${JSON.stringify(editSample, null, 2)}\n`, editDigest = sha256(Buffer.from(editRaw));
    fs.writeFileSync(path.join(context.directory, "reports", "rev_draft_edit.json"), editRaw);
    appendReviewLogEntry(context.directory, { run_id: "rev_draft_edit", report_sha256: editDigest });
    const editPrepared = prepareDraft(context.directory, editSample, editDigest);
    editPrepared.draft.final_checks = [{ kind: "test", outcome: "pass", evidence: "draft edit fixture" }];
    fs.writeFileSync(editPrepared.path, `${JSON.stringify(editPrepared.draft, null, 2)}\n`);
    const originalMkdirForEdit = fs.mkdirSync;
    let injectedDraftEdit = false;
    let draftEditError = "";
    try {
      fs.mkdirSync = function editWhileAcquiring(target, options) {
        const result = originalMkdirForEdit.call(this, target, options);
        if (!injectedDraftEdit && path.resolve(target) === path.resolve(path.join(context.directory, ".locks", "runs", "rev_draft_edit.lock"))) {
          injectedDraftEdit = true;
          fs.writeFileSync(editPrepared.path, `${JSON.stringify({ ...editPrepared.draft, external_edit: true }, null, 2)}\n`);
        }
        return result;
      };
      try { finalizeDraft(context.directory, editPrepared.path); }
      catch (error) {
        draftEditError = error.message;
        tests.draft_edit_while_acquiring_lock_is_rejected = injectedDraftEdit && /changed while finalization was acquiring its lock/.test(error.message);
      }
    } finally { fs.mkdirSync = originalMkdirForEdit; }
    if (!tests.draft_edit_while_acquiring_lock_is_rejected) {
      process.stderr.write(`draft edit probe failed: ${JSON.stringify({ injectedDraftEdit, draftEditError })}\n`);
    }

    const orderSample = {
      report_schema: "momm-report/1", run_id: "rev_lock_order", governor: "codex",
      reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", findings: [], suggested_improvements: [] }],
      findings: [],
    };
    orderSample.governor_actions = deriveGovernorActions(orderSample);
    const orderRaw = `${JSON.stringify(orderSample, null, 2)}\n`, orderDigest = sha256(Buffer.from(orderRaw));
    fs.writeFileSync(path.join(context.directory, "reports", "rev_lock_order.json"), orderRaw);
    appendReviewLogEntry(context.directory, { run_id: "rev_lock_order", report_sha256: orderDigest });
    const orderPrepared = prepareDraft(context.directory, orderSample, orderDigest);
    orderPrepared.draft.final_checks = [{ kind: "test", outcome: "pass", evidence: "lock order fixture" }];
    fs.writeFileSync(orderPrepared.path, `${JSON.stringify(orderPrepared.draft, null, 2)}\n`);
    const originalMkdirForOrder = fs.mkdirSync;
    const lockOrder = [];
    try {
      fs.mkdirSync = function recordLockOrder(target, options) {
        const resolved = path.resolve(target);
        if (resolved === path.resolve(path.join(context.directory, ".locks", "runs", "rev_lock_order.lock"))) lockOrder.push("run");
        if (resolved === path.resolve(path.join(context.directory, ".locks", "review-log.lock"))) lockOrder.push("log");
        return originalMkdirForOrder.call(this, target, options);
      };
      finalizeDraft(context.directory, orderPrepared.path);
    } finally { fs.mkdirSync = originalMkdirForOrder; }
    tests.finalization_acquires_run_lock_before_log_lock = lockOrder[0] === "run" && lockOrder.includes("log")
      && lockOrder.indexOf("run") < lockOrder.indexOf("log");

    const logPath = path.join(context.directory, "review-log.jsonl");
    const anchoredLog = fs.readFileSync(logPath, "utf8");
    fs.writeFileSync(logPath, anchoredLog.split(/\r?\n/).filter((line) => {
      if (!line) return false;
      try { const row = JSON.parse(line); return !(row.event === "review_completed" && row.run_id === "rev_test"); } catch { return true; }
    }).join("\n") + "\n");
    tests.completion_requires_matching_log_anchor = completionStatus(context.directory, "rev_test").state === "invalid";
    fs.writeFileSync(logPath, anchoredLog);
    const completeDirectory = path.join(context.directory, "completions", "rev_test");
    const hiddenDirectory = `${completeDirectory}.hidden`;
    fs.renameSync(completeDirectory, hiddenDirectory);
    tests.logged_completion_with_missing_sidecar_is_invalid = completionStatus(context.directory, "rev_test").state === "invalid";
    fs.renameSync(hiddenDirectory, completeDirectory);
    fs.appendFileSync(logPath, "{torn");
    const degraded = completionStatus(context.directory, "rev_test");
    const recovery = appendReviewLogEntry(context.directory, { event: "self_test_note", run_id: "rev_test" });
    const repaired = completionStatus(context.directory, "rev_test");
    tests.trailing_crash_tail_is_tolerated_and_repaired = degraded.state === "complete_clean" && degraded.log_degraded_tail === true
      && recovery.recovered_tail_path && fs.existsSync(recovery.recovered_tail_path) && repaired.state === "complete_clean" && repaired.log_degraded_tail === false;
    const beforeCorruption = fs.readFileSync(logPath, "utf8");
    fs.appendFileSync(logPath, "{interior-corruption}\n");
    tests.interior_log_corruption_fails_closed = completionStatus(context.directory, "rev_test").state === "invalid";
    fs.writeFileSync(logPath, beforeCorruption);
    const openSample = { ...sample, run_id: "rev_open", governor_actions: { ...actionsA, run_id: "rev_open" } };
    const openRaw = `${JSON.stringify(openSample, null, 2)}\n`, openDigest = sha256(Buffer.from(openRaw));
    fs.writeFileSync(path.join(context.directory, "reports", "rev_open.json"), openRaw);
    fs.appendFileSync(path.join(context.directory, "review-log.jsonl"), `${JSON.stringify({ run_id: "rev_open", report_sha256: openDigest })}\n`);
    const openDraft = decisionDraft(openSample, openDigest);
    openDraft.decisions = openDraft.decisions.map((decision) => decision.kind === "finding"
      ? { ...decision, disposition: "accepted_open", reason: "deferred", reproduction: { method: "test", outcome: "reproduced", evidence: "fails" }, verification: [] }
      : { ...decision, claim_type: "other", disposition: "rejected", reason: "out of scope", verification: [] });
    openDraft.final_checks = [{ kind: "test", outcome: "pass", evidence: "unrelated suite" }];
    const openPath = path.join(root, "open.json"); fs.writeFileSync(openPath, JSON.stringify(openDraft));
    finalizeDraft(context.directory, openPath);
    tests.complete_and_open_states_are_distinct = completionStatus(context.directory, "rev_open").state === "complete_with_open_findings";
    const collisionSample = {
      report_schema: "momm-report/1", run_id: "review-log", governor: "codex",
      reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "success", suggested_improvements: [], findings: [] }],
      findings: [],
    };
    collisionSample.governor_actions = deriveGovernorActions(collisionSample);
    const collisionRaw = `${JSON.stringify(collisionSample, null, 2)}\n`, collisionDigest = sha256(Buffer.from(collisionRaw));
    fs.writeFileSync(path.join(context.directory, "reports", "review-log.json"), collisionRaw);
    appendReviewLogEntry(context.directory, { run_id: "review-log", report_sha256: collisionDigest });
    const collisionDraft = decisionDraft(collisionSample, collisionDigest);
    collisionDraft.final_checks = [{ kind: "test", outcome: "pass", evidence: "full suite" }];
    const collisionPath = path.join(root, "review-log-decision.json"); fs.writeFileSync(collisionPath, JSON.stringify(collisionDraft));
    finalizeDraft(context.directory, collisionPath);
    tests.run_id_cannot_collide_with_global_log_lock = completionStatus(context.directory, "review-log").state === "complete_no_action"
      && !fs.existsSync(path.join(context.directory, ".locks", "review-log.lock"));

    const releaseRelative = path.join(".locks", "release-race.lock");
    const releaseLock = path.join(context.directory, releaseRelative);
    const originalRemoveForRelease = fs.rmSync;
    let releaseOwnerEntered = false;
    let replacementRejectedBeforeRemove = false;
    let releaseHookUsed = false;
    try {
      fs.rmSync = function probeReleaseWindow(target, options) {
        if (!releaseHookUsed && path.resolve(target) === path.resolve(releaseLock)) {
          releaseHookUsed = true;
          try { withEvidenceLock(context.directory, releaseRelative, "release race fixture", () => {}); }
          catch (error) { replacementRejectedBeforeRemove = /already in progress/.test(error.message); }
        }
        return originalRemoveForRelease.call(this, target, options);
      };
      withEvidenceLock(context.directory, releaseRelative, "release race fixture", () => { releaseOwnerEntered = true; });
    } finally { fs.rmSync = originalRemoveForRelease; }
    tests.release_blocks_replacement_until_canonical_remove = releaseOwnerEntered && releaseHookUsed
      && replacementRejectedBeforeRemove && !fs.existsSync(releaseLock);

    const changedOwnerRelative = path.join(".locks", "changed-owner.lock");
    const changedOwnerHandle = acquireEvidenceLock(context.directory, changedOwnerRelative, "changed owner fixture");
    const changedOwnerPath = path.join(changedOwnerHandle.lockDirectory, "owner.json");
    const changedOwner = readBoundedJson(changedOwnerPath, "changed owner fixture", MAX_OWNER_BYTES).value;
    fs.writeFileSync(changedOwnerPath, `${JSON.stringify({ ...changedOwner, token: "replacement" })}\n`);
    try { releaseEvidenceLock(context.directory, changedOwnerHandle, "changed owner fixture"); }
    catch (error) { tests.release_rejects_changed_owner_token = /ownership changed/.test(error.message) && fs.existsSync(changedOwnerHandle.lockDirectory); }
    fs.rmSync(changedOwnerHandle.lockDirectory, { recursive: true, force: true });

    const parallelLock = await parallelStaleLockProbe(context.directory);
    tests.parallel_stale_lock_recovery_never_overlaps_owners = parallelLock.entered >= 1
      && parallelLock.entered + parallelLock.rejected === 8
      && parallelLock.max_concurrent === 1
      && parallelLock.unexpected_errors.length === 0
      && parallelLock.lock_exists === false;
    if (!tests.parallel_stale_lock_recovery_never_overlaps_owners) {
      process.stderr.write(`parallel stale-lock probe failed: ${JSON.stringify(parallelLock)}\n`);
    }

    const staleFixtureTime = new Date(Date.now() - LOCK_STALE_MS - 60_000);
    const staleOwner = { schema: LOCK_SCHEMA, token: "dead", pid: 2_147_483_647, hostname: os.hostname(), created_at: "2000-01-01T00:00:00.000Z" };
    const makeStaleLock = (name, ownerValue = staleOwner) => {
      const lock = path.join(context.directory, ".locks", name);
      fs.mkdirSync(lock, { recursive: true, mode: PRIVATE_DIR_MODE });
      if (ownerValue) fs.writeFileSync(path.join(lock, "owner.json"), `${JSON.stringify(ownerValue)}\n`);
      fs.utimesSync(lock, staleFixtureTime, staleFixtureTime);
      return lock;
    };

    const delayedLock = makeStaleLock("delayed.lock");
    const originalRenameForDelay = fs.renameSync;
    let delayedRenameBlocked = false;
    let replacementStayedOwned = false;
    let outerEntered = false;
    let delayHookActive = true;
    try {
      fs.renameSync = function interleaveDelayedContender(source, target) {
        if (delayHookActive && path.resolve(source) === path.resolve(delayedLock)) {
          delayHookActive = false;
          withEvidenceLock(context.directory, path.join(".locks", "delayed.lock"), "delayed fixture", () => {
            const beforeOwner = fs.readFileSync(path.join(delayedLock, "owner.json"), "utf8");
            try { originalRenameForDelay.call(this, delayedLock, target); }
            catch { delayedRenameBlocked = true; }
            replacementStayedOwned = fs.existsSync(delayedLock)
              && fs.readFileSync(path.join(delayedLock, "owner.json"), "utf8") === beforeOwner;
          });
        }
        return originalRenameForDelay.call(this, source, target);
      };
      withEvidenceLock(context.directory, path.join(".locks", "delayed.lock"), "delayed fixture", () => { outerEntered = true; });
    } finally { fs.renameSync = originalRenameForDelay; }
    const delayedTomb = fs.readdirSync(path.join(context.directory, ".locks")).find((entry) => entry.startsWith("delayed.lock.reclaimed-"));
    tests.retained_tombstone_blocks_delayed_contender = delayedRenameBlocked && replacementStayedOwned && outerEntered
      && Boolean(delayedTomb) && fs.statSync(path.join(context.directory, ".locks", delayedTomb)).isDirectory();

    const crashLock = makeStaleLock("crash-after-tomb.lock");
    const originalMkdirForCrash = fs.mkdirSync;
    const originalRenameForCrash = fs.renameSync;
    let tombMoved = false;
    let injectedCrash = false;
    try {
      fs.renameSync = function observeTombMove(source, target) {
        const result = originalRenameForCrash.call(this, source, target);
        if (path.resolve(source) === path.resolve(crashLock)) tombMoved = true;
        return result;
      };
      fs.mkdirSync = function crashBeforeReplacement(target, options) {
        if (tombMoved && !injectedCrash && path.resolve(target) === path.resolve(crashLock)) {
          injectedCrash = true;
          throw Object.assign(new Error("simulated crash after tombstone"), { code: "EIO" });
        }
        return originalMkdirForCrash.call(this, target, options);
      };
      try { withEvidenceLock(context.directory, path.join(".locks", "crash-after-tomb.lock"), "crash tomb fixture", () => {}); } catch {}
    } finally { fs.mkdirSync = originalMkdirForCrash; fs.renameSync = originalRenameForCrash; }
    let recoveredAfterTomb = false;
    withEvidenceLock(context.directory, path.join(".locks", "crash-after-tomb.lock"), "crash tomb fixture", () => { recoveredAfterTomb = true; });
    tests.crash_after_tombstone_is_recoverable = tombMoved && injectedCrash && recoveredAfterTomb
      && fs.readdirSync(path.join(context.directory, ".locks")).some((entry) => entry.startsWith("crash-after-tomb.lock.reclaimed-"));

    const ownerlessLock = makeStaleLock("ownerless.lock", null);
    try { withEvidenceLock(context.directory, path.join(".locks", "ownerless.lock"), "ownerless fixture", () => {}); }
    catch (error) { tests.ownerless_stale_lock_fails_closed = /no valid owner metadata/.test(error.message) && fs.existsSync(ownerlessLock); }

    const foreignLock = makeStaleLock("foreign-host.lock", { ...staleOwner, hostname: "remote-review-host" });
    try { withEvidenceLock(context.directory, path.join(".locks", "foreign-host.lock"), "foreign host fixture", () => {}); }
    catch (error) {
      tests.foreign_host_lock_has_manual_recovery_message = /recorded on host remote-review-host/.test(error.message)
        && /remove this lock manually/.test(error.message) && fs.existsSync(foreignLock);
    }

    const mismatchLock = makeStaleLock("mismatch.lock");
    const mismatchObserved = lockGeneration(context.directory, path.join(".locks", "mismatch.lock"));
    const mismatchTomb = `${mismatchLock}.reclaimed-${mismatchObserved.fingerprint}`;
    fs.mkdirSync(mismatchTomb, { recursive: true });
    fs.writeFileSync(path.join(mismatchTomb, "owner.json"), `${JSON.stringify({ ...staleOwner, token: "different" })}\n`);
    try { withEvidenceLock(context.directory, path.join(".locks", "mismatch.lock"), "mismatch fixture", () => {}); }
    catch (error) {
      tests.mismatched_tombstone_fails_closed = fs.existsSync(mismatchLock)
        && /tombstone does not match/.test(error.message)
        && /remove it manually/.test(error.message);
    }
    const tombstoneStatus = statusWithLedger(context.directory, { run_id: "rev_tombstone_probe", state: "pending", complete: false }, { rebuild: false, protectionStatus: protection.status, ephemeralHint: context.ephemeral });
    tests.retained_tombstone_count_is_visible = Number.isSafeInteger(tombstoneStatus.retained_lock_tombstones)
      && tombstoneStatus.retained_lock_tombstones >= 2;

    const originalMkdirForRelease = fs.mkdirSync;
    let injectedReleaseWindow = false;
    let releaseWindowEntered = false;
    try {
      fs.mkdirSync = function injectReleasedHolder(target, options) {
        if (!injectedReleaseWindow && String(target).endsWith(path.join(".locks", "release-window.lock"))) {
          injectedReleaseWindow = true;
          throw Object.assign(new Error("simulated EEXIST followed by release"), { code: "EEXIST" });
        }
        return originalMkdirForRelease.call(this, target, options);
      };
      withEvidenceLock(context.directory, path.join(".locks", "release-window.lock"), "release window fixture", () => { releaseWindowEntered = true; });
    } finally { fs.mkdirSync = originalMkdirForRelease; }
    tests.eexist_release_window_retries_acquisition = injectedReleaseWindow && releaseWindowEntered
      && !fs.existsSync(path.join(context.directory, ".locks", "release-window.lock"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const passed = Object.values(tests).every((value) => value === true);
  process.stdout.write(`${JSON.stringify({ passed, total: Object.keys(tests).length, tests }, null, 2)}\n`);
  return passed ? 0 : 1;
}

async function cli() {
  const options = parseCli(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: node <absolute-momm-skill-root>/scripts/review-completion.mjs (--prepare <run_id> | --finalize <draft.json> | --status <run_id> | --self-test) [--evidence-dir <dir>] [--pretty]\n--self-test writes {passed,total,tests} JSON to stdout and exits 0 only when every check passes.\n");
    return 0;
  }
  if (options.selfTest) return selfTest();
  const context = resolveEvidenceContext({ evidenceDir: options.evidenceDir });
  assertSafeEvidencePath(context.directory);
  ensureEvidenceZone(context, { create: false });
  const protection = protectEvidenceFromGit(context);
  if (protection.status === "unavailable") {
    const privacyError = protection.error || "local exclusion failed";
    // Status is a diagnostic gate as well as a success gate. Preserve the
    // cryptographically validated run state even when the privacy layer later
    // becomes unwritable, but withhold the ledger link and exit nonzero.
    if (options.status) {
      const status = statusWithLedger(context.directory, completionStatus(context.directory, options.status), { rebuild: false, privacyError, protectionStatus: protection.status, ephemeralHint: context.ephemeral });
      process.stdout.write(`${JSON.stringify(status, null, options.pretty ? 2 : 0)}\n`);
      return 1;
    }
    throw new Error(`private evidence is not protected from Git: ${privacyError}`);
  }
  ensureEvidenceZone(context);
  if (options.prepare) {
    const current = completionStatus(context.directory, options.prepare);
    if (current.complete || current.state === "blocked_peer_gate" || current.state === "invalid" || current.state === "legacy_unverifiable") {
      const output = statusWithLedger(context.directory, current, { protectionStatus: protection.status, ephemeralHint: context.ephemeral });
      process.stdout.write(`${JSON.stringify(output, null, options.pretty ? 2 : 0)}\n`);
      return current.complete ? output.status_gate_passed ? 0 : 1 : current.state === "legacy_unverifiable" ? 4 : 5;
    }
    const result = readRun(context.directory, options.prepare);
    const output = statusWithLedger(context.directory, { ...current, draft_path: result.prepared.path, draft_url: toFileUrl(result.prepared.path), report_sha256: result.digest }, { protectionStatus: protection.status, ephemeralHint: context.ephemeral });
    process.stdout.write(`${JSON.stringify(output, null, options.pretty ? 2 : 0)}\n`);
    return 0;
  }
  if (options.finalize) {
    const result = finalizeDraft(context.directory, path.resolve(options.finalize));
    const status = statusWithLedger(context.directory, completionStatus(context.directory, result.completion.run_id), { protectionStatus: protection.status, ephemeralHint: context.ephemeral });
    process.stdout.write(`${JSON.stringify({ ...status, completion_path: result.path, archived_draft_path: result.archived_draft_path, draft_archive_error: result.draft_archive_error }, null, options.pretty ? 2 : 0)}\n`);
    if (!status.complete) return 5;
    return status.ledger_rebuilt ? 0 : 1;
  }
  const status = statusWithLedger(context.directory, completionStatus(context.directory, options.status), { protectionStatus: protection.status, ephemeralHint: context.ephemeral });
  process.stdout.write(`${JSON.stringify(status, null, options.pretty ? 2 : 0)}\n`);
  return status.complete ? status.ledger_available ? 0 : 1 : status.state === "pending" || status.state === "legacy_unverifiable" ? 4 : 5;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  cli().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = 1;
  });
}
