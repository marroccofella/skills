#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createProcessScope } from "./process-scope.mjs";

const processScope = createProcessScope();
processScope.installSignalHandlers(undefined, {graceful:true});

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

// Connectivity checks must outlive the slowest legitimate route: the
// dispatcher grants grok 1.5x of the 120s base (180s), its kill path allows a
// 5s hard-deadline settle, and the ledger rebuild takes up to 15s before the
// report is written to stdout. 240s covers 180+5+15 with margin; a shorter
// wrapper SIGKILLs a *successful* check before its report flushes and
// misreports it as failed.
const CONNECTIVITY_TIMEOUT_MS = 240_000;

// `modalities` mirrors the dispatcher's MODALITY_SUPPORT (multi-review.mjs)
// — keep the two in sync; the dispatcher's matrix is the enforcing authority.
const providers = Object.freeze({
  codex: {
    label: "Codex",
    modalities: ["text", "image"],
    docs: "https://developers.openai.com/codex/cli/",
    login: { win32: "codex login", darwin: "codex login", linux: "codex login" },
    update: { win32: "npm install -g @openai/codex@latest", darwin: "npm install -g @openai/codex@latest", linux: "npm install -g @openai/codex@latest" },
    models: { win32: "codex", darwin: "codex", linux: "codex" },
    install: {
      win32: "npm install -g @openai/codex",
      darwin: "npm install -g @openai/codex",
      linux: "npm install -g @openai/codex",
    },
    loginNote: "Complete the ChatGPT sign-in in the browser window that opens.",
    modelsNote: "When Codex opens, type /model to view models available to this account.",
  },
  claude: {
    label: "Claude Code",
    modalities: ["text", "image", "pdf"],
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
  gemini: {
    label: "Gemini",
    modalities: ["text", "image", "pdf", "audio", "video"],
    docs: "https://github.com/google-gemini/gemini-cli",
    login: { win32: "gemini", darwin: "gemini", linux: "gemini" },
    update: { win32: "npm install -g @google/gemini-cli@latest", darwin: "npm install -g @google/gemini-cli@latest", linux: "npm install -g @google/gemini-cli@latest" },
    models: { win32: "gemini", darwin: "gemini", linux: "gemini" },
    install: {
      win32: "npm install -g @google/gemini-cli",
      darwin: "npm install -g @google/gemini-cli",
      linux: "npm install -g @google/gemini-cli",
    },
    loginNote: "When Gemini opens, run /auth and complete the Google sign-in. Requires a Code Assist organization license; individual tiers were retired.",
    modelsNote: "When Gemini opens, the selector shows models available to the signed-in organization account.",
  },
  antigravity: {
    label: "Antigravity",
    modalities: ["text"],
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
    modalities: ["text"],
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
    modalities: ["text"],
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

const npmPackages = Object.freeze({ codex: '@openai/codex', claude: '@anthropic-ai/claude-code', copilot: '@github/copilot', gemini: '@google/gemini-cli' });
function detectInstallation(agent, env = process.env, platform = process.platform) {
  const name = agent === 'antigravity' ? 'agy' : agent;
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  for (const directory of pathValue.split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    for (const extension of platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']) {
      const candidate = path.join(directory.replace(/^"|"$/g, ''), name + extension);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (platform !== 'win32') { try { fs.accessSync(candidate, fs.constants.X_OK); } catch { continue; } }
        const resolved = fs.realpathSync(candidate);
        // Executable magic is not installation ownership: these managers ship
        // native shims too. Let their own updater maintain the selected install.
        const managedPath = /\/(?:\.volta|scoop|chocolatey|\.asdf|\.local\/share\/mise)\//i;
        if ([candidate,resolved].some(p=>managedPath.test(p.replaceAll('\\','/')))) return {kind:'unknown',path:candidate,note:'Package-manager installation; update through its package manager.'};
        const packageName = npmPackages[agent];
        if (packageName) {
          const marker = `/node_modules/${packageName}/`;
          const normalized = resolved.replaceAll('\\', '/');
          const packageRoot = normalized.includes(marker)
            ? normalized.slice(0, normalized.indexOf(marker) + marker.length - 1)
            : path.join(path.dirname(candidate), 'node_modules', packageName);
          try {
            if (JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).name === packageName
              && (normalized.includes(marker) || /\.(cmd|bat)$/i.test(candidate))) {
              if (candidate.replaceAll('\\','/').includes('/node_modules/.bin/')) return {kind:'project_npm',path:candidate};
              const globalMarker = '/lib/node_modules/';
              const prefix = platform === 'win32' ? path.dirname(candidate)
                : normalized.includes(globalMarker) ? normalized.slice(0,normalized.indexOf(globalMarker)) : null;
              return {kind:prefix ? 'npm' : 'unknown', path:candidate, prefix};
            }
          } catch {}
        }
        // Homebrew and unknown wrappers need their own package manager; do not create a shadow npm install.
        if (/\/(?:Cellar|Caskroom)\//.test(resolved.replaceAll('\\','/'))) return {kind:'homebrew',path:candidate};
        // Only known executable file formats qualify for native self-update. Shell wrappers may route elsewhere.
        let native = false, fd;
        try { fd=fs.openSync(resolved,'r'); const header=Buffer.alloc(4); fs.readSync(fd,header,0,4,0);
          native=header.subarray(0,2).toString()==='MZ' || ['7f454c46','feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','bebafeca'].includes(header.toString('hex'));
        } finally { if(fd !== undefined) fs.closeSync(fd); }
        return {kind:native ? 'native' : 'unknown',path:candidate};
      } catch {}
    }
  }
  return {kind:'unknown',path:null};
}

function actionCommand(provider, action) {
  if (provider === "skills" && ["update", "diff", "commit"].includes(action)) {
    const windows = platformKey() === "win32";
    const quoted = windows
      ? `'${skillsRoot.replaceAll("'", "''")}'`
      : `'${skillsRoot.replaceAll("'", `'\\''`)}'`;
    if (action === "update") return windows
      ? `Set-Location ${quoted}; node momm/scripts/multi-review.mjs update --dry-run`
      : `cd ${quoted} && node momm/scripts/multi-review.mjs update --dry-run`;
    if (action === "diff") return windows
      ? `Set-Location ${quoted}; git status --short; git diff --stat; git diff`
      : `cd ${quoted} && git status --short && git diff --stat && git diff`;
    return windows
      ? `Set-Location ${quoted}; git status; Write-Host ''; Write-Host 'Review the files above. Stage only what you intend with git add, then run git commit with your own message.'`
      : `cd ${quoted} && git status; printf '\nReview the files above. Stage only what you intend with git add, then run git commit with your own message.\n'`;
  }
  const record = providers[provider];
  if (!record || !["login", "install", "update", "models"].includes(action)) return null;
  if (action === 'update') {
    const installation = detectInstallation(provider);
    if (installation.kind === 'npm' && npmPackages[provider]) {
      const prefix = platformKey() === 'win32' ? `'${installation.prefix.replaceAll("'", "''")}'` : `'${installation.prefix.replaceAll("'", `'\\''`)}'`;
      return `npm install -g --prefix ${prefix} ${npmPackages[provider]}@latest`;
    }
    if (installation.kind !== 'native') return null;
    const args = ({codex:'update',claude:'update',copilot:'update',antigravity:'update',grok:'update --stable'})[provider];
    if (!args) return null;
    const executable = platformKey() === 'win32' ? `& '${installation.path.replaceAll("'", "''")}'` : `'${installation.path.replaceAll("'", `'\\''`)}'`;
    return `${executable} ${args}`;
  }
  return record[action][platformKey()] || null;
}

function actionNote(provider, action) {
  if (provider === "skills" && action === "update") return "The terminal previews a signed update and its protocol diff. It does not install. Applying requires your explicit update --apply command and protocol acceptance when changed.";
  if (provider === "skills" && action === "diff") return "The terminal shows the current skill changes without modifying them.";
  if (provider === "skills" && action === "commit") return "The terminal shows Git status and leaves staging and the commit message under your control.";
  if (action === "models") return providers[provider]?.modelsNote;
  if (action === "update") return `The terminal runs ${providers[provider]?.label || provider}'s updater. Opening it is not proof of success. Finish there, then check versions again.`;
  return providers[provider]?.loginNote;
}

// Timed-out children are terminated with the same layered containment as the
// dispatcher's runProcess: tree kill on Windows (the direct child may be a
// shell whose descendants hold the pipes), a direct-kill backstop when
// taskkill is unavailable, and a hard settle so the server never hangs on a
// process nothing could kill.
function killProcessTree(child, isSettled) {
  processScope.terminate(child, {graceful:true});
}

function supervise(child, { timeoutMs, stdoutLimit, stderrLimit, resolve }) {
  let stdout = "";
  let stderr = "";
  let settled = false;
  let timedOut = false;
  let hardSettle = null;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (hardSettle) clearTimeout(hardSettle);
    processScope.release(child);
    child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
    child.unref?.();
    resolve({ ...result, stdout, stderr });
  };
  const timer = setTimeout(() => {
    // Flag BEFORE killing. The ordinary close listener below was registered
    // first, so Node runs it first when the killed child closes; it reads this
    // flag so a timed-out child reports timedOut:true. Adding a second close
    // listener here instead would lose the race and misreport every timeout
    // as a normal exit (finding timeout-close-misclassified, run
    // rev_20260904131435_mf6w — reproduced before this fix).
    timedOut = true;
    killProcessTree(child, () => settled);
    // The close event drains remaining output; the hard settle only fires
    // when nothing could kill the tree.
    hardSettle = setTimeout(() => finish({ code: null, timedOut: true }), 5000);
    // Referenced: blocked killing must not strand a pending server request.
  }, timeoutMs);
  child.stdout?.on("data", (chunk) => { if (stdout.length < stdoutLimit) stdout += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk) => { if (stderr.length < stderrLimit) stderr += chunk.toString("utf8"); });
  child.on("error", (error) => finish({ code: null, error }));
  child.on("close", (code) => finish({ code: timedOut ? null : code, timedOut }));
  child.on("exit", code => {
    const fallback = setTimeout(() => finish({code:timedOut ? null : code,timedOut}),1500);
    fallback.unref?.();
  });
}

function runNode(script, args, { input = "", timeoutMs = 45_000 } = {}) {
  return new Promise((resolve) => {
    const child = processScope.spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, NO_UPDATE_CHECK: "1" },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    supervise(child, { timeoutMs, stdoutLimit: 2_000_000, stderrLimit: 100_000, resolve });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function runCommand(command, args = [], { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve) => {
    const child = processScope.spawn(process.platform === 'win32' && command === 'git' ? 'git.exe' : command, args, {
      cwd: process.cwd(),
      env: { ...process.env, NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    supervise(child, { timeoutMs, stdoutLimit: 250_000, stderrLimit: 50_000, resolve });
  });
}

async function readiness(governor) {
  // Probe every provider the Setup Center can configure — including gemini,
  // which the dispatcher's default review pool deliberately leaves opt-in.
  const allReviewers = Object.keys(providers).join(",");
  const result = await runNode(onboardScript, ["--governor", governor, "--reviewers", allReviewers, "--json"]);
  if (result.code !== 0) throw new Error((result.stderr || "Readiness check failed").trim().slice(0, 800));
  return JSON.parse(result.stdout);
}

function parseVersion(value) {
  return String(value || "").match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)?.[1] || null;
}

function compareVersions(left, right) {
  const pattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
  const x = String(left || '').match(pattern), y = String(right || '').match(pattern);
  if (!x || !y) return null;
  const a = x.slice(1,4).map(Number), b = y.slice(1,4).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  if (x[4] === y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  const ap = x[4].split('.'), bp = y[4].split('.');
  for (let i=0; i<Math.max(ap.length,bp.length); i++) {
    if (ap[i] === bp[i]) continue;
    if (ap[i] === undefined) return -1;
    if (bp[i] === undefined) return 1;
    const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i]);
    if (an && bn) return BigInt(ap[i]) > BigInt(bp[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return ap[i] > bp[i] ? 1 : -1;
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
    return { agent, status: result.code === 0 && models.length ? "available" : result.timedOut ? "timeout" : "unknown", models };
  }));
}

async function maintenanceReport(governor) {
  if (maintenanceCache && Date.now() - maintenanceCache.cachedAt < 10 * 60_000) return maintenanceCache.value;
  // Installation inventory has no review eligibility: include the active controller too.
  // This makes zero model calls and does not bypass dispatch-time self-exclusion.
  const routesReport = await readiness('other');
  let localVersions = {};
  try { localVersions = JSON.parse(fs.readFileSync(localVersionsFile, "utf8")); } catch {}
  const [publishedResult, codexLatestResult, claudeLatestResult, geminiLatestResult, copilotLatestResult, grokUpdate, gitVersion, gitStatus, shellVersion, models] = await Promise.all([
    fetchJson(publishedVersionsUrl).catch(() => null),
    fetchJson("https://registry.npmjs.org/@openai%2fcodex/latest").catch(() => null),
    fetchJson("https://registry.npmjs.org/@anthropic-ai%2fclaude-code/latest").catch(() => null),
    fetchJson("https://registry.npmjs.org/@google%2fgemini-cli/latest").catch(() => null),
    fetchJson("https://registry.npmjs.org/@github%2fcopilot/latest").catch(() => null),
    runCommand("grok", ["update", "--check", "--stable", "--json"], { timeoutMs: 20_000 }),
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
    if (grokUpdate.code === 0 && !grokUpdate.timedOut && !parsed.error
      && typeof parsed.updateAvailable === 'boolean' && parseVersion(parsed.latestVersion)) {
      grokLatest = parseVersion(parsed.latestVersion);
      grokUpdateAvailable = parsed.updateAvailable;
    }
  } catch {}
  const cliUpdates = [
    { agent: "codex", latest: parseVersion(codexLatestResult?.version), source: "npm registry" },
    { agent: "claude", latest: parseVersion(claudeLatestResult?.version), source: "npm registry" },
    { agent: "gemini", latest: parseVersion(geminiLatestResult?.version), source: "npm registry" },
    { agent: "antigravity", latest: null, source: "No verified check-only command; native updater requires your approval" },
    { agent: "copilot", latest: parseVersion(copilotLatestResult?.version), source: "npm registry" },
    { agent: "grok", latest: grokLatest, source: "grok update --check --stable (stable channel)", update_available: grokUpdateAvailable },
  ].map((item) => {
    const route = routeMap.get(item.agent);
    const current = parseVersion(route?.version);
    const comparison = current && item.latest ? compareVersions(current, item.latest) : null;
    return {
      ...item,
      current,
      installation: detectInstallation(item.agent),
      update_command: actionCommand(item.agent, 'update'),
      install_command: actionCommand(item.agent, 'install'),
      installed: route?.installed !== false && Boolean(route),
      status: route?.installed === false || !route ? "missing" : item.update_available === true ? "update_available" : !current ? 'unknown' : comparison === -1 ? "update_available" : comparison === 0 ? "current" : comparison === 1 ? 'local_newer' : "unknown",
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
      node_ready: Number.parseInt(process.versions.node.split(".")[0], 10) >= 18,
      node_recommended: Number.parseInt(process.versions.node.split(".")[0], 10) >= 22,
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
    "--timeout", "120",
    "--label", "setup-center connectivity validation",
  ], { input, timeoutMs: CONNECTIVITY_TIMEOUT_MS }).then((result) => {
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
    const chunks = [];
    let bytes = 0, failed = false;
    request.on("data", (chunk) => {
      if (failed) return;
      const buffer = Buffer.from(chunk); bytes += buffer.length;
      if (bytes > 4096) { failed=true; chunks.length=0; reject(new Error("Request body too large")); request.destroy(); return; }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (failed) return;
      const body = Buffer.concat(chunks).toString('utf8');
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
        if (!authorized(request)) return sendJson(response, 403, {error:'Invalid local session'});
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
          if ((provider !== 'skills' && ['update','install'].includes(action) || body.expected_command) && body.expected_command !== command) return sendJson(response, 409, {error:'Confirm the exact command first. Refresh versions if the installation changed.'});
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
          processScope.stop({graceful:true});
          activeServer?.close();
          setTimeout(() => { processScope.force(); activeServer?.closeAllConnections?.(); process.exit(0); }, 1200);
          return;
        }
      }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(response, 500, { error: safeDetail(error.message) || "Unexpected local error" });
    }
  });
}

// The dispatcher's MODALITY_SUPPORT is the enforcing authority; the provider
// cards must never drift from it. Read it straight out of the dispatcher
// source so multi-review.mjs stays a single dependency-free file.
function readDispatcherModalities() {
  try {
    const source = fs.readFileSync(dispatcherScript, "utf8");
    const match = source.match(/const MODALITY_SUPPORT = (\{[\s\S]*?\n\});/);
    return match ? new Function(`return ${match[1]};`)() : null;
  } catch { return null; }
}

async function selfTest() {
  // A child that outlives its budget must be reported as timed out — the
  // listener-order regression this guards against was found by momm review.
  const timedOutProbe = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { timeoutMs: 100 });
  const dispatcherModalities = readDispatcherModalities();
  const sampleEnvironment = classifyEnvironmentNames(["SAFE_NAME", "XAI_API_KEY", "HTTP_PROXY", "NO_UPDATE_CHECK", "COPILOT_MODEL", "OPENAI_BASE_URL"]);
  const tests = {
    provider_allowlist: Object.keys(providers).join(",") === "codex,claude,gemini,antigravity,copilot,grok",
    every_dispatcher_route_has_a_card: ["codex", "gemini", "claude", "antigravity", "copilot", "grok"].every((agent) => Boolean(providers[agent])),
    every_governor_is_selectable_in_ui: (() => {
      try {
        const html = fs.readFileSync(path.join(assetDir, "index.html"), "utf8");
        return [...governors].filter((name) => name !== "other").every((name) => html.includes(`value="${name}"`));
      } catch { return false; }
    })(),
    connectivity_budget_covers_slowest_route: CONNECTIVITY_TIMEOUT_MS >= 200_000,
    every_provider_declares_modalities: Object.values(providers).every((p) => Array.isArray(p.modalities) && p.modalities.includes("text")),
    modalities_match_dispatcher: dispatcherModalities !== null && Object.keys(providers).every((agent) => JSON.stringify([...providers[agent].modalities].sort()) === JSON.stringify(Object.keys(dispatcherModalities[agent] ?? {}).sort())),
    timeout_reports_timed_out: timedOutProbe.timedOut === true && timedOutProbe.code === null,
    unknown_provider_rejected: actionCommand("unknown", "login") === null,
    unknown_action_rejected: actionCommand("claude", "delete") === null,
    commands_are_fixed: Object.keys(providers).every((name) => ["login", "install", "models"].every((action) => actionCommand(name, action))),
    skill_actions_are_fixed: actionCommand("skills", "update")?.includes("update --dry-run") === true
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
if (options.selfTest) { await selfTest(); }
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
