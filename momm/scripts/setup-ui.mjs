#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanOauthEnv, sanitizeProviderDiagnostic } from "./oauth-env.mjs";
import { GOVERNOR_IDS, PROVIDER_IDS, PROVIDER_MANIFEST } from "./provider-manifest.mjs";
import { SETUP_PROBE_AUTH_REQUEST, SETUP_PROBE_AUTH_RESPONSE, SETUP_PROBE_INPUT, SETUP_PROBE_LABEL, setupProbeDescriptor } from "./setup-probe-contract.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.join(scriptDir, "..", "assets", "setup-ui");
const skillsRoot = path.resolve(scriptDir, "..", "..");
const onboardScript = path.join(scriptDir, "onboard.mjs");
const dispatcherScript = path.join(scriptDir, "multi-review.mjs");
const myskillsScript = path.join(skillsRoot, "myskills", "scripts", "run-all.mjs");
const localVersionsFile = path.join(skillsRoot, "versions.json");
const publishedVersionsUrl = "https://raw.githubusercontent.com/marroccofella/skills/main/versions.json";
const governors = new Set(GOVERNOR_IDS);
const setupApiSchema = "momm-setup/3";
const setupUiVersion = "1.10.1";
const sessionToken = crypto.randomBytes(24).toString("hex");
const jobs = new Map();
const latestJobs = new Map();
const maxJobs = 12;
const jobTtlMs = 30 * 60_000;
const verificationTtlMs = 10 * 60_000;
let activeServer = null;
let confirmedGovernor = null;
let controllerRevision = 0;
let controllerOperations = 0;
let serverClosing = false;
const maintenanceCache = new Map();
const backgroundChildren = new Set();
const backgroundFetchControllers = new Set();

const providers = PROVIDER_MANIFEST;
const setupReviewers = PROVIDER_IDS.join(",");
const skillTools = Object.freeze({
  "github-cli": {
    label: "GitHub CLI",
    install: {
      win32: "winget install --id GitHub.cli --exact",
      darwin: "brew install gh",
      linux: "printf 'Open https://cli.github.com/manual/installation for the package command for this Linux distribution.\\n'",
    },
    login: { win32: "gh auth login --web", darwin: "gh auth login --web", linux: "gh auth login --web" },
    installNote: "The terminal uses GitHub's documented installer route for this platform.",
    loginNote: "Complete GitHub CLI sign-in in the browser window that opens.",
  },
});

function parseArgs(argv) {
  const options = { port: 0, browser: true, selfTest: false, governor: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") {
      index += 1;
      options.port = Number.parseInt(argv[index] || "", 10);
    } else if (arg === "--no-browser") options.browser = false;
    else if (arg === "--governor") {
      index += 1;
      options.governor = String(argv[index] || "").trim().toLowerCase();
    }
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error("--port must be an integer from 0 to 65535");
  }
  if (options.governor && !governors.has(options.governor)) throw new Error("--governor must name a supported controller");
  return options;
}

function usage() {
  return `Usage: node scripts/setup-ui.mjs [--governor <name>] [--port <number>] [--no-browser]\n\nStarts MOMM Setup Center on 127.0.0.1. Pass the agent currently in control so it is always self-excluded.`;
}

function platformKey() {
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
}

function actionCommand(provider, action, platform = platformKey()) {
  if (provider === "skills" && ["update", "diff", "commit"].includes(action)) {
    const windows = platform === "win32";
    const quoted = windows
      ? `'${skillsRoot.replaceAll("'", "''")}'`
      : `'${skillsRoot.replaceAll("'", `'\\''`)}'`;
    if (action === "update") return `git -C ${quoted} pull --ff-only`;
    if (action === "diff") return windows
      ? `Set-Location ${quoted}; git status --short; git diff --stat; git diff`
      : `cd ${quoted} && git status --short && git diff --stat && git diff`;
    return windows
      ? `Set-Location ${quoted}; git status; Write-Host ''; Write-Host 'Review the files above. Stage only what you intend with git add, then run git commit with your own message.'`
      : `cd ${quoted} && git status; printf '%s\\n' '' 'Review the files above. Stage only what you intend with git add, then run git commit with your own message.'`;
  }
  const record = providers[provider] || skillTools[provider];
  if (!record || !["login", "install", "update", "models"].includes(action)) return null;
  return record[action]?.[platform] || null;
}

function actionNote(provider, action) {
  if (provider === "skills" && action === "update") return "The terminal will fast-forward the verified skills repository only if Git can do so safely. Restart Setup Center afterward so frontend and backend versions match.";
  if (provider === "skills" && action === "diff") return "The terminal shows the current skill changes without modifying them.";
  if (provider === "skills" && action === "commit") return "The terminal shows Git status and leaves staging and the commit message under your control.";
  const record = providers[provider] || skillTools[provider];
  if (action === "models") return record?.modelsNote;
  if (action === "update") return `The terminal will show ${record?.label || provider}'s official updater.`;
  if (action === "install") return record?.installNote || `The terminal will show ${record?.label || provider}'s documented installer.`;
  return record?.loginNote;
}

function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      child.off("close", finish);
      resolve();
    };
    const deadline = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish();
    }, 5_000);
    child.once("close", finish);
    try {
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => { try { child.kill("SIGKILL"); } catch {} });
      } else {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      try { child.kill("SIGKILL"); } catch {}
    }
  });
}

function issueSetupProbeAuthorization({ governor, reviewer }) {
  return { ...setupProbeDescriptor({ governor, reviewer }), consumed: false };
}

function consumeSetupProbeAuthorization(authorization, message) {
  if (!authorization || authorization.consumed || message?.type !== SETUP_PROBE_AUTH_REQUEST) return false;
  const matches = ["governor", "reviewer", "label", "input_sha256"]
    .every((key) => message[key] === authorization[key]);
  if (matches) authorization.consumed = true;
  return matches;
}

function runNode(script, args, {
  input = "",
  timeoutMs = 45_000,
  cwd = process.cwd(),
  envSource = process.env,
  signal = null,
  setupProbeAuthorization = null,
  provider = null,
  onChild = null,
} = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminationReason = null;
    let child;
    let timer = null;
    let hardDeadline = null;
    const abort = () => terminate("cancelled");
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardDeadline);
      signal?.removeEventListener("abort", abort);
      if (child) backgroundChildren.delete(child);
      resolve({ ...result, stdout, stderr, timedOut: terminationReason === "timeout", cancelled: terminationReason === "cancelled" });
    };
    const terminate = async (reason) => {
      if (settled || terminationReason) return;
      terminationReason = reason;
      await terminateProcessTree(child);
      if (!settled) hardDeadline = setTimeout(() => finish({ code: null, signal: "SIGKILL" }), 250);
    };
    try {
      const env = cleanOauthEnv(envSource, { provider });
      child = spawn(process.execPath, [script, ...args], {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: setupProbeAuthorization ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"],
      });
      backgroundChildren.add(child);
      if (setupProbeAuthorization) {
        child.on("message", (message) => {
          if (message?.type !== SETUP_PROBE_AUTH_REQUEST) return;
          const authorized = consumeSetupProbeAuthorization(setupProbeAuthorization, message);
          try { child.send({ type: SETUP_PROBE_AUTH_RESPONSE, request_id: message.request_id, authorized }); }
          catch {}
        });
      }
      onChild?.(child);
    } catch (error) {
      finish({ code: null, error });
      return;
    }
    if (signal?.aborted) terminate("cancelled");
    else signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => terminate("timeout"), timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < 2_000_000) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 100_000) stderr += chunk.toString("utf8"); });
    child.on("error", (error) => finish({ code: null, error }));
    child.on("close", (code, childSignal) => finish({ code, signal: childSignal }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function runCommand(command, args = [], {
  timeoutMs = 15_000,
  envSource = process.env,
  provider = null,
  signal = null,
  cwd = process.cwd(),
} = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminationReason = null;
    let child;
    let timer = null;
    let hardDeadline = null;
    const abort = () => terminate("cancelled");
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardDeadline);
      signal?.removeEventListener("abort", abort);
      if (child) backgroundChildren.delete(child);
      resolve({ ...result, stdout, stderr, timedOut: terminationReason === "timeout", cancelled: terminationReason === "cancelled" });
    };
    const terminate = async (reason) => {
      if (settled || terminationReason) return;
      terminationReason = reason;
      await terminateProcessTree(child);
      if (!settled) hardDeadline = setTimeout(() => finish({ code: null, signal: "SIGKILL" }), 250);
    };
    try {
      child = spawn(command, args, {
        cwd,
        env: cleanOauthEnv(envSource, { provider }),
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      backgroundChildren.add(child);
    } catch (error) {
      finish({ code: null, error });
      return;
    }
    if (signal?.aborted) terminate("cancelled");
    else signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => terminate("timeout"), timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < 250_000) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 50_000) stderr += chunk.toString("utf8"); });
    child.on("error", (error) => finish({ code: null, error }));
    child.on("close", (code, childSignal) => finish({ code, signal: childSignal }));
  });
}

async function readiness(governor) {
  const result = await runNode(onboardScript, ["--governor", governor, "--reviewers", setupReviewers, "--json"]);
  if (result.code !== 0) throw new Error((result.stderr || "Readiness check failed").trim().slice(0, 800));
  return JSON.parse(result.stdout);
}

function parseVersion(value) {
  return String(value || "").match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)?.[1] || null;
}

function compareVersions(left, right) {
  const parse = (value) => String(value || "").split("-")[0].split(".").map((part) => Number.parseInt(part, 10));
  const a = parse(left);
  const b = parse(right);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((part) => !Number.isInteger(part))) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

async function fetchJson(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  backgroundFetchControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache", "User-Agent": "momm-setup-center" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    backgroundFetchControllers.delete(controller);
  }
}

function classifyEnvironmentNames(names) {
  const upper = [...new Set(names.map((name) => String(name).toUpperCase()))].sort();
  const apiKeyNames = upper.filter((name) => /(?:^|_)(?:API_?KEY|SECRET_?KEY)(?:_|$)/.test(name)
    || ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"].includes(name));
  const updateControls = upper.filter((name) => ["NO_UPDATE_CHECK", "DISABLE_AUTOUPDATER", "AGY_CLI_DISABLE_AUTO_UPDATE"].includes(name));
  const modelOverrides = upper.filter((name) => ["COPILOT_MODEL", "ANTHROPIC_MODEL", "CODEX_MODEL"].includes(name));
  const endpointOverrides = upper.filter((name) => /(?:BASE_URL|ENDPOINT)$/.test(name) && /(?:OPENAI|ANTHROPIC|COPILOT|GEMINI|GOOGLE|XAI)/.test(name));
  const proxies = upper.filter((name) => ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"].includes(name));
  return { api_key_names_present: apiKeyNames, update_controls_present: updateControls, model_overrides_present: modelOverrides, endpoint_overrides_present: endpointOverrides, proxy_names_present: proxies };
}

function skillVersionReport(local, published) {
  return Object.entries(local)
    .filter(([name, version]) => !name.startsWith("_") && parseVersion(version))
    .map(([name, current]) => {
      const latest = parseVersion(published?.[name]);
      const comparison = latest ? compareVersions(current, latest) : null;
      return {
        name,
        current,
        latest,
        status: comparison === -1 ? "update_available" : comparison === 0 ? "current" : comparison === 1 ? "local_newer" : "unknown",
      };
    });
}

function extractModelNames(text) {
  const cleaned = safeDetail(text).split(/\r?\n/);
  const names = [];
  for (const line of cleaned) {
    const normalized = line.replace(/^\s*[-*•]\s*/, "").replace(/\s+\(default\).*$/i, "").trim();
    const candidate = normalized.split(/\t|\s{2,}/)[0].trim();
    if (/^[a-z][a-z0-9_.:-]{2,80}$/i.test(candidate) && /(?:gpt|claude|gemini|grok|model)/i.test(candidate)) names.push(candidate);
  }
  return [...new Set(names)].slice(0, 24);
}

async function modelStatus(routes) {
  const routeMap = new Map(routes.map((route) => [route.agent, route]));
  return Promise.all(Object.keys(providers).map(async (agent) => {
    const route = routeMap.get(agent);
    if (!route || route.installed === false) return { agent, status: "missing", models: [] };
    if (route.route_status === "command_error") return { agent, status: "command_error", models: [], detail: route.detail || route.note || "The CLI command could not run." };
    if (!route.ready) return { agent, status: "login_required", models: [] };
    if (!["antigravity", "grok"].includes(agent)) return { agent, status: "interactive_selector", models: [] };
    const command = agent === "antigravity" ? "agy" : "grok";
    const result = await runCommand(command, ["models"], { timeoutMs: 20_000 });
    const models = extractModelNames(`${result.stdout}\n${result.stderr}`);
    const detail = sanitizeProviderDiagnostic(result.stderr || result.stdout, { maxLength: 600 });
    return {
      agent,
      status: result.code === 0 ? "available" : result.timedOut ? "timeout" : /(?:log[ -]?in|sign[ -]?in|auth)/i.test(detail) ? "login_required" : "command_error",
      models,
      ...(result.code === 0 || !detail ? {} : { detail }),
    };
  }));
}

async function skillsHealthReport() {
  if (!fs.existsSync(myskillsScript)) {
    return { checked: 0, working: 0, unavailable: 0, code_health: "unknown", dependency_readiness: "unknown", verdict: "myskills health runner is not installed", skills: [] };
  }
  const result = await runNode(myskillsScript, ["--pretty"], { timeoutMs: 90_000, cwd: skillsRoot });
  try {
    const parsed = JSON.parse(result.stdout);
    return { ...parsed, runner_exit_code: result.code };
  } catch {
    return { checked: 0, working: 0, unavailable: 0, code_health: "failing", dependency_readiness: "unknown", verdict: "myskills returned an unreadable health report", skills: [], runner_exit_code: result.code };
  }
}

function changedPaths(porcelain) {
  return String(porcelain || "").split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean).slice(0, 100);
}

async function maintenanceReport(governor, force = false) {
  const cached = maintenanceCache.get(governor);
  if (!force && cached && Date.now() - cached.cachedAt < 10 * 60_000) return cached.value;
  const routesReport = await readiness(governor);
  const checkout = await skillsCheckoutState();
  let localVersions = {};
  try { localVersions = JSON.parse(fs.readFileSync(localVersionsFile, "utf8")); } catch {}
  const publishedUrl = force ? `${publishedVersionsUrl}?momm=${Date.now()}` : publishedVersionsUrl;
  const [publishedResult, codexLatestResult, claudeLatestResult, copilotLatestResult, geminiLatestResult, grokUpdate, gitVersion, gitStatus, shellVersion, models, health] = await Promise.all([
    fetchJson(publishedUrl).catch(() => null),
    fetchJson("https://registry.npmjs.org/@openai%2fcodex/latest").catch(() => null),
    fetchJson("https://registry.npmjs.org/@anthropic-ai%2fclaude-code/latest").catch(() => null),
    fetchJson("https://registry.npmjs.org/@github%2fcopilot/latest").catch(() => null),
    fetchJson("https://registry.npmjs.org/@google%2fgemini-cli/latest").catch(() => null),
    runCommand("grok", ["update", "--check", "--json"], { timeoutMs: 20_000 }),
    runCommand("git", ["--version"]),
    checkout.verified ? runCommand("git", ["-C", skillsRoot, "status", "--porcelain"], { timeoutMs: 10_000 }) : Promise.resolve({ code: 1, stdout: "" }),
    // Check the same shell used by visible Setup Center actions. Windows
    // PowerShell is present on stock Windows; requiring pwsh would report a
    // false runtime failure on machines without PowerShell 7.
    process.platform === "win32"
      ? runCommand("powershell.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"])
      : Promise.resolve({ code: 0, stdout: "not required" }),
    modelStatus(routesReport.routes || []),
    skillsHealthReport(),
  ]);
  const routeMap = new Map((routesReport.routes || []).map((route) => [route.agent, route]));
  let grokLatest = null;
  let grokUpdateAvailable = null;
  try {
    const parsed = JSON.parse(grokUpdate.stdout);
    grokLatest = parseVersion(parsed.latestVersion);
    grokUpdateAvailable = parsed.updateAvailable === true;
  } catch {}
  const cliUpdates = [
    { agent: "codex", latest: parseVersion(codexLatestResult?.version), source: "npm registry", install_method_dependent: true },
    { agent: "claude", latest: parseVersion(claudeLatestResult?.version), source: "npm registry" },
    { agent: "antigravity", latest: null, source: "built-in self-updater", auto_managed: true },
    { agent: "copilot", latest: parseVersion(copilotLatestResult?.version), source: "npm registry" },
    { agent: "grok", latest: grokLatest, source: "grok update --check", update_available: grokUpdateAvailable },
    { agent: "gemini", latest: parseVersion(geminiLatestResult?.version), source: "npm registry" },
  ].map((item) => {
    const route = routeMap.get(item.agent);
    const current = parseVersion(route?.version);
    const comparison = current && item.latest ? compareVersions(current, item.latest) : null;
    return {
      ...item,
      current,
      installed: route?.installed !== false && Boolean(route),
      status: route?.installed === false || !route ? "missing" : item.auto_managed ? "auto_managed" : item.install_method_dependent ? "install_method_dependent" : item.update_available === true || comparison === -1 ? "update_available" : comparison === 0 || item.update_available === false ? "current" : "unknown",
    };
  });
  const value = {
    checked_at: new Date().toISOString(),
    skills: {
      source: publishedVersionsUrl,
      repository_present: checkout.verified,
      repository: checkout,
      repository_dirty: gitStatus.code === 0 ? Boolean(gitStatus.stdout.trim()) : null,
      changed_paths: gitStatus.code === 0 ? changedPaths(gitStatus.stdout) : [],
      versions: skillVersionReport(localVersions, publishedResult),
      health,
    },
    cli_updates: cliUpdates,
    models,
    runtime: {
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      node: process.versions.node,
      node_supported: Number.parseInt(process.versions.node.split(".")[0], 10) >= 18,
      node_recommended: Number.parseInt(process.versions.node.split(".")[0], 10) >= 22,
      git: gitVersion.code === 0 ? safeDetail(gitVersion.stdout) : null,
      powershell: shellVersion.code === 0 ? safeDetail(shellVersion.stdout) : null,
    },
    environment: classifyEnvironmentNames(Object.keys(process.env)),
    privacy: { environment_values_inspected: false, environment_values_displayed: false, provider_api_key_variables_stripped: true, credential_contents_read: false, model_calls_made: false },
  };
  maintenanceCache.set(governor, { cachedAt: Date.now(), value });
  return value;
}

async function skillsCheckoutState() {
  const required = [path.join(skillsRoot, "momm", "SKILL.md"), path.join(skillsRoot, "versions.json")];
  if (!required.every((item) => fs.existsSync(item))) return { verified: false, reason: "standalone_or_unrecognized_layout", root: null };
  const rootResult = await runCommand("git", ["-C", skillsRoot, "rev-parse", "--show-toplevel"], { timeoutMs: 10_000 });
  if (rootResult.code !== 0) return { verified: false, reason: "not_a_git_checkout", root: null };
  let expected;
  let actual;
  try {
    expected = fs.realpathSync(skillsRoot);
    actual = fs.realpathSync(safeDetail(rootResult.stdout));
  } catch {
    return { verified: false, reason: "checkout_path_unresolved", root: null };
  }
  if (path.normalize(expected).toLowerCase() !== path.normalize(actual).toLowerCase()) {
    return { verified: false, reason: "adjacent_or_parent_repository", root: actual };
  }
  // Repository identity is established by the exact resolved checkout path.
  // Do not read or serialize `remote.origin.url`: Git permits credentials in
  // that value, and Setup Center has no need for it.
  return { verified: true, reason: null, root: actual };
}

function spawnVisible(command, args, { provider = null, acknowledgementMs = 650 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const child = spawn(command, args, {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: false,
      env: cleanOauthEnv(process.env, { provider }),
    });
    const accept = (state) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.unref();
      resolve({ accepted: true, state });
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    child.once("spawn", () => {
      timer = setTimeout(() => accept("running"), acknowledgementMs);
    });
    child.once("error", fail);
    child.once("close", (code, signal) => {
      if (code === 0) accept("exited_zero");
      else fail(new Error(`${command} rejected the terminal request (${signal || `exit ${code ?? "unknown"}`}).`));
    });
  });
}

async function visibleLaunchSelfTest() {
  const rejected = await spawnVisible(process.execPath, ["-e", "process.exit(23)"], { acknowledgementMs: 200 })
    .then(() => false, () => true);
  const zeroExit = await spawnVisible(process.execPath, ["-e", "process.exit(0)"], { acknowledgementMs: 200 })
    .then((result) => result.accepted === true, () => false);
  const running = await spawnVisible(process.execPath, ["-e", "setTimeout(() => {}, 300)"], { acknowledgementMs: 50 })
    .then((result) => result.accepted === true && result.state === "running", () => false);
  return rejected && zeroExit && running;
}

function terminalCommandIsSafe(command) {
  return typeof command === "string" && command.length > 0 && !/[\r\n]/.test(command);
}

async function launchTerminal(command, { provider = null } = {}) {
  if (!terminalCommandIsSafe(command)) throw new Error("Terminal actions must be one fixed command line.");
  if (process.platform === "win32") {
    return spawnVisible("powershell.exe", ["-NoExit", "-NoProfile", "-Command", command], { provider });
  } else if (process.platform === "darwin") {
    const escaped = command.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    return spawnVisible("osascript", ["-e", `tell application "Terminal" to do script "${escaped}"`], { provider });
  } else {
    const candidates = [
      ["x-terminal-emulator", ["-e", "bash", "-lc", `${command}; exec bash`]],
      ["gnome-terminal", ["--", "bash", "-lc", `${command}; exec bash`]],
      ["konsole", ["-e", "bash", "-lc", `${command}; exec bash`]],
      ["xterm", ["-e", "bash", "-lc", `${command}; exec bash`]],
    ];
    let lastError = null;
    for (const [terminal, args] of candidates) {
      try { return await spawnVisible(terminal, args, { provider }); }
      catch (error) { lastError = error; }
    }
    throw lastError || new Error("No supported terminal application was found");
  }
}

function openBrowser(url) {
  const invocation = process.platform === "win32"
    ? ["cmd.exe", ["/d", "/s", "/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  const child = spawn(invocation[0], invocation[1], { detached: true, stdio: "ignore", shell: false, windowsHide: true, env: cleanOauthEnv() });
  child.on("error", () => {});
  child.unref();
}

function safeDetail(value) {
  return String(value || "").replaceAll(/\u001b\[[0-9;]*m/g, "").trim().slice(0, 600);
}

function jobKey(provider, governor) {
  return `${governor}:${provider}`;
}

function routeAuthFingerprint(route) {
  return `${route?.installed !== false}:${route?.auth || "unknown"}:${route?.note || ""}`;
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function beginControllerOperation(expectedRevision) {
  if (serverClosing) throw httpError(409, "Setup Center is closing.");
  if (!confirmedGovernor) throw httpError(409, "Choose the agent currently in control first.");
  const expected = Number(expectedRevision);
  if (!Number.isInteger(expected) || expected !== controllerRevision) {
    throw httpError(409, "The active controller changed in another tab. Refresh Setup Center before continuing.");
  }
  const context = { governor: confirmedGovernor, revision: controllerRevision, released: false };
  controllerOperations += 1;
  context.release = () => {
    if (context.released) return;
    context.released = true;
    controllerOperations = Math.max(0, controllerOperations - 1);
  };
  return context;
}

function assertControllerOperation(context) {
  if (context.governor !== confirmedGovernor || context.revision !== controllerRevision) {
    throw httpError(409, "The active controller changed while this check was running. Its result was discarded.");
  }
}

function pruneJobs() {
  const cutoff = Date.now() - jobTtlMs;
  for (const [id, job] of jobs) {
    if (job.status !== "running" && Date.parse(job.completed_at || job.started_at) < cutoff) jobs.delete(id);
  }
  for (const [key, job] of latestJobs) {
    if (!jobs.has(job.id)) latestJobs.delete(key);
  }
  if (jobs.size <= maxJobs) return;
  const removable = [...jobs.values()].filter((job) => job.status !== "running").sort((a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at));
  while (jobs.size > maxJobs && removable.length) jobs.delete(removable.shift().id);
}

function activeConnectivityJob() {
  return [...jobs.values()].find((job) => job.status === "running") || null;
}

async function cancelConnectivityJobs() {
  const running = [...jobs.values()].filter((job) => job.status === "running");
  for (const job of running) job.abort_controller?.abort();
  await Promise.allSettled(running.map((job) => job.run_promise).filter(Boolean));
  return running.length;
}

async function cancelBackgroundWork() {
  const fetchControllers = [...backgroundFetchControllers];
  for (const controller of fetchControllers) controller.abort();
  const children = [...backgroundChildren];
  await Promise.allSettled(children.map((child) => terminateProcessTree(child)));
  const deadline = Date.now() + 2_000;
  while ((backgroundChildren.size > 0 || backgroundFetchControllers.size > 0 || controllerOperations > 0) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return {
    cancelled_processes: children.length,
    cancelled_fetches: fetchControllers.length,
    cleanup_complete: backgroundChildren.size === 0 && backgroundFetchControllers.size === 0 && controllerOperations === 0,
  };
}

function publicJob(job) {
  if (!job) return null;
  const {
    probe_directory: _probeDirectory,
    abort_controller: _abortController,
    run_promise: _runPromise,
    child_process: _childProcess,
    ...safe
  } = job;
  return safe;
}

async function statusReport(governor) {
  pruneJobs();
  const report = await readiness(governor);
  const routeMap = new Map((report.routes || []).map((route) => [route.agent, route]));
  const verifications = [];
  for (const [key, job] of latestJobs) {
    if (!key.startsWith(`${governor}:`)) continue;
    const route = routeMap.get(job.provider);
    if (!route) continue;
    if (job.status === "success" && Date.parse(job.expires_at || 0) <= Date.now()) {
      job.status = "expired";
      job.completed_at = new Date().toISOString();
      job.result = { route_status: "expired", detail: "The connection verification expired and must be run again.", evidence_persisted: false };
      latestJobs.delete(key);
      continue;
    }
    if (job.status === "success" && (!route.ready || routeAuthFingerprint(route) !== job.auth_fingerprint)) {
      job.status = "invalidated";
      job.completed_at = new Date().toISOString();
      job.expires_at = new Date(Date.now() + jobTtlMs).toISOString();
      job.result = { route_status: "authentication_required", detail: "The underlying local account evidence changed. Sign in and verify again.", evidence_persisted: false };
      verifications.push(publicJob(job));
    } else verifications.push(publicJob(job));
  }
  return { ...report, checked_at: new Date().toISOString(), verifications };
}

function startConnectivityJob(provider, governor, route, revision = controllerRevision) {
  pruneJobs();
  const existing = latestJobs.get(jobKey(provider, governor));
  if (existing?.status === "running") return existing;
  const active = activeConnectivityJob();
  if (active) return null;
  const id = crypto.randomUUID();
  const probeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "momm-setup-probe-"));
  const setupProbeAuthorization = issueSetupProbeAuthorization({ governor, reviewer: provider });
  const abortController = new AbortController();
  const job = {
    id,
    provider,
    governor,
    controller_revision: revision,
    status: "running",
    started_at: new Date().toISOString(),
    auth_evidence: route?.auth || "unknown",
    auth_fingerprint: routeAuthFingerprint(route),
    probe_isolated: true,
    probe_directory: probeDirectory,
    abort_controller: abortController,
  };
  jobs.set(id, job);
  latestJobs.set(jobKey(provider, governor), job);
  const runPromise = runNode(dispatcherScript, [
    "--governor", governor,
    "--reviewers", provider,
    "--timeout", "60",
    "--min-success", "1",
    "--label", SETUP_PROBE_LABEL,
    "--setup-probe",
  ], {
    input: SETUP_PROBE_INPUT,
    timeoutMs: 210_000,
    cwd: probeDirectory,
    signal: abortController.signal,
    provider,
    setupProbeAuthorization,
    onChild: (child) => { job.child_process = child; },
  }).then((result) => {
    if (result.cancelled) {
      job.status = "cancelled";
      job.completed_at = new Date().toISOString();
      job.expires_at = new Date(Date.now() + jobTtlMs).toISOString();
      job.result = { route_status: "cancelled", detail: "Connection verification was cancelled before Setup Center closed.", evidence_persisted: false };
      return;
    }
    let report = null;
    try { report = JSON.parse(result.stdout); } catch {}
    const reviewer = report?.reviewers?.find((item) => item.agent === provider);
    const contractPassed = report?.setup_probe === true
      && report?.setup_probe_authorized === true
      && report?.input_sha256 === crypto.createHash("sha256").update(SETUP_PROBE_INPUT).digest("hex")
      && report?.evidence?.persisted === false
      && report?.evidence?.skipped === "isolated_setup_probe";
    job.status = reviewer?.status === "success" && contractPassed ? "success" : "failed";
    job.completed_at = new Date().toISOString();
    job.expires_at = new Date(Date.now() + (job.status === "success" ? verificationTtlMs : jobTtlMs)).toISOString();
    const rawDetail = reviewer?.detail || result.stderr || "The reviewer did not return a readable report.";
    job.result = {
      route_status: reviewer?.status || (result.timedOut ? "timeout" : "error"),
      verdict: reviewer?.verdict || null,
      duration_ms: reviewer?.duration_ms || null,
      detail: sanitizeProviderDiagnostic(String(rawDetail).replaceAll(probeDirectory, "<isolated-setup-probe>"), { maxLength: 600 }),
      evidence_persisted: report?.evidence?.persisted === true,
    };
  }).catch((error) => {
    job.status = "failed";
    job.completed_at = new Date().toISOString();
    job.expires_at = new Date(Date.now() + jobTtlMs).toISOString();
    job.result = { route_status: "error", detail: sanitizeProviderDiagnostic(String(error.message).replaceAll(probeDirectory, "<isolated-setup-probe>"), { maxLength: 600 }), evidence_persisted: false };
  }).finally(() => {
    try { fs.rmSync(probeDirectory, { recursive: true, force: true }); } catch {}
    delete job.probe_directory;
    delete job.child_process;
    delete job.abort_controller;
  });
  job.run_promise = runPromise;
  return job;
}

function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function securityHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function sendJson(response, status, value) {
  response.writeHead(status, securityHeaders());
  response.end(`${JSON.stringify(value)}\n`);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 4096) reject(new Error("Request body too large"));
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Request body must be JSON")); }
    });
    request.on("error", reject);
  });
}

function authorized(request) {
  return request.headers["x-momm-token"] === sessionToken;
}

function trustedHost(host, port) {
  const value = String(host || "").toLowerCase();
  return value === `127.0.0.1:${port}` || value === `localhost:${port}`;
}

function trustedMutationRequest(request, port) {
  const host = String(request.headers.host || "").toLowerCase();
  const origin = String(request.headers.origin || "");
  const fetchSite = String(request.headers["sec-fetch-site"] || "").toLowerCase();
  if (origin && origin !== `http://${host}`) return false;
  if (fetchSite && fetchSite !== "same-origin") return false;
  return trustedHost(host, port);
}

function serveAsset(response, file, contentType) {
  try {
    const bytes = fs.readFileSync(path.join(assetDir, file));
    response.writeHead(200, securityHeaders(contentType));
    response.end(bytes);
  } catch {
    sendJson(response, 404, { error: "Asset not found" });
  }
}

function createServer() {
  return http.createServer(async (request, response) => {
    if (!isLoopback(request.socket.remoteAddress)) return sendJson(response, 403, { error: "Loopback access only" });
    const address = activeServer?.address();
    const boundPort = typeof address === "object" && address ? address.port : null;
    if (!boundPort || !trustedHost(request.headers.host, boundPort)) return sendJson(response, 403, { error: "Untrusted local host" });
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && requestUrl.pathname === "/") return serveAsset(response, "index.html", "text/html; charset=utf-8");
      if (request.method === "GET" && requestUrl.pathname === "/styles.css") return serveAsset(response, "styles.css", "text/css; charset=utf-8");
      if (request.method === "GET" && requestUrl.pathname === "/app.js") return serveAsset(response, "app.js", "text/javascript; charset=utf-8");
      if (request.method === "GET" && requestUrl.pathname === "/api/session") {
        return sendJson(response, 200, {
          token: sessionToken,
          api_schema: setupApiSchema,
          backend_version: setupUiVersion,
          platform: platformKey(),
          current_governor: confirmedGovernor,
          controller_revision: controllerRevision,
          governors: [...governors],
          providers,
        });
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/status") {
        if (!trustedMutationRequest(request, boundPort) || !authorized(request)) {
          return sendJson(response, 403, { error: "Invalid or cross-site local session" });
        }
        const context = beginControllerOperation(requestUrl.searchParams.get("controller_revision"));
        try {
          const value = await statusReport(context.governor);
          assertControllerOperation(context);
          return sendJson(response, 200, { ...value, governor: context.governor, controller_revision: context.revision });
        } finally { context.release(); }
      }
      if (request.method === "GET" && requestUrl.pathname.startsWith("/api/job/")) {
        if (!trustedMutationRequest(request, boundPort) || !authorized(request)) {
          return sendJson(response, 403, { error: "Invalid or cross-site local session" });
        }
        const job = jobs.get(requestUrl.pathname.slice("/api/job/".length));
        const expectedRevision = Number(requestUrl.searchParams.get("controller_revision"));
        if (!Number.isInteger(expectedRevision) || expectedRevision !== controllerRevision || job?.controller_revision !== expectedRevision) {
          return sendJson(response, 409, { error: "The active controller changed; this verification result is no longer current." });
        }
        return job ? sendJson(response, 200, publicJob(job)) : sendJson(response, 404, { error: "Job not found" });
      }
      if (request.method === "POST") {
        if (!trustedMutationRequest(request, boundPort)) return sendJson(response, 403, { error: "Cross-site local action blocked" });
        if (!authorized(request)) return sendJson(response, 403, { error: "Invalid local session" });
        if (serverClosing && requestUrl.pathname !== "/api/shutdown") return sendJson(response, 409, { error: "Setup Center is closing." });
        const body = await readBody(request);
        if (requestUrl.pathname === "/api/controller") {
          const governor = String(body.governor || "").toLowerCase();
          if (!governors.has(governor)) return sendJson(response, 400, { error: "Unsupported controller" });
          const expectedRevision = Number(body.controller_revision);
          if (!Number.isInteger(expectedRevision) || expectedRevision !== controllerRevision) {
            return sendJson(response, 409, { error: "The active controller changed in another tab. Refresh Setup Center before choosing again." });
          }
          if (controllerOperations > 0 || activeConnectivityJob()) return sendJson(response, 409, { error: "Wait for active controller checks to finish before changing controller." });
          confirmedGovernor = governor;
          controllerRevision += 1;
          maintenanceCache.clear();
          return sendJson(response, 200, { current_governor: confirmedGovernor, controller_revision: controllerRevision });
        }
        if (requestUrl.pathname === "/api/action") {
          const context = beginControllerOperation(body.controller_revision);
          try {
          const provider = String(body.provider || "").toLowerCase();
          const action = String(body.action || "").toLowerCase();
          const command = actionCommand(provider, action);
          if (!command) return sendJson(response, 400, { error: "Unsupported provider action" });
          if (provider === "skills") {
            const checkout = await skillsCheckoutState();
            if (!checkout.verified) return sendJson(response, 409, { error: "Git actions are unavailable because this is not a verified skills checkout." });
          }
          if (provider === "skills" && action === "update") {
            const status = await runCommand("git", ["-C", skillsRoot, "status", "--porcelain"], { timeoutMs: 10_000 });
            if (status.code !== 0) return sendJson(response, 409, { error: "Git could not verify that the skills checkout is safe to update." });
            if (status.stdout.trim()) return sendJson(response, 409, { error: "Local skill changes are present. Handle them before updating." });
          }
          const terminalProvider = provider === "claude" && ["login", "models"].includes(action) ? "claude" : null;
          let terminalResult;
          try { terminalResult = await launchTerminal(command, { provider: terminalProvider }); }
          catch (error) {
            return sendJson(response, 500, { error: `A terminal could not be opened: ${safeDetail(error.message)}`, command });
          }
          assertControllerOperation(context);
          if (providers[provider] && ["login", "install"].includes(action)) latestJobs.delete(jobKey(provider, context.governor));
          maintenanceCache.clear();
          return sendJson(response, 202, { launched: true, accepted: terminalResult?.accepted === true, command, note: actionNote(provider, action), governor: context.governor, controller_revision: context.revision });
          } finally { context.release(); }
        }
        if (requestUrl.pathname === "/api/maintenance") {
          const context = beginControllerOperation(body.controller_revision);
          try {
            const value = await maintenanceReport(context.governor, body.force === true);
            assertControllerOperation(context);
            return sendJson(response, 200, { ...value, governor: context.governor, controller_revision: context.revision });
          } finally { context.release(); }
        }
        if (requestUrl.pathname === "/api/test") {
          const provider = String(body.provider || "").toLowerCase();
          const context = beginControllerOperation(body.controller_revision);
          try {
          if (!providers[provider] || provider === context.governor) {
            return sendJson(response, 400, { error: "Unsupported reviewer/governor pairing" });
          }
          const preflight = await readiness(context.governor);
          assertControllerOperation(context);
          const route = (preflight.routes || []).find((item) => item.agent === provider);
          if (!route || route.installed === false) return sendJson(response, 409, { error: "Install this reviewer CLI before verification." });
          if (route.route_status === "command_error") {
            return sendJson(response, 409, { error: "This reviewer CLI was found but could not run. Repair or reinstall the CLI, then check again." });
          }
          if (!route.ready) return sendJson(response, 409, { error: "Sign in to this provider before verification." });
          const job = startConnectivityJob(provider, context.governor, route, context.revision);
          if (!job) return sendJson(response, 409, { error: "Another connection is being verified. Wait for it to finish." });
          return sendJson(response, 202, { ...publicJob(job), controller_revision: context.revision });
          } finally { context.release(); }
        }
        if (requestUrl.pathname === "/api/shutdown") {
          serverClosing = true;
          const cancelledJobs = await cancelConnectivityJobs();
          const cleanup = await cancelBackgroundWork();
          if (!cleanup.cleanup_complete) {
            return sendJson(response, 503, { closing: false, cancelled_jobs: cancelledJobs, ...cleanup, error: "Background checks have not finished shutting down. Try Close again." });
          }
          sendJson(response, 200, { closing: true, cancelled_jobs: cancelledJobs, ...cleanup });
          setTimeout(() => activeServer?.close(() => { process.exitCode = 0; }), 75);
          return;
        }
      }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(response, Number.isInteger(error.statusCode) ? error.statusCode : 500, { error: safeDetail(error.message) || "Unexpected local error" });
    }
  });
}

function localHttpRequest(port, { method = "GET", pathName = "/", host = `127.0.0.1:${port}`, origin = "", fetchSite = "", token = "", body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Host: host };
    if (origin) headers.Origin = origin;
    if (fetchSite) headers["Sec-Fetch-Site"] = fetchSite;
    if (token) headers["X-MOMM-Token"] = token;
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const request = http.request({ hostname: "127.0.0.1", port, path: pathName, method, headers }, (response) => {
      let payload = "";
      response.on("data", (chunk) => { payload += chunk.toString("utf8"); });
      response.on("end", () => resolve({ status: response.statusCode, body: payload }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function probeIsolationSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "momm-setup-isolation-test-"));
  const probe = path.join(root, "probe");
  const fakeBin = path.join(root, "bin");
  const capturePath = path.join(root, "capture.json");
  fs.mkdirSync(probe);
  fs.mkdirSync(fakeBin);
  const sentinel = `PROJECT_RULE_SENTINEL_${crypto.randomBytes(8).toString("hex")}`;
  fs.writeFileSync(path.join(probe, ".reviewrules"), sentinel);
  const fakeProvider = path.join(fakeBin, "fake-provider.cjs");
  fs.writeFileSync(fakeProvider, `
const fs = require("node:fs");
(async () => {
  const args = process.argv.slice(2);
  let input = "";
  for await (const chunk of process.stdin) input += chunk.toString("utf8");
  if (args[0] === "--version") process.stdout.write("codex 0.0.0-test\\n");
  else if (args[0] === "login" && args[1] === "status") process.stdout.write("Logged in for isolated test\\n");
  else {
    const forbidden = Object.entries(process.env).filter(([name, value]) => /CANARY|API_KEY|SECRET_KEY|BASE_URL|ENDPOINT|GH_TOKEN|GITHUB_TOKEN|AWS_PROFILE|BEDROCK|VERTEX/i.test(name) || /MUST_NOT_ESCAPE/.test(value)).map(([name]) => name);
    fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ args, input, forbidden, cwd: process.cwd() }));
    process.stdout.write(JSON.stringify({ verdict: "ACCEPT", confidence: 1, findings: [], summary: "isolated setup probe ok", suggested_improvements: [] }));
  }
})().catch((error) => { process.stderr.write(String(error && error.stack || error)); process.exitCode = 1; });
`, { mode: 0o700 });
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(fakeBin, "codex.cmd"), `@"${process.execPath}" "${fakeProvider}" %*\r\n`);
  } else {
    const wrapper = path.join(fakeBin, "codex");
    fs.writeFileSync(wrapper, `#!/usr/bin/env node\nrequire(${JSON.stringify(fakeProvider)});\n`, { mode: 0o700 });
    fs.chmodSync(wrapper, 0o700);
  }
  const envSource = { ...process.env };
  for (const key of Object.keys(envSource)) if (key.toLowerCase() === "path") delete envSource[key];
  envSource.PATH = `${fakeBin}${path.delimiter}${process.env.PATH || process.env.Path || ""}`;
  envSource.XAI_API_KEY = "API_KEY_CANARY_MUST_NOT_ESCAPE";
  envSource.AWS_SECRET_ACCESS_KEY = "SECRET_KEY_CANARY_MUST_NOT_ESCAPE";
  envSource.OPENAI_BASE_URL = "https://ENDPOINT_CANARY_MUST_NOT_ESCAPE.invalid";
  envSource.GH_TOKEN = "GH_TOKEN_CANARY_MUST_NOT_ESCAPE";
  envSource.GITHUB_TOKEN = "GITHUB_TOKEN_CANARY_MUST_NOT_ESCAPE";
  envSource.CLAUDE_CODE_USE_BEDROCK = "BEDROCK_CANARY_MUST_NOT_ESCAPE";
  envSource.GOOGLE_GENAI_USE_VERTEXAI = "VERTEX_CANARY_MUST_NOT_ESCAPE";
  envSource.AWS_PROFILE = "PROFILE_CANARY_MUST_NOT_ESCAPE";
  try {
    const authorization = issueSetupProbeAuthorization({ governor: "other", reviewer: "codex" });
    const result = await runNode(dispatcherScript, [
      "--governor", "other",
      "--reviewers", "codex",
      "--timeout", "5",
      "--min-success", "1",
      "--label", SETUP_PROBE_LABEL,
      "--setup-probe",
    ], { input: SETUP_PROBE_INPUT, cwd: probe, timeoutMs: 30_000, envSource, provider: "codex", setupProbeAuthorization: authorization });
    let report = null;
    try { report = JSON.parse(result.stdout); } catch {}
    let capture = null;
    try { capture = JSON.parse(fs.readFileSync(capturePath, "utf8")); } catch {}
    const forged = await runNode(dispatcherScript, [
      "--governor", "other", "--reviewers", "codex", "--timeout", "5", "--min-success", "1",
      "--label", SETUP_PROBE_LABEL, "--setup-probe",
    ], { input: SETUP_PROBE_INPUT, cwd: probe, timeoutMs: 30_000, envSource });
    const replay = await runNode(dispatcherScript, [
      "--governor", "other", "--reviewers", "codex", "--timeout", "5", "--min-success", "1",
      "--label", SETUP_PROBE_LABEL, "--setup-probe",
    ], { input: SETUP_PROBE_INPUT, cwd: probe, timeoutMs: 30_000, envSource, provider: "codex", setupProbeAuthorization: authorization });
    const arbitraryInput = "Arbitrary caller-controlled setup probe input.";
    const arbitraryAuthorization = issueSetupProbeAuthorization({ governor: "other", reviewer: "codex" });
    const arbitrary = await runNode(dispatcherScript, [
      "--governor", "other", "--reviewers", "codex", "--timeout", "5", "--min-success", "1",
      "--label", SETUP_PROBE_LABEL, "--setup-probe",
    ], { input: arbitraryInput, cwd: probe, timeoutMs: 30_000, envSource, provider: "codex", setupProbeAuthorization: arbitraryAuthorization });
    const files = fs.readdirSync(probe).sort();
    let canonicalCwdMatches = false;
    try { canonicalCwdMatches = fs.realpathSync(capture?.cwd || "") === fs.realpathSync(probe); } catch {}
    const checks = {
      dispatcher_completed: result.code === 0,
      report_is_authorized_probe: report?.setup_probe === true && report?.setup_probe_authorized === true,
      report_declares_isolation: report?.project_rules_applied === false
        && report?.evidence?.persisted === false
        && report?.evidence?.skipped === "isolated_setup_probe",
      reviewer_succeeded: report?.reviewers?.[0]?.status === "success",
      project_rule_not_returned: !result.stdout.includes(sentinel),
      fixed_input_only: capture?.input?.includes(SETUP_PROBE_INPUT)
        && !capture?.input?.includes(sentinel)
        && !capture?.input?.includes("PROJECT_RULE_SENTINEL"),
      canonical_probe_directory: canonicalCwdMatches,
      forbidden_environment_absent: Array.isArray(capture?.forbidden)
        && capture.forbidden.length === 0
        && !JSON.stringify(capture).includes("CANARY_MUST_NOT_ESCAPE"),
      direct_probe_rejected: forged.code !== 0 && /one-use Setup Center IPC authorization|active Setup Center capability/.test(forged.stderr),
      replay_probe_rejected: replay.code !== 0 && /one-use Setup Center IPC authorization|active Setup Center capability/.test(replay.stderr),
      arbitrary_payload_rejected: arbitrary.code !== 0 && /exact synthetic validation payload/.test(arbitrary.stderr),
      no_probe_artifacts: files.length === 1 && files[0] === ".reviewrules",
    };
    return { passed: Object.values(checks).every(Boolean), checks };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function authorityIntegrationSelfTest() {
  const previousServer = activeServer;
  const previousGovernor = confirmedGovernor;
  const previousRevision = controllerRevision;
  const previousOperations = controllerOperations;
  const previousClosing = serverClosing;
  confirmedGovernor = null;
  controllerRevision = 0;
  controllerOperations = 0;
  serverClosing = false;
  const server = createServer();
  activeServer = server;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  try {
    const goodHost = `127.0.0.1:${port}`;
    const goodOrigin = `http://${goodHost}`;
    const good = await localHttpRequest(port, { host: goodHost, pathName: "/api/session" });
    const forgedHosts = await Promise.all([
      `attacker.example:${port}`,
      `127.0.0.1.evil.example:${port}`,
      `[::1].evil.example:${port}`,
      `127.0.0.1:${port}@evil.example`,
    ].map((host) => localHttpRequest(port, { host, pathName: "/api/session" })));
    const forgedOrigin = await localHttpRequest(port, { method: "POST", pathName: "/api/controller", host: goodHost, origin: "https://attacker.example", fetchSite: "cross-site", token: sessionToken, body: '{"governor":"codex"}' });
    const sameOrigin = await localHttpRequest(port, { method: "POST", pathName: "/api/controller", host: goodHost, origin: goodOrigin, fetchSite: "same-origin", token: sessionToken, body: '{"governor":"codex","controller_revision":0}' });
    const forgedStatus = await localHttpRequest(port, { pathName: "/api/status?controller_revision=1", host: goodHost, origin: "https://attacker.example", fetchSite: "cross-site" });
    const tokenlessStatus = await localHttpRequest(port, { pathName: "/api/status?controller_revision=1", host: goodHost, origin: goodOrigin, fetchSite: "same-origin" });
    const wrongTokenStatus = await localHttpRequest(port, { pathName: "/api/status?controller_revision=1", host: goodHost, origin: goodOrigin, fetchSite: "same-origin", token: "wrong-local-token" });
    const staleController = await localHttpRequest(port, { method: "POST", pathName: "/api/controller", host: goodHost, origin: goodOrigin, fetchSite: "same-origin", token: sessionToken, body: '{"governor":"grok","controller_revision":0}' });
    let samePayload = null;
    try { samePayload = JSON.parse(sameOrigin.body); } catch {}
    return good.status === 200
      && forgedHosts.every((response) => response.status === 403
        && !response.body.includes(sessionToken)
        && !/"token"\s*:/.test(response.body))
      && forgedOrigin.status === 403
      && sameOrigin.status === 200
      && forgedStatus.status === 403
      && tokenlessStatus.status === 403
      && wrongTokenStatus.status === 403
      && samePayload?.controller_revision === 1
      && staleController.status === 409
      && confirmedGovernor === "codex";
  } finally {
    await new Promise((resolve) => server.close(resolve));
    activeServer = previousServer;
    confirmedGovernor = previousGovernor;
    controllerRevision = previousRevision;
    controllerOperations = previousOperations;
    serverClosing = previousClosing;
  }
}

async function backgroundCleanupSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "momm-setup-tree-"));
  const pidFile = path.join(root, "grandchild.pid");
  const parentFile = path.join(root, "parent.cjs");
  fs.writeFileSync(parentFile, `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
setInterval(() => {}, 1000);
`);
  controllerOperations += 1;
  const work = runCommand(process.execPath, [parentFile], { timeoutMs: 30_000 })
    .finally(() => { controllerOperations = Math.max(0, controllerOperations - 1); });
  try {
    for (let attempt = 0; attempt < 50 && !fs.existsSync(pidFile); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const pid = Number.parseInt(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8") : "", 10);
    const cleanup = await cancelBackgroundWork();
    await work;
    let grandchildGone = false;
    for (let attempt = 0; attempt < 50 && Number.isInteger(pid); attempt += 1) {
      try { process.kill(pid, 0); }
      catch (error) { if (error?.code === "ESRCH") { grandchildGone = true; break; } }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return cleanup.cleanup_complete && cleanup.cancelled_processes >= 1 && grandchildGone && controllerOperations === 0;
  } finally {
    await work.catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function selfTest() {
  const sampleEnvironment = classifyEnvironmentNames(["SAFE_NAME", "XAI_API_KEY", "HTTP_PROXY", "NO_UPDATE_CHECK", "COPILOT_MODEL", "OPENAI_BASE_URL"]);
  const cleanedEnvironment = cleanOauthEnv({
    PATH: "fixture",
    XAI_API_KEY: "forbidden",
    AWS_SECRET_ACCESS_KEY: "forbidden",
    GH_TOKEN: "forbidden",
    GITHUB_TOKEN: "forbidden",
    CLAUDE_CODE_USE_BEDROCK: "1",
    GOOGLE_GENAI_USE_VERTEXAI: "1",
    AWS_PROFILE: "production",
    UNREVIEWED_AMBIENT_VALUE: "forbidden",
    OPENAI_BASE_URL: "https://forbidden.example",
    CLAUDE_CODE_OAUTH_TOKEN: "allowed-oauth-session",
  });
  const scopedProviderEnvironments = Object.fromEntries(PROVIDER_IDS.map((provider) => [provider, cleanOauthEnv({
    PATH: "fixture",
    CLAUDE_CODE_OAUTH_TOKEN: "provider-scoped-oauth",
  }, { provider })]));
  const [probeIsolation, authorityIntegration, terminalLaunchSemantics] = await Promise.all([
    probeIsolationSelfTest(),
    authorityIntegrationSelfTest(),
    visibleLaunchSelfTest(),
  ]);
  const backgroundCleanup = await backgroundCleanupSelfTest();
  const terminalCommandMatrix = ["win32", "darwin", "linux"].flatMap((platform) => [
    ...Object.entries(providers).flatMap(([name, record]) => ["login", "install", "models", ...(record.update ? ["update"] : [])]
      .map((action) => actionCommand(name, action, platform))),
    ...["update", "diff", "commit"].map((action) => actionCommand("skills", action, platform)),
    ...["install", "login"].map((action) => actionCommand("github-cli", action, platform)),
  ]);
  const tests = {
    provider_allowlist: Object.keys(providers).join(",") === "codex,claude,antigravity,copilot,grok,gemini",
    every_controller_supported: ["codex", "gemini", "claude", "antigravity", "copilot", "grok", "other"].every((name) => governors.has(name)),
    all_reviewers_preflighted: setupReviewers === "codex,claude,antigravity,copilot,grok,gemini",
    unknown_provider_rejected: actionCommand("unknown", "login") === null,
    unknown_action_rejected: actionCommand("claude", "delete") === null,
    commands_are_fixed: Object.entries(providers).every(([name, record]) => ["login", "install", "models"].every((action) => actionCommand(name, action)) && (!record.update || actionCommand(name, "update"))),
    terminal_commands_single_line: terminalCommandMatrix.every(terminalCommandIsSafe)
      && !terminalCommandIsSafe("git status\nsecond command"),
    terminal_launch_acknowledges_nonzero_exit: terminalLaunchSemantics,
    shutdown_awaits_background_process_tree: backgroundCleanup,
    official_route_fixes: actionCommand("antigravity", "login") === "agy"
      && actionCommand("claude", "login") === "claude auth login"
      && providers.copilot.modelsNote.includes("/model") && !providers.copilot.modelsNote.includes("/models"),
    skill_actions_are_fixed: actionCommand("skills", "update")?.includes("pull --ff-only") === true
      && actionCommand("skills", "diff")?.includes("git diff") === true
      && actionCommand("skills", "commit")?.includes("git status") === true,
    loopback_only: isLoopback("127.0.0.1") && isLoopback("::1") && !isLoopback("192.168.1.5"),
    host_allowlist: trustedHost("127.0.0.1:8767", 8767) && trustedHost("localhost:8767", 8767) && !trustedHost("attacker.example:8767", 8767),
    host_origin_http_enforced: authorityIntegration,
    clickjacking_blocked: securityHeaders()["X-Frame-Options"] === "DENY",
    api_keys_not_mentioned: !JSON.stringify(providers).match(/api[_ -]?key/i),
    environment_values_never_classified: sampleEnvironment.api_key_names_present[0] === "XAI_API_KEY" && !("values" in sampleEnvironment),
    relevant_environment_categories: sampleEnvironment.proxy_names_present[0] === "HTTP_PROXY"
      && sampleEnvironment.update_controls_present[0] === "NO_UPDATE_CHECK"
      && sampleEnvironment.model_overrides_present[0] === "COPILOT_MODEL"
      && sampleEnvironment.endpoint_overrides_present[0] === "OPENAI_BASE_URL",
    provider_environment_scrubbed: cleanedEnvironment.XAI_API_KEY === undefined
      && cleanedEnvironment.AWS_SECRET_ACCESS_KEY === undefined
      && cleanedEnvironment.GH_TOKEN === undefined
      && cleanedEnvironment.GITHUB_TOKEN === undefined
      && cleanedEnvironment.CLAUDE_CODE_USE_BEDROCK === undefined
      && cleanedEnvironment.GOOGLE_GENAI_USE_VERTEXAI === undefined
      && cleanedEnvironment.AWS_PROFILE === undefined
      && cleanedEnvironment.UNREVIEWED_AMBIENT_VALUE === undefined
      && cleanedEnvironment.OPENAI_BASE_URL === undefined
      && cleanedEnvironment.CLAUDE_CODE_OAUTH_TOKEN === undefined
      && scopedProviderEnvironments.claude.CLAUDE_CODE_OAUTH_TOKEN === "provider-scoped-oauth"
      && PROVIDER_IDS.filter((provider) => provider !== "claude").every((provider) => scopedProviderEnvironments[provider].CLAUDE_CODE_OAUTH_TOKEN === undefined),
    provider_diagnostics_redacted: (() => {
      const detail = sanitizeProviderDiagnostic("Sign in at https://accounts.example.test/oauth?code=secret with device code ABCD-EFGH for person@example.test from C:\\Users\\private-name\\.config");
      return detail.includes("[provider URL hidden")
        && detail.includes("[hidden]")
        && detail.includes("[account identifier hidden]")
        && detail.includes("<user-home>")
        && !detail.includes("secret")
        && !detail.includes("ABCD-EFGH")
        && !detail.includes("person@example.test")
        && !detail.includes("private-name");
    })(),
    repository_remote_never_collected: !skillsCheckoutState.toString().includes("get-url"),
    credential_bearing_url_fixture_redacted: (() => {
      const detail = sanitizeProviderDiagnostic("https://user:embedded-token@example.test/repo.git?access_token=secret");
      return !detail.includes("user") && !detail.includes("embedded-token") && !detail.includes("access_token") && !detail.includes("secret");
    })(),
    antigravity_two_column_models_parse: extractModelNames("gemini-3-pro    Flagship model\ngemini-3-flash\tFast model").join(",") === "gemini-3-pro,gemini-3-flash",
    isolated_probe_ignores_rules_and_writes_nothing: probeIsolation.passed,
    version_comparison: compareVersions("1.10.1", "1.9.0") === 1 && compareVersions("1.8.0", "1.8.0") === 0 && compareVersions("1.7.9", "1.8.0") === -1,
    controller_startup_parses: parseArgs(["--governor", "gemini", "--no-browser"]).governor === "gemini",
    api_schema_versioned: setupApiSchema === "momm-setup/3" && setupUiVersion === "1.10.1",
    myskills_health_runner_present: fs.existsSync(myskillsScript),
    assets_present: ["index.html", "styles.css", "app.js"].every((file) => fs.existsSync(path.join(assetDir, file))),
  };
  const passed = Object.values(tests).every(Boolean);
  const diagnostics = probeIsolation.passed ? undefined : { probe_isolation: probeIsolation.checks };
  process.stdout.write(`${JSON.stringify({ passed, tests, ...(diagnostics ? { diagnostics } : {}) }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
}

let options;
try { options = parseArgs(process.argv.slice(2)); }
catch (error) { process.stderr.write(`${error.message}\n${usage()}\n`); process.exit(1); }
if (options.help) { process.stdout.write(`${usage()}\n`); process.exit(0); }
if (options.selfTest) { await selfTest(); }
else {
  confirmedGovernor = options.governor || null;
  controllerRevision = confirmedGovernor ? 1 : 0;
  activeServer = createServer();
  activeServer.listen(options.port, "127.0.0.1", () => {
    const address = activeServer.address();
    const url = `http://127.0.0.1:${address.port}/`;
    process.stdout.write(`MOMM Setup Center: ${url}\n`);
    process.stdout.write("Local-only. No source code or credential contents are read during setup.\n");
    if (options.browser) openBrowser(url);
  });
}
