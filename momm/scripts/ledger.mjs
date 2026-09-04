#!/usr/bin/env node
// momm ledger — builds YOUR private review dashboard from this machine's own
// telemetry. The output lands inside .ensemble_reviews/ (which the momm
// protocol gitignores), so it is unique to you and never leaves your machine
// unless you deliberately publish it. No network, no accounts, no server.
//
//   node momm/scripts/ledger.mjs            # build from ./.ensemble_reviews
//   node momm/scripts/ledger.mjs --open     # build and open in your browser
//
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

// Read-aloud narration: composed ONLY from structured, closed-vocabulary
// fields (statuses, verdicts, severity counts, disposition tallies) plus the
// user's own label. Reviewer prose and finding text are untrusted output and
// are never spoken — the narration describes the review, it does not
// re-broadcast it.
function narrationFor(run, report, runDispositions) {
  const parts = [];
  const when = run.timestamp ? new Date(run.timestamp).toDateString() : "unknown date";
  parts.push(`Review ${run.label ? `"${run.label}"` : run.run_id}, ${when}, governor ${run.governor ?? "unknown"}.`);
  const statuses = Object.entries(run.reviewer_status ?? {}).filter(([, status]) => status !== "self_excluded");
  const succeeded = statuses.filter(([, status]) => status === "success");
  const failed = statuses.filter(([, status]) => status !== "success");
  parts.push(`${succeeded.length} of ${statuses.length} reviewers completed${failed.length ? `; ${failed.map(([agent, status]) => `${agent} ${String(status).replaceAll("_", " ")}`).join(", ")}` : ""}.`);
  if (report) {
    const verdicts = {};
    for (const reviewer of report.reviewers ?? []) {
      if (reviewer.verdict) verdicts[reviewer.verdict] = (verdicts[reviewer.verdict] ?? 0) + 1;
    }
    const verdictText = Object.entries(verdicts).map(([verdict, count]) => `${count} ${verdict.toLowerCase()}`).join(", ");
    if (verdictText) parts.push(`Verdicts: ${verdictText}.`);
    const findings = report.findings ?? [];
    if (findings.length) {
      const severities = {};
      let verifyFirst = 0;
      for (const finding of findings) {
        severities[finding.severity] = (severities[finding.severity] ?? 0) + 1;
        if (finding.verify_first) verifyFirst += 1;
      }
      parts.push(`${findings.length} finding${findings.length === 1 ? "" : "s"}: ${Object.entries(severities).map(([severity, count]) => `${count} ${severity.toLowerCase()}`).join(", ")}${verifyFirst ? `; ${verifyFirst} flagged verify first` : ""}.`);
    } else {
      parts.push("No findings.");
    }
  }
  if (runDispositions.length) {
    const applied = runDispositions.filter((d) => String(d.disposition).startsWith("applied")).length;
    const rejected = runDispositions.filter((d) => d.disposition === "rejected").length;
    parts.push(`Triage: ${applied} applied, ${rejected} rejected of ${runDispositions.length} suggestions.`);
  }
  return parts.join(" ");
}

// The read-aloud controller, shipped inline in the ledger page. Kept as a
// string constant so the self-test can drive it against a fake DOM.
const SPEECH_SCRIPT = `(() => {
  const buttons = document.querySelectorAll(".speak");
  if (!("speechSynthesis" in window)) {
    buttons.forEach((b) => { b.disabled = true; b.textContent = "Speech unavailable"; });
    return;
  }
  let active = null;
  let current = null;
  const reset = () => {
    if (active) { active.setAttribute("aria-pressed", "false"); active.textContent = "\\u{1F50A} Read aloud"; active = null; }
    current = null;
  };
  buttons.forEach((button) => button.addEventListener("click", () => {
    const wasActive = active === button;
    speechSynthesis.cancel();
    reset();
    if (wasActive) return; // second click on the same run = stop
    const utterance = new SpeechSynthesisUtterance(button.dataset.narration);
    utterance.rate = 0.95;
    // A cancelled utterance can still emit onend/onerror asynchronously, after
    // a newer run has started. Only the utterance that is still current may
    // reset the UI (finding stale-speech-handler-resets-new-run, run
    // rev_20260904131435_mf6w — reproduced before this fix).
    const settle = () => { if (current === utterance) reset(); };
    utterance.onend = settle;
    utterance.onerror = settle;
    active = button;
    current = utterance;
    button.setAttribute("aria-pressed", "true");
    button.textContent = "\\u23F9 Stop";
    speechSynthesis.speak(utterance);
  }));
})();`;

// Drives SPEECH_SCRIPT against a minimal fake DOM and speech engine.
function speechScenario() {
  class Btn { constructor(n) { this.attrs = {}; this.textContent = ""; this.h = {}; this.dataset = { narration: n }; } setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; } addEventListener(e, f) { this.h[e] = f; } click() { this.h.click(); } }
  const A = new Btn("A"), B = new Btn("B");
  const cancelled = [];
  const engine = { current: null, cancel() { if (this.current) { cancelled.push(this.current); this.current = null; } }, speak(u) { this.current = u; } };
  new Function("document", "window", "speechSynthesis", "SpeechSynthesisUtterance", SPEECH_SCRIPT)(
    { querySelectorAll: () => [A, B] }, { speechSynthesis: engine }, engine, class { constructor(t) { this.text = t; } },
  );
  A.click(); B.click();                       // B supersedes A
  for (const u of cancelled) u.onerror?.();   // A's late event arrives
  const newerRunSurvivesStaleEvent = B.getAttribute("aria-pressed") === "true" && A.getAttribute("aria-pressed") === "false";
  engine.current?.onend?.();                  // B finishes normally
  const ownEndResets = B.getAttribute("aria-pressed") === "false";
  return { newerRunSurvivesStaleEvent, ownEndResets };
}

// Every disposition row lands in exactly one bucket so the headline count and
// the table always reconcile; rows with no reviewer sit on an "unattributed"
// line instead of vanishing. Execution reliability comes from the review log
// (per-run reviewer_status) and findings from the sealed reports.
const SEVERITY_WEIGHT = { CRITICAL: 3, WARNING: 2, NITPICK: 1 };
function classify(disposition) {
  const d = String(disposition ?? "");
  if (d.startsWith("applied")) return "applied";
  if (d === "rejected") return "rejected";
  if (d === "deferred") return "deferred";
  return "other";
}
function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function rollup(dispositions, runs, reports) {
  const agents = {};
  const get = (agent) => (agents[agent] ??= { agent, applied: 0, rejected: 0, deferred: 0, other: 0, utilityWeight: 0, dispatched: 0, completed: 0, timeouts: 0, failed: 0, findingsPerRun: [], weightedFindings: 0 });
  const unattributed = { agent: "unattributed", applied: 0, rejected: 0, deferred: 0, other: 0 };
  for (const d of dispositions) {
    const agent = String(d.reviewer || "").toLowerCase();
    const bucket = classify(d.disposition);
    const row = agent ? get(agent) : unattributed;
    row[bucket] += 1;
    if (agent && bucket === "applied") {
      const finding = d.finding_id ? (reports[d.run_id]?.report?.findings ?? []).find((f) => f.id === d.finding_id) : null;
      row.utilityWeight += finding ? (SEVERITY_WEIGHT[finding.severity] ?? 1) : 1;
    }
  }
  for (const run of runs) {
    for (const [rawAgent, status] of Object.entries(run.reviewer_status ?? {})) {
      if (status === "self_excluded") continue;
      const agent = String(rawAgent).toLowerCase();
      const row = get(agent);
      row.dispatched += 1;
      if (status === "success") {
        row.completed += 1;
        const findings = reports[run.run_id]?.report?.findings;
        if (Array.isArray(findings)) {
          const mine = findings.filter((f) => (f.sources ?? []).map((s) => String(s).toLowerCase()).includes(agent));
          row.findingsPerRun.push(mine.length);
          for (const f of mine) row.weightedFindings += SEVERITY_WEIGHT[f.severity] ?? 1;
        }
      } else if (status === "timeout") row.timeouts += 1;
      else row.failed += 1;
    }
  }
  const rows = Object.values(agents).map((r) => {
    const samples = r.applied + r.rejected;
    return {
      ...r,
      samples,
      precision: samples ? r.applied / samples : null,
      falsePositiveRate: samples ? r.rejected / samples : null,
      completionRate: r.dispatched ? r.completed / r.dispatched : null,
      medianFindings: median(r.findingsPerRun),
      weightedFindingsPerReview: r.completed ? r.weightedFindings / r.completed : null,
      utility: r.completed ? r.utilityWeight / r.completed : null,
    };
  }).sort((a, b) => (b.precision ?? -1) - (a.precision ?? -1));
  const totals = { applied: 0, rejected: 0, deferred: 0, other: 0 };
  for (const r of [...rows, unattributed]) for (const k of Object.keys(totals)) totals[k] += r[k];
  totals.all = totals.applied + totals.rejected + totals.deferred + totals.other;
  return { rows, unattributed, totals, reconciled: totals.all === dispositions.length };
}

function ledgerSelfTest() {
  const rolled = rollup([
    { reviewer: "codex", disposition: "applied", run_id: "r1" },
    { reviewer: "codex", disposition: "applied-with-modification", run_id: "r1", finding_id: "f1" },
    { reviewer: "codex", disposition: "rejected", run_id: "r1" },
    { reviewer: "grok", disposition: "deferred", run_id: "r1" },
    { reviewer: "", disposition: "applied", run_id: "r1" },
    { reviewer: "copilot", disposition: "parked", run_id: "r1" },
  ], [
    { run_id: "r1", reviewer_status: { claude: "self_excluded", codex: "success", grok: "timeout", copilot: "success" } },
    { run_id: "r2", reviewer_status: { codex: "success", grok: "success", copilot: "error" } },
  ], { r1: { report: { findings: [{ id: "f1", severity: "WARNING", sources: ["codex"] }, { id: "f2", severity: "NITPICK", sources: ["codex", "copilot"] }] } } });
  const by = Object.fromEntries(rolled.rows.map((r) => [r.agent, r]));
  const speech = speechScenario();
  const run = { run_id: "rev_x", label: "demo review", timestamp: "2026-08-24T00:00:00Z", governor: "claude", reviewer_status: { claude: "self_excluded", codex: "success", grok: "timeout" } };
  const report = {
    reviewers: [{ agent: "codex", verdict: "MODIFY" }],
    findings: [{ severity: "WARNING", verify_first: true, issue: "SENTINEL_UNTRUSTED_ISSUE_TEXT" }],
  };
  const spoken = narrationFor(run, report, [{ disposition: "applied" }, { disposition: "rejected" }]);
  const tests = {
    narration_names_label_and_governor: spoken.includes('"demo review"') && spoken.includes("governor claude"),
    narration_counts_reviewers_excluding_governor: spoken.includes("1 of 2 reviewers completed"),
    narration_reads_failures_verdicts_findings: spoken.includes("grok timeout") && spoken.includes("1 modify") && spoken.includes("1 warning") && spoken.includes("1 flagged verify first"),
    narration_reads_triage: spoken.includes("1 applied, 1 rejected of 2"),
    narration_never_speaks_reviewer_prose: !spoken.includes("SENTINEL_UNTRUSTED_ISSUE_TEXT"),
    narration_handles_summary_only_run: narrationFor({ run_id: "rev_y", reviewer_status: {} }, null, []).includes("rev_y"),
    stale_speech_event_cannot_reset_newer_run: speech.newerRunSurvivesStaleEvent,
    own_speech_end_resets_control: speech.ownEndResets,
    rollup_unattributed_only_history_has_rows: (() => { const r = rollup([{ reviewer: "", disposition: "deferred" }], [], {}); return r.totals.all === 1 && r.rows.length === 0 && r.unattributed.deferred === 1; })(),
    rollup_totals_reconcile_with_row_count: rolled.reconciled && rolled.totals.all === 6 && rolled.totals.applied === 3 && rolled.totals.rejected === 1 && rolled.totals.deferred === 1 && rolled.totals.other === 1,
    rollup_keeps_unattributed_rows_visible: rolled.unattributed.applied === 1 && !("" in by),
    rollup_precision_ignores_deferred_and_other: Math.abs(by.codex.precision - 2 / 3) < 1e-9 && Math.abs(by.codex.falsePositiveRate - 1 / 3) < 1e-9 && by.grok.precision === null && by.grok.deferred === 1 && by.copilot.other === 1,
    rollup_completion_counts_timeouts_and_failures: by.codex.dispatched === 2 && by.codex.completed === 2 && by.codex.completionRate === 1 && by.grok.dispatched === 2 && by.grok.timeouts === 1 && by.grok.completionRate === 0.5 && by.copilot.failed === 1 && !("claude" in by),
    rollup_findings_use_sealed_reports_only: by.codex.medianFindings === 2 && by.codex.weightedFindingsPerReview === 1.5 && by.copilot.medianFindings === 1 && by.grok.medianFindings === null,
    rollup_utility_weights_named_findings: by.codex.utilityWeight === 3 && by.codex.utility === 1.5 && by.copilot.utility === 0,
  };
  const passed = Object.values(tests).every(Boolean);
  process.stdout.write(`${JSON.stringify({ passed, tests }, null, 2)}\n`);
  process.exit(passed ? 0 : 1);
}
if (process.argv.includes("--self-test")) ledgerSelfTest();

const er = path.resolve(".ensemble_reviews");
if (!fs.existsSync(er)) {
  process.stderr.write("No .ensemble_reviews here — run a momm review first, then rebuild your ledger.\n");
  process.exit(1);
}

const readJsonl = (file) => {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
};
const runs = readJsonl(path.join(er, "review-log.jsonl")).filter((entry) => !entry.event);
const dispositions = readJsonl(path.join(er, "dispositions.jsonl"));
// Index once; per-run lookups below would otherwise rescan every disposition
// for every run (codex suggestion, rev_20260904131435_mf6w).
const dispositionsByRun = new Map();
for (const d of dispositions) {
  if (!dispositionsByRun.has(d.run_id)) dispositionsByRun.set(d.run_id, []);
  dispositionsByRun.get(d.run_id).push(d);
}
const reports = {};
const reportsDir = path.join(er, "reports");
if (fs.existsSync(reportsDir)) {
  for (const file of fs.readdirSync(reportsDir).filter((f) => f.endsWith(".json"))) {
    try {
      const raw = fs.readFileSync(path.join(reportsDir, file), "utf8");
      reports[file.replace(/\.json$/, "")] = { sha256: createHash("sha256").update(raw).digest("hex"), report: JSON.parse(raw) };
    } catch {}
  }
}

const data = {
  generated: new Date().toISOString(),
  private_note: "This page was generated locally from your own telemetry. It lives inside .ensemble_reviews/, which stays out of git — publishing it is always your explicit act, never a default.",
  projects: [{ name: "This workspace", root: process.cwd().replaceAll("\\", "/"), runs, dispositions, reports }],
  preflight: { routes: [], caveat: "run --preflight for live route status; this page is a snapshot of recorded evidence" },
  versions: { dispatcher: "momm ledger", repo: "github.com/marroccofella/skills" },
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const HARNESS = { codex: "Codex CLI · ChatGPT OAuth", claude: "Claude Code · Anthropic OAuth", antigravity: "Antigravity CLI · Google OAuth", copilot: "GitHub Copilot CLI · GitHub OAuth", grok: "Grok CLI · xAI OAuth", gemini: "Gemini CLI · Google OAuth" };

const rows = runs.slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).map((run) => {
  const rpt = reports[run.run_id]?.report;
  const runDispositions = dispositionsByRun.get(run.run_id) ?? [];
  const subject = run.label ?? "";
  const statuses = Object.entries(run.reviewer_status ?? {}).map(([agent, status]) => `<span class="st st-${esc(status)}" title="${esc(agent)}: ${esc(status)}">${esc(agent)}</span>`).join(" ");
  // "0 findings" must never masquerade as a clean pass when nothing actually
  // reviewed: a run with zero completed external routes wears an explicit
  // no-verdict badge instead of a findings count.
  const externalStatuses = Object.entries(run.reviewer_status ?? {}).filter(([, status]) => status !== "self_excluded");
  const completedCount = externalStatuses.filter(([, status]) => status === "success").length;
  const outcomeBadge = completedCount === 0
    ? `<span class="badge-noverdict" title="No external reviewer completed — this run produced no verdict, not a clean pass">no verdict — 0/${externalStatuses.length} completed</span>`
    : `${run.findings_count ?? 0} findings`;
  const successes = rpt ? rpt.reviewers.filter((r) => r.status === "success") : [];
  const failedLine = rpt && rpt.reviewers.some((r) => r.status !== "success" && r.status !== "self_excluded")
    ? `<p class="dim">Routes without a review: ${rpt.reviewers.filter((r) => r.status !== "success" && r.status !== "self_excluded").map((r) => `${esc(r.agent)} (${esc(r.status)})`).join(", ")}.</p>` : "";
  const detail = rpt ? `<details><summary>${successes.length ? `full transcript · ${rpt.findings.length} finding${rpt.findings.length === 1 ? "" : "s"}` : "run record · no completed reviews"} · report sha256 ${esc(reports[run.run_id].sha256.slice(0, 12))}…</summary>
    ${failedLine}
    ${successes.map((r) => `<div class="rev"><b>${esc(r.agent)}</b> <span class="dim">${esc(HARNESS[r.agent] ?? "")}${r.persona ? ` · persona: ${esc(r.persona)}` : ""}${r.duration_ms ? ` · ${(r.duration_ms / 1000).toFixed(1)}s` : ""}</span><span class="v v-${esc(r.verdict)}">${esc(r.verdict)}</span>${r.confidence != null ? ` <span class="dim">conf ${r.confidence}</span>` : ""}<p>${esc(r.summary ?? "(verdict without prose — see suggestions)")}</p>${r.suggested_improvements?.length ? `<ul>${r.suggested_improvements.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}</div>`).join("")}
    ${rpt.findings.length ? `<h4>Findings — claims awaiting reproduction</h4>${rpt.findings.map((f) => `<div class="find f-${esc(f.severity)}"><b>${esc(f.severity)}</b> ${esc(f.id)} <span class="dim">by ${(f.sources ?? []).join(", ")}${f.verify_first ? " · verify first" : ""}</span><p>${esc(f.issue)}</p></div>`).join("")}` : ""}
    ${runDispositions.length ? `<h4>Your dispositions</h4><table><tr><th>reviewer</th><th>suggestion</th><th>disposition</th><th>reason</th></tr>${runDispositions.map((d) => `<tr><td>${esc(d.reviewer)}</td><td>${esc(d.suggestion)}</td><td class="d-${esc(d.disposition)}">${esc(d.disposition)}</td><td>${esc(d.reason)}${d.evidence ? `<br><span class="dim">evidence: ${esc(d.evidence)}</span>` : ""}</td></tr>`).join("")}</table>` : ""}
  </details>` : `<span class="dim">summary-only record (predates sealed reports)</span>`;
  const narration = narrationFor(run, rpt, runDispositions);
  return `<article class="run"><header><b>${esc(subject || run.run_id)}</b> <span class="dim">${esc(new Date(run.timestamp).toLocaleString())} · gov ${esc(run.governor)} · ${outcomeBadge}${subject ? ` · ${esc(run.run_id)}` : ""}</span><button class="speak" type="button" data-narration="${esc(narration)}" aria-pressed="false" title="Read this run's summary aloud (local browser speech)">🔊 Read aloud</button></header><div>${statuses}</div>${detail}</article>`;
}).join("\n");

// Track record rollup: the same triage math as the dispatcher's --stats,
// rendered where the evidence lives, plus execution reliability (from the
// review log) and utility (from the sealed reports). Advisory prior only —
// never a reproduction gate.
const tr = rollup(dispositions, runs, reports);
const pct = (x) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const num = (x) => (x === null ? "n/a" : (Math.round(x * 100) / 100).toString());
const triageRow = (s, cls = "") => `<tr class="${cls}"><td>${esc(s.agent)}</td><td>${s.applied}</td><td>${s.rejected}</td><td>${s.deferred}</td>${tr.totals.other ? `<td>${s.other}</td>` : ""}<td>${s.precision === undefined ? "" : pct(s.precision)}</td><td>${s.falsePositiveRate === undefined ? "" : pct(s.falsePositiveRate)}</td><td class="dim">${s.note ?? ""}</td></tr>`;
// Render whenever any row exists — including a history made only of rows
// with no reviewer field (finding unattributed-only-history-hidden).
const trackPanel = tr.totals.all ? `<details class="track" open><summary>Reviewer track record · ${dispositions.length} triaged suggestions · ${tr.totals.applied} applied · ${tr.totals.rejected} rejected · ${tr.totals.deferred} deferred${tr.totals.other ? ` · ${tr.totals.other} other` : ""}${tr.reconciled ? "" : " · ⚠ counts do not reconcile"}</summary>
<h4>Triage record — what the governor did with each suggestion</h4>
<table><tr><th>reviewer</th><th>applied</th><th>rejected</th><th>deferred</th>${tr.totals.other ? "<th>other</th>" : ""}<th>precision</th><th>false-positive rate</th><th></th></tr>
${tr.rows.map((s) => triageRow({ ...s, note: s.samples < 8 ? "small sample" : s.precision < 0.4 ? "verify-first tier" : "" })).join("")}
${tr.unattributed.applied + tr.unattributed.rejected + tr.unattributed.deferred + tr.unattributed.other ? triageRow({ ...tr.unattributed, note: "rows with no reviewer field" }, "dim") : ""}
${triageRow({ agent: "total", ...tr.totals, note: `${tr.totals.all} of ${dispositions.length} rows accounted for` }, "total")}
</table>
<h4>Execution reliability and utility</h4>
<table><tr><th>reviewer</th><th>completed / dispatched</th><th>completion</th><th>timeouts</th><th>other failures</th><th>median findings per review</th><th>severity-weighted findings per review</th><th>utility</th></tr>
${tr.rows.map((s) => `<tr><td>${esc(s.agent)}</td><td>${s.completed} / ${s.dispatched}</td><td>${pct(s.completionRate)}</td><td>${s.timeouts}</td><td>${s.failed}</td><td>${num(s.medianFindings)}</td><td>${num(s.weightedFindingsPerReview)}</td><td>${num(s.utility)}</td></tr>`).join("")}
</table>
<p class="dim">Precision = applied / (applied + rejected); false-positive rate = rejected / (applied + rejected); deferred and other rows are counted but not adjudicated. Completion = successful reviews / dispatched (the governor's self-exclusion is not a dispatch). Findings per review use sealed reports only, weighting CRITICAL 3, WARNING 2, NITPICK 1. Utility = severity-weighted applied suggestions / completed reviews — a suggestion weighs 1 unless its disposition names a <code>finding_id</code>, in which case it takes that finding's weight. High precision from a route that rarely completes is not high utility. All of it is an advisory attention prior; every material finding still requires reproduction.</p></details>` : "";

const html = `<!doctype html><meta charset="utf-8"><title>My momm ledger</title>
<style>
  :root{--bg:#080a0a;--panel:#111316;--border:#1f2a22;--text:#e6ffe6;--muted:#9be29b;--dim:#5c6f60;--accent:#00ff99;--warn:#ffd166;--crit:#ff7a7a}
  body{background:var(--bg);color:var(--text);font:13px/1.55 ui-monospace,Consolas,monospace;max-width:960px;margin:0 auto;padding:20px}
  h1{font-size:19px}h1 span{color:var(--accent)}
  .note{color:var(--dim);font-size:11px;border:1px dashed var(--border);border-radius:8px;padding:8px 12px;margin:10px 0}
  .run{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin:10px 0}
  .run header{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline}
  .dim{color:var(--dim);font-size:11px}
  .st{border:1px solid var(--border);border-radius:6px;padding:0 6px;font-size:10.5px;color:var(--muted)}
  .st-success{color:var(--accent)}.st-timeout{color:var(--warn)}.st-authentication_required,.st-error{color:var(--crit)}.st-self_excluded{opacity:.6}
  details{margin-top:8px}summary{cursor:pointer;color:var(--muted)}
  .rev{border-left:3px solid var(--border);padding:4px 10px;margin:8px 0}
  .rev p,.rev ul{margin:4px 0;max-width:70ch}.rev li{color:var(--muted)}
  .v{border-radius:6px;padding:0 7px;font-weight:700;font-size:11px;margin-left:8px}
  .v-ACCEPT{background:rgba(0,255,153,.12);color:var(--accent)}.v-MODIFY{background:rgba(255,209,102,.12);color:var(--warn)}.v-REJECT{background:rgba(255,122,122,.14);color:var(--crit)}
  .find{border-left:3px solid var(--dim);padding:4px 10px;margin:6px 0}.f-CRITICAL{border-color:var(--crit)}.f-WARNING{border-color:var(--warn)}
  table{border-collapse:collapse;font-size:11.5px;width:100%}td,th{border-bottom:1px solid var(--border);padding:4px 8px;text-align:left;vertical-align:top}
  .d-applied{color:var(--accent)}.d-rejected{color:var(--warn)}.d-deferred{color:var(--muted)}
  tr.total td{border-top:1px solid var(--muted);font-weight:700}tr.dim td{color:var(--dim)}
  h4{margin:12px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
  .speak{margin-left:auto;cursor:pointer;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--muted);font:inherit;font-size:11px;padding:1px 8px}
  .speak:hover{color:var(--accent);border-color:var(--accent)}
  .speak[aria-pressed="true"]{color:var(--accent);border-color:var(--accent)}
  .speak[disabled]{opacity:.5;cursor:default}
  .badge-noverdict{background:rgba(255,209,102,.14);color:var(--warn);border-radius:6px;padding:0 7px;font-weight:700;font-size:11px}
  .track{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:8px 14px;margin:10px 0}
  .track table{margin-top:6px}
</style>
<h1><span>◆</span> My momm ledger <span class="dim">· ${runs.length} runs · ${Object.keys(reports).length} sealed reports · ${dispositions.length} dispositions</span></h1>
<p class="note">${esc(data.private_note)} Generated ${esc(data.generated)}. This ledger covers ONLY this workspace (${esc(data.projects[0].root)}); other projects keep their own — rebuild any with <code>node scripts/ledger.mjs</code> from that project.</p>
${trackPanel}
${rows || '<p class="dim">No runs recorded yet.</p>'}
<p class="dim">Reviewer names identify harness CLIs, not inner model identities. Reports are content-addressed: quotes resolve to files whose sha256 is recorded beside them. Read-aloud uses your browser's local speech engine; nothing leaves this machine.</p>
<script>
${SPEECH_SCRIPT}
</script>`;

// The ledger renders your reviewer transcripts — owner-only, like the reports.
// Remove any prior file first so writeFileSync always creates fresh at mode
// 0600 (its mode arg is ignored when overwriting), leaving no world-readable
// window between write and chmod.
const outPath = path.join(er, "ledger.html");
try { fs.rmSync(outPath, { force: true }); } catch {}
fs.writeFileSync(outPath, html, { mode: 0o600 });
try { fs.chmodSync(er, 0o700); } catch {}
process.stdout.write(`Your private ledger: ${outPath}\n(${runs.length} runs, ${Object.keys(reports).length} sealed reports — this file stays in .ensemble_reviews/, which the momm protocol keeps out of git.)\n`);
if (process.argv.includes("--open")) {
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", outPath]] : process.platform === "darwin" ? ["open", [outPath]] : ["xdg-open", [outPath]];
  try { spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }).unref(); } catch {}
}
