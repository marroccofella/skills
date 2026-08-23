#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GOVERNOR_IDS, PROVIDER_IDS } from "./provider-manifest.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dispatcher = path.join(scriptDir, "multi-review.mjs");
const installer = path.join(scriptDir, "install.mjs");
const VALID_GOVERNORS = new Set([...GOVERNOR_IDS, "agy"]);
const VALID_REVIEWERS = new Set(PROVIDER_IDS);

function usage() {
  return `Usage:
  node scripts/onboard.mjs --governor <current-harness> [options]

Options:
  --governor <name>     codex, gemini, claude, antigravity/agy, copilot, grok, or other
  --reviewers <csv>     Reviewer routes to check (default: MOMM's standard pool)
  --link                Link MOMM into the governor's documented user skill directory
  --json                Emit a machine-readable onboarding report
  --help                Show this help

This command makes zero model calls and never reads credential contents.`;
}

function parseArgs(argv) {
  const options = { governor: "", reviewers: "", link: false, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };
    if (arg === "--governor") options.governor = next().trim().toLowerCase();
    else if (arg === "--reviewers") {
      const reviewers = next().split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
      const normalized = reviewers.map((name) => name === "agy" ? "antigravity" : name);
      const invalid = normalized.filter((name) => !VALID_REVIEWERS.has(name));
      if (!normalized.length || invalid.length) {
        throw new Error(`--reviewers must be a comma-separated subset of ${[...VALID_REVIEWERS].join(", ")}`);
      }
      options.reviewers = [...new Set(normalized)].join(",");
    }
    else if (arg === "--link") options.link = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.governor === "agy") options.governor = "antigravity";
  return options;
}

function runNode(script, args, timeout = 45_000) {
  return spawnSync(process.execPath, [script, ...args], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout,
    env: { ...process.env, NO_UPDATE_CHECK: "1" },
  });
}

function compact(value, limit = 1200) {
  return String(value || "").trim().slice(0, limit);
}

function linkTarget(governor) {
  if (["codex", "gemini", "claude", "antigravity"].includes(governor)) return governor;
  return null;
}

function linkSkill(governor) {
  const target = linkTarget(governor);
  if (!target) {
    return {
      status: "not_applicable",
      detail: `${governor} has no verified native Agent Skills link; invoke MOMM by script instead`,
    };
  }
  const result = runNode(installer, ["--target", target]);
  if (result.error || result.status !== 0) {
    return { status: "error", detail: compact(result.stderr || result.stdout || result.error?.message) };
  }
  try {
    return { status: "complete", report: JSON.parse(result.stdout) };
  } catch {
    return { status: "error", detail: "Skill linker returned an unreadable report" };
  }
}

function preflight(options) {
  const args = ["--preflight", "--governor", options.governor];
  if (options.reviewers) args.push("--reviewers", options.reviewers);
  const result = runNode(dispatcher, args);
  if (result.error || result.status !== 0) {
    throw new Error(compact(result.stderr || result.stdout || result.error?.message || "Preflight failed"));
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("MOMM preflight returned an unreadable report");
  }
}

function routeState(route) {
  if (route.role === "governor") return "governor";
  if (route.installed === false) return "install";
  if (route.route_status === "command_error") return "repair";
  if (route.ready && route.auth_evidence === "live_status") return "session";
  if (route.ready) return "possible";
  if (route.auth === "absent") return "login";
  return "attention";
}

function nextActions(routes) {
  const actions = [];
  for (const route of routes) {
    const state = routeState(route);
    if (state === "install" && route.install_hint) actions.push({ agent: route.agent, action: "install", command: route.install_hint });
    if (state === "repair" && route.install_hint) actions.push({ agent: route.agent, action: "repair", command: route.install_hint });
    if (state === "login" && route.login_hint) actions.push({ agent: route.agent, action: "login", command: route.login_hint });
  }
  return actions;
}

function renderHuman(report) {
  const lines = [
    "MOMM first-run check",
    "====================",
    "",
    "Privacy: zero model calls were made. Credential contents were not read.",
    "Code leaves this machine only when you deliberately start a real review.",
    "",
  ];
  if (report.link) {
    lines.push(`Skill link: ${report.link.status}${report.link.detail ? ` - ${report.link.detail}` : ""}`, "");
  }
  lines.push("Reviewer routes:");
  for (const route of report.routes) {
    const state = routeState(route);
    const version = route.version ? ` (${String(route.version).split("\n")[0]})` : "";
    lines.push(`  [${state}] ${route.agent}${version}${route.note ? ` - ${route.note}` : ""}`);
  }
  if (report.next_actions.length) {
    lines.push("", "Next actions (run only the providers you want to use):");
    report.next_actions.forEach((item, index) => lines.push(`  ${index + 1}. ${item.agent} ${item.action}: ${item.command}`));
    lines.push("", `Then re-run: ${report.rerun_command}`);
  }
  if (report.ready_reviewers.length) {
    lines.push(
      "",
      `Provider-reported signed-in sessions (not a live model proof): ${report.ready_reviewers.join(", ")}`,
    );
  }
  if (report.possible_reviewers.length) {
    lines.push("", `Possible local sessions (presence evidence only): ${report.possible_reviewers.join(", ")}`);
  }
  if (report.ready_reviewers.length || report.possible_reviewers.length) {
    lines.push(
      "Live verification with isolated synthetic text:",
      `  node scripts/setup-ui.mjs --governor ${report.governor}`,
      "A first review will also fail closed if the provider session is unusable:",
      `  ${report.first_review_command}`,
      "Or ask your harness: Use $momm to review my current changes.",
    );
  } else {
    lines.push("", "No external reviewer session was detected. Complete one install or sign-in action above, then re-run this check.");
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!VALID_GOVERNORS.has(options.governor)) {
    process.stderr.write(`--governor is required and must name the harness currently in control.\n${usage()}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const link = options.link ? linkSkill(options.governor) : null;
    const preflightReport = preflight(options);
    const routes = preflightReport.routes || [];
    const readyReviewers = routes.filter((route) => route.ready && route.role !== "governor" && route.auth_evidence === "live_status").map((route) => route.agent);
    const possibleReviewers = routes.filter((route) => route.ready && route.role !== "governor" && route.auth_evidence !== "live_status").map((route) => route.agent);
    const reviewersArg = options.reviewers ? ` --reviewers ${options.reviewers}` : "";
    const report = {
      policy: "oauth-only",
      model_calls_made: false,
      credential_contents_read: false,
      governor: options.governor,
      link,
      routes,
      ready_reviewers: readyReviewers,
      possible_reviewers: possibleReviewers,
      readiness_semantics: "ready_reviewers require a provider live-status command; possible_reviewers are presence evidence only; neither is a model-call proof",
      next_actions: nextActions(routes),
      rerun_command: `node scripts/onboard.mjs --governor ${options.governor}${reviewersArg}`,
      first_review_command: `node scripts/multi-review.mjs --governor ${options.governor}${reviewersArg} --min-success 1`,
    };
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderHuman(report));
    if (link?.status === "error") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Onboarding check failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
