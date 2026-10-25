const fs = require("fs");
const path = require("path");
const { applyMode } = require("./summarize");
const { appendTelemetry } = require("./telemetry");
const { writeAvatarStatus } = require("./avatar-state");

const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const CONFIG = path.join(ROOT, "assets", "voices.json");
const SETTINGS = path.join(ROOT, "assets", "settings.json");
const STATUS = path.join(STATE, "status.json");
const QUEUE = path.join(STATE, "queue.json");
const LOCK = path.join(STATE, "playback.lock");
const PID = path.join(STATE, "current.pid");
const STOP = path.join(STATE, "stop.flag");

const PROVIDERS = {
  edge: () => require("./providers/edge"),
  sapi: () => require("./providers/sapi"),
  piper: () => require("./providers/piper"),
};

function stopExistingPlayback() {
  if (!fs.existsSync(LOCK) && !fs.existsSync(PID)) return;
  try { fs.writeFileSync(STOP, new Date().toISOString(), "utf8"); } catch {}
  const pid = fs.existsSync(PID) ? fs.readFileSync(PID, "utf8").trim() : "";
  if (/^\d+$/.test(pid)) {
    const { spawnSync } = require("child_process");
    if (process.platform === "win32") {
      if (playbackProcessLooksOwned(pid)) {
        spawnSync("taskkill.exe", ["/PID", pid, "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        appendTelemetry({ event: "stale_playback_pid_ignored", pid });
      }
    } else {
      try { process.kill(Number(pid), "SIGTERM"); } catch {}
    }
  }
  try { fs.unlinkSync(PID); } catch {}
  try { fs.unlinkSync(LOCK); } catch {}
}

function playbackProcessLooksOwned(pid) {
  if (process.platform !== "win32") return true;
  const { spawnSync } = require("child_process");
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

function parseArgs(argv) {
  const args = {
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      args[key] = argv[i + 1] || "";
      i += 1;
    }
  }
  return args;
}

function ensureState() {
  fs.mkdirSync(STATE, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function setStatus(patch) {
  const current = readJson(STATUS, {});
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  if (patch.state && patch.state !== "stopped") {
    delete next.stoppedAt;
    delete next.stoppedAtChunk;
  }
  if (patch.state && patch.state !== "idle") {
    delete next.completedAt;
  }
  if (patch.state === "idle" || patch.state === "stopped" || patch.state === "error") {
    delete next.currentChunk;
  }
  for (const [key, value] of Object.entries(next)) {
    if (value === null) delete next[key];
  }
  writeJson(STATUS, next);
}

function getInputText(args) {
  if (args.textFile) return fs.readFileSync(args.textFile, "utf8");
  if (args.stdin === "true" || args.text === "-") return fs.readFileSync(0, "utf8");
  return args.text || "";
}

function chunkText(text, maxChars) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      chunks.push(paragraph);
      continue;
    }
    const sentences = paragraph.match(/[^.!?\n]+[.!?]?/g) || [paragraph];
    let current = "";
    for (const sentence of sentences) {
      const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
      if (next.length > maxChars && current) {
        chunks.push(current);
        current = sentence.trim();
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks.flatMap(chunk => {
    if (chunk.length <= maxChars * 1.5) return [chunk];
    const parts = [];
    for (let i = 0; i < chunk.length; i += maxChars) parts.push(chunk.slice(i, i + maxChars));
    return parts;
  });
}

function toBool(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function edgeRateFromSpeed(speed) {
  const numeric = Number(speed || 1);
  const percent = Math.max(-50, Math.min(50, Math.round((numeric - 1) * 100)));
  if (percent === 0) return "+0%";
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function providerOptions(providerName, config, profileConfig, runtimeOptions) {
  const providerConfig = config.providers?.[providerName] || {};
  const speed = Number(runtimeOptions.speed || profileConfig.speed || 1);
  const options = {
    ...providerConfig,
    speed,
  };
  if (runtimeOptions.voice) options.voice = runtimeOptions.voice;
  if (providerName === "edge") {
    options.rate = runtimeOptions.rate || edgeRateFromSpeed(speed);
    if (runtimeOptions.pitch) options.pitch = runtimeOptions.pitch;
  }
  return options;
}

function stopRequested() {
  return fs.existsSync(STOP);
}

function setCurrentPid(pid) {
  if (pid) fs.writeFileSync(PID, String(pid), "utf8");
}

function clearCurrentPid() {
  try { fs.unlinkSync(PID); } catch {}
}

async function speakWithProvider(providerName, chunk, config, profileConfig, runtimeOptions) {
  const providerFactory = PROVIDERS[providerName];
  if (!providerFactory) throw new Error(`Unknown provider: ${providerName}`);
  const provider = providerFactory();
  const context = {
    rootDir: ROOT,
    stateDir: STATE,
    setCurrentPid,
    clearCurrentPid,
  };
  await provider.speakChunk(chunk, providerOptions(providerName, config, profileConfig, runtimeOptions), context);
}

async function speakChunk(providerName, chunk, config, profileConfig, runtimeOptions) {
  const fallback = config.fallbackProvider || "sapi";
  const order = providerName === "auto" ? [config.defaultProvider || "edge", fallback] : [providerName];
  let lastError;
  for (const candidate of [...new Set(order)]) {
    if (stopRequested()) return;
    try {
      appendTelemetry({
        event: "tts_provider_start",
        provider: candidate,
        chunkChars: chunk.length,
        agent: runtimeOptions.agent || undefined,
      });
      setStatus({ state: "speaking", provider: candidate, agent: runtimeOptions.agent || null, currentChunk: chunk.slice(0, 120) });
      writeAvatarStatus({
        activeAgent: runtimeOptions.agent || undefined,
        phase: "speaking",
        provider: candidate,
        speakingText: chunk.slice(0, 240),
        currentChunk: chunk.slice(0, 120),
        error: null,
      });
      await speakWithProvider(candidate, chunk, config, profileConfig, runtimeOptions);
      appendTelemetry({
        event: "tts_provider_done",
        provider: candidate,
        chunkChars: chunk.length,
        agent: runtimeOptions.agent || undefined,
      });
      return;
    } catch (error) {
      if (stopRequested()) {
        setStatus({ state: "stopped", provider: candidate, message: "Playback interrupted by stop request", error: null });
        writeAvatarStatus({ activeAgent: runtimeOptions.agent || undefined, phase: "idle", message: "Playback interrupted by stop request", speakingText: null, error: null });
        return;
      }
      lastError = error;
      appendTelemetry({
        event: "tts_provider_failed",
        provider: candidate,
        error: error.message,
        agent: runtimeOptions.agent || undefined,
      });
      setStatus({ state: "provider-failed", provider: candidate, error: error.message });
      writeAvatarStatus({ activeAgent: runtimeOptions.agent || undefined, phase: "thinking", error: error.message });
      if (candidate === fallback) break;
    }
  }
  throw lastError || new Error("No provider could speak the chunk");
}

async function main() {
  ensureState();
  const settings = readJson(SETTINGS, {});
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun && args.allowOverlap !== "true") stopExistingPlayback();
  const config = readJson(CONFIG, {});
  const runtime = {
    provider: args.provider || settings.provider || "auto",
    profile: args.profile || settings.profile || "conversational",
    mode: args.mode || settings.mode || "informative",
    voice: args.voice || settings.voice || config.providers?.edge?.voice,
    speed: args.speed || settings.speed || 1,
    pitch: args.pitch || settings.pitch || config.providers?.edge?.pitch || "",
    includeCodeBlocks: args.includeCodeBlocks ?? String(Boolean(settings.includeCodeBlocks)),
    includeCommandBlocks: args.includeCommandBlocks ?? String(Boolean(settings.includeCommandBlocks)),
    maxChunkChars: args.maxChunkChars || settings.maxChunkChars,
    agent: args.agent || settings.agent || "",
    priority: args.priority || "normal",
    detectedAt: args.detectedAt || "",
    sourceFile: args.sourceFile || "",
    text: args.text || "",
  };
  const profile = config.profiles?.[runtime.profile] ? runtime.profile : "conversational";
  const profileConfig = config.profiles?.[profile] || { speed: 1, maxChunkChars: 420 };
  const mode = runtime.mode || profileConfig.mode || "full";
  const rawText = getInputText(args);
  const spokenText = applyMode(rawText, mode, profile, {
    includeCodeBlocks: toBool(runtime.includeCodeBlocks),
    includeCommandBlocks: toBool(runtime.includeCommandBlocks),
  });
  const chunks = chunkText(spokenText, Number(runtime.maxChunkChars || profileConfig.maxChunkChars || 420));

  writeJson(QUEUE, {
    mode,
    profile,
    provider: runtime.provider,
    agent: runtime.agent,
    priority: runtime.priority,
    voice: runtime.voice,
    speed: Number(runtime.speed || 1),
    pitch: runtime.pitch,
    includeCodeBlocks: toBool(runtime.includeCodeBlocks),
    includeCommandBlocks: toBool(runtime.includeCommandBlocks),
    chunks,
    createdAt: new Date().toISOString(),
  });

  if (args.dryRun) {
    setStatus({ state: "dry-run", mode, profile, provider: runtime.provider, agent: runtime.agent || null, voice: runtime.voice, speed: Number(runtime.speed || 1), pitch: runtime.pitch, chunks: chunks.length });
    writeAvatarStatus({ activeAgent: runtime.agent || undefined, phase: "dry-run", speakingText: chunks.join(" ").slice(0, 240), error: null });
    process.stdout.write(chunks.join("\n---\n"));
    return;
  }

  try { fs.unlinkSync(STOP); } catch {}
  fs.writeFileSync(LOCK, String(process.pid), "utf8");
  const queuedAtMs = Date.now();
  appendTelemetry({
    event: "tts_queued",
    mode,
    profile,
    provider: runtime.provider,
    agent: runtime.agent || undefined,
    voice: runtime.voice,
    speed: Number(runtime.speed || 1),
    pitch: runtime.pitch || undefined,
    chunks: chunks.length,
    chars: rawText.length,
    detectedAt: runtime.detectedAt || undefined,
    sourceFile: runtime.sourceFile || undefined,
  });
  setStatus({ state: "queued", mode, profile, provider: runtime.provider, agent: runtime.agent || null, voice: runtime.voice, speed: Number(runtime.speed || 1), pitch: runtime.pitch, chunks: chunks.length, detectedAt: runtime.detectedAt || null, error: null, message: null });
  writeAvatarStatus({ activeAgent: runtime.agent || undefined, phase: "thinking", chunks: chunks.length, speakingText: chunks[0] || "", error: null });

  if (!chunks.length) {
    setStatus({ state: "idle", message: "No speakable text found" });
    writeAvatarStatus({ activeAgent: runtime.agent || undefined, phase: "idle", message: "No speakable text found", speakingText: null });
    return;
  }

  for (let i = 0; i < chunks.length; i += 1) {
    if (stopRequested()) {
      setStatus({ state: "stopped", stoppedAtChunk: i, error: null });
      writeAvatarStatus({ activeAgent: runtime.agent || undefined, phase: "idle", stoppedAtChunk: i, speakingText: null, error: null });
      return;
    }
    const chunkStartedAtMs = Date.now();
    const detectionLatencyMs = runtime.detectedAt ? Math.max(0, chunkStartedAtMs - Date.parse(runtime.detectedAt)) : null;
    appendTelemetry({
      event: "tts_chunk_started",
      chunkIndex: i + 1,
      chunks: chunks.length,
      detectionLatencyMs,
      queueLatencyMs: chunkStartedAtMs - queuedAtMs,
    });
    setStatus({ state: "speaking", agent: runtime.agent || null, chunkIndex: i + 1, chunks: chunks.length, lastLatencyMs: detectionLatencyMs });
    await speakChunk(runtime.provider || "auto", chunks[i], config, profileConfig, runtime);
    appendTelemetry({
      event: "tts_chunk_completed",
      chunkIndex: i + 1,
      chunks: chunks.length,
      chunkDurationMs: Date.now() - chunkStartedAtMs,
    });
    if (stopRequested()) {
      setStatus({ state: "stopped", stoppedAtChunk: i + 1, error: null });
      writeAvatarStatus({ activeAgent: runtime.agent || undefined, phase: "idle", stoppedAtChunk: i + 1, speakingText: null, error: null });
      return;
    }
  }

  appendTelemetry({
    event: "tts_completed",
    chunks: chunks.length,
    totalDurationMs: Date.now() - queuedAtMs,
  });
  const completedAt = new Date().toISOString();
  setStatus({ state: "idle", agent: runtime.agent || null, completedAt });
  writeAvatarStatus({ activeAgent: runtime.agent || undefined, phase: "idle", completedAt, speakingText: null, currentChunk: null });
}

main()
  .catch(error => {
    ensureState();
    setStatus({ state: "error", error: error.message });
    writeAvatarStatus({ phase: "error", error: error.message });
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    clearCurrentPid();
    try { fs.unlinkSync(LOCK); } catch {}
  });
