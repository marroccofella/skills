const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { readTelemetry } = require("./telemetry");

const HOME = process.env.USERPROFILE || process.env.HOME;
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const SESSIONS = path.join(CODEX_HOME, "sessions");
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(HOME, ".openclaw");
const OPENCLAW_SESSIONS = path.join(OPENCLAW_HOME, "agents", "main", "sessions");
const PLUGIN = path.join(CODEX_HOME, "plugins", "read-aloud");
const DOM_PLUGIN = path.join(CODEX_HOME, "plugins", "dom-tts");
const PRODUCT_ROOT = path.join(process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"), "42uk", "DomTTS");
const STARTUP = process.platform === "win32"
  ? path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
  : "";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}

function commandExists(command) {
  const probe = process.platform === "win32"
    ? spawnSync("where.exe", [command], { stdio: "ignore", windowsHide: true })
    : spawnSync("which", [command], { stdio: "ignore" });
  return probe.status === 0;
}

function watcherProcesses() {
  if (process.platform !== "win32") return [];
  const escapedRoot = ROOT.replace(/'/g, "''");
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    `$root = '${escapedRoot}'; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like "*$root*" -and ($_.CommandLine -like '*watch-codex.js*' -or $_.CommandLine -like '*watch-all-codex.js*') } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Depth 3`,
  ], { encoding: "utf8", windowsHide: true });
  const parsed = readJsonText(result.stdout.trim(), []);
  return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
}

function readJsonText(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
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

function walkOpenClawJsonl(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkOpenClawJsonl(full, files);
    else if (/\.jsonl$/i.test(entry.name) && !/\.trajectory\.jsonl$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function transcriptSelfTest(files) {
  let parseable = 0;
  let assistantMessages = 0;
  let outputText = 0;
  for (const file of files.slice(-25)) {
    let lines = [];
    try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-200); } catch { continue; }
    for (const line of lines) {
      let record;
      try { record = JSON.parse(line); parseable += 1; } catch { continue; }
      const payload = record.payload || {};
      if (record.type === "response_item" && payload.type === "message" && payload.role === "assistant") {
        assistantMessages += 1;
        const parts = Array.isArray(payload.content) ? payload.content : [];
        if (parts.some(part => part && part.type === "output_text" && part.text)) outputText += 1;
      }
    }
  }
  return {
    ok: parseable > 0 && assistantMessages > 0 && outputText > 0,
    parseable,
    assistantMessages,
    outputText,
  };
}

function startupEnabled() {
  if (!STARTUP || !fs.existsSync(STARTUP)) return false;
  return fs.readdirSync(STARTUP).some(name => /dom tts read-aloud/i.test(name) && /\.(lnk|cmd|bat)$/i.test(name));
}

function runProbe(provider) {
  const result = spawnSync(process.execPath, [
    path.join(__dirname, "speak.js"),
    "--provider", provider,
    "--mode", "full",
    "--profile", "conversational",
    "--text", `Dom TTS ${provider} probe complete.`,
  ], { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 60000 });
  return {
    ok: result.status === 0,
    detail: result.status === 0 ? "probe passed" : (result.stderr || result.stdout || `exit ${result.status}`).trim(),
  };
}

function lastProviderSuccess(provider, telemetry) {
  return [...telemetry].reverse().find(item => item.event === "tts_provider_done" && item.provider === provider);
}

function lastEvent(name, telemetry) {
  return [...telemetry].reverse().find(item => item.event === name);
}

function line(label, value, detail = "") {
  console.log(`${label}: ${value}${detail ? ` (${detail})` : ""}`);
}

function severityLine(severity, label, detail = "") {
  console.log(`[${severity}] ${label}${detail ? ` - ${detail}` : ""}`);
}

function main() {
  const args = new Set(process.argv.slice(2));
  const probe = args.has("--probe");
  let status = readJson(path.join(STATE, "status.json"), {}) || {};
  let watcher = readJson(path.join(STATE, "watcher-status.json"), {}) || {};
  const pluginMeta = readJson(path.join(PLUGIN, ".codex-plugin", "plugin.json"), {}) || {};
  const domPluginMeta = readJson(path.join(DOM_PLUGIN, ".codex-plugin", "plugin.json"), {}) || {};
  const manifest = readJson(path.join(PRODUCT_ROOT, "install-manifest.json"), {}) || {};
  const skillMeta = readJson(path.join(ROOT, "agents", "openai.yaml"), null);
  let telemetry = readTelemetry(300);
  const files = walkJsonl(SESSIONS);
  const openClawFiles = walkOpenClawJsonl(OPENCLAW_SESSIONS);
  const transcript = transcriptSelfTest(files);
  const processes = watcherProcesses();
  const globalProcess = processes.find(proc => String(proc.CommandLine || "").includes("watch-all-codex.js"));
  const edgeProbe = probe ? runProbe("edge") : null;
  const sapiProbe = probe ? runProbe("sapi") : null;
  if (probe) {
    status = readJson(path.join(STATE, "status.json"), {}) || {};
    watcher = readJson(path.join(STATE, "watcher-status.json"), {}) || {};
    telemetry = readTelemetry(300);
  }
  const lastDetect = lastEvent("watcher_detected", telemetry);
  const lastStarted = lastEvent("tts_chunk_started", telemetry);
  const lastCompleted = lastEvent("tts_completed", telemetry);
  const edgeSuccess = edgeProbe || lastProviderSuccess("edge", telemetry);
  const sapiSuccess = sapiProbe || lastProviderSuccess("sapi", telemetry);

  console.log("Dom TTS Doctor Report");
  console.log("Product: Dom TTS Read-Aloud by Prof Dom Marrocco / 42.uk");
  line("Internal skill id", "read-aloud", "kept stable for Codex compatibility");
  line("Skill installed", fs.existsSync(path.join(ROOT, "SKILL.md")) ? "yes" : "no", ROOT);
  line("Plugin installed", fs.existsSync(path.join(PLUGIN, ".codex-plugin", "plugin.json")) ? "yes" : "no", PLUGIN);
  line("Dom TTS plugin installed", fs.existsSync(path.join(DOM_PLUGIN, ".codex-plugin", "plugin.json")) ? "yes" : "no", DOM_PLUGIN);
  line("Versioned runtime", fs.existsSync(path.join(PRODUCT_ROOT, "current.json")) ? "yes" : "no", PRODUCT_ROOT);
  line("Install manifest", manifest.version || "none", manifest.installMode ? `mode ${manifest.installMode}` : "");
  line("Codex sees skill", fs.existsSync(path.join(ROOT, "SKILL.md")) && fs.existsSync(path.join(ROOT, "agents", "openai.yaml")) ? "yes" : "no", "subject to Codex UI cache after edits");
  line("Plugin display name", pluginMeta.interface?.displayName || "unknown");
  line("Dom TTS plugin display name", domPluginMeta.interface?.displayName || "unknown");
  line("Global watcher running", globalProcess ? "yes" : "no", globalProcess ? `pid ${globalProcess.ProcessId}` : "");
  line("Any watcher running", processes.length ? "yes" : "no", processes.map(proc => proc.ProcessId).join(", "));
  line("Watcher state", watcher.state || "unknown", watcher.scope ? `scope ${watcher.scope}` : "");
  line(
    "Watching sessions",
    String(watcher.watchedFiles ?? files.length + openClawFiles.length),
    `${watcher.watchedCodexFiles ?? files.length} Codex rollout files, ${watcher.watchedOpenClawFiles ?? openClawFiles.length} OpenClaw files`,
  );
  line("Transcript format self-test", transcript.ok ? "yes" : "no", `${transcript.outputText} assistant output records from ${transcript.parseable} parsed lines`);
  line("Node runtime", Number(process.versions.node.split(".")[0]) >= 18 ? "yes" : "no", process.version);
  line("Edge TTS dependency", (() => { try { require("node-edge-tts"); return "yes"; } catch { return "no"; } })());
  line("ffplay available", commandExists("ffplay.exe") || commandExists("ffplay") ? "yes" : "no", "preferred Edge playback path");
  line("SAPI available", commandExists("powershell.exe") || process.platform !== "win32" ? "yes" : "no", "offline Windows fallback");
  line("Edge TTS works", edgeSuccess ? "yes" : "no", edgeProbe ? edgeProbe.detail : (edgeSuccess ? `last success ${edgeSuccess.timestamp}` : "run doctor.js --probe"));
  line("SAPI fallback works", sapiSuccess ? "yes" : "no", sapiProbe ? sapiProbe.detail : (sapiSuccess ? `last success ${sapiSuccess.timestamp}` : "run doctor.js --probe"));
  line("Startup enabled", startupEnabled() ? "yes" : "no");
  line("Last spoken answer", status.completedAt || lastCompleted?.timestamp || "none");
  line("Last detected answer", watcher.lastDetectedAt || lastDetect?.timestamp || "none");
  line("Last detection-to-speech latency", Number.isFinite(lastStarted?.detectionLatencyMs) ? `${lastStarted.detectionLatencyMs} ms` : "not measured yet");
  line("Last playback duration", Number.isFinite(lastCompleted?.totalDurationMs) ? `${lastCompleted.totalDurationMs} ms` : "not measured yet");
  line("Last error", status.error || watcher.error || "none");

  console.log("");
  console.log("Severity Summary");
  const checks = [
    ["runtime", fs.existsSync(path.join(ROOT, "SKILL.md")), "Standard Mode skill is installed."],
    ["domPlugin", fs.existsSync(path.join(DOM_PLUGIN, ".codex-plugin", "plugin.json")), "Dom TTS Codex-native plugin is installed."],
    ["compatPlugin", fs.existsSync(path.join(PLUGIN, ".codex-plugin", "plugin.json")), "Compatibility read-aloud plugin is installed."],
    ["node", Number(process.versions.node.split(".")[0]) >= 18, `Node ${process.version}`],
    ["edgeDependency", (() => { try { require("node-edge-tts"); return true; } catch { return false; } })(), "node-edge-tts dependency is available."],
    ["sapi", commandExists("powershell.exe") || process.platform !== "win32", "Windows SAPI fallback path is available."],
    ["transcript", transcript.ok, `${transcript.outputText} assistant output records recognized.`],
    ["watcher", Boolean(globalProcess), globalProcess ? `Global watcher pid ${globalProcess.ProcessId}.` : "Global watcher is not running."],
    ["errors", !status.error && !watcher.error, status.error || watcher.error || "No runtime error recorded."],
  ];
  for (const [, passed, detail] of checks) {
    severityLine(passed ? "PASS" : "FAIL", detail);
  }
  severityLine("OFF", "Duplex Mode is optional and does not block Standard Mode unless explicitly installed.");
  if (!manifest.version) severityLine("WARN", "Versioned runtime manifest missing", "Run scripts/install-dom-tts.ps1 for v0.3.1 Codex-native installation.");

  const ok = fs.existsSync(path.join(ROOT, "SKILL.md"))
    && (fs.existsSync(path.join(DOM_PLUGIN, ".codex-plugin", "plugin.json")) || fs.existsSync(path.join(PLUGIN, ".codex-plugin", "plugin.json")))
    && Boolean(globalProcess)
    && transcript.ok
    && !status.error
    && !watcher.error
    && (!probe || (edgeProbe?.ok && sapiProbe?.ok));
  process.exitCode = ok ? 0 : 1;
}

main();
