const { spawnSync } = require("child_process");
const { AVATAR_STATUS, readJson, writeAvatarStatus } = require("./avatar-state");
const { appendTelemetry } = require("./telemetry");

const status = readJson(AVATAR_STATUS, {});
const pid = String(status.pid || "").trim();
const killed = new Set();

function killPid(value) {
  const target = String(value || "").trim();
  if (!/^\d+$/.test(target) || killed.has(target) || target === String(process.pid)) return;
  killed.add(target);
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", target, "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try { process.kill(Number(target), "SIGTERM"); } catch {}
  }
}

killPid(pid);

if (process.platform === "win32") {
  const scriptName = "avatar-server.js";
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    `Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -like '*${scriptName}*' } | Select-Object -ExpandProperty ProcessId`,
  ], { encoding: "utf8", windowsHide: true });
  for (const line of String(result.stdout || "").split(/\r?\n/)) killPid(line);
}

writeAvatarStatus({ pid: null, phase: "stopped", stoppedAt: new Date().toISOString(), error: null });
appendTelemetry({ event: "avatar_server_stop_requested", pid: pid || undefined, killed: [...killed] });
console.log("Dom TTS Avatar stopped.");
