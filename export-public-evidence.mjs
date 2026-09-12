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
import { renderPublic } from "./scripts/render-momm-site.mjs";

const args = process.argv.slice(2);
const from = [];
let outDir = "docs/evidence";
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--from") from.push({ dir: args[++i], label: args[i + 1] === "--label" ? args[(i += 2)] : path.basename(path.dirname(path.resolve(args[i]))) || "workspace" });
  else if (args[i] === "--out") {
    const requested = args[++i];
    if (!requested || path.resolve(requested) !== path.resolve("docs/evidence")) throw new Error("Public export renders the canonical docs/evidence output only. Custom --out is unsupported; no files were changed.");
  }
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
const diagnostics = { identical_duplicates: 0, missing_reports: 0, source_directories: from.length };
const readJsonl = file => fs.existsSync(file)
  ? fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; }
    catch { throw new Error(`Malformed ${path.basename(file)} at row ${index + 1}; export refused, not silently skipped.`); }
  }) : [];

const runs = [];
const reports = {};
const dispositions = [];
const seen = new Map();
for (const { dir, label } of from) {
  const er = path.resolve(dir);
  for (const run of readJsonl(path.join(er, "review-log.jsonl"))) {
    if (run.event || !run.run_id) continue;
    if (!/^rev_[A-Za-z0-9_]+$/.test(run.run_id)) throw new Error("Invalid run ID; refusing report path traversal");
    if (seen.has(run.run_id)) {
      if (seen.get(run.run_id) !== JSON.stringify(run)) throw new Error(`Conflicting duplicate run ${run.run_id}; reconcile sources before exporting.`);
      diagnostics.identical_duplicates++; continue;
    }
    seen.set(run.run_id, JSON.stringify(run));
    const entry = sanitize({ ...run, subject: run.label ?? run.subject ?? "", source_workspace: label });
    runs.push(entry);
    const reportFile = path.join(er, "reports", `${run.run_id}.json`);
    if (fs.existsSync(reportFile)) {
      const raw = fs.readFileSync(reportFile);
      try {
        reports[run.run_id] = { stored_report_sha256: createHash("sha256").update(raw).digest("hex"), report: sanitize(JSON.parse(raw.toString("utf8"))) };
      } catch { throw new Error(`Invalid stored report for ${run.run_id}; export refused.`); }
    } else diagnostics.missing_reports++;
  }
  for (const d of readJsonl(path.join(er, "dispositions.jsonl"))) dispositions.push(sanitize(d));
}
runs.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

const data = {
  schema: "momm-evidence-export/1",
  generated: new Date().toISOString(),
  source: "github.com/marroccofella/skills · momm dispatcher telemetry from this repository's own workspaces (" + from.map((f) => f.label).join(", ") + ")",
  sanitization: "User home/workspace paths normalized and private ledger links removed. Reviewer prose can quote source; --store-input may also persist input text. Inspect and explicitly authorize these public artifacts before publication.",
  note: "stored_report_sha256 covers the exact bytes of each report file on the source machine; run log lines carry the same digests, so any quoted reviewer statement resolves to a content-addressed record",
  runs,
  reports,
  dispositions,
  import_diagnostics: diagnostics,
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
const rendered = renderPublic({ root: path.resolve(path.dirname(outDir), "..") });
process.stdout.write(`${JSON.stringify({ ...rendered, out: jsonPath, import_diagnostics: diagnostics }, null, 2)}\n`);
