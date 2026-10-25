const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { writeAvatarStatus } = require("./avatar-state");

const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const STOP = path.join(STATE, "stop.flag");
const PID = path.join(STATE, "current.pid");
const LOCK = path.join(STATE, "playback.lock");
const STATUS = path.join(STATE, "status.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function playbackProcessLooksOwned(pid) {
  if (process.platform !== "win32") return true;
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`,
  ], { encoding: "utf8", windowsHide: true });
  const command = String(result.stdout || "").trim();
  if (!command) return false;
  return /ffplay|WMPlayer\.OCX|System\.Speech|SpeechSynthesizer|edge-\d+|sapi-\d+/i.test(command);
}

fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(STOP, new Date().toISOString(), "utf8");

const pid = fs.existsSync(PID) ? fs.readFileSync(PID, "utf8").trim() : "";
if (/^\d+$/.test(pid)) {
  if (process.platform === "win32") {
    if (playbackProcessLooksOwned(pid)) {
      spawnSync("taskkill.exe", ["/PID", pid, "/T", "/F"], { stdio: "ignore", windowsHide: true });
    }
  } else {
    try { process.kill(Number(pid), "SIGTERM"); } catch {}
  }
}

try { fs.unlinkSync(PID); } catch {}
try { fs.unlinkSync(LOCK); } catch {}

writeJson(STATUS, {
  ...readJson(STATUS, {}),
  state: "stopped",
  error: null,
  stoppedAt: new Date().toISOString(),
});
writeAvatarStatus({ phase: "idle", speakingText: null, error: null });

console.log("stopped");
