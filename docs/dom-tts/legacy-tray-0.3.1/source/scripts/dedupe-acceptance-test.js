const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { readTelemetry } = require("./telemetry");

const ROOT = path.resolve(__dirname, "..");
const testId = `dom-tts-dedupe-${Date.now()}`;
const codexHome = path.join(os.tmpdir(), testId, ".codex");
const sessionsDir = path.join(codexHome, "sessions", "2026", "05", "14");
const rollout = path.join(sessionsDir, `rollout-${testId}.jsonl`);
const phrase = `Dom TTS duplicate acceptance check ${testId}.`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function line(id) {
  return JSON.stringify({
    id,
    timestamp: new Date().toISOString(),
    type: "event_msg",
    payload: {
      type: "agent_message",
      phase: "final_answer",
      message: phrase,
    },
  });
}

async function main() {
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(rollout, "", "utf8");
  const startedAt = new Date();

  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    OPENCLAW_HOME: path.join(os.tmpdir(), testId, ".openclaw"),
  };

  const watcher = spawn(process.execPath, [
    path.join(__dirname, "watch-all-codex.js"),
    "--watchOpenClaw", "false",
    "--watchCodex", "true",
    "--pollMs", "250",
    "--speakStartup", "false",
    "--phase", "all",
    "--includeEventMessages", "true",
    "--dedupe", "true",
    "--provider", "sapi",
    "--mode", "informative",
    "--profile", "conversational",
    "--maxChunkChars", "220",
  ], { cwd: ROOT, env, windowsHide: true, stdio: "ignore" });

  try {
    await sleep(900);
    fs.appendFileSync(rollout, `${line("first")}\n${line("second")}\n`, "utf8");

    const deadline = Date.now() + 30000;
    let detected = 0;
    let deduped = 0;
    let completed = 0;
    while (Date.now() < deadline) {
      const events = readTelemetry(250);
      const fileEvents = events.filter(event => event.file === rollout || event.sourceFile === rollout);
      const recentEvents = events.filter(event => new Date(event.timestamp) >= startedAt);
      detected = fileEvents.filter(event => event.event === "watcher_detected").length;
      deduped = fileEvents.filter(event => event.event === "watcher_deduped").length;
      completed = recentEvents.filter(event => event.event === "tts_completed").length;
      if (detected === 1 && deduped >= 1 && completed >= 1) break;
      await sleep(500);
    }

    if (detected !== 1 || deduped < 1 || completed < 1) {
      throw new Error(`Expected one detection, one dedupe, and one completed speech. Got detected=${detected}, deduped=${deduped}, completed=${completed}`);
    }

    console.log("PASS: duplicate stream records produced one spoken item and one watcher_deduped event.");
  } finally {
    watcher.kill();
  }
}

main().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
