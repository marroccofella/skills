#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { completionStatus, deriveGovernorActions, prepareDraft } from "./review-completion.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatcher = path.join(here, "multi-review.mjs");
const completionCli = path.join(here, "review-completion.mjs");
const ledger = path.join(here, "ledger.mjs");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizeProcessResult = (result) => ({
  ...result,
  stdout: typeof result?.stdout === "string" ? result.stdout : "",
  stderr: typeof result?.stderr === "string" ? result.stderr : "",
});
const run = (command, args, options = {}) => normalizeProcessResult(spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 120_000, ...options }));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const boundedOutput = (value) => String(value ?? "").trim().slice(0, 1_000);

function processDiagnostic(label, result) {
  const error = result.error ? `${result.error.code || result.error.name || "error"}: ${result.error.message}` : "none";
  const output = boundedOutput(result.stderr) || boundedOutput(result.stdout) || "no child output";
  return `${label} failed (error=${error}, status=${result.status ?? "null"}, signal=${result.signal ?? "none"}): ${output}`;
}

function requireStatus(label, result, allowed) {
  if (result.error || !allowed.includes(result.status)) throw new Error(processDiagnostic(label, result));
  return result;
}

function jsonOutput(label, result, allowed = [0]) {
  requireStatus(label, result, allowed);
  try { return JSON.parse(result.stdout); }
  catch (error) { throw new Error(`${processDiagnostic(label, result)}; stdout is not valid JSON: ${error.message}`); }
}

function streamEvents(label, result, allowed) {
  requireStatus(label, result, allowed);
  try { return result.stderr.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { throw new Error(`${processDiagnostic(label, result)}; stderr is not valid NDJSON: ${error.message}`); }
}

function git(root, args) {
  const result = run("git", ["-C", root, ...args]);
  requireStatus(`git ${args.join(" ")}`, result, [0]);
  return result.stdout.trim();
}

function validDecisionDraft(draft) {
  const value = JSON.parse(JSON.stringify(draft));
  value.decisions = value.decisions.map((decision) => decision.kind === "finding"
    ? {
      ...decision,
      disposition: "fixed",
      reason: "The governor reproduced and fixed the defect.",
      reproduction: { method: "test", outcome: "reproduced", evidence: "boundary test failed before the fix" },
      verification: [{ kind: "test", outcome: "pass", evidence: "boundary test and full suite pass after the fix" }],
    }
    : { ...decision, claim_type: "other", disposition: "rejected", reason: "The suggestion conflicts with the required streaming design.", verification: [] });
  value.final_checks = [{ kind: "test", outcome: "pass", evidence: "project test suite" }];
  return value;
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "momm-first-run-"));
  try {
    const missingResult = normalizeProcessResult({ error: Object.assign(new Error("missing executable"), { code: "ENOENT" }), status: null, signal: null, stdout: undefined, stderr: undefined });
    const timeoutResult = normalizeProcessResult({ error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), status: null, signal: "SIGTERM", stdout: null, stderr: null });
    const missingDiagnostic = processDiagnostic("missing fixture", missingResult);
    const timeoutDiagnostic = processDiagnostic("timeout fixture", timeoutResult);
    assert(missingResult.stdout === "" && missingResult.stderr === "" && missingDiagnostic.includes("missing fixture") && missingDiagnostic.includes("ENOENT")
      && timeoutResult.stdout === "" && timeoutResult.stderr === "" && timeoutDiagnostic.includes("timeout fixture") && timeoutDiagnostic.includes("ETIMEDOUT")
      && timeoutDiagnostic.includes("signal=SIGTERM") && !missingDiagnostic.includes("undefined") && !timeoutDiagnostic.includes("TypeError"),
    "subprocess diagnostics do not safely preserve missing/timeout context");

    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "momm-test@example.invalid"]);
    git(root, ["config", "user.name", "MOMM Test"]);
    const input = path.join(root, "input.txt");
    fs.writeFileSync(input, "deterministic first-run artifact\n", "utf8");
    git(root, ["add", "input.txt"]);
    git(root, ["commit", "-q", "-m", "fixture"]);
    const nested = path.join(root, "src", "nested");
    fs.mkdirSync(nested, { recursive: true });

    const refused = run(process.execPath, [dispatcher, "--governor", "codex", "--reviewers", "codex", "--input", input, "--stream", "--pretty"], {
      cwd: nested,
      env: { ...process.env, NO_UPDATE_CHECK: "1", MULTI_LLM_REVIEW_DEPTH: "0" },
    });
    const refusedEvents = streamEvents("temporary-evidence refusal", refused, [1]);
    assert(refused.status === 1 && refusedEvents.length === 1 && refusedEvents[0].event === "final" && refusedEvents[0].phase === "failed", "temporary evidence was not refused before dispatch");
    assert(!refusedEvents.some((event) => event.event === "reviewer.started") && !fs.existsSync(path.join(root, ".ensemble_reviews")), "temporary-evidence refusal spent a reviewer call or wrote evidence");

    const impossible = run(process.execPath, [dispatcher, "--governor", "codex", "--reviewers", "codex", "--min-success", "2", "--input", input, "--stream", "--allow-ephemeral-evidence"], {
      cwd: nested,
      env: { ...process.env, NO_UPDATE_CHECK: "1", MULTI_LLM_REVIEW_DEPTH: "0" },
    });
    const impossibleEvents = streamEvents("impossible quorum refusal", impossible, [1]);
    assert(impossible.status === 1 && impossibleEvents.length === 1 && /requested external reviewer route/.test(impossibleEvents[0].error)
      && !fs.existsSync(path.join(root, ".ensemble_reviews")), "impossible text quorum was not rejected before dispatch/evidence");

    const dispatched = run(process.execPath, [dispatcher, "--governor", "codex", "--reviewers", "codex", "--input", input, "--stream", "--pretty", "--allow-ephemeral-evidence"], {
      cwd: nested,
      env: { ...process.env, NO_UPDATE_CHECK: "1", MULTI_LLM_REVIEW_DEPTH: "0" },
    });
    const report = jsonOutput("deterministic dispatcher", dispatched);
    const events = streamEvents("deterministic dispatcher", dispatched, [0]);
    assert(events.at(-1)?.event === "final", "stream final event is not terminal");
    assert(events.filter((event) => event.event === "final").length === 1, "stream emitted more than one final event");
    assert(events.some((event) => event.event === "governor_actions_required"), "stream omitted governor actions");
    assert(events.filter((event) => event.event === "evidence_location_warning").length === 1, "stream did not emit exactly one temporary evidence warning");
    assert(events.findIndex((event) => event.event === "evidence_location_warning") < events.findIndex((event) => event.event === "dispatch"), "temporary evidence warning arrived after dispatch");
    assert(events.at(-1).ledger_url && events.at(-1).required_user_message, "terminal event omitted the ledger handoff");
    assert(events.at(-1).governor_work?.status?.executable === process.execPath
      && Array.isArray(events.at(-1).governor_work.status.args)
      && path.resolve(events.at(-1).governor_work.status.args[0]) === path.resolve(completionCli)
      && events.at(-1).governor_work.finalize === null,
    "terminal stream event omitted structured governor status or exposed a blocked finalizer");
    const structuredStatus = run(events.at(-1).governor_work.status.executable, events.at(-1).governor_work.status.args, { cwd: nested });
    const structuredStatusOutput = jsonOutput("structured blocked status", structuredStatus, [5]);
    assert(structuredStatus.status === 5 && structuredStatusOutput.state === "blocked_peer_gate"
      && structuredStatusOutput.required_user_message.startsWith("MOMM REVIEW NOT FINISHED"),
    "structured governor status argv was not directly executable");
    assert(report.evidence.directory_source === "git_root", "evidence did not bind to the git root");
    assert(report.evidence.ephemeral === true, "temporary-root evidence was not marked ephemeral");
    assert(report.governor_actions.peer_collection.met === false, "zero external reviews falsely met the peer gate");
    assert(report.review_complete === false && events.at(-1).review_complete === false, "peer collection was falsely labeled a completed review");
    assert(report.evidence.governor_work?.status && !report.evidence.governor_work?.pending_file && !report.evidence.governor_work?.finalize, "blocked peer gate exposed an impossible decision draft/finalizer");
    assert(fs.existsSync(path.join(root, ".ensemble_reviews", "ledger.html")), "ledger was not rebuilt at the project root");
    assert(!fs.existsSync(path.join(root, ".gitignore")), "privacy protection dirtied the tracked worktree");
    assert(git(root, ["status", "--porcelain"]) === "", "private evidence or protection appears in git status");

    const evidenceDir = path.join(root, ".ensemble_reviews");
    const fixtureFinding = { id: "percentile-bound", severity: "WARNING", target_file: "metrics.py", line_range: [40, 44], attachment_id: null, region: null, issue: "Percentile bound is off by one.", rationale: "The upper rank is selected incorrectly.", test_suggestion: "Assert the maximum percentile." };
    const fixture = {
      report_schema: "momm-report/1",
      dispatcher_version: "1.12.1",
      run_id: "rev_completion_fixture",
      governor: "codex",
      strict: false,
      reviewers: [
        { agent: "codex", status: "self_excluded", suggested_improvements: null },
        { agent: "grok", status: "success", verdict: "MODIFY", suggested_improvements: ["Use fsum", "Use fsum"], findings: [fixtureFinding] },
      ],
      findings: [{ ...fixtureFinding, correlation_id: "momm-fixture", sources: ["grok"], claims: [{ agent: "grok", ...fixtureFinding }] }],
    };
    fixture.governor_actions = deriveGovernorActions(fixture);
    const fixtureRaw = `${JSON.stringify(fixture, null, 2)}\n`;
    const fixtureDigest = sha256(Buffer.from(fixtureRaw));
    fs.writeFileSync(path.join(evidenceDir, "reports", `${fixture.run_id}.json`), fixtureRaw);
    fs.appendFileSync(path.join(evidenceDir, "review-log.jsonl"), `${JSON.stringify({ timestamp: new Date().toISOString(), run_id: fixture.run_id, governor: "codex", reviewer_status: { codex: "self_excluded", grok: "success" }, report_path: `reports/${fixture.run_id}.json`, report_sha256: fixtureDigest })}\n`);
    const prepared = prepareDraft(evidenceDir, fixture, fixtureDigest);
    assert(completionStatus(evidenceDir, fixture.run_id).state === "pending", "new run did not begin pending");
    requireStatus("pending ledger rebuild", run(process.execPath, [ledger, "--evidence-dir", evidenceDir]), [0]);
    const pendingHtml = fs.readFileSync(path.join(evidenceDir, "ledger.html"), "utf8");
    assert(pendingHtml.includes("Suggestion dispositions — 0/2 adjudicated") && pendingHtml.includes("Governor disposition required"), "pending ledger hides outstanding suggestions");
    fs.appendFileSync(path.join(evidenceDir, "dispositions.jsonl"), `${JSON.stringify({ run_id: fixture.run_id, reviewer: "grok", suggestion: "Use fsum", disposition: "applied", reason: "legacy row" })}\n`);
    assert(completionStatus(evidenceDir, fixture.run_id).state === "pending", "legacy disposition falsely completed a run");

    const incomplete = validDecisionDraft(prepared.draft);
    incomplete.decisions.pop();
    const incompletePath = path.join(root, "incomplete.json");
    fs.writeFileSync(incompletePath, JSON.stringify(incomplete));
    const rejected = run(process.execPath, [completionCli, "--finalize", incompletePath, "--evidence-dir", evidenceDir]);
    if (rejected.error || rejected.status === null) throw new Error(processDiagnostic("incomplete-decision refusal", rejected));
    assert(rejected.status !== 0 && /missing 1 required decision/.test(rejected.stderr), "incomplete decisions did not fail closed");

    const valid = validDecisionDraft(prepared.draft);
    const validPath = path.join(root, "valid decisions.json");
    fs.writeFileSync(validPath, JSON.stringify(valid));
    const before = sha256(fs.readFileSync(path.join(evidenceDir, "reports", `${fixture.run_id}.json`)));
    const finalized = run(process.execPath, [completionCli, "--finalize", validPath, "--evidence-dir", evidenceDir, "--pretty"]);
    const finalizedOutput = jsonOutput("valid completion", finalized);
    assert(finalizedOutput.state === "complete_clean" && finalizedOutput.ledger_rebuilt === true
      && finalizedOutput.status_gate_passed === true && finalizedOutput.review_complete === true, "completion or automatic ledger/status gate was not truthful");
    assert(finalizedOutput.required_user_message.startsWith("MOMM REVIEW COMPLETE — complete_clean, 3/3"), "finalize relay omitted validated completion state/counts");
    assert(finalizedOutput.required_user_message.includes("TEMPORARY EVIDENCE RISK"), "finalize relay dropped the temporary-evidence durability warning");
    const statusGate = run(process.execPath, [completionCli, "--status", fixture.run_id, "--evidence-dir", evidenceDir, "--pretty"]);
    const statusOutput = jsonOutput("final completion status", statusGate);
    assert(statusGate.status === 0 && statusOutput.required_user_message.startsWith("MOMM REVIEW COMPLETE — complete_clean, 3/3")
      && statusOutput.required_user_message.includes("TEMPORARY EVIDENCE RISK") && statusOutput.ledger_url
      && statusOutput.status_gate_passed === true && statusOutput.review_complete === true, "mandatory status gate dropped completion state, durability warning, or ledger link");
    const after = sha256(fs.readFileSync(path.join(evidenceDir, "reports", `${fixture.run_id}.json`)));
    assert(before === after, "finalization modified the sealed peer report");
    const html = fs.readFileSync(path.join(evidenceDir, "ledger.html"), "utf8");
    assert(html.includes("Complete — 3/3 adjudicated"), "ledger lacks the completed numerator/denominator");
    assert(html.includes("Findings — reviewer claims adjudicated (1/1)"), "ledger still labels adjudicated findings as pending");
    assert(html.includes("Suggestion dispositions — 2/2 adjudicated"), "ledger lacks suggestion completion detail");
    assert(!html.includes("Findings — claims awaiting reproduction"), "stale pre-adjudication heading survived completion");
    if (process.platform !== "win32") {
      // Cross-module privacy contract: ledger.mjs owns ledger.html creation;
      // this end-to-end journey pins its owner-only mode alongside all other
      // completion evidence. CI repeats the same check on Linux and macOS.
      const mode = (file) => fs.statSync(file).mode & 0o777;
      const privateFiles = [
        path.join(evidenceDir, ".momm-evidence-zone.json"),
        prepared.path,
        path.join(evidenceDir, "completions", fixture.run_id, "completion.json"),
        path.join(evidenceDir, "ledger.html"),
      ];
      const privateDirectories = [evidenceDir, path.join(evidenceDir, "pending"), path.join(evidenceDir, "completions"), path.join(evidenceDir, "completions", fixture.run_id)];
      assert(privateFiles.every((file) => (mode(file) & 0o077) === 0) && privateDirectories.every((dir) => (mode(dir) & 0o077) === 0), "MOMM-created completion evidence is group/other accessible on POSIX");
    }

    git(root, ["add", "-f", ".ensemble_reviews/.momm-evidence-zone.json"]);
    const privacyStatus = run(process.execPath, [completionCli, "--status", fixture.run_id, "--evidence-dir", evidenceDir, "--pretty"]);
    const privacyOutput = jsonOutput("privacy-failure status", privacyStatus, [1]);
    assert(privacyStatus.status === 1 && privacyOutput.state === "complete_clean" && privacyOutput.complete === true
      && privacyOutput.privacy_protected === false && privacyOutput.privacy_error && privacyOutput.ledger_url === null
      && privacyOutput.status_gate_passed === false && privacyOutput.review_complete === false
      && privacyOutput.required_user_message.startsWith("MOMM REVIEW NOT FINISHED") && !privacyOutput.required_user_message.includes("MOMM REVIEW COMPLETE"),
    "status hid the validated completion state when Git privacy protection failed");

    process.stdout.write(`${JSON.stringify({ passed: true, tests: {
      nested_project_root_and_local_exclude: true,
      subprocess_failures_keep_actionable_context: true,
      ephemeral_default_refuses_before_spend: true,
      impossible_quorum_refuses_before_spend: true,
      stream_final_is_last_and_truthful: true,
      stream_final_carries_structured_governor_handoff: true,
      structured_governor_argv_executes_directly: true,
      temporary_evidence_warning_is_machine_visible: true,
      peer_gate_blocks_zero_success: true,
      blocked_gate_has_no_impossible_draft: true,
      legacy_rows_cannot_fake_completion: true,
      exact_decision_coverage_is_enforced: true,
      sealed_report_survives_finalization: true,
      pending_ledger_shows_zero_of_n: true,
      status_last_repeats_completion_and_ledger: true,
      status_preserves_state_when_privacy_guard_fails: true,
      completion_evidence_requests_private_posix_modes: true,
      ledger_rebuilds_to_validated_completion: true,
    } }, null, 2)}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

main();
