const fs = require("fs");
const path = require("path");

const HOME = process.env.USERPROFILE || process.env.HOME || "";
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const SESSIONS = path.join(CODEX_HOME, "sessions");
const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const REPORT = path.join(STATE, "transcript-schema-report.json");

function walkRollouts(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkRollouts(full, files);
    else if (/^rollout-.*\.jsonl$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function inspect(files) {
  const stats = {
    sessionsPath: SESSIONS,
    filesFound: files.length,
    filesSampled: 0,
    parseableLines: 0,
    assistantMessages: 0,
    assistantOutputText: 0,
    finalAnswerHints: 0,
    fingerprint: "unknown",
    ok: false,
    warning: "",
  };

  for (const file of files.slice(-30)) {
    stats.filesSampled += 1;
    let lines = [];
    try {
      lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-300);
    } catch {
      continue;
    }
    for (const line of lines) {
      let record;
      try {
        record = JSON.parse(line);
        stats.parseableLines += 1;
      } catch {
        continue;
      }
      const payload = record.payload || {};
      if (record.type === "response_item" && payload.type === "message" && payload.role === "assistant") {
        stats.assistantMessages += 1;
        const parts = Array.isArray(payload.content) ? payload.content : [];
        if (parts.some(part => part && part.type === "output_text" && typeof part.text === "string")) {
          stats.assistantOutputText += 1;
        }
        if (payload.phase === "final_answer" || parts.some(part => part && /final/i.test(part.phase || ""))) {
          stats.finalAnswerHints += 1;
        }
      }
    }
  }

  stats.ok = stats.parseableLines > 0 && stats.assistantMessages > 0 && stats.assistantOutputText > 0;
  stats.fingerprint = stats.ok
    ? "response_item.payload.message.assistant.content.output_text"
    : "unrecognized";
  if (!fs.existsSync(SESSIONS)) stats.warning = "Codex sessions folder was not found.";
  else if (stats.filesFound === 0) stats.warning = "No Codex rollout transcript files were found yet.";
  else if (!stats.ok) stats.warning = "Recent transcript files did not match the expected assistant output shape.";
  return stats;
}

function main() {
  fs.mkdirSync(STATE, { recursive: true });
  const result = inspect(walkRollouts(SESSIONS));
  result.checkedAt = new Date().toISOString();
  fs.writeFileSync(REPORT, JSON.stringify(result, null, 2), "utf8");

  console.log("Dom TTS Codex Transcript Compatibility Check");
  console.log(`Sessions: ${result.sessionsPath}`);
  console.log(`Rollout files found: ${result.filesFound}`);
  console.log(`Files sampled: ${result.filesSampled}`);
  console.log(`Parseable lines: ${result.parseableLines}`);
  console.log(`Assistant output records: ${result.assistantOutputText}`);
  console.log(`Fingerprint: ${result.fingerprint}`);
  console.log(`Result: ${result.ok ? "PASS" : "WARN"}`);
  if (result.warning) console.log(`Warning: ${result.warning}`);
  process.exitCode = result.ok ? 0 : 2;
}

main();
