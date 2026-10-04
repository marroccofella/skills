const fs = require("fs");
const path = require("path");
const { readTelemetry } = require("./telemetry");

const HOME = process.env.USERPROFILE || process.env.HOME;
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(HOME, ".openclaw");
const OPENCLAW_SESSIONS = path.join(OPENCLAW_HOME, "agents", "main", "sessions");
const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const CURSORS = path.join(STATE, "global-cursors.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function latestEvent(name, sinceMs, predicate = () => true) {
  return [...readTelemetry(700)].reverse().find(event => {
    const time = Date.parse(event.timestamp || "");
    return event.event === name && time >= sinceMs && predicate(event);
  });
}

async function waitFor(label, timeoutMs, predicate) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const watcher = readJson(path.join(STATE, "watcher-status.json"), {});
  if (!["watching", "speaking"].includes(watcher.state) || watcher.watchOpenClaw === "false") {
    throw new Error("Global watcher is not running with OpenClaw enabled. Start it with scripts/start-global-watcher.ps1 -StreamMessages first.");
  }

  fs.mkdirSync(OPENCLAW_SESSIONS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(OPENCLAW_SESSIONS, `dom-tts-openclaw-acceptance-${stamp}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify({
    type: "session",
    version: 3,
    id: `dom-tts-openclaw-acceptance-${stamp}`,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  })}\n`, "utf8");

  await waitFor("OpenClaw watcher cursor registration", 90000, () => {
    const cursors = readJson(CURSORS, {});
    return Object.prototype.hasOwnProperty.call(cursors, file);
  });

  const sinceMs = Date.now();
  const text = `Dom TTS OpenClaw acceptance test. A new OpenClaw assistant update was detected and sent to speech at ${new Date().toLocaleTimeString()}.`;
  const record = {
    type: "message",
    id: "dom-tts-openclaw-test",
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [
        { type: "toolCall", name: "acceptance_probe", arguments: {} },
        { type: "text", text },
      ],
      stopReason: "stop",
      provider: "dom-tts",
      model: "acceptance-test",
      timestamp: Date.now(),
    },
  };
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");

  const detected = await waitFor("OpenClaw watcher_detected telemetry", 20000, () =>
    latestEvent("watcher_detected", sinceMs, event => event.file === file && event.scope === "openclaw"));
  const queued = await waitFor("OpenClaw tts_queued telemetry", 20000, () =>
    latestEvent("tts_queued", sinceMs, event => event.sourceFile === file));
  const started = await waitFor("OpenClaw tts_chunk_started telemetry", 20000, () =>
    latestEvent("tts_chunk_started", Date.parse(queued.timestamp || "")));
  const completed = await waitFor("OpenClaw tts_completed telemetry", 60000, () =>
    latestEvent("tts_completed", Date.parse(queued.timestamp || "")));

  console.log("Dom TTS OpenClaw Acceptance Test");
  console.log(`Synthetic OpenClaw session: ${file}`);
  console.log(`Detected: yes (${detected.timestamp})`);
  console.log(`Queued: yes (${queued.timestamp})`);
  console.log(`TTS started: yes (${started.timestamp})`);
  console.log(`TTS completed: yes (${completed.timestamp})`);
  console.log(`Detection-to-speech latency: ${started.detectionLatencyMs ?? "unknown"} ms`);
  console.log(`Playback duration: ${completed.totalDurationMs ?? "unknown"} ms`);
}

main().catch(error => {
  console.error(`Dom TTS OpenClaw Acceptance Test failed: ${error.message}`);
  process.exitCode = 1;
});
