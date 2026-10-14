const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { writeAvatarStatus } = require("./avatar-state");
const { taskkill, safeEnv, playbackProcessLooksOwned, readObject } = require("./runtime");

const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const STOP = path.join(STATE, "stop.flag");
const PID = path.join(STATE, "current.pid");
const LOCK = path.join(STATE, "playback.lock");
const STATUS = path.join(STATE, "status.json");

function readJson(file, fallback) {
  return readObject(file, fallback);
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(STOP, new Date().toISOString(), "utf8");

const pid = fs.existsSync(PID) ? fs.readFileSync(PID, "utf8").trim() : "";
if (/^\d+$/.test(pid)) {
  if (process.platform === "win32") {
    if (playbackProcessLooksOwned(pid)) {
      spawnSync(taskkill, ["/PID", pid, "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 5000, env: safeEnv() });
    }
  } else {
    // Playback is Windows-only; never signal a PID on another platform.
  }
}

// The playback owner clears its own PID and lock after observing the stop.

writeJson(STATUS, {
  ...readJson(STATUS, {}),
  state: "stopped",
  error: null,
  stoppedAt: new Date().toISOString(),
});
writeAvatarStatus({ phase: "idle", speakingText: null, error: null });

console.log("stopped");
