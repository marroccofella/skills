const readline = require("readline");
const { spawnSync } = require("child_process");
const path = require("path");
const {
  ROOT,
  ensureState,
  loadConfig,
  writeStatus,
  processTextTurn,
  setShellPid,
  clearShellPid,
  stopRequested,
} = require("./voice-runtime");
const { appendTelemetry } = require("./telemetry");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") args.help = true;
    else if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[i + 1] || "";
      i += 1;
    }
  }
  return args;
}

function usage() {
  console.log("Dom TTS Duplex Shell");
  console.log("Interactive text lane for wake phrases while microphone/STT is configured.");
  console.log("Examples:");
  console.log('  node scripts/duplex-shell.js --once-text "Hey Dom summarize the plan"');
  console.log("  node scripts/duplex-shell.js --once-audio state\\sample.wav");
  console.log("  node scripts/duplex-shell.js --record-once true");
  console.log("  node scripts/duplex-shell.js");
}

async function main() {
  ensureState();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const config = loadConfig();
  setShellPid();
  appendTelemetry({ event: "duplex_shell_started", localOnly: config.privacy?.localOnly !== false });
  writeStatus({
    state: "listening",
    runtimeMode: "duplex",
    duplexModeEnabled: true,
    localOnly: config.privacy?.localOnly !== false,
    wakeMode: config.wake?.mode || "hybrid",
    wakePhrase: config.wake?.defaultPhrase || "Hey Dom",
  });

  if (args.onceText) {
    await processTextTurn(args.onceText, { source: "once-text", interrupt: "hotkey" });
    return;
  }

  if (args.onceAudio || args.recordOnce === "true") {
    let audio = args.onceAudio || "";
    if (!audio) {
      const record = spawnSync(process.execPath, [path.join(__dirname, "record-audio.js")], { cwd: ROOT, encoding: "utf8", windowsHide: true });
      if (record.status !== 0) throw new Error(record.stderr || record.stdout || "record-audio failed");
      audio = record.stdout.trim().split(/\r?\n/).pop();
    }
    const transcribe = spawnSync(process.execPath, [path.join(__dirname, "transcribe-audio.js"), "--audio", audio], { cwd: ROOT, encoding: "utf8", windowsHide: true });
    if (transcribe.status !== 0) throw new Error(transcribe.stderr || transcribe.stdout || "transcribe-audio failed");
    const text = transcribe.stdout.trim();
    await processTextTurn(text, { source: "audio", interrupt: "hotkey" });
    return;
  }

  console.log("Dom TTS Duplex Shell is running.");
  console.log(`Say/type a configured wake phrase such as "${config.wake?.defaultPhrase || "Hey Dom"}", or type exit.`);
  console.log("Microphone/STT lane is reported by voice-doctor; this shell keeps Standard Mode isolated.");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "dom-tts> " });
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      continue;
    }
    if (/^(exit|quit|stop)$/i.test(text) || stopRequested()) break;
    try {
      await processTextTurn(text, { source: "interactive-text", interrupt: "hotkey" });
    } catch (error) {
      writeStatus({ state: "error", runtimeMode: "duplex", error: error.message });
      console.error(`Dom TTS shell error: ${error.message}`);
    }
    rl.prompt();
  }
}

main()
  .catch(error => {
    writeStatus({ state: "error", runtimeMode: "duplex", error: error.message });
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    appendTelemetry({ event: "duplex_shell_stopped" });
    clearShellPid();
  });
