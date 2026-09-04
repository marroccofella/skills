#!/usr/bin/env node
// Build the PUBLIC evidence export for docs/evidence/ from this repository's
// own private momm ledgers. This is the one deliberate path from private
// telemetry to the public site: everything else stays gitignored.
//
//   node export-public-evidence.mjs --from .ensemble_reviews --from momm/.ensemble_reviews
//
// What it does: merges review-log lines, sealed reports and dispositions from
// every --from directory; drops event lines; normalizes user-home and
// workspace paths; removes private ledger links; records each report's
// stored-bytes sha256 so quotes stay content-addressed; writes
// docs/evidence/momm-evidence.json + its .sha256 sidecar; re-embeds the data
// block in docs/evidence/index.html; then re-scans the result with the same
// forbidden-path patterns CI enforces and refuses to write on any hit.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const from = [];
let outDir = "docs/evidence";
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--from") from.push({ dir: args[++i], label: args[i + 1] === "--label" ? args[(i += 2)] : path.basename(path.dirname(path.resolve(args[i]))) || "workspace" });
  else if (args[i] === "--out") outDir = args[++i];
  else throw new Error(`unknown argument ${args[i]}`);
}
if (!from.length) throw new Error("pass at least one --from <evidence-dir> [--label <name>]");

const FORBIDDEN = [
  /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/i,
  /[A-Za-z]:[\\/]+1code projects[\\/]+Claude/i,
  /(^|[\s"'(])\/(Users|home)\/[^/\s"']+/i,
];
function sanitizeString(value) {
  return value
    .replace(/file:\/\/\/[A-Za-z]:\/[^"'\s]*/g, "<private-ledger-link-removed>")
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, "<home>")
    .replace(/[A-Za-z]:[\\/]+1code projects[\\/]+[^\\/\s"']+/gi, "<workspace>")
    .replace(/[A-Za-z]:[\\/]+1code%20projects[\\/]+[^\\/\s"']+/gi, "<workspace>")
    .replace(/(\/mnt\/[a-z])?\/(Users|home)\/[^\/\s"'<>]+/g, "$1/<home>");
}
function sanitize(value, key = "") {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "ledger_url" || k === "pending_url" || k === "pending_file") continue; // private links
      out[k] = sanitize(v, k);
    }
    return out;
  }
  return value;
}
function scan(label, value, at = "$") {
  if (typeof value === "string") {
    if (FORBIDDEN.some((p) => p.test(value))) throw new Error(`${label} still leaks a local path at ${at}: ${value.slice(0, 120)}`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, i) => scan(label, item, `${at}[${i}]`));
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) scan(label, v, `${at}.${k}`);
}
const readJsonl = (file) => fs.existsSync(file)
  ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
  : [];

const runs = [];
const reports = {};
const dispositions = [];
const seen = new Set();
for (const { dir, label } of from) {
  const er = path.resolve(dir);
  for (const run of readJsonl(path.join(er, "review-log.jsonl"))) {
    if (run.event || !run.run_id || seen.has(run.run_id)) continue;
    seen.add(run.run_id);
    const entry = sanitize({ ...run, subject: run.label ?? run.subject ?? "", source_workspace: label });
    runs.push(entry);
    const reportFile = path.join(er, "reports", `${run.run_id}.json`);
    if (fs.existsSync(reportFile)) {
      const raw = fs.readFileSync(reportFile);
      try {
        reports[run.run_id] = { stored_report_sha256: createHash("sha256").update(raw).digest("hex"), report: sanitize(JSON.parse(raw.toString("utf8"))) };
      } catch {}
    }
  }
  for (const d of readJsonl(path.join(er, "dispositions.jsonl"))) dispositions.push(sanitize(d));
}
runs.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

const data = {
  schema: "momm-evidence-export/1",
  generated: new Date().toISOString(),
  source: "github.com/marroccofella/skills · momm dispatcher telemetry from this repository's own workspaces (" + from.map((f) => f.label).join(", ") + ")",
  sanitization: "user home and workspace paths normalized; private ledger links removed; reviewed artifact text is never stored by the dispatcher (only its sha256), so reports carry reviewer prose and quoted snippets only",
  note: "stored_report_sha256 covers the exact bytes of each report file on the source machine; run log lines carry the same digests, so any quoted reviewer statement resolves to a content-addressed record",
  runs,
  reports,
  dispositions,
};
scan("export", data);

const json = JSON.stringify(data);
const jsonPath = path.join(outDir, "momm-evidence.json");
const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
const block = /<script id="data" type="application\/json">[\s\S]*?<\/script>/;
if (!block.test(html)) throw new Error("docs/evidence/index.html has no <script id=\"data\"> block to refresh");
const embedded = json.replace(/<\//g, "<\\/");
const nextHtml = html.replace(block, () => `<script id="data" type="application/json">${embedded}</script>`);
const check = nextHtml.match(block)[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
scan("embedded", JSON.parse(check));

fs.writeFileSync(jsonPath, json);
fs.writeFileSync(`${jsonPath}.sha256`, `${createHash("sha256").update(json).digest("hex")}  momm-evidence.json\n`);
fs.writeFileSync(path.join(outDir, "index.html"), nextHtml);
const completed = runs.reduce((n, r) => n + Object.values(r.reviewer_status ?? {}).filter((s) => s === "success").length, 0);

// The momm page renders every number and chart from an embedded stats block
// computed here from the same export, so the prose can never drift from the
// evidence. Refresh it whenever the export is regenerated.
function pageStats() {
  const reportList = Object.values(reports).map((x) => x.report);
  const routes = ["codex", "antigravity", "copilot", "grok", "claude", "gemini"];
  const per = {};
  for (const rep of reportList) for (const rv of rep.reviewers ?? []) {
    const a = rv.agent; if (!routes.includes(a)) continue;
    per[a] ??= { success: 0, timeout: 0, other: 0, durations: [], verdicts: { ACCEPT: 0, MODIFY: 0, REJECT: 0 }, conf: [] };
    if (rv.status === "success") { per[a].success += 1; if (rv.duration_ms) per[a].durations.push(rv.duration_ms / 1000); if (rv.verdict) per[a].verdicts[rv.verdict] = (per[a].verdicts[rv.verdict] ?? 0) + 1; if (typeof rv.confidence === "number") per[a].conf.push(rv.confidence); }
    else if (rv.status === "timeout") per[a].timeout += 1; else if (rv.status !== "self_excluded") per[a].other += 1;
  }
  const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1); };
  const disp = {};
  for (const d of dispositions) { const r = String(d.reviewer).toLowerCase(); if (!routes.includes(r)) continue; disp[r] ??= { applied: 0, rejected: 0 }; if (String(d.disposition).startsWith("applied")) disp[r].applied += 1; else if (d.disposition === "rejected") disp[r].rejected += 1; }
  const routeStats = routes.filter((a) => per[a]?.success).map((a) => ({ route: a, completed: per[a].success, timeouts: per[a].timeout, other: per[a].other, median_s: q(per[a].durations, 0.5), p90_s: q(per[a].durations, 0.9), verdicts: per[a].verdicts, mean_confidence: per[a].conf.length ? +(per[a].conf.reduce((s, x) => s + x, 0) / per[a].conf.length).toFixed(2) : null, applied: disp[a]?.applied ?? 0, rejected: disp[a]?.rejected ?? 0, precision: disp[a] && (disp[a].applied + disp[a].rejected) ? +(disp[a].applied / (disp[a].applied + disp[a].rejected)).toFixed(2) : null }));
  const severity = { CRITICAL: 0, WARNING: 0, NITPICK: 0 }; let findings = 0;
  for (const rep of reportList) for (const f of rep.findings ?? []) { severity[f.severity] = (severity[f.severity] ?? 0) + 1; findings += 1; }
  const sizeTimeout = reportList.filter((r) => r.input_bytes).map((r) => ({ kb: +(r.input_bytes / 1024).toFixed(1), routes: (r.reviewers ?? []).filter((x) => x.status !== "self_excluded").length, timeouts: (r.reviewers ?? []).filter((x) => x.status === "timeout").length, maxdur: +Math.max(0, ...(r.reviewers ?? []).filter((x) => x.status === "success" && x.duration_ms).map((x) => x.duration_ms / 1000)).toFixed(1) }));
  const byDay = {}; for (const r of runs) { const d = String(r.timestamp).slice(0, 10); byDay[d] = (byDay[d] ?? 0) + 1; }
  const agreement = reportList.filter((r) => typeof r.insights?.agreement_score === "number" && (r.findings ?? []).length).map((r) => ({ t: r.run_id.slice(4, 12), a: r.insights.agreement_score, n: r.findings.length }));
  const specimen = reports.rev_20260904131823_wvxh?.report; const selfrun = reports.rev_20260904131435_mf6w?.report;
  return {
    generated: data.generated, runs: runs.length, sealed_reports: reportList.length, completed_peer_reviews: completed, findings, criticals: severity.CRITICAL, severity, dispositions: dispositions.length,
    disp_totals: { applied: dispositions.filter((d) => String(d.disposition).startsWith("applied")).length, rejected: dispositions.filter((d) => d.disposition === "rejected").length },
    first_run: runs[0]?.timestamp, last_run: runs.at(-1)?.timestamp, routes: routeStats, size_timeout: sizeTimeout, by_day: byDay, agreement,
    specimen: specimen ? { run: specimen.run_id, findings: specimen.findings.length, critical: specimen.findings.filter((f) => f.severity === "CRITICAL").length, verdicts: specimen.reviewers.filter((r) => r.verdict).map((r) => ({ agent: r.agent, verdict: r.verdict, confidence: r.confidence, persona: r.persona, s: +(r.duration_ms / 1000).toFixed(0) })), rules: specimen.project_rules_applied } : null,
    selfrun: selfrun ? { run: selfrun.run_id, findings: selfrun.findings.map((f) => ({ id: f.id, severity: f.severity, file: f.target_file, sources: f.sources })), agreement: selfrun.insights.agreement_score } : null,
  };
}
const pagePath = path.join(path.dirname(outDir), "momm", "index.html");
let pageRefreshed = false;
if (fs.existsSync(pagePath)) {
  const page = fs.readFileSync(pagePath, "utf8");
  const statsBlock = /<script id="page-stats" type="application\/json">[\s\S]*?<\/script>/;
  if (statsBlock.test(page)) {
    const stats = pageStats();
    scan("page stats", stats);
    fs.writeFileSync(pagePath, page.replace(statsBlock, () => `<script id="page-stats" type="application/json">${JSON.stringify(stats).replace(/<\//g, "<\\/")}</script>`));
    pageRefreshed = true;
  }
}
process.stdout.write(`${JSON.stringify({ runs: runs.length, sealed_reports: Object.keys(reports).length, dispositions: dispositions.length, completed_peer_reviews: completed, out: jsonPath, page_stats_refreshed: pageRefreshed }, null, 2)}\n`);
