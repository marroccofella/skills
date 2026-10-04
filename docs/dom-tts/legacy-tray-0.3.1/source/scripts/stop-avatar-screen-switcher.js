const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { STATE, ensureState, readJson, writeJson } = require("./avatar-state");
const { appendTelemetry } = require("./telemetry");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[i + 1] || "";
      i += 1;
    }
  }
  return args;
}

function killPid(value, killed) {
  const pid = String(value || "").trim();
  if (!/^\d+$/.test(pid) || pid === String(process.pid) || killed.has(pid)) return;
  killed.add(pid);
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", pid, "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try { process.kill(Number(pid), "SIGTERM"); } catch {}
  }
}

function switcherFiles(deviceId) {
  if (!fs.existsSync(STATE)) return [];
  const names = fs.readdirSync(STATE).filter(name => /^avatar-screen-switcher-.+\.json$/i.test(name));
  return names
    .filter(name => !deviceId || name.toLowerCase() === `avatar-screen-switcher-${deviceId}.json`)
    .map(name => path.join(STATE, name));
}

function main() {
  ensureState();
  const args = parseArgs(process.argv.slice(2));
  const deviceId = String(args.device || "").trim().toLowerCase();
  const killed = new Set();
  for (const file of switcherFiles(deviceId)) {
    const status = readJson(file, {});
    killPid(status.browserPid, killed);
    killPid(status.pid, killed);
    writeJson(file, { ...status, active: false, browserPid: null, stoppedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -like '*avatar-screen-switcher.js*' } | Select-Object -ExpandProperty ProcessId",
    ], { encoding: "utf8", windowsHide: true });
    for (const line of String(result.stdout || "").split(/\r?\n/)) killPid(line, killed);
  }
  appendTelemetry({ event: "avatar_screen_switcher_stop_requested", deviceId: deviceId || undefined, killed: [...killed] });
  console.log(`Dom TTS Avatar screen switcher stopped (${killed.size} process${killed.size === 1 ? "" : "es"}).`);
}

main();
