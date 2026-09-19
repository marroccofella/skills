#!/usr/bin/env node
// Offline evidence validation. Never execute commands from reviewer/decision data.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { requirePrivateEvidence } from "./evidence-permissions.mjs";
// Windows launch guard (see launch-guard.mjs): a bare command launched without a shell is looked up in
// THIS process's current directory before PATH unless this process carries the variable. Kept inline so
// a script copied on its own still runs.
if (process.platform === "win32" && !process.env.NoDefaultCurrentDirectoryInExePath) process.env.NoDefaultCurrentDirectoryInExePath = "1";

export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const hash = s => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const nonempty = s => typeof s === "string" && !!s.trim();
const demand = (ok, message) => { if (!ok) throw new Error(message); };

// Hash a fixed-size read snapshot with bounded memory. A concurrently growing
// log fails this inspection instead of making the reader chase it forever.
function scanFile(file, visit = () => {}) {
  const fd = fs.openSync(file, 'r'), sha = createHash('sha256');
  try {
    const size = fs.fstatSync(fd).size, buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < size) {
      const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
      demand(n > 0, 'evidence changed during read');
      const bytes = buffer.subarray(0, n); sha.update(bytes); visit(bytes); position += n;
    }
    demand(fs.fstatSync(fd).size === size, 'evidence changed during read');
    return sha.digest('hex');
  } finally { fs.closeSync(fd); }
}

// The exact Git invocation a committed range is identified by. The dispatcher uses the same flags when
// it takes the diff itself, so "the diff MOMM reviewed" and "the diff Git gives for that range" are
// comparable byte for byte. --no-renames: a rename is a delete plus an add, never a guessed pairing.
export const RANGE_DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--binary"];
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._\/~^@{}-]{0,199}$/;          // never starts with "-": it cannot be read as an option
const RANGE_PATH = /^[A-Za-z0-9._][A-Za-z0-9._\/ -]{0,399}$/;          // plain relative paths only; no pathspec magic, no options

export function captureSourceSnapshot(root, artifact, inputPath, range = null) {
  const files = [];
  let verifyDiff = null;
  if (range) return captureRangeSnapshot(root, artifact, range);
  // Explicit file input takes precedence over sample diff text inside source.
  const isDiff = !inputPath && /^diff --git /m.test(artifact);
  let names = inputPath ? [path.relative(root, path.resolve(root, inputPath)).replaceAll("\\", "/")] : [];
  try {
    if (isDiff) {
      // Node 18 and 20 on Windows look for a bare name in the child's working directory first (the
      // project under review) and ignore the guard variable, so Git is named by an absolute PATH
      // entry outside the project, or not at all.
      const gitPath = () => {
        if (process.platform !== "win32") return "git";
        const inside = p => { const rel = path.relative(fs.realpathSync.native(root).toLowerCase(), p.toLowerCase()); return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)); };
        const pathValue = Object.entries(process.env ?? {}).find(([k]) => k.toLowerCase() === "path")?.[1] ?? "";
        for (const dir of pathValue.split(";").map(d => d.replace(/^"|"$/g, "")).filter(d => d && path.isAbsolute(d))) {
          const candidate = path.join(dir, "git.exe");
          try { if (fs.statSync(candidate).isFile() && !inside(fs.realpathSync.native(candidate))) return candidate; } catch { /* not here */ }
        }
        return null;
      };
      const gitExecutable = gitPath();
      demand(gitExecutable, "cannot verify current Git diff: git.exe was not found on an absolute PATH entry outside the project");
      const git = args => { const r = spawnSync(gitExecutable, args, { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true, maxBuffer: 2_000_000 }); demand(r.status === 0, "cannot verify current Git diff"); return r.stdout; };
      // Windows JS realpath can preserve an 8.3 spelling while Git returns
      // its long name. Native resolution compares the same physical root.
      const canonical = process.platform === 'win32' ? fs.realpathSync.native : fs.realpathSync;
      demand(path.relative(canonical(git(["rev-parse", "--show-toplevel"]).trim()), canonical(root)) === "",
        "Run the review from the repository root; Git source paths and the private evidence directory must share that root");
      demand(git(["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"]) === artifact, "supplied diff differs from current Git diff HEAD");
      verifyDiff = () => demand(git(["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"]) === artifact, "source changed while collecting the reviewed Git snapshot");
      demand(!/^GIT binary patch|^Binary files /m.test(artifact), "binary diff needs separate verified source scope");
      const fields = git(["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "HEAD"]).split("\0");
      fields.pop(); names = [];
      for (let i = 0; i < fields.length; i += 2) {
        demand(["A", "M"].includes(fields[i]) && fields[i + 1], "deletion/rename/type-change scope needs explicit verification; not silently omitted");
        names.push(fields[i + 1]);
      }
    }
    demand(names.length > 0 && names.length <= 200, "source scope needs local file input or a supported Git diff");
    const base = fs.realpathSync(root);
    for (const name of [...new Set(names)]) {
      demand(!path.isAbsolute(name) && !name.includes(":") && !name.split("/").includes(".."), "source scope escapes project");
      const file = path.join(base, name);
      demand(fs.realpathSync(file).startsWith(base + path.sep) && fs.statSync(file).isFile() && fs.statSync(file).size <= 8_000_000, "source scope is not a bounded local file");
      const bytes = fs.readFileSync(file);
      if (!isDiff) demand(bytes.toString("utf8") === artifact, "input file changed while collecting source snapshot");
      files.push({ path: name, sha256: digest(bytes) });
    }
    // Re-read both the files and Git diff after collection. This detects
    // concurrent edits during capture; it is not an atomic filesystem snapshot.
    for (const file of files) demand(digest(fs.readFileSync(path.join(base, file.path))) === file.sha256, "source changed while collecting snapshot");
    verifyDiff?.();
    return { complete: true, files };
  } catch (error) { return { complete: false, files: [], reason: error.message }; }
}

// A review of a COMMITTED RANGE (1.16.1 A3). Identity is the two full commit ids plus any path
// limits; file hashes are taken from the blobs AT the head commit, so the receipt describes the tree
// that was reviewed even if the working tree has moved on since.
function captureRangeSnapshot(root, artifact, range) {
  try {
    demand(range && typeof range === "object", "range needs a base and a head");
    const paths = range.paths ?? [];
    demand(Array.isArray(paths) && paths.length <= 200 && paths.every(p => typeof p === "string" && RANGE_PATH.test(p) && !p.split("/").includes("..")), "range paths must be plain relative paths");
    for (const name of [range.base, range.head]) demand(typeof name === "string" && REVISION.test(name), "range needs plain revision names (a commit id, a branch or a tag)");
    const gitExecutable = resolveGit(root);
    demand(gitExecutable, "cannot verify the range: git was not found on an absolute PATH entry outside the project");
    const run = (args, encoding = "utf8") => { const r = spawnSync(gitExecutable, args, { cwd: root, encoding, timeout: 30000, windowsHide: true, maxBuffer: 64_000_000 }); demand(r.status === 0, "cannot verify the declared Git range"); return r.stdout; };
    const canonical = process.platform === "win32" ? fs.realpathSync.native : fs.realpathSync;
    demand(path.relative(canonical(run(["rev-parse", "--show-toplevel"]).trim()), canonical(root)) === "",
      "Run the review from the repository root; Git source paths and the private evidence directory must share that root");
    const full = name => { const id = run(["rev-parse", "--verify", "--end-of-options", `${name}^{commit}`]).trim(); demand(/^[0-9a-f]{40,64}$/.test(id), "range revision did not resolve to a commit"); return id; };
    const base = full(range.base), head = full(range.head);
    demand(base !== head, "the range is empty: base and head are the same commit");
    const limit = paths.length ? ["--", ...paths] : ["--"];
    const expected = run(["diff", ...RANGE_DIFF_FLAGS, base, head, ...limit]);
    demand(expected === artifact, "supplied diff differs from git diff for the declared range (same flags, same path limits)");
    demand(artifact.trim().length > 0, "the range has no changes in the named paths");
    demand(!/^GIT binary patch|^Binary files /m.test(artifact), "binary diff needs separate verified source scope");
    const fields = run(["diff", "--no-renames", "--name-status", "-z", base, head, ...limit]).split("\0"); fields.pop();
    const files = [], deleted = [];
    for (let i = 0; i < fields.length; i += 2) {
      const status = fields[i], name = fields[i + 1];
      demand(name && !path.isAbsolute(name) && !name.includes(":") && !name.split("/").includes(".."), "source scope escapes project");
      if (status === "D") { deleted.push(name); continue; }
      demand(["A", "M"].includes(status), "type-change scope needs explicit verification; not silently omitted");
      const bytes = run(["cat-file", "blob", `${head}:${name}`], "buffer");
      demand(bytes.length <= 8_000_000, "source scope is not a bounded file");
      files.push({ path: name, sha256: digest(bytes) });
    }
    demand(files.length + deleted.length > 0 && files.length <= 2000, "source scope needs at least one file and at most 2000");
    demand(files.length > 0, "the range only deletes files; nothing remains at the head commit to bind");
    return { complete: true, kind: "git_range", base, head, paths, flags: RANGE_DIFF_FLAGS, files, deleted };
  } catch (error) { return { complete: false, kind: "git_range", files: [], reason: error.message }; }
}

// Node 18 and 20 on Windows look for a bare name in the child's working directory first (the project
// under review) and ignore the guard variable, so Git is named by an absolute PATH entry outside the
// project, or not at all. Inline because this file is also run as a single copied file.
function resolveGit(root) {
  if (process.platform !== "win32") return "git";
  const inside = p => { const rel = path.relative(fs.realpathSync.native(root).toLowerCase(), p.toLowerCase()); return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)); };
  const pathValue = Object.entries(process.env ?? {}).find(([k]) => k.toLowerCase() === "path")?.[1] ?? "";
  for (const dir of pathValue.split(";").map(d => d.replace(/^"|"$/g, "")).filter(d => d && path.isAbsolute(d))) {
    const candidate = path.join(dir, "git.exe");
    try { if (fs.statSync(candidate).isFile() && !inside(fs.realpathSync.native(candidate))) return candidate; } catch { /* not here */ }
  }
  return null;
}

export function normalizeTarget(value, files, root) {
  if (typeof value !== 'string') return null;
  const raw = value.replaceAll('\\', '/');
  if (files.some(f => f.path === raw)) return raw;
  let candidate = raw.replace(/:\d+(?:-\d+)?(?::\d+)?$/, '');
  if (path.isAbsolute(candidate)) candidate = path.relative(root, candidate).replaceAll('\\', '/');
  if (files.some(f => f.path === candidate)) return candidate;
  if (/^[ab]\//.test(candidate) && files.some(f => f.path === candidate.slice(2))) return candidate.slice(2);
  // Do not guess an external or unreviewed file into the original source scope.
  return raw;
}

export function inspectCompletion(root, runId) {
  const state = { schema: "momm-completion/1", run_id: runId, complete: false,
    evidence_level: "local records and byte hashes validated; not independent proof of execution or correctness",
    items: [], unresolved: [], errors: [] };
  const reads = new Map();
  const logReads = new Set();
  try {
    root = fs.realpathSync(root);
    demand(/^rev_[a-zA-Z0-9_]+$/.test(runId), "invalid run id");
    const local = relative => {
      demand(nonempty(relative) && !relative.includes("\\") && !relative.includes(":") && !path.isAbsolute(relative)
        && relative.split("/").every(p => p && p !== "." && p !== ".."), "unsafe evidence path");
      const absolute = path.resolve(root, relative);
      // Do not follow symlinks/junctions, including intermediate directories.
      let cursor = root;
      for (const part of relative.split("/")) { cursor = path.join(cursor, part); demand(!fs.lstatSync(cursor).isSymbolicLink(), "symlink evidence refused"); }
      demand(fs.realpathSync(absolute).startsWith(root + path.sep), "evidence escapes project");
      demand(fs.statSync(absolute).isFile(), "evidence must be a regular file");
      return absolute;
    };
    const read = relative => {
      const absolute = local(relative);
      demand(fs.statSync(absolute).size <= 8_000_000, "evidence file exceeds 8 MB limit");
      const bytes = fs.readFileSync(absolute);
      reads.set(relative, digest(bytes));
      return bytes;
    };
    const ref = value => { demand(value && hash(value.sha256), "evidence needs a sha256"); const bytes = read(value.path); demand(digest(bytes) === value.sha256, `changed evidence: ${value.path}`); return bytes; };
    const jsonl = relative => {
      const rows = []; let parts = [], lineBytes = 0, selectedBytes = 0;
      const segment = (bytes, end) => {
        lineBytes += bytes.length;
        demand(lineBytes <= 8_000_000, 'ledger record exceeds 8 MB limit');
        if (bytes.length) parts.push(Buffer.from(bytes));
        if (!end) return;
        const line = Buffer.concat(parts, lineBytes).toString('utf8');
        if (line.trim()) {
          const row = JSON.parse(line); // Corrupt unrelated records still fail closed.
          demand(row && typeof row === 'object' && !Array.isArray(row), 'invalid ledger record');
          if (row.run_id === runId) {
            selectedBytes += lineBytes;
            demand(selectedBytes <= 8_000_000, 'run ledger records exceed 8 MB limit');
            rows.push(row);
          }
        }
        parts = []; lineBytes = 0;
      };
      const sha = scanFile(local(relative), bytes => {
        let start = 0;
        for (let end = bytes.indexOf(10); end >= 0; end = bytes.indexOf(10, start)) {
          segment(bytes.subarray(start, end), true); start = end + 1;
        }
        segment(bytes.subarray(start), false);
      });
      segment(Buffer.alloc(0), true);
      reads.set(relative, sha); logReads.add(relative);
      return rows;
    };
    const reportBytes = read(`.ensemble_reviews/reports/${runId}.json`);
    const report = JSON.parse(reportBytes);
    const reportSha = digest(reportBytes);
    state.report_sha256 = reportSha;
    state.input_sha256 = report.input_sha256;
    demand(report.run_id === runId && hash(report.input_sha256), "report identity/input binding missing");
    const entries = jsonl(".ensemble_reviews/review-log.jsonl").filter(r => r.run_id === runId && !r.event);
    demand(entries.length === 1, "expected one original run log record");
    demand(entries[0].report_sha256 === reportSha && entries[0].input_sha256 === report.input_sha256
      && entries[0].report_path === `.ensemble_reviews/reports/${runId}.json`, "original report/log seal mismatch");
    demand(report.governor && Array.isArray(report.reviewers) && Array.isArray(report.findings), "malformed report");
    demand(report.source_snapshot?.complete && report.source_snapshot.files.length > 0, "dispatch-time source snapshot missing; use local --input, a working-tree Git diff, or --range <base>..<head> for a committed range");
    // Source identity travels into the receipt: over WHICH tree, and for a split run WHICH pieces.
    const snapshot = report.source_snapshot;
    state.source = snapshot.kind === "git_range"
      ? { kind: "git_range", base: snapshot.base, head: snapshot.head, paths: snapshot.paths ?? [], files: snapshot.files.length, deleted: snapshot.deleted ?? [] }
      : { kind: snapshot.kind ?? "files_at_dispatch", files: snapshot.files.length };
    if (snapshot.kind === "git_range") demand(/^[0-9a-f]{40,64}$/.test(snapshot.base) && /^[0-9a-f]{40,64}$/.test(snapshot.head), "range snapshot lacks full commit ids");
    if (report.split?.pieces) state.pieces = report.split.pieces.map(p => ({ id: p.id, reviewers: p.reviewers ?? {} }));
    const routes = new Set();
    for (const r of report.reviewers) { demand(!routes.has(r.agent), "duplicate reviewer route"); routes.add(r.agent); }
    const successful = report.reviewers.filter(r => r.agent !== report.governor && r.status === "success");
    demand(successful.every(r => r.review_contract === "momm-peer-review/2" && Array.isArray(r.reviewed_scope) && r.reviewed_scope.length), "legacy/unverified reply contract; needs a fresh review");
    const required = report.gate_policy?.quorum_required ?? report.quorum?.required ?? 1;
    demand(Number.isInteger(required) && required > 0, "invalid report quorum");
    const requested = report.gate_policy?.requested_routes;
    if (report.gate_policy?.strict && (!Array.isArray(requested) || !requested.length || requested.some(agent => !nonempty(agent)))) {
      state.errors.push("invalid strict policy: requested_routes must name the required reviewer routes");
    }
    if (report.split) {
      // A split run is judged per piece from the sealed piece structure, never
      // from merged route rows (a route that timed out on one piece merges as
      // "success, partial"). Every piece must meet quorum; aggregate metadata
      // must agree; strict policy applies to every piece.
      demand(Array.isArray(report.split.pieces) && Array.isArray(report.split.governor_direct), "malformed split structure");
      const pieces = report.split.pieces;
      demand(pieces.every(p => nonempty(p.id) && p.reviewers && typeof p.reviewers === "object"), "malformed split piece");
      const perPiece = pieces.map(p => {
        const claimed = Object.entries(p.reviewers).filter(([agent, status]) => agent !== report.governor && status === "success").map(([agent]) => agent);
        for (const agent of claimed) if (!successful.some(r => r.agent === agent)) state.errors.push(`piece reviewer success has no successful verified row: ${p.id}: ${agent}`);
        const ok = claimed.filter(agent => successful.some(r => r.agent === agent));
        return { id: p.id, external_successes: ok.length, met: ok.length >= required, ok };
      });
      // A merged route row reads "success" when any piece succeeded; its per-status piece counts are
      // the piece-level fact it carries. The piece structure may not claim more successes for a
      // route than that row records (rows without counts predate them and cannot be compared).
      for (const row of successful) {
        const recorded = row.pieces?.success;
        if (!Number.isInteger(recorded)) continue;
        const claimedPieces = perPiece.filter(p => p.ok.includes(row.agent)).length;
        if (claimedPieces > recorded) state.errors.push(`piece structure claims ${claimedPieces} successful piece(s) for ${row.agent} but its verified row records ${recorded}`);
      }
      const failing = perPiece.filter(p => !p.met).map(p => p.id);
      const achieved = perPiece.length ? Math.min(...perPiece.map(p => p.external_successes)) : 0;
      state.quorum = { required, achieved, met: perPiece.length > 0 && failing.length === 0, pieces: perPiece.length, failing_pieces: failing, governor_direct: report.split.governor_direct.length };
      if (!perPiece.length) state.errors.push("split run has no reviewed pieces; every hunk was governor_direct scope and no external review exists");
      if (failing.length) state.errors.push(`external review quorum not met on piece(s): ${failing.join(", ")}`);
      if (report.quorum && (report.quorum.met !== state.quorum.met || (report.quorum.pieces ?? pieces.length) !== pieces.length)) state.errors.push("report quorum metadata contradicts the sealed piece structure");
      if (report.gate_policy?.strict && Array.isArray(requested)) {
        for (const p of perPiece) for (const agent of requested) if (agent !== report.governor && !p.ok.includes(agent)) state.errors.push(`strict reviewer policy not met on ${p.id}: ${agent}`);
      }
    } else {
      state.quorum = { required, achieved: successful.length, met: successful.length >= required };
      if (!state.quorum.met) state.errors.push("external review quorum not met");
      if (report.gate_policy?.strict && Array.isArray(requested) && requested.some(agent => agent !== report.governor && !successful.some(r => r.agent === agent))) {
        state.errors.push("strict reviewer policy not met");
      }
    }
    const item = (kind, reviewer, index, content) => {
      const id = digest(JSON.stringify([reportSha, kind, reviewer, index, content]));
      return { item_id: id, kind, reviewer, index, content };
    };
    for (const r of successful) (r.suggested_improvements ?? []).forEach((s, i) => state.items.push(item("suggestion", r.agent, i, s)));
    report.findings.forEach((f, i) => state.items.push(item("finding", null, i, f)));
    // Oversize scope no route reviewed is an obligation of its own: the governor
    // must record a decision with investigation evidence covering that path.
    for (const [i, entry] of (report.split?.governor_direct ?? []).entries()) {
      demand(nonempty(entry.path) && entry.status === "governor_direct", "malformed governor_direct entry");
      state.items.push(item("governor_direct", null, i, { id: entry.id, path: entry.path, hunk: entry.hunk ?? null, bytes: entry.bytes ?? null }));
    }
    let rows = [];
    const decisionFile = path.join(root, ".ensemble_reviews/dispositions.jsonl");
    if (fs.existsSync(decisionFile)) rows = jsonl(".ensemble_reviews/dispositions.jsonl").filter(r => r.run_id === runId);
    else reads.set(".ensemble_reviews/dispositions.jsonl", null);
    const known = new Set(state.items.map(i => i.item_id));
    // review_rating rows (ledger --rate) are the governor's opinion of how a
    // review read; they are not decisions. Only a well-formed rating row is
    // ignored here — anything else unknown is still an error.
    const isRating = row => row && row.kind === "review_rating" && row.run_id === runId && nonempty(row.reviewer)
      && Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5 && Array.isArray(row.tags) && row.tags.every(nonempty)
      && row.item_id === undefined && row.disposition === undefined;
    const malformedRating = row => row && row.kind === "review_rating" && !isRating(row);
    rows = rows.filter(row => { if (malformedRating(row)) { state.errors.push("malformed review_rating row"); return false; } return !isRating(row); });
    for (const row of rows) if (!known.has(row.item_id)) state.errors.push("unknown or legacy decision item; cannot count as validated");
    const check = (entry, obligation, phase, current) => {
      const c = JSON.parse(ref(entry));
      demand(c.schema === "momm-check/1" && c.run_id === runId && c.item_id === obligation.item_id
        && c.report_sha256 === reportSha && c.input_sha256 === report.input_sha256, "check belongs to another run/item/input");
      demand(c.phase === phase && Number.isInteger(c.exit_code) && nonempty(c.command_label)
        && Number.isFinite(Date.parse(c.observed_at)), "invalid check observation");
      ref(c.test); ref(c.output);
      demand(Array.isArray(c.artifacts) && c.artifacts.length > 0, "check must bind tested artifacts");
      const names = new Set();
      for (const a of c.artifacts) {
        demand(!names.has(a.path) && hash(a.sha256), "duplicate/invalid artifact"); names.add(a.path);
        local(a.path);
        if (current) ref(a);
        else { demand(a.snapshot?.sha256 === a.sha256, "before snapshot must match original artifact hash"); ref(a.snapshot); }
        if (!current) demand(report.source_snapshot.files.some(f => f.path === a.path && f.sha256 === a.sha256), "reproduction baseline differs from reviewed source");
      }
      // A cited real project file must actually be covered by the check.
      const target = obligation.kind === 'finding'
        ? normalizeTarget(obligation.content.target_file, report.source_snapshot.files, root)
        : obligation.kind === 'governor_direct' ? normalizeTarget(obligation.content.path, report.source_snapshot.files, root) : null;
      if (target && !names.has(target)) {
        demand(phase === "investigation" && c.absent_paths?.includes(target)
          && !path.isAbsolute(target) && !target.includes(":") && target.split("/").every(p => p && p !== "." && p !== "..")
          && !fs.existsSync(path.resolve(root, target)), "check does not cover the finding's target");
        reads.set(target, null);
      }
      return c;
    };
    // A clean review still needs a checked current source/test manifest. A
    // later source edit must invalidate completion even when there are no items.
    const finalBytes = read(`.ensemble_reviews/verification/${runId}.json`);
    const finalRef = { path: `.ensemble_reviews/verification/${runId}.json`, sha256: digest(finalBytes) };
    const finalCheck = check(finalRef, { item_id: "run", kind: "run" }, "final", true);
    demand(finalCheck.exit_code === 0, "run-level final verification did not pass");
    demand(JSON.stringify(finalCheck.artifacts.map(f => f.path).sort()) === JSON.stringify(report.source_snapshot.files.map(f => f.path).sort()), "final verification must cover the whole reviewed source scope");
    for (const obligation of state.items) {
      try {
        const matching = rows.filter(r => r.item_id === obligation.item_id);
        demand(matching.length === 1, "missing or duplicate decision");
        const row = matching[0];
        demand(row.report_sha256 === reportSha && row.input_sha256 === report.input_sha256
          && row.governor === report.governor && nonempty(row.reason), "decision binding/reason/governor missing");
        const sources = obligation.kind === "finding" ? obligation.content.sources : obligation.kind === "governor_direct" ? [report.governor] : [obligation.reviewer];
        demand(sources?.includes(row.reviewer), "decision reviewer does not match item");
        // governor_direct scope may also be closed as "reviewed": the governor read it directly and found nothing to change.
        demand(["applied", "applied-with-modification", "rejected", ...(obligation.kind === "governor_direct" ? ["reviewed"] : [])].includes(row.disposition), "deferred/unknown disposition remains open");
        if (row.disposition.startsWith("applied")) {
          const after = check(row.verification, obligation, "after", true);
          demand(after.exit_code === 0, "verification did not pass");
          // Behavioral work includes all material findings; never infer style from prose.
          const material = obligation.kind === "finding" && ["CRITICAL", "WARNING"].includes(obligation.content.severity);
          demand(["behavior", "style"].includes(row.change_kind), "change_kind required");
          if (material || row.change_kind === "behavior") {
            const before = check(row.reproduction, obligation, "before", false);
            demand(before.exit_code > 0 && before.test.path === after.test.path && before.test.sha256 === after.test.sha256
              && Date.parse(before.observed_at) < Date.parse(after.observed_at), "need same test failing before and passing after");
            demand(JSON.stringify(before.artifacts.map(a => a.path).sort()) === JSON.stringify(after.artifacts.map(a => a.path).sort()), "before/after artifact scope differs");
          }
        } else if (obligation.kind === "finding" || obligation.kind === "governor_direct") {
          const investigation = check(row.verification, obligation, "investigation", true);
          demand(investigation.exit_code === 0, obligation.kind === "governor_direct" ? "governor_direct scope needs completed investigation evidence covering its path" : "rejected finding needs completed investigation evidence");
        }
      } catch (error) { state.unresolved.push({ item_id: obligation.item_id, reason: error.message }); }
    }
    // Only an evidenced applied decision may account for a changed reviewed file.
    for (const original of report.source_snapshot.files) {
      const final = finalCheck.artifacts.find(a => a.path === original.path);
      if (final.sha256 !== original.sha256) {
        const accounted = rows.some(r => r.disposition?.startsWith("applied") && r.verification
          && JSON.parse(ref(r.verification)).artifacts.some(a => a.path === original.path && a.sha256 === final.sha256));
        demand(accounted, "changed source has no applied decision evidence");
      }
    }
    // Recheck the read set so a concurrent edit cannot silently seal stale evidence.
    for (const [relative, sha] of reads) {
      if (sha === null) demand(!fs.existsSync(path.join(root, relative)), "decision file changed during validation");
      else demand((logReads.has(relative) ? scanFile(local(relative)) : digest(fs.readFileSync(local(relative)))) === sha, "evidence changed during validation");
    }
    state.validated_files = Object.fromEntries(reads);
    state.complete = state.quorum.met && !state.errors.length && !state.unresolved.length;
  } catch (error) { state.errors.push(error.message); }
  return state;
}

export function recordCompletion(root, runId) {
  requirePrivateEvidence(path.join(root, '.ensemble_reviews'));
  const result = inspectCompletion(root, runId);
  if (!result.complete) return result;
  const dir = path.join(root, ".ensemble_reviews/completions");
  if (fs.existsSync(dir)) demand(!fs.lstatSync(dir).isSymbolicLink(), "completion directory symlink refused");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  requirePrivateEvidence(dir);
  const final = path.join(dir, `${runId}.json`), tmp = `${final}.${randomUUID()}.tmp`;
  try {
    const receipt = { ...result, recorded_at: new Date().toISOString(), validator_sha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))) };
    fs.writeFileSync(tmp, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const again = inspectCompletion(root, runId);
    demand(again.complete && JSON.stringify(again.validated_files) === JSON.stringify(result.validated_files), "evidence changed before recording");
    if (fs.existsSync(final)) {
      const stat=fs.lstatSync(final);
      demand(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8_000_000, 'unsafe previous completion receipt');
      const previous=fs.readFileSync(final), archive=path.join(dir, `${runId}.${digest(previous)}.json`);
      try { fs.writeFileSync(archive, previous, {flag:'wx',mode:0o600}); }
      catch(error) {
        if(error.code!=='EEXIST')throw error;
        const saved=fs.lstatSync(archive);
        demand(saved.isFile() && !saved.isSymbolicLink() && saved.size===previous.length
          && digest(fs.readFileSync(archive))===digest(previous), 'previous receipt archive mismatch');
      }
      result.previous_receipt_path = `.ensemble_reviews/completions/${path.basename(archive)}`;
    }
    fs.renameSync(tmp, final);
    result.receipt_path = `.ensemble_reviews/completions/${runId}.json`;
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  return result;
}

function isEntrypoint() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (isEntrypoint()) {
  try {
    const args = process.argv.slice(2);
    demand(args[0] === "--run" && args[1] && (args.length === 2 || (args.length === 3 && args[2] === "--record")), "Usage: node governor.mjs --run <run_id> [--record]");
    const result = args[2] ? recordCompletion(process.cwd(), args[1]) : inspectCompletion(process.cwd(), args[1]);
    if (result.receipt_path) {
      const built = spawnSync(process.execPath, [fileURLToPath(new URL("ledger.mjs", import.meta.url))], { cwd: process.cwd(), encoding: "utf8", timeout: 15000, windowsHide: true });
      result.ledger_rebuilt = built.status === 0;
    }
    result.ledger_url = result.ledger_rebuilt === true ? pathToFileURL(path.resolve(".ensemble_reviews/ledger.html")).href : null;
    if (result.ledger_rebuilt === false) result.ledger_error = 'Completion receipt recorded, but the private dashboard rebuild failed. Rebuild it explicitly; no current ledger link is claimed.';
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = !result.complete ? 4 : result.ledger_rebuilt === false ? 5 : 0;
  } catch (error) { process.stderr.write(JSON.stringify({ error: error.message }) + "\n"); process.exitCode = 4; }
}
