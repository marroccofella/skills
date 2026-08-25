#!/usr/bin/env node
// momm ledger — builds YOUR private review dashboard from this machine's own
// telemetry. The output normally lands inside the git root's locally excluded
// .ensemble_reviews/ directory and MOMM never publishes it automatically.
// No network, no accounts, no server.
//
//   node momm/scripts/ledger.mjs            # build from ./.ensemble_reviews
//   node momm/scripts/ledger.mjs --open     # build and open in your browser
//   node momm/scripts/ledger.mjs --self-test
//
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { assertSafeEvidencePath, completionStatus, ensureEvidenceZone, protectEvidenceFromGit, readBoundedText, readReviewLog, resolveEvidenceContext } from "./review-completion.mjs";

const REVIEWER_NAMES = new Map([
  ["codex", "Codex"],
  ["claude", "Claude Code"],
  ["antigravity", "Antigravity"],
  ["copilot", "GitHub Copilot"],
  ["grok", "Grok"],
  ["gemini", "Gemini"],
]);
const GOVERNOR_NAMES = new Map([...REVIEWER_NAMES, ["other", "another controller"]]);
const STATUS_PHRASES = new Map([
  ["success", "completed"],
  ["authentication_required", "needs sign in"],
  ["provider_unavailable", "provider unavailable"],
  ["ineligible_tier", "account tier unavailable"],
  ["timeout", "timed out"],
  ["missing", "not installed"],
  ["invalid_output", "returned invalid output"],
  ["disabled_no_oauth", "disabled because OAuth is unavailable"],
  ["unsupported", "unsupported"],
  ["error", "failed"],
]);
const VERDICT_PHRASES = new Map([
  ["ACCEPT", "accept"],
  ["MODIFY", "modify"],
  ["REJECT", "reject"],
]);
const SEVERITY_PHRASES = new Map([
  ["CRITICAL", "critical"],
  ["WARNING", "warning"],
  ["NITPICK", "nitpick"],
]);
const KNOWN_STATUSES = new Set([...STATUS_PHRASES.keys(), "self_excluded"]);
const COMPLETION_PHRASES = new Map([
  ["pending", "governor adjudication pending"],
  ["complete_no_action", "governor verification complete; no findings or suggestions required decisions"],
  ["complete_clean", "governor adjudication complete"],
  ["complete_with_open_findings", "governor adjudication complete with open findings"],
  ["blocked_peer_gate", "peer review gate not met"],
  ["invalid", "completion evidence invalid"],
  ["legacy_unverifiable", "legacy run; completion cannot be verified"],
]);
const MAX_LABEL_LENGTH = 80;
const MAX_NARRATION_LENGTH = 700;
const MAX_DISPOSITIONS_BYTES = 32 * 1024 * 1024;
const MAX_LEDGER_REPORT_BYTES = 32 * 1024 * 1024;
const MAX_EXISTING_LEDGER_BYTES = 32 * 1024 * 1024;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const asArray = (value) => Array.isArray(value) ? value : [];
const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const normalizedToken = (value) => String(value ?? "").trim().toLowerCase();
const cleanUserLabel = (value) => {
  const clean = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return clean.length <= MAX_LABEL_LENGTH ? clean : `${clean.slice(0, MAX_LABEL_LENGTH - 1)}…`;
};
const safeRunId = (value) => {
  const id = String(value ?? "");
  return /^rev_[A-Za-z0-9_-]{1,72}$/.test(id) ? id : "unnamed run";
};
const safeDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "unknown date" : date.toISOString().slice(0, 10);
};

function externalRouteEvidence(runValue, reportValue) {
  const run = isRecord(runValue) ? runValue : {};
  const report = isRecord(reportValue) ? reportValue : null;
  const governor = normalizedToken(run.governor || report?.governor);
  const sealed = Array.isArray(report?.reviewers);
  const source = sealed
    ? report.reviewers.map((reviewer) => [reviewer?.agent, reviewer?.status])
    : isRecord(run.reviewer_status) ? Object.entries(run.reviewer_status) : [];
  const routes = source.slice(0, 20).flatMap(([agentValue, statusValue]) => {
    const agent = normalizedToken(agentValue);
    const status = normalizedToken(statusValue);
    if (status === "self_excluded" || (agent && agent === governor)) return [];
    return [{
      agent: REVIEWER_NAMES.has(agent) ? agent : null,
      label: REVIEWER_NAMES.get(agent) ?? "unknown reviewer",
      status: KNOWN_STATUSES.has(status) ? status : "unknown",
    }];
  });
  return {
    known: sealed || isRecord(run.reviewer_status),
    routes,
    total: routes.length,
    completed: routes.filter((route) => route.status === "success").length,
    failed: routes.filter((route) => route.status !== "success"),
  };
}

function summarizeSuggestionDecisions(values) {
  const byReviewer = new Map([...REVIEWER_NAMES.keys()].map((reviewer) => [reviewer, { reviewer, adopted: 0, qualified: 0, rejected: 0, classified: 0 }]));
  let unclassified = 0;
  for (const entry of asArray(values).filter(isRecord)) {
    const reviewer = normalizedToken(entry.reviewer);
    const disposition = normalizedToken(entry.disposition);
    const row = byReviewer.get(reviewer);
    if (!row) { unclassified += 1; continue; }
    if (disposition === "applied") row.adopted += 1;
    else if (disposition.startsWith("applied-") || disposition.startsWith("applied_")) row.qualified += 1;
    else if (disposition === "rejected") row.rejected += 1;
    else { unclassified += 1; continue; }
    row.classified += 1;
  }
  const rows = [...byReviewer.values()];
  return {
    rows,
    adopted: rows.reduce((sum, row) => sum + row.adopted, 0),
    qualified: rows.reduce((sum, row) => sum + row.qualified, 0),
    rejected: rows.reduce((sum, row) => sum + row.rejected, 0),
    classified: rows.reduce((sum, row) => sum + row.classified, 0),
    unclassified,
  };
}

const SAFE_ATTACHMENT_FORMATS = new Set(["png", "jpeg", "pdf", "mp3", "wav", "aiff", "aac", "ogg", "flac", "mp4", "mov", "webm"]);
const SAFE_ATTACHMENT_MODALITIES = new Set(["image", "pdf", "audio", "video"]);
function safeAttachmentDescriptor(value) {
  if (!isRecord(value)) return null;
  const id = /^attachment-[1-8]$/.test(String(value.id ?? "")) ? String(value.id) : null;
  const modality = SAFE_ATTACHMENT_MODALITIES.has(normalizedToken(value.modality)) ? normalizedToken(value.modality) : "unknown";
  const format = SAFE_ATTACHMENT_FORMATS.has(normalizedToken(value.format)) ? normalizedToken(value.format) : "unknown";
  const bytes = Number.isSafeInteger(value.sent_bytes) && value.sent_bytes >= 0 && value.sent_bytes <= 64_000_000 ? value.sent_bytes : null;
  const digest = /^[a-f0-9]{64}$/i.test(String(value.sent_sha256 ?? "")) ? String(value.sent_sha256).toLowerCase() : null;
  const metadata = value.metadata_status === "privacy_metadata_removed" ? "privacy metadata removed"
    : value.metadata_status === "preserved_by_explicit_opt_in" ? "metadata preserved by explicit opt-in"
      : "metadata handling unverified";
  const width = Number.isSafeInteger(value.width) && value.width > 0 && value.width <= 16_384 ? value.width : null;
  const height = Number.isSafeInteger(value.height) && value.height > 0 && value.height <= 16_384 ? value.height : null;
  return { id, modality, format, bytes, digest, metadata, width, height };
}

function safeFindingRegion(finding, descriptors) {
  if (!isRecord(finding) || !Array.isArray(finding.region) || finding.region.length !== 4) return null;
  const descriptor = descriptors.find((item) => item.id && item.id === finding.attachment_id && item.modality === "image");
  if (!descriptor) return null;
  const region = finding.region.map(Number);
  if (!region.every(Number.isSafeInteger) || region[0] < 0 || region[1] < 0 || region[2] <= 0 || region[3] <= 0) return null;
  if (descriptor.width && descriptor.height && (region[0] + region[2] > descriptor.width || region[1] + region[3] > descriptor.height)) return null;
  return { id: descriptor.id, region };
}

// Narration is composed from the user's bounded run label plus locally
// generated identity/date fields and allowlisted report vocabulary. Reviewer
// prose, finding text, suggestions, paths, and unknown field values are never
// passed to speech, even when a legacy or hand-edited report is malformed.
function narrationFor(runValue, reportValue, dispositionValue, completionValue = null) {
  const run = isRecord(runValue) ? runValue : {};
  const report = isRecord(reportValue) ? reportValue : null;
  const runDispositions = asArray(dispositionValue).filter(isRecord);
  const parts = [];
  const label = cleanUserLabel(run.label);
  const governor = GOVERNOR_NAMES.get(normalizedToken(run.governor)) ?? "unknown controller";
  parts.push(`Review ${label ? `“${label}”` : safeRunId(run.run_id)}, dated ${safeDate(run.timestamp)}, governor ${governor}.`);

  const routeEvidence = externalRouteEvidence(run, report);
  const succeeded = routeEvidence.routes.filter(({ status }) => status === "success");
  const failed = routeEvidence.failed;
  let failureText = "";
  if (failed.length) {
    const named = failed.slice(0, 4).map(({ label: agent, status }) => `${agent} ${STATUS_PHRASES.get(status) ?? "has unknown status"}`);
    if (failed.length > named.length) named.push(`${failed.length - named.length} more did not complete`);
    failureText = `; ${named.join(", ")}`;
  }
  if (routeEvidence.known) {
    parts.push(`${succeeded.length} of ${routeEvidence.total} reviewers completed${failureText}.`);
    if (succeeded.length === 0) parts.push("No external review verdict was produced.");
  } else {
    parts.push("External review outcome is unknown.");
  }

  if (report) {
    const verdicts = new Map();
    for (const reviewer of asArray(report.reviewers).filter(isRecord).slice(0, 12)) {
      const reviewerAgent = normalizedToken(reviewer.agent);
      if (normalizedToken(reviewer.status) !== "success" || reviewerAgent === normalizedToken(run.governor || report.governor)) continue;
      const raw = String(reviewer.verdict ?? "").trim().toUpperCase();
      const verdict = VERDICT_PHRASES.has(raw) ? raw : "UNKNOWN";
      verdicts.set(verdict, (verdicts.get(verdict) ?? 0) + 1);
    }
    const verdictText = [...verdicts.entries()]
      .map(([verdict, count]) => `${count} ${VERDICT_PHRASES.get(verdict) ?? "unknown verdict"}`)
      .join(", ");
    if (verdictText) parts.push(`Verdicts: ${verdictText}.`);

    const findings = asArray(report.findings).filter(isRecord).slice(0, 1000);
    if (findings.length) {
      const severities = new Map();
      let verifyFirst = 0;
      for (const finding of findings) {
        const raw = String(finding.severity ?? "").trim().toUpperCase();
        const severity = SEVERITY_PHRASES.has(raw) ? raw : "UNKNOWN";
        severities.set(severity, (severities.get(severity) ?? 0) + 1);
        if (finding.verify_first === true) verifyFirst += 1;
      }
      const severityText = [...severities.entries()]
        .map(([severity, count]) => `${count} ${SEVERITY_PHRASES.get(severity) ?? "unknown severity"}`)
        .join(", ");
      parts.push(`${findings.length} finding${findings.length === 1 ? "" : "s"}: ${severityText}${verifyFirst ? `; ${verifyFirst} flagged verify first` : ""}.`);
    } else if (succeeded.length > 0) {
      parts.push("No findings.");
    }
  }

  if (runDispositions.length) {
    const decisions = summarizeSuggestionDecisions(runDispositions);
    if (decisions.classified) parts.push(`Triage: ${decisions.adopted} adopted, ${decisions.qualified} qualified adoption, ${decisions.rejected} rejected of ${decisions.classified} classified suggestions.`);
  }
  const completionState = normalizedToken(completionValue?.state);
  if (COMPLETION_PHRASES.has(completionState)) parts.push(`Completion: ${COMPLETION_PHRASES.get(completionState)}.`);
  const narration = parts.join(" ");
  return narration.length <= MAX_NARRATION_LENGTH ? narration : `${narration.slice(0, MAX_NARRATION_LENGTH - 1).trimEnd()}…`;
}

function resolveReportPointer(root, pointer) {
  if (!isRecord(root) || typeof pointer !== "string" || !pointer.startsWith("/")) return null;
  let value = root;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(value)) {
      if (!/^\d+$/.test(token)) return null;
      value = value[Number(token)];
    } else if (isRecord(value) && Object.hasOwn(value, token)) value = value[token];
    else return null;
  }
  return value;
}

function completionLabel(value) {
  const state = normalizedToken(value?.state);
  const total = safeCount(value?.total ?? value?.actions?.item_count);
  const completed = safeCount(value?.completed);
  if (state === "pending") return `Pending — ${completed}/${total} adjudicated`;
  if (state === "complete_clean") return `Complete — ${total}/${total} adjudicated`;
  if (state === "complete_no_action") return "Complete — no decisions required";
  if (state === "complete_with_open_findings") return `Adjudicated — ${safeCount(value?.open_findings)} finding(s) remain open`;
  if (state === "blocked_peer_gate") return "Incomplete — peer review gate not met";
  if (state === "invalid") return "Invalid completion evidence";
  return "Legacy — completion unverifiable";
}

function chunkForSpeech(value, maxLength = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const chunks = [];
  for (const sentence of text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []) {
    let remaining = sentence.trim();
    while (remaining.length > maxLength) {
      let splitAt = remaining.lastIndexOf(" ", maxLength);
      if (splitAt < Math.floor(maxLength / 2)) splitAt = maxLength;
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    if (remaining) chunks.push(remaining);
  }
  return chunks;
}

// Self-contained so the same controller can be behavior-tested under Node and
// serialized verbatim into each private ledger page.
function installReadAloud({ document, pageTarget, synth, Utterance, navigatorLanguage = "", chunker, defer, clearDefer }) {
  const buttons = Array.from(document.querySelectorAll(".speak"));
  const statusNode = document.getElementById("speech-status");
  const idleText = "\u{1F50A} Read aloud";
  let localVoice = null;
  let active = null;
  let generation = 0;

  const announce = (message) => { if (statusNode) statusNode.textContent = message; };
  const idleButton = (button) => {
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", "Read this run summary aloud");
    button.textContent = idleText;
  };
  const clearWatchdog = (session) => {
    if (session?.watchdog != null) {
      clearDefer(session.watchdog);
      session.watchdog = null;
    }
  };
  const retire = (session) => {
    clearWatchdog(session);
    if (session?.utterance) {
      session.utterance.onend = null;
      session.utterance.onerror = null;
    }
  };
  const stopActive = (message = "") => {
    const previous = active;
    active = null;
    generation += 1;
    if (previous) {
      retire(previous);
      idleButton(previous.button);
    }
    try { synth?.cancel?.(); } catch {}
    if (message) announce(message);
  };
  const setUnavailable = (message) => {
    localVoice = null;
    stopActive();
    for (const button of buttons) {
      button.disabled = true;
      button.setAttribute("aria-label", message);
      button.textContent = message;
    }
    announce(message);
  };

  if (!synth || typeof synth.speak !== "function" || typeof synth.cancel !== "function"
      || typeof synth.getVoices !== "function" || typeof Utterance !== "function") {
    setUnavailable("Local speech unavailable");
    return { stop: stopActive, refreshVoices: () => false };
  }

  const ready = (voice) => {
    localVoice = voice;
    for (const button of buttons) {
      button.disabled = false;
      if (!active || active.button !== button) idleButton(button);
    }
    announce("Read-aloud ready with a browser-reported local voice.");
  };
  const loading = () => {
    for (const button of buttons) {
      if (active?.button === button) continue;
      button.disabled = true;
      button.setAttribute("aria-label", "Loading a local speech voice");
      button.textContent = "Loading local speech…";
    }
    announce("Looking for a browser-reported local voice.");
  };
  const refreshVoices = (final = false) => {
    let voices;
    try {
      const available = synth.getVoices();
      voices = Array.isArray(available) ? available : [];
    } catch {
      voices = [];
    }
    const language = String(navigatorLanguage).toLowerCase();
    const local = voices.filter((voice) => voice?.localService === true);
    const voice = local.find((entry) => entry.default)
      ?? local.find((entry) => language && String(entry.lang ?? "").toLowerCase().startsWith(language.split("-")[0]))
      ?? local[0];
    if (voice) {
      ready(voice);
      return true;
    }
    if (voices.length || final) setUnavailable("No local speech voice available");
    else loading();
    return false;
  };

  const finishSession = (session, message) => {
    if (active !== session || session.generation !== generation) return;
    retire(session);
    active = null;
    idleButton(session.button);
    announce(message);
  };
  const speakNext = (session) => {
    if (active !== session || session.generation !== generation) return;
    if (session.index >= session.chunks.length) {
      finishSession(session, "Read-aloud finished.");
      return;
    }
    let utterance;
    try {
      utterance = new Utterance(session.chunks[session.index]);
      utterance.voice = session.voice;
      utterance.rate = 0.95;
    } catch {
      finishSession(session, "Local speech could not start.");
      return;
    }
    session.utterance = utterance;
    utterance.onend = () => {
      if (active !== session || session.utterance !== utterance || session.generation !== generation) return;
      clearWatchdog(session);
      session.index += 1;
      speakNext(session);
    };
    utterance.onerror = () => {
      if (active !== session || session.utterance !== utterance || session.generation !== generation) return;
      finishSession(session, "Local speech stopped because the browser reported an error.");
    };
    session.watchdog = defer(() => {
      if (active !== session || session.utterance !== utterance || session.generation !== generation) return;
      try { synth.cancel(); } catch {}
      finishSession(session, "Local speech stopped because the browser did not finish the utterance.");
    }, 45_000);
    try {
      if (synth.paused && typeof synth.resume === "function") synth.resume();
      synth.speak(utterance);
    } catch {
      finishSession(session, "Local speech could not start.");
    }
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const wasActive = active?.button === button;
      stopActive(wasActive ? "Read-aloud stopped." : "");
      if (wasActive) return;
      if (!localVoice && !refreshVoices(true)) return;
      const chunks = chunker(button.dataset.narration);
      if (!chunks.length) {
        announce("This run has no readable summary.");
        return;
      }
      const session = { button, chunks, index: 0, voice: localVoice, utterance: null, watchdog: null, generation };
      active = session;
      button.setAttribute("aria-pressed", "true");
      button.setAttribute("aria-label", "Stop reading this run summary");
      button.textContent = "\u23F9 Stop";
      announce("Reading this run summary aloud.");
      defer(() => speakNext(session), 0);
    });
  }

  loading();
  refreshVoices(false);
  if (!localVoice) defer(() => refreshVoices(true), 1_500);
  if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", () => refreshVoices(false));
  else synth.onvoiceschanged = () => refreshVoices(false);
  pageTarget?.addEventListener?.("pagehide", () => stopActive());
  return { stop: stopActive, refreshVoices };
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const HARNESS = { codex: "Codex CLI · ChatGPT OAuth", claude: "Claude Code · Anthropic OAuth", antigravity: "Antigravity CLI · Google OAuth", copilot: "GitHub Copilot CLI · GitHub OAuth", grok: "Grok CLI · xAI OAuth", gemini: "Gemini CLI · Google OAuth" };
const statusClass = (value) => {
  const normalized = normalizedToken(value);
  return KNOWN_STATUSES.has(normalized) ? normalized : "unknown";
};
const dispositionClass = (value) => {
  const normalized = normalizedToken(value);
  if (normalized.startsWith("applied")) return "applied";
  if (normalized === "rejected") return "rejected";
  return "unknown";
};
const verdictClass = (value) => {
  const normalized = String(value ?? "").trim().toUpperCase();
  return VERDICT_PHRASES.has(normalized) ? normalized : "UNKNOWN";
};
const severityClass = (value) => {
  const normalized = String(value ?? "").trim().toUpperCase();
  return SEVERITY_PHRASES.has(normalized) ? normalized : "UNKNOWN";
};
const displayDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "unknown date" : date.toLocaleString();
};

function anchoredReportForLedger(file, raw, report, logRows) {
  const runId = String(file).replace(/\.json$/, "");
  const digest = createHash("sha256").update(raw).digest("hex");
  if (!isRecord(report) || report.run_id !== runId) return { record: null, run_id: runId, error: "report body run_id does not match its filename" };
  const anchored = asArray(logRows).some((row) => isRecord(row) && !row.event
    && row.run_id === runId && row.report_sha256 === digest);
  if (!anchored) return { record: null, run_id: runId, error: "report bytes do not match a non-event review-log anchor" };
  return { record: { sha256: digest, report }, run_id: runId, error: null };
}

function readLedgerJsonl(file, label, maxBytes) {
  if (!fs.existsSync(file)) return [];
  return readBoundedText(file, label, maxBytes).split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function readReportForLedger(file, reportPath, logRows) {
  const raw = readBoundedText(reportPath, `ledger report ${file}`, MAX_LEDGER_REPORT_BYTES);
  const report = JSON.parse(raw);
  return anchoredReportForLedger(file, raw, report, logRows);
}

function renderLedgerHtml({ runs: runValues, dispositions: dispositionValues, reports, completionStatuses = {}, generated, logDegraded = false, quarantinedReports = [] }) {
  const runs = asArray(runValues).filter(isRecord);
  const dispositions = asArray(dispositionValues).filter(isRecord);
  const authoritativeSuggestionRows = Object.values(isRecord(completionStatuses) ? completionStatuses : {}).flatMap((status) =>
    asArray(status?.decisions).filter((decision) => decision?.kind === "suggestion").map((decision) => ({
      run_id: status.run_id,
      reviewer: decision.reviewer,
      disposition: decision.disposition,
      reason: decision.reason,
      evidence: asArray(decision.verification).map((entry) => entry?.evidence).filter(Boolean).join("; "),
    })));
  const decisionSummary = summarizeSuggestionDecisions([...dispositions, ...authoritativeSuggestionRows]);
  const rows = runs.slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).map((run) => {
    const reportRecord = isRecord(reports) && isRecord(reports[run.run_id]) ? reports[run.run_id] : null;
    const rpt = isRecord(reportRecord?.report) ? reportRecord.report : null;
    const reviewers = asArray(rpt?.reviewers).filter(isRecord);
    const findings = asArray(rpt?.findings).filter(isRecord);
    const runDispositions = dispositions.filter((entry) => entry.run_id === run.run_id);
    const completion = isRecord(completionStatuses?.[run.run_id]) ? completionStatuses[run.run_id] : { state: "legacy_unverifiable", complete: false };
    const actionItems = asArray(completion.actions?.items).filter(isRecord);
    const decisionsByItem = new Map(asArray(completion.decisions).filter(isRecord).map((decision) => [decision.item_id, decision]));
    const completionDecisions = actionItems.flatMap((item) => {
      const decision = decisionsByItem.get(item.item_id);
      if (!decision) return [];
      return [{ ...decision, report_pointer: item.report_pointer, subject: resolveReportPointer(rpt, item.report_pointer) }];
    });
    const suggestionDecisions = completionDecisions.filter((decision) => decision.kind === "suggestion");
    const suggestionItems = actionItems.filter((item) => item.kind === "suggestion");
    const findingDecisions = completionDecisions.filter((decision) => decision.kind === "finding");
    const findingItems = actionItems.filter((item) => item.kind === "finding");
    const subject = cleanUserLabel(run.label);
    const routeEvidence = externalRouteEvidence(run, rpt);
    const statuses = routeEvidence.routes.map((route) => `<span class="st st-${statusClass(route.status)}" title="${esc(route.label)}: ${esc(STATUS_PHRASES.get(route.status) ?? "unknown status")}">${esc(route.label)}</span>`).join(" ");
    const failedRoutes = routeEvidence.failed.length ? `<p class="route-warning">Routes without a review: ${routeEvidence.failed.map((route) => `${esc(route.label)} (${esc(STATUS_PHRASES.get(route.status) ?? "unknown status")})`).join(", ")}.</p>` : "";
    const descriptors = asArray(rpt?.attachments).slice(0, 8).map(safeAttachmentDescriptor).filter(Boolean);
    const attachmentEvidence = descriptors.length ? `<h4>Attachment evidence</h4><ul class="attachments">${descriptors.map((item) => `<li><b>${esc(item.id ?? "unknown attachment")}</b> · ${esc(item.modality)}/${esc(item.format)} · ${item.bytes == null ? "size unavailable" : `${item.bytes} bytes`} · sha256 ${item.digest ? `${esc(item.digest.slice(0, 12))}…` : "unavailable"} · ${esc(item.metadata)}${item.width && item.height ? ` · ${item.width}×${item.height}` : ""}</li>`).join("")}</ul>` : "";
    const sealedDigest = /^[a-f0-9]{64}$/i.test(String(reportRecord?.sha256 ?? "")) ? `${String(reportRecord.sha256).slice(0, 12)}…` : "unavailable";
    const detailLabel = routeEvidence.completed > 0 ? `full transcript · ${findings.length} finding${findings.length === 1 ? "" : "s"}` : "run record · no completed reviews";
    const detail = rpt ? `<details><summary>${detailLabel} · report sha256 ${esc(sealedDigest)}</summary>
      ${failedRoutes}
      ${reviewers.filter((reviewer) => reviewer.status === "success").map((reviewer) => {
        const suggestions = asArray(reviewer.suggested_improvements);
        const duration = Number.isFinite(reviewer.duration_ms) && reviewer.duration_ms >= 0 ? ` · ${(reviewer.duration_ms / 1000).toFixed(1)}s` : "";
        const confidence = Number.isFinite(reviewer.confidence) ? ` <span class="dim">conf ${esc(reviewer.confidence)}</span>` : "";
        const agent = normalizedToken(reviewer.agent);
        const reviewerName = REVIEWER_NAMES.get(agent) ?? "unknown reviewer";
        return `<div class="rev"><b>${esc(reviewerName)}</b> <span class="dim">${esc(HARNESS[agent] ?? "")}${reviewer.persona ? ` · persona: ${esc(reviewer.persona)}` : ""}${duration}</span><span class="v v-${verdictClass(reviewer.verdict)}">${esc(VERDICT_PHRASES.get(verdictClass(reviewer.verdict)) ?? "unknown verdict")}</span>${confidence}<p>${esc(reviewer.summary ?? "(verdict without prose — see suggestions)")}</p>${suggestions.length ? `<ul>${suggestions.map((suggestion) => `<li>${esc(suggestion)}</li>`).join("")}</ul>` : ""}</div>`;
      }).join("")}
      ${attachmentEvidence}
      ${findings.length ? `<h4>Findings — ${completion.complete ? `reviewer claims adjudicated (${findingDecisions.length}/${findingItems.length})` : `governor verification pending (${findingDecisions.length}/${findingItems.length} reviewer claims)`}</h4>${findings.map((finding, findingIndex) => {
        const sources = asArray(finding.sources).slice(0, 12).map((source) => REVIEWER_NAMES.get(normalizedToken(source)) ?? "unknown reviewer");
        const media = safeFindingRegion(finding, descriptors);
        const region = media ? `<span class="dim"> · ${esc(media.id)} · region x=${media.region[0]}, y=${media.region[1]}, ${media.region[2]}×${media.region[3]}</span>` : "";
        const groupPointer = `/findings/${findingIndex}`;
        const groupItems = findingItems.filter((entry) => entry.finding_group_pointer === groupPointer || entry.report_pointer === groupPointer);
        const decisionText = groupItems.length ? groupItems.map((item) => {
          const decision = decisionsByItem.get(item.item_id);
          const reviewer = item.reviewer ? REVIEWER_NAMES.get(normalizedToken(item.reviewer)) ?? "unknown reviewer" : "correlated finding";
          return decision
            ? `<p class="decision"><span class="dim">${esc(reviewer)} claim</span><br><b>${esc(decision.disposition)}</b> — ${esc(decision.reason)}${decision.reproduction?.evidence ? `<br><span class="dim">reproduction: ${esc(decision.reproduction.evidence)}</span>` : ""}${asArray(decision.verification).length ? `<br><span class="dim">verification: ${asArray(decision.verification).map((entry) => esc(entry.evidence)).join("; ")}</span>` : ""}</p>`
            : `<p class="pending">${esc(reviewer)} claim — governor decision pending</p>`;
        }).join("") : `<p class="pending">Governor decision pending</p>`;
        return `<div class="find f-${severityClass(finding.severity)}"><b>${esc(SEVERITY_PHRASES.get(severityClass(finding.severity)) ?? "unknown severity")}</b> ${esc(finding.id)} <span class="dim">by ${sources.map(esc).join(", ") || "unknown reviewer"}</span>${region}<p>${esc(finding.issue)}</p>${decisionText}</div>`;
      }).join("")}` : ""}
      ${suggestionItems.length ? `<h4>Suggestion dispositions — ${suggestionDecisions.length}/${suggestionItems.length} adjudicated</h4><table><tr><th>reviewer</th><th>suggestion</th><th>type / disposition</th><th>reason / evidence</th></tr>${suggestionItems.map((item) => {
        const entry = decisionsByItem.get(item.item_id);
        const subject = resolveReportPointer(rpt, item.report_pointer);
        return entry
          ? `<tr><td>${esc(item.reviewer)}</td><td>${esc(typeof subject === "string" ? subject : item.subject ?? "sealed suggestion")}</td><td class="d-${dispositionClass(entry.disposition)}">${esc(entry.claim_type ?? "other")} · ${esc(entry.disposition)}</td><td>${esc(entry.reason)}${entry.reproduction?.evidence ? `<br><span class="dim">reproduction: ${esc(entry.reproduction.evidence)}</span>` : ""}${asArray(entry.verification).length ? `<br><span class="dim">verification: ${asArray(entry.verification).map((check) => esc(check.evidence)).join("; ")}</span>` : ""}</td></tr>`
          : `<tr><td>${esc(item.reviewer)}</td><td>${esc(typeof subject === "string" ? subject : item.subject ?? "sealed suggestion")}</td><td class="pending">pending</td><td class="pending">Governor disposition required</td></tr>`;
      }).join("")}</table>` : ""}
      ${runDispositions.length ? `<h4>Legacy dispositions — historical only, not completion proof</h4><table><tr><th>reviewer</th><th>suggestion</th><th>disposition</th><th>reason</th></tr>${runDispositions.map((entry) => `<tr><td>${esc(entry.reviewer)}</td><td>${esc(entry.suggestion)}</td><td class="d-${dispositionClass(entry.disposition)}">${esc(entry.disposition)}</td><td>${esc(entry.reason)}${entry.evidence ? `<br><span class="dim">evidence: ${esc(entry.evidence)}</span>` : ""}</td></tr>`).join("")}</table>` : ""}
    </details>` : `<span class="dim">summary-only record</span>`;
    const narration = narrationFor(run, rpt, [...runDispositions, ...suggestionDecisions], completion);
    const outcome = routeEvidence.known
      ? routeEvidence.completed === 0 ? `no verdict — 0/${routeEvidence.total} completed` : `${rpt ? findings.length : safeCount(run.findings_count)} finding${(rpt ? findings.length : safeCount(run.findings_count)) === 1 ? "" : "s"} · ${routeEvidence.completed}/${routeEvidence.total} completed`
      : "outcome unknown";
    const completionState = normalizedToken(completion.state);
    const nextAction = completionState === "pending"
      ? `Next action: fill pending/${safeRunId(run.run_id)}.json, finalize it, then run the required status gate.`
      : completionState === "blocked_peer_gate"
        ? `Next action: re-run peer collection; ${safeCount(completion.actions?.peer_collection?.succeeded)}/${safeCount(completion.actions?.peer_collection?.required)} required external reviews succeeded.`
        : completionState === "invalid"
          ? `Completion evidence is invalid: ${String(completion.error ?? "validation failed").slice(0, 300)}`
          : completionState === "legacy_unverifiable"
            ? "Legacy record: it has no supported sealed obligation derivation and cannot be marked complete post hoc."
            : completionState === "complete_with_open_findings"
              ? `Adjudication is complete, but ${safeCount(completion.open_findings)} finding(s) remain open.`
              : "";
    return `<article class="run"><header><b>${esc(subject || safeRunId(run.run_id))}</b> <span class="dim">${esc(displayDate(run.timestamp))} · gov ${esc(GOVERNOR_NAMES.get(normalizedToken(run.governor)) ?? "unknown")} · ${esc(outcome)}${subject ? ` · ${esc(safeRunId(run.run_id))}` : ""}</span><span class="completion completion-${esc(completionState)}">${esc(completionLabel(completion))}</span><button class="speak" type="button" data-narration="${esc(narration)}" aria-pressed="false" aria-label="Loading a local speech voice" disabled>Loading local speech…</button></header><div>${statuses}</div>${nextAction ? `<p class="next-action">${esc(nextAction)}</p>` : ""}${!rpt ? failedRoutes : ""}${detail}</article>`;
  }).join("\n");

  const suggestionPanel = decisionSummary.rows.length ? `<section class="decision-panel"><h2>Suggestion decisions</h2><table><tr><th>reviewer</th><th>adopted</th><th>qualified adoption</th><th>rejected</th><th>classified decisions</th></tr>${decisionSummary.rows.map((row) => `<tr><td>${esc(REVIEWER_NAMES.get(row.reviewer))}</td><td>${row.adopted}</td><td>${row.qualified}</td><td>${row.rejected}</td><td>${row.classified}</td></tr>`).join("")}</table><p class="dim">Counts combine validated completion sidecars with clearly labeled legacy records; they do not rank reviewers or measure correctness.${decisionSummary.unclassified ? ` ${decisionSummary.unclassified} unclassified record${decisionSummary.unclassified === 1 ? "" : "s"} omitted from the classified totals.` : ""}</p></section>` : "";

  const controllerScript = `(${installReadAloud.toString()})({document,pageTarget:window,synth:window.speechSynthesis,Utterance:window.SpeechSynthesisUtterance,navigatorLanguage:navigator.language,chunker:${chunkForSpeech.toString()},defer:window.setTimeout.bind(window),clearDefer:window.clearTimeout.bind(window)});`;
  return `<!-- momm-private-ledger/1 --><!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My momm ledger</title>
  <style>
    :root{--bg:#080a0a;--panel:#111316;--border:#1f2a22;--text:#e6ffe6;--muted:#9be29b;--dim:#718275;--accent:#00ff99;--warn:#ffd166;--crit:#ff7a7a}
    *{box-sizing:border-box}body{background:var(--bg);color:var(--text);font:13px/1.55 ui-monospace,Consolas,monospace;max-width:960px;margin:0 auto;padding:20px;overflow-wrap:anywhere}
    h1{font-size:19px}h1 span{color:var(--accent)}
    .note{color:var(--dim);font-size:11px;border:1px dashed var(--border);border-radius:8px;padding:8px 12px;margin:10px 0}
    .run{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin:10px 0;min-width:0}
    .run header{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline}.run header>b,.run header>.dim{min-width:0}
    .dim{color:var(--dim);font-size:11px}
    .st{border:1px solid var(--border);border-radius:6px;padding:0 6px;font-size:10.5px;color:var(--muted)}
    .st-success{color:var(--accent)}.st-timeout{color:var(--warn)}.st-authentication_required,.st-error{color:var(--crit)}.st-self_excluded{opacity:.6}
    details{margin-top:8px}summary{cursor:pointer;color:var(--muted)}
    .rev{border-left:3px solid var(--border);padding:4px 10px;margin:8px 0}
    .rev p,.rev ul{margin:4px 0;max-width:70ch}.rev li{color:var(--muted)}
    .v{border-radius:6px;padding:0 7px;font-weight:700;font-size:11px;margin-left:8px}
    .v-ACCEPT{background:rgba(0,255,153,.12);color:var(--accent)}.v-MODIFY{background:rgba(255,209,102,.12);color:var(--warn)}.v-REJECT{background:rgba(255,122,122,.14);color:var(--crit)}
    .find{border-left:3px solid var(--dim);padding:4px 10px;margin:6px 0}.f-CRITICAL{border-color:var(--crit)}.f-WARNING{border-color:var(--warn)}
    .completion{border:1px solid var(--border);border-radius:999px;padding:1px 8px;font-size:10.5px;color:var(--dim)}.completion-complete_clean,.completion-complete_no_action{color:var(--accent);border-color:rgba(0,255,153,.35)}.completion-pending,.completion-complete_with_open_findings,.completion-blocked_peer_gate{color:var(--warn);border-color:rgba(255,209,102,.35)}.completion-invalid{color:var(--crit);border-color:rgba(255,122,122,.4)}
    .decision{border-top:1px dashed var(--border);padding-top:5px;color:var(--muted)}.pending{color:var(--warn);font-size:11px}.next-action{border-left:3px solid var(--warn);padding:4px 9px;color:var(--muted);font-size:11px}
    .route-warning{color:var(--warn)}.attachments{color:var(--muted);padding-left:20px}.decision-panel{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin:10px 0}.decision-panel h2{font-size:13px;margin:0 0 6px}
    table{border-collapse:collapse;font-size:11.5px;width:100%;display:block;overflow-x:auto}td,th{border-bottom:1px solid var(--border);padding:4px 8px;text-align:left;vertical-align:top}
    .d-applied{color:var(--accent)}.d-rejected{color:var(--warn)}
    h4{margin:12px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
    .speak{margin-left:auto;cursor:pointer;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--muted);font:inherit;font-size:11px;padding:2px 8px;white-space:nowrap}
    .speak:hover:not([disabled]),.speak:focus-visible,.speak[aria-pressed="true"]{color:var(--accent);border-color:var(--accent)}
    .speak[disabled]{opacity:.65;cursor:default}
  </style>
  <h1><span>◆</span> My momm ledger <span class="dim">· ${runs.length} runs · ${Object.keys(reports ?? {}).length} sealed reports · ${authoritativeSuggestionRows.length} validated suggestion decisions${dispositions.length ? ` · ${dispositions.length} legacy records` : ""}</span></h1>
  ${logDegraded ? `<p class="route-warning">The review log ends with an incomplete crash-tail record. Existing complete records remain visible; the next safe MOMM write will preserve and repair the tail.</p>` : ""}
  ${quarantinedReports.length ? `<p class="route-warning">${quarantinedReports.length} report file${quarantinedReports.length === 1 ? " was" : "s were"} withheld because its bytes were not bound to a matching non-event review-log anchor. Reviewer prose from unanchored files is never rendered.</p>` : ""}
  <p class="note">This page was generated locally from your own telemetry. MOMM never publishes it automatically; keep the evidence directory locally excluded and verify repository status before committing. Generated ${esc(generated)}.</p>
  ${suggestionPanel}
  ${rows || '<p class="dim">No runs recorded yet.</p>'}
  <p id="speech-status" class="dim" aria-live="polite">Read-aloud waits for a voice your browser reports as local; MOMM supplies no cloud fallback and makes no narration request.</p>
  <p class="dim">Reviewer names identify harness CLIs, not inner model identities. Reports are content-addressed: quotes resolve to files whose sha256 is recorded beside them.</p>
  <script>${controllerScript}</script>`;
}

function ledgerSelfTest() {
  const run = { run_id: "rev_x", label: "demo review", timestamp: "2026-08-24T00:00:00Z", governor: "codex", reviewer_status: { codex: "self_excluded", claude: "success", grok: "timeout" } };
  const report = {
    governor: "codex",
    reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "claude", status: "success", verdict: "MODIFY", confidence: 0.8, summary: "SENTINEL_REVIEWER_PROSE" }, { agent: "grok", status: "timeout", verdict: null }],
    findings: [{ severity: "WARNING", verify_first: true, issue: "SENTINEL_FINDING_PROSE", sources: ["claude"] }],
  };
  const spoken = narrationFor(run, report, [{ reviewer: "claude", disposition: "applied" }, { reviewer: "grok", disposition: "rejected" }]);
  const poisoned = narrationFor(
    { run_id: "not safe SENTINEL_RUN", governor: "SENTINEL_GOVERNOR", reviewer_status: { SENTINEL_AGENT: "SENTINEL_STATUS", claude: "SENTINEL_STATUS" } },
    { reviewers: [{ agent: "claude", status: "success", verdict: "SENTINEL_VERDICT" }], findings: [{ severity: "SENTINEL_SEVERITY", issue: "SENTINEL_ISSUE" }] },
    [],
  );
  const hostileHtml = renderLedgerHtml({
    runs: [{ ...run, label: 'quote" <tag>', findings_count: '<img src=x onerror="bad()">' }],
    dispositions: [],
    reports: { rev_x: { sha256: "abc", report: { reviewers: [{ agent: "claude", status: "success", verdict: "ACCEPT", confidence: '<img src=x onerror="bad()">', summary: "<img src=x onerror=bad()>" }], findings: [{ severity: "WARNING", sources: ['<img src=x onerror="bad()">'], issue: "<img src=x onerror=bad()>" }] } } },
    generated: "2026-08-24T00:00:00.000Z",
  });
  const noVerdictHtml = renderLedgerHtml({
    runs: [{ run_id: "rev_zero", timestamp: run.timestamp, governor: "codex", reviewer_status: { codex: "self_excluded", grok: "timeout" }, findings_count: 0 }],
    dispositions: [],
    reports: { rev_zero: { sha256: "a".repeat(64), report: { governor: "codex", reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "grok", status: "timeout" }], findings: [] } } },
    generated: run.timestamp,
  });
  const legacyUnknownHtml = renderLedgerHtml({ runs: [{ run_id: "rev_legacy", timestamp: run.timestamp, governor: "codex", findings_count: 0 }], dispositions: [], reports: {}, generated: run.timestamp });
  const zeroRouteReport = { governor: "codex", reviewers: [{ agent: "codex", status: "self_excluded", verdict: "ACCEPT" }], findings: [] };
  const zeroRouteHtml = renderLedgerHtml({
    runs: [{ run_id: "rev_self_only", timestamp: run.timestamp, governor: "codex", reviewer_status: { codex: "self_excluded" }, findings_count: 0 }],
    dispositions: [], reports: { rev_self_only: { sha256: "f".repeat(64), report: zeroRouteReport } }, generated: run.timestamp,
  });
  const zeroRouteNarration = narrationFor({ run_id: "rev_self_only", timestamp: run.timestamp, governor: "codex", reviewer_status: { codex: "self_excluded" } }, zeroRouteReport, []);
  const failedRouteHtml = renderLedgerHtml({
    runs: [{ run_id: "rev_failed", timestamp: run.timestamp, governor: "codex", reviewer_status: { codex: "self_excluded", SENTINEL_AGENT: "SENTINEL_STATUS", grok: "timeout" } }],
    dispositions: [],
    reports: { rev_failed: { sha256: "b".repeat(64), report: { governor: "codex", reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "SENTINEL_AGENT", status: "SENTINEL_STATUS" }, { agent: "grok", status: "timeout" }], findings: [] } } },
    generated: run.timestamp,
  });
  const attachmentRun = { run_id: "rev_media", timestamp: run.timestamp, governor: "codex", reviewer_status: { codex: "self_excluded", gemini: "success" } };
  const attachmentReport = {
    governor: "codex",
    reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "gemini", status: "success", verdict: "MODIFY", summary: "ok" }],
    attachments: [
      { id: "attachment-1", modality: "image", format: "png", sent_bytes: 68, sent_sha256: "d".repeat(64), metadata_status: "privacy_metadata_removed", width: 320, height: 180, path: "SENTINEL_PRIVATE_PATH", name: "SENTINEL_PRIVATE_NAME" },
      { id: "SENTINEL_ID", modality: "SENTINEL_MODALITY", format: "SENTINEL_FORMAT", sent_bytes: -1, sent_sha256: "SENTINEL_HASH", metadata_status: "SENTINEL_METADATA", path: "SENTINEL_OTHER_PATH" },
    ],
    findings: [{ id: "visual", severity: "WARNING", sources: ["gemini"], issue: "Visible overlap", attachment_id: "attachment-1", region: [12, 8, 100, 40] }],
  };
  const attachmentHtml = renderLedgerHtml({
    runs: [attachmentRun], dispositions: [], generated: run.timestamp,
    reports: { rev_media: { sha256: "c".repeat(64), report: attachmentReport } },
  });
  const suggestionHtml = renderLedgerHtml({
    runs: [], generated: run.timestamp, reports: {},
    dispositions: [
      { reviewer: "claude", disposition: "applied" },
      { reviewer: "claude", disposition: "applied-partial" },
      { reviewer: "grok", disposition: "rejected" },
      { reviewer: "SENTINEL_REVIEWER", disposition: "applied" },
      { reviewer: "codex", disposition: "SENTINEL_OUTCOME" },
    ],
  });
  const statusReport = {
    governor: "codex",
    reviewers: [{ agent: "codex", status: "self_excluded" }, { agent: "claude", status: "success", verdict: "MODIFY", suggested_improvements: ["Add a boundary test"] }],
    findings: [{ id: "bounds", severity: "WARNING", issue: "Boundary is wrong", sources: ["claude"] }],
  };
  const statusActions = {
    items: [
      { item_id: "finding-1", kind: "finding", report_pointer: "/findings/0", reviewer: "claude", severity: "WARNING" },
      { item_id: "suggestion-1", kind: "suggestion", report_pointer: "/reviewers/1/suggested_improvements/0", reviewer: "claude" },
    ],
    peer_collection: { succeeded: 0, required: 1 },
  };
  const statusRuns = ["pending", "blocked", "invalid", "open", "legacy"].map((suffix) => ({
    run_id: `rev_${suffix}`, timestamp: run.timestamp, governor: "codex", reviewer_status: { codex: "self_excluded", claude: "success" },
  }));
  const stateHtml = renderLedgerHtml({
    runs: statusRuns,
    dispositions: [], generated: run.timestamp,
    reports: Object.fromEntries(statusRuns.filter((entry) => entry.run_id !== "rev_legacy").map((entry) => [entry.run_id, { sha256: "e".repeat(64), report: statusReport }])),
    completionStatuses: {
      rev_pending: { run_id: "rev_pending", state: "pending", complete: false, actions: statusActions, decisions: [] },
      rev_blocked: { run_id: "rev_blocked", state: "blocked_peer_gate", complete: false, actions: statusActions, decisions: [] },
      rev_invalid: { run_id: "rev_invalid", state: "invalid", complete: false, actions: statusActions, decisions: [], error: "digest anchor missing" },
      rev_open: {
        run_id: "rev_open", state: "complete_with_open_findings", complete: true, open_findings: 1, actions: statusActions,
        decisions: [
          { item_id: "finding-1", kind: "finding", disposition: "accepted_open", reason: "Deferred with owner approval", reproduction: { evidence: "boundary test fails" }, verification: [] },
          { item_id: "suggestion-1", kind: "suggestion", claim_type: "behavioral", disposition: "rejected", reason: "Duplicate of the finding", verification: [] },
        ],
      },
      rev_legacy: { run_id: "rev_legacy", state: "legacy_unverifiable", complete: false },
    },
  });

  const makeButton = (narration) => {
    const listeners = {};
    const attributes = new Map([["aria-pressed", "false"]]);
    return {
      dataset: { narration }, disabled: false, textContent: "",
      addEventListener(type, handler) { listeners[type] = handler; },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name); },
      click() { listeners.click?.(); },
    };
  };
  const makeTimers = () => {
    const timers = [];
    return {
      defer(fn, ms) { const timer = { fn, ms, active: true }; timers.push(timer); return timer; },
      clear(timer) { if (timer) timer.active = false; },
      flush(ms = 0) {
        for (const timer of timers.filter((entry) => entry.active && entry.ms === ms)) {
          timer.active = false;
          timer.fn();
        }
      },
    };
  };
  class FakeUtterance { constructor(text) { this.text = text; } }
  const buttonA = makeButton(spoken);
  const buttonB = makeButton("Review two. No findings.");
  const liveStatus = { textContent: "" };
  const pageListeners = {};
  const spokenUtterances = [];
  let cancelCount = 0;
  const localVoice = { name: "Local Test", lang: "en-GB", default: true, localService: true };
  const synth = {
    paused: false,
    getVoices: () => [localVoice],
    speak: (utterance) => { spokenUtterances.push(utterance); },
    cancel: () => { cancelCount += 1; },
    addEventListener() {},
  };
  const timers = makeTimers();
  installReadAloud({
    document: { querySelectorAll: () => [buttonA, buttonB], getElementById: () => liveStatus },
    pageTarget: { addEventListener: (type, handler) => { pageListeners[type] = handler; } },
    synth, Utterance: FakeUtterance, navigatorLanguage: "en-GB", chunker: chunkForSpeech,
    defer: timers.defer, clearDefer: timers.clear,
  });
  buttonA.click();
  timers.flush(0);
  const firstUtterance = spokenUtterances[0];
  const staleEnd = firstUtterance?.onend;
  const startWorks = buttonA.getAttribute("aria-pressed") === "true" && firstUtterance?.voice === localVoice;
  buttonB.click();
  timers.flush(0);
  staleEnd?.();
  const switchIgnoresStaleCallback = buttonB.getAttribute("aria-pressed") === "true" && buttonA.getAttribute("aria-pressed") === "false";
  buttonB.click();
  const sameButtonStops = buttonB.getAttribute("aria-pressed") === "false" && cancelCount >= 3;

  const remoteButton = makeButton("Safe narration.");
  let remoteSpeakCount = 0;
  const remoteTimers = makeTimers();
  installReadAloud({
    document: { querySelectorAll: () => [remoteButton], getElementById: () => ({ textContent: "" }) },
    pageTarget: null,
    synth: { getVoices: () => [{ localService: false }], speak: () => { remoteSpeakCount += 1; }, cancel() {}, addEventListener() {} },
    Utterance: FakeUtterance, navigatorLanguage: "en", chunker: chunkForSpeech,
    defer: remoteTimers.defer, clearDefer: remoteTimers.clear,
  });
  remoteButton.click();

  const throwingButton = makeButton("Safe narration.");
  const throwingTimers = makeTimers();
  const throwingStatus = { textContent: "" };
  installReadAloud({
    document: { querySelectorAll: () => [throwingButton], getElementById: () => throwingStatus },
    pageTarget: null,
    synth: { getVoices: () => [localVoice], speak: () => { throw new Error("boom"); }, cancel() {}, addEventListener() {} },
    Utterance: FakeUtterance, navigatorLanguage: "en", chunker: chunkForSpeech,
    defer: throwingTimers.defer, clearDefer: throwingTimers.clear,
  });
  throwingButton.click();
  throwingTimers.flush(0);

  const anchoredBody = `${JSON.stringify({ report_schema: "momm-report/1", run_id: "rev_anchor", governor: "codex" })}\n`;
  const anchoredDigest = createHash("sha256").update(anchoredBody).digest("hex");
  const anchoredProbe = anchoredReportForLedger("rev_anchor.json", anchoredBody, JSON.parse(anchoredBody), [{ run_id: "rev_anchor", report_sha256: anchoredDigest }]);
  const tamperedBody = anchoredBody.replace("codex", "grok");
  const tamperedProbe = anchoredReportForLedger("rev_anchor.json", tamperedBody, JSON.parse(tamperedBody), [{ run_id: "rev_anchor", report_sha256: anchoredDigest }]);
  const quarantineHtml = renderLedgerHtml({ runs: [], dispositions: [], reports: {}, generated: run.timestamp, quarantinedReports: [{ run_id: "rev_anchor", error: tamperedProbe.error }] });
  const boundsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "momm-ledger-bounds-"));
  let dispositionsBounded = false;
  let reportBounded = false;
  let existingLedgerBounded = false;
  try {
    const oversizedDispositions = path.join(boundsRoot, "dispositions.jsonl");
    const dispositionsHandle = fs.openSync(oversizedDispositions, "w");
    try { fs.ftruncateSync(dispositionsHandle, MAX_DISPOSITIONS_BYTES + 1); } finally { fs.closeSync(dispositionsHandle); }
    try { readLedgerJsonl(oversizedDispositions, "ledger dispositions", MAX_DISPOSITIONS_BYTES); }
    catch (error) { dispositionsBounded = /exceeds/.test(error.message); }

    const oversizedReport = path.join(boundsRoot, "rev_oversized.json");
    const reportHandle = fs.openSync(oversizedReport, "w");
    try { fs.ftruncateSync(reportHandle, MAX_LEDGER_REPORT_BYTES + 1); } finally { fs.closeSync(reportHandle); }
    try { readReportForLedger("rev_oversized.json", oversizedReport, []); }
    catch (error) { reportBounded = /exceeds/.test(error.message); }

    const oversizedLedger = path.join(boundsRoot, "ledger.html");
    const ledgerHandle = fs.openSync(oversizedLedger, "w");
    try { fs.ftruncateSync(ledgerHandle, MAX_EXISTING_LEDGER_BYTES + 1); } finally { fs.closeSync(ledgerHandle); }
    try { readBoundedText(oversizedLedger, "existing private ledger", MAX_EXISTING_LEDGER_BYTES); }
    catch (error) { existingLedgerBounded = /exceeds/.test(error.message); }
  } finally { fs.rmSync(boundsRoot, { recursive: true, force: true }); }

  const tests = {
    narration_names_bounded_label_and_allowlisted_governor: spoken.includes("demo review") && spoken.includes("governor Codex"),
    narration_counts_reviewers_excluding_governor: spoken.includes("1 of 2 reviewers completed"),
    narration_reads_closed_verdict_severity_and_failure: spoken.includes("Grok timed out") && spoken.includes("1 modify") && spoken.includes("1 warning") && spoken.includes("1 flagged verify first"),
    narration_reads_triage_counts: spoken.includes("1 adopted, 0 qualified adoption, 1 rejected of 2 classified"),
    narration_never_speaks_reviewer_or_finding_prose: !spoken.includes("SENTINEL_REVIEWER_PROSE") && !spoken.includes("SENTINEL_FINDING_PROSE"),
    narration_rejects_unknown_report_vocabulary: !poisoned.includes("SENTINEL") && poisoned.includes("unknown controller") && poisoned.includes("unknown verdict") && poisoned.includes("unknown severity"),
    narration_handles_malformed_and_summary_only_records: narrationFor(null, { reviewers: {}, findings: {} }, {}).includes("unnamed run"),
    narration_and_chunks_are_bounded: narrationFor({ ...run, label: "x".repeat(5000) }, report, []).length <= MAX_NARRATION_LENGTH && chunkForSpeech("word ".repeat(300)).every((chunk) => chunk.length <= 140),
    generated_html_escapes_legacy_injection_fields: !hostileHtml.includes("<img") && hostileHtml.includes("&lt;img") && hostileHtml.includes('data-narration="Review “quote&quot; &lt;tag&gt;”'),
    local_voice_click_starts_and_same_button_stops: startWorks && sameButtonStops,
    cross_run_cancel_ignores_stale_callbacks: switchIgnoresStaleCallback,
    remote_only_voice_fails_closed: remoteButton.disabled === true && remoteSpeakCount === 0 && remoteButton.textContent === "No local speech voice available",
    speech_engine_exception_resets_truthfully: throwingButton.getAttribute("aria-pressed") === "false" && throwingStatus.textContent === "Local speech could not start.",
    pagehide_handler_is_installed: typeof pageListeners.pagehide === "function",
    zero_success_routes_render_no_verdict_without_clean_findings: noVerdictHtml.includes("no verdict — 0/1 completed")
      && noVerdictHtml.includes("run record · no completed reviews") && !noVerdictHtml.includes("0 findings")
      && zeroRouteHtml.includes("no verdict — 0/0 completed") && !zeroRouteHtml.includes("outcome unknown")
      && zeroRouteNarration.includes("0 of 0 reviewers completed") && zeroRouteNarration.includes("No external review verdict was produced")
      && !zeroRouteNarration.includes("unknown verdict") && !zeroRouteNarration.includes("1 accept")
      && legacyUnknownHtml.includes("outcome unknown") && narrationFor({ run_id: "rev_zero", governor: "codex", reviewer_status: { grok: "timeout" } }, { reviewers: [{ agent: "grok", status: "timeout" }], findings: [] }, []).includes("No external review verdict was produced")
      && !narrationFor({ run_id: "rev_zero", governor: "codex", reviewer_status: { grok: "timeout" } }, { reviewers: [{ agent: "grok", status: "timeout" }], findings: [] }, []).includes("No findings"),
    failed_routes_use_sealed_closed_vocabulary_and_exclude_governor: failedRouteHtml.includes("Routes without a review: unknown reviewer (unknown status), Grok (timed out)")
      && !failedRouteHtml.includes("SENTINEL") && !failedRouteHtml.includes("Codex (") ,
    attachment_descriptors_and_regions_are_bounded_escaped_and_never_spoken: attachmentHtml.includes("attachment-1")
      && attachmentHtml.includes("sha256 dddddddddddd…") && attachmentHtml.includes("region x=12, y=8, 100×40")
      && attachmentHtml.includes("privacy metadata removed") && !attachmentHtml.includes("SENTINEL")
      && !narrationFor(attachmentRun, attachmentReport, []).includes("attachment-1"),
    suggestion_decision_stats_are_classified_counts_only_and_unranked: suggestionHtml.includes("Suggestion decisions")
      && suggestionHtml.includes("qualified adoption") && suggestionHtml.includes("do not rank reviewers or measure correctness")
      && suggestionHtml.includes("2 unclassified records") && !suggestionHtml.includes("SENTINEL")
      && !suggestionHtml.includes("precision") && !suggestionHtml.includes("%</"),
    completion_states_show_bounded_next_actions: stateHtml.includes("Suggestion dispositions — 0/1 adjudicated")
      && stateHtml.includes("fill pending/rev_pending.json")
      && stateHtml.includes("0/1 required external reviews succeeded")
      && stateHtml.includes("Completion evidence is invalid: digest anchor missing")
      && stateHtml.includes("Legacy record: it has no supported sealed obligation derivation")
      && stateHtml.includes("1 finding(s) remain open") && !stateHtml.includes("reproduced finding(s) remain open"),
    completed_suggestion_shows_type_and_evidence: stateHtml.includes("behavioral · rejected")
      && stateHtml.includes("Boundary is wrong") && stateHtml.includes("boundary test fails"),
    only_digest_anchored_report_bytes_are_renderable: Boolean(anchoredProbe.record) && tamperedProbe.record === null
      && quarantineHtml.includes("1 report file was withheld") && quarantineHtml.includes("unanchored files is never rendered"),
    oversized_private_evidence_reads_fail_before_allocation: dispositionsBounded && reportBounded && existingLedgerBounded,
  };
  const passed = Object.values(tests).every(Boolean);
  process.stdout.write(`${JSON.stringify({ passed, total: Object.keys(tests).length, tests }, null, 2)}\n`);
  process.exit(passed ? 0 : 1);
}

if (process.argv.includes("--self-test")) ledgerSelfTest();

const evidenceArgIndex = process.argv.indexOf("--evidence-dir");
if (evidenceArgIndex >= 0 && !process.argv[evidenceArgIndex + 1]) {
  process.stderr.write("--evidence-dir requires a path\n");
  process.exit(1);
}
const evidenceContext = resolveEvidenceContext({ cwd: process.cwd(), evidenceDir: evidenceArgIndex >= 0 ? process.argv[evidenceArgIndex + 1] : null });
const er = evidenceContext.directory;
if (!fs.existsSync(er)) {
  process.stderr.write("No .ensemble_reviews here — run a momm review first, then rebuild your ledger.\n");
  process.exit(1);
}
try {
  ensureEvidenceZone(evidenceContext, { create: false });
  const protection = protectEvidenceFromGit(evidenceContext);
  if (protection.status === "unavailable") throw new Error(`private evidence is not protected from Git: ${protection.error || "local exclusion failed"}`);
  ensureEvidenceZone(evidenceContext);
  assertSafeEvidencePath(er);
  for (const managed of ["review-log.jsonl", "dispositions.jsonl", "reports", "completions", "ledger.html"]) assertSafeEvidencePath(er, managed);
} catch (error) {
  process.stderr.write(`Unsafe private evidence layout — ${error.message}\n`);
  process.exit(1);
}

let logState;
try { logState = readReviewLog(er); }
catch (error) {
  process.stderr.write(`Review log is corrupt — ${error.message}\n`);
  process.exit(1);
}
const runs = logState.rows.filter((entry) => isRecord(entry) && !entry.event);
let dispositions;
try { dispositions = readLedgerJsonl(path.join(er, "dispositions.jsonl"), "ledger dispositions", MAX_DISPOSITIONS_BYTES).filter(isRecord); }
catch (error) {
  process.stderr.write(`Disposition history is too large or unreadable — ${error.message}\n`);
  process.exit(1);
}
const reports = Object.create(null);
const quarantinedReports = [];
const reportsDir = path.join(er, "reports");
if (fs.existsSync(reportsDir)) {
  for (const file of fs.readdirSync(reportsDir).filter((entry) => entry.endsWith(".json"))) {
    try {
      assertSafeEvidencePath(er, path.join("reports", file));
      const anchored = readReportForLedger(file, path.join(reportsDir, file), logState.rows);
      if (anchored.record) reports[anchored.run_id] = anchored.record;
      else quarantinedReports.push({ run_id: anchored.run_id, error: anchored.error });
    } catch (error) { quarantinedReports.push({ run_id: file.replace(/\.json$/, ""), error: String(error?.message ?? error).slice(0, 300) }); }
  }
}

const completionStatuses = Object.create(null);
for (const run of runs) {
  if (typeof run.run_id !== "string") continue;
  completionStatuses[run.run_id] = reports[run.run_id]
    ? completionStatus(er, run.run_id)
    : quarantinedReports.some((entry) => entry.run_id === run.run_id)
      ? { run_id: run.run_id, state: "invalid", complete: false, completed: 0, total: 0, error: "sealed report was withheld because its bytes are not bound to the review log" }
      : { run_id: run.run_id, state: "legacy_unverifiable", complete: false, completed: 0, total: 0 };
}
const html = renderLedgerHtml({ runs, dispositions, reports, completionStatuses, generated: new Date().toISOString(), logDegraded: logState.degraded_tail, quarantinedReports });

// The ledger renders private reviewer transcripts. Files receive owner-only
// POSIX modes; Windows inherits the chosen directory's ACL.
// Remove any prior file first so writeFileSync always creates fresh at mode
// 0600 (its mode arg is ignored when overwriting), leaving no world-readable
// window between write and chmod.
const outPath = path.join(er, "ledger.html");
if (fs.existsSync(outPath)) {
  let existing;
  try { existing = readBoundedText(outPath, "existing private ledger", MAX_EXISTING_LEDGER_BYTES).slice(0, 500); }
  catch (error) {
    process.stderr.write(`Refusing to replace an oversized or unreadable ledger.html — ${error.message}\n`);
    process.exit(1);
  }
  if (!existing.includes("momm-private-ledger/1") && !existing.includes("<title>My momm ledger</title>")) {
    process.stderr.write("Refusing to overwrite an unrecognized ledger.html in the evidence directory.\n");
    process.exit(1);
  }
}
const temporaryLedger = `${outPath}.tmp-${randomUUID()}`;
fs.writeFileSync(temporaryLedger, html, { mode: 0o600, flag: "wx" });
try {
  if (fs.existsSync(outPath)) fs.rmSync(outPath);
  fs.renameSync(temporaryLedger, outPath);
} catch (error) {
  try { fs.rmSync(temporaryLedger, { force: true }); } catch {}
  throw error;
}
process.stdout.write(`Your private local ledger: ${outPath}\n(${runs.length} runs, ${Object.keys(reports).length} sealed reports — MOMM never publishes this file automatically; verify repository status before committing.)\n`);
if (process.argv.includes("--open")) {
  const opener = process.platform === "win32" ? ["explorer.exe", [outPath]] : process.platform === "darwin" ? ["open", [outPath]] : ["xdg-open", [outPath]];
  try { spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }).unref(); } catch {}
}
