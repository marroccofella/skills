const fs = require("fs");
const path = require("path");
const { readTelemetry } = require("./telemetry");

const HOME = process.env.USERPROFILE || process.env.HOME;
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const SESSIONS = path.join(CODEX_HOME, "sessions");
const CURSORS = path.join(STATE, "global-cursors.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function latestEvent(name, sinceMs, predicate = () => true) {
  return [...readTelemetry(500)].reverse().find(event => {
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
  if (!["watching", "speaking"].includes(watcher.state) || watcher.scope !== "all") {
    throw new Error("Global watcher is not running. Start it with scripts/start-global-watcher.ps1 first.");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const testDir = path.join(SESSIONS, "dom-tts-acceptance");
  const file = path.join(testDir, `rollout-${stamp}.jsonl`);
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(file, "", "utf8");

  await waitFor("global watcher cursor registration", 90000, () => {
    const cursors = readJson(CURSORS, {});
    return Object.prototype.hasOwnProperty.call(cursors, file);
  });

  const sinceMs = Date.now();
  const text = `Dom TTS acceptance test. A new Codex final answer was detected and sent to speech at ${new Date().toLocaleTimeString()}.`;
  const record = {
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      phase: "final_answer",
      content: [{ type: "output_text", text }],
    },
  };
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");

  const detected = await waitFor("watcher_detected telemetry", 20000, () =>
    latestEvent("watcher_detected", sinceMs, event => event.file === file));
  const queued = await waitFor("tts_queued telemetry", 20000, () =>
    latestEvent("tts_queued", sinceMs, event => event.sourceFile === file));
  const started = await waitFor("tts_chunk_started telemetry", 20000, () =>
    latestEvent("tts_chunk_started", Date.parse(queued.timestamp || "")));
  const completed = await waitFor("tts_completed telemetry", 60000, () =>
    latestEvent("tts_completed", Date.parse(queued.timestamp || "")));

  console.log("Dom TTS Acceptance Test");
  console.log(`Synthetic transcript: ${file}`);
  console.log(`Detected: yes (${detected.timestamp})`);
  console.log(`Queued: yes (${queued.timestamp})`);
  console.log(`TTS started: yes (${started.timestamp})`);
  console.log(`TTS completed: yes (${completed.timestamp})`);
  console.log(`Detection-to-speech latency: ${started.detectionLatencyMs ?? "unknown"} ms`);
  console.log(`Playback duration: ${completed.totalDurationMs ?? "unknown"} ms`);
}

main().catch(error => {
  console.error(`Dom TTS Acceptance Test failed: ${error.message}`);
  process.exitCode = 1;
});
