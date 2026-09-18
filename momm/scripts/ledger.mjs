#!/usr/bin/env node
// momm ledger — builds YOUR private review dashboard from this machine's own
// telemetry. The output lands inside .ensemble_reviews/ (which the momm
// protocol gitignores), so it is unique to you and never leaves your machine
// unless you deliberately publish it. No network, no accounts, no server.
//
//   node momm/scripts/ledger.mjs            # build from ./.ensemble_reviews
//   node momm/scripts/ledger.mjs --open     # build and open in your browser
//   node momm/scripts/ledger.mjs --rate <run_id> <reviewer> <1-5> [--tags a,b] [--note "..."]
//                                            # record how a review READ (1.16); latest per run wins;
//                                            # then rebuilds the page in the same run
//
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectCompletion } from "./governor.mjs";
import { requirePrivateEvidence } from "./evidence-permissions.mjs";
import { privateTestFixture } from "./private-test-fixture.mjs";

// The page quotes this script by its installed path, so every command it
// shows (rebuild, --rate) is copy-pasteable from any project directory.
const LEDGER_CMD = `node "${fileURLToPath(import.meta.url)}"`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// One design system for the Setup Center and this page: the shared theme
// (tokens, motion, topbar, chips, tables) is read from the installed skill at
// build time and inlined, so the palette has exactly one source. A missing
// theme is a broken install and fails loudly rather than shipping a second one.
const THEME_PATH = path.join(scriptDir, "..", "assets", "setup-ui", "momm-theme.css");
function readTheme() {
  try { return fs.readFileSync(THEME_PATH, "utf8"); }
  catch (error) { throw new Error(`momm-theme.css not found at ${THEME_PATH} (${error.code ?? error.message}); the ledger shares the Setup Center's theme and cannot build without it`); }
}

// Ledger -> Setup Center. While it runs, the Setup Center writes
// .ensemble_reviews/setup-center.json ({ url, pid, started_at }) and removes it
// on exit. The pill links to that URL only when the pid is still alive AND the
// URL is loopback http; otherwise it shows the exact command that starts the
// Setup Center from this install. A stale file (crash, power loss) therefore
// never yields a dead link, and nothing but a loopback URL is ever embedded.
const SETUP_CENTER_CMD = `node "${path.join(scriptDir, "setup-ui.mjs")}"`;
const isLoopbackUrl = (value) => {
  try { const u = new URL(value); return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && u.username === "" && u.password === ""; }
  catch { return false; }
};
const pidAlive = (pid) => { try { return process.kill(pid, 0); } catch (error) { return error?.code === "EPERM"; } };
function readSetupCenterPointer(dir) {
  try { const value = JSON.parse(fs.readFileSync(path.join(dir, "setup-center.json"), "utf8")); return value && typeof value === "object" ? value : null; }
  catch { return null; }
}
function resolveSetupCenterLink(pointer, { isAlive = pidAlive, command = SETUP_CENTER_CMD } = {}) {
  const pid = Number(pointer?.pid), url = pointer?.url;
  if (pointer && Number.isInteger(pid) && pid > 0 && typeof url === "string" && isLoopbackUrl(url) && isAlive(pid)) return { kind: "live", url, pid };
  return { kind: "command", command };
}
function setupCenterPill(link) {
  return link.kind === "live"
    ? `<a id="setup-center-link" href="${esc(link.url)}" title="The Setup Center running now (pid ${esc(link.pid)})">Setup Center</a>`
    : `<code title="The Setup Center is not running. Run this from any directory to open it; the next rebuild links here live.">${esc(link.command)}</code>`;
}

// Inline page scripts, kept as string constants so the self-test can exercise
// them. Theme: same behaviour as the dashboard (system preference by default, an
// explicit choice remembered per browser, one beat of eased colour on switch,
// a live label saying what you will get). Served: when this page arrives over
// http from the Setup Center, the pill becomes a relative link to it.
const THEME_SCRIPT = `(() => {
  const root = document.documentElement, key = "momm-ledger-theme";
  let saved = null; try { saved = localStorage.getItem(key); } catch {}
  if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  const button = document.getElementById("theme-toggle");
  if (!button) return;
  const isDark = () => { const explicit = root.getAttribute("data-theme"); return explicit ? explicit === "dark" : (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches); };
  const label = () => { const el = document.getElementById("theme-label"); if (el) el.textContent = isDark() ? "Light" : "Dark"; button.setAttribute("aria-pressed", isDark() ? "true" : "false"); };
  label();
  button.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.classList.add("theme-switching");
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(key, next); } catch {}
    label();
    setTimeout(() => root.classList.remove("theme-switching"), 450);
  });
})();`;
const SERVED_LINK_SCRIPT = `(() => {
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  const pill = document.getElementById("setup-center-pill");
  if (!pill) return;
  const link = document.createElement("a");
  link.id = "setup-center-link"; link.href = "/"; link.textContent = "Setup Center"; link.title = "The Setup Center serving this page";
  pill.replaceChildren(link);
})();`;

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
// Every per-agent accumulator below is prototype-free: agent names come from
// log and disposition rows, and a name such as "__proto__" or "constructor"
// must land in its own row rather than resolve to Object.prototype.
function rollup(dispositions, runs, reports) {
  const agents = Object.create(null);
  const get = (agent) => (agents[agent] ??= { agent, applied: 0, rejected: 0, deferred: 0, other: 0, utilityWeight: 0, dispatched: 0, completed: 0, timeouts: 0, failed: 0, findingsPerRun: [], weightedFindings: 0 });
  const unattributed = { agent: "unattributed", applied: 0, rejected: 0, deferred: 0, other: 0 };
  for (const d of dispositions) {
    // A decision attributed to several routes at once ("codex+grok") is a coalition
    // ruling, not a route of its own — the public export folds these the same way.
    const agent = String(d.reviewer || "").toLowerCase().includes("+") ? "coalition" : String(d.reviewer || "").toLowerCase();
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

// --- 1.16: qualitative ratings, windows, size buckets --------------------
// review_rating rows live in dispositions.jsonl beside dispositions but are a
// different kind of record: the governor's own 1-5 verdict on how a review
// READ, with a fixed tag vocabulary so they aggregate. Latest row per
// (run_id, reviewer) wins, so a retried triage never double-weights a review.
const RATING_MIN_N = 5;            // show a mean only from this many rated reviews
const RECOMMEND_MIN_N = 10;        // recommend only from this many completed dispatches
const CORE_TAGS = new Set(["specific", "reproducible", "off-artifact", "boilerplate", "hallucinated-lines", "late", "unique-catch"]);
const NON_DISPATCH = new Set(["self_excluded"]);
const NON_COMPLETION = new Set(["cancelled_after_quorum", "governor_direct"]);
function isRatingRow(row) { return row && row.kind === "review_rating"; }
function ratingsRollup(ratingRows) {
  const latest = new Map();
  for (const r of ratingRows) {
    if (!isRatingRow(r)) continue;
    const agent = String(r.reviewer || "").toLowerCase();
    if (!agent || !r.run_id) continue;
    const rating = Number(r.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) continue;
    latest.set(`${r.run_id}:${agent}`, { agent, rating, tags: Array.isArray(r.tags) ? r.tags.map(String) : [] });
  }
  const by = Object.create(null);
  for (const { agent, rating, tags } of latest.values()) {
    const row = (by[agent] ??= { agent, n: 0, sum: 0, tags: {}, custom_tags: {} });
    row.n += 1; row.sum += rating;
    for (const t of tags) {
      if (CORE_TAGS.has(t)) row.tags[t] = (row.tags[t] ?? 0) + 1;
      else if (t.startsWith("x-")) row.custom_tags[t] = (row.custom_tags[t] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.values(by).map((r) => [r.agent, { ...r, mean: r.n >= RATING_MIN_N ? r.sum / r.n : null, insufficient: r.n < RATING_MIN_N }]));
}
function sizeBucket(bytes) {
  const kb = (Number(bytes) || 0) / 1024;
  return kb < 8 ? "<8KB" : kb < 16 ? "8-16KB" : kb < 40 ? "16-40KB" : kb < 100 ? "40-100KB" : ">=100KB";
}
// Completion by route and input-size bucket over a trailing window. Runs whose
// route ended cancelled_after_quorum or governor_direct are neither completions
// nor failures: they are counted separately so an early exit can never make a
// route look unreliable.
function windowedReliability(runs, { days = 30, now = Date.now() } = {}) {
  const since = now - days * 864e5;
  const by = Object.create(null);
  for (const run of runs) {
    const t = Date.parse(run.timestamp);
    if (!Number.isFinite(t) || t < since || t > now) continue; // trailing window only, as runsPerDay counts it
    const bucket = sizeBucket(run.input_bytes);
    for (const [rawAgent, status] of Object.entries(run.reviewer_status ?? {})) {
      if (NON_DISPATCH.has(status)) continue;
      const agent = String(rawAgent).toLowerCase();
      const row = (by[agent] ??= { agent, dispatched: 0, completed: 0, excluded: 0, buckets: {} });
      const b = (row.buckets[bucket] ??= { dispatched: 0, completed: 0, excluded: 0 });
      if (NON_COMPLETION.has(status)) { row.excluded += 1; b.excluded += 1; continue; }
      row.dispatched += 1; b.dispatched += 1;
      if (status === "success") { row.completed += 1; b.completed += 1; }
    }
  }
  for (const row of Object.values(by)) {
    row.completionRate = row.dispatched ? row.completed / row.dispatched : null;
    row.recommendation = row.dispatched < RECOMMEND_MIN_N ? `insufficient data (n=${row.dispatched})`
      : row.completionRate < 0.5 ? "unreliable in this window: shorten input or drop the route for release gates"
      : row.completionRate < 0.8 ? "completes most runs; keep, expect the odd timeout"
      : "reliable in this window";
    for (const b of Object.values(row.buckets)) b.completionRate = b.dispatched ? b.completed / b.dispatched : null;
  }
  return by;
}
// Usage (1.16 reports carry reviewers[].usage from the dispatcher). Rollup by
// route with explicit coverage: reported counts only, never estimates.
function usageRollup(reports) {
  const by = Object.create(null);
  for (const { report } of Object.values(reports)) {
    for (const r of report?.reviewers ?? []) {
      if (r.status !== "success") continue;
      const agent = String(r.agent ?? "").toLowerCase(); // one row per route, like the other rollups
      if (!agent) continue;
      const row = (by[agent] ??= { agent, reviews: 0, tokens_reported: 0, cost_reported: 0, totals: [], cost: 0 });
      row.reviews += 1;
      const u = r.usage?.reported;
      if (u && Number.isFinite(u.total_tokens)) { row.tokens_reported += 1; row.totals.push(u.total_tokens); }
      if (u && Number.isFinite(u.cost_usd)) { row.cost_reported += 1; row.cost += u.cost_usd; }
    }
  }
  return Object.fromEntries(Object.values(by).map((r) => [r.agent, { ...r, median_total_tokens: median(r.totals), total_cost_usd: r.cost_reported ? r.cost : null }]));
}
function runsPerDay(runs, { days = 30, now = Date.now() } = {}) {
  const counts = new Array(days).fill(0);
  for (const run of runs) {
    const t = Date.parse(run.timestamp);
    if (!Number.isFinite(t)) continue;
    const back = Math.floor((now - t) / 864e5);
    if (back >= 0 && back < days) counts[days - 1 - back] += 1;
  }
  return counts;
}
function sparkline(counts, width = 180, height = 28) {
  const max = Math.max(1, ...counts);
  const step = width / Math.max(1, counts.length - 1);
  const pts = counts.map((c, i) => `${(i * step).toFixed(1)},${(height - 2 - (c / max) * (height - 4)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="runs per day, last ${counts.length} days, max ${max}"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${pts}"/></svg>`;
}
const REVIEWER_NAME = /^[a-z0-9_+-]{1,40}$/; // a route name, after lowercasing
function appendRating(er, args) {
  const [runId, reviewerRaw, ratingRaw] = args;
  const rating = Number(ratingRaw), reviewer = String(reviewerRaw ?? "").toLowerCase();
  if (!/^rev_[A-Za-z0-9_]+$/.test(String(runId)) || !REVIEWER_NAME.test(reviewer) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("usage: --rate <run_id> <reviewer> <1-5> [--tags specific,reproducible,...] [--note \"...\"] (reviewer: 1-40 of a-z 0-9 _ + -)");
  }
  const tagsAt = args.indexOf("--tags"), noteAt = args.indexOf("--note");
  const tags = tagsAt > -1 ? String(args[tagsAt + 1] ?? "").split(",").map((t) => t.trim()).filter(Boolean) : [];
  for (const t of tags) if (!CORE_TAGS.has(t) && !/^x-[a-z0-9-]{1,40}$/.test(t)) throw new Error(`unknown tag "${t}" (core: ${[...CORE_TAGS].join(", ")}; custom tags start with x-)`);
  const note = noteAt > -1 ? String(args[noteAt + 1] ?? "").slice(0, 500) : "";
  const row = { kind: "review_rating", timestamp: new Date().toISOString(), run_id: runId, reviewer, rating, tags, note };
  fs.appendFileSync(path.join(er, "dispositions.jsonl"), `${JSON.stringify(row)}\n`, {mode:0o600});
  return row;
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
    rollup_folds_multi_route_rows_into_coalition: (() => { const r = rollup([{ reviewer: "codex+grok", disposition: "applied", run_id: "r1" }, { reviewer: "Grok+Antigravity", disposition: "rejected", run_id: "r1" }], [], {}); const c = r.rows.find((x) => x.agent === "coalition"); return !!c && c.applied === 1 && c.rejected === 1 && !r.rows.some((x) => x.agent.includes("+")); })(),
    rollup_totals_reconcile_with_row_count: rolled.reconciled && rolled.totals.all === 6 && rolled.totals.applied === 3 && rolled.totals.rejected === 1 && rolled.totals.deferred === 1 && rolled.totals.other === 1,
    rollup_keeps_unattributed_rows_visible: rolled.unattributed.applied === 1 && !("" in by),
    rollup_precision_ignores_deferred_and_other: Math.abs(by.codex.precision - 2 / 3) < 1e-9 && Math.abs(by.codex.falsePositiveRate - 1 / 3) < 1e-9 && by.grok.precision === null && by.grok.deferred === 1 && by.copilot.other === 1,
    rollup_completion_counts_timeouts_and_failures: by.codex.dispatched === 2 && by.codex.completed === 2 && by.codex.completionRate === 1 && by.grok.dispatched === 2 && by.grok.timeouts === 1 && by.grok.completionRate === 0.5 && by.copilot.failed === 1 && !("claude" in by),
    rollup_findings_use_sealed_reports_only: by.codex.medianFindings === 2 && by.codex.weightedFindingsPerReview === 1.5 && by.copilot.medianFindings === 1 && by.grok.medianFindings === null,
    rollup_utility_weights_named_findings: by.codex.utilityWeight === 3 && by.codex.utility === 1.5 && by.copilot.utility === 0,
    ratings_latest_row_wins_and_min_n: (() => {
      const rows = [1, 2, 3, 4].map((i) => ({ kind: "review_rating", run_id: `rev_${i}`, reviewer: "grok", rating: 2, tags: ["boilerplate"] }));
      rows.push({ kind: "review_rating", run_id: "rev_1", reviewer: "grok", rating: 5, tags: ["specific", "x-payments"] });
      const r = ratingsRollup(rows);
      const four = r.grok.n === 4 && r.grok.mean === null && r.grok.insufficient && r.grok.tags.specific === 1 && r.grok.tags.boilerplate === 3 && r.grok.custom_tags["x-payments"] === 1;
      rows.push({ kind: "review_rating", run_id: "rev_5", reviewer: "grok", rating: 4, tags: [] });
      const five = ratingsRollup(rows).grok.mean === (5 + 2 + 2 + 2 + 4) / 5;
      return four && five;
    })(),
    ratings_reject_out_of_range_and_unknown_kind: ratingsRollup([{ kind: "review_rating", run_id: "rev_1", reviewer: "codex", rating: 9 }, { run_id: "rev_1", reviewer: "codex", rating: 5 }]).codex === undefined,
    reliability_window_excludes_cancelled_and_governor_direct: (() => {
      const now = Date.parse("2026-09-13T00:00:00Z");
      const mk = (daysAgo, status, bytes) => ({ run_id: "x", timestamp: new Date(now - daysAgo * 864e5).toISOString(), input_bytes: bytes, reviewer_status: { grok: status } });
      const w = windowedReliability([mk(1, "success", 1000), mk(2, "timeout", 20000), mk(3, "cancelled_after_quorum", 1000), mk(4, "governor_direct", 1000), mk(40, "timeout", 1000)], { now });
      return w.grok.dispatched === 2 && w.grok.completed === 1 && w.grok.excluded === 2 && w.grok.completionRate === 0.5 && w.grok.recommendation.startsWith("insufficient data (n=2)") && w.grok.buckets["<8KB"].completed === 1 && w.grok.buckets["16-40KB"].dispatched === 1;
    })(),
    reliability_recommends_only_with_min_n: (() => {
      const now = Date.now();
      const runs = Array.from({ length: 12 }, (_, i) => ({ run_id: "y" + i, timestamp: new Date(now - i * 3600e3).toISOString(), input_bytes: 100, reviewer_status: { codex: i < 4 ? "success" : "timeout" } }));
      const w = windowedReliability(runs, { now });
      return w.codex.dispatched === 12 && w.codex.recommendation.startsWith("unreliable");
    })(),
    usage_rollup_reports_coverage_not_zero: (() => {
      const u = usageRollup({ a: { report: { reviewers: [{ agent: "grok", status: "success", usage: { reported: { total_tokens: 100, cost_usd: 0.02 } } }, { agent: "grok", status: "success", usage: { reported: null } }, { agent: "antigravity", status: "success" }] } } });
      return u.grok.reviews === 2 && u.grok.tokens_reported === 1 && u.grok.median_total_tokens === 100 && u.grok.total_cost_usd === 0.02 && u.antigravity.tokens_reported === 0 && u.antigravity.median_total_tokens === null && u.antigravity.total_cost_usd === null;
    })(),
    sparkline_is_svg_with_one_point_per_day: sparkline(runsPerDay([{ timestamp: new Date().toISOString() }], { days: 7 })).includes("<svg") && runsPerDay([{ timestamp: new Date().toISOString() }], { days: 7 }).reduce((a, c) => a + c, 0) === 1,
    rating_row_kind_is_separated_from_dispositions: isRatingRow({ kind: "review_rating" }) && !isRatingRow({ disposition: "applied" }),
    // The loader splits dispositions.jsonl by kind before rollup(); prove the totals exclude rating rows once that filter is applied.
    rollup_totals_exclude_rating_rows_after_loader_filter: (() => {
      const all = [{ reviewer: "codex", disposition: "applied", run_id: "r1" }, { kind: "review_rating", run_id: "rev_1", reviewer: "codex", rating: 5, tags: [] }, { reviewer: "grok", disposition: "rejected", run_id: "r1" }];
      const r = rollup(all.filter((row) => !isRatingRow(row)), [], {});
      return r.totals.all === 2 && r.reconciled && r.rows.find((x) => x.agent === "codex").applied === 1 && r.rows.every((x) => x.applied + x.rejected + x.deferred + x.other === 1);
    })(),
    ratings_rollup_survives_prototype_named_reviewer: (() => {
      try {
        const r = ratingsRollup([{ kind: "review_rating", run_id: "rev_1", reviewer: "__proto__", rating: 5, tags: ["specific"] }, { kind: "review_rating", run_id: "rev_1", reviewer: "constructor", rating: 4, tags: [] }]);
        return ({}).n === undefined && ({}).sum === undefined && Object.n === undefined && Object.prototype.hasOwnProperty.call(r, "__proto__") && r["__proto__"].n === 1 && r["__proto__"].tags.specific === 1 && r.constructor.n === 1;
      } catch { return false; } finally { for (const k of ["n", "sum", "tags", "custom_tags"]) { delete Object.prototype[k]; delete Object[k]; } }
    })(),
    reliability_rollup_survives_prototype_named_route_and_lowercases: (() => {
      try {
        const now = Date.now();
        const w = windowedReliability([{ run_id: "p", timestamp: new Date(now - 3600e3).toISOString(), input_bytes: 10, reviewer_status: JSON.parse('{"__proto__":"success","Grok":"timeout"}') }], { now });
        return ({}).dispatched === undefined && w["__proto__"]?.completed === 1 && w.grok?.dispatched === 1 && !("Grok" in w);
      } catch { return false; } finally { for (const k of ["dispatched", "completed", "excluded", "buckets", "completionRate", "recommendation"]) delete Object.prototype[k]; }
    })(),
    usage_rollup_lowercases_agents_and_survives_prototype_names: (() => {
      try {
        const u = usageRollup({ a: { report: { reviewers: [{ agent: "Grok", status: "success", usage: { reported: { total_tokens: 10 } } }, { agent: "grok", status: "success" }, { agent: "__proto__", status: "success" }, { agent: "", status: "success" }] } } });
        return u.grok.reviews === 2 && u.grok.tokens_reported === 1 && !("Grok" in u) && ({}).reviews === undefined && u["__proto__"].reviews === 1 && !("" in u);
      } catch { return false; } finally { for (const k of ["reviews", "tokens_reported", "cost_reported", "totals", "cost"]) delete Object.prototype[k]; }
    })(),
    rollup_survives_prototype_named_reviewer: (() => {
      try {
        const r = rollup([{ reviewer: "__proto__", disposition: "applied", run_id: "r1" }], [{ run_id: "r1", reviewer_status: JSON.parse('{"__proto__":"success"}') }], {});
        return ({}).applied === undefined && ({}).dispatched === undefined && r.rows.length === 1 && r.rows[0].agent === "__proto__" && r.rows[0].applied === 1 && r.reconciled;
      } catch { return false; } finally { for (const k of ["applied", "rejected", "deferred", "other", "utilityWeight", "dispatched", "completed", "timeouts", "failed", "findingsPerRun", "weightedFindings"]) delete Object.prototype[k]; }
    })(),
    reliability_window_excludes_future_runs_like_runs_per_day: (() => {
      const now = Date.parse("2026-09-13T00:00:00Z");
      const mk = (daysAgo) => ({ run_id: "f", timestamp: new Date(now - daysAgo * 864e5).toISOString(), input_bytes: 10, reviewer_status: { grok: "success" } });
      const w = windowedReliability([mk(-1), mk(1)], { now });
      return w.grok.dispatched === 1 && w.grok.completed === 1 && runsPerDay([mk(-1), mk(1)], { now }).reduce((a, c) => a + c, 0) === 1;
    })(),
    append_rating_lowercases_and_rejects_unsafe_reviewer_names: (() => {
      const dir = privateTestFixture("momm-ledger-selftest-");
      try {
        const rejects = (args) => { try { appendRating(dir, args); return false; } catch (e) { return /usage: --rate/.test(e.message); } };
        const ok = appendRating(dir, ["rev_1", "Grok", "5", "--tags", "specific"]);
        const written = fs.readFileSync(path.join(dir, "dispositions.jsonl"), "utf8").trim().split("\n");
        return ok.reviewer === "grok" && written.length === 1 && JSON.parse(written[0]).reviewer === "grok"
          && ["Grok!", "a b", "x".repeat(41), "grok/../x", "<b>", "grok\n", "gr.ok"].every((name) => rejects(["rev_1", name, "5"]));
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    })(),
    // Setup Center link resolver: alive pid + loopback URL -> live link; dead pid, missing file, or any non-loopback URL -> the start command.
    setup_center_link_resolves_alive_dead_and_missing: (() => {
      const alive = resolveSetupCenterLink({ url: "http://127.0.0.1:4321/", pid: 4321 }, { isAlive: (pid) => pid === 4321, command: "CMD" });
      const dead = resolveSetupCenterLink({ url: "http://127.0.0.1:4321/", pid: 4321 }, { isAlive: () => false, command: "CMD" });
      const missing = resolveSetupCenterLink(null, { isAlive: () => true, command: "CMD" });
      const v6 = resolveSetupCenterLink({ url: "http://[::1]:5/", pid: 7 }, { isAlive: () => true, command: "CMD" });
      const foreign = ["http://evil.example/", "http://127.0.0.1.evil.example/", "https://127.0.0.1/", "http://user@127.0.0.1/", "file:///C:/x", "javascript:alert(1)", 42, null].map((url) => resolveSetupCenterLink({ url, pid: 7 }, { isAlive: () => true, command: "CMD" }));
      const badPid = [0, -1, 1.5, "abc", undefined].map((pid) => resolveSetupCenterLink({ url: "http://127.0.0.1:1/", pid }, { isAlive: () => true, command: "CMD" }));
      const livePill = setupCenterPill(alive), commandPill = setupCenterPill(dead);
      return alive.kind === "live" && alive.url === "http://127.0.0.1:4321/" && dead.kind === "command" && dead.command === "CMD" && missing.kind === "command" && v6.kind === "live"
        && [...foreign, ...badPid].every((r) => r.kind === "command")
        && livePill.includes('href="http://127.0.0.1:4321/"') && livePill.includes(">Setup Center<") && commandPill.startsWith("<code") && commandPill.includes(">CMD<") && !commandPill.includes("href")
        && SETUP_CENTER_CMD.startsWith('node "') && SETUP_CENTER_CMD.endsWith('setup-ui.mjs"') && SETUP_CENTER_CMD !== LEDGER_CMD;
    })(),
    served_link_script_rewrites_only_over_http: (() => {
      const run = (protocol) => {
        const pill = { children: null, replaceChildren(node) { this.children = node; } };
        const doc = { getElementById: (id) => (id === "setup-center-pill" ? pill : null), createElement: () => ({}) };
        new Function("document", "location", SERVED_LINK_SCRIPT)(doc, { protocol });
        return pill.children;
      };
      const http = run("http:"), file = run("file:");
      return http && http.href === "/" && http.textContent === "Setup Center" && file === null;
    })(),
    theme_script_labels_and_persists_like_the_dashboard: (() => {
      const stored = {}; const root = { attrs: {}, classes: new Set(), getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; }, classList: { add: (c) => root.classes.add(c), remove: (c) => root.classes.delete(c) } };
      const label = { textContent: "" }, button = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(_e, f) { this.click = f; } };
      const doc = { documentElement: root, getElementById: (id) => ({ "theme-toggle": button, "theme-label": label })[id] ?? null };
      new Function("document", "localStorage", "matchMedia", "setTimeout", THEME_SCRIPT)(doc, { getItem: (k) => stored[k] ?? null, setItem: (k, v) => { stored[k] = v; } }, () => ({ matches: false }), (fn) => fn());
      const saysDark = label.textContent === "Dark" && button.attrs["aria-pressed"] === "false";
      button.click();
      return saysDark && root.attrs["data-theme"] === "dark" && stored["momm-ledger-theme"] === "dark" && label.textContent === "Light" && button.attrs["aria-pressed"] === "true" && !root.classes.has("theme-switching");
    })(),
    // The built page: shared header, the theme inlined exactly once, legacy names mapped onto shared tokens, no hex outside the theme, a live Setup Center pill for a running pid.
    built_ledger_shares_the_theme_once_with_no_stray_hex: (() => {
      const dir = privateTestFixture("momm-ledger-theme-");
      try {
        const er = path.join(dir, ".ensemble_reviews"); fs.mkdirSync(er, {mode:0o700});
        fs.writeFileSync(path.join(er, "review-log.jsonl"), `${JSON.stringify({ run_id: "rev_1", timestamp: new Date().toISOString(), governor: "claude", reviewer_status: { grok: "success", codex: "timeout", claude: "self_excluded" }, findings_count: 1 })}\n`);
        fs.writeFileSync(path.join(er, "dispositions.jsonl"), `${JSON.stringify({ run_id: "rev_1", reviewer: "grok", suggestion: "s", disposition: "applied", reason: "r" })}\n`);
        fs.mkdirSync(path.join(er, "reports")); fs.writeFileSync(path.join(er, "reports", "rev_1.json"), JSON.stringify({ run_id: "rev_1", reviewers: [{ agent: "grok", status: "success", verdict: "MODIFY", summary: "fine" }, { agent: "codex", status: "timeout" }], findings: [{ id: "f1", severity: "WARNING", sources: ["grok"], issue: "x" }] }));
        fs.writeFileSync(path.join(er, "setup-center.json"), JSON.stringify({ url: "http://127.0.0.1:4321/", pid: process.pid, started_at: new Date().toISOString() }));
        const built = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { cwd: dir, encoding: "utf8", windowsHide: true, timeout: 60_000 });
        if (built.status !== 0) return false;
        const html = fs.readFileSync(path.join(er, "ledger.html"), "utf8"), theme = readTheme();
        const count = (text, needle) => text.split(needle).length - 1;
        const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
        const ownRules = style.replace(theme, "");
        const header = html.includes('class="momm-topbar"') && html.includes('class="momm-brand-mark"') && html.includes('class="momm-brand-name">momm<') && html.includes('class="momm-page-title">Private ledger<') && html.includes('id="theme-toggle"') && html.includes('class="orbit"') && html.includes('id="theme-label"');
        const themeOnce = count(html, "/* @momm-theme") === 1 && count(html, "--paper:") === count(theme, "--paper:") + 0 && style.includes(theme);
        const legacyMapped = /--bg:\s*var\(--paper\)/.test(ownRules) && /--panel:\s*var\(--card\)/.test(ownRules) && /--border:\s*var\(--line\)/.test(ownRules) && /--text:\s*var\(--ink\)/.test(ownRules) && /--accent:\s*var\(--green-bright\)/.test(ownRules) && /--warn:\s*var\(--amber\)/.test(ownRules) && /--crit:\s*var\(--red\)/.test(ownRules) && /--dim:\s*var\(--muted\)/.test(ownRules);
        const noStrayHex = !/#[0-9a-fA-F]{3,8}\b/.test(ownRules) && !/\sstyle="/.test(html) && count(html, "<style>") === 1;
        const livePill = html.includes('id="setup-center-pill"') && html.includes('id="setup-center-link" href="http://127.0.0.1:4321/"') && !html.includes(esc(SETUP_CENTER_CMD));
        const chips = html.includes('class="chip chip-success chip-mono"') && html.includes('class="chip chip-timeout chip-mono"') && html.includes('class="chip chip-self_excluded chip-mono"') && html.includes('class="chip chip-MODIFY"') && html.includes('class="chip chip-applied"') && html.includes('class="momm-table"');
        const copy = html.includes("Generated locally from this workspace's telemetry; it stays in .ensemble_reviews and is never published unless you choose to.") && !html.includes("Precision here is") && html.includes("every material finding still needs reproduction.");
        const scripts = count(html, "<script>") === 1 && html.includes("momm-ledger-theme") && html.includes('getElementById("setup-center-pill")');
        return header && themeOnce && legacyMapped && noStrayHex && livePill && chips && copy && scripts;
      } catch { return false; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    })(),
    // End to end: --rate prints the row, then rebuilds the page in the same invocation; the page's commands quote this script's installed path.
    rate_prints_row_then_rebuilds_ledger_with_installed_path_commands: (() => {
      const dir = privateTestFixture("momm-ledger-rate-");
      try {
        const er = path.join(dir, ".ensemble_reviews"); fs.mkdirSync(er, {mode:0o700});
        fs.writeFileSync(path.join(er, "review-log.jsonl"), `${JSON.stringify({ run_id: "rev_1", timestamp: new Date().toISOString(), governor: "claude", reviewer_status: { grok: "success" }, findings_count: 1 })}\n`);
        fs.writeFileSync(path.join(er, "dispositions.jsonl"), `${JSON.stringify({ run_id: "rev_1", reviewer: "grok", suggestion: "s", disposition: "applied", reason: "r" })}\n`);
        const script = fileURLToPath(import.meta.url);
        const runLedger = (args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8", windowsHide: true, timeout: 60_000 });
        const html = () => fs.readFileSync(path.join(er, "ledger.html"), "utf8");
        const plain = runLedger([]); const before = plain.status === 0 ? html() : "";
        const emptyStateUsesInstalledPath = before.includes(`<code>${esc(LEDGER_CMD)} --rate`) && before.includes(`<code>${esc(LEDGER_CMD)}</code>`) && !/node (momm\/)?scripts\/ledger\.mjs/.test(before) && !before.includes("insufficient ratings")
          && before.includes(`>${esc(SETUP_CENTER_CMD)}</code>`) && !before.includes('id="setup-center-link"'); // no setup-center.json: the pill is the start command
        fs.rmSync(path.join(er, "ledger.html"), { force: true });
        const rated = runLedger(["--rate", "rev_1", "grok", "4", "--tags", "specific"]);
        const lines = rated.stdout.trim().split(/\r?\n/);
        const after = rated.status === 0 && fs.existsSync(path.join(er, "ledger.html")) ? html() : "";
        return plain.status === 0 && emptyStateUsesInstalledPath && rated.status === 0 && JSON.parse(lines[0]).rating === 4 && /Your private ledger/.test(rated.stdout)
          && after.includes("insufficient ratings (n=1") && after.includes("1 triaged suggestions") && after.includes("specific ×1");
      } catch { return false; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    })(),
  };
  const passed = Object.values(tests).every(Boolean);
  process.stdout.write(`${JSON.stringify({ passed, tests }, null, 2)}\n`);
  process.exit(passed ? 0 : 1);
}
if (process.argv.includes("--self-test")) {
  // This branch exits inside ledgerSelfTest; fixture files must also be private
  // on POSIX, independently of the caller's ordinary shell umask.
  process.umask(0o077);
  ledgerSelfTest();
}

const er = path.resolve(".ensemble_reviews");
if (!fs.existsSync(er)) {
  process.stderr.write("No .ensemble_reviews here — run a momm review first, then rebuild your ledger.\n");
  process.exit(1);
}
try { requirePrivateEvidence(er); }
catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }
if (process.argv.includes("--rate")) {
  // Print the row, then fall through: the same invocation rebuilds the page so
  // the rating shows under "How the reviews read" straight away.
  try { process.stdout.write(`${JSON.stringify(appendRating(er, process.argv.slice(process.argv.indexOf("--rate") + 1)))}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2); }
}

const integrityWarnings = [];
const recordObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const reportErrors = new Map();
const readJsonl = (file) => {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const row = JSON.parse(line);
      if (!recordObject(row)) throw new Error("invalid record shape");
      return [row];
    } catch {
      integrityWarnings.push(`${path.basename(file)} line ${index + 1}: damaged record; retained on disk, not included in totals. Restore from a trusted backup before relying on completion.`);
      return [];
    }
  });
};
const runs = readJsonl(path.join(er, "review-log.jsonl")).filter((entry) => !entry.event);
const allDispositionRows = readJsonl(path.join(er, "dispositions.jsonl"));
const ratingRows = allDispositionRows.filter(isRatingRow);
const dispositions = allDispositionRows.filter((row) => !isRatingRow(row));
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
      const report = JSON.parse(raw);
      if (!recordObject(report) || !Array.isArray(report.reviewers) || !Array.isArray(report.findings)
        || !report.reviewers.every(r => recordObject(r) && typeof r.status === "string" && (r.suggested_improvements == null || Array.isArray(r.suggested_improvements)))
        || !report.findings.every(f => recordObject(f) && typeof f.severity === "string" && (f.sources == null || Array.isArray(f.sources)))) throw new Error("invalid report shape");
      reports[file.replace(/\.json$/, "")] = { sha256: createHash("sha256").update(raw).digest("hex"), report };
    } catch {
      reportErrors.set(file.replace(/\.json$/, ""), "Report is unreadable or corrupt; completion unverified.");
      integrityWarnings.push(`${file}: report unreadable or corrupt. Original bytes were not modified.`);
    }
  }
}

const data = {
  generated: new Date().toISOString(),
  private_note: "Generated locally from this workspace's telemetry; it stays in .ensemble_reviews and is never published unless you choose to.",
  projects: [{ name: "This workspace", root: process.cwd().replaceAll("\\", "/"), runs, dispositions, reports }],
  preflight: { routes: [], caveat: "run --preflight for live route status; this page is a snapshot of recorded evidence" },
  versions: { dispatcher: "momm ledger", repo: "github.com/marroccofella/skills" },
};

const HARNESS = { codex: "Codex CLI · ChatGPT OAuth", claude: "Claude Code · Anthropic OAuth", antigravity: "Antigravity CLI · Google OAuth", copilot: "GitHub Copilot CLI · GitHub OAuth", grok: "Grok CLI · xAI OAuth", gemini: "Gemini CLI · Google OAuth" };

const rows = runs.slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).map((run) => {
  const rpt = reports[run.run_id]?.report;
  const evidenceProblem = reportErrors.get(run.run_id) ?? (!rpt && (run.report_sha256 || run.report_path || run.report_schema || run.evidence?.report_sha256)
    ? "Missing sealed report; completion unverified. Restore the referenced report from a trusted backup." : null);
  if (evidenceProblem) integrityWarnings.push(`${run.run_id}: ${evidenceProblem}`);
  const completion = rpt?.source_snapshot ? inspectCompletion(process.cwd(), run.run_id) : null;
  const completionLine = completion ? `<p class="dim">${completion.complete ? "Local completion evidence validated" : "Governor verification incomplete or stale"} · <span class="mono">${esc(completion.evidence_level)}</span>${completion.complete ? "" : ` · ${esc([...completion.errors, ...completion.unresolved.map(i => i.reason)].join("; "))}`}</p>` : "<p class=\"dim\">Historical record — completion not validated under the current protocol.</p>";
  const runDispositions = dispositionsByRun.get(run.run_id) ?? [];
  const subject = run.label ?? "";
  const statuses = Object.entries(run.reviewer_status ?? {}).map(([agent, status]) => `<span class="chip chip-${esc(status)} chip-mono" title="${esc(agent)}: ${esc(status)}">${esc(agent)}</span>`).join(" ");
  // "0 findings" must never masquerade as a clean pass when nothing actually
  // reviewed: a run with zero completed external routes wears an explicit
  // no-verdict badge instead of a findings count.
  const externalStatuses = Object.entries(run.reviewer_status ?? {}).filter(([, status]) => status !== "self_excluded");
  const completedCount = externalStatuses.filter(([, status]) => status === "success").length;
  const outcomeBadge = completedCount === 0
    ? `<span class="chip chip-warn" title="No external reviewer completed — this run produced no verdict, not a clean pass">no verdict — 0/${externalStatuses.length} completed</span>`
    : `<span class="chip chip-neutral">${run.findings_count ?? 0} findings</span>`;
  const successes = rpt ? rpt.reviewers.filter((r) => r.status === "success") : [];
  const failedLine = rpt && rpt.reviewers.some((r) => r.status !== "success" && r.status !== "self_excluded")
    ? `<p class="dim">Routes without a review: ${rpt.reviewers.filter((r) => r.status !== "success" && r.status !== "self_excluded").map((r) => `${esc(r.agent)} (${esc(r.status)})`).join(", ")}.</p>` : "";
  const detail = rpt ? `<details><summary>${successes.length ? `full transcript · ${rpt.findings.length} finding${rpt.findings.length === 1 ? "" : "s"}` : "run record · no completed reviews"} · report sha256 <code class="hash">${esc(reports[run.run_id].sha256.slice(0, 12))}…</code></summary>
    ${failedLine}
    ${completionLine}
    ${successes.map((r) => `<div class="rev"><b>${esc(r.agent)}</b> <span class="dim">${esc(HARNESS[r.agent] ?? "")}${r.persona ? ` · persona: ${esc(r.persona)}` : ""}${r.duration_ms ? ` · <span class="mono">${(r.duration_ms / 1000).toFixed(1)}s</span>` : ""}</span><span class="chip chip-${esc(r.verdict)}">${esc(r.verdict)}</span>${r.confidence != null ? ` <span class="dim mono">conf ${r.confidence}</span>` : ""}<p>${esc(r.summary ?? "(verdict without prose — see suggestions)")}</p>${r.suggested_improvements?.length ? `<ul>${r.suggested_improvements.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}</div>`).join("")}
    ${rpt.findings.length ? `<h4>Findings — claims awaiting reproduction</h4>${rpt.findings.map((f) => `<div class="find f-${esc(f.severity)}"><b>${esc(f.severity)}</b> <span class="id">${esc(f.id)}</span> <span class="dim">by ${esc((f.sources ?? []).join(", "))}${f.verify_first ? " · verify first" : ""}</span><p>${esc(f.issue)}</p></div>`).join("")}` : ""}
    ${runDispositions.length ? `<h4>Your dispositions</h4><table class="momm-table"><tr><th>reviewer</th><th>suggestion</th><th>disposition</th><th>reason</th></tr>${runDispositions.map((d) => `<tr><td>${esc(d.reviewer)}</td><td class="prose">${esc(d.suggestion)}</td><td><span class="chip chip-${esc(d.disposition)}">${esc(d.disposition)}</span></td><td class="prose">${esc(d.reason)}${d.evidence ? `<br><span class="dim">evidence: ${esc(d.evidence)}</span>` : ""}</td></tr>`).join("")}</table>` : ""}
  </details>` : evidenceProblem ? `<p class="chip chip-warn">Evidence integrity warning: ${esc(evidenceProblem)}</p>` : `<span class="dim">summary-only record (predates sealed reports)</span>`;
  const narration = narrationFor(run, rpt, runDispositions);
  return `<article class="run"><header><b>${esc(subject || run.run_id)}</b><span class="meta">${esc(new Date(run.timestamp).toLocaleString())} · gov ${esc(run.governor)}${subject ? ` · ${esc(run.run_id)}` : ""}</span>${outcomeBadge}<button class="speak" type="button" data-narration="${esc(narration)}" aria-pressed="false" title="Read this run's summary aloud (local browser speech)">🔊 Read aloud</button></header><div class="chips">${statuses}</div>${detail}</article>`;
}).join("\n");

// Track record rollup: the same triage math as the dispatcher's --stats,
// rendered where the evidence lives, plus execution reliability (from the
// review log) and utility (from the sealed reports). Advisory prior only —
// never a reproduction gate.
const tr = rollup(dispositions, runs, reports);
const pct = (x) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const num = (x) => (x === null ? "n/a" : (Math.round(x * 100) / 100).toString());
const triageRow = (s, cls = "") => `<tr class="${cls}"><td>${esc(s.agent)}</td><td>${s.applied}</td><td>${s.rejected}</td><td>${s.deferred}</td>${tr.totals.other ? `<td>${s.other}</td>` : ""}<td>${s.precision === undefined ? "" : pct(s.precision)}</td><td>${s.falsePositiveRate === undefined ? "" : pct(s.falsePositiveRate)}</td><td class="prose dim">${s.note ?? ""}</td></tr>`;
// Render whenever any row exists — including a history made only of rows
// with no reviewer field (finding unattributed-only-history-hidden).
const trackPanel = tr.totals.all ? `<details class="track" open><summary>Reviewer track record · ${dispositions.length} triaged suggestions · ${tr.totals.applied} applied · ${tr.totals.rejected} rejected · ${tr.totals.deferred} deferred${tr.totals.other ? ` · ${tr.totals.other} other` : ""}${tr.reconciled ? "" : " · ⚠ counts do not reconcile"}</summary>
<h4>Triage record — what the governor did with each suggestion</h4>
<table class="momm-table"><tr><th>reviewer</th><th>applied</th><th>rejected</th><th>deferred</th>${tr.totals.other ? "<th>other</th>" : ""}<th>precision</th><th>false-positive rate</th><th></th></tr>
${tr.rows.map((s) => triageRow({ ...s, note: s.samples < 8 ? "small sample" : s.precision < 0.4 ? "verify-first tier" : "" })).join("")}
${tr.unattributed.applied + tr.unattributed.rejected + tr.unattributed.deferred + tr.unattributed.other ? triageRow({ ...tr.unattributed, note: "rows with no reviewer field" }, "dim") : ""}
${triageRow({ agent: "total", ...tr.totals, note: `${tr.totals.all} of ${dispositions.length} rows accounted for` }, "total")}
</table>
<h4>Execution reliability and utility</h4>
<table class="momm-table"><tr><th>reviewer</th><th>completed / dispatched</th><th>completion</th><th>timeouts</th><th>other failures</th><th>median findings per review</th><th>severity-weighted findings per review</th><th>utility</th></tr>
${tr.rows.map((s) => `<tr><td>${esc(s.agent)}</td><td>${s.completed} / ${s.dispatched}</td><td>${pct(s.completionRate)}</td><td>${s.timeouts}</td><td>${s.failed}</td><td>${num(s.medianFindings)}</td><td>${num(s.weightedFindingsPerReview)}</td><td>${num(s.utility)}</td></tr>`).join("")}
</table>
<h4>How the reviews read — your ratings (1-5) and tags, latest per run</h4>
${(() => { const rr = ratingsRollup(ratingRows); const agents = tr.rows.map((r) => r.agent).filter((a) => rr[a]).concat(Object.keys(rr).filter((a) => !tr.rows.some((r) => r.agent === a)));
  return agents.length ? `<table class="momm-table"><tr><th>reviewer</th><th>rated reviews</th><th>mean rating</th><th>tags</th></tr>${agents.map((a) => { const r = rr[a]; const tags = Object.entries({ ...r.tags, ...r.custom_tags }).sort((x, y) => y[1] - x[1]).map(([t, n]) => `${esc(t)} ×${n}`).join(", "); return `<tr><td>${esc(a)}</td><td>${r.n}</td><td>${r.mean === null ? `<span class="prose dim">insufficient ratings (n=${r.n}, need ${RATING_MIN_N})</span>` : (Math.round(r.mean * 10) / 10).toFixed(1)}</td><td>${tags || "—"}</td></tr>`; }).join("")}</table>`
  : `<p class="dim">No ratings yet. After triage, record one per reviewer: <code>${esc(LEDGER_CMD)} --rate &lt;run_id&gt; &lt;reviewer&gt; &lt;1-5&gt; --tags specific,reproducible</code> (run from this project; it rebuilds this page too)</p>`; })()}
<h4>Last 30 days — completion by route and input size (early exits and governor-direct pieces excluded)</h4>
${(() => { const w = windowedReliability(runs); const agents = Object.keys(w); const buckets = ["<8KB", "8-16KB", "16-40KB", "40-100KB", ">=100KB"];
  return agents.length ? `<table class="momm-table"><tr><th>reviewer</th><th>completed / dispatched</th>${buckets.map((b) => `<th>${esc(b)}</th>`).join("")}<th>excluded</th><th>recommendation</th></tr>${agents.map((a) => { const r = w[a]; return `<tr><td>${esc(a)}</td><td>${r.completed} / ${r.dispatched}${r.completionRate === null ? "" : ` (${pct(r.completionRate)})`}</td>${buckets.map((b) => { const x = r.buckets[b]; return `<td>${x ? `${x.completed}/${x.dispatched}` : "—"}</td>`; }).join("")}<td>${r.excluded}</td><td class="prose">${esc(r.recommendation)}</td></tr>`; }).join("")}</table>`
  : '<p class="dim">No runs in the last 30 days.</p>'; })()}
<p class="dim">Runs per day, last 30 days: ${sparkline(runsPerDay(runs))}</p>
<h4>Reported usage per route (from the CLIs' own envelopes; coverage shown, nothing estimated)</h4>
${(() => { const u = usageRollup(reports); const agents = Object.keys(u);
  return agents.length && agents.some((a) => u[a].tokens_reported || u[a].cost_reported) ? `<table class="momm-table"><tr><th>reviewer</th><th>reviews</th><th>tokens reported</th><th>median total tokens</th><th>cost reported</th><th>total cost (USD)</th></tr>${agents.map((a) => { const r = u[a]; return `<tr><td>${esc(a)}</td><td>${r.reviews}</td><td>${r.tokens_reported} of ${r.reviews}</td><td>${r.median_total_tokens === null ? "not reported" : Math.round(r.median_total_tokens)}</td><td>${r.cost_reported} of ${r.reviews}</td><td>${r.total_cost_usd === null ? "not reported" : r.total_cost_usd.toFixed(4)}</td></tr>`; }).join("")}</table>`
  : '<p class="dim">No usage recorded yet — reports written by momm 1.16 and later carry each CLI\'s own token and cost figures where the CLI reports them.</p>'; })()}
<p class="dim caption">Precision is the governor's acceptance rate on this project — applied ÷ (applied + rejected), triaged after reproduction, not precision against labelled ground truth — while completion counts successful reviews per dispatch and utility weights applied suggestions by severity (CRITICAL 3, WARNING 2, NITPICK 1, or the named <code>finding_id</code>'s weight) per completed review. All of it is an advisory prior: every material finding still needs reproduction.</p></details>` : "";

const setupCenterLink = resolveSetupCenterLink(readSetupCenterPointer(er));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>momm · Private ledger</title>
<style>
${readTheme()}
/* Ledger rules. Legacy names map onto the shared tokens so the palette has one source; every colour below is a token. */
:root{--bg:var(--paper);--panel:var(--card);--border:var(--line);--text:var(--ink);--accent:var(--green-bright);--warn:var(--amber);--crit:var(--red);--dim:var(--muted)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 var(--font-sans)}
.shell{width:min(1040px,calc(100% - 32px));margin:0 auto;padding-bottom:40px}
.mono,code,.hash,.id,.meta{font-family:var(--font-mono)}
code{font-size:.92em;padding:1px 5px;border-radius:5px;background:var(--mint);color:var(--green)}
h1{margin:30px 0 8px;font:600 clamp(28px,4vw,40px)/1.05 var(--font-display);letter-spacing:-.02em}
h1 .count{display:block;margin-top:8px;color:var(--dim);font:12px var(--font-mono);letter-spacing:0}
.note{margin:0;max-width:72ch;color:var(--dim);font-size:13px}
.note-meta{margin:6px 0 20px;color:var(--dim);font:11px/1.7 var(--font-mono);word-break:break-all}
.spark{vertical-align:middle;color:var(--accent)}
.run,.track{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px 18px;margin:12px 0;animation:rise var(--dur) var(--ease) both;transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease)}
.run:hover{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.run header{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.run header b{font:600 17px var(--font-display);letter-spacing:-.01em}
.run,.track{min-width:0;overflow-wrap:anywhere}.run header>*{min-width:0;max-width:100%}
.dim{color:var(--dim);font-size:12px}
.meta{color:var(--dim);font-size:11px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
details{margin-top:10px}summary{cursor:pointer;color:var(--dim);font-size:13px}summary:hover{color:var(--text)}
.track>summary{color:var(--text);font:600 15px var(--font-display)}
.rev{border-left:3px solid var(--border);padding:4px 12px;margin:10px 0}
.rev p,.rev ul{margin:4px 0;max-width:70ch}.rev li{color:var(--dim)}.rev b{font-family:var(--font-mono)}
.rev .chip{margin-left:8px}
.find{border-left:3px solid var(--dim);padding:4px 12px;margin:8px 0}.f-CRITICAL{border-color:var(--crit)}.f-WARNING{border-color:var(--warn)}
.find b{font-family:var(--font-mono)}.find .id{color:var(--dim)}.find p{margin:4px 0;max-width:70ch}
.table-scroll{max-width:100%;overflow-x:auto}.table-scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.table-scroll .momm-table{min-width:48rem;overflow-wrap:normal}
.table-scroll .momm-table td:not(.prose){white-space:nowrap}
.table-scroll .momm-table .prose{white-space:normal;overflow-wrap:anywhere;min-width:12rem;max-width:36rem}
.momm-table{margin-top:6px}
h4{margin:18px 0 4px;color:var(--accent);font:800 10px/1.4 var(--font-sans);letter-spacing:.12em;text-transform:uppercase}
.speak{margin-left:auto;cursor:pointer;border:1px solid var(--border);border-radius:999px;background:var(--pill);color:var(--dim);font:12px var(--font-sans);padding:6px 11px;transition:color var(--dur-fast) var(--ease),border-color var(--dur-fast) var(--ease)}
.speak:hover,.speak[aria-pressed="true"]{color:var(--accent);border-color:var(--accent)}
.speak[disabled]{opacity:.5;cursor:default}
.caption{max-width:90ch;margin-top:14px}
.foot{margin-top:28px;padding-top:16px;border-top:1px solid var(--hairline);color:var(--dim);font-size:12px;max-width:90ch}
@media (max-width:640px){.momm-nav code{max-width:100%;white-space:normal;word-break:break-all}.speak{margin-left:0}}
</style>
<div class="shell">
<header class="momm-topbar">
  <a class="momm-brand" href="#top" aria-label="momm private ledger, top of page"><span class="momm-brand-mark" aria-hidden="true">M</span><span><strong class="momm-brand-name">momm</strong><small class="momm-page-title">Private ledger</small></span></a>
  <div class="momm-actions">
    <nav class="momm-nav" aria-label="Related pages" id="setup-center-pill">${setupCenterPill(setupCenterLink)}</nav>
    <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Toggle light or dark theme" aria-pressed="false" title="Light or dark: follows your system until you choose"><span class="orbit" aria-hidden="true"></span> <span id="theme-label">Theme</span></button>
  </div>
</header>
<main id="top">
<h1>Private ledger<span class="count">${runs.length} runs · ${Object.keys(reports).length} sealed reports · ${dispositions.length} dispositions</span></h1>
<p class="note">${esc(data.private_note)}</p>
<p class="note-meta">${esc(data.projects[0].root)} · generated ${esc(data.generated)} · rebuild: <code>${esc(LEDGER_CMD)}</code></p>
${integrityWarnings.length ? `<section role="alert"><h2>Evidence integrity warning</h2><p>This snapshot contains missing or damaged evidence. Intact history is shown below; do not treat this page as a completion certificate.</p><ul>${integrityWarnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul></section>` : ""}
${trackPanel.replaceAll('<table class="momm-table">', '<div class="table-scroll" role="region" tabindex="0" aria-label="Review evidence table; scroll horizontally if needed"><table class="momm-table">').replaceAll('</table>', '</table></div>')}
${rows.replaceAll('<table class="momm-table">', '<div class="table-scroll" role="region" tabindex="0" aria-label="Review evidence table; scroll horizontally if needed"><table class="momm-table">').replaceAll('</table>', '</table></div>') || '<p class="dim">No runs recorded yet.</p>'}
<p class="foot">Reviewer names identify harness CLIs, not inner model identities. Reports are content-addressed: quotes resolve to files whose sha256 is recorded beside them. Read-aloud uses your browser's local speech engine; nothing leaves this machine.</p>
</main>
</div>
<script>
${SPEECH_SCRIPT}
${THEME_SCRIPT}
${SERVED_LINK_SCRIPT}
</script>`;

// The ledger renders reviewer transcripts. Request owner-only POSIX modes;
// Windows privacy depends on the directory/file DACL, not these mode bits.
// Remove any prior file first so writeFileSync always creates fresh at mode
// 0600 (its mode arg is ignored when overwriting), leaving no world-readable
// window between write and chmod.
const outPath = path.join(er, "ledger.html");
requirePrivateEvidence(er);
try { fs.rmSync(outPath, { force: true }); } catch {}
fs.writeFileSync(outPath, html, { mode: 0o600 });
process.stdout.write(`Your private ledger: ${outPath}\n(${runs.length} runs, ${Object.keys(reports).length} sealed reports — this file stays in .ensemble_reviews/, which the momm protocol keeps out of git.)\n`);
if (process.argv.includes("--open")) {
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", outPath]] : process.platform === "darwin" ? ["open", [outPath]] : ["xdg-open", [outPath]];
  try { spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }).unref(); } catch {}
}
