#!/usr/bin/env node
// MOMM installations inventory (1.16.1): "installed somewhere" is not "the version this harness loads".
//
// Read-only. It lists every MOMM copy reachable from a harness discovery folder, where each entry
// points, which version that copy's own source declares, and whether the active entries agree.
// It never imports or executes another copy (that code is not verified by this one): a version is
// READ from the dispatcher source with a strict pattern, and anything else is "unknown".
// It cannot see inside a harness. Where one harness has two discovery folders on different copies,
// precedence is reported as undetermined rather than invented; a fresh harness session is the proof.
//
//   node momm/scripts/installations.mjs [--home <dir>] [--custom-dir <skill-parent>]... [--expect <version>] [--pretty]
//   exit 0: consistent (or nothing installed)   exit 1: conflict, duplicate copies, or --expect not met
//
// No imports from sibling scripts, so a single copied file still runs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The installer's targets (momm/scripts/install.mjs) plus the folders older releases and harness
// migrations used. `documented` marks the ones the installer writes today.
export const DISCOVERY = [
  { harness: "claude", scope: "user", dir: [".claude", "skills"], documented: true },
  { harness: "codex", scope: "user", dir: [".agents", "skills"], documented: true, note: "shared Agent Skills folder; other harnesses may read it too" },
  { harness: "codex", scope: "legacy", dir: [".codex", "skills"], documented: false },
  { harness: "antigravity", scope: "global", dir: [".gemini", "config", "skills"], documented: true },
  { harness: "antigravity", scope: "migration_compatible", dir: [".gemini", "antigravity-cli", "skills"], documented: true },
  { harness: "gemini", scope: "user", dir: [".gemini", "skills"], documented: false },
  { harness: "copilot", scope: "user", dir: [".copilot", "skills"], documented: false },
  { harness: "grok", scope: "user", dir: [".grok", "skills"], documented: false },
];
export const SKILL_NAMES = ["momm", "multi-llm-review"]; // the second is the pre-1.10 name

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const VERSION_LINE = /^[ \t]*(?:export\s+)?const\s+MOMM_VERSION\s*=\s*["']([^"'\r\n]{1,40})["']/m;
// Built from character codes: an editor or tool that expands escapes must not be able to put raw
// control bytes into this source (Git would then treat the file as binary and no review could read it).
const CONTROL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "-" + String.fromCharCode(159) + "]", "g");
const safe = (value) => String(value ?? "").replace(CONTROL, " ").slice(0, 400);

function declaredVersion(skillRoot, files) {
  // Bounded read of the dispatcher source; never import it.
  for (const rel of [["scripts", "multi-review.mjs"]]) {
    const file = path.join(skillRoot, ...rel);
    let fd;
    try {
      // A named pipe or device would block openSync for as long as nothing writes to it, hanging the
      // whole inventory. statSync follows a symlinked dispatcher, which is a legitimate install, and
      // fstat confirms after the open that what was opened is still a regular file.
      if (!files.statSync(file).isFile()) return null;
      fd = files.openSync(file, "r");
      const stat = files.fstatSync(fd);
      if (!stat.isFile()) return null;
      const size = Math.min(stat.size, 4 << 20), buffer = Buffer.alloc(size);
      // readSync may return fewer bytes than asked for, which would split the declaration across a
      // short read and report the version as unknown. Keep reading until the buffer is full.
      let filled = 0;
      while (filled < size) { const read = files.readSync(fd, buffer, filled, size - filled, filled); if (read <= 0) break; filled += read; }
      const found = VERSION_LINE.exec(buffer.subarray(0, filled).toString("utf8"))?.[1];
      return found && SEMVER.test(found) ? found : null;
    } catch { /* unreadable: unknown */ }
    finally { if (fd !== undefined) try { files.closeSync(fd); } catch { /* nothing to do */ } }
  }
  return null;
}

function inspectEntry(at, files) {
  let stat;
  try { stat = files.lstatSync(at); } catch (error) {
    if (error.code === "ENOENT") return null;
    // A denied or malformed discovery path is unknown, not evidence of absence.
    return { kind: "unreadable", link_target: null, resolved: null, version: null, has_skill_md: false };
  }
  const isLink = stat.isSymbolicLink();
  let resolved = null, target = null;
  if (isLink) { try { target = String(files.readlinkSync(at)); } catch { /* keep null */ } }
  try { resolved = String((files.realpathSync.native ?? files.realpathSync)(at)); } catch { /* broken */ }
  if (!resolved) return { kind: isLink ? "broken_link" : "unreadable", link_target: target ? safe(target) : null, resolved: null, version: null, has_skill_md: false };
  let isDir = false; try { isDir = files.statSync(resolved).isDirectory(); } catch { /* not a directory */ }
  if (!isDir) return { kind: "not_a_directory", link_target: target ? safe(target) : null, resolved, version: null, has_skill_md: false };
  let hasSkill = false; try { hasSkill = files.statSync(path.join(resolved, "SKILL.md")).isFile(); } catch { /* absent */ }
  return { kind: isLink ? "link" : "directory", link_target: target ? safe(target) : null, resolved, version: declaredVersion(resolved, files), has_skill_md: hasSkill };
}

const key = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const usable = (e) => (e.kind === "link" || e.kind === "directory") && e.has_skill_md === true;

export function inventory({ home = os.homedir(), customDirs = [], runningSkillRoot = null, fs: files = fs } = {}) {
  const places = [
    ...DISCOVERY.map((d) => ({ ...d, folder: path.join(home, ...d.dir) })),
    ...customDirs.map((folder) => ({ harness: "custom", scope: "custom", folder: path.resolve(folder), documented: false })),
  ];
  const entries = [];
  for (const place of places) for (const name of SKILL_NAMES) {
    const at = path.join(place.folder, name), found = inspectEntry(at, files);
    if (found) entries.push({ harness: place.harness, scope: place.scope, documented: place.documented, name, path: at, ...found });
  }

  // Distinct physical copies, by resolved location.
  const byCopy = new Map();
  for (const e of entries.filter(usable)) {
    const k = key(e.resolved);
    if (!byCopy.has(k)) byCopy.set(k, { resolved: e.resolved, version: e.version, name: path.basename(e.resolved), entries: [] });
    byCopy.get(k).entries.push(e.path);
  }
  const copies = [...byCopy.values()];

  // Per harness: what it would find. One usable entry: that copy. Several on one copy: consistent.
  // Several on different copies, or two skill names side by side: conflict, precedence not invented.
  const harnesses = {};
  for (const harness of [...new Set(entries.map((e) => e.harness))]) {
    const mine = entries.filter((e) => e.harness === harness), live = mine.filter(usable);
    const distinct = [...new Set(live.map((e) => key(e.resolved)))], names = [...new Set(live.map((e) => e.name))];
    let status, loads = null, detail = "";
    if (live.length !== mine.length) { status = "broken"; detail = `${harness} has broken, unreadable or incomplete MOMM entries: ${mine.filter(e => !usable(e)).map((e) => e.path).join(", ")}; its loaded copy cannot be confirmed`; }
    else if (names.length > 1) { status = "conflict"; detail = `${harness} would discover two skills side by side (${names.join(" and ")}); the older name multi-llm-review must be retired or kept only as a rollback backup outside discovery folders`; }
    else if (distinct.length === 1) { status = live.length === 1 ? "single" : "consistent"; loads = { resolved: live[0].resolved, version: live[0].version, via: live.map((e) => e.path) }; }
    else { status = "conflict"; detail = `${harness} has ${live.length} discovery entries on ${distinct.length} different copies (${live.map((e) => `${e.path} -> ${e.version ?? "unknown"}`).join("; ")}); MOMM cannot tell which one the harness prefers`; }
    harnesses[harness] = { status, loads, detail: safe(detail), entries: mine.map((e) => e.path) };
  }

  const live = entries.filter(usable), versions = [...new Set(live.map((e) => e.version ?? "unknown"))].sort();
  const harnessConflict = Object.entries(harnesses).find(([, h]) => h.status === "conflict");
  let verdict;
  if (!entries.length) verdict = { status: "none", consistent: true, versions: [], detail: "No MOMM entry was found in any known harness discovery folder." };
  // A broken entry keeps the fail-closed `broken` status, but it must not HIDE a version conflict:
  // this branch runs before the conflict branch, so a single unreadable leftover used to be the
  // whole story while active paths were quietly loading different versions.
  else if (entries.some(e => !usable(e))) verdict = { status: "broken", consistent: false, versions,
    detail: safe("Some MOMM discovery entries are broken, unreadable or missing SKILL.md. The active installation cannot be confirmed."
      + (harnessConflict || versions.length > 1 ? ` A version conflict is also present among the readable paths: ${live.map((e) => `${e.path} -> ${e.version ?? "unknown"}`).join("; ")}.` : "")) };
  else if (harnessConflict || versions.length > 1) verdict = { status: "conflict", consistent: false, versions, detail: safe(harnessConflict && versions.length <= 1 ? harnessConflict[1].detail : `Active discovery paths load different MOMM versions: ${live.map((e) => `${e.path} -> ${e.version ?? "unknown"}`).join("; ")}.`) };
  else if (versions[0] === "unknown") verdict = { status: "conflict", consistent: false, versions, detail: "The version of the active copy could not be read, so it cannot be confirmed." };
  else if (copies.length > 1) verdict = { status: "duplicate_copies", consistent: false, versions, detail: safe(`${copies.length} separate copies are active on the same version (${copies.map((c) => c.resolved).join("; ")}). They will drift apart at the next upgrade; choose one and keep the others only as rollback backups.`) };
  else verdict = { status: live.length ? "consistent" : "broken", consistent: live.length > 0, versions, detail: live.length ? `Every active discovery path loads MOMM ${versions[0]} from one copy.` : "Every MOMM entry is broken." };

  let running = null;
  if (runningSkillRoot) {
    let real = runningSkillRoot; try { real = String((files.realpathSync.native ?? files.realpathSync)(runningSkillRoot)); } catch { /* keep as given */ }
    const linkedFrom = live.filter((e) => key(e.resolved) === key(real)).map((e) => e.path);
    running = { resolved: real, version: declaredVersion(real, files), linked_from: linkedFrom,
      note: linkedFrom.length ? "This running copy is the one those discovery paths load." : "No harness discovery path points at this running copy: it is installed somewhere, but no harness loads it." };
  }

  return {
    schema: "momm-installations/1", home: safe(home), entries, copies, harnesses, verdict, running,
    caveat: "MOMM reads the folders a harness searches; it cannot see inside the harness. Confirm from a fresh harness session which version is loaded.",
    // An upgrade is complete only when EVERY active discovery path loads the expected version.
    upgrade_complete_for(expected) {
      if (!live.length) return { complete: false, reason: "no active MOMM entry was found" };
      if (!verdict.consistent || entries.some(e => !usable(e))) return { complete: false, reason: `${verdict.detail} Conflicting, duplicate, broken or unreadable entries require owner action.` };
      const behind = live.filter((e) => e.version !== expected);
      return behind.length ? { complete: false, reason: safe(`not every active path loads ${expected}: ${behind.map((e) => `${e.path} -> ${e.version ?? "unknown"}`).join("; ")}`) } : { complete: true, reason: `every active path loads ${expected}` };
    },
  };
}

export function installationCompletion(options = {}) {
  const report = inventory(options);
  const expected = options.expected ?? report.running?.version;
  // Say which of the two cases applies: no running copy was named at all, or one was and its
  // version could not be read. The single old message blamed an unreadable version either way.
  const reason = options.runningSkillRoot || report.running
    ? 'the running copy was found but its declared version could not be read'
    : 'no expected version was given and no running copy was named, so completion cannot be judged';
  return { ...report, expected, upgrade: expected ? report.upgrade_complete_for(expected) : { complete: false, reason } };
}

function parse(args) {
  const out = { home: os.homedir(), customDirs: [], pretty: false, expect: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i], next = () => { const v = args[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === "--home") out.home = path.resolve(next());
    else if (a === "--custom-dir") out.customDirs.push(next());
    else if (a === "--expect") { out.expect = next(); if (!SEMVER.test(out.expect)) throw new Error("--expect needs a version such as 1.16.1"); }
    else if (a === "--pretty") out.pretty = true;
    else throw new Error(`Unknown argument: ${safe(a)}`);
  }
  return out;
}

function entrypoint() { try { return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }
if (entrypoint()) {
  try {
    const options = parse(process.argv.slice(2));
    const runningSkillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const report = inventory({ home: options.home, customDirs: options.customDirs, runningSkillRoot });
    const expectation = options.expect ? report.upgrade_complete_for(options.expect) : null;
    process.stdout.write(JSON.stringify({ ...report, ...(expectation ? { expected: options.expect, upgrade: expectation } : {}) }, null, options.pretty ? 2 : 0) + "\n");
    if (report.verdict.status === "conflict") process.stderr.write(`MOMM installations conflict: ${/different MOMM versions/.test(report.verdict.detail) ? "" : "different MOMM versions or skills are active. "}${report.verdict.detail}\n`);
    else if (report.verdict.status === "duplicate_copies") process.stderr.write(`MOMM installations: ${report.verdict.detail}\n`);
    else if (report.verdict.status === "broken") process.stderr.write(`MOMM installations broken: ${report.verdict.detail}\n`);
    if (expectation && !expectation.complete) process.stderr.write(`Upgrade to ${options.expect} is not complete: ${expectation.reason}\n`);
    if (!report.verdict.consistent || (expectation && !expectation.complete)) process.exitCode = 1;
  } catch (error) { process.stderr.write(JSON.stringify({ error: safe(error.message) }) + "\n"); process.exitCode = 2; }
}
