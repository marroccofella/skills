const fs = require("fs");
const { spawnSync } = require("child_process");
const { ensureState, PID, STOP, writeStatus, stopSpeech } = require("./voice-runtime");
const { appendTelemetry } = require("./telemetry");
const { writeAvatarStatus } = require("./avatar-state");

ensureState();
fs.writeFileSync(STOP, new Date().toISOString(), "utf8");
stopSpeech();

let pid = "";
try { pid = fs.readFileSync(PID, "utf8").trim(); } catch {}
if (/^\d+$/.test(pid) && process.platform === "win32") {
  spawnSync("taskkill.exe", ["/PID", pid, "/T", "/F"], { stdio: "ignore", windowsHide: true });
}
try { fs.unlinkSync(PID); } catch {}
appendTelemetry({ event: "duplex_shell_stop_requested" });
writeStatus({ state: "stopped", runtimeMode: "duplex", stoppedAt: new Date().toISOString() });
writeAvatarStatus({ phase: "idle", speakingText: null, error: null });
console.log("Dom TTS Duplex Shell stopped.");
