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
  const subject = run.label ?? "";
  const statuses = Object.entries(run.reviewer_status ?? {}).map(([agent, status]) => `<span class="st st-${esc(status)}" title="${esc(agent)}: ${esc(status)}">${esc(agent)}</span>`).join(" ");
  const detail = rpt ? `<details><summary>full transcript · ${rpt.findings.length} finding${rpt.findings.length === 1 ? "" : "s"} · report sha256 ${esc(reports[run.run_id].sha256.slice(0, 12))}…</summary>
    ${rpt.reviewers.filter((r) => r.status === "success").map((r) => `<div class="rev"><b>${esc(r.agent)}</b> <span class="dim">${esc(HARNESS[r.agent] ?? "")}${r.persona ? ` · persona: ${esc(r.persona)}` : ""}${r.duration_ms ? ` · ${(r.duration_ms / 1000).toFixed(1)}s` : ""}</span><span class="v v-${esc(r.verdict)}">${esc(r.verdict)}</span>${r.confidence != null ? ` <span class="dim">conf ${r.confidence}</span>` : ""}<p>${esc(r.summary ?? "(verdict without prose — see suggestions)")}</p>${r.suggested_improvements?.length ? `<ul>${r.suggested_improvements.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}</div>`).join("")}
    ${rpt.findings.length ? `<h4>Findings — claims awaiting reproduction</h4>${rpt.findings.map((f) => `<div class="find f-${esc(f.severity)}"><b>${esc(f.severity)}</b> ${esc(f.id)} <span class="dim">by ${(f.sources ?? []).join(", ")}</span><p>${esc(f.issue)}</p></div>`).join("")}` : ""}
    ${dispositions.filter((d) => d.run_id === run.run_id).length ? `<h4>Your dispositions</h4><table><tr><th>reviewer</th><th>suggestion</th><th>disposition</th><th>reason</th></tr>${dispositions.filter((d) => d.run_id === run.run_id).map((d) => `<tr><td>${esc(d.reviewer)}</td><td>${esc(d.suggestion)}</td><td class="d-${esc(d.disposition)}">${esc(d.disposition)}</td><td>${esc(d.reason)}${d.evidence ? `<br><span class="dim">evidence: ${esc(d.evidence)}</span>` : ""}</td></tr>`).join("")}</table>` : ""}
  </details>` : `<span class="dim">summary-only record</span>`;
  return `<article class="run"><header><b>${esc(subject || run.run_id)}</b> <span class="dim">${esc(new Date(run.timestamp).toLocaleString())} · gov ${esc(run.governor)} · ${run.findings_count ?? 0} findings${subject ? ` · ${esc(run.run_id)}` : ""}</span></header><div>${statuses}</div>${detail}</article>`;
}).join("\n");

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
  .d-applied{color:var(--accent)}.d-rejected{color:var(--warn)}
  h4{margin:12px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
</style>
<h1><span>◆</span> My momm ledger <span class="dim">· ${runs.length} runs · ${Object.keys(reports).length} sealed reports · ${dispositions.length} dispositions</span></h1>
<p class="note">${esc(data.private_note)} Generated ${esc(data.generated)}.</p>
${rows || '<p class="dim">No runs recorded yet.</p>'}
<p class="dim">Reviewer names identify harness CLIs, not inner model identities. Reports are content-addressed: quotes resolve to files whose sha256 is recorded beside them.</p>`;

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
