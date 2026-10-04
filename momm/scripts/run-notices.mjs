// MOMM 1.17.1 S3 and S4 — two notices a review adds to its report and prints on stderr.
// They are notices only: nothing is routed, refused or retried on them, and the review runs as before.
//
// S3. A route that returned the same non-success status in its last three recorded runs in this
//     project is named with the status, since when, and the likely class. Until now each such run
//     read like a first failure.
// S4. A diff file passed as --input is itself the reviewed source, so findings that cite project
//     files can never receive a completion receipt from that run. A gate review fed that way learned
//     it only at completion; --range binds the report to the two commits instead.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveGit } from "./governor.mjs";
// Windows launch guard (see launch-guard.mjs): a bare command launched without a shell is looked up in
// THIS process's current directory before PATH unless this process carries the variable. Kept inline so
// a script copied on its own still runs.
if (process.platform === "win32" && !process.env.NoDefaultCurrentDirectoryInExePath) process.env.NoDefaultCurrentDirectoryInExePath = "1";

export const REPEATED_STATUS_RUNS = 3;
const LOG_TAIL_BYTES = 1024 * 1024;
// Rows that say a route was not asked; they neither add to a run of failures nor end it.
const NOT_RUN = new Set(["self_excluded", "not_dispatched"]);
// Only plain names are ever echoed: the log is a file on disk, and a notice reaches a terminal.
const PLAIN_NAME = /^[a-z][a-z0-9_-]{0,39}$/;
// The likely class per status, with the next action. An unknown status is still named.
const STATUS_CLASS = Object.freeze({
  invalid_output: "a CLI output change. Check for a MOMM update and a CLI update",
  quota: "the account allowance. Wait for it to reset or change the plan",
  authentication_required: "the login. Complete the provider's browser login",
  timeout: "the time limit. Narrow the review or raise --timeout",
  provider_unavailable: "a provider outage. Retry later",
  ineligible_tier: "the account tier. Check the plan with the provider",
  missing: "a CLI that is not installed. Run --preflight for the install command",
  unsupported: "the route's adapter or launcher. Run --preflight to see which",
  error: "a CLI error. Read the route's detail in the report and run --preflight",
  cancelled: "reviews that were cancelled. Let one finish",
});

// The end of the review log, whole lines only. A missing or unreadable log is an empty history.
function logTail(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, "r");
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return "";
    const start = Math.max(0, stat.size - LOG_TAIL_BYTES), buffer = Buffer.alloc(stat.size - start);
    let offset = 0;
    while (offset < buffer.length) { const read = fs.readSync(fd, buffer, offset, buffer.length - offset, start + offset); if (!read) break; offset += read; }
    const text = buffer.subarray(0, offset).toString("utf8");
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } catch { return ""; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* read-only handle */ } } }
}

// `dir` is the project's evidence folder as the evidence resolver gave it; `results` are this run's
// rows, one per route. This run is not in the log yet, so it counts as the newest recorded run.
export function repeatedStatusNotices({ dir, results = [], governor = null, runs = REPEATED_STATUS_RUNS } = {}) {
  const current = results.filter((r) => r && r.agent !== governor && PLAIN_NAME.test(String(r.agent)) && PLAIN_NAME.test(String(r.status)) && r.status !== "success" && !NOT_RUN.has(r.status));
  if (!current.length || typeof dir !== "string") return [];
  const history = [];
  for (const line of logTail(path.join(dir, "review-log.jsonl")).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    // Second-look rows carry `event`; only review rows hold one status per route.
    if (!row || typeof row !== "object" || Array.isArray(row) || row.event || !row.reviewer_status || typeof row.reviewer_status !== "object" || Array.isArray(row.reviewer_status)) continue;
    history.push(row);
  }
  const notices = [];
  for (const { agent, status } of current) {
    let count = 1, since = null;
    for (let i = history.length - 1; i >= 0; i--) {
      const earlier = Object.hasOwn(history[i].reviewer_status, agent) ? history[i].reviewer_status[agent] : undefined;
      if (earlier === undefined || NOT_RUN.has(earlier)) continue;
      if (earlier !== status) break;
      count += 1;
      if (typeof history[i].timestamp === "string" && Number.isFinite(Date.parse(history[i].timestamp))) since = new Date(Date.parse(history[i].timestamp)).toISOString();
    }
    if (count < runs) continue;
    notices.push(`${agent} returned ${status} in its last ${count} recorded runs in this project${since ? `, since ${since}` : ""}. ${STATUS_CLASS[status] ? `Likely cause: ${STATUS_CLASS[status]}` : "MOMM has no class for this status. Read the route's detail in the report"}. Nothing is routed on this notice.`);
  }
  return notices;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;
// Is this file one Git tracks in the project? Git is the resolved one outside the project (the
// governor's rule); anything that cannot be confirmed reads as not tracked, which only adds a notice.
function trackedProjectFile(root, file) {
  try {
    const real = (p) => (process.platform === "win32" ? fs.realpathSync.native(p) : fs.realpathSync(p));
    const relative = path.relative(real(root), real(file));
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
    const git = resolveGit(root);
    if (!git) return false;
    // --literal-pathspecs: the name is a file name, never pathspec magic.
    return spawnSync(git, ["--literal-pathspecs", "ls-files", "--error-unmatch", "--", relative.replaceAll("\\", "/")], { cwd: real(root), encoding: "utf8", timeout: 10_000, windowsHide: true, maxBuffer: 1_000_000 }).status === 0;
  } catch { return false; }
}

// The notice for --input <diff file>, or null. A tracked file with hunk headers (a vendored patch)
// is a project source file under review and gets none; --range and stdin never reach here.
export function diffInputNotice({ cwd = process.cwd(), input, range = null, artifact = "" } = {}) {
  if (!input || range || !HUNK_HEADER.test(String(artifact))) return null;
  if (trackedProjectFile(cwd, path.resolve(cwd, input))) return null;
  const name = path.basename(String(input)).replace(/[\u0000-\u001f\u007f-\u009f]/g, "?").slice(0, 120);
  return `--input names a diff file (${name}) that is not a tracked project file, so the source snapshot of this run is that diff file itself. Findings that cite project files cannot receive a completion receipt from this run. For a gate review use --range <base>..<head> (add --range-path <path> to limit it).`;
}
