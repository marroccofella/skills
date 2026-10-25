const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { STATE, ensureState, loadConfig, whisperPath, writeStatus } = require("./voice-runtime");
const { appendTelemetry } = require("./telemetry");
const { writeAvatarStatus } = require("./avatar-state");

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

function main() {
  ensureState();
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const whisper = whisperPath(config);
  const model = args.model || config.stt?.modelPath || "";
  const audio = args.audio || args.file || "";
  const outBase = path.join(STATE, `duplex-stt-${Date.now()}`);
  if (!whisper) throw new Error("Whisper.cpp executable not found. Set stt.whisperPath in assets/voice-runtime.json.");
  if (!model || !fs.existsSync(model)) throw new Error("Whisper.cpp modelPath is not configured or does not exist.");
  if (!audio || !fs.existsSync(audio)) throw new Error("Audio file is missing.");
  appendTelemetry({ event: "stt_started", provider: "whisper.cpp", audio });
  writeStatus({ state: "transcribing", runtimeMode: "duplex", audio });
  writeAvatarStatus({ phase: "thinking", audio, error: null });
  const result = spawnSync(whisper, [
    "-m", model,
    "-f", audio,
    "-otxt",
    "-of", outBase,
    "-l", config.stt?.language || "en",
  ], { encoding: "utf8", windowsHide: true, timeout: 120000 });
  const txt = `${outBase}.txt`;
  let text = "";
  if (fs.existsSync(txt)) text = fs.readFileSync(txt, "utf8").trim();
  if (result.status !== 0 || !text) {
    const fallback = (result.stdout || "").split(/\r?\n/).map(line => line.replace(/^\[[^\]]+\]\s*/, "").trim()).filter(Boolean).join(" ").trim();
    if (result.status !== 0 && !fallback) throw new Error((result.stderr || result.stdout || `whisper exited ${result.status}`).trim());
    text = fallback;
  }
  appendTelemetry({ event: "stt_completed", provider: "whisper.cpp", chars: text.length });
  writeStatus({ state: "transcribed", runtimeMode: "duplex", lastTranscript: text });
  writeAvatarStatus({ phase: "thinking", lastTranscript: text });
  console.log(text);
}

try {
  main();
} catch (error) {
  writeStatus({ state: "error", runtimeMode: "duplex", error: error.message });
  writeAvatarStatus({ phase: "error", error: error.message });
  console.error(error.message);
  process.exitCode = 1;
}
