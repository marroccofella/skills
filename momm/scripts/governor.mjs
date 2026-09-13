#!/usr/bin/env node
// Offline evidence validation. Never execute commands from reviewer/decision data.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const hash = s => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const nonempty = s => typeof s === "string" && !!s.trim();
const demand = (ok, message) => { if (!ok) throw new Error(message); };

export function captureSourceSnapshot(root, artifact, inputPath) {
  const files = [];
  let verifyDiff = null;
  // Explicit file input takes precedence over sample diff text inside source.
  const isDiff = !inputPath && /^diff --git /m.test(artifact);
  let names = inputPath ? [path.relative(root, path.resolve(root, inputPath)).replaceAll("\\", "/")] : [];
  try {
    if (isDiff) {
      const git = args => { const r = spawnSync(process.platform === "win32" ? "git.exe" : "git", args, { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true, maxBuffer: 2_000_000 }); demand(r.status === 0, "cannot verify current Git diff"); return r.stdout; };
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

export function inspectCompletion(root, runId) {
  const state = { schema: "momm-completion/1", run_id: runId, complete: false,
    evidence_level: "local records and byte hashes validated; not independent proof of execution or correctness",
    items: [], unresolved: [], errors: [] };
  const reads = new Map();
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
    const jsonl = relative => read(relative).toString("utf8").split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s));
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
    demand(report.source_snapshot?.complete && report.source_snapshot.files.length > 0, "dispatch-time source snapshot missing; use local --input or supported Git diff for a fresh review");
    const routes = new Set();
    for (const r of report.reviewers) { demand(!routes.has(r.agent), "duplicate reviewer route"); routes.add(r.agent); }
    const successful = report.reviewers.filter(r => r.agent !== report.governor && r.status === "success");
    demand(successful.every(r => r.review_contract === "momm-peer-review/2" && Array.isArray(r.reviewed_scope) && r.reviewed_scope.length), "legacy/unverified reply contract; needs a fresh review");
    const required = report.gate_policy?.quorum_required ?? report.quorum?.required ?? 1;
    demand(Number.isInteger(required) && required > 0, "invalid report quorum");
    state.quorum = { required, achieved: successful.length, met: successful.length >= required };
    if (!state.quorum.met) state.errors.push("external review quorum not met");
    if (report.gate_policy?.strict) {
      const requested = report.gate_policy.requested_routes;
      if (!Array.isArray(requested) || !requested.length || requested.some(agent => !nonempty(agent))) {
        state.errors.push("invalid strict policy: requested_routes must name the required reviewer routes");
      } else if (requested.some(agent => agent !== report.governor && !successful.some(r => r.agent === agent))) {
        state.errors.push("strict reviewer policy not met");
      }
    }
    const item = (kind, reviewer, index, content) => {
      const id = digest(JSON.stringify([reportSha, kind, reviewer, index, content]));
      return { item_id: id, kind, reviewer, index, content };
    };
    for (const r of successful) (r.suggested_improvements ?? []).forEach((s, i) => state.items.push(item("suggestion", r.agent, i, s)));
    report.findings.forEach((f, i) => state.items.push(item("finding", null, i, f)));
    let rows = [];
    const decisionFile = path.join(root, ".ensemble_reviews/dispositions.jsonl");
    if (fs.existsSync(decisionFile)) rows = jsonl(".ensemble_reviews/dispositions.jsonl").filter(r => r.run_id === runId);
    else reads.set(".ensemble_reviews/dispositions.jsonl", null);
    const known = new Set(state.items.map(i => i.item_id));
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
      const rawTarget = obligation.kind === "finding" ? obligation.content.target_file?.replaceAll("\\", "/") : null;
      const target = rawTarget && !report.source_snapshot.files.some(f => f.path === rawTarget)
        && /^[ab]\//.test(rawTarget) && report.source_snapshot.files.some(f => f.path === rawTarget.slice(2))
        ? rawTarget.slice(2) : rawTarget;
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
        const sources = obligation.kind === "finding" ? obligation.content.sources : [obligation.reviewer];
        demand(sources?.includes(row.reviewer), "decision reviewer does not match item");
        demand(["applied", "applied-with-modification", "rejected"].includes(row.disposition), "deferred/unknown disposition remains open");
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
        } else if (obligation.kind === "finding") {
          const investigation = check(row.verification, obligation, "investigation", true);
          demand(investigation.exit_code === 0, "rejected finding needs completed investigation evidence");
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
      else demand(digest(fs.readFileSync(local(relative))) === sha, "evidence changed during validation");
    }
    state.validated_files = Object.fromEntries(reads);
    state.complete = state.quorum.met && !state.errors.length && !state.unresolved.length;
  } catch (error) { state.errors.push(error.message); }
  return state;
}

export function recordCompletion(root, runId) {
  const result = inspectCompletion(root, runId);
  if (!result.complete) return result;
  const dir = path.join(root, ".ensemble_reviews/completions");
  if (fs.existsSync(dir)) demand(!fs.lstatSync(dir).isSymbolicLink(), "completion directory symlink refused");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const final = path.join(dir, `${runId}.json`), tmp = `${final}.${randomUUID()}.tmp`;
  try {
    const receipt = { ...result, recorded_at: new Date().toISOString(), validator_sha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))) };
    fs.writeFileSync(tmp, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const again = inspectCompletion(root, runId);
    demand(again.complete && JSON.stringify(again.validated_files) === JSON.stringify(result.validated_files), "evidence changed before recording");
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
    result.ledger_url = pathToFileURL(path.resolve(".ensemble_reviews/ledger.html")).href;
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.complete ? 0 : 4;
  } catch (error) { process.stderr.write(JSON.stringify({ error: error.message }) + "\n"); process.exitCode = 4; }
}
