#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createProcessScope } from "./process-scope.mjs";
import { readGuidanceFile, validateGuidance, resolveGuidance, trustProject, isTrusted, formatEffectivePrompt, projectGuidanceFiles, userGuidancePath, sha256, GUIDANCE_BUDGET } from "./guidance.mjs";
import { createUpdateClock, applyUpdates, writeSettings, timerCommand, installTimer, removeTimer, localSkillVersion } from "./update-clock.mjs";
import { runProbes, recordProbe, windowsLauncher, runModalityProbes, generativeCells, routeDisclosure, latestModalityProbes } from "./probes.mjs";
import { rollupUsage } from "./usage.mjs";

const processScope = createProcessScope();
processScope.installSignalHandlers(undefined, {graceful:true});

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.join(scriptDir, "..", "assets", "setup-ui");
const skillsRoot = path.resolve(scriptDir, "..", "..");
const onboardScript = path.join(scriptDir, "onboard.mjs");
const dispatcherScript = path.join(scriptDir, "multi-review.mjs");
const ledgerScript = path.join(scriptDir, "ledger.mjs");
const updaterScript = path.join(scriptDir, "update.mjs");
const updateClockScript = path.join(scriptDir, "update-clock.mjs");
const localVersionsFile = path.join(skillsRoot, "versions.json");
const publishedVersionsUrl = "https://raw.githubusercontent.com/marroccofella/skills/main/versions.json";
const governors = new Set(["codex", "gemini", "claude", "antigravity", "copilot", "grok", "other"]);
const sessionToken = crypto.randomBytes(24).toString("hex");
const jobs = new Map();
const maxJobs = 12;
let activeServer = null;
let maintenanceCache = null;
let updateClock = null;   // created at server start; null under --self-test
let ledgerWatcher = null; // idem
let setupPointer = null;  // .ensemble_reviews/setup-center.json while the server runs

// Connectivity checks must outlive the slowest legitimate route: the
// dispatcher grants grok 1.5x of the 120s base (180s), its kill path allows a
// 5s hard-deadline settle, and the ledger rebuild takes up to 15s before the
// report is written to stdout. 240s covers 180+5+15 with margin; a shorter
// wrapper SIGKILLs a *successful* check before its report flushes and
// misreports it as failed.
const CONNECTIVITY_TIMEOUT_MS = 240_000;

// `modalities` mirrors what the dispatcher's adapters bind for --attach
// (multi-review.mjs MODALITY_SUPPORT ∩ ADAPTER_MEDIA) — the self-test keeps the
// two in sync; at dispatch the effective capability registry is the authority.
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
    modalities: ["text", "image", "pdf"],
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
    modalities: ["text", "image", "pdf"],
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

async function bootstrapStatus() {
  const result = await runCommand(process.execPath, [path.join(skillsRoot, 'momm/scripts/bootstrap.mjs'), '--check', '--existing', skillsRoot], { timeoutMs: 15_000 });
  try {
    const value = JSON.parse(result.stdout);
    if (![0, 2].includes(result.code) || !['ready_to_verify', 'prerequisites_missing'].includes(value.status) || !Array.isArray(value.tools)) throw Error('unknown result');
    return value;
  } catch { return { status: 'inspection_required', tools: [], installation: { route: 'inspection_required' }, signature_verified: false }; }
}

async function maintenanceReport(governor) {
  if (maintenanceCache && Date.now() - maintenanceCache.cachedAt < 10 * 60_000) return maintenanceCache.value;
  // Installation inventory has no review eligibility: include the active controller too.
  // This makes zero model calls and does not bypass dispatch-time self-exclusion.
  const routesReport = await readiness('other');
  let localVersions = {};
  try { localVersions = JSON.parse(fs.readFileSync(localVersionsFile, "utf8")); } catch {}
  const [publishedResult, codexLatestResult, claudeLatestResult, geminiLatestResult, copilotLatestResult, grokUpdate, gitVersion, gitStatus, shellVersion, models, bootstrap] = await Promise.all([
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
    bootstrapStatus(),
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
      installed: route ? (route.installed ?? null) : null,
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
      update_readiness: bootstrap,
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

// Both job kinds enter the bounded map through admitJob (Modalities section below).
function startConnectivityJob(provider, governor) {
  const id = crypto.randomUUID();
  const job = { id, provider, status: "running", started_at: new Date().toISOString() };
  if (!admitJob(job)) return null;
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

// --- Standing guidance (1.16 E3/E4) --------------------------------------------
// The editor writes the PROJECT file only; the user-level file is shown
// read-only. Every write carries the sha256 the editor loaded, so an edit made
// elsewhere in the meantime (the CLI, another session, a git pull) is refused
// with 409 instead of being overwritten. A successful save trusts exactly the
// bytes written, and nothing else, through the same trust store the dispatcher
// consults. The guidance preview is built by the dispatcher's own prompt
// assembler with a literal placeholder for the artifact, so no source ever
// reaches this page. It is a GUIDANCE preview, not the effective prompt: the
// built-in review contract is a stub here and no persona is supplied, so the
// API names it guidance_preview and carries the note the page shows beside it.
const GUIDANCE_ROUTES = Object.freeze(["codex", "claude", "gemini", "antigravity", "copilot", "grok"]);
const GUIDANCE_BODY_LIMIT = 64 * 1024;
const GUIDANCE_PREVIEW_STUB = "[guidance preview: the built-in momm-peer-review/2 contract and the route persona are not rendered here; the dispatcher supplies both at review time]";
const GUIDANCE_PREVIEW_NOTE = "shows the resolved guidance layers in position; the built-in contract and persona text are not rendered here";

// The on-disk hash, with the read failure carried alongside instead of thrown:
// a directory or unreadable entry at the guidance path is a reportable state
// of the project (project_error), not a crash of the whole snapshot.
function guidanceFileState(file) {
  try { return { sha: fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null, error: null }; }
  catch (error) { return { sha: null, error: safeDetail(error.message) }; }
}

function guidanceSnapshot({ cwd = process.cwd(), home } = {}) {
  const file = projectGuidanceFiles(cwd).guidance;
  const disk = guidanceFileState(file);
  const value = {
    file, user_file: userGuidancePath(home), routes: [...GUIDANCE_ROUTES], budget: { ...GUIDANCE_BUDGET },
    project: null, project_error: disk.error, project_sha256: disk.sha, trusted: false,
    user: null, user_error: null, effective: {}, governor: null, guidance_preview: {}, guidance_preview_note: GUIDANCE_PREVIEW_NOTE, notices: [], resolve_error: null,
  };
  try { value.project = readGuidanceFile(file); } catch (error) { value.project_error ||= safeDetail(error.message); }
  try { value.user = readGuidanceFile(userGuidancePath(home)); } catch (error) { value.user_error = safeDetail(error.message); }
  try { value.trusted = value.project_sha256 !== null && isTrusted(cwd, "guidance", value.project_sha256, { home }); } catch (error) { value.project_error ||= safeDetail(error.message); }
  try {
    const resolved = resolveGuidance({ cwd, home, routes: GUIDANCE_ROUTES });
    value.effective = resolved.routes;
    value.governor = resolved.governor;
    value.notices = resolved.notices;
    for (const route of GUIDANCE_ROUTES) value.guidance_preview[route] = formatEffectivePrompt(GUIDANCE_PREVIEW_STUB, resolved.routes[route].text, 0);
  } catch (error) { value.resolve_error = safeDetail(error.message); }
  return value;
}

// Courtesy pre-check of the per-route stack so the editor can refuse a save
// that would fail every later run. Mirrors guidance.mjs stack(): layers joined
// with a blank line, project blocks replaced by the candidate. The resolver
// remains the authority at dispatch; this only decides between 400 and a write.
function guidanceBudgetProblem(candidate, effective) {
  for (const route of GUIDANCE_ROUTES) {
    const fixed = (effective?.[route]?.layers || []).filter((layer) => layer.name !== "persona" && (!layer.name.startsWith("project:") || layer.name === "project:.reviewrules"));
    const blocks = [...fixed.map((layer) => layer.chars), ...["*", route].map((key) => candidate.reviewers?.[key]).filter((text) => typeof text === "string" && text.trim()).map((text) => text.length)];
    const total = blocks.reduce((sum, chars) => sum + chars, 0) + Math.max(0, blocks.length - 1) * 2;
    if (total > GUIDANCE_BUDGET.per_route) return `guidance for route ${route} would be ${total} characters with the user-level and .reviewrules layers; the cap is ${GUIDANCE_BUDGET.per_route}`;
  }
  return null;
}

const GUIDANCE_STALE = "The guidance file changed on disk since this editor loaded it. Reload, review the change, then save again.";
const GUIDANCE_BUSY = "Another momm process may be saving guidance, or its lock needs explicit recovery. Wait and reload. If it persists, stop all MOMM writers, including older versions, and independently confirm none remain before removing only guidance.json.lock. Never remove a lock based only on PID or age.";

// Serialises guidance writers across processes the way guidance.mjs serialises
// the trust store: `.momm/guidance.json.lock` is created with O_EXCL and holds
// the owner's pid. Existing locks are never stolen, even when apparently dead.
// An existing lock is NOT waited
// on — the caller answers 409, so a server never parks its event loop behind a
// peer. Returns the release function, or null while a live lock is held.
function acquireGuidanceLock(file) {
  const lock = `${file}.lock`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.writeFileSync(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      return () => { try { fs.unlinkSync(lock); } catch { /* already gone */ } };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      return null;
    }
  }
  return null;
}

// `beforeCommit` and `beforeRename` are test seams only. `beforeCommit` stands
// in for a second process writing the file after the pre-check and before the
// lock is taken; `beforeRename` runs inside the lock, after the final hash
// check, where a cooperating second saver must find the lock and be refused.
function saveGuidance(body, { cwd = process.cwd(), home, beforeCommit, beforeRename } = {}) {
  const file = projectGuidanceFiles(cwd).guidance;
  let guidance;
  try { guidance = validateGuidance(body?.guidance, ".momm/guidance.json"); } catch (error) { return { status: 400, value: { error: safeDetail(error.message) } }; }
  const expected = body?.expected_sha256 ?? null;
  if (expected !== null && !/^[0-9a-f]{64}$/.test(String(expected))) return { status: 400, value: { error: "expected_sha256 must be the sha256 the editor loaded, or null for a new file" } };
  const text = `${JSON.stringify(guidance, null, 2)}\n`;
  // The request listener bounds the HTTP body; this bounds the FILE the save
  // would produce, whoever assembled the body (route keys are open-ended, so
  // per-block caps alone do not bound it). Past the cap the dispatcher's own
  // bounded reader would refuse the file, so nothing that large may reach disk.
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > GUIDANCE_BODY_LIMIT) return { status: 413, value: { error: `The guidance file would be ${bytes} bytes; the cap is ${GUIDANCE_BODY_LIMIT}. Shorten or remove blocks, then save again.` } };
  const before = guidanceSnapshot({ cwd, home });
  const budget = guidanceBudgetProblem(guidance, before.effective);
  if (budget) return { status: 400, value: { error: budget } };
  // An entry that exists but has no hash cannot be matched by any expected_sha256:
  // refuse instead of letting the rename fail against it.
  if (before.project_sha256 === null && fs.existsSync(file)) return { status: 409, value: { error: `The guidance file exists but could not be read (${before.project_error || "unreadable"}). Repair or remove it, then reload.`, project_sha256: null } };
  if (before.project_sha256 !== expected) return { status: 409, value: { error: GUIDANCE_STALE, project_sha256: before.project_sha256 } };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  beforeCommit?.();
  // Hash check and rename happen under the lock. A cooperating writer (another
  // Setup Center, or any momm process honouring the lock) cannot enter between
  // the two, and a write that landed before the lock was taken is caught by the
  // re-hash rather than replaced. A writer that ignores the lock (an editor, a
  // git checkout) is still narrowed to this window and, failing that, is
  // refused trust by `expect` below rather than trusted.
  const release = acquireGuidanceLock(file);
  if (!release) return { status: 409, value: { error: GUIDANCE_BUSY, project_sha256: guidanceFileState(file).sha } };
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text, { encoding: "utf8", mode: 0o600 });
    const current = guidanceFileState(file);
    if (current.error || current.sha !== expected) {
      return { status: 409, value: { error: current.error ? `The guidance file became unreadable during the save (${current.error}). Reload and try again.` : GUIDANCE_STALE, project_sha256: current.sha } };
    }
    beforeRename?.();
    fs.renameSync(temp, file);
  } finally {
    // A refused save, or a rename that threw, leaves no stray copy behind.
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* nothing to withdraw */ }
    release();
  }
  // `expect` pins the trust entry to the bytes just written; a race with
  // another writer between rename and trust is refused rather than trusted.
  trustProject(cwd, { home, expect: sha256(text) });
  return { status: 200, value: guidanceSnapshot({ cwd, home }) };
}

// --- Usage (1.16 E1 in the Setup Center) -----------------------------------------
// Reads the local sealed reports only and never estimates: a reviewer whose CLI
// reported nothing counts toward n and never toward the numerator, so the page
// shows "0 of n reported", never a zero. Accepted findings come from the
// governor's own disposition rows for the same run and reviewer.
const USAGE_REPORT_LIMIT = 200;
const REPORT_READ_LIMIT = 2 * 1024 * 1024;    // one sealed report; a larger file is skipped and counted, never parsed
const DISPOSITIONS_CHUNK = 64 * 1024;          // the ledger is streamed through a buffer of this size
const DISPOSITIONS_LINE_LIMIT = 1024 * 1024;   // one ledger row; a longer line is dropped, the rows after it still count

// Streams the append-only ledger row by row through a fixed buffer, so its
// size never decides whether accepted findings are counted. Lines are split on
// the newline byte before decoding, so a multi-byte character straddling two
// chunks is never torn. The only way to lose the counts is a read failure,
// which comes back as `error` so the page can say they are unavailable — never
// that nothing was accepted.
function acceptedFindingsIndex(file) {
  const index = new Map();
  if (!fs.existsSync(file)) return { index, error: null };
  let fd = null;
  try {
    fd = fs.openSync(file, "r");
    const chunk = Buffer.alloc(DISPOSITIONS_CHUNK);
    let carry = Buffer.alloc(0), overlong = false;
    const consume = (bytes) => {
      if (overlong) { overlong = false; return; } // the tail of a line already dropped
      const line = bytes.toString("utf8").trim();
      if (!line) return;
      let row; try { row = JSON.parse(line); } catch { return; }
      if (!row || typeof row !== "object" || !String(row.disposition || "").startsWith("applied")) return;
      const key = `${row.run_id}\u0000${row.reviewer}`;
      index.set(key, (index.get(key) || 0) + 1);
    };
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      const buffer = carry.length ? Buffer.concat([carry, chunk.subarray(0, read)]) : chunk.subarray(0, read);
      let start = 0;
      for (let newline = buffer.indexOf(10, start); newline !== -1; newline = buffer.indexOf(10, start)) { consume(buffer.subarray(start, newline)); start = newline + 1; }
      carry = Buffer.from(buffer.subarray(start)); // a copy: `chunk` is reused by the next read
      if (carry.length > DISPOSITIONS_LINE_LIMIT) { carry = Buffer.alloc(0); overlong = true; }
    }
    if (carry.length) consume(carry);
    return { index, error: null };
  } catch (error) { return { index: null, error: safeDetail(error.message) || "unreadable" }; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } } }
}

function usageReport({ cwd = process.cwd(), limit = USAGE_REPORT_LIMIT } = {}) {
  const dir = path.join(cwd, ".ensemble_reviews", "reports");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => /^rev_[A-Za-z0-9_]+\.json$/.test(name))
      .map((name) => { try { const stat = fs.statSync(path.join(dir, name)); return { name, mtime: stat.mtimeMs, size: stat.size }; } catch { return null; } })
      .filter(Boolean).sort((a, b) => b.mtime - a.mtime);
  } catch {}
  const ledger = acceptedFindingsIndex(path.join(cwd, ".ensemble_reviews", "dispositions.jsonl"));
  const rows = [];
  let scanned = 0, withUsage = 0, skipped = 0;
  for (const { name, size } of files.slice(0, limit)) {
    if (size > REPORT_READ_LIMIT) { skipped += 1; continue; } // never slurped: one oversized report must not stall the server
    let report;
    try { report = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { continue; }
    if (!Array.isArray(report?.reviewers)) continue;
    scanned += 1;
    let carries = false;
    for (const reviewer of report.reviewers) {
      if (reviewer?.status !== "success") continue; // self-excluded, failed and timed-out routes are not reviews
      const usage = reviewer.usage && typeof reviewer.usage === "object" ? reviewer.usage : null;
      if (usage?.reported) carries = true;
      // null, not 0, when the ledger could not be read: unknown is not "none".
      const acceptedFindings = ledger.index ? ledger.index.get(`${report.run_id}\u0000${reviewer.agent}`) ?? 0 : null;
      rows.push({ agent: reviewer.agent, status: reviewer.status, reported: usage?.reported ?? null, coverage: usage?.coverage ?? { tokens: false, cost: false }, accepted_findings: acceptedFindings });
    }
    if (carries) withUsage += 1;
  }
  const rolled = rollupUsage(rows);
  // With the ledger unavailable every count is unknown, so every ratio is too:
  // null renders as "not reported", never as "no accepted findings".
  if (ledger.error) for (const row of rolled) row.cost_per_accepted_finding = null;
  const notes = [withUsage ? null : scanned ? "No report carries CLI-reported usage yet. Counts appear after a review on a route whose CLI reports its own token usage; nothing here is estimated." : "No sealed reports in this project yet. Verify a connection or run a review to populate usage."];
  if (ledger.error) notes.push(`accepted-finding counts unavailable: dispositions.jsonl could not be read (${ledger.error}).`);
  if (skipped) notes.push(`${skipped} report${skipped === 1 ? "" : "s"} over ${REPORT_READ_LIMIT / 1024 / 1024} MiB skipped, not parsed.`);
  return {
    rows: rolled,
    coverage: { reports_available: files.length, reports_scanned: scanned, reports_skipped_oversize: skipped, reports_with_usage: withUsage, reviews: rows.length, limit, accepted_findings_available: !ledger.error },
    note: notes.filter(Boolean).join(" ") || null,
  };
}

// --- Update clock (1.16 E6) --------------------------------------------------------
// One clock per server, off by default (~/.momm/settings.json). Every child it
// needs runs through processScope so a closing server never leaves an updater
// or a `grok update --check` behind, and never blocks the event loop the way the
// module's synchronous defaults would inside a server.
// last_apply is the outcome of the most recent apply pass (an event's or the
// dashboard's): counts, one row per applied source with the re-read version and
// probe verdict, and — while automatic updates are off — the note that says so.
const clockActivity = { running: false, last_event: null, last_started_at: null, last_finished_at: null, last_result: null, last_error: null, last_apply: null };

// The re-entry guard every clock operation shares — trigger, apply and timer:
// one runs at a time. A trigger arriving while one is in flight is not
// restarted, and apply/timer answer 409 through handleUpdateClock, so the page
// never sees an idle clock while an operation is live. The promise is kept
// outside clockActivity so the snapshot stays plain JSON.
let clockInflight = null;
function runClockActivity(event, work) {
  if (clockInflight) return null;
  clockActivity.running = true;
  clockActivity.last_event = event;
  clockActivity.last_started_at = new Date().toISOString();
  clockInflight = Promise.resolve().then(work)
    .then((result) => { clockActivity.last_result = result; clockActivity.last_error = null; return result; })
    .catch((error) => { clockActivity.last_error = safeDetail(error.message); throw error; })
    .finally(() => { clockInflight = null; clockActivity.running = false; clockActivity.last_finished_at = new Date().toISOString(); });
  return clockInflight;
}

// Only constant command tables reach this (UPDATE_COMMANDS, timerCommand, the
// grok check-only command). Windows needs a shell for npm's .cmd shims; the
// module's own defaultExec makes the same choice.
function clockExec(command, args = [], { timeout = 60_000, shell = false } = {}) {
  return new Promise((resolve) => {
    const child = processScope.spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
      shell: shell || process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    supervise(child, { timeoutMs: timeout, stdoutLimit: 1_000_000, stderrLimit: 100_000, resolve });
  });
}

function clockRunUpdater(args) {
  return runNode(updaterScript, args, { timeoutMs: 600_000 }).then((result) => ({ code: result.code, output: `${result.stdout}${result.stderr}` }));
}

async function cliVersion(agent) {
  const result = await runCommand(agent === "antigravity" ? "agy" : agent, ["--version"], { timeoutMs: 15_000 });
  return result.code === 0 ? safeDetail(result.stdout || result.stderr) : null;
}

// npm (with a known prefix) and native self-updating binaries are the only
// installations MOMM will touch; everything else belongs to a package manager.
function cliIsManaged(agent) {
  return !["npm", "native"].includes(detectInstallation(agent).kind);
}

function createServerClock() {
  try { return createUpdateClock({ exec: clockExec, installedVersions: { skill: localSkillVersion() } }); }
  catch (error) { process.stderr.write(`Update clock unavailable: ${safeDetail(error.message)}\n`); return null; }
}

// The exec probes.mjs runs its vectors through, owned by processScope so a
// closing server kills a hung probe instead of leaving it behind. Same contract
// as the module's defaultExec — (command, args, { input, timeout, cwd, env }) ->
// { code, stdout, stderr, timedOut, error } — including its launcher rule (no
// cmd.exe shims) and the secret scrub of the inherited environment; stdin is
// piped because the codex and grok vectors feed the prompt that way.
function probeExec(command, args = [], { input = "", timeout = 120_000, cwd = process.cwd(), env: sourceEnv = process.env } = {}) {
  const env = { ...sourceEnv, NO_UPDATE_CHECK: "1", NO_COLOR: "1" };
  for (const key of Object.keys(env)) if (/(?:^|_)(?:API_?KEY|SECRET_?KEY|ACCESS_?TOKEN)(?:_|$)/.test(key.toUpperCase())) delete env[key];
  const launch = windowsLauncher(command, args, env);
  if (launch.error) return Promise.resolve({ code: -1, stdout: "", stderr: launch.error.message, error: launch.error, timedOut: false });
  return new Promise((resolve) => {
    let child;
    try { child = processScope.spawn(launch.command, launch.args, { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { resolve({ code: -1, stdout: "", stderr: safeDetail(error.message), error, timedOut: false }); return; }
    supervise(child, { timeoutMs: timeout, stdoutLimit: 16_000_000, stderrLimit: 1_000_000, resolve });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

// The production post-update probe (audit finding 5): after a CLI's official
// update command succeeds, probes.mjs sends that CLI one synthetic canary
// sentence and one synthetic 20-line diff — never project content — and the
// full result is appended to this project's .ensemble_reviews/probes.jsonl.
// The module reads `status` for its history note; the verdict, the tested
// version and both sub-results travel with it so the page can show them.
async function clockPostUpdateProbe(cli) {
  const result = await runProbes(cli, { exec: probeExec, tmpdir: os.tmpdir() });
  recordProbe(process.cwd(), result);
  return { status: result.verdict, verdict: result.verdict, cli_version: result.cli_version ?? null, containment: result.containment?.status ?? null, one_line_review: result.one_line_review?.status ?? null, detail: [result.containment?.detail, result.one_line_review?.detail].filter(Boolean).join(" / ").slice(0, 600) || null };
}

// One dependency table for every apply pass — the dashboard action and the
// event path alike — so a test can inject the child-process seams without
// changing which seams production uses.
const applyDeps = (deps = {}) => ({
  runUpdater: deps.runUpdater || clockRunUpdater,
  exec: deps.exec || clockExec,
  versionOf: deps.versionOf || cliVersion,
  postUpdateProbe: deps.postUpdateProbe || clockPostUpdateProbe,
  isManaged: deps.isManaged || cliIsManaged,
});

const PROBE_VERDICTS = new Set(["pass", "fail", "unavailable"]);
const NOT_VERIFIED = "updated, containment not verified";
// Every applied CLI row leaves here with the re-read version and a probe
// verdict of pass / fail / unavailable (a thrown probe reaches the module as
// status "error" and is shown as unavailable). Only `pass` is ready; anything
// else is "updated, containment not verified" and is never presented as ready.
function annotateApply(result) {
  const applied = (result?.applied || []).map((row) => {
    const name = String(row?.name || "");
    if (!name.startsWith("cli:")) return { ...row, verification: "applied through the signed updater", ready: null };
    const raw = row.probe?.status ?? row.probe?.verdict ?? null;
    const probe_verdict = PROBE_VERDICTS.has(raw) ? raw : "unavailable";
    const version = row.to || row.probe?.cli_version || null;
    const ready = probe_verdict === "pass";
    return { ...row, cli: name.slice(4), version, probe_verdict, ready, verification: ready ? `verified: ${version || "version unknown"} passed the containment probe` : NOT_VERIFIED };
  });
  return { ...result, applied };
}

const disabledApply = () => ({ applied: [], skipped: [{ name: "*", reason: "auto_update.enabled is false" }], failed: [], notices: [], skipped_reason: "auto_update_disabled" });

function recordApply(event, apply, enabled) {
  clockActivity.last_apply = {
    at: new Date().toISOString(), event, enabled,
    applied: apply.applied.length, skipped: apply.skipped.length, failed: apply.failed.length, skipped_reason: apply.skipped_reason ?? null,
    rows: apply.applied.map(({ name, cli, from, to, version, probe_verdict, verification, ready }) => ({ name, cli: cli ?? null, from: from ?? null, to: to ?? null, version: version ?? to ?? null, probe_verdict: probe_verdict ?? null, verification, ready })),
    failures: apply.failed.map((f) => ({ name: f.name, reason: f.reason })),
    note: enabled ? null : "automatic updates are off: checked only, nothing applied",
  };
  return apply;
}

// The apply pass behind the dashboard action and every event (audit finding
// 7): runs inside the caller's guarded activity, through the same wiring.
async function applyPass(clock, event, deps) {
  const apply = recordApply(event, annotateApply(await applyUpdates(clock, applyDeps(deps))), true);
  maintenanceCache = null; // installed versions may have changed
  return apply;
}

// A check event (setup.open, setup.check, manual) is a check AND, while
// automatic updates are on, the apply pass — the toggle's promise. Off: the
// check still runs, nothing is applied, and the recorded outcome says so.
async function checkThenApply(clock, event, deps = {}) {
  const result = await clock.trigger(event);
  const enabled = clock.settings().auto_update?.enabled === true;
  const apply = enabled ? await applyPass(clock, event, deps) : recordApply(event, disabledApply(), false);
  return { ...result, apply };
}

// Fire-and-forget entry (server start, the maintenance "check everything"
// click): never rejects, and never restarts an operation already in flight.
function triggerClock(clock, event, deps = {}) {
  if (!clock) return Promise.resolve(null);
  const run = runClockActivity(event, () => checkThenApply(clock, event, deps));
  return run ? run.catch(() => null) : Promise.resolve(null);
}

function clockTimer(platform = platformKey()) {
  const command = timerCommand(platform, process.execPath, updateClockScript);
  return { platform: command.platform, install: command.install, remove: command.remove, plist_path: command.plist_path || null };
}

function clockSnapshot(clock) {
  return { ...clock.status(), timer: clockTimer(), activity: clockActivity };
}

async function handleUpdateClock(body, clock, deps = {}) {
  if (!clock) return { status: 503, value: { error: "The update clock is not running in this Setup Center." } };
  const op = String(body?.op || "");
  const busy = () => ({ status: 409, value: { error: `The update clock is busy (${clockActivity.last_event} started at ${clockActivity.last_started_at}). Wait for it to finish, then try again.`, ...clockSnapshot(clock) } });
  if (op === "set") {
    const patch = body.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { status: 400, value: { error: "patch must be an object with auto_update and/or clock keys" } };
    const unknown = Object.keys(patch).filter((key) => !["auto_update", "clock"].includes(key));
    if (unknown.length) return { status: 400, value: { error: `Unknown settings key(s): ${unknown.join(", ")}` } };
    try { writeSettings(deps.home, patch); } catch (error) { return { status: 400, value: { error: safeDetail(error.message) } }; }
    return { status: 200, value: clockSnapshot(clock) };
  }
  if (op === "trigger") {
    const event = String(body.event || "");
    if (!["setup.check", "manual"].includes(event)) return { status: 400, value: { error: "Only setup.check or manual can be triggered from the Setup Center" } };
    const run = runClockActivity(event, () => checkThenApply(clock, event, deps));
    if (!run) return busy();
    const result = await run.catch(() => null); // the failure is already in activity.last_error
    return { status: 200, value: { result, ...clockSnapshot(clock) } };
  }
  if (op === "apply") {
    // The guard comes before the disabled short-cut: a page must never be told
    // "nothing to do" while a check or an earlier apply is still running.
    if (clockInflight) return busy();
    // Never call the applier while disabled: the no-op answer below is the
    // module's own shape, so the page renders both paths identically.
    if (!clock.settings().auto_update.enabled) return { status: 200, value: { ...disabledApply(), ...clockSnapshot(clock) } };
    // The same wiring as the event path, containment probe included: each
    // applied CLI row carries its re-read version and probe verdict.
    const run = runClockActivity("apply", () => applyPass(clock, "apply", deps));
    if (!run) return busy();
    const result = await run;
    return { status: 200, value: { ...result, ...clockSnapshot(clock) } };
  }
  if (op === "timer") {
    const action = String(body.action || "");
    if (!["install", "remove"].includes(action)) return { status: 400, value: { error: "timer action must be install or remove" } };
    const command = clockTimer()[action];
    // Same exact-command pattern as /api/action: the page must echo the command
    // it showed, every time, and the confirm flag must be the literal true. An
    // omitted expected_command is a missing confirmation, not an implicit one;
    // otherwise a stale page could register a command it never displayed.
    if (body.expected_command !== command || body.confirm !== true) return { status: 409, value: { error: "Confirm the exact command first.", command } };
    if (clockInflight) return busy();
    const install = action === "install" ? installTimer : removeTimer;
    const run = runClockActivity(`timer.${action}`, () => install({ platform: platformKey(), nodePath: process.execPath, scriptPath: updateClockScript, exec: deps.exec || clockExec, confirm: true }));
    if (!run) return busy();
    const result = await run;
    return { status: result.done ? 200 : 500, value: { ...result, ...clockSnapshot(clock) } };
  }
  return { status: 400, value: { error: "Unsupported update-clock op" } };
}

// --- Modalities panel (1.16 E7) -------------------------------------------------
// GET /api/capabilities serves the EFFECTIVE matrix (baseline plus this machine's
// valid overlay, capabilities.mjs) with every blocker's clearing action, the
// per-route generation disclosure, the pipelines derived from the matrix and the
// last modality probe per route. POST runs the input probes (synthetic PNG/PDF/WAV,
// processScope-owned exec) or, only with `consent: true` AND the exact disclosure
// echoed back, the generation probe — which skips every blocked cell exactly as
// the CLI does — or answers a pure plan(). The registry is loaded lazily so a
// missing module degrades to 503, never a crash.
let capabilitiesRegistry = null;
async function loadCapabilitiesRegistry() {
  if (capabilitiesRegistry) return capabilitiesRegistry;
  try {
    const module = await import("./capabilities.mjs");
    const { plan } = await import("./modality.mjs");
    capabilitiesRegistry = { module, plan, error: null };
  } catch (error) {
    return { module: null, plan: null, error: error?.code === "ERR_MODULE_NOT_FOUND" ? "momm/scripts/capabilities.mjs or modality.mjs is not present" : safeDetail(error.message) };
  }
  return capabilitiesRegistry;
}
// Installed semver per route binds the overlay (an entry probed on another version
// reads as `reprobe`); read once per ten minutes through processScope-owned children.
let installedVersionsCache = null;
let installedVersionsInFlight = null;
async function installedVersionsForRegistry() {
  if (installedVersionsCache && Date.now() - installedVersionsCache.at < 10 * 60_000) return installedVersionsCache.value;
  // A cold cache is filled once: concurrent snapshot and plan requests share the scan
  // instead of each spawning every CLI.
  installedVersionsInFlight ??= (async () => {
    const value = {};
    // The readiness report resolves every launcher the way the provider cards do (npm
    // shims included); a bare `<cli> --version` is only the fallback for a route it missed.
    try { for (const route of (await readiness("other")).routes ?? []) { const version = parseVersion(route?.version); if (route?.agent && version) value[route.agent] = version; } } catch { /* fall back per route */ }
    for (const agent of Object.keys(providers)) if (!value[agent]) { const version = parseVersion(await cliVersion(agent)); if (version) value[agent] = version; }
    installedVersionsCache = { at: Date.now(), value };
    return value;
  })().finally(() => { installedVersionsInFlight = null; });
  return installedVersionsInFlight;
}
const CAPABILITY_INPUTS = Object.freeze(["image", "pdf", "audio", "video", "speech"]);
const CAPABILITY_OUTPUTS = Object.freeze(["image_gen", "video_gen", "speech", "code_exec", "web"]);
async function effectiveFor(registry, deps = {}) {
  const installedVersions = deps.installedVersions ?? await installedVersionsForRegistry();
  return registry.module.effective({ home: deps.home ?? os.homedir(), installedVersions });
}
// Which routes can critique each attached modality NOW (routable cell AND the
// adapter binds it, as the provider card declares) and which can generate — derived
// from the matrix on every call, never asserted.
function pipelinesFrom(matrix) {
  const routes = Object.keys(matrix.routes ?? {});
  const routable = (cell) => Boolean(cell) && ["verified", "documented"].includes(cell.level) && !cell.blocker;
  const critique = (modality) => ({ routes: routes.filter((r) => routable(matrix.routes[r].input?.[modality]) && (providers[r]?.modalities ?? []).includes(modality)), blocked: routes.filter((r) => matrix.routes[r].input?.[modality]?.blocker).map((r) => ({ route: r, blocker: matrix.routes[r].input[modality].blocker })) });
  const generate = (cell) => ({ routes: routes.filter((r) => routable(matrix.routes[r].output?.[cell])), blocked: routes.filter((r) => matrix.routes[r].output?.[cell]?.blocker).map((r) => ({ route: r, blocker: matrix.routes[r].output[cell].blocker })) });
  return { image_critique: critique("image"), pdf_critique: critique("pdf"), audio_critique: critique("audio"), video_critique: critique("video"), image_generation: generate("image_gen"), video_generation: generate("video_gen") };
}
async function capabilitiesSnapshot(deps = {}) {
  const registry = deps.registry ?? await loadCapabilitiesRegistry();
  if (!registry.module) return { status: 503, value: { error: `The capability registry is unavailable: ${registry.error}` } };
  const matrix = await effectiveFor(registry, deps);
  const clearing = (blocker, route) => registry.module.clearingAction(blocker, route);
  const blockers = [];
  const generation = {};
  for (const [route, entry] of Object.entries(matrix.routes ?? {})) {
    for (const direction of ["input", "output"]) for (const [modality, cell] of Object.entries(entry?.[direction] ?? {})) {
      if (cell.blocker) blockers.push({ route, direction, modality, level: cell.level, blocker: cell.blocker, reason: cell.reason ?? null, source: cell.source ?? "baseline", expires_at: cell.overlay?.expires_at ?? null, clearing_action: clearing(cell.blocker, route) });
    }
    const cells = generativeCells(route, entry, { clearing: (b) => clearing(b, route) });
    generation[route] = { cells, disclosure: routeDisclosure(cells) || null, open: cells.filter((c) => !c.blocked).length };
  }
  const running = [...jobs.values()].filter((job) => job.kind === "modality" && job.status === "running").map((job) => job.provider);
  let last = {};
  try { last = latestModalityProbes(deps.cwd ?? process.cwd()); } catch (error) { last = { error: safeDetail(error.message) }; }
  return { status: 200, value: { ...matrix, levels: ["verified", "documented", "model-only", "no"], input_modalities: CAPABILITY_INPUTS, output_modalities: CAPABILITY_OUTPUTS, blockers, generation, pipelines: pipelinesFrom(matrix), probes: { running, last }, level_actions: { "model-only": registry.module.levelAction("model-only"), no: registry.module.levelAction("no") } } };
}
// The job map is bounded, but only FINISHED jobs may be evicted: a running job is the
// route's mutex (the "already running" checks look in this map) and the id the page polls.
// Returns false when every job is still running, so the caller refuses the new one (429).
function admitJob(job) {
  for (const [id, entry] of jobs) { if (jobs.size < maxJobs) break; if (entry.status !== "running") jobs.delete(id); }
  if (jobs.size >= maxJobs) return false;
  jobs.set(job.id, job);
  return true;
}
const jobsFull = () => ({ error: `Every one of the ${maxJobs} job slots is still running; wait for one to finish before starting another.` });
// One modality probe per route at a time, as a job the page polls on /api/job/<id>.
// Every disclosure the probe prints is kept on the job so the page can show what was sent.
function startModalityProbeJob(cli, { inputs, generate, registry, exec = probeExec, home, cwd = process.cwd() }) {
  const id = crypto.randomUUID();
  const job = { id, kind: "modality", provider: cli, inputs, generate, status: "running", started_at: new Date().toISOString(), disclosed: [] };
  if (!admitJob(job)) return null;
  runModalityProbes(cli, { registry: registry.module, exec, tmpdir: os.tmpdir(), ...(home ? { home } : {}), consent: generate === true, inputs: inputs === true, disclose: (text) => job.disclosed.push(text) })
    .then((result) => {
      try { recordProbe(cwd, result); } catch (error) { job.record_error = safeDetail(error.message); }
      // The probe just read this CLI's version; keep the ten-minute cache in step so the
      // overlay entry it wrote does not read as `reprobe` against a stale installed version.
      const probedVersion = parseVersion(result.cli_version);
      if (probedVersion && installedVersionsCache) installedVersionsCache.value[cli] = probedVersion;
      job.status = result.verdict === "pass" ? "success" : "failed";
      job.completed_at = new Date().toISOString();
      job.result = { verdict: result.verdict, cli_version: result.cli_version, summary: result.summary, reason: result.reason ?? null, detail: result.detail ?? null, cells: result.cells.map(({ direction, modality, status, reason, blocker, clearing_action, level_before, seconds, harvested, overlay_written, overlay_error }) => ({ direction, modality, status, reason, blocker: blocker ?? null, clearing_action: clearing_action ?? null, level_before, seconds: seconds ?? null, harvested: (harvested ?? []).map((f) => ({ sha256: f.sha256, bytes: f.bytes })), overlay_written: overlay_written ?? false, overlay_error: overlay_error ?? null })) };
    })
    .catch((error) => { job.status = "failed"; job.completed_at = new Date().toISOString(); job.result = { verdict: "error", detail: safeDetail(error.message), cells: [] }; });
  return job;
}
async function handleCapabilities(body, deps = {}) {
  const registry = deps.registry ?? await loadCapabilitiesRegistry();
  if (!registry.module) return { status: 503, value: { error: `The capability registry is unavailable: ${registry.error}` } };
  const op = String(body?.op || "");
  if (op === "plan") {
    if (!body.need || typeof body.need !== "object" || Array.isArray(body.need)) return { status: 400, value: { error: "need must be an object: { input: [...], output: [...] } or { chain: [...] }" } };
    try {
      const matrix = await effectiveFor(registry, deps);
      const planned = registry.plan(matrix, body.need, typeof body.prompt === "string" && body.prompt.trim() ? { prompt: body.prompt } : {});
      return { status: 200, value: { plan: planned } };
    } catch (error) { return { status: 400, value: { error: safeDetail(error.message) } }; }
  }
  if (op === "probe") {
    const cli = String(body.cli || "").toLowerCase();
    // Own properties only: `providers["constructor"]` is truthy but is not a route.
    if (!Object.hasOwn(providers, cli)) return { status: 400, value: { error: "Unknown route" } };
    const inputs = body.inputs === true, generate = body.generate === true;
    if (!inputs && !generate) return { status: 400, value: { error: "probe needs inputs: true and/or generate: true" } };
    if (generate) {
      // Generation spends the provider's quota: it needs consent AND the exact disclosure
      // the page showed (a stale page must not send a request it never disclosed). Blocked
      // cells are listed with their clearing action and never sent; if every generative
      // cell is blocked there is nothing to consent to.
      const matrix = await effectiveFor(registry, deps);
      const cells = generativeCells(cli, matrix.routes?.[cli], { clearing: (b) => registry.module.clearingAction(b, cli) });
      const open = cells.filter((c) => !c.blocked);
      if (!open.length) return { status: 409, value: { error: cells.length ? `Every generative cell of ${providers[cli].label} is blocked: ${cells.map((c) => `${c.cell} (${c.blocker}: ${c.clearing_action})`).join("; ")}` : `${providers[cli].label} has no generative cell at documented or verified.`, cells } };
      const disclosure = routeDisclosure(cells);
      if (body.consent !== true || body.disclosure !== disclosure) return { status: 409, value: { error: "Consent required: read the disclosure and send it back exactly, with consent: true.", disclosure, cells } };
    }
    if ([...jobs.values()].some((job) => job.kind === "modality" && job.provider === cli && job.status === "running")) return { status: 409, value: { error: `A modality probe for ${providers[cli].label} is already running.` } };
    const job = startModalityProbeJob(cli, { inputs, generate, registry, exec: deps.exec, home: deps.home, cwd: deps.cwd });
    return job ? { status: 202, value: job } : { status: 429, value: jobsFull() };
  }
  return { status: 400, value: { error: "Unsupported capabilities op" } };
}

// --- Ledger auto-regeneration (1.16 E3) -----------------------------------------
// Watches the two append-only telemetry files while the server runs and
// rebuilds the private ledger page. A burst of appends costs one rebuild
// (debounce), and rebuilds are at least 5 s apart so a runaway writer cannot
// make the server spin. Only the two named files count: the rebuild itself
// writes ledger.html into the same directory and must not retrigger.
const LEDGER_FILES = new Set(["review-log.jsonl", "dispositions.jsonl"]);
const LEDGER_MIN_GAP_MS = 5000;

function createLedgerWatcher({ dir, run, debounceMs = 1500, minGapMs = LEDGER_MIN_GAP_MS, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, watch = fs.watch, exists = fs.existsSync, stat = fs.statSync } = {}) {
  const state = { watching: false, running: false, pending: false, regenerations: 0, reattachments: 0, last_regenerated_at: null, last_exit_code: null, last_error: null };
  let debounce = null, retry = null, watcher = null, lastRunAt = -Infinity, stopped = true, identity = null;
  // dev:ino of the directory the handle was attached to. fs.watch follows the
  // inode, not the path: a directory renamed away and recreated (or removed and
  // restored) keeps the old handle alive and silent, so identity is compared
  // whenever a rename event names anything other than a telemetry file.
  const identityOf = () => { try { const entry = stat(dir); return `${entry.dev}:${entry.ino}`; } catch { return null; } };
  let inflight = null, generation = 0;
  function regenerate() {
    // A scheduled rebuild may beat an on-demand gap timer. Both callers must
    // await the actual result, never read the previous run's success/failure.
    if (inflight) { state.pending = true; return inflight; }
    // Publish the promise before run() can reenter the watcher.
    inflight = Promise.resolve().then(regenerateNow).finally(() => { inflight = null; });
    return inflight;
  }
  async function regenerateNow() {
    generation++;
    state.running = true;
    lastRunAt = now();
    try {
      const result = await run();
      state.last_exit_code = result?.code ?? null;
      state.last_error = result && result.code !== 0 ? (safeDetail(result.stderr) || `exit ${result.code}`) : null;
      state.last_regenerated_at = new Date().toISOString();
      state.regenerations += 1;
    } catch (error) { state.last_error = safeDetail(error.message); }
    finally {
      state.running = false;
      // A notification that arrived mid-run is honored only while the watcher
      // is still live: after stop() nothing may schedule again.
      if (state.pending) { state.pending = false; if (!stopped) schedule(); }
    }
  }
  function schedule() {
    if (stopped) return;
    if (debounce) clearTimer(debounce);
    const wait = Math.max(debounceMs, lastRunAt + minGapMs - now());
    debounce = setTimer(() => { debounce = null; return regenerate(); }, wait);
    debounce?.unref?.();
  }
  function notify(filename, event) {
    if (LEDGER_FILES.has(String(filename ?? ""))) { schedule(); return; }
    // A rename of the directory itself arrives with its own basename (Linux
    // IN_MOVE_SELF / IN_DELETE_SELF) or no name at all; any other rename is
    // checked the same way, since the stat is cheap and the miss is permanent.
    if (event === "rename" && !stopped && watcher && identityOf() !== identity) reattach();
  }
  // `catchUp` is set when this attach follows a gap (the directory was absent,
  // or the previous watcher errored): telemetry written meanwhile had no watcher
  // to see it, so one rebuild is scheduled if any telemetry file exists.
  function start({ catchUp = false } = {}) {
    stopped = false;
    try {
      watcher = watch(dir, { persistent: false }, (event, filename) => notify(filename, event));
      watcher.on?.("error", () => { state.watching = false; watcher = null; retryLater(); });
      identity = identityOf();
      state.watching = true;
      if (catchUp && [...LEDGER_FILES].some((name) => { try { return exists(path.join(dir, name)); } catch { return false; } })) schedule();
    } catch { state.watching = false; retryLater(); } // directory absent until the first review
  }
  // The handle points at a directory that is no longer at `dir`: close it and
  // attach by path again. A replacement directory attaches at once and catches
  // up on the telemetry it already holds; an absent one falls back to the
  // 30 s retry, with `watching` false in the meantime rather than a dead
  // handle reported as live.
  function reattach() {
    if (stopped) return;
    try { watcher?.close?.(); } catch {}
    watcher = null;
    state.watching = false;
    state.reattachments += 1;
    start({ catchUp: true });
  }
  function retryLater() {
    if (retry || stopped) return;
    retry = setTimer(() => { retry = null; start({ catchUp: true }); }, 30_000);
    retry?.unref?.();
  }
  function stop() {
    stopped = true;
    if (debounce) clearTimer(debounce);
    if (retry) clearTimer(retry);
    debounce = retry = null;
    state.pending = false;
    try { watcher?.close?.(); } catch {}
    watcher = null;
    state.watching = false;
  }
  const status = () => ({ ...state });
  // On-demand rebuild for GET /ledger. Same-generation readers share work and
  // the scheduled path's minimum gap. A reader arriving after a run began needs
  // a newer generation; it waits for the old run and any remaining gap first.
  // Independent of start()/stop(): the request wants a page, not a subscription.
  async function rebuild() {
    // A run already reading before this request may have an older snapshot.
    // Require a run started after this request; concurrent readers share it.
    const requiredGeneration = generation + 1;
    if (inflight) await inflight;
    if (generation >= requiredGeneration) return status();
    const wait = Math.max(0, lastRunAt + minGapMs - now());
    if (wait > 0) await new Promise(resolve => { const timer = setTimer(resolve, wait); timer?.unref?.(); });
    if (inflight) await inflight;
    if (generation < requiredGeneration) await regenerate();
    return status();
  }
  return { start, stop, notify, rebuild, status };
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

// 4 KiB covers every action body; only the guidance editor (eight blocks of
// up to 2000 characters, multi-byte allowed) is granted a larger, still
// bounded, budget by its route.
function readBody(request, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0, failed = false;
    request.on("data", (chunk) => {
      if (failed) return;
      const buffer = Buffer.from(chunk); bytes += buffer.length;
      if (bytes > limit) { failed=true; chunks.length=0; reject(new Error("Request body too large")); request.destroy(); return; }
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

// Static assets: an allowlist of path -> [file, type]. momm-theme.css is the
// shared design system (tokens, motion, topbar, chips, tables) that index.html
// links before styles.css and that ledger.mjs inlines into the ledger page.
const STATIC_ASSETS = Object.freeze({
  "/": ["index.html", "text/html; charset=utf-8"],
  "/momm-theme.css": ["momm-theme.css", "text/css; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
});

function serveAsset(response, file, contentType) {
  try {
    const bytes = fs.readFileSync(path.join(assetDir, file));
    response.writeHead(200, securityHeaders(contentType));
    response.end(bytes);
  } catch {
    sendJson(response, 404, { error: "Asset not found" });
  }
}

// --- Setup Center <-> ledger cross-links (1.16) ------------------------------
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// file:// URL of this project's ledger for /api/status, or null until one exists.
function ledgerFileUrl(cwd = process.cwd()) {
  const file = path.join(cwd, ".ensemble_reviews", "ledger.html");
  try { return fs.existsSync(file) ? pathToFileURL(file).href : null; } catch { return null; }
}

// The ledger carries one inline <style> (the shared theme plus its own rules)
// and one inline <script> (theme toggle, read-aloud, link rewrite). Serving it
// from this origin keeps the dashboard CSP strict by allowing exactly those
// blocks, by hash, and nothing else inline.
function inlineHashes(html, tag) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return Array.from(html.matchAll(pattern), (match) => `'sha256-${crypto.createHash("sha256").update(match[1], "utf8").digest("base64")}'`);
}
function ledgerHeaders(html) {
  const styles = inlineHashes(html, "style"), scripts = inlineHashes(html, "script");
  return {
    ...securityHeaders("text/html; charset=utf-8"),
    "Content-Security-Policy": `default-src 'none'; img-src data:; style-src ${styles.join(" ") || "'none'"}; script-src ${scripts.join(" ") || "'none'"}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
}
const ledgerMissingPage = (cwd) => `<!doctype html><meta charset="utf-8"><title>No ledger yet</title><h1>No ledger yet</h1><p>There is no <code>.ensemble_reviews</code> in <code>${escapeHtml(cwd)}</code>. Run a momm review from that directory first; the ledger is built from its telemetry.</p><p><a href="/">Back to the Setup Center</a></p>`;

// GET /ledger — the private ledger on this origin, so the dashboard's pill needs
// no file:// hop. Revalidate on every request: source bytes can change without
// touching telemetry. Use the watcher's rebuild (the same runNode(ledger.mjs) path,
// the same minimum gap); 404 with a short page when the project has no
// .ensemble_reviews at all. Returns what it did, for the self-test.
async function serveLedger(response, { cwd = process.cwd(), rebuild = () => (ledgerWatcher ? ledgerWatcher.rebuild() : runNode(ledgerScript, [], { timeoutMs: 60_000 })), fsx = fs } = {}) {
  const dir = path.join(cwd, ".ensemble_reviews"), file = path.join(dir, "ledger.html");
  const send = (status, headers, body) => { response.writeHead(status, headers); response.end(body); };
  if (!fsx.existsSync(dir)) { send(404, securityHeaders("text/html; charset=utf-8"), ledgerMissingPage(cwd)); return { status: 404, rebuilt: false }; }
  const stale = true;
  let rebuildError = null;
  try {
    // Readers arriving before a queued rebuild starts may share it. A reader
    // arriving after its input capture began needs the next generation instead;
    // joining any in-flight HTTP promise would bypass the watcher's barrier.
    const pending = serveLedger.pending ??= new Map();
    let entry = pending.get(file);
    if (!entry || entry.started) {
      const previous = entry;
      entry = { started: false, promise: null };
      const queued = entry;
      queued.promise = Promise.resolve(previous?.promise).catch(() => {}).then(() => {
        queued.started = true;
        return rebuild();
      }).finally(() => { if (pending.get(file) === queued) pending.delete(file); });
      pending.set(file, queued);
    }
    const result = await entry.promise;
    if (result?.last_error || (result?.code != null && result.code !== 0) || (result?.last_exit_code != null && result.last_exit_code !== 0)) rebuildError = "Ledger rebuild failed.";
  } catch { rebuildError = "Ledger rebuild failed."; }
  if (rebuildError) {
    // Never return the old certificate-looking page after a failed refresh.
    send(503, securityHeaders("text/html; charset=utf-8"), '<!doctype html><meta charset="utf-8"><title>Ledger unavailable</title><h1>Ledger refresh failed</h1><p>Current evidence could not be validated. Any saved ledger is a historical snapshot, not a current completion result. Restore damaged evidence or rebuild locally, then retry.</p><p><a href="/">Back to the Setup Center</a></p>');
    return { status: 503, rebuilt: true };
  }
  let html;
  try { html = fsx.readFileSync(file, "utf8"); }
  catch {
    send(404, securityHeaders("text/html; charset=utf-8"), `<!doctype html><meta charset="utf-8"><title>Ledger not built</title><h1>The ledger could not be built</h1><p>${escapeHtml(rebuildError || "ledger.mjs wrote no page")}</p><p><a href="/">Back to the Setup Center</a></p>`);
    return { status: 404, rebuilt: stale };
  }
  send(200, ledgerHeaders(html), html);
  return { status: 200, rebuilt: stale };
}

// Ledger -> Setup Center: while the server runs, .ensemble_reviews/setup-center.json
// names its loopback URL and pid (mode 0600). ledger.mjs reads it at build time
// and, when that pid is alive, links straight back here; a file left by a crash
// fails the pid check there and is overwritten by the next start. Written only
// where .ensemble_reviews already exists — the ledger lives nowhere else — and
// removed on server close, process exit and the terminating signals. remove()
// deletes only a file that names this pid, never another Setup Center's.
function createSetupCenterPointer({ cwd = process.cwd(), pid = process.pid, proc = process, fsx = fs } = {}) {
  const dir = path.join(cwd, ".ensemble_reviews"), file = path.join(dir, "setup-center.json");
  let written = false;
  const remove = () => {
    if (!written) return false;
    written = false;
    try { if (JSON.parse(fsx.readFileSync(file, "utf8")).pid !== pid) return false; } catch { return false; }
    try { fsx.rmSync(file, { force: true }); return true; } catch { return false; }
  };
  const write = (url) => {
    if (!fsx.existsSync(dir)) return false;
    try {
      fsx.rmSync(file, { force: true }); // create fresh so the 0600 mode applies (ignored when overwriting)
      fsx.writeFileSync(file, `${JSON.stringify({ url, pid, started_at: new Date().toISOString() })}\n`, { mode: 0o600 });
    } catch { return false; }
    written = true;
    proc.once?.("exit", remove);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) proc.once?.(signal, () => { remove(); proc.exit?.(0); });
    return true;
  };
  return { write, remove, file };
}

function createServer() {
  // Navigation cannot send a custom header. Exchange an authenticated request
  // for a short-lived, one-use ledger ticket, never a reusable session in a URL.
  const ledgerTickets = new Map();
  return http.createServer(async (request, response) => {
    if (!isLoopback(request.socket.remoteAddress)) return sendJson(response, 403, { error: "Loopback access only" });
    if (!isAllowedHost(request)) return sendJson(response, 403, { error: "Invalid Host header" });
    let requestUrl;
    try { requestUrl = new URL(request.url || "/", "http://127.0.0.1"); }
    catch { return sendJson(response, 400, { error: "Invalid request URL" }); }
    try {
      if (request.method === "GET" && Object.hasOwn(STATIC_ASSETS, requestUrl.pathname)) return serveAsset(response, ...STATIC_ASSETS[requestUrl.pathname]);
      if (requestUrl.pathname.startsWith("/api/") && !authorized(request)) return sendJson(response, 403, { error: "Use the private Setup Center launch link from your terminal." });
      if (request.method === "GET" && requestUrl.pathname === "/ledger") {
        if (!authorized(request)) {
          const ticket = requestUrl.searchParams.get("ticket"), expires = ledgerTickets.get(ticket);
          ledgerTickets.delete(ticket);
          if (!expires || expires <= Date.now()) return sendJson(response, 403, { error: "Open the private ledger from your authorized Setup Center." });
        }
        return serveLedger(response);
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/session") {
        return sendJson(response, 200, { token: sessionToken, platform: platformKey(), providers });
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/status") {
        if (!authorized(request)) return sendJson(response, 403, {error:'Invalid local session'});
        const governor = String(requestUrl.searchParams.get("governor") || "codex").toLowerCase();
        if (!governors.has(governor)) return sendJson(response, 400, { error: "Unsupported governor" });
        return sendJson(response, 200, { ...await readiness(governor), ledger: ledgerWatcher ? ledgerWatcher.status() : null, ledger_url: ledgerFileUrl() });
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/guidance") {
        if (!authorized(request)) return sendJson(response, 403, { error: "Invalid local session" });
        return sendJson(response, 200, guidanceSnapshot());
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/usage") {
        if (!authorized(request)) return sendJson(response, 403, { error: "Invalid local session" });
        return sendJson(response, 200, usageReport());
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/update-clock") {
        if (!authorized(request)) return sendJson(response, 403, { error: "Invalid local session" });
        return updateClock ? sendJson(response, 200, clockSnapshot(updateClock)) : sendJson(response, 503, { error: "The update clock is not running in this Setup Center." });
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/capabilities") {
        if (!authorized(request)) return sendJson(response, 403, { error: "Invalid local session" });
        const snapshot = await capabilitiesSnapshot();
        return sendJson(response, snapshot.status, snapshot.value);
      }
      if (request.method === "GET" && requestUrl.pathname.startsWith("/api/job/")) {
        const job = jobs.get(requestUrl.pathname.slice("/api/job/".length));
        return job ? sendJson(response, 200, job) : sendJson(response, 404, { error: "Job not found" });
      }
      if (request.method === "POST") {
        if (!authorized(request)) return sendJson(response, 403, { error: "Invalid local session" });
        if (requestUrl.pathname === "/api/ledger-ticket") {
          const now = Date.now();
          for (const [ticket, expires] of ledgerTickets) if (expires <= now) ledgerTickets.delete(ticket);
          while (ledgerTickets.size >= 32) ledgerTickets.delete(ledgerTickets.keys().next().value);
          const ticket = crypto.randomBytes(24).toString("hex");
          ledgerTickets.set(ticket, now + 60_000);
          return sendJson(response, 200, { url: `/ledger?ticket=${ticket}` });
        }
        const body = await readBody(request, requestUrl.pathname === "/api/guidance" ? GUIDANCE_BODY_LIMIT : undefined);
        if (requestUrl.pathname === "/api/guidance") {
          const saved = saveGuidance(body);
          return sendJson(response, saved.status, saved.value);
        }
        if (requestUrl.pathname === "/api/update-clock") {
          if (!updateClock) return sendJson(response, 503, { error: "The update clock is not running in this Setup Center." });
          const handled = await handleUpdateClock(body, updateClock);
          return sendJson(response, handled.status, handled.value);
        }
        if (requestUrl.pathname === "/api/capabilities") {
          const handled = await handleCapabilities(body);
          return sendJson(response, handled.status, handled.value);
        }
        if (requestUrl.pathname === "/api/action") {
          const provider = String(body.provider || "").toLowerCase();
          const action = String(body.action || "").toLowerCase();
          const command = actionCommand(provider, action);
          if (!command) return sendJson(response, 400, { error: "Unsupported provider action" });
          if ((provider !== 'skills' && ['update','install'].includes(action) || body.expected_command) && body.expected_command !== command) return sendJson(response, 409, {error:'Confirm the exact command first. Refresh versions if the installation changed.'});
          if (provider === "skills" && action === "update") {
            const bootstrap = await bootstrapStatus();
            if (bootstrap.status !== 'ready_to_verify' || bootstrap.installation?.route !== 'updater_preview') { maintenanceCache=null; return sendJson(response, 409, { error: 'Update prerequisites or installation receipt need attention. Use the bootstrap guide; no update was launched.', guide: 'https://marroccofella.github.io/skills/momm/releases/bootstrap.html', update_readiness: bootstrap }); }
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
          const value = await maintenanceReport(governor);
          // Installed versions feed the clock's "update available" column; the
          // explicit "Check everything" click is the setup.check event. Neither
          // is awaited: a slow registry must not delay the maintenance answer.
          if (updateClock) {
            const rows = Array.isArray(value?.cli_updates) ? value.cli_updates : [];
            for (const item of rows) if (item && typeof item === "object" && item.agent && item.current) updateClock.setInstalled(item.agent, item.current);
            if (body.force === true) triggerClock(updateClock, "setup.check");
          }
          return sendJson(response, 200, value);
        }
        if (requestUrl.pathname === "/api/test") {
          const provider = String(body.provider || "").toLowerCase();
          const governor = String(body.governor || "codex").toLowerCase();
          if (!Object.hasOwn(providers, provider) || !governors.has(governor) || provider === governor) {
            return sendJson(response, 400, { error: "Unsupported reviewer/governor pairing" });
          }
          const job = startConnectivityJob(provider, governor);
          return job ? sendJson(response, 202, job) : sendJson(response, 429, jobsFull());
        }
        if (requestUrl.pathname === "/api/shutdown") {
          sendJson(response, 202, { closing: true });
          ledgerWatcher?.stop();
          setupPointer?.remove?.();
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
// What a card may list for --attach is MODALITY_SUPPORT (the baseline projection)
// restricted to ADAPTER_MEDIA (what invokeReviewer binds to argv).
function readDispatcherModalities() {
  try {
    const source = fs.readFileSync(dispatcherScript, "utf8");
    const support = source.match(/const MODALITY_SUPPORT = (\{[\s\S]*?\n\});/);
    const adapter = source.match(/const ADAPTER_MEDIA = (\{[\s\S]*?\n\});/);
    if (!support || !adapter) return null;
    const supportTable = new Function(`return ${support[1]};`)(), adapterTable = new Function(`return ${adapter[1]};`)();
    return Object.fromEntries(Object.keys(supportTable).map((agent) => [agent, ["text", ...(adapterTable[agent] ?? [])].filter((m) => m in supportTable[agent])]));
  } catch { return null; }
}

// A crash in the regression suite is reported as `dashboard_regression_threw:
// true` (an honest statement) and summarizeChecks treats every `*_threw: true`
// flag as a failure, so the JSON never shows a crash as "threw: false".
function recordRegressionThrow(checks, error) {
  checks.dashboard_regression_threw = true;
  process.stderr.write(`dashboard regression: ${error?.stack || error?.message || error}\n`);
  return checks;
}

function summarizeChecks(tests) {
  const failing = Object.entries(tests).filter(([name, value]) => name.endsWith("_threw") ? value !== false : value !== true).map(([name]) => name);
  return { passed: failing.length === 0, failing };
}

// 1.16 dashboard regression suite: temp project + temp home, injected fakes,
// no network, no child processes. Each check is a boolean so a failure names
// itself in the --self-test output.
async function dashboardRegression() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "momm-setup-regression-"));
  const checks = {};
  const fixture = (name) => {
    const cwd = path.join(root, name, "proj"), home = path.join(root, name, "home");
    fs.mkdirSync(cwd, { recursive: true }); fs.mkdirSync(home, { recursive: true });
    return { cwd, home };
  };
  const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  try {
    // Guidance: round-trip byte-exact, trusted on save, stale write and over-budget refused.
    const g = fixture("guidance");
    const guidance = { governor: "Governor: prefer\tsmall diffs\nand quote lines — ünïcödé 😀", reviewers: { "*": "STAR block  with  spacing ", codex: "  codex block\nline two" } };
    const saved = saveGuidance({ expected_sha256: null, guidance }, g);
    const onDiskBytes = fs.readFileSync(projectGuidanceFiles(g.cwd).guidance);
    const expectedBytes = Buffer.from(`${JSON.stringify(guidance, null, 2)}\n`, "utf8");
    // Buffers, not parse-then-stringify: whitespace, the trailing newline and
    // raw-vs-escaped non-ASCII all count. The compact control proves the
    // comparison is able to fail.
    checks.guidance_round_trip_byte_exact = saved.status === 200
      && onDiskBytes.equals(expectedBytes)
      && !onDiskBytes.equals(Buffer.from(JSON.stringify(guidance), "utf8"))
      && onDiskBytes.toString("utf8").includes("😀")
      && JSON.parse(onDiskBytes.toString("utf8")).governor === guidance.governor
      && JSON.stringify(saved.value.project) === JSON.stringify(guidance)
      && saved.value.trusted === true
      && saved.value.effective.codex.text === `${guidance.reviewers["*"]}\n\n${guidance.reviewers.codex}`
      && saved.value.effective.grok.text === guidance.reviewers["*"]
      && saved.value.governor.text === guidance.governor
      && /^[0-9a-f]{64}$/.test(saved.value.project_sha256);
    const bytesBefore = fs.readFileSync(projectGuidanceFiles(g.cwd).guidance);
    const stale = saveGuidance({ expected_sha256: "0".repeat(64), guidance: { governor: "overwrite attempt" } }, g);
    checks.guidance_stale_write_refused_409 = stale.status === 409 && fs.readFileSync(projectGuidanceFiles(g.cwd).guidance).equals(bytesBefore)
      && saveGuidance({ expected_sha256: null, guidance: { governor: "x" } }, g).status === 409;
    const block = saveGuidance({ expected_sha256: saved.value.project_sha256, guidance: { reviewers: { grok: "g".repeat(2001) } } }, g);
    const u = fixture("budget");
    writeJson(userGuidancePath(u.home), { reviewers: { "*": "a".repeat(1900), codex: "b".repeat(1900) } });
    const stack = saveGuidance({ expected_sha256: null, guidance: { reviewers: { "*": "c".repeat(1900), codex: "d".repeat(1900) } } }, u);
    checks.guidance_over_budget_refused_400 = block.status === 400 && /2001.*2000/.test(block.value.error)
      && stack.status === 400 && /route codex.*6000/.test(stack.value.error) && !fs.existsSync(projectGuidanceFiles(u.cwd).guidance)
      && fs.readFileSync(projectGuidanceFiles(g.cwd).guidance).equals(bytesBefore);
    const preview = saved.value.guidance_preview?.codex;
    checks.guidance_preview_has_placeholder_and_no_artifact = typeof preview === "string"
      && preview.endsWith("--- ARTIFACT TO REVIEW ---\n<artifact omitted: 0 bytes>")
      && preview.includes(guidance.reviewers.codex) && typeof GUIDANCE_PREVIEW_STUB === "string" && preview.startsWith(GUIDANCE_PREVIEW_STUB)
      && preview.split("--- ARTIFACT TO REVIEW ---").length === 2 && !preview.includes("diff --git")
      && Object.values(saved.value.guidance_preview).every((text) => text.includes("<artifact omitted: 0 bytes>"));
    // effective-prompt-preview-overclaims (audit): the preview carries a contract stub
    // and no persona, so the API and the page call it a guidance preview and say so.
    checks.guidance_preview_is_named_and_notes_omissions = !("preview" in saved.value)
      && /shows the resolved guidance layers in position; the built-in contract and persona text are not rendered here/.test(saved.value.guidance_preview_note)
      && (() => { const html = fs.readFileSync(path.join(assetDir, "index.html"), "utf8"); return html.includes("Guidance preview") && !/Effective prompt preview/i.test(html) && html.includes("shows the resolved guidance layers in position; the built-in contract and persona text are not rendered here"); })();
    // guidance-hash-bypasses-error-handling: a directory (or any unreadable
    // entry) at .momm/guidance.json is reported as project_error, never thrown,
    // and a save over it is refused rather than crashing on the rename.
    const d = fixture("guidance-dir");
    fs.mkdirSync(projectGuidanceFiles(d.cwd).guidance, { recursive: true });
    let dirSnapshot = null, dirThrew = false, dirSave;
    try { dirSnapshot = guidanceSnapshot(d); } catch { dirThrew = true; }
    try { dirSave = saveGuidance({ expected_sha256: null, guidance: { governor: "x" } }, d); } catch { dirSave = { status: "threw" }; }
    checks.guidance_unreadable_project_file_reported_not_thrown = !dirThrew && dirSnapshot?.project_sha256 === null
      && typeof dirSnapshot?.project_error === "string" && dirSnapshot.project_error.length > 0 && Array.isArray(dirSnapshot.routes)
      && dirSave.status === 409 && fs.statSync(projectGuidanceFiles(d.cwd).guidance).isDirectory();
    // guidance-save-overwrites-intervening-write: a foreign write that lands
    // after the pre-check must be caught in the same critical section as the
    // rename. `beforeCommit` is the seam where that second process writes.
    const r = fixture("guidance-race");
    const raceFile = projectGuidanceFiles(r.cwd).guidance;
    const first = saveGuidance({ expected_sha256: null, guidance: { governor: "A" } }, r);
    const revisionB = Buffer.from(`${JSON.stringify({ governor: "B" }, null, 2)}\n`, "utf8");
    const raced = saveGuidance({ expected_sha256: first.value.project_sha256, guidance: { governor: "C" } }, { ...r, beforeCommit: () => fs.writeFileSync(raceFile, revisionB) });
    checks.guidance_intervening_write_refused_409 = first.status === 200 && raced.status === 409 && fs.readFileSync(raceFile).equals(revisionB)
      && !fs.readdirSync(path.dirname(raceFile)).some((name) => name.endsWith(".tmp"))
      && saveGuidance({ expected_sha256: sha256(revisionB), guidance: { governor: "C" } }, r).status === 200; // control: B's own hash lets C land
    // guidance-final-check-still-races / cas-gap-between-hash-and-rename: the
    // hash check and the rename run under .momm/guidance.json.lock, so a
    // cooperating saver that arrives in that window finds a live lock and is
    // refused, instead of landing bytes the rename then silently replaces.
    const l = fixture("guidance-lock");
    const lockedFile = projectGuidanceFiles(l.cwd).guidance, lockPath = `${lockedFile}.lock`;
    const lockedFirst = saveGuidance({ expected_sha256: null, guidance: { governor: "A" } }, l);
    let nested = null, lockOwner = null;
    const outer = saveGuidance({ expected_sha256: lockedFirst.value.project_sha256, guidance: { governor: "C" } }, { ...l, beforeRename: () => {
      lockOwner = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, "utf8").trim() : null;
      nested = saveGuidance({ expected_sha256: lockedFirst.value.project_sha256, guidance: { governor: "B" } }, l);
    } });
    const lockDirAfter = fs.readdirSync(path.dirname(lockedFile));
    checks.guidance_lock_serialises_concurrent_savers = lockedFirst.status === 200 && lockOwner === String(process.pid)
      && nested?.status === 409 && /another momm process/i.test(nested.value.error) && nested.value.project_sha256 === lockedFirst.value.project_sha256
      && outer.status === 200 && outer.value.trusted === true && JSON.parse(fs.readFileSync(lockedFile, "utf8")).governor === "C"
      && !lockDirAfter.some((name) => name.endsWith(".lock") || name.endsWith(".tmp"));
    // A live lock left by a running peer answers 409 and leaves the file alone;
    // Age must never override a live owner, and a just-created empty record
    // may belong to a writer that has not published its pid yet.
    fs.writeFileSync(lockPath, `${process.pid}\n`);
    const busySave = saveGuidance({ expected_sha256: outer.value.project_sha256, guidance: { governor: "D" } }, l);
    const bytesWhileBusy = fs.readFileSync(lockedFile);
    const aged = (Date.now() - 2 * 60_000) / 1000;
    fs.utimesSync(lockPath, aged, aged);
    const refusedByAge = saveGuidance({ expected_sha256: outer.value.project_sha256, guidance: { governor: "D" } }, l);
    fs.writeFileSync(lockPath, "");
    const refusedUnpublished = saveGuidance({ expected_sha256: outer.value.project_sha256, guidance: { governor: "D" } }, l);
    fs.writeFileSync(lockPath, "not-a-pid\n");
    fs.utimesSync(lockPath, aged, aged);
    const refusedMalformed = saveGuidance({ expected_sha256: outer.value.project_sha256, guidance: { governor: "E" } }, l);
    const malformedPreserved = fs.readFileSync(lockPath,'utf8') === 'not-a-pid\n';
    fs.unlinkSync(lockPath); // Explicit recovery of this disposable self-test fixture.
    const recovered = saveGuidance({ expected_sha256: outer.value.project_sha256, guidance: { governor: "E" } }, l);
    checks.guidance_live_and_abandoned_locks_preserved_explicit_recovery_works = busySave.status === 409 && /another momm process/i.test(busySave.value.error) && busySave.value.project_sha256 === outer.value.project_sha256
      && JSON.parse(bytesWhileBusy.toString("utf8")).governor === "C"
      && refusedByAge.status === 409 && refusedUnpublished.status === 409 && refusedMalformed.status === 409 && malformedPreserved && recovered.status === 200 && JSON.parse(fs.readFileSync(lockedFile, "utf8")).governor === "E" && !fs.existsSync(lockPath);
    // guidance-body-limit-unenforced: the cap applies to the file a save would
    // write, whoever assembled the body (route keys are open-ended, so the
    // per-block caps alone do not bound it); nothing reaches disk, nothing is trusted.
    const o = fixture("guidance-oversize");
    const wide = { reviewers: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`route${i}`, "x".repeat(2000)])) };
    const oversize = saveGuidance({ expected_sha256: null, guidance: wide }, o);
    const oversizeDir = path.dirname(projectGuidanceFiles(o.cwd).guidance);
    const untouched = !fs.existsSync(oversizeDir) || fs.readdirSync(oversizeDir).length === 0;
    const fits = saveGuidance({ expected_sha256: null, guidance: { reviewers: { codex: "x".repeat(2000) } } }, o); // control: a full-size block still saves
    checks.guidance_oversize_file_refused_413 = oversize.status === 413 && new RegExp(`cap is ${GUIDANCE_BODY_LIMIT}`).test(oversize.value.error) && untouched
      && fits.status === 200 && fits.value.trusted === true;

    // Usage: routes without reported usage read "0 of n", never zero.
    const usage = fixture("usage");
    const reports = path.join(usage.cwd, ".ensemble_reviews", "reports");
    writeJson(path.join(reports, "rev_1_a.json"), { run_id: "rev_1_a", reviewers: [{ agent: "codex", status: "success" }, { agent: "grok", status: "timeout" }] });
    writeJson(path.join(reports, "rev_2_b.json"), { run_id: "rev_2_b", reviewers: [{ agent: "codex", status: "success", usage: { reported: null, coverage: { tokens: false, cost: false } } }] });
    const rolled = usageReport({ cwd: usage.cwd });
    const codexRow = rolled.rows.find((row) => row.agent === "codex");
    checks.usage_zero_of_n_for_reports_without_usage = rolled.rows.length === 1 && codexRow.coverage.tokens === "0 of 2" && codexRow.coverage.cost === "0 of 2"
      && codexRow.median_total_tokens === null && codexRow.total_cost_usd === null && typeof rolled.note === "string"
      && rolled.coverage.reports_scanned === 2 && !JSON.stringify(rolled).includes("NaN");
    writeJson(path.join(reports, "rev_3_c.json"), { run_id: "rev_3_c", reviewers: [{ agent: "codex", status: "success", usage: { reported: { total_tokens: 900, cost_usd: 0.02 }, coverage: { tokens: true, cost: true } } }] });
    fs.writeFileSync(path.join(usage.cwd, ".ensemble_reviews", "dispositions.jsonl"), `${JSON.stringify({ run_id: "rev_3_c", reviewer: "codex", disposition: "applied" })}\n{"broken"\n`);
    const withUsage = usageReport({ cwd: usage.cwd }).rows[0];
    checks.usage_counts_reported_rows_and_accepted_findings = withUsage.coverage.tokens === "1 of 3" && withUsage.median_total_tokens === 900 && withUsage.cost_per_accepted_finding === 0.02;
    // disposition-limit-silently-erases-counts / dispositions-oversize-returns-empty:
    // the ledger is streamed row by row, so a ledger past the old 8 MiB cutoff
    // still counts every applied row — including one whose multi-byte text
    // straddles a 64 KiB read boundary, and one that follows an overlong line.
    const ledgerFile = path.join(usage.cwd, ".ensemble_reviews", "dispositions.jsonl");
    const appliedRow = (extra) => JSON.stringify({ run_id: "rev_3_c", reviewer: "codex", disposition: "applied", ...extra });
    const emojiRow = appliedRow({ note: "😀😀😀😀" });
    const emojiOffset = Buffer.byteLength(emojiRow.slice(0, emojiRow.indexOf("😀")));
    const firstRow = appliedRow({ pad: "a".repeat(DISPOSITIONS_CHUNK - 3 - emojiOffset - appliedRow({ pad: "" }).length) });
    const emojiStraddlesChunk = Buffer.byteLength(firstRow) + 1 + emojiOffset === DISPOSITIONS_CHUNK - 2; // first emoji spans bytes 65534..65537
    fs.writeFileSync(ledgerFile, `${firstRow}\n${emojiRow}\n${"\n".repeat(8 * 1024 * 1024 + 64)}${"x".repeat(DISPOSITIONS_LINE_LIMIT + 10)}\n${appliedRow({})}\n`);
    const streamed = usageReport({ cwd: usage.cwd });
    checks.usage_oversize_ledger_still_counts_accepted_findings = emojiStraddlesChunk && fs.statSync(ledgerFile).size > 9 * 1024 * 1024
      && Math.abs(streamed.rows[0].cost_per_accepted_finding - 0.02 / 3) < 1e-6 && streamed.coverage.accepted_findings_available === true && streamed.note === null;
    // An unreadable ledger (here a directory at its path) reads as "counts
    // unavailable" with null ratios — never as zero accepted findings.
    const ul = fixture("usage-ledger-unreadable");
    writeJson(path.join(ul.cwd, ".ensemble_reviews", "reports", "rev_9_z.json"), { run_id: "rev_9_z", reviewers: [{ agent: "codex", status: "success", usage: { reported: { total_tokens: 100, cost_usd: 0.05 }, coverage: { tokens: true, cost: true } } }] });
    fs.mkdirSync(path.join(ul.cwd, ".ensemble_reviews", "dispositions.jsonl"));
    const unavailable = usageReport({ cwd: ul.cwd });
    checks.usage_unreadable_ledger_reports_unavailable_not_zero = unavailable.rows.length === 1 && unavailable.rows[0].cost_per_accepted_finding === null && unavailable.rows[0].total_cost_usd === 0.05
      && unavailable.coverage.accepted_findings_available === false && /accepted-finding counts unavailable/.test(unavailable.note) && !JSON.stringify(unavailable).includes("no accepted findings");
    // unbounded-report-json-slurp: a sealed report over REPORT_READ_LIMIT is
    // skipped and counted, never parsed; the other reports still roll up.
    writeJson(path.join(reports, "rev_4_d.json"), { run_id: "rev_4_d", pad: "p".repeat(REPORT_READ_LIMIT), reviewers: [{ agent: "grok", status: "success", usage: { reported: { total_tokens: 5, cost_usd: 1 }, coverage: { tokens: true, cost: true } } }] });
    const capped = usageReport({ cwd: usage.cwd });
    checks.usage_oversize_report_skipped_with_note = capped.coverage.reports_available === 4 && capped.coverage.reports_scanned === 3 && capped.coverage.reports_skipped_oversize === 1
      && !capped.rows.some((row) => row.agent === "grok") && /1 report over 2 MiB skipped/.test(capped.note) && capped.rows.find((row) => row.agent === "codex").coverage.tokens === "1 of 3";

    // Update clock: settings default off, `set` round-trips, apply is a no-op while disabled, timer needs confirm.
    const c = fixture("clock");
    let updaterRuns = 0, execs = 0;
    const clock = createUpdateClock({ home: c.home, env: {}, stateFile: path.join(c.cwd, "state", "update-clock.json"), sources: [], fetcher: async () => { throw new Error("no network in tests"); }, exec: async () => { execs += 1; return { code: 0, stdout: "", stderr: "" }; }, installedVersions: { skill: "1.16.0" } });
    const defaults = clock.settings();
    const set = await handleUpdateClock({ op: "set", patch: { auto_update: { skill: false, models: false } } }, clock, { home: c.home });
    const after = clock.settings();
    const badSet = await handleUpdateClock({ op: "set", patch: { auto_update: { enabled: "yes" } } }, clock, { home: c.home });
    const unknownSet = await handleUpdateClock({ op: "set", patch: { extra: true } }, clock, { home: c.home });
    checks.update_clock_defaults_off_and_set_round_trips = defaults.auto_update.enabled === false && defaults.auto_update.accept_protocol === false
      && set.status === 200 && after.auto_update.enabled === false && after.auto_update.skill === false && after.auto_update.models === false && after.auto_update.clis === true
      && set.value.auto_update.skill === false && typeof set.value.timer?.install === "string" && badSet.status === 400 && unknownSet.status === 400;
    const applied = await handleUpdateClock({ op: "apply" }, clock, { home: c.home, runUpdater: async () => { updaterRuns += 1; return { code: 0, output: "" }; }, exec: async () => { execs += 1; return { code: 0 }; } });
    checks.update_clock_apply_disabled_is_noop = applied.status === 200 && applied.value.applied.length === 0 && /enabled is false/.test(applied.value.skipped[0]?.reason) && updaterRuns === 0 && execs === 0;
    const timerDefault = await handleUpdateClock({ op: "timer", action: "install" }, clock, { exec: async () => { execs += 1; return { code: 0 }; } });
    const timerMismatch = await handleUpdateClock({ op: "timer", action: "install", confirm: true, expected_command: "something else" }, clock, { exec: async () => { execs += 1; return { code: 0 }; } });
    const timerFalse = await handleUpdateClock({ op: "timer", action: "remove", confirm: "true" }, clock, { exec: async () => { execs += 1; return { code: 0 }; } });
    checks.timer_install_without_confirm_refused = timerDefault.status === 409 && timerDefault.value.command === clockTimer().install
      && timerMismatch.status === 409 && timerFalse.status === 409 && execs === 0;
    // timer-command-confirmation-optional: confirm:true alone is not a
    // confirmation; the page must echo the exact command it displayed.
    const timerNoCommand = await handleUpdateClock({ op: "timer", action: "install", confirm: true }, clock, { exec: async () => { execs += 1; return { code: 0 }; } });
    const timerRemoveNoCommand = await handleUpdateClock({ op: "timer", action: "remove", confirm: true }, clock, { exec: async () => { execs += 1; return { code: 0 }; } });
    const execsAfterRefusals = execs;
    const timerExact = await handleUpdateClock({ op: "timer", action: "remove", confirm: true, expected_command: clockTimer().remove }, clock, { exec: async () => { execs += 1; return { code: 0 }; } });
    checks.timer_requires_exact_command_even_when_confirmed = timerNoCommand.status === 409 && timerNoCommand.value.command === clockTimer().install
      && timerRemoveNoCommand.status === 409 && execsAfterRefusals === 0
      && timerExact.status === 200 && execs === 1; // control: the echoed command reaches the (stubbed) OS once
    const badEvent = await handleUpdateClock({ op: "trigger", event: "daily.tick" }, clock, {});
    checks.update_clock_rejects_unknown_ops = badEvent.status === 400 && (await handleUpdateClock({ op: "nuke" }, clock, {})).status === 400 && (await handleUpdateClock({ op: "set" }, null, {})).status === 503;
    // clock-activity-reentrant: trigger, apply and timer share one guard. While
    // a check is in flight a second trigger is not restarted, apply and timer
    // answer 409 (even on the disabled no-op path), the fire-and-forget entry
    // does nothing, and activity.running stays true until the live run finishes.
    let hangRelease = null, hangCalls = 0, hangExecs = 0;
    const hanging = { trigger: () => { hangCalls += 1; return new Promise((resolve) => { hangRelease = resolve; }); }, status: () => ({ hung: true }), settings: () => ({ auto_update: { enabled: false } }) };
    const inFlightTrigger = handleUpdateClock({ op: "trigger", event: "manual" }, hanging, {});
    await new Promise((resolve) => setImmediate(resolve));
    const runningWhileLive = clockActivity.running === true && clockActivity.last_event === "manual" && hangCalls === 1;
    const secondTrigger = await handleUpdateClock({ op: "trigger", event: "setup.check" }, hanging, {});
    const applyWhileBusy = await handleUpdateClock({ op: "apply" }, hanging, { runUpdater: async () => { hangExecs += 1; return { code: 0, output: "" }; } });
    const timerWhileBusy = await handleUpdateClock({ op: "timer", action: "remove", confirm: true, expected_command: clockTimer().remove }, hanging, { exec: async () => { hangExecs += 1; return { code: 0 }; } });
    const fireAndForget = await triggerClock(hanging, "setup.open");
    const refusedWhileBusy = [secondTrigger, applyWhileBusy, timerWhileBusy].every((answer) => answer.status === 409 && /busy/.test(answer.value.error) && answer.value.activity.running === true)
      && fireAndForget === null && hangCalls === 1 && hangExecs === 0;
    hangRelease({ checked: true });
    const finished = await inFlightTrigger;
    let runningDuringTimer = null, eventDuringTimer = null;
    const timerAfter = await handleUpdateClock({ op: "timer", action: "remove", confirm: true, expected_command: clockTimer().remove }, hanging, { exec: async () => { runningDuringTimer = clockActivity.running; eventDuringTimer = clockActivity.last_event; return { code: 0 }; } });
    checks.update_clock_ops_never_overlap = runningWhileLive && refusedWhileBusy && finished.status === 200 && finished.value.result?.checked === true && clockActivity.running === false
      && timerAfter.status === 200 && runningDuringTimer === true && eventDuringTimer === "timer.remove" && clockActivity.running === false;

    // Audit findings 5 and 7, on the real handler and event paths with a real clock
    // and module (only the child processes and probes.mjs are faked): while
    // disabled, setup.open checks and applies nothing and says so; the dashboard
    // apply runs the updater once, re-reads `<cli> --version` once and probes once
    // per applied CLI, and a failed probe is "updated, containment not verified",
    // never ready; setup.check applies after its check once enabled.
    const p = fixture("probe");
    let latest = "1.1.0";
    const probeClock = createUpdateClock({ home: p.home, env: {}, stateFile: path.join(p.cwd, "state", "update-clock.json"), sources: [{ name: "cli:codex", kind: "cli", cli: "codex", check: async () => ({ latest }) }], fetcher: async () => { throw new Error("no network in tests"); }, exec: async () => ({ code: 0, stdout: "", stderr: "" }), installedVersions: { skill: "1.16.0", codex: "1.0.0" } });
    const counts = { updater: 0, exec: [], version: [], probe: [] };
    const probeDeps = {
      home: p.home,
      runUpdater: async () => { counts.updater += 1; return { code: 0, output: "" }; },
      exec: async (bin, args) => { counts.exec.push([bin, ...args].join(" ")); return { code: 0, stdout: "", stderr: "" }; },
      versionOf: async (cli) => { counts.version.push(cli); return `codex-cli ${latest}\n`; },
      postUpdateProbe: async (cli) => { counts.probe.push(cli); return { status: "fail", containment: "unavailable", one_line_review: "ok", cli_version: latest }; },
      isManaged: () => false,
    };
    const openedOff = await triggerClock(probeClock, "setup.open", probeDeps);
    checks.update_clock_disabled_event_checks_but_applies_nothing = openedOff?.ran === true && openedOff.apply?.skipped_reason === "auto_update_disabled" && openedOff.apply.applied.length === 0
      && counts.exec.length === 0 && counts.probe.length === 0 && counts.version.length === 0
      && clockActivity.last_apply?.event === "setup.open" && clockActivity.last_apply.enabled === false && clockActivity.last_apply.applied === 0 && /off/i.test(clockActivity.last_apply.note)
      && probeClock.status().sources[0].update_available === true;
    await handleUpdateClock({ op: "set", patch: { auto_update: { enabled: true } } }, probeClock, { home: p.home });
    const appliedNow = await handleUpdateClock({ op: "apply" }, probeClock, probeDeps);
    const probedCodex = appliedNow.value?.applied?.find((row) => row.name === "cli:codex");
    checks.update_clock_apply_probes_each_cli_and_reports_verdict = appliedNow.status === 200 && counts.updater === 0
      && counts.exec.length === 1 && /npm install -g @openai\/codex@latest/.test(counts.exec[0]) && counts.version.join() === "codex" && counts.probe.join() === "codex"
      && probedCodex?.to === "1.1.0" && probedCodex.version === "1.1.0" && probedCodex.probe_verdict === "fail" && probedCodex.ready === false && probedCodex.verification === "updated, containment not verified"
      && appliedNow.value.activity.last_apply.event === "apply" && appliedNow.value.activity.last_apply.applied === 1 && appliedNow.value.activity.last_apply.rows[0].verification === "updated, containment not verified"
      && probeClock.installedVersions.codex === "1.1.0" && appliedNow.value.sources[0].update_available === false;
    latest = "1.2.0";
    probeDeps.postUpdateProbe = async (cli) => { counts.probe.push(cli); return { status: "pass", containment: "held", one_line_review: "ok", cli_version: latest }; };
    const checkedOn = await handleUpdateClock({ op: "trigger", event: "setup.check" }, probeClock, probeDeps);
    const secondRow = checkedOn.value?.result?.apply?.applied?.find((row) => row.name === "cli:codex");
    checks.update_clock_enabled_event_applies_after_check = checkedOn.status === 200 && checkedOn.value.result.ran === true
      && counts.exec.length === 2 && counts.version.join() === "codex,codex" && counts.probe.join() === "codex,codex" && counts.updater === 0
      && secondRow?.to === "1.2.0" && secondRow.probe_verdict === "pass" && secondRow.ready === true && /verified/.test(secondRow.verification)
      && clockActivity.last_apply.event === "setup.check" && clockActivity.last_apply.enabled === true && clockActivity.last_apply.applied === 1 && clockActivity.running === false
      && probeClock.installedVersions.codex === "1.2.0";

    // Ledger watcher: debounce collapses a burst, unrelated files are ignored, rebuilds stay 5 s apart.
    const timers = [];
    let runs = 0, clockNow = 100_000;
    const macrotask = () => new Promise((resolve) => setImmediate(resolve));
    const watcher = createLedgerWatcher({ dir: root, run: async () => { runs += 1; await macrotask(); return { code: 0, stdout: "", stderr: "" }; }, now: () => clockNow, setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; }, clearTimer: (timer) => { timer.cleared = true; }, watch: () => { throw new Error("directory absent"); } });
    watcher.start();
    const retryScheduled = timers.length === 1 && timers[0].ms === 30_000 && watcher.status().watching === false;
    watcher.notify("review-log.jsonl"); watcher.notify("dispositions.jsonl"); watcher.notify("ledger.html"); watcher.notify(null);
    const live = timers.filter((timer) => !timer.cleared && timer.ms !== 30_000);
    const burstCollapsed = live.length === 1 && live[0].ms === 1500 && timers.length === 3;
    const fired = live[0].fn(); // the timer callback must hand back the regeneration so callers (and this test) can await it
    const ranOnce = fired instanceof Promise && (await fired, runs === 1 && watcher.status().regenerations === 1 && watcher.status().last_regenerated_at !== null);
    clockNow += 1000; watcher.notify("dispositions.jsonl");
    const spaced = timers.at(-1).ms === 4000; // 5 s gap minus the 1 s elapsed, not the 1.5 s debounce
    watcher.stop();
    checks.ledger_watcher_debounces_and_rate_limits = retryScheduled && burstCollapsed && ranOnce && spaced && timers.every((timer) => timer.cleared || timer === live[0]);
    // A rebuild that rejects is recorded as last_error; the timer callback's
    // promise still resolves, so nothing reaches unhandledRejection.
    const failing = [];
    const failingWatcher = createLedgerWatcher({ dir: root, run: async () => { await macrotask(); throw new Error("ledger exploded"); }, now: () => clockNow, setTimer: (fn, ms) => { const timer = { fn, ms }; failing.push(timer); return timer; }, clearTimer: () => {}, watch: () => ({ on() {}, close() {} }) });
    failingWatcher.start(); failingWatcher.notify("review-log.jsonl");
    const settled = await failing.at(-1).fn().then(() => "resolved", () => "rejected");
    failingWatcher.stop();
    checks.ledger_watcher_catches_rejected_rebuilds = settled === "resolved" && failingWatcher.status().last_error === "ledger exploded" && failingWatcher.status().regenerations === 0 && failingWatcher.status().running === false;
    // ledger-misses-writes-before-watch-attachment: telemetry written while the
    // directory was absent (before the 30 s retry attached) is rebuilt once the
    // watcher attaches, without waiting for another append. An empty directory
    // attaches quietly.
    const lateWatch = (dir) => {
      const timers = []; let runs = 0, attempts = 0;
      const watcher = createLedgerWatcher({ dir, run: async () => { runs += 1; await macrotask(); return { code: 0, stdout: "", stderr: "" }; }, now: () => clockNow, setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; }, clearTimer: (timer) => { timer.cleared = true; }, watch: () => { attempts += 1; if (!fs.existsSync(dir)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return { on() {}, close() {} }; } });
      return { watcher, timers, runs: () => runs, attempts: () => attempts };
    };
    const lateDir = path.join(root, "ledger-late");
    const late = lateWatch(lateDir);
    late.watcher.start();
    const lateRetryPending = late.timers.length === 1 && late.timers[0].ms === 30_000 && late.watcher.status().watching === false;
    fs.mkdirSync(lateDir, { recursive: true }); fs.writeFileSync(path.join(lateDir, "review-log.jsonl"), "{}\n"); // the first review lands before the retry
    late.timers[0].fn();
    const catchUp = late.timers.filter((timer) => !timer.cleared && timer.ms !== 30_000);
    const catchUpScheduled = late.watcher.status().watching === true && catchUp.length === 1;
    if (catchUp.length) await catchUp[0].fn();
    late.watcher.stop();
    const emptyDir = path.join(root, "ledger-empty");
    const empty = lateWatch(emptyDir);
    empty.watcher.start(); fs.mkdirSync(emptyDir, { recursive: true }); empty.timers[0].fn();
    const emptyQuiet = empty.watcher.status().watching === true && empty.timers.filter((timer) => !timer.cleared && timer.ms !== 30_000).length === 0;
    empty.watcher.stop();
    checks.ledger_watcher_catches_up_on_writes_before_attachment = lateRetryPending && late.attempts() === 2 && catchUpScheduled && late.runs() === 1 && emptyQuiet && empty.runs() === 0;
    // ledger-regeneration-resumes-after-stop: a notification that arrives while
    // a rebuild is running must not schedule another rebuild once stop() ran.
    const stopTimers = []; let stopRuns = 0, release = null;
    const stopWatcher = createLedgerWatcher({ dir: root, run: () => { stopRuns += 1; return new Promise((resolve) => { release = () => resolve({ code: 0, stdout: "", stderr: "" }); }); }, now: () => clockNow, setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; stopTimers.push(timer); return timer; }, clearTimer: (timer) => { timer.cleared = true; }, watch: () => ({ on() {}, close() {} }) });
    stopWatcher.start(); stopWatcher.notify("review-log.jsonl");
    const inFlight = stopTimers.at(-1).fn();          // rebuild running, awaiting `release`
    await macrotask(); // let the published promise start the rebuild
    stopWatcher.notify("dispositions.jsonl"); stopTimers.at(-1).fn(); // fires during the run: marks pending
    const pendingWhileRunning = stopWatcher.status().pending === true && stopRuns === 1;
    stopWatcher.stop();
    const timersBeforeRelease = stopTimers.length;
    release(); await inFlight;
    checks.ledger_watcher_never_reschedules_after_stop = pendingWhileRunning && stopRuns === 1
      && stopTimers.slice(timersBeforeRelease).filter((timer) => !timer.cleared).length === 0 && stopWatcher.status().pending === false && stopWatcher.status().running === false;
    // ledger-watcher-loses-replaced-directory: fs.watch follows the inode. A
    // rename event for the directory itself (Linux IN_MOVE_SELF/IN_DELETE_SELF
    // arrive with the directory's basename), or any rename after which the
    // path's dev:ino differs, closes the stale handle and re-attaches by path,
    // catching up on telemetry the replacement already holds; a vanished
    // directory falls back to the 30 s retry with watching=false. The Linux
    // event sequence is modelled with fakes here; real inotify needs a Linux host.
    const rp = { attempts: 0, closed: 0, callback: null, identity: 1, timers: [], exists: false, gone: false };
    const replacedDir = path.join(root, "ledger-replaced", ".ensemble_reviews");
    const missing = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const replacedWatcher = createLedgerWatcher({ dir: replacedDir, run: async () => ({ code: 0, stdout: "", stderr: "" }), now: () => clockNow,
      setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; rp.timers.push(timer); return timer; }, clearTimer: (timer) => { timer.cleared = true; },
      watch: (_dir, _options, callback) => { if (rp.gone) throw missing(); rp.attempts += 1; rp.callback = callback; return { on() {}, close() { rp.closed += 1; } }; },
      exists: () => rp.exists, stat: () => { if (rp.gone) throw missing(); return { dev: 7, ino: rp.identity }; } });
    replacedWatcher.start();
    rp.callback("rename", "reports"); rp.callback("change", path.basename(replacedDir)); // same directory: a child renamed, the directory touched
    const unrelatedIgnored = rp.attempts === 1 && rp.closed === 0 && replacedWatcher.status().watching === true && rp.timers.length === 0;
    rp.identity = 2; rp.exists = true; // moved away and recreated, telemetry already inside
    rp.callback("rename", path.basename(replacedDir));
    const catchUpTimers = rp.timers.filter((timer) => !timer.cleared && timer.ms !== 30_000);
    const reattached = rp.attempts === 2 && rp.closed === 1 && replacedWatcher.status().watching === true && replacedWatcher.status().reattachments === 1
      && catchUpTimers.length === 1 && catchUpTimers[0].ms === 1500;
    rp.gone = true; // removed for good
    rp.callback("rename", path.basename(replacedDir));
    const vanished = rp.closed === 2 && replacedWatcher.status().watching === false && rp.timers.at(-1).ms === 30_000;
    replacedWatcher.stop();
    rp.gone = false; rp.identity = 3; rp.callback("rename", path.basename(replacedDir)); // a straggling event after stop
    const stayedStopped = rp.attempts === 2 && replacedWatcher.status().watching === false && rp.timers.every((timer) => timer.cleared);
    checks.ledger_watcher_reattaches_when_directory_replaced = unrelatedIgnored && reattached && vanished && stayedStopped;
    // rebuild(): GET /ledger waits for a covering generation and respects the 5 s gap; late readers can require a second run.
    const rb = { runs: 0, timers: [], release: null };
    const rebuildWatcher = createLedgerWatcher({ dir: root, run: () => { rb.runs += 1; return new Promise((resolve) => { rb.release = () => resolve({ code: 0, stdout: "", stderr: "" }); }); }, now: () => clockNow, setTimer: (fn, ms) => { const timer = { fn, ms }; rb.timers.push(timer); return timer; }, clearTimer: () => {}, watch: () => ({ on() {}, close() {} }) });
    const rbFirst = rebuildWatcher.rebuild(); const rbSecond = rebuildWatcher.rebuild(); // same turn, before the snapshot begins
    await macrotask();
    const oneRunForTwoRequests = rb.runs === 1 && rebuildWatcher.status().running === true;
    rb.release(); const [firstState, secondState] = await Promise.all([rbFirst, rbSecond]);
    const bothServedByThatRun = firstState.regenerations === 1 && secondState.regenerations === 1 && rb.runs === 1 && rb.timers.length === 0;
    clockNow += 2000; const rbThird = rebuildWatcher.rebuild(); // inside the gap: deferred by the remainder
    const deferred = rb.runs === 1 && rb.timers.length === 1 && rb.timers[0].ms === 3000;
    rb.timers[0].fn(); await macrotask(); rb.release(); const thirdState = await rbThird;
    checks.ledger_rebuild_awaits_inflight_and_respects_gap = oneRunForTwoRequests && bothServedByThatRun && deferred && rb.runs === 2 && thirdState.regenerations === 2;
    // /api/status.ledger_url: null until a ledger exists, then a file:// URL to it.
    const luFx = fixture("ledger-url");
    const nullBefore = ledgerFileUrl(luFx.cwd) === null;
    fs.mkdirSync(path.join(luFx.cwd, ".ensemble_reviews"), { recursive: true }); fs.writeFileSync(path.join(luFx.cwd, ".ensemble_reviews", "ledger.html"), "<!doctype html>");
    const luAfter = ledgerFileUrl(luFx.cwd);
    checks.status_ledger_url_is_null_then_file_url = nullBefore && typeof luAfter === "string" && luAfter.startsWith("file:///") && luAfter.endsWith("/.ensemble_reviews/ledger.html") && fileURLToPath(luAfter) === path.join(luFx.cwd, ".ensemble_reviews", "ledger.html");
    // GET /ledger: always revalidate; source can change with unchanged telemetry.
    const fakeResponse = () => { const r = { status: null, headers: null, body: null, writeHead(status, headers) { r.status = status; r.headers = headers; }, end(body) { r.body = String(body); } }; return r; };
    const noDir = fixture("ledger-route-none"); const none = fakeResponse();
    const noneResult = await serveLedger(none, { cwd: noDir.cwd, rebuild: async () => { throw new Error("must not rebuild without a directory"); } });
    const missing404 = noneResult.status === 404 && none.status === 404 && none.headers["Content-Type"].startsWith("text/html") && none.body.includes("No ledger yet") && none.body.includes(escapeHtml(noDir.cwd));
    const lr = fixture("ledger-route"); const lrDir = path.join(lr.cwd, ".ensemble_reviews"); fs.mkdirSync(lrDir, { recursive: true });
    const page = (n) => `<!doctype html><meta charset="utf-8"><title>L</title><style>body{color:red}</style><p>ledger ${n}</p><script>console.log(${n});</script>`;
    let rebuilds = 0; const rebuild = async () => { rebuilds += 1; fs.writeFileSync(path.join(lrDir, "ledger.html"), page(rebuilds)); const t = new Date(Date.now() + 5000); fs.utimesSync(path.join(lrDir, "ledger.html"), t, t); };
    fs.writeFileSync(path.join(lrDir, "review-log.jsonl"), "{}\n");
    const built = fakeResponse(); const builtResult = await serveLedger(built, { cwd: lr.cwd, rebuild });
    const missingPageBuilt = builtResult.status === 200 && builtResult.rebuilt === true && rebuilds === 1 && built.body.includes("ledger 1") && built.headers["Content-Type"] === "text/html; charset=utf-8";
    const csp = built.headers["Content-Security-Policy"];
    const hashOf = (text) => `'sha256-${crypto.createHash("sha256").update(text, "utf8").digest("base64")}'`;
    const hashedInline = csp.includes(`style-src ${hashOf("body{color:red}")}`) && csp.includes(`script-src ${hashOf("console.log(1);")}`) && !csp.includes("unsafe-inline") && csp.includes("frame-ancestors 'none'");
    const fresh = fakeResponse(); const freshResult = await serveLedger(fresh, { cwd: lr.cwd, rebuild });
    const freshServedAsIs = freshResult.status === 200 && freshResult.rebuilt === true && rebuilds === 2 && fresh.body.includes("ledger 2");
    const later = new Date(Date.now() + 10_000); fs.utimesSync(path.join(lrDir, "review-log.jsonl"), later, later); // telemetry newer than the page
    const staleRes = fakeResponse(); const staleResult = await serveLedger(staleRes, { cwd: lr.cwd, rebuild });
    const staleRebuilt = staleResult.status === 200 && staleResult.rebuilt === true && rebuilds === 3 && staleRes.body.includes("ledger 3");
    const failFx = fixture("ledger-route-failing"); fs.mkdirSync(path.join(failFx.cwd, ".ensemble_reviews"), { recursive: true });
    const failed = fakeResponse(); const failedResult = await serveLedger(failed, { cwd: failFx.cwd, rebuild: async () => { throw new Error("ledger exploded"); } });
    const failureIsA404 = failedResult.status === 503 && failed.body.includes("Ledger refresh failed") && failed.headers["Content-Type"].startsWith("text/html");
    checks.ledger_route_serves_rebuilds_when_stale_and_404s_without_directory = missing404 && missingPageBuilt && hashedInline && freshServedAsIs && staleRebuilt && failureIsA404;
    // setup-center.json: written 0600 on start with url/pid/started_at, removed on shutdown, never written without .ensemble_reviews, never removes another pid's file.
    const sp = fixture("setup-pointer"); const spDir = path.join(sp.cwd, ".ensemble_reviews");
    const fakeProc = { handlers: {}, once(name, fn) { (this.handlers[name] ??= []).push(fn); }, exit() { this.exited = true; } };
    const absent = createSetupCenterPointer({ cwd: sp.cwd, pid: 4242, proc: fakeProc });
    const notWrittenWithoutDir = absent.write("http://127.0.0.1:1/") === false && !fs.existsSync(absent.file);
    fs.mkdirSync(spDir, { recursive: true });
    const pointer = createSetupCenterPointer({ cwd: sp.cwd, pid: 4242, proc: fakeProc });
    const wrote = pointer.write("http://127.0.0.1:4321/") === true && fs.existsSync(pointer.file);
    const pointerBody = wrote ? JSON.parse(fs.readFileSync(pointer.file, "utf8")) : {};
    const shape = pointerBody.url === "http://127.0.0.1:4321/" && pointerBody.pid === 4242 && Number.isFinite(Date.parse(pointerBody.started_at));
    const pointerMode = wrote ? fs.statSync(pointer.file).mode & 0o777 : null;
    const ownerOnly = process.platform === "win32" ? pointerMode !== null : pointerMode === 0o600;
    const hooked = Array.isArray(fakeProc.handlers.exit) && Array.isArray(fakeProc.handlers.SIGINT) && Array.isArray(fakeProc.handlers.SIGTERM);
    fs.writeFileSync(path.join(spDir, "setup-center.json"), JSON.stringify({ url: "http://127.0.0.1:9/", pid: 9999 }));
    const keepsOthers = pointer.remove() === false && fs.existsSync(pointer.file);
    const again = createSetupCenterPointer({ cwd: sp.cwd, pid: 4242, proc: fakeProc }); again.write("http://127.0.0.1:4321/");
    fakeProc.handlers.SIGINT.at(-1)();
    const removedOnSignal = !fs.existsSync(again.file) && fakeProc.exited === true;
    checks.setup_center_pointer_written_0600_and_removed = notWrittenWithoutDir && wrote && shape && ownerOnly && hooked && keepsOthers && removedOnSignal;

    // Modalities panel (1.16 E7), against the real registry with a temp home and an injected
    // exec: the matrix is served with blockers, clearing actions and per-route disclosures;
    // a stale overlay reads as reprobe; a generation probe without consent (or with a
    // disclosure that is not the exact one shown) is refused before any request; the input
    // probe runs and records; generation with exact consent sends one request per UNBLOCKED
    // cell and skips blocked cells with their clearing action; plan() renders; no registry = 503.
    const cap = fixture("capabilities");
    const capRegistry = await loadCapabilitiesRegistry();
    if (!capRegistry.module) {
      checks.capabilities_registry_loaded = false;
      process.stderr.write(`capabilities registry unavailable: ${capRegistry.error}\n`);
    } else {
      checks.capabilities_registry_loaded = true;
      const versions = Object.fromEntries(Object.keys(providers).map((agent) => [agent, "9.9.9"]));
      const capDeps = { registry: capRegistry, home: cap.home, cwd: cap.cwd, installedVersions: versions };
      capRegistry.module.writeOverlayEntry(cap.home, { route: "grok", direction: "output", modality: "video_gen", blocker: "zdr", reason: "probe named the ZDR gate", cli_version: "9.9.9" });
      capRegistry.module.writeOverlayEntry(cap.home, { route: "gemini", direction: "input", modality: "image", blocker: "auth_tier", cli_version: "9.9.9" });
      const snap = await capabilitiesSnapshot(capDeps);
      const grokVideo = snap.value?.generation?.grok?.cells?.find((c) => c.cell === "video_gen");
      checks.capabilities_matrix_served = snap.status === 200 && snap.value.routes.codex.input.image.level === "verified" && snap.value.routes.grok.output.video_gen.blocker === "zdr"
        && snap.value.blockers.some((b) => b.route === "grok" && b.modality === "video_gen" && b.source === "overlay" && /privacy|bucket/.test(b.clearing_action) && typeof b.expires_at === "string")
        && grokVideo?.blocked === true && /privacy|bucket/.test(grokVideo.clearing_action) && snap.value.generation.grok.open === 1
        && /quota is spent/.test(snap.value.generation.grok.disclosure) && !snap.value.generation.grok.disclosure.includes("video_gen") && snap.value.generation.claude.disclosure === null
        && snap.value.pipelines.image_critique.routes.includes("codex") && !snap.value.pipelines.image_critique.routes.includes("gemini") && !snap.value.pipelines.image_critique.routes.includes("grok")
        && snap.value.pipelines.image_critique.blocked.some((b) => b.route === "gemini" && b.blocker === "auth_tier") && snap.value.pipelines.video_generation.routes.length === 0
        && Array.isArray(snap.value.input_modalities) && snap.value.probes.running.length === 0 && snap.value.levels.length === 4;
      const upgraded = await capabilitiesSnapshot({ ...capDeps, installedVersions: { ...versions, grok: "10.0.0" } });
      checks.capabilities_stale_overlay_reads_reprobe = upgraded.value.routes.grok.output.video_gen.blocker === "reprobe"
        && upgraded.value.blockers.some((b) => b.route === "grok" && b.blocker === "reprobe" && /probes\.mjs grok --modalities/.test(b.clearing_action));
      // The fake CLI answers the colour probe by LOOKING at the PNG it was handed (stored-deflate
      // pixels at a fixed offset), and "generates" by writing a file where the registry glob looks.
      const colourOf = (file) => { const b = fs.readFileSync(file); const [r, g, bl] = [b[49], b[50], b[51]]; return r > 200 && g > 200 ? "yellow" : r > 200 ? "red" : g > 150 ? "green" : bl > 150 ? "blue" : "unknown"; };
      const generatedAt = { codex: path.join(cap.home, ".codex", "generated_images", "s", "exec-1.png"), grok: path.join(cap.home, ".grok", "sessions", "s", "images", "1.jpg") };
      const fakeExecFor = (route, calls) => async (command, args, options) => {
        calls.push(args);
        if (args[0] === "--version") return { code: 0, stdout: "9.9.9", stderr: "" };
        const blob = [...args, options.input].filter((v) => typeof v === "string").join("\n");
        const png = /This is a capability probe/.test(blob) ? blob.match(/(\S*probe\.png)\b/)?.[1]?.replace(/^@/, "") : null;
        if (png) return { code: 0, stdout: route === "grok" ? JSON.stringify({ text: colourOf(png) }) : colourOf(png), stderr: "" };
        if (/capability probe/.test(blob)) return { code: 0, stdout: route === "grok" ? JSON.stringify({ text: "The page says something." }) : "The page says something.", stderr: "" };
        fs.mkdirSync(path.dirname(generatedAt[route]), { recursive: true }); fs.writeFileSync(generatedAt[route], "bytes");
        return { code: 0, stdout: route === "grok" ? JSON.stringify({ text: "written" }) : "written", stderr: "" };
      };
      const settle = async (job) => { for (let i = 0; i < 500 && job.status === "running"; i += 1) await new Promise((resolve) => setTimeout(resolve, 10)); return job; };
      const refusedCalls = [];
      const refusedDeps = { ...capDeps, exec: fakeExecFor("codex", refusedCalls) };
      const noConsent = await handleCapabilities({ op: "probe", cli: "codex", generate: true }, refusedDeps);
      const wrongDisclosure = await handleCapabilities({ op: "probe", cli: "codex", generate: true, consent: true, disclosure: "something else" }, refusedDeps);
      const stringConsent = await handleCapabilities({ op: "probe", cli: "codex", generate: true, consent: "true", disclosure: snap.value.generation.codex.disclosure }, refusedDeps);
      const nothingAsked = await handleCapabilities({ op: "probe", cli: "codex" }, refusedDeps);
      const unknownRoute = await handleCapabilities({ op: "probe", cli: "nobody", inputs: true }, refusedDeps);
      const noGenerativeCell = await handleCapabilities({ op: "probe", cli: "claude", generate: true, consent: true, disclosure: "" }, refusedDeps);
      checks.capabilities_probe_without_consent_refused = noConsent.status === 409 && noConsent.value.disclosure === snap.value.generation.codex.disclosure && /consent/i.test(noConsent.value.error)
        && wrongDisclosure.status === 409 && stringConsent.status === 409 && nothingAsked.status === 400 && unknownRoute.status === 400 && noGenerativeCell.status === 409 && /no generative cell/.test(noGenerativeCell.value.error)
        && refusedCalls.length === 0;
      const inputCalls = [];
      const inputsJob = await handleCapabilities({ op: "probe", cli: "codex", inputs: true }, { ...capDeps, exec: fakeExecFor("codex", inputCalls) });
      const busy = await handleCapabilities({ op: "probe", cli: "codex", inputs: true }, { ...capDeps, exec: fakeExecFor("codex", inputCalls) });
      await settle(inputsJob.value);
      const imageCell = inputsJob.value.result?.cells?.find((c) => c.modality === "image");
      checks.capabilities_input_probe_runs_and_records = inputsJob.status === 202 && inputsJob.value.kind === "modality" && busy.status === 409 && inputsJob.value.status === "success"
        && imageCell?.status === "verified" && imageCell.overlay_written === true && inputsJob.value.result.cells.find((c) => c.modality === "image_gen")?.status === "skipped"
        && inputCalls.filter((a) => a[0] !== "--version").length === 1 && inputCalls.some((a) => a[0] === "exec" && a[1] === "-i")
        && fs.existsSync(path.join(cap.cwd, ".ensemble_reviews", "probes.jsonl")) && (await capabilitiesSnapshot(capDeps)).value.probes.last.codex?.verdict === "pass";
      const genCalls = [];
      const genJob = await handleCapabilities({ op: "probe", cli: "codex", generate: true, consent: true, disclosure: snap.value.generation.codex.disclosure }, { ...capDeps, exec: fakeExecFor("codex", genCalls) });
      await settle(genJob.value);
      const genCells = genJob.value.result?.cells ?? [];
      checks.capabilities_generation_probe_sends_one_request_after_exact_consent = genJob.status === 202 && genJob.value.status === "success"
        && genJob.value.disclosed.length === 1 && genJob.value.disclosed[0] === snap.value.generation.codex.disclosure
        && genCalls.filter((a) => a[0] !== "--version").length === 1 && genCalls.some((a) => a.includes("workspace-write"))
        && genCells.find((c) => c.modality === "image_gen")?.status === "verified" && genCells.find((c) => c.modality === "image_gen").harvested.length === 1
        && genCells.find((c) => c.modality === "image")?.status === "skipped" && /not requested/.test(genCells.find((c) => c.modality === "image").reason)
        && (await capabilitiesSnapshot(capDeps)).value.routes.codex.output.image_gen.level === "verified";
      const grokCalls = [];
      const grokJob = await handleCapabilities({ op: "probe", cli: "grok", generate: true, consent: true, disclosure: snap.value.generation.grok.disclosure }, { ...capDeps, exec: fakeExecFor("grok", grokCalls) });
      await settle(grokJob.value);
      const grokCells = grokJob.value.result?.cells ?? [];
      const videoCell = grokCells.find((c) => c.modality === "video_gen");
      // Keep the original conjunction, but expose each safe boolean: a failed harvest
      // must not be indistinguishable from accidentally dispatching a blocked cell.
      const generationChecks = {
        capabilities_generation_job_admitted: grokJob.status === 202,
        capabilities_generation_video_skipped: videoCell?.status === "skipped",
        capabilities_generation_video_blocker_preserved: videoCell?.blocker === "zdr",
        capabilities_generation_clearing_action_present: /privacy|bucket/.test(videoCell?.clearing_action),
        capabilities_generation_exactly_one_request: grokCalls.filter((a) => a[0] !== "--version").length === 1,
        capabilities_generation_no_video_request: !grokCalls.some((a) => a.join(" ").includes("image_to_video")),
        capabilities_generation_image_request_present: grokCalls.some((a) => a.join(" ").includes("image_gen tool")),
        capabilities_generation_skip_disclosed: grokJob.value.disclosed.some((t) => /skipped, blocker zdr/.test(t)),
        capabilities_generation_image_harvest_verified: grokCells.find((c) => c.modality === "image_gen")?.status === "verified",
      };
      Object.assign(checks, generationChecks);
      checks.capabilities_generation_skips_blocked_cells = Object.values(generationChecks).every(Boolean);
      const planned = await handleCapabilities({ op: "plan", need: { input: ["text"], output: ["image"] } }, capDeps);
      const blockedPlan = await handleCapabilities({ op: "plan", need: { chain: ["text", "image", "video"] } }, capDeps);
      const badNeed = await handleCapabilities({ op: "plan", need: { input: ["hologram"] } }, capDeps);
      checks.capabilities_plan_renders = planned.status === 200 && planned.value.plan.possible === true && planned.value.plan.steps.length === 1 && ["codex", "antigravity", "grok"].includes(planned.value.plan.routes_used[0])
        && blockedPlan.status === 200 && blockedPlan.value.plan.possible === false && blockedPlan.value.plan.blocked_by.some((b) => b.route === "grok" && b.blocker === "zdr" && /privacy|bucket/.test(b.clearing_action))
        && badNeed.status === 400 && (await handleCapabilities({ op: "plan" }, capDeps)).status === 400 && (await handleCapabilities({ op: "plan", need: [] }, capDeps)).status === 400 && (await handleCapabilities({ op: "nuke" }, capDeps)).status === 400;
      const gone = { module: null, plan: null, error: "gone" };
      checks.capabilities_registry_absent_is_503 = (await capabilitiesSnapshot({ registry: gone })).status === 503 && (await handleCapabilities({ op: "plan", need: {} }, { registry: gone })).status === 503;
    }
  } catch (error) {
    recordRegressionThrow(checks, error);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  return checks;
}

async function selfTest() {
  // A child that outlives its budget must be reported as timed out — the
  // listener-order regression this guards against was found by momm review.
  const timedOutProbe = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { timeoutMs: 100 });
  const regression = await dashboardRegression();
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
    modalities_match_dispatcher: dispatcherModalities !== null && Object.keys(providers).every((agent) => JSON.stringify([...providers[agent].modalities].sort()) === JSON.stringify([...(dispatcherModalities[agent] ?? [])].sort())),
    // 1.16 E7: the Modalities panel markup, its script and styles are present.
    modalities_panel_present_in_ui: (() => {
      try {
        const html = fs.readFileSync(path.join(assetDir, "index.html"), "utf8"), js = fs.readFileSync(path.join(assetDir, "app.js"), "utf8"), css = fs.readFileSync(path.join(assetDir, "styles.css"), "utf8");
        return ['id="capabilities-grid"', 'id="capabilities-summary"', 'id="plan-form"', 'id="plan-result"', 'id="capabilities-refresh"'].every((id) => html.includes(id))
          && ["renderCapabilities", "renderPlan", "/api/capabilities", "data-cap-probe", "window.confirm", "disclosure"].every((needle) => js.includes(needle))
          && [".cap-chip", ".cap-blocker", ".cap-verified", ".cap-documented", ".cap-model-only", ".cap-no", ".cap-table"].every((rule) => css.includes(rule))
          && !/all five reviewers/i.test(html) && !/all five reviewers/i.test(js);
      } catch { return false; }
    })(),
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
    assets_present: ["index.html", "momm-theme.css", "styles.css", "app.js"].every((file) => fs.existsSync(path.join(assetDir, file))),
    theme_toggle_markup_present: (() => {
      try {
        const html = fs.readFileSync(path.join(assetDir, "index.html"), "utf8"), js = fs.readFileSync(path.join(assetDir, "app.js"), "utf8"), css = fs.readFileSync(path.join(assetDir, "momm-theme.css"), "utf8");
        return html.includes('id="theme-toggle"') && js.includes("momm-setup-theme") && js.includes('setAttribute("data-theme"') && css.includes('[data-theme="dark"]') && css.includes("prefers-color-scheme: dark") && css.includes(".theme-toggle") && css.includes(".orbit");
      } catch { return false; }
    })(),
    // One design system: the theme is served as CSS and linked before styles.css.
    theme_asset_served_as_css: STATIC_ASSETS["/momm-theme.css"]?.[0] === "momm-theme.css" && STATIC_ASSETS["/momm-theme.css"]?.[1] === "text/css; charset=utf-8"
      && (() => { try { const html = fs.readFileSync(path.join(assetDir, "index.html"), "utf8"); const theme = html.indexOf('href="/momm-theme.css"'), styles = html.indexOf('href="/styles.css"'); return theme >= 0 && styles > theme; } catch { return false; } })(),
    // Single source of tokens: every shared token is declared in the theme and none is redefined by styles.css.
    styles_never_redefine_theme_tokens: (() => {
      try {
        const theme = fs.readFileSync(path.join(assetDir, "momm-theme.css"), "utf8"), styles = fs.readFileSync(path.join(assetDir, "styles.css"), "utf8");
        const tokens = ["ink", "muted", "paper", "card", "line", "green", "green-bright", "mint", "amber", "amber-soft", "red", "red-soft", "shadow", "glass", "pill", "hairline", "toast-bg", "toast-ink", "light-button-bg", "light-button-ink", "on-green", "font-display", "font-sans", "font-mono", "ease", "dur", "dur-fast"];
        const declared = (css, name) => new RegExp(`--${name}\\s*:`).test(css);
        return tokens.every((name) => declared(theme, name) && !declared(styles, name)) && !/(^|\s):root(?:\[data-theme="dark"\]|:not\(\[data-theme="light"\]\))?\s*\{/m.test(styles) && !/@keyframes (rise|sweep|pulse|toast-in|breathe)/.test(styles);
      } catch { return false; }
    })(),
    ledger_nav_pill_present: (() => {
      try {
        const html = fs.readFileSync(path.join(assetDir, "index.html"), "utf8"), js = fs.readFileSync(path.join(assetDir, "app.js"), "utf8");
        return html.includes('class="momm-nav"') && html.includes('id="ledger-link" href="/ledger"') && html.includes('class="momm-topbar"') && js.includes("report.ledger_url");
      } catch { return false; }
    })(),
    new_panels_present_in_ui: (() => {
      try {
        const html = fs.readFileSync(path.join(assetDir, "index.html"), "utf8");
        return ['id="guidance-editor"', 'id="usage-table"', 'id="maintenance-grid"'].every((id) => html.includes(id));
      } catch { return false; }
    })(),
    guidance_body_limit_fits_every_block: GUIDANCE_BODY_LIMIT >= (GUIDANCE_ROUTES.length + 2) * GUIDANCE_BUDGET.per_block * 4,
    ...regression,
  };
  const { passed, failing } = summarizeChecks(tests);
  process.stdout.write(`${JSON.stringify({ passed, failing, tests }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
}

// Bind before anything with side effects: the ledger watcher starts only once
// the socket is listening, and a failed bind stops it again so no watcher
// outlives a server that never came up.
function startSetupCenter({ server, watcher, clock, port, browser, pointer }) {
  server.on("error", (error) => {
    watcher?.stop();
    process.stderr.write(`MOMM Setup Center could not start: ${safeDetail(error.message)}\n`);
    process.exitCode = 1;
  });
  server.on("close", () => pointer?.remove?.());
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/`;
    // Fragments are not sent in HTTP requests or Referer headers. Do not put
    // this capability into setup-center.json or a generated ledger/export.
    const launchUrl = `${url}#momm-token=${sessionToken}`;
    process.stdout.write(`MOMM Setup Center: ${launchUrl}\n`);
    process.stdout.write("Private launch link: do not share it.\n");
    process.stdout.write("Local-only. No source code or credential contents are read during setup.\n");
    if (browser) openBrowser(launchUrl);
    triggerClock(clock, "setup.open"); // fire-and-forget; due sources only; triggerClock never rejects
    pointer?.write?.(url); // the ledger links back here while this pid is alive
    watcher?.start();
  });
}

let options;
try { options = parseArgs(process.argv.slice(2)); }
catch (error) { process.stderr.write(`${error.message}\n${usage()}\n`); process.exit(1); }
if (options.help) { process.stdout.write(`${usage()}\n`); process.exit(0); }
if (options.selfTest) { await selfTest(); }
else {
  activeServer = createServer();
  updateClock = createServerClock();
  ledgerWatcher = createLedgerWatcher({ dir: path.join(process.cwd(), ".ensemble_reviews"), run: () => runNode(ledgerScript, [], { timeoutMs: 60_000 }) });
  setupPointer = createSetupCenterPointer();
  startSetupCenter({ server: activeServer, watcher: ledgerWatcher, clock: updateClock, port: options.port, browser: options.browser, pointer: setupPointer });
}
