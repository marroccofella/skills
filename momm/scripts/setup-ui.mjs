#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.join(scriptDir, "..", "assets", "setup-ui");
const skillsRoot = path.resolve(scriptDir, "..", "..");
const onboardScript = path.join(scriptDir, "onboard.mjs");
const dispatcherScript = path.join(scriptDir, "multi-review.mjs");
const localVersionsFile = path.join(skillsRoot, "versions.json");
const publishedVersionsUrl = "https://raw.githubusercontent.com/marroccofella/skills/main/versions.json";
const governors = new Set(["codex", "gemini", "claude", "antigravity", "copilot", "grok", "other"]);
const sessionToken = crypto.randomBytes(24).toString("hex");
const jobs = new Map();
const maxJobs = 12;
let activeServer = null;
let maintenanceCache = null;

const providers = Object.freeze({
  claude: {
    label: "Claude Code",
    docs: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
    login: { win32: "claude", darwin: "claude", linux: "claude" },
    update: { win32: "claude update", darwin: "claude update", linux: "claude update" },
    models: { win32: "claude", darwin: "claude", linux: "claude" },
    install: {
      win32: "npm install -g @anthropic-ai/claude-code",
      darwin: "npm install -g @anthropic-ai/claude-code",
      linux: "npm install -g @anthropic-ai/claude-code",
    },
    loginNote: "When Claude opens, type /login and follow the browser flow.",
    modelsNote: "When Claude opens, type /model to view models available to this account.",
  },
  antigravity: {
    label: "Antigravity",
    docs: "https://antigravity.google/docs/cli/install/",
    login: { win32: "agy login", darwin: "agy login", linux: "agy login" },
    update: { win32: "agy update", darwin: "agy update", linux: "agy update" },
    models: { win32: "agy models", darwin: "agy models", linux: "agy models" },
    install: {
      win32: "irm https://antigravity.google/cli/install.ps1 | iex",
      darwin: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
      linux: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    },
    loginNote: "Complete Google sign-in in the browser window that opens.",
    modelsNote: "The terminal lists models available to the signed-in Google account.",
  },
  copilot: {
    label: "GitHub Copilot",
    docs: "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli",
    login: { win32: "copilot login", darwin: "copilot login", linux: "copilot login" },
    update: { win32: "copilot update", darwin: "copilot update", linux: "copilot update" },
    models: { win32: "copilot", darwin: "copilot", linux: "copilot" },
    install: {
      win32: "npm install -g @github/copilot",
      darwin: "npm install -g @github/copilot",
      linux: "npm install -g @github/copilot",
    },
    loginNote: "Use the one-time GitHub device code shown in the terminal.",
    modelsNote: "When Copilot opens, type /models to view models available to this account.",
  },
  grok: {
    label: "Grok",
    docs: "https://docs.x.ai/build/cli/reference",
    login: { win32: "grok login", darwin: "grok login", linux: "grok login" },
    update: { win32: "grok update", darwin: "grok update", linux: "grok update" },
    models: { win32: "grok models", darwin: "grok models", linux: "grok models" },
    install: {
      win32: "irm https://x.ai/cli/install.ps1 | iex",
      darwin: "curl -fsSL https://x.ai/cli/install.sh | bash",
      linux: "curl -fsSL https://x.ai/cli/install.sh | bash",
    },
    loginNote: "Complete xAI sign-in in the browser, or use device authentication if prompted.",
    modelsNote: "The terminal lists Grok models visible to this installation and account.",
  },
});

function parseArgs(argv) {
  const options = { port: 0, browser: true, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") {
      index += 1;
      options.port = Number.parseInt(argv[index] || "", 10);
    } else if (arg === "--no-browser") options.browser = false;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error("--port must be an integer from 0 to 65535");
  }
  return options;
}

function usage() {
  return `Usage: node scripts/setup-ui.mjs [--port <number>] [--no-browser]\n\nStarts MOMM Setup Center on 127.0.0.1. No source code or credential contents are read.`;
}

function platformKey() {
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
}

function actionCommand(provider, action) {
  if (provider === "skills" && ["update", "diff", "commit"].includes(action)) {
    const windows = platformKey() === "win32";
    const quoted = windows
      ? `'${skillsRoot.replaceAll("'", "''")}'`
      : `'${skillsRoot.replaceAll("'", `'\\''`)}'`;
    if (action === "update") return `git -C ${quoted} pull --ff-only`;
    if (action === "diff") return windows
      ? `Set-Location ${quoted}; git status --short; git diff --stat; git diff`
      : `cd ${quoted} && git status --short && git diff --stat && git diff`;
    return windows
      ? `Set-Location ${quoted}; git status; Write-Host ''; Write-Host 'Review the files above. Stage only what you intend with git add, then run git commit with your own message.'`
      : `cd ${quoted} && git status; printf '\nReview the files above. Stage only what you intend with git add, then run git commit with your own message.\n'`;
  }
  const record = providers[provider];
  if (!record || !["login", "install", "update", "models"].includes(action)) return null;
  return record[action][platformKey()] || null;
}

function actionNote(provider, action) {
  if (provider === "skills" && action === "update") return "The terminal will fast-forward the skills repository only if Git can do so safely.";
  if (provider === "skills" && action === "diff") return "The terminal shows the current skill changes without modifying them.";
  if (provider === "skills" && action === "commit") return "The terminal shows Git status and leaves staging and the commit message under your control.";
  if (action === "models") return providers[provider]?.modelsNote;
  if (action === "update") return `The terminal will show ${providers[provider]?.label || provider}'s official updater.`;
  return providers[provider]?.loginNote;
}

function runNode(script, args, { input = "", timeoutMs = 45_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, NO_UPDATE_CHECK: "1" },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < 2_000_000) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 100_000) stderr += chunk.toString("utf8"); });
    child.on("error", (error) => finish({ code: null, error }));
    child.on("close", (code) => finish({ code, timedOut: false }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function runCommand(command, args = [], { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < 250_000) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 50_000) stderr += chunk.toString("utf8"); });
    child.on("error", (error) => finish({ code: null, error }));
    child.on("close", (code) => finish({ code, timedOut: false }));
  });
}

async function readiness(governor) {
  const result = await runNode(onboardScript, ["--governor", governor, "--json"]);
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
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "momm-setup-center" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
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
    const candidate = line.replace(/^\s*[-*•]\s*/, "").replace(/\s+\(default\).*$/i, "").trim();
    if (/^[a-z][a-z0-9_.:-]{2,80}$/i.test(candidate) && /(?:gpt|claude|gemini|grok|model)/i.test(candidate)) names.push(candidate);
  }
  return [...new Set(names)].slice(0, 24);
}

async function modelStatus(routes) {
  const routeMap = new Map(routes.map((route) => [route.agent, route]));
  return Promise.all(Object.keys(providers).map(async (agent) => {
    const route = routeMap.get(agent);
    if (!route || route.installed === false) return { agent, status: "missing", models: [] };
    if (!route.ready) return { agent, status: "login_required", models: [] };
    if (!["antigravity", "grok"].includes(agent)) return { agent, status: "interactive_selector", models: [] };
    const command = agent === "antigravity" ? "agy" : "grok";
    const result = await runCommand(command, ["models"], { timeoutMs: 20_000 });
    const models = extractModelNames(`${result.stdout}\n${result.stderr}`);
    return { agent, status: result.code === 0 && models.length ? "available" : result.timedOut ? "timeout" : "login_required", models };
  }));
}

async function maintenanceReport(governor) {
  if (maintenanceCache && Date.now() - maintenanceCache.cachedAt < 10 * 60_000) return maintenanceCache.value;
  const routesReport = await readiness(governor);
  let localVersions = {};
  try { localVersions = JSON.parse(fs.readFileSync(localVersionsFile, "utf8")); } catch {}
  const [publishedResult, claudeLatestResult, copilotLatestResult, grokUpdate, gitVersion, gitStatus, shellVersion, models] = await Promise.all([
    fetchJson(publishedVersionsUrl).catch(() => null),
    fetchJson("https://registry.npmjs.org/@anthropic-ai%2fclaude-code/latest").catch(() => null),
    fetchJson("https://registry.npmjs.org/@github%2fcopilot/latest").catch(() => null),
    runCommand("grok", ["update", "--check", "--json"], { timeoutMs: 20_000 }),
    runCommand("git", ["--version"]),
    runCommand("git", ["-C", skillsRoot, "status", "--porcelain"], { timeoutMs: 10_000 }),
    // Check the SAME shell the actions launch (Windows PowerShell 5, always
    // present) — not pwsh (PowerShell 7), which is absent on stock Windows and
    // produced false failures.
    process.platform === "win32" ? runCommand("powershell.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]) : Promise.resolve({ code: 0, stdout: "not required" }),
    modelStatus(routesReport.routes || []),
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
    { agent: "claude", latest: parseVersion(claudeLatestResult?.version), source: "npm registry" },
    { agent: "antigravity", latest: null, source: "built-in self-updater", auto_managed: true },
    { agent: "copilot", latest: parseVersion(copilotLatestResult?.version), source: "npm registry" },
    { agent: "grok", latest: grokLatest, source: "grok update --check", update_available: grokUpdateAvailable },
  ].map((item) => {
    const route = routeMap.get(item.agent);
    const current = parseVersion(route?.version);
    const comparison = current && item.latest ? compareVersions(current, item.latest) : null;
    return {
      ...item,
      current,
      installed: route?.installed !== false && Boolean(route),
      status: route?.installed === false || !route ? "missing" : item.auto_managed ? "auto_managed" : item.update_available === true || comparison === -1 ? "update_available" : comparison === 0 || item.update_available === false ? "current" : "unknown",
    };
  });
  const value = {
    checked_at: new Date().toISOString(),
    skills: {
      source: publishedVersionsUrl,
      repository_present: fs.existsSync(path.join(skillsRoot, ".git")),
      repository_dirty: gitStatus.code === 0 ? Boolean(gitStatus.stdout.trim()) : null,
      versions: skillVersionReport(localVersions, publishedResult),
    },
    cli_updates: cliUpdates,
    models,
    runtime: {
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      node: process.versions.node,
      node_ready: Number.parseInt(process.versions.node.split(".")[0], 10) >= 22,
      git: gitVersion.code === 0 ? safeDetail(gitVersion.stdout) : null,
      powershell: shellVersion.code === 0 ? safeDetail(shellVersion.stdout) : null,
    },
    environment: classifyEnvironmentNames(Object.keys(process.env)),
    privacy: { environment_values_read: false, credential_contents_read: false, model_calls_made: false },
  };
  maintenanceCache = { cachedAt: Date.now(), value };
  return value;
}

// Returns true only if a terminal process was actually spawned. Commands are
// fixed single-line strings; a newline would let the macOS AppleScript "do
// script" run extra statements, so reject it defensively on every platform.
function launchTerminal(command) {
  if (/[\r\n]/.test(command)) return false;
  try {
    let child;
    if (process.platform === "win32") {
      child = spawn("powershell.exe", ["-NoExit", "-NoProfile", "-Command", command], { detached: true, shell: false, stdio: "ignore", windowsHide: false });
    } else if (process.platform === "darwin") {
      const escaped = command.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      child = spawn("osascript", ["-e", `tell application "Terminal" to do script "${escaped}"`], { detached: true, shell: false, stdio: "ignore" });
    } else {
      child = spawn("x-terminal-emulator", ["-e", "bash", "-lc", `${command}; exec bash`], { detached: true, shell: false, stdio: "ignore" });
    }
    child.on("error", () => {});
    child.unref();
    return child.pid !== undefined; // undefined pid = spawn failed (e.g. terminal not installed)
  } catch { return false; }
}

function openBrowser(url) {
  const invocation = process.platform === "win32"
    ? ["cmd.exe", ["/d", "/s", "/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  const child = spawn(invocation[0], invocation[1], { detached: true, stdio: "ignore", shell: false, windowsHide: true });
  child.on("error", () => {});
  child.unref();
}

function safeDetail(value) {
  return String(value || "").replaceAll(/\u001b\[[0-9;]*m/g, "").trim().slice(0, 600);
}

function startConnectivityJob(provider, governor) {
  while (jobs.size >= maxJobs) jobs.delete(jobs.keys().next().value);
  const id = crypto.randomUUID();
  const job = { id, provider, status: "running", started_at: new Date().toISOString() };
  jobs.set(id, job);
  const input = "Synthetic MOMM connectivity validation only. No repository source, filenames, or user data are included. Return the required structured review report.";
  runNode(dispatcherScript, [
    "--governor", governor,
    "--reviewers", provider,
    "--min-success", "1",
    "--label", "setup-center connectivity validation",
    // Headroom for the worst case: grok ~180s + dispatcher settlement (~5s) +
    // ledger build (~15s). 190s could kill the dispatcher mid-cleanup.
  ], { input, timeoutMs: 240_000 }).then((result) => {
    let report = null;
    try { report = JSON.parse(result.stdout); } catch {}
    const reviewer = report?.reviewers?.find((item) => item.agent === provider);
    job.status = reviewer?.status === "success" ? "success" : "failed";
    job.completed_at = new Date().toISOString();
    job.result = {
      route_status: reviewer?.status || (result.timedOut ? "timeout" : "error"),
      verdict: reviewer?.verdict || null,
      duration_ms: reviewer?.duration_ms || null,
      detail: safeDetail(reviewer?.detail || result.stderr || "The reviewer did not return a readable report."),
      ledger_url: report?.evidence?.ledger_url || null,
    };
  }).catch((error) => {
    job.status = "failed";
    job.completed_at = new Date().toISOString();
    job.result = { route_status: "error", detail: safeDetail(error.message), ledger_url: null };
  });
  return job;
}

function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

// Defeat DNS rebinding: a loopback SOCKET is not enough — a rebound attacker
// hostname resolves to 127.0.0.1, so the socket check passes while the Host
// header carries the attacker's domain. Only loopback host names may reach any
// route (including /api/session, which returns the token).
function isAllowedHost(request) {
  const host = request.headers.host;
  if (!host || typeof host !== "string") return false;
  let name;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end === -1) return false;                       // malformed: no closing bracket
    const rest = host.slice(end + 1);
    if (rest !== "" && !/^:\d+$/.test(rest)) return false; // only [host] or [host]:port — blocks [::1].evil
    name = host.slice(1, end);
  } else {
    const colon = host.lastIndexOf(":");
    if (colon === -1) name = host;
    else {
      if (!/^\d+$/.test(host.slice(colon + 1))) return false; // port must be digits — blocks "127.0.0.1:80@evil.com"
      name = host.slice(0, colon);
    }
  }
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
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
    if (!isAllowedHost(request)) return sendJson(response, 403, { error: "Invalid Host header" });
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && requestUrl.pathname === "/") return serveAsset(response, "index.html", "text/html; charset=utf-8");
      if (request.method === "GET" && requestUrl.pathname === "/styles.css") return serveAsset(response, "styles.css", "text/css; charset=utf-8");
      if (request.method === "GET" && requestUrl.pathname === "/app.js") return serveAsset(response, "app.js", "text/javascript; charset=utf-8");
      if (request.method === "GET" && requestUrl.pathname === "/api/session") {
        return sendJson(response, 200, { token: sessionToken, platform: platformKey(), providers });
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/status") {
        const governor = String(requestUrl.searchParams.get("governor") || "codex").toLowerCase();
        if (!governors.has(governor)) return sendJson(response, 400, { error: "Unsupported governor" });
        return sendJson(response, 200, await readiness(governor));
      }
      if (request.method === "GET" && requestUrl.pathname.startsWith("/api/job/")) {
        const job = jobs.get(requestUrl.pathname.slice("/api/job/".length));
        return job ? sendJson(response, 200, job) : sendJson(response, 404, { error: "Job not found" });
      }
      if (request.method === "POST") {
        if (!authorized(request)) return sendJson(response, 403, { error: "Invalid local session" });
        const body = await readBody(request);
        if (requestUrl.pathname === "/api/action") {
          const provider = String(body.provider || "").toLowerCase();
          const action = String(body.action || "").toLowerCase();
          const command = actionCommand(provider, action);
          if (!command) return sendJson(response, 400, { error: "Unsupported provider action" });
          if (provider === "skills" && action === "update") {
            if (!fs.existsSync(path.join(skillsRoot, ".git"))) return sendJson(response, 409, { error: "The skills source is not a Git checkout." });
            const status = await runCommand("git", ["-C", skillsRoot, "status", "--porcelain"], { timeoutMs: 10_000 });
            if (status.code !== 0) return sendJson(response, 409, { error: "Git could not verify that the skills checkout is safe to update." });
            if (status.stdout.trim()) return sendJson(response, 409, { error: "Local skill changes are present. Handle them before updating." });
          }
          if (!launchTerminal(command)) return sendJson(response, 500, { error: "Could not open a terminal for this action.", command });
          return sendJson(response, 202, { launched: true, command, note: actionNote(provider, action) });
        }
        if (requestUrl.pathname === "/api/maintenance") {
          const governor = String(body.governor || "codex").toLowerCase();
          if (!governors.has(governor)) return sendJson(response, 400, { error: "Unsupported governor" });
          if (body.force === true) maintenanceCache = null;
          return sendJson(response, 200, await maintenanceReport(governor));
        }
        if (requestUrl.pathname === "/api/test") {
          const provider = String(body.provider || "").toLowerCase();
          const governor = String(body.governor || "codex").toLowerCase();
          if (!providers[provider] || !governors.has(governor) || provider === governor) {
            return sendJson(response, 400, { error: "Unsupported reviewer/governor pairing" });
          }
          return sendJson(response, 202, startConnectivityJob(provider, governor));
        }
        if (requestUrl.pathname === "/api/shutdown") {
          sendJson(response, 202, { closing: true });
          setTimeout(() => activeServer?.close(() => process.exit(0)), 150);
          return;
        }
      }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(response, 500, { error: safeDetail(error.message) || "Unexpected local error" });
    }
  });
}

function selfTest() {
  const sampleEnvironment = classifyEnvironmentNames(["SAFE_NAME", "XAI_API_KEY", "HTTP_PROXY", "NO_UPDATE_CHECK", "COPILOT_MODEL", "OPENAI_BASE_URL"]);
  const tests = {
    provider_allowlist: Object.keys(providers).join(",") === "claude,antigravity,copilot,grok",
    unknown_provider_rejected: actionCommand("unknown", "login") === null,
    unknown_action_rejected: actionCommand("claude", "delete") === null,
    commands_are_fixed: Object.keys(providers).every((name) => ["login", "install", "update", "models"].every((action) => actionCommand(name, action))),
    skill_actions_are_fixed: actionCommand("skills", "update")?.includes("pull --ff-only") === true
      && actionCommand("skills", "diff")?.includes("git diff") === true
      && actionCommand("skills", "commit")?.includes("git status") === true,
    loopback_only: isLoopback("127.0.0.1") && isLoopback("::1") && !isLoopback("192.168.1.5"),
    host_allowlist_blocks_rebinding: isAllowedHost({ headers: { host: "127.0.0.1:8080" } })
      && isAllowedHost({ headers: { host: "localhost:8080" } })
      && isAllowedHost({ headers: { host: "[::1]:8080" } })
      && !isAllowedHost({ headers: { host: "evil.example.com" } })
      && !isAllowedHost({ headers: { host: "127.0.0.1.evil.com" } })
      && !isAllowedHost({ headers: { host: "[::1].evil.example" } }) // bracket-prefix bypass
      && !isAllowedHost({ headers: { host: "[::1" } })               // malformed, no closing bracket
      && !isAllowedHost({ headers: { host: "127.0.0.1:80@evil.com" } })
      && !isAllowedHost({ headers: {} }),
    terminal_rejects_newline_commands: launchTerminal("git status\nrm -rf /") === false,
    clickjacking_blocked: securityHeaders()["X-Frame-Options"] === "DENY",
    api_keys_not_mentioned: !JSON.stringify(providers).match(/api[_ -]?key/i),
    environment_values_never_classified: sampleEnvironment.api_key_names_present[0] === "XAI_API_KEY" && !("values" in sampleEnvironment),
    relevant_environment_categories: sampleEnvironment.proxy_names_present[0] === "HTTP_PROXY"
      && sampleEnvironment.update_controls_present[0] === "NO_UPDATE_CHECK"
      && sampleEnvironment.model_overrides_present[0] === "COPILOT_MODEL"
      && sampleEnvironment.endpoint_overrides_present[0] === "OPENAI_BASE_URL",
    version_comparison: compareVersions("1.9.0", "1.8.9") === 1 && compareVersions("1.8.0", "1.8.0") === 0 && compareVersions("1.7.9", "1.8.0") === -1,
    assets_present: ["index.html", "styles.css", "app.js"].every((file) => fs.existsSync(path.join(assetDir, file))),
  };
  const passed = Object.values(tests).every(Boolean);
  process.stdout.write(`${JSON.stringify({ passed, tests }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
}

let options;
try { options = parseArgs(process.argv.slice(2)); }
catch (error) { process.stderr.write(`${error.message}\n${usage()}\n`); process.exit(1); }
if (options.help) { process.stdout.write(`${usage()}\n`); process.exit(0); }
if (options.selfTest) { selfTest(); }
else {
  activeServer = createServer();
  activeServer.listen(options.port, "127.0.0.1", () => {
    const address = activeServer.address();
    const url = `http://127.0.0.1:${address.port}/`;
    process.stdout.write(`MOMM Setup Center: ${url}\n`);
    process.stdout.write("Local-only. No source code or credential contents are read during setup.\n");
    if (options.browser) openBrowser(url);
  });
}
