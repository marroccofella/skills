const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { appendTelemetry } = require("./telemetry");

const HOME = process.env.USERPROFILE || process.env.HOME;
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const SESSIONS = path.join(CODEX_HOME, "sessions");
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(HOME, ".openclaw");
const OPENCLAW_SESSIONS = path.join(OPENCLAW_HOME, "agents", "main", "sessions");
const AGENTLAB_HOME = process.env.AGENTLAB_HOME || "C:\\AgentLab";
const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const WATCH_STATUS = path.join(STATE, "watcher-status.json");
const CURSORS = path.join(STATE, "global-cursors.json");
const SETTINGS = path.join(ROOT, "assets", "settings.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeStatus(patch) {
  const current = readJson(WATCH_STATUS, {});
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  if (patch.state && patch.state !== "stopped") {
    delete next.stoppedAt;
  }
  writeJson(WATCH_STATUS, next);
}

function parseArgs(argv) {
  const settings = readJson(SETTINGS, {});
  const args = {
    provider: settings.provider || "auto",
    profile: settings.profile || "conversational",
    mode: settings.mode || "informative",
    phase: settings.streamMessages ? "all" : (settings.phase || "final_answer"),
    includeEventMessages: String(Boolean(settings.includeEventMessages)),
    dedupe: String(settings.dedupe !== false),
    pollMs: String(settings.pollMs || 1000),
    speakStartup: String(settings.speakStartup !== false),
    voice: settings.voice || "en-US-AriaNeural",
    speed: String(settings.speed || 1),
    pitch: settings.pitch || "",
    includeCodeBlocks: String(Boolean(settings.includeCodeBlocks)),
    includeCommandBlocks: String(Boolean(settings.includeCommandBlocks)),
    maxChunkChars: String(settings.maxChunkChars || 420),
    watchCodex: String(settings.watchCodex !== false),
    watchOpenClaw: String(settings.watchOpenClaw !== false),
    watchAgentLab: String(settings.watchAgentLab !== false),
    agentLabMaxAgeMinutes: String(settings.agentLabMaxAgeMinutes || 30),
    openClawStream: String(settings.openClawStream !== false),
    openClawIncludeThinking: String(Boolean(settings.openClawIncludeThinking)),
    openClawIncludeToolResults: String(Boolean(settings.openClawIncludeToolResults)),
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

function walkCodexJsonl(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkCodexJsonl(full, files);
    else if (/^rollout-.*\.jsonl$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function walkOpenClawJsonl(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkOpenClawJsonl(full, files);
    else if (/\.jsonl$/i.test(entry.name) && !/\.trajectory\.jsonl$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function watchedFiles(args) {
  const files = [];
  if (args.watchCodex !== "false") {
    for (const file of walkCodexJsonl(SESSIONS)) files.push({ file, source: "codex" });
  }
  if (args.watchOpenClaw !== "false") {
    for (const file of walkOpenClawJsonl(OPENCLAW_SESSIONS)) files.push({ file, source: "openclaw" });
  }
  if (args.watchAgentLab !== "false") {
    for (const item of walkAgentLabFiles(AGENTLAB_HOME)) files.push(item);
  }
  return files;
}

function walkAgentLabFiles(root, files = []) {
  const community = path.join(root, "community", "nodes");
  if (fs.existsSync(community)) {
    for (const node of fs.readdirSync(community, { withFileTypes: true })) {
      if (!node.isDirectory()) continue;
      const nodeDir = path.join(community, node.name);
      for (const name of ["TASK_LOG.md", "CURRENT_STATE.md"]) {
        const full = path.join(nodeDir, name);
        if (fs.existsSync(full)) files.push({ file: full, source: "agentlab-text" });
      }
    }
  }

  const taskResults = path.join(root, "spawn", "state", "task-results");
  if (fs.existsSync(taskResults)) {
    for (const entry of fs.readdirSync(taskResults, { withFileTypes: true })) {
      if (entry.isFile() && /^task_.*\.json$/i.test(entry.name)) {
        files.push({ file: path.join(taskResults, entry.name), source: "agentlab-result" });
      }
    }
  }

  const stateDir = path.join(root, "comms", "state");
  if (fs.existsSync(stateDir)) {
    for (const entry of fs.readdirSync(stateDir, { withFileTypes: true })) {
      if (entry.isFile() && /live-status|status/i.test(entry.name) && /\.txt$/i.test(entry.name)) {
        files.push({ file: path.join(stateDir, entry.name), source: "agentlab-text" });
      }
    }
  }

  return files;
}

function phaseMatches(phase, phaseFilter) {
  if (phaseFilter === "all") return true;
  if (phaseFilter === "final" || phaseFilter === "final_answer") return phase === "final_answer" || phase === "final";
  return phase === phaseFilter;
}

function outputCodexTextFromRecord(record, args) {
  const payload = record.payload || {};
  if (payload.type === "agent_message") {
    if (args.includeEventMessages !== "true") return "";
    if (!phaseMatches(payload.phase, args.phase)) return "";
    return payload.message || "";
  }
  if (record.type !== "response_item" || payload.type !== "message" || payload.role !== "assistant") return "";
  if (!phaseMatches(payload.phase, args.phase)) return "";
  return (Array.isArray(payload.content) ? payload.content : [])
    .filter(part => part && part.type === "output_text" && part.text)
    .map(part => part.text)
    .join("\n")
    .trim();
}

function formatToolName(name) {
  return String(name || "tool")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function outputOpenClawTextFromRecord(record, args) {
  if (record.type !== "message") return "";
  const message = record.message || {};
  const role = message.role || "";
  const content = Array.isArray(message.content) ? message.content : [];

  if (role === "assistant") {
    const spoken = [];
    for (const part of content) {
      if (!part) continue;
      if (part.type === "text" && part.text) spoken.push(part.text);
      if (part.type === "thinking" && args.openClawIncludeThinking === "true" && part.thinking) {
        spoken.push(part.thinking);
      }
      if (part.type === "toolCall" && args.includeEventMessages === "true") {
        spoken.push(`OpenClaw is using ${formatToolName(part.name)}.`);
      }
    }
    return spoken.join("\n").trim();
  }

  if (role === "toolResult" && args.openClawIncludeToolResults === "true") {
    return `OpenClaw received ${formatToolName(message.toolName)} results.`;
  }

  return "";
}

function outputTextFromRecord(record, args, source) {
  if (source === "openclaw") return outputOpenClawTextFromRecord(record, args);
  return outputCodexTextFromRecord(record, args);
}

function agentNameFromPath(file) {
  const match = file.match(/community\\nodes\\([^\\]+)/i);
  if (match) return match[1].replace(/[_-]+/g, " ");
  if (/task-results/i.test(file)) return "Spawn worker";
  const base = path.basename(file, path.extname(file)).replace(/^(peer-|bob-|bab-)/i, "");
  return base.replace(/[_-]+/g, " ");
}

function eventIsFresh(timestamp, args) {
  if (!timestamp) return true;
  const maxAgeMinutes = Math.max(1, Number(args.agentLabMaxAgeMinutes) || 30);
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at)) return true;
  return Date.now() - at <= maxAgeMinutes * 60 * 1000;
}

function outputAgentLabTextFromLine(file, line, args) {
  const text = String(line || "").trim();
  if (!text) return "";
  const agent = agentNameFromPath(file);

  const taskMatch = text.match(/^-\s*([0-9T:.\-Z]+):\s*([^()]+?)\s+\((task_[^)]+)\)/i);
  if (taskMatch) {
    if (!eventIsFresh(taskMatch[1], args)) return "";
    const action = taskMatch[2].replace(/\s*->\s*/g, " ").replace(/\s+/g, " ").trim();
    return `${agent}: ${action}. ${taskMatch[3]}.`;
  }

  if (/^\|\s*(Status|Current task|Trust state|Last heartbeat)\s*\|/i.test(text)) {
    return `${agent}: ${text.replace(/\|/g, " ").replace(/\s+/g, " ").trim()}.`;
  }

  if (/^\s*(status|current task|last heartbeat|hostname)\s*[:=]/i.test(text)) {
    return `${agent}: ${text.replace(/\s+/g, " ").trim()}.`;
  }

  return "";
}

function summarizeCommand(raw) {
  const command = String(raw || "").replace(/\s+/g, " ").trim();
  if (!command) return "";
  if (/\.b64'?\s+-Value|FromBase64String|Add-Content .*\.b64/i.test(command)) return "staging a script payload";
  if (/bug1_speed_dashboard/i.test(command)) return "publishing the Bug one speed dashboard";
  if (/diagnostic/i.test(command)) return "running diagnostics";
  if (/nvidia-smi/i.test(command)) return "checking GPU status";
  if (/ollama/i.test(command)) return "checking local model service";
  if (/Invoke-WebRequest|curl|irm/i.test(command)) return "checking a web endpoint";
  if (/Get-Content|Select-String|rg\b/i.test(command)) return "reading files and logs";
  return command.slice(0, 180);
}

function outputAgentLabTextFromResult(file, content, args) {
  let record;
  try { record = JSON.parse(content); } catch { return ""; }
  const receivedAt = record.receivedAt || record.result?.generatedAt || record.result?.report?.completedAt;
  if (!eventIsFresh(receivedAt, args)) return "";
  const result = record.result || {};
  const report = result.report || {};
  const node = result.nodeId || record.nodeId || "worker";
  const task = result.taskId || record.taskId || path.basename(file, ".json");
  const status = result.status || record.status || "updated";
  const exitCode = typeof report.exitCode === "number" ? report.exitCode : null;
  const stdout = String(report.stdout || "").trim();
  const stderr = String(report.stderr || "").trim();
  const commandArgs = Array.isArray(report.arguments) ? report.arguments.join(" ") : "";
  const action = summarizeCommand(commandArgs);
  const failure = stderr ? ` Error: ${stderr.slice(0, 220)}` : "";
  const output = stdout ? ` Output: ${stdout.slice(0, 220)}` : "";
  const exit = exitCode === null ? "" : ` Exit code ${exitCode}.`;
  return `Spawn worker ${node}: ${task} ${status}.${exit}${action ? ` It was ${action}.` : ""}${output}${failure}`.trim();
}

const DEDUPE_WINDOW_MS = 15 * 60 * 1000;
const DEDUPE_MAX_ENTRIES = 1200;

function normalizeForDedupe(text) {
  return String(text || "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function textKey(file, text) {
  const normalized = `${file}\n${normalizeForDedupe(text)}`;
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

function pruneSpokenKeys(spokenKeys, now = Date.now()) {
  for (const [key, entry] of spokenKeys.entries()) {
    if (now - entry.at > DEDUPE_WINDOW_MS) spokenKeys.delete(key);
  }
  while (spokenKeys.size > DEDUPE_MAX_ENTRIES) {
    const oldest = spokenKeys.keys().next().value;
    if (!oldest) break;
    spokenKeys.delete(oldest);
  }
}

function findDuplicate(file, text, spokenKeys) {
  const now = Date.now();
  pruneSpokenKeys(spokenKeys, now);
  const norm = normalizeForDedupe(text);
  const key = textKey(file, text);
  if (spokenKeys.has(key)) return { key, reason: "exact" };

  if (norm.length < 80) return null;
  for (const entry of spokenKeys.values()) {
    if (entry.file !== file || entry.norm.length < 80) continue;
    const shorter = norm.length < entry.norm.length ? norm : entry.norm;
    const longer = norm.length < entry.norm.length ? entry.norm : norm;
    if (longer.includes(shorter) && shorter.length / longer.length >= 0.82) {
      return { key, reason: "near", previousChars: entry.norm.length };
    }
  }
  return null;
}

function rememberSpoken(file, text, spokenKeys) {
  spokenKeys.set(textKey(file, text), {
    file,
    norm: normalizeForDedupe(text),
    chars: text.length,
    at: Date.now(),
  });
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
    const child = spawn(process.execPath, command, { cwd: ROOT, windowsHide: true, stdio: "ignore" });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

async function processFile(file, source, cursor, args, spokenKeys) {
  if (!fs.existsSync(file)) return cursor;
  const size = fs.statSync(file).size;
  if (size < cursor) return size;
  if (size === cursor) return cursor;

  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(size - cursor);
  fs.readSync(fd, buffer, 0, buffer.length, cursor);
  fs.closeSync(fd);

  const content = buffer.toString("utf8");
  if (source === "agentlab-result") {
    const text = outputAgentLabTextFromResult(file, fs.readFileSync(file, "utf8"), args).trim();
    if (text) await speakDetectedText(text, source, file, args, spokenKeys);
    return size;
  }

  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    const fileArgs = speechArgsForFile(args, file);
    if (source === "agentlab-text") {
      const text = outputAgentLabTextFromLine(file, line, fileArgs).trim();
      if (text) await speakDetectedText(text, source, file, fileArgs, spokenKeys);
      continue;
    }
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const text = outputTextFromRecord(record, fileArgs, source).trim();
    if (!text) continue;
    await speakDetectedText(text, source, file, fileArgs, spokenKeys);
  }

  return size;
}

async function speakDetectedText(text, source, file, args, spokenKeys) {
  const duplicate = args.dedupe !== "false" ? findDuplicate(file, text, spokenKeys) : null;
  if (duplicate) {
    appendTelemetry({
      event: "watcher_deduped",
      scope: source,
      file,
      chars: text.length,
      phase: args.phase,
      reason: duplicate.reason,
    });
    return;
  }
  rememberSpoken(file, text, spokenKeys);
  const detectedAt = new Date().toISOString();
  appendTelemetry({
    event: "watcher_detected",
    scope: source,
    file,
    chars: text.length,
    phase: args.phase,
  });
  writeStatus({ state: "speaking", scope: "all", source, file, lastDetectedAt: detectedAt, lastText: text.slice(0, 180) });
  await speak(text, args, { detectedAt, file });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(STATE, { recursive: true });

  const cursors = {};
  const initialFiles = watchedFiles(args);
  for (const { file } of initialFiles) {
    try { cursors[file] = fs.statSync(file).size; } catch {}
  }
  writeJson(CURSORS, cursors);
  const initialCodexFiles = initialFiles.filter(item => item.source === "codex").length;
  const initialOpenClawFiles = initialFiles.filter(item => item.source === "openclaw").length;
  const initialAgentLabFiles = initialFiles.filter(item => item.source.startsWith("agentlab")).length;
  writeStatus({
    state: "watching",
    scope: "all",
    watchedFiles: Object.keys(cursors).length,
    watchedCodexFiles: initialCodexFiles,
    watchedOpenClawFiles: initialOpenClawFiles,
    watchedAgentLabFiles: initialAgentLabFiles,
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
    watchCodex: args.watchCodex,
    watchOpenClaw: args.watchOpenClaw,
    watchAgentLab: args.watchAgentLab,
    agentLabMaxAgeMinutes: Number(args.agentLabMaxAgeMinutes || 30),
    openClawStream: args.openClawStream,
    openClawIncludeThinking: args.openClawIncludeThinking,
    openClawIncludeToolResults: args.openClawIncludeToolResults,
  });

  if (args.speakStartup === "true") {
    await speak("Global Dom TTS Read-Aloud is now watching Codex and OpenClaw chats.", args);
  }

  const spokenKeys = new Map();
  const pollMs = Math.max(500, Number(args.pollMs) || 1000);
  while (true) {
    const files = watchedFiles(args);
    for (const { file, source } of files) {
      if (!(file in cursors)) {
        cursors[file] = fs.existsSync(file) ? fs.statSync(file).size : 0;
      }
      cursors[file] = await processFile(file, source, cursors[file], args, spokenKeys);
    }
    writeJson(CURSORS, cursors);
    writeStatus({
      state: "watching",
      scope: "all",
      watchedFiles: files.length,
      watchedCodexFiles: files.filter(item => item.source === "codex").length,
      watchedOpenClawFiles: files.filter(item => item.source === "openclaw").length,
      watchedAgentLabFiles: files.filter(item => item.source.startsWith("agentlab")).length,
    });
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

main().catch(error => {
  writeStatus({ state: "error", scope: "all", error: error.message });
  console.error(error);
  process.exitCode = 1;
});
