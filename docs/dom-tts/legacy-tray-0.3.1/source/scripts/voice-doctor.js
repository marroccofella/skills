const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  ROOT,
  STATE,
  PID,
  loadConfig,
  readJson,
  ollamaModels,
  selectModel,
  resolveAgent,
  whisperPath,
  ffmpegPath,
} = require("./voice-runtime");

function line(label, value, detail = "") {
  console.log(`${label}: ${value}${detail ? ` (${detail})` : ""}`);
}

function shellRunning() {
  try {
    const pid = fs.readFileSync(PID, "utf8").trim();
    if (!/^\d+$/.test(pid)) return "";
    if (process.platform !== "win32") return pid;
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`,
    ], { encoding: "utf8", windowsHide: true });
    return result.stdout.trim();
  } catch {
    return "";
  }
}

function listAudioDevices(ffmpeg) {
  if (!ffmpeg) return "";
  const result = spawnSync(ffmpeg, ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  return `${result.stderr || ""}${result.stdout || ""}`;
}

function probeOllama(model) {
  if (!model) return { ok: false, detail: "no model selected" };
  const result = spawnSync(process.execPath, [
    path.join(ROOT, "scripts", "duplex-shell.js"),
    "--once-text",
    "Hey Dom respond with exactly: duplex ok",
  ], { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 120000 });
  return { ok: result.status === 0, detail: result.status === 0 ? "probe turn completed" : (result.stderr || result.stdout || `exit ${result.status}`).trim() };
}

function main() {
  const probe = process.argv.includes("--probe");
  const config = loadConfig();
  const ffmpeg = ffmpegPath();
  const whisper = whisperPath(config);
  const models = ollamaModels();
  const selected = selectModel(config, "quality");
  const status = readJson(path.join(STATE, "duplex-status.json"), {});
  const personal = resolveAgent(config, "Hey Dom status check");
  const engineering = resolveAgent(config, "Hey Claw status check");
  const bob = resolveAgent(config, "Hay Bob status check");
  const bab = resolveAgent(config, "Hay Bab status check");
  const localOnly = config.privacy?.localOnly !== false;
  const deviceLog = probe ? listAudioDevices(ffmpeg) : "";
  const probeResult = probe ? probeOllama(selected.model) : null;

  console.log("Dom TTS Voice Doctor Report");
  console.log("Product: Dom TTS Agent Voice Runtime by Prof Dom Marrocco / 42.uk");
  line("Standard Mode dependency", "none", "Duplex health does not gate Codex read-aloud");
  line("Duplex Mode configured", config.runtime?.duplexModeEnabled ? "yes" : "opt-in/off by default");
  line("Privacy localOnly", localOnly ? "yes" : "no");
  line("Microphone capture", config.audio?.captureDevice ? "configured" : "not configured", config.audio?.captureDevice || "set audio.captureDevice after selecting a device");
  line("ffmpeg available", ffmpeg ? "yes" : "no", ffmpeg || "needed for microphone capture");
  line("Audio devices discoverable", deviceLog ? "yes" : "not probed", probe ? "ffmpeg dshow probe ran" : "run --probe");
  line("Whisper.cpp available", whisper ? "yes" : "no", whisper || "set stt.whisperPath or install whisper-cli");
  line("Whisper model configured", config.stt?.modelPath && fs.existsSync(config.stt.modelPath) ? "yes" : "no", config.stt?.modelPath || "set stt.modelPath");
  line("Ollama models visible", models.length ? "yes" : "no", models.length ? `${models.length} installed` : "ollama list returned none");
  line("Selected quality model", selected.model || "none", selected.fallbackUsed ? "fallback used" : "preferred when installed");
  line("Agent router personal", personal.id, personal.agent?.wakePhrase || "");
  line("Agent router engineering", engineering.id, engineering.agent?.wakePhrase || "");
  line("Agent router Bob", bob.id, bob.agent?.wakePhrase || "");
  line("Agent router Bab", bab.id, bab.agent?.wakePhrase || "");
  line("Shell running", shellRunning() ? "yes" : "no", shellRunning() ? `pid ${shellRunning()}` : "");
  line("Last shell state", status.state || "none");
  line("Last agent", status.agent || "none");
  line("Last error", status.error || "none");
  if (probeResult) {
    line("Ollama duplex probe", probeResult.ok ? "yes" : "no", probeResult.detail);
  }
  const strict = process.argv.includes("--strict");
  const ok = localOnly && models.length > 0 && (!strict || (ffmpeg && whisper && config.stt?.modelPath && config.audio?.captureDevice && (!probeResult || probeResult.ok)));
  process.exitCode = ok ? 0 : 1;
}

main();
