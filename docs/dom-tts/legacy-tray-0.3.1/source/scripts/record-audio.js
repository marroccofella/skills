const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { STATE, ensureState, loadConfig, ffmpegPath, writeStatus } = require("./voice-runtime");
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
  const ffmpeg = ffmpegPath();
  const device = args.device || config.audio?.captureDevice || "";
  const seconds = Number(args.seconds || config.stt?.recordSeconds || 6);
  const sampleRate = Number(args.sampleRate || config.stt?.sampleRate || 16000);
  const output = args.output || path.join(STATE, `duplex-recording-${Date.now()}.wav`);
  if (!ffmpeg) throw new Error("ffmpeg is required for microphone capture.");
  if (!device) throw new Error("No microphone capture device configured. Set audio.captureDevice in assets/voice-runtime.json.");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  appendTelemetry({ event: "recording_started", device, seconds });
  writeStatus({ state: "recording", runtimeMode: "duplex", captureDevice: device });
  writeAvatarStatus({ phase: "listening", captureDevice: device, error: null });
  const result = spawnSync(ffmpeg, [
    "-y",
    "-f", "dshow",
    "-i", `audio=${device}`,
    "-t", String(seconds),
    "-ac", "1",
    "-ar", String(sampleRate),
    output,
  ], { encoding: "utf8", windowsHide: true, timeout: Math.max(15000, (seconds + 10) * 1000) });
  if (result.status !== 0 || !fs.existsSync(output)) {
    throw new Error((result.stderr || result.stdout || `ffmpeg exited ${result.status}`).trim());
  }
  appendTelemetry({ event: "recording_stopped", file: output, bytes: fs.statSync(output).size });
  writeStatus({ state: "recorded", runtimeMode: "duplex", lastRecording: output });
  writeAvatarStatus({ phase: "thinking", lastRecording: output });
  console.log(output);
}

try {
  main();
} catch (error) {
  writeStatus({ state: "error", runtimeMode: "duplex", error: error.message });
  writeAvatarStatus({ phase: "error", error: error.message });
  console.error(error.message);
  process.exitCode = 1;
}
