#!/usr/bin/env node
// Deterministic public renderer. No private ledgers, network, clock or model
// calls. --check compares exact outputs without writing. See CONTRIBUTING.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { releasePages } from "./momm-release-pages.mjs";
import { evidenceVisuals, releasePanel, releaseChecks, chartSeries } from "./momm-site-visuals.mjs";
import { definition, answerSection, enhanceSearch, projectStory, evidenceBenefits, addAttribution } from "./momm-site-search.mjs";
import { watchOutputs } from './momm-site-videos.mjs';
import {technicalBody, brandBadge, ensembleObservations} from './momm-site-technical.mjs';
import {homeCinema,homeDiagrams} from './momm-site-home.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = v => createHash("sha256").update(v).digest("hex");
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const routes = ["codex", "claude", "antigravity", "copilot", "grok", "gemini"];
const bucket = d => String(d.disposition).startsWith("applied") ? "applied" : ["rejected", "deferred"].includes(d.disposition) ? d.disposition : "historical_other";
const counts = rows => rows.reduce((a, d) => { a[bucket(d)]++; return a; }, { applied: 0, rejected: 0, deferred: 0, historical_other: 0 });
const quantile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] : null;
const csv = rows => rows.map(row => row.map(v => {
  let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}).join(",")).join("\n") + "\n";
export function stats(data) {
  const reports = Object.values(data.reports).map(r => r.report), dispositions = data.dispositions;
  const success = rows => rows.filter(r => r.status === "success").length;
  const allPeers = reports.flatMap(r => r.reviewers || []);
  const logSuccess = data.runs.reduce((n, r) => n + Object.values(r.reviewer_status || {}).filter(s => s === "success").length, 0);
  const routeRows = routes.map(route => {
    const peers = allPeers.filter(p => p.agent === route), complete = peers.filter(p => p.status === "success");
    const decisions = counts(dispositions.filter(d => String(d.reviewer).toLowerCase() === route));
    const seconds = complete.filter(r => Number.isFinite(r.duration_ms)).map(r => +(r.duration_ms / 1000).toFixed(1));
    return { route, completed: complete.length, timeouts: peers.filter(p => p.status === "timeout").length,
      other: peers.filter(p => !["success", "timeout", "self_excluded"].includes(p.status)).length,
      median_s: quantile(seconds, 0.5), p90_s: quantile(seconds, 0.9), ...decisions,
      acceptance: decisions.applied + decisions.rejected ? decisions.applied / (decisions.applied + decisions.rejected) : null };
  });
  const coalition = dispositions.filter(d => !routes.includes(String(d.reviewer).toLowerCase()));
  const severity = { CRITICAL: 0, WARNING: 0, NITPICK: 0 };
  for (const r of reports) for (const f of r.findings || []) severity[f.severity] = (severity[f.severity] || 0) + 1;
  const byDay = {};
  for (const r of data.runs) { const day = String(r.timestamp).slice(0, 10); byDay[day] = (byDay[day] || 0) + 1; }
  return { generated: data.generated, runs: data.runs.length, stored_reports: reports.length,
    log_successes: logSuccess, stored_successes: success(allPeers), summary_only_successes: logSuccess - success(allPeers),
    dispositions: dispositions.length, decisions: counts(dispositions), coalition: { total: coalition.length, ...counts(coalition) },
    routes: routeRows, severity, by_day: byDay };
}
const nav = [["index.html", "Overview"], ["start.html", "Get started"], ["updates.html", "Update safely"], ["evidence.html", "Evidence"], ["technical.html", "Architecture"], ["reference.html", "Reference"], ["releases/index.html", "Versions"]];
function shell(file, title, body, version) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="MOMM: multi-model review through your existing CLI logins. One driving agent, independent review claims, explicit decisions and a private evidence trail."><meta name="theme-color" content="#080a0a"><title>${esc(title)} · MOMM</title><link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head>
<body><a class="skip" href="#main">Skip to content</a><header class="site-header"><a class="brand" href="index.html" aria-label="MOMM overview"><span class="mark">◆</span> momm<span class="brand-note">by 42.uk</span></a><nav aria-label="Main navigation">${nav.map(([href, label]) => `<a href="${href}"${href === file ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav><a class="repo" href="https://github.com/marroccofella/skills">GitHub ↗</a></header>
<main id="main">${body}</main><footer><a class="brand" href="https://42.uk">◆ 42.uk</a><p>Part of the 42.uk universe. <span>RELAX. IT'S ALREADY OVER.</span></p><div>MOMM ${esc(version)} · <a href="https://github.com/marroccofella/skills/blob/main/LICENSE">MIT licence</a> · <a href="https://github.com/marroccofella/skills/issues">Report a problem</a></div></footer></body></html>\n`;
}
let codeId = 0;
function code(text, label = "Terminal") { const id = `code-${++codeId}`; return `<div class="code"><div class="code-label"><span>${esc(label)}</span><button type="button" data-copy="${id}" aria-label="Copy ${esc(label)} command">Copy</button></div><pre id="${id}"><code>${esc(text)}</code></pre></div>`; }
const eyebrow = s => `<p class="eyebrow">${s}</p>`;
const hero = (tag, title, intro) => `<section class="page-hero">${eyebrow(tag)}<h1>${title}</h1><p class="lead">${intro}</p></section>`;
const note = (title, text) => `<aside class="notice"><strong>${title}</strong><p>${text}</p></aside>`;
export function pages(data, s, version) {
  codeId = 0;
  const link = `releases/${version}.html`;
  const snapshot = esc(data.generated.slice(0, 10));
  const overview = `<section class="hero"><div>${eyebrow("MIXTURE OF MODEL MODALITY")}
    <a class="release-pill" href="${link}"><span class="dot"></span> ${esc(version)} · version notes <span>↗</span></a>
    <h1>One agent writes.<br><span>Others challenge it.</span><br>You keep the evidence.</h1>
    <p class="lead">${esc(definition)}</p>
    <div class="actions"><a class="button primary" href="start.html">Get started <span>→</span></a><a class="button" href="evidence.html#real-review">See a real review</a></div><p class="micro">Local orchestration · your existing account logins · no API-key setup</p></div>
    <div class="review-card" aria-label="Illustrative review flow, not a live run"><div class="card-bar"><span>REVIEW / THREE DISTINCT ROLES</span><span class="dot"></span></div><div class="flow-row"><span class="model governor">G</span><div><strong>Your current agent</strong><small>Writes the change. Does not review itself.</small></div><span class="role">governor</span></div><div class="flow-divider">↓ sanitized input to selected providers</div><div class="reviewers"><span class="model codex">CX</span><span class="model claude">CL</span><span class="model agy">AG</span><span class="model copilot">CP</span><span class="model grok">GK</span></div><p class="card-caption">Choose ready external reviewers.<br>These are CLI routes, not guaranteed model IDs.</p><div class="flow-divider">↓ claims, not instructions</div><div class="decision"><span>INVESTIGATE</span><span>VERIFY</span><span>RECORD</span></div><p class="card-foot">A vote is not a test. An ACCEPT is not proof.</p></div></section>
    <section class="principles"><article><span class="number">01</span><h2>One writer.</h2><p>Your current agent remains the only editor. Reviewer responses are untrusted evidence, never permission to change your project.</p></article><article><span class="number">02</span><h2>More than a verdict.</h2><p>See who found what, which routes failed, and why the governor applied, rejected or deferred each suggestion.</p></article><article><span class="number">03</span><h2>A record you own.</h2><p>Reports and decisions stay in your project’s private dashboard. The public example is a separate, sanitized export.</p></article></section>
    <section class="split-section"><div>${eyebrow("DON'T TRUST. VERIFY.")}<h2>The useful question isn’t<br>“did the models agree?”</h2><p class="lead-small">It’s “can we show what happened?”</p><p>A real development review found a process-supervisor bug. Another review produced a CRITICAL claim that failed reproduction. Both belong in the record.</p><a class="text-link" href="evidence.html#real-review">Inspect the accepted fix and rejected claim →</a></div><div class="proof-card"><span class="proof-label">PROJECT DEVELOPMENT SNAPSHOT · ${snapshot}</span><div class="stat-trio"><div><strong>${s.runs}</strong><span>recorded runs</span></div><div><strong>${s.stored_reports}</strong><span>stored reports</span></div><div><strong>${s.dispositions}</strong><span>decision records</span></div></div><p>This is MOMM reviewing its own development work—not an independent accuracy benchmark.</p><a href="evidence.html">Read the definitions and limitations →</a></div></section>
    <section class="boundary">${eyebrow("KNOW THE BOUNDARY")}<h2>Local control. External reviewers.</h2><p>The selected providers receive your sanitized review input through their CLIs. Redaction reduces risk; it does not guarantee that confidential information is gone. Use MOMM only when sharing that material with those providers is allowed.</p><p>The daily notice requests a public version manifest. It never downloads code. Disable it with <code>NO_UPDATE_CHECK=1</code> or <code>DO_NOT_TRACK=1</code>.</p><a class="text-link" href="reference.html#privacy">What leaves your machine →</a></section>
    <section class="cta"><div><h2>Start with one small change.</h2><p>You need one ready external reviewer, not every CLI.</p></div><a class="button primary" href="start.html">Set up MOMM →</a></section>`;
  const start = `${hero("GET STARTED", "A first review,<br><span>without the guesswork.</span>", "Install only what you need. Keep the project you want reviewed as the working directory. Let your agent close the review loop.")}
    <div class="docs-layout"><aside class="toc" aria-label="On this page"><a href="#install">01 / Install</a><a href="#connect">02 / Connect</a><a href="#review">03 / Review</a><a href="#decide">04 / Decide</a><a href="#dashboard">05 / Dashboard</a></aside><div class="doc-body">
    ${note("Before you start", "You need Git, Node.js 18 or newer, an Agent Skills-compatible harness and an account session for at least one external reviewer. Provider subscriptions, quotas and availability still apply.")}
    <section id="install"><h2><span class="step">01</span> Install MOMM, not the whole collection</h2><p>Clone the repository into a permanent directory. Keep it there: installation links your harness to this checkout. An archive download can be linked, but the updater requires a Git clone.</p>
    ${code("git clone https://github.com/marroccofella/skills.git\ncd skills", "macOS, Linux or PowerShell")}
    <label class="select-label" for="harness">Which harness should discover the skill?</label><select id="harness"><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="gemini">Gemini CLI</option><option value="antigravity">Antigravity</option></select>
    <div id="install-preview">${code("node momm/scripts/install.mjs --target codex --dry-run", "1. Preview only")}</div>
    <p>Read the preview before choosing to run the separate installation command:</p>
    <div id="install-apply">${code("node momm/scripts/install.mjs --target codex", "2. Install only after approving the preview")}</div>
    <p>Restart or refresh your agent’s skill discovery if needed. <code>--target all</code> is an explicit multi-harness choice; root <code>install.mjs</code> installs the whole collection.</p><p>The installer records the successful harnesses and their exact skill scopes in <code>momm.lock</code> under Git’s local MOMM state directory. It never overwrites existing discovery paths.</p></section>
    <section id="connect"><h2><span class="step">02</span> Connect a reviewer</h2><p>From the skills clone, open the local Setup Center:</p>${code("node momm/scripts/setup-ui.mjs", "Open Setup Center")}<p>Choose your current agent as governor. Use the provider’s login action and complete the browser login yourself. Quick Setup can test detected sessions with a disclosed synthetic sentence—not your project source.</p><p>The page opens on a local, automatically chosen port. In a headless session, use <code>node momm/scripts/onboard.mjs --governor codex</code>. Installed credentials are evidence, not a promise that the next dispatch will succeed.</p></section>
    <section id="review"><h2><span class="step">03</span> Review the right project</h2><p>Open the project you want reviewed in your agent. Paste this:</p>${code("Use $momm to review my current changes. Keep this project as the working directory. Use at least one ready external reviewer, reproduce material findings before authoring fixes, record every suggestion’s disposition, and show me the private ledger link.", "Paste into your agent")}
    <details><summary>Prefer the terminal? Codex on macOS / Linux</summary>${code('node "$HOME/.agents/skills/momm/scripts/multi-review.mjs" --preflight --governor codex --pretty\nnode "$HOME/.agents/skills/momm/scripts/multi-review.mjs" --governor codex --min-success 1 --pretty', "Run from your project")}</details>
    <details><summary>Codex on Windows / PowerShell</summary>${code('node "$env:USERPROFILE/.agents/skills/momm/scripts/multi-review.mjs" --preflight --governor codex --pretty\nnode "$env:USERPROFILE/.agents/skills/momm/scripts/multi-review.mjs" --governor codex --min-success 1 --pretty', "Run from your project")}</details>
    ${note("Working directory matters", "Without redirected input or <code>--input</code>, MOMM reviews <code>git diff HEAD</code> in the current directory. Running it from the skills clone reviews the skills—not your project. For another harness, use its installed skill path and its actual governor name.")}</section>
    <section id="decide"><h2><span class="step">04</span> Close the loop</h2><p>Reviewer replies are only the first half. The governor investigates material findings, authors any supported fixes, tests them, and records every suggestion as applied, rejected or deferred with a reason.</p><p>Applied decisions need checkable evidence: a regression test, a commit or a concrete probe. A deferred item is still open work. Run <code>node &lt;installed-momm&gt;/scripts/governor.mjs --run &lt;run_id&gt;</code> from the project. It matches stable item IDs to decisions and verifies original report/input binding and recorded source, test and output hashes. Missing, duplicate, deferred or stale evidence stays incomplete. Add <code>--record</code> only after checks pass; this saves a separate receipt and rebuilds the private ledger. The validator never executes reviewer snippets and cannot independently prove an observation was honestly recorded or a test adequate.</p><p>Your agent appends decisions to your project’s <code>.ensemble_reviews/dispositions.jsonl</code>, joined to the report’s <code>run_id</code>. Zero dispositions can mean no suggestions existed—or an unfinished review. Check the actual report.</p></section>
    <section id="dashboard"><h2><span class="step">05</span> Open your private dashboard</h2><p>The agent should relay the ledger link after every completed run. To rebuild it yourself after adding decisions, run this from the same project:</p>${code('node "$HOME/.agents/skills/momm/scripts/ledger.mjs" --open', "macOS / Linux · Codex")}${code('node "$env:USERPROFILE/.agents/skills/momm/scripts/ledger.mjs" --open', "PowerShell · Codex")}<p>This opens the local <code>.ensemble_reviews/ledger.html</code>. It is not the public evidence website. Keep the evidence directory private and out of temporary folders.</p><a class="text-link" href="reference.html#troubleshooting">Something did not work? Start with the actual status →</a></section></div></div>`;
  const updates = `${hero("UPDATE SAFELY", "A newer release is news.<br><span>Not permission.</span>", "Every code change is initiated in your terminal. Review the plan, accept the policy change if there is one, and explicitly choose to install.")}
    <div class="doc-body wide"><div class="update-flow"><span>CHECK</span><b>→</b><span>PREVIEW</span><b>→</b><span>YOUR APPROVAL</span><b>→</b><span>VERIFY + INSTALL</span></div>
    ${note("First signed-release transition", "The first signed update path begins with 1.15. Older unsigned tags are not retroactively trusted or rewritten. An older installation needs an explicitly chosen clone/install of the new release before it gains this command and its installation receipt.")}
    <section><h2>1. Check the release information</h2>${code("node momm/scripts/multi-review.mjs update", "From the skills clone")}<p>Reads the public manifest, compares versions and shows intervening release notes. It does not fetch Git objects, change code, relink a harness or install a tool. Network and validation failures leave the installation alone.</p></section>
    <section><h2>2. Inspect the actual changes</h2>${code("node momm/scripts/multi-review.mjs update --dry-run", "Preview only")}<p>This explicitly fetches the candidate into disposable staging and verifies its signature. The plan names the remote, tag, changed files and exact installation scopes. It shows the <code>SKILL.md</code> diff plus the full dispatcher diff, conservatively covering default rules and reviewer personas.</p><p>Because skills are linked from one shared clone, the plan includes sibling-skill and repository changes too. Your project’s own <code>.reviewrules</code> is not rewritten.</p></section>
    <section><h2>3. Choose whether to install</h2>${code("node momm/scripts/multi-review.mjs update --apply", "Apply with interactive confirmation")}<p>A changed protocol requires another explicit decision:</p>${code("node momm/scripts/multi-review.mjs update --apply --accept-protocol", "After reading the policy diff")}<p>For a script, add <code>--yes</code> to acknowledge the install plan. It never substitutes for <code>--accept-protocol</code>. There is no automatic-update flag.</p><p>The updater refuses a dirty checkout, verifies the signed package and SHA-256, checks out the exact commit in detached-HEAD state, and replays only the installation scopes in the receipt. It records success only after checking the resulting checkout and relinks.</p></section>
    <section><h2>Choose a channel, without changing code</h2>${code("node momm/scripts/multi-review.mjs update --channel pinned", "Freeze your validated version")}<div class="table-wrap" tabindex="0"><table><thead><tr><th>Channel</th><th>What can move it?</th></tr></thead><tbody><tr><td>stable · default</td><td>An explicit apply of a verified signed release tag.</td></tr><tr><td>pinned</td><td>An explicit version, for example <code>--apply --version ${esc(version)}</code>. Daily notices are suppressed.</td></tr><tr><td>main</td><td>An explicit apply of a development checkpoint signed by the release workflow. An unsigned branch head is refused; this is not a signature bypass.</td></tr></tbody></table></div></section>
    <section><h2>Return to the previous installation</h2>${code("node momm/scripts/multi-review.mjs update --rollback", "Rollback · no release download")}<p>The previous commit, package digest and harness receipt are retained locally. If a release switch or interrupted process removes the regular updater, use the recovery command printed at installation/update. For a normal clone:</p>${code("node .git/momm/update.mjs --rollback --yes", "Retained recovery runner")}<p>Rollback checks the retained Git objects and refuses to overwrite local edits. It is not a backup for a deleted clone, missing Git objects, removed harness tools or a damaged disk. Interrupted relinking may need the named prerequisite restored before recovery can finish. Git worktrees have a different administrative path; use the exact printed recovery path.</p></section>
    <section><h2>Trust on the way in</h2><p>Signed tags are checked using <a href="https://github.com/sigstore/gitsign">gitsign</a>, against the exact repository release-workflow identity and GitHub’s OIDC issuer. The updater does not install gitsign silently. If it is missing, install it deliberately using its official instructions and retry.</p><p>Verification can contact Sigstore’s trust and transparency services as well as GitHub. Package hashes cover Git’s canonical tracked file bytes, modes and paths, excluding <code>versions.json</code> to avoid a self-referential digest. Reports separately record hashes of the installed dispatcher, updater and protocol bytes.</p><p>A signature establishes release provenance—not correctness. Tests, review and your protocol acceptance still matter.</p></section>
    <section><h2>The daily check stays a check</h2><p>A once-per-day notice makes one unauthenticated request for the public manifest, and never fetches code. <code>NO_UPDATE_CHECK=1</code> or <code>DO_NOT_TRACK=1</code> disables it. Explicitly running <code>update</code> is still your request for release information.</p><p>If an agent sees a newer version, it must tell you and stop the update workflow. It must not run <code>--apply</code> on its own initiative. Setup Center’s update button opens the same preview—not <code>git pull</code>.</p></section></div>`;
  const rate = v => v === null ? "—" : `${Math.round(v * 100)}%`;
  const table = `<div class="table-wrap" tabindex="0" aria-label="Reviewer route statistics, scroll horizontally"><table><caption>Completion and timing: stored reports. Decision columns: all recorded dispositions attributed to one named route, including runs without a stored report.</caption><thead><tr><th>CLI route</th><th>Completed</th><th>Timeouts</th><th>Other failures</th><th>Median s</th><th>p90 s</th><th>Applied</th><th>Rejected</th><th>Deferred</th><th>Other</th><th>Acceptance</th></tr></thead><tbody>${s.routes.map(r => `<tr><th>${esc(r.route)}</th><td>${r.completed}</td><td>${r.timeouts}</td><td>${r.other}</td><td>${r.median_s ?? "—"}</td><td>${r.p90_s ?? "—"}</td><td>${r.applied}</td><td>${r.rejected}</td><td>${r.deferred}</td><td>${r.historical_other}</td><td>${rate(r.acceptance)}</td></tr>`).join("")}</tbody></table></div>`;
  const evidence = `${hero("EVIDENCE, WITH ITS LIMITS", "Every number needs<br><span>a denominator.</span>", "A reproducible snapshot of the project’s own development reviews. Not an independent benchmark. Not a promise about your code.")}
    <section class="snapshot"><p class="eyebrow">SNAPSHOT / ${snapshot} · <a href="../evidence/momm-evidence.json">Download JSON</a> · <a href="../evidence/momm-evidence.json.sha256">SHA-256 sidecar</a></p><div class="stat-trio"><div><strong>${s.runs}</strong><span>recorded runs</span></div><div><strong>${s.stored_reports}</strong><span>stored reports</span></div><div><strong>${s.dispositions}</strong><span>decision records</span></div></div></section>
    <section class="doc-body wide"><h2>Why the totals differ—and reconcile</h2><p>Run logs record <strong>${s.log_successes} successful reviewer responses</strong>. The detailed stored reports contain ${s.stored_successes}; the remaining ${s.summary_only_successes} are represented by summary records only. The route table below uses stored reports, not all run logs.</p><div class="decision-bars">${Object.entries(s.decisions).map(([k, v]) => `<div><span>${esc(k.replaceAll("_", " "))}</span><meter min="0" max="${s.dispositions}" value="${v}" aria-label="${esc(k)} decisions">${v}</meter><strong>${v}</strong></div>`).join("")}</div><p>The historical “other” bucket preserves old labels such as <code>recommended</code>; we do not invent retrospective rulings. ${s.coalition.total} coalition or multiple-route decisions (${s.coalition.applied} applied, ${s.coalition.rejected} rejected, ${s.coalition.deferred} deferred, ${s.coalition.historical_other} other) are separate from single-route rows.</p>
    <h2>Route-level development record</h2>${table}<p>Acceptance = applied ÷ (applied + rejected), according to this project’s governor. It is <em>not</em> precision against a labeled ground truth. Timing percentiles use the nearest-rank method on successful stored responses; failed routes are not hidden in the completed count.</p><p><a href="data/routes.csv">Routes CSV</a> · <a href="data/routes.md">Markdown table</a> · <a href="data/decisions-by-attribution.csv">All attribution buckets</a> · <a href="data/dispositions.csv">Decision records CSV</a> · <a href="data/runs.csv">Run records CSV</a> · <a href="data/public-stats.json">Generated statistics</a></p>
    <section id="real-review"><h2>A fix—and a claim we did not trust</h2><div class="proof-pair"><article><span class="tag good">REPRODUCED + FIXED</span><h3>A timeout reported as a normal exit</h3><p>Development review <code>rev_20260904131435_mf6w</code> identified a supervisor-state problem. The driving agent investigated it and added the <code>timeout_reports_timed_out</code> regression test.</p><a href="https://github.com/marroccofella/skills/blob/main/momm/references/release-1.13.0.md">Read the release’s verification record →</a></article><article><span class="tag caution">CRITICAL CLAIM REJECTED</span><h3>Severity is a claim too</h3><p>Follow-up review <code>rev_20260904134630_bl2v</code> included a CRITICAL claim that did not survive reproduction. The rejection and reasoning remain in the same public evidence export.</p><a href="../evidence/index.html">Inspect the public ledger by run ID →</a></article></div><p class="micro">These are developer-recorded decisions about MOMM’s own code. The export preserves their evidence trail; it does not independently validate every historical claim.</p></section>
    <h2>Which bytes does a hash cover?</h2><dl class="definitions"><dt>Snapshot sidecar</dt><dd>The exact downloaded <code>momm-evidence.json</code> bytes. You can recompute this locally.</dd><dt><code>stored_report_sha256</code></dt><dd>Original private report bytes before sanitization. Provenance only; it cannot validate the altered public object.</dd><dt><code>public_report_sha256</code></dt><dd>The sanitized report serialized as compact UTF-8 JSON with recursively sorted object keys; array order is retained. The renderer and CI recompute every one.</dd><dt>Executable hashes</dt><dd>New reports identify the actual installed dispatcher, updater and protocol file bytes. A version string alone is not evidence that two executions used identical code.</dd></dl>
    <h2>How this page stays in sync</h2><p>One offline renderer reads the committed public snapshot and generates this page, its tables and downloadable data. CI compares the regenerated outputs byte for byte, checks the ledger’s embedded data, and verifies the public hashes. Refreshing the site does not import private ledgers or change the snapshot’s date.</p><p><a href="https://github.com/marroccofella/skills/blob/main/CONTRIBUTING.md">Reproduce the public build →</a></p></section>`;
  const reference = `${hero("REFERENCE", "Know what MOMM does.<br><span>And what it cannot prove.</span>", "The protocol is intentionally stricter than a model’s confidence. These are the boundaries to understand before using it on important work.")}
    <div class="doc-body wide"><section><h2>Who does what?</h2><dl class="definitions"><dt>Governor</dt><dd>Your current coding agent. It remains the sole writer, reproduces material findings, verifies changes and records decisions. It is excluded from peer review.</dd><dt>Reviewer route</dt><dd>An installed provider CLI using an OAuth/account session. Its inner model depends on your account and configuration; a CLI name is not a model ID.</dd><dt>Finding</dt><dd>A reviewer's claim about a defect. Agreement affects investigation priority, not truth.</dd><dt>Disposition</dt><dd>The governor’s recorded ruling: applied, applied-with-modification, rejected or deferred. Applied rulings name checkable verification.</dd></dl></section>
    <section id="privacy"><h2>What leaves your machine?</h2><p>Review input, optional project rules and the review contract go to the selected providers through their official CLIs. Inputs are sanitized first, but no automatic redactor can certify that a document is safe to share.</p><p>Prompt instructions are not filesystem isolation. Provider CLI tools may discover additional local metadata; use approved source-sharing contexts and platform permission controls. On Windows, ordinary helpers surviving a normal leader exit are not guaranteed to be contained; stronger OS job ownership remains open.</p><p>The daily version notice requests a public manifest. Setup Center’s explicit maintenance checks may query package versions and provider model lists. Connectivity tests send a disclosed synthetic sentence. Review history is not uploaded by these checks.</p><p>The private evidence directory stays local and gitignored. Publishing is a separate, explicit sanitized-export workflow. Never publish another user’s ledger by treating it as a page asset.</p></section>
    <section id="troubleshooting"><h2>Start with the actual failure</h2><div class="table-wrap" tabindex="0"><table><thead><tr><th>Status</th><th>Meaning and next action</th></tr></thead><tbody><tr><td>authentication_required</td><td>Use the exact <code>login_hint</code> emitted for that provider. Complete its browser login yourself. No API-key fallback.</td></tr><tr><td>provider_unavailable</td><td>A transient provider outage; MOMM already retries once. Wait and retry later. Re-login is not the default fix.</td></tr><tr><td>ineligible_tier</td><td>The provider rejected that account tier. Read the reported licensing/migration guidance; another login will not change eligibility.</td></tr><tr><td>missing / unsupported</td><td>The CLI is absent or the requested capability has no verified adapter. Read preflight’s specific explanation.</td></tr><tr><td>timeout / invalid_output</td><td>No usable review was obtained. Inspect the detail, narrow the input or choose another ready route. Do not count this as an ACCEPT.</td></tr><tr><td>self_excluded</td><td>The governor is correctly excluded. It is not a failed external review.</td></tr><tr><td>Update verification refused</td><td>Read the named prerequisite, signature, hash, dirty-tree or receipt error. Do not bypass it with a manual pull and call the update verified.</td></tr></tbody></table></div></section>
    <section><h2>Useful commands</h2>${code("node momm/scripts/multi-review.mjs --help\nnode momm/scripts/multi-review.mjs --doctor --pretty\nnode momm/scripts/multi-review.mjs --stats\nnode momm/scripts/multi-review.mjs update --help", "From the skills clone · diagnostics")}<p>For a project review use the installed script’s absolute path while staying in that project. <code>--min-success 1</code> requires at least one successful external reviewer; use an appropriate higher quorum for a release gate. <code>--stream</code> keeps structured progress separate from the final report.</p></section>
    <section><h2>Does it mechanically enforce every reproduction?</h2><p>No. The governor validator checks source hashes, item decisions and recorded test evidence; it cannot prove that an observation is honest or a test adequate. It never executes peer-supplied test instructions. Treat the tests, code and disposition evidence as the checkable record.</p><h2>Is a unanimous ACCEPT enough?</h2><p>No. It only says the successful reviewers returned ACCEPT. Missing, timed-out or invalid routes do not join that verdict, and agreement never replaces your project’s tests.</p><h2>Does it work identically on every machine?</h2><p>No blanket guarantee is justified. The CI matrix is configured for Windows, macOS and Linux on Node 18, 20 and 22; check its result for the exact revision you use. Actual provider behavior also depends on CLI versions, account eligibility, quotas, network access and sandbox access to OAuth stores.</p><h2>What remains open?</h2><p>Large-input route reliability, containment of independently detached processes, unsupported source-snapshot types and broader independent evaluations remain distinct work. This release does not claim to have solved them with an update command or a new website.</p><p><a href="https://github.com/marroccofella/skills/blob/main/momm/ROADMAP.md">Read the maintained roadmap →</a></p></section></div>`;
  return Object.fromEntries([["index.html", "Independent reviews. Explicit decisions.", overview], ["start.html", "Get started", start], ["updates.html", "Update safely", updates], ["evidence.html", "Evidence", evidence], ["reference.html", "Reference", reference]].map(([f, t, b]) => [`docs/momm/${f}`, shell(f, t, b, version)]));
}
export function renderPublic({ root = ROOT, check = false, sourceData } = {}) {
  const sourceFile = path.join(root, "docs/evidence/momm-evidence.json");
  // Validate and build the complete output set before the first write. Exporters
  // supply new data in memory; they must not stage it over the last good snapshot.
  const data = sourceData === undefined ? JSON.parse(fs.readFileSync(sourceFile, "utf8")) : structuredClone(sourceData);
  for (const record of Object.values(data.reports)) {
    record.public_report_sha256 = sha(JSON.stringify(canonical(record.report)));
    record.public_hash_covers = "compact-utf8-json-recursive-key-sort/1";
  }
  data.note = "stored_report_sha256 identifies private source bytes before sanitization; public_report_sha256 verifies the sanitized report using its declared canonical serialization. The export sidecar verifies the whole public file.";
  data.sanitization = "User home/workspace paths normalized and private ledger links removed. Reviewer prose may quote source. Input text is absent by default but can be stored with explicit --store-input; this historical public snapshot contains some such inputs. Private-to-public export requires separate authorization and inspection.";
  const json = JSON.stringify(data), s = stats(data), manifest = JSON.parse(fs.readFileSync(path.join(root, "versions.json"))), version = manifest.momm;
  const tour = JSON.parse(fs.readFileSync(path.join(root, "docs/momm/tour.json"), "utf8"));
  const films = JSON.parse(fs.readFileSync(path.join(root, 'docs/momm/films.json'), 'utf8'));
  const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'momm/references/release-history.json'), 'utf8'));
  const published = catalogue.some(r => r.version === version && r.kind === 'release' && r.tag && r.published_date);
  if (Object.values(s.decisions).reduce((a, b) => a + b, 0) !== s.dispositions) throw new Error("Disposition buckets do not reconcile");
  for (const key of Object.keys(s.decisions)) if (s.routes.reduce((n, r) => n + r[key], 0) + s.coalition[key] !== s.decisions[key]) throw new Error(`Attribution buckets do not reconcile: ${key}`);
  if (s.summary_only_successes < 0) throw new Error("Stored successes exceed run log successes; reconcile the source export first");
  const output = { ...pages(data, s, version), ...releasePages(root),
    'docs/momm/technical.html': shell('technical.html', 'Architecture and reviewer-stacking evidence', technicalBody(data, s, version), version).replace('</head>', '<script type="module" src="stacking-model.mjs"></script></head>'),
    'docs/momm/data/ensemble-observations.json': JSON.stringify(ensembleObservations(data), null, 2) + '\n',
    "docs/evidence/momm-evidence.json": json,
    "docs/evidence/momm-evidence.json.sha256": `${sha(json)}  momm-evidence.json\n`,
    "docs/momm/data/public-stats.json": JSON.stringify(s, null, 2) + "\n" };
  // A recorded video never silently inherits a newer version. The banner uses
  // the publication manifest, while historical notes retain their own identity.
  const banner = prefix => `<aside class="stable-banner" aria-label="${published?'Current stable release':'Checkout version; publication not recorded'}"><a href="${prefix}releases/${esc(version)}.html"><span class="dot"></span> ${published?'CURRENT STABLE':'CHECKOUT VERSION · CHECK PUBLICATION'} <strong>MOMM ${esc(version)}</strong></a><a href="${prefix}releases/upgrade.html">Install / upgrade guide →</a></aside>`;
  for (const file of Object.keys(output).filter(f => f.startsWith('docs/momm/') && f.endsWith('.html'))) {
    const prefix = file.includes('/releases/') ? '../' : '';
    output[file] = output[file].replace('</header>', '</header>' + banner(prefix))
      .replace('</head>', `<link rel="icon" type="image/svg+xml" href="${prefix}favicon.svg"></head>`);
  }
  output['docs/momm/index.html'] = output['docs/momm/index.html']
    .replace(/<div class="reviewers">[\s\S]*?<\/div>/, () => `<div class="reviewers">${['codex','claude','antigravity','copilot','grok'].map(r=>brandBadge(r)).join('')}</div>`)
    .replace('<section class="principles">', () => homeCinema(tour, version, films) + '<!-- MOMM HOME COMPANIONS -->' + homeDiagrams(data, s, version) + '<section class="principles">')
    .replace('<section class="principles">', () => releasePanel(manifest, published) + '<section class="principles">')
    .replace('</head>', '<link rel="stylesheet" href="home.css"><script type="module" src="home-player.mjs"></script></head>')
    .replace('See a real review</a>', 'See a real review</a><a class="button" href="#walkthrough">Watch / read the tour ↓</a>');
  output['docs/momm/start.html'] = output['docs/momm/start.html'].replace('<section id="install">', `<section class="notice"><h2>Recommended: let your agent verify the release first</h2><p><a class="button primary" href="releases/upgrade.html">Copy the new-user / upgrade prompt →</a></p><p>A clone starts on the default branch, which can contain unreleased work. Before executing the manual installer below, select the published signed release, verify its expected signing identity and package hash, and read its installer help. The copyable prompt covers those steps and asks before installing missing prerequisites.</p></section><section id="install">`);
  const releaseEvidence = releaseChecks(catalogue, version);
  output['docs/momm/evidence.html'] = output['docs/momm/evidence.html']
    .replace('<h2>Why the totals differ', () => releaseEvidence + '<h2>Why the totals differ')
    .replace('<section id="real-review">', () => evidenceVisuals(data, s) + '<section id="real-review">')
    .replace('Read the release’s verification record →', 'Read the historical 1.13.0 fix record →');
  output['docs/momm/reference.html'] = output['docs/momm/reference.html'].replace('<section id="privacy">', `<section id="modalities"><h2>Not just code: prose and supported attachments</h2><p>Use MOMM for manuscripts, specifications and other text when sharing with the selected providers is permitted. The same rule applies: reviewers make claims; the governor verifies and records decisions.</p><p>Text routes include Codex, Claude Code, Antigravity, Copilot and Grok. Verified attachment adapters differ: Codex supports images; Claude supports images and PDFs; Gemini supports images, PDFs, audio and video where the account is eligible. Other routes stay text-only until verified. Run preflight for the installed adapter’s actual capability; a provider logo is not evidence of multimedia support.</p><p>The historical public ledger contains the manuscript specimen <code>rev_20260904131823_wvxh</code>. <a href="../evidence/index.html">Inspect the sanitized specimen →</a> · <a href="https://github.com/marroccofella/skills/blob/main/momm/SKILL.md">Read the current protocol ↗</a></p><p>Strict review-contract rejection and input/source size ceilings remain possible. The source completion validator covers local text and supported Git text additions/modifications, not every binary, rename, deletion or media lifecycle.</p></section><section id="privacy">`);
  output['docs/momm/reference.html'] = output['docs/momm/reference.html'].replace('</main>', () => answerSection()+'</main>');
  output['docs/momm/index.html'] = output['docs/momm/index.html'].replace('<section class="cta">','<section class="doc-body wide"><h2>New to MOMM?</h2><p><a href="reference.html#questions">Read the answers about reviewers, privacy, costs, installation and evidence →</a></p></section><section class="cta">');
  output['docs/momm/index.html'] = output['docs/momm/index.html'].replace('<section class="cta">', () => projectStory()+'<section class="cta">');
  output['docs/momm/evidence.html'] = output['docs/momm/evidence.html'].replace('<section id="real-review">', () => evidenceBenefits(s)+'<section id="real-review">');
  output['docs/momm/data/route-outcomes.json'] = JSON.stringify(chartSeries(data).routes, null, 2) + '\n';
  const ledger = fs.readFileSync(path.join(root, "docs/evidence/index.html"), "utf8");
  const block = /<script id="data" type="application\/json">[\s\S]*?<\/script>/;
  if (!block.test(ledger)) throw new Error("Public ledger data marker is missing");
  output["docs/evidence/index.html"] = ledger.replace(block, () => `<script id="data" type="application/json">${json.replaceAll("<", "\\u003c")}</script>`);
  // Keep the public CSV's original columns at their existing URLs. New fields
  // are additive; internal page-statistic names are not the download contract.
  const routeKeys = ["route", "completed_reviews", "timeouts", "other_failures", "median_seconds", "p90_seconds", "accept_verdicts", "modify_verdicts", "reject_verdicts", "mean_confidence", "suggestions_applied", "suggestions_rejected", "governor_acceptance_rate", "deferred", "historical_other"];
  const downloadRoutes = s.routes.map(r => {
    const peers = Object.values(data.reports).flatMap(x => x.report.reviewers || []).filter(p => p.agent === r.route && p.status === 'success');
    const confidence = peers.map(p => p.confidence).filter(Number.isFinite);
    return { route:r.route, completed_reviews:r.completed, timeouts:r.timeouts, other_failures:r.other,
      median_seconds:r.median_s, p90_seconds:r.p90_s, accept_verdicts:peers.filter(p=>p.verdict==='ACCEPT').length,
      modify_verdicts:peers.filter(p=>p.verdict==='MODIFY').length, reject_verdicts:peers.filter(p=>p.verdict==='REJECT').length,
      mean_confidence:confidence.length ? confidence.reduce((a,b)=>a+b,0)/confidence.length : null,
      suggestions_applied:r.applied, suggestions_rejected:r.rejected, governor_acceptance_rate:r.acceptance,
      deferred:r.deferred, historical_other:r.historical_other };
  });
  output["docs/momm/data/routes.csv"] = csv([routeKeys, ...downloadRoutes.map(r => routeKeys.map(k => r[k]))]);
  output["docs/momm/data/routes.md"] = ["Stored-report cohort; acceptance is the governor's recorded applied / (applied + rejected), not measured accuracy. Confidence is self-reported, not calibrated accuracy.", "", `| ${routeKeys.join(" | ")} |`, `| ${routeKeys.map(() => "---").join(" | ")} |`, ...downloadRoutes.map(r => `| ${routeKeys.map(k => r[k] ?? "—").join(" | ")} |`)].join("\n") + "\n";
  output["docs/momm/data/routes.md"] = output["docs/momm/data/routes.md"].replace("Stored-report cohort;", "Completion/timing use stored reports; decisions use all recorded single-route dispositions;");
  output["docs/momm/data/decisions-by-attribution.csv"] = csv([["attribution", "applied", "rejected", "deferred", "historical_other"], ...[...s.routes.map(r => ({ attribution: r.route, ...r })), { attribution: "coalition_or_multiple", ...s.coalition }].map(r => [r.attribution, r.applied, r.rejected, r.deferred, r.historical_other])]);
  const runKeys = ["run_id", "timestamp", "governor", "input_bytes", "findings", "corroborated", "reviewer_status", "subject"];
  output["docs/momm/data/runs.csv"] = csv([runKeys, ...data.runs.map(r => {
    const row = {...r, findings:r.findings_count, corroborated:r.corroborated_count,
      reviewer_status:Object.entries(r.reviewer_status || {}).map(([agent,status])=>`${agent}:${status}`).join(' ')};
    return runKeys.map(k => row[k]);
  })]);
  const decisionKeys = ["timestamp", "run_id", "reviewer", "disposition", "suggestion", "reason"];
  output["docs/momm/data/dispositions.csv"] = csv([decisionKeys, ...data.dispositions.map(d => decisionKeys.map(k => d[k]))]);
  output["docs/momm/data/findings-by-severity.csv"] = csv([["severity", "findings"], ...Object.entries(s.severity)]);
  output["docs/momm/data/runs-per-day.csv"] = csv([["day", "runs"], ...Object.entries(s.by_day).sort()]);
  output["docs/momm/data/input-size-vs-time.csv"] = csv([["input_kb", "routes_dispatched", "routes_timed_out", "slowest_completed_seconds"], ...Object.values(data.reports).map(r => r.report).filter(r => r.input_bytes).map(r => {
    const peers = r.reviewers || [];
    const measured = peers.filter(p => p.status === 'success' && Number.isFinite(p.duration_ms) && p.duration_ms >= 0).map(p => p.duration_ms);
    return [+(r.input_bytes / 1024).toFixed(1), peers.filter(p => p.status !== "self_excluded").length, peers.filter(p => p.status === "timeout").length, measured.length ? +(Math.max(...measured) / 1000).toFixed(1) : null];
  })]);
  const downloads = [["routes.csv", "Route completion/timing from stored reports; all single-route decision counts and governor acceptance"], ["routes.md", "The same route table as Markdown"], ["route-outcomes.json", "Stored external-result denominators, self-exclusions and actual failure categories"], ["decisions-by-attribution.csv", "Every decision bucket, including coalition/multiple attribution"], ["public-stats.json", "The generated page statistics and explicit denominators"], ["runs.csv", "Run ID, timestamp, governor, input size, finding counts and subject"], ["dispositions.csv", "Recorded decisions and reasons"], ["findings-by-severity.csv", "Findings in stored reports, grouped by severity"], ["runs-per-day.csv", "Recorded runs by date"], ["input-size-vs-time.csv", "Stored-report input sizes, non-self-excluded route results, timeouts and successful durations. Blank slowest_completed_seconds means no successful timed response; never zero seconds."]];
  output["docs/momm/data/index.html"] = shell("evidence.html", "Evidence downloads", `${hero("PUBLIC DATA CATALOGUE", "The numbers,<br><span>in reusable form.</span>", "Generated from the same committed public snapshot as the information pages. Read the cohort definitions before comparing columns.")}<div class="doc-body wide"><p>Snapshot: ${esc(s.generated)}. This is project development evidence, not measured accuracy.</p><div class="table-wrap"><table><thead><tr><th>Download</th><th>Contents</th></tr></thead><tbody>${downloads.map(([f, d]) => `<tr><td><a href="${f}">${f}</a></td><td>${d}</td></tr>`).join("")}</tbody></table></div><p><a href="../evidence.html">Read the evidence definitions →</a></p></div>`, version).replace('href="site.css"', 'href="../site.css"').replace('src="site.js"', 'src="../site.js"').replace(/href="(index|start|updates|evidence|reference)\.html"/g, 'href="../$1.html"');
  output["docs/momm/data/index.html"] = output["docs/momm/data/index.html"].replace('href="releases/index.html"', 'href="../releases/index.html"').replace('href="technical.html"', 'href="../technical.html"');
  output['docs/momm/data/index.html'] = output['docs/momm/data/index.html'].replace('</header>', '</header>' + banner('../')).replace('</head>', '<link rel="icon" type="image/svg+xml" href="../favicon.svg"></head>');
  const hub = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
  const versionMarker = /<span data-momm-version>[^<]*<\/span>/g;
  if ([...hub.matchAll(versionMarker)].length !== 1) throw new Error('Hub must contain exactly one MOMM version marker');
  output['docs/index.html'] = hub.replace(versionMarker, () => `<span data-momm-version>${esc(version)}</span>`);
  enhanceSearch(output, {version, catalogue});
  for (const file of Object.keys(output).filter(f => f.startsWith('docs/momm/') && f.endsWith('.html'))) {
    const prefix = file.includes('/releases/') || file.includes('/data/') ? '../' : '';
    output[file] = output[file].replace('</head>', `<link rel="stylesheet" href="${prefix}technical.css"></head>`);
  }
  addAttribution(output);
  Object.assign(output, watchOutputs(tour, version, root));
  const videoSitemaps=[output['docs/video-sitemap.xml']];
  for(const film of films){
    const pages=watchOutputs(film,version,root,film.id);
    videoSitemaps.push(pages['docs/video-sitemap.xml']);
    delete pages['docs/video-sitemap.xml']; Object.assign(output,pages);
  }
  const videoEntries=videoSitemaps.filter(Boolean).flatMap(xml=>[...xml.matchAll(/<url>[\s\S]*?<\/url>/g)].map(m=>m[0]));
  output['docs/video-sitemap.xml']='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">'+videoEntries.join('')+'</urlset>\n';
  // lastmod is optional. Do not mislabel the evidence snapshot date, build time
  // or a moving Git HEAD as the last meaningful edit of every generated page.
  const urls = Object.keys(output).filter(f => f.endsWith('.html')).map(f =>
    'https://marroccofella.github.io/skills/' + f.slice('docs/'.length).replace(/(^|\/)index\.html$/, '$1')).sort();
  // Sibling skill guides are maintained outside the MOMM renderer.
  // Explicit publication catalogue: untracked scratch directories cannot add URLs.
  for (const name of ['evidence', 'myautoness', 'myrepo', 'myskills', 'mytravel', 'myvoice', 'yorky']) {
    if (fs.existsSync(path.join(root, 'docs', name, 'index.html'))) {
      urls.push(`https://marroccofella.github.io/skills/${name}/`);
    }
  }
  urls.sort();
  const videoByUrl=new Map(videoEntries.map(entry=>[entry.match(/<loc>(.*?)<\/loc>/)[1],entry.match(/<video:video>[\s\S]*?<\/video:video>/)[0]]));
  output['docs/sitemap.xml'] = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n'
    + [...new Set(urls)].map(url => `  <url><loc>${esc(url)}</loc>${videoByUrl.get(url)||''}</url>`).join('\n') + '\n</urlset>\n';
  const stale = [];
  for (const [file, text] of Object.entries(output)) {
    const dest = path.join(root, file);
    if (check) { if (!fs.existsSync(dest) || fs.readFileSync(dest, "utf8") !== text) stale.push(file); }
    else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); }
  }
  if (stale.length) throw new Error(`Public outputs are stale. Run node scripts/render-momm-site.mjs:\n${stale.join("\n")}`);
  return { checked: check, files: Object.keys(output).length, runs: s.runs, reports: s.stored_reports, decisions: s.decisions, snapshot: s.generated };
}
function isEntrypoint() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (isEntrypoint()) {
  if (process.argv.slice(2).some(a => a !== "--check")) throw new Error("Usage: node scripts/render-momm-site.mjs [--check]");
  process.stdout.write(JSON.stringify(renderPublic({ check: process.argv.includes("--check") }), null, 2) + "\n");
}
