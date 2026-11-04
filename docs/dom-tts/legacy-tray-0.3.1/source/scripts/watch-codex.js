const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { appendTelemetry } = require("./telemetry");

const HOME = process.env.USERPROFILE || process.env.HOME;
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const SESSIONS = path.join(CODEX_HOME, "sessions");
const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const WATCH_STATUS = path.join(STATE, "watcher-status.json");
const SETTINGS = path.join(ROOT, "assets", "settings.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}

function parseArgs(argv) {
  const settings = readJson(SETTINGS, {});
  const args = {
    provider: settings.provider || "auto",
    profile: settings.profile || "conversational",
    mode: settings.mode || "informative",
    phase: settings.streamMessages ? "all" : (settings.phase || "final_answer"),
    includeEventMessages: "false",
    dedupe: String(settings.dedupe !== false),
    pollMs: String(settings.pollMs || 750),
    thread: "latest",
    speakStartup: String(settings.speakStartup !== false),
    voice: settings.voice || "en-US-AriaNeural",
    speed: String(settings.speed || 1),
    pitch: settings.pitch || "",
    includeCodeBlocks: String(Boolean(settings.includeCodeBlocks)),
    includeCommandBlocks: String(Boolean(settings.includeCommandBlocks)),
    maxChunkChars: String(settings.maxChunkChars || 420),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[i + 1] || "";
      i += 1;
    }
  }
  return args;
}

function routeForFile(file) {
  const settings = readJson(SETTINGS, {});
  const routes = settings.voiceRoutes || settings.chatVoiceRoutes || settings.sessionVoiceRoutes || {};
  const normalized = String(file || "").replace(/\//g, "\\").toLowerCase();
  const base = path.basename(normalized);
  const threadMatch = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  const threadId = threadMatch ? threadMatch[1].toLowerCase() : "";
  for (const [key, route] of Object.entries(routes)) {
    const routeKey = String(key || "").replace(/\//g, "\\").toLowerCase();
    if (!routeKey || !route || route.enabled === false) continue;
    if (routeKey === normalized || routeKey === base || routeKey === threadId || normalized.includes(routeKey) || base.includes(routeKey)) {
      return route;
    }
  }
  return null;
}

function speechArgsForFile(args, file) {
  const route = routeForFile(file);
  if (!route) return args;
  return {
    ...args,
    provider: route.provider || args.provider,
    profile: route.profile || args.profile,
    mode: route.mode || args.mode,
    phase: route.phase || args.phase,
    includeEventMessages: route.includeEventMessages == null ? args.includeEventMessages : String(route.includeEventMessages),
    voice: route.voice || args.voice,
    speed: route.speed == null || route.speed === "" ? args.speed : String(route.speed),
    pitch: route.pitch || args.pitch || "",
    agent: route.agent || args.agent || "",
  };
}

function writeStatus(patch) {
  fs.mkdirSync(STATE, { recursive: true });
  let current = {};
  try { current = JSON.parse(fs.readFileSync(WATCH_STATUS, "utf8")); } catch {}
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  if (patch.state && patch.state !== "stopped") {
    delete next.stoppedAt;
  }
  fs.writeFileSync(WATCH_STATUS, `${JSON.stringify(next, null, 2)}\n`);
}

function walkJsonl(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsonl(full, files);
    else if (/^rollout-.*\.jsonl$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function latestRollout() {
  const files = walkJsonl(SESSIONS);
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

function outputTextFromRecord(record, phaseFilter, includeEventMessages) {
  const payload = record.payload || {};
  const phaseMatches = (phase) => {
    if (phaseFilter === "all") return true;
    if (phaseFilter === "final" || phaseFilter === "final_answer") return phase === "final_answer" || phase === "final";
    return phase === phaseFilter;
  };
  if (payload.type === "agent_message") {
    if (includeEventMessages !== "true") return "";
    if (!phaseMatches(payload.phase)) return "";
    return payload.message || "";
  }
  if (record.type !== "response_item" || payload.type !== "message" || payload.role !== "assistant") return "";
  if (!phaseMatches(payload.phase)) return "";
  const parts = Array.isArray(payload.content) ? payload.content : [];
  return parts
    .filter(part => part && part.type === "output_text" && part.text)
    .map(part => part.text)
    .join("\n")
    .trim();
}

function textKey(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

function speak(text, args, meta = {}) {
  return new Promise(resolve => {
    const speechArgs = speechArgsForFile(args, meta.file || "");
    const command = [
      path.join(__dirname, "speak.js"),
      "--provider", speechArgs.provider,
      "--profile", speechArgs.profile,
      "--mode", speechArgs.mode,
      "--voice", speechArgs.voice,
      "--speed", speechArgs.speed,
      "--includeCodeBlocks", speechArgs.includeCodeBlocks,
      "--includeCommandBlocks", speechArgs.includeCommandBlocks,
      "--maxChunkChars", speechArgs.maxChunkChars,
      "--detectedAt", meta.detectedAt || "",
      "--sourceFile", meta.file || "",
      "--text", text,
    ];
    if (speechArgs.pitch) command.push("--pitch", String(speechArgs.pitch));
    if (speechArgs.agent) command.push("--agent", String(speechArgs.agent));
    const child = spawn(process.execPath, command, {
      cwd: ROOT,
      windowsHide: true,
      stdio: "ignore",
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

async function processNewLines(file, cursor, args, spokenKeys) {
  const size = fs.statSync(file).size;
  if (size < cursor) cursor = 0;
  if (size === cursor) return { cursor, spoken: 0 };

  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(size - cursor);
  fs.readSync(fd, buffer, 0, buffer.length, cursor);
  fs.closeSync(fd);

  const lines = buffer.toString("utf8").split(/\r?\n/).filter(Boolean);
  let spoken = 0;
  const fileArgs = speechArgsForFile(args, file);
  for (const line of lines) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const text = outputTextFromRecord(record, fileArgs.phase, fileArgs.includeEventMessages).trim();
    if (!text) continue;
    const key = textKey(text);
    if (args.dedupe !== "false" && spokenKeys.has(key)) {
      writeStatus({ state: "watching", file, skippedDuplicate: text.slice(0, 120) });
      continue;
    }
    spokenKeys.add(key);
    spoken += 1;
    const detectedAt = new Date().toISOString();
    appendTelemetry({
      event: "watcher_detected",
      scope: "thread",
      file,
      chars: text.length,
      phase: args.phase,
    });
    writeStatus({ state: "speaking", file, lastDetectedAt: detectedAt, lastText: text.slice(0, 180), spoken });
    await speak(text, fileArgs, { detectedAt, file });
  }
  return { cursor: size, spoken };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(STATE, { recursive: true });

  let file = args.file || latestRollout();
  if (!file) {
    writeStatus({ state: "error", error: "No Codex rollout JSONL found" });
    process.exitCode = 1;
    return;
  }
  let cursor = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const spokenKeys = new Set();
  writeStatus({
    state: "watching",
    file,
    cursor,
    provider: args.provider,
    mode: args.mode,
    profile: args.profile,
    phase: args.phase,
    voice: args.voice,
    speed: Number(args.speed || 1),
    includeCodeBlocks: args.includeCodeBlocks,
    includeCommandBlocks: args.includeCommandBlocks,
    maxChunkChars: Number(args.maxChunkChars || 420),
    includeEventMessages: args.includeEventMessages,
    dedupe: args.dedupe,
  });

  if (args.speakStartup === "true") {
    await speak("Dom TTS Read-Aloud is now watching Codex responses.", args);
  }

  const pollMs = Math.max(250, Number(args.pollMs) || 1000);
  while (true) {
    const latest = args.thread === "latest" && !args.file ? latestRollout() : file;
    if (latest && latest !== file) {
      file = latest;
      cursor = fs.existsSync(file) ? fs.statSync(file).size : 0;
      spokenKeys.clear();
      writeStatus({ state: "watching", file, cursor, switchedAt: new Date().toISOString() });
    }
    if (file && fs.existsSync(file)) {
      const result = await processNewLines(file, cursor, args, spokenKeys);
      cursor = result.cursor;
      writeStatus({ state: "watching", file, cursor });
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

main().catch(error => {
  writeStatus({ state: "error", error: error.message });
  console.error(error);
  process.exitCode = 1;
});
