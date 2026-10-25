const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const { appendTelemetry } = require("./telemetry");
const { writeAvatarStatus, agentPhrases, normalizeAgentId } = require("./avatar-state");

const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const CONFIG = path.join(ROOT, "assets", "voice-runtime.json");
const STATUS = path.join(STATE, "duplex-status.json");
const PID = path.join(STATE, "duplex.pid");
const STOP = path.join(STATE, "duplex-stop.flag");
const TURNS = path.join(STATE, "duplex-turns.jsonl");

function ensureState() {
  fs.mkdirSync(STATE, { recursive: true });
}

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadConfig() {
  return readJson(CONFIG, {});
}

function writeStatus(patch) {
  ensureState();
  const current = readJson(STATUS, {});
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  if (patch.error === null || (patch.state && patch.state !== "error" && !Object.prototype.hasOwnProperty.call(patch, "error"))) {
    delete next.error;
  }
  writeJson(STATUS, next);
}

function appendTurn(turn) {
  ensureState();
  fs.appendFileSync(TURNS, `${JSON.stringify({ timestamp: new Date().toISOString(), ...turn })}\n`, "utf8");
}

function commandExists(command) {
  const probe = process.platform === "win32"
    ? spawnSync("where.exe", [command], { stdio: "ignore", windowsHide: true })
    : spawnSync("which", [command], { stdio: "ignore" });
  return probe.status === 0;
}

function commandPath(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
    if (commandExists(candidate)) return candidate;
  }
  return "";
}

function ollamaModels() {
  const result = spawnSync("ollama", ["list"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function selectModel(config, profile) {
  const models = config.models || {};
  const installed = ollamaModels();
  const preferred = models[profile] || models.quality || models.fast || models.fallback;
  if (preferred && installed.includes(preferred)) return { model: preferred, fallbackUsed: false, installed };
  const fallbackOrder = [models.fast, models.fallback, models.quality, ...installed].filter(Boolean);
  const fallback = fallbackOrder.find(model => installed.includes(model));
  return { model: fallback || preferred || "", fallbackUsed: Boolean(fallback && fallback !== preferred), installed };
}

function resolveAgent(config, text) {
  const agents = config.agents || {};
  const normalized = String(text || "").trim().toLowerCase();
  for (const [id, agent] of Object.entries(agents)) {
    for (const phrase of agentPhrases(agent)) {
      const lower = phrase.toLowerCase();
      if (lower && (normalized === lower || normalized.startsWith(`${lower} `) || normalized.startsWith(`${lower},`))) {
        return { id, agent, wakePhrase: phrase };
      }
    }
  }
  return { id: "personal", agent: agents.personal || Object.values(agents)[0] || {} };
}

function stripWakePhrase(agent, text) {
  let value = String(text || "").trim();
  for (const phrase of agentPhrases(agent)) {
    if (phrase && value.toLowerCase().startsWith(phrase.toLowerCase())) {
      value = value.slice(phrase.length).replace(/^[\s,.:;-]+/, "");
      break;
    }
  }
  return value || text;
}

function promptFor(agentId, agent, text) {
  const style = agent.style || "conversational";
  const personality = agent.personality || "";
  return [
    `You are Dom TTS voice agent "${agentId}" running locally.`,
    `Reply in a ${style} style.`,
    personality ? `Personality: ${personality}` : "",
    "Keep the answer concise enough to speak aloud.",
    "Do not claim to use tools unless they are actually available.",
    "",
    `User: ${text}`,
  ].filter(line => line !== "").join("\n");
}

function ollamaGenerate(model, prompt, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    if (!model) {
      reject(new Error("No Ollama model is configured or installed."));
      return;
    }
    const payload = JSON.stringify({ model, prompt, stream: false });
    const request = http.request({
      hostname: "127.0.0.1",
      port: 11434,
      path: "/api/generate",
      method: "POST",
      timeout: timeoutMs,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (response.statusCode >= 400) reject(new Error(parsed.error || `Ollama HTTP ${response.statusCode}`));
          else resolve(String(parsed.response || "").trim());
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("Ollama request timed out."));
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function speak(text, agent, agentId) {
  return new Promise(resolve => {
    const speakArgs = [
      path.join(__dirname, "speak.js"),
      "--provider", "auto",
      "--profile", "conversational",
      "--mode", agent.mode || "informative",
      "--voice", agent.voice || "",
      "--agent", agent.avatarId || agentId || "",
      "--priority", agent.priority || "normal",
      "--text", text,
    ];
    if (agent.speed) speakArgs.push("--speed", String(agent.speed));
    if (agent.pitch) speakArgs.push("--pitch", String(agent.pitch));
    const child = spawn(process.execPath, speakArgs, { cwd: ROOT, windowsHide: true, stdio: "ignore" });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

function stopSpeech() {
  spawnSync(process.execPath, [path.join(__dirname, "stop.js")], {
    cwd: ROOT,
    windowsHide: true,
    stdio: "ignore",
    timeout: 5000,
  });
}

function stopRequested() {
  return fs.existsSync(STOP);
}

function setShellPid() {
  ensureState();
  fs.writeFileSync(PID, String(process.pid), "utf8");
}

function clearShellPid() {
  try { fs.unlinkSync(PID); } catch {}
}

async function processTextTurn(text, options = {}) {
  ensureState();
  const config = loadConfig();
  const resolved = resolveAgent(config, text);
  const userText = stripWakePhrase(resolved.agent, text);
  const modelProfile = resolved.agent.modelProfile || "quality";
  const models = config.models || {};
  const preferredModel = models[modelProfile] || models.quality || models.fast || models.fallback || "";
  const simulatedTurn = Boolean(options.simulatedReply || options.skipSpeech);
  const modelInfo = simulatedTurn
    ? { model: preferredModel, fallbackUsed: false, installed: [] }
    : selectModel(config, modelProfile);
  const turnStarted = Date.now();
  const avatarId = normalizeAgentId(resolved.agent.avatarId || resolved.id);
  appendTelemetry({ event: "wake_detected", agent: resolved.id, avatarId, wakePhrase: resolved.wakePhrase || resolved.agent.wakePhrase || "", source: options.source || "text" });
  if (!simulatedTurn && ((config.interrupt || {}).onWake || options.interrupt)) {
    stopSpeech();
    appendTelemetry({ event: "speech_interrupted", reason: options.interrupt || "wake", agent: resolved.id });
  }
  writeAvatarStatus({
    activeAgent: avatarId,
    agent: resolved.id,
    phase: "thinking",
    lastUserText: userText,
    error: null,
  });
  writeStatus({
    state: "agent-turn",
    runtimeMode: "duplex",
    agent: resolved.id,
    avatarId,
    model: modelInfo.model,
    modelFallbackUsed: modelInfo.fallbackUsed,
    lastUserText: userText,
  });
  appendTelemetry({ event: "agent_turn_started", agent: resolved.id, avatarId, model: modelInfo.model, chars: userText.length });
  let reply;
  if (options.simulatedReply) {
    reply = options.simulatedReply;
  } else {
    reply = await ollamaGenerate(modelInfo.model, promptFor(resolved.id, resolved.agent, userText), options.timeoutMs);
  }
  const agentLatencyMs = Date.now() - turnStarted;
  appendTelemetry({ event: "agent_turn_completed", agent: resolved.id, avatarId, model: modelInfo.model, agentLatencyMs, chars: reply.length });
  appendTurn({ agent: resolved.id, avatarId, model: modelInfo.model, userText, reply, agentLatencyMs, simulated: Boolean(options.simulatedReply) });
  writeStatus({ state: "speaking", agent: resolved.id, avatarId, model: modelInfo.model, lastReply: reply.slice(0, 240), agentLatencyMs });
  writeAvatarStatus({ activeAgent: avatarId, agent: resolved.id, phase: "speaking", lastReply: reply.slice(0, 240), agentLatencyMs });
  if (options.skipSpeech) {
    appendTelemetry({ event: "tts_skipped", agent: resolved.id, avatarId, reason: "test" });
  } else {
    await speak(reply, resolved.agent, avatarId);
  }
  const completedAt = new Date().toISOString();
  writeStatus({ state: "idle", agent: resolved.id, avatarId, model: modelInfo.model, lastCompletedAt: completedAt });
  writeAvatarStatus({ activeAgent: avatarId, agent: resolved.id, phase: "idle", lastCompletedAt: completedAt, speakingText: null });
  return { agent: resolved.id, avatarId, model: modelInfo.model, userText, reply, agentLatencyMs, modelFallbackUsed: modelInfo.fallbackUsed };
}

function whisperPath(config) {
  return commandPath([
    config.stt?.whisperPath,
    "whisper-cli.exe",
    "whisper-cli",
    "whisper.cpp.exe",
    "whisper.cpp",
  ]);
}

function ffmpegPath() {
  return commandPath(["ffmpeg.exe", "ffmpeg"]);
}

module.exports = {
  ROOT,
  STATE,
  CONFIG,
  STATUS,
  PID,
  STOP,
  TURNS,
  ensureState,
  loadConfig,
  readJson,
  writeJson,
  writeStatus,
  appendTurn,
  commandExists,
  commandPath,
  ollamaModels,
  selectModel,
  resolveAgent,
  stripWakePhrase,
  ollamaGenerate,
  processTextTurn,
  stopSpeech,
  stopRequested,
  setShellPid,
  clearShellPid,
  whisperPath,
  ffmpegPath,
};
