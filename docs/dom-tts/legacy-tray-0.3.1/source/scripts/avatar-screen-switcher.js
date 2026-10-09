const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  ROOT,
  STATE,
  ensureState,
  readJson,
  writeJson,
  loadAvatarConfig,
} = require("./avatar-state");
const { appendTelemetry } = require("./telemetry");

const SWITCHER_NAME = "avatar-screen-switcher.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-launch") args.noLaunch = true;
    else if (arg === "--no-start-server") args.noStartServer = true;
    else if (arg === "--once") args.once = true;
    else if (arg === "--lock-page") args.lockPage = true;
    else if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[i + 1] || "";
      i += 1;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function statusFile(deviceId) {
  return path.join(STATE, `avatar-screen-switcher-${deviceId}.json`);
}

function normalizeDeviceId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAgentId(value) {
  const id = String(value || "").trim().toLowerCase();
  return id === "bob" || id === "bab" ? id : "";
}

function requestJson(url, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: "GET",
      timeout: timeoutMs,
      headers: { Accept: "application/json" },
    }, response => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { data += chunk; });
      response.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("request timed out")));
    request.on("error", reject);
    request.end();
  });
}

function commandPath(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
    const probe = process.platform === "win32"
      ? spawnSync("where.exe", [candidate], { encoding: "utf8", windowsHide: true })
      : spawnSync("which", [candidate], { encoding: "utf8" });
    if (probe.status === 0) {
      const found = String(probe.stdout || "").split(/\r?\n/).map(line => line.trim()).find(Boolean);
      if (found) return found;
    }
  }
  return "";
}

function browserPath() {
  if (process.platform === "win32") {
    return commandPath([
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
      "msedge.exe",
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      "chrome.exe",
    ]);
  }
  return commandPath(["microsoft-edge", "google-chrome", "chromium", "chromium-browser"]);
}

function closeProcessTree(pid) {
  const target = String(pid || "").trim();
  if (!/^\d+$/.test(target)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", target, "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try { process.kill(Number(target), "SIGTERM"); } catch {}
}

function launchBrowser(url, deviceId, noLaunch) {
  if (noLaunch) return { pid: null, skipped: true };
  const executable = browserPath();
  if (!executable) throw new Error("Could not find Microsoft Edge or Chrome for avatar screen switching.");
  const profileDir = path.join(STATE, `avatar-screen-${deviceId}-browser-profile`);
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    `--user-data-dir=${profileDir}`,
    "--new-window",
    "--start-fullscreen",
    `--app=${url}`,
  ];
  const child = spawn(executable, args, {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return { pid: child.pid, executable };
}

function deviceEntry(config, deviceId) {
  return config.devices?.map?.[deviceId] || null;
}

function assignedAgent(config, deviceId) {
  return normalizeAgentId(deviceEntry(config, deviceId)?.agent);
}

function isBusyPhase(phase) {
  return ["listening", "thinking", "speaking", "error"].includes(String(phase || "").toLowerCase());
}

function truthy(value) {
  return value === true || value === 1 || String(value || "").toLowerCase() === "true" || String(value || "").toLowerCase() === "1";
}

function deviceLockPage(snapshot, deviceId, deviceStatus = {}) {
  const fromSnapshot = snapshot.deviceStatus?.[deviceId] || snapshot.devices?.status?.[deviceId] || snapshot.devices?.[deviceId] || {};
  return Boolean(
    truthy(deviceStatus.lockPage) ||
    truthy(deviceStatus.locked) ||
    truthy(fromSnapshot.lockPage) ||
    truthy(fromSnapshot.locked) ||
    snapshot.lockPageDevice === deviceId ||
    snapshot.lockedDevice === deviceId
  );
}

function shouldShowAvatar(snapshot, deviceId, deviceStatus = {}) {
  const agent = assignedAgent(snapshot.config || {}, deviceId);
  if (!agent) return false;
  const activeForAgent = normalizeAgentId(snapshot.activeAgent) === agent && isBusyPhase(snapshot.phase);
  const showOnLockPage = snapshot.config?.devices?.showOnLockPage !== false;
  return Boolean(activeForAgent || (showOnLockPage && deviceLockPage(snapshot, deviceId, deviceStatus)));
}

function avatarUrl(baseUrl, deviceId) {
  const base = new URL(baseUrl);
  base.pathname = "/";
  base.search = `?device=${encodeURIComponent(deviceId)}&fullscreen=1&autoswitch=1`;
  return base.toString();
}

function deviceStatusFile(deviceId) {
  return path.join(STATE, `avatar-device-${deviceId}.json`);
}

function readDeviceStatus(deviceId, args = {}) {
  const status = readJson(deviceStatusFile(deviceId), {});
  return {
    ...status,
    lockPage: truthy(args.lockPage) || truthy(process.env.DOM_TTS_AVATAR_LOCK_PAGE) || truthy(status.lockPage) || truthy(status.locked),
  };
}

async function healthyBaseUrl(args, config) {
  const status = readJson(path.join(STATE, "avatar-status.json"), {});
  const candidates = [
    args.url,
    status.url,
    `http://${config.host || "127.0.0.1"}:${Number(args.port || config.port || 42742)}/`,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const health = await requestJson(new URL("/health", candidate).toString(), 1200);
      if (health.ok) return new URL("/", candidate).toString();
    } catch {}
  }
  return "";
}

async function ensureAvatarServer(args, deviceId, config) {
  let base = await healthyBaseUrl(args, config);
  if (base || args.noStartServer) return base;
  const child = spawn(process.execPath, [path.join(__dirname, "avatar-server.js"), "--device", deviceId, "--no-open"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    base = await healthyBaseUrl(args, config);
    if (base) return base;
    await sleep(250);
  }
  throw new Error("Avatar server did not become healthy.");
}

function writeSwitcherStatus(deviceId, patch) {
  const file = statusFile(deviceId);
  const current = readJson(file, {});
  const next = {
    ...current,
    ...patch,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  };
  writeJson(file, next);
  return next;
}

async function main() {
  ensureState();
  const args = parseArgs(process.argv.slice(2));
  const deviceId = normalizeDeviceId(args.device || process.env.DOM_TTS_AVATAR_DEVICE || "");
  const config = loadAvatarConfig();
  if (!deviceId || !deviceEntry(config, deviceId)) {
    throw new Error("Use --device sb2 or --device sb3.");
  }
  const agent = assignedAgent(config, deviceId);
  const base = await ensureAvatarServer(args, deviceId, config);
  if (!base) throw new Error("Avatar server is not running.");
  const url = avatarUrl(base, deviceId);
  const pollMs = Math.max(150, Number(args.pollMs || config.devices?.switcherPollMs || 300));
  const idleDelayMs = Math.max(250, Number(args.idleDelayMs || config.devices?.idleReturnDelayMs || 1200));

  if (args.once) {
    const snapshot = await requestJson(new URL("/snapshot", base).toString());
    const deviceStatus = readDeviceStatus(deviceId, args);
    const active = shouldShowAvatar(snapshot, deviceId, deviceStatus);
    console.log(JSON.stringify({ ok: true, deviceId, agent, base, url, active, lockPage: Boolean(deviceStatus.lockPage), phase: snapshot.phase, activeAgent: snapshot.activeAgent }, null, 2));
    return;
  }

  let avatarWindowOpen = false;
  let browserPid = null;
  let inactiveSince = 0;
  writeSwitcherStatus(deviceId, { deviceId, agent, base, url, active: false, browserPid: null, error: null });
  appendTelemetry({ event: "avatar_screen_switcher_started", deviceId, agent, url, pid: process.pid });

  async function closeAvatarWindow(reason) {
    if (browserPid) closeProcessTree(browserPid);
    appendTelemetry({ event: "avatar_screen_switcher_closed", deviceId, agent, reason, browserPid });
    avatarWindowOpen = false;
    browserPid = null;
    inactiveSince = 0;
    writeSwitcherStatus(deviceId, { active: false, phase: "idle", browserPid: null, reason, error: null });
  }

  async function shutdown() {
    await closeAvatarWindow("shutdown");
    writeSwitcherStatus(deviceId, { stoppedAt: new Date().toISOString(), active: false, browserPid: null });
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  for (;;) {
    try {
      const snapshot = await requestJson(new URL("/snapshot", base).toString());
      const deviceStatus = readDeviceStatus(deviceId, args);
      const active = shouldShowAvatar(snapshot, deviceId, deviceStatus);
      if (active) {
        inactiveSince = 0;
        if (!avatarWindowOpen) {
          const launched = launchBrowser(url, deviceId, args.noLaunch);
          browserPid = launched.pid;
          avatarWindowOpen = true;
          appendTelemetry({ event: "avatar_screen_switcher_opened", deviceId, agent, url, browserPid, noLaunch: args.noLaunch || undefined });
        }
        writeSwitcherStatus(deviceId, { active: true, lockPage: Boolean(deviceStatus.lockPage), phase: snapshot.phase, activeAgent: snapshot.activeAgent, browserPid, error: null });
      } else if (avatarWindowOpen) {
        if (!inactiveSince) inactiveSince = Date.now();
        if (Date.now() - inactiveSince >= idleDelayMs) await closeAvatarWindow("idle");
      } else {
        writeSwitcherStatus(deviceId, { active: false, lockPage: Boolean(deviceStatus.lockPage), phase: "idle", activeAgent: snapshot.activeAgent, browserPid: null, error: null });
      }
    } catch (error) {
      writeSwitcherStatus(deviceId, { error: error.message });
      appendTelemetry({ event: "avatar_screen_switcher_error", deviceId, error: error.message });
    }
    await sleep(pollMs);
  }
}

if (require.main === module) {
  main().catch(error => {
    ensureState();
    const deviceId = normalizeDeviceId(process.argv.includes("--device") ? process.argv[process.argv.indexOf("--device") + 1] : "");
    if (deviceId) writeSwitcherStatus(deviceId, { error: error.message });
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  shouldShowAvatar,
  deviceLockPage,
  avatarUrl,
  SWITCHER_NAME,
};
