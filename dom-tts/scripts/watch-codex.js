const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { appendTelemetry } = require("./telemetry");
const { safeEnv, readObject, parseCli } = require("./runtime");

const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const WATCH_STATUS = path.join(STATE, "watcher-status.json");
const SETTINGS = path.join(ROOT, "assets", "settings.json");
const STOP = path.join(STATE, "stop.flag");

function readJson(file, fallback) {
  return readObject(file, fallback);
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
    voice: settings.voice || "",
    speed: String(settings.speed || 1),
    pitch: settings.pitch || "",
    includeCodeBlocks: String(Boolean(settings.includeCodeBlocks)),
    includeCommandBlocks: String(Boolean(settings.includeCommandBlocks)),
    maxChunkChars: String(settings.maxChunkChars || 420),
  };
  return parseCli(argv, args);
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

function outputTextFromRecord(record, phaseFilter, includeEventMessages) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "";
  const payload = record.payload || {};
  const phaseMatches = (phase) => {
    if (phaseFilter === "all") return true;
    if (phaseFilter === "final" || phaseFilter === "final_answer") return phase === "final_answer" || phase === "final";
    return phase === phaseFilter;
  };
  if (payload.type === "agent_message") {
    if (includeEventMessages !== "true") return "";
    if (!phaseMatches(payload.phase)) return "";
    return typeof payload.message === "string" ? payload.message : "";
  }
  if (record.type !== "response_item" || payload.type !== "message" || payload.role !== "assistant") return "";
  if (!phaseMatches(payload.phase)) return "";
  const parts = Array.isArray(payload.content) ? payload.content : [];
  return parts
    .filter(part => part && part.type === "output_text" && typeof part.text === "string")
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
      "--stdin", "true",
    ];
    if (speechArgs.pitch) command.push("--pitch", String(speechArgs.pitch));
    if (speechArgs.agent) command.push("--agent", String(speechArgs.agent));
    const child = spawn(process.execPath, command, {
      cwd: ROOT,
      windowsHide: true,
      stdio: ["pipe", "ignore", "ignore"],
      env: safeEnv(),
    });
    child.stdin.on("error", () => {});
    child.stdin.end(text);
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

async function processNewLines(file, cursor, args, spokenKeys) {
  const size = fs.statSync(file).size;
  if (size < cursor) cursor = 0;
  if (size === cursor) return { cursor, spoken: 0 };

  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(Math.min(size - cursor, 1024 * 1024));
  let count;
  try { count = fs.readSync(fd, buffer, 0, buffer.length, cursor); }
  finally { fs.closeSync(fd); }
  const complete = completeLines(buffer.subarray(0, count));
  const lines = complete.lines;
  let spoken = 0;
  const fileArgs = speechArgsForFile(args, file);
  for (const line of lines) {
    if (fs.existsSync(STOP)) return { cursor: size, spoken };
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
    if (spokenKeys.size > 1200) spokenKeys.delete(spokenKeys.values().next().value);
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
    if (args.dryRun !== true && args.dryRun !== "true") await speak(text, fileArgs, { detectedAt, file });
  }
  return { cursor: cursor + complete.bytes, spoken };
}

function completeLines(buffer) {
  const end = buffer.lastIndexOf(10);
  if (end < 0) {
    if (buffer.length >= 1024 * 1024) throw new Error("Transcript record exceeds the one-megabyte limit");
    return { bytes: 0, lines: [] };
  }
  return { bytes: end + 1, lines: buffer.subarray(0, end + 1).toString("utf8").split(/\r?\n/).filter(Boolean) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(STATE, { recursive: true });

  let file = args.file;
  if (!file) {
    writeStatus({ state: "error", error: "Specify --file for a consented Codex transcript" });
    process.exitCode = 1;
    return;
  }
  // An explicit watcher start resumes narration; stop discards subsequent batches.
  try { fs.unlinkSync(STOP); } catch {}
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
    if (file && fs.existsSync(file)) {
      const result = await processNewLines(file, cursor, args, spokenKeys);
      cursor = result.cursor;
      if (result.spoken > 0) writeStatus({ state: "watching", file, cursor });
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

if (require.main === module) main().catch(error => {
  writeStatus({ state: "error", error: error.message });
  console.error(error);
  process.exitCode = 1;
});
module.exports = { outputTextFromRecord, textKey, completeLines, processNewLines, parseArgs };
