const fs = require("fs");
const path = require("path");
const STATES = new Set(["idle", "queued", "speaking", "watching", "stopped", "error", "dry-run"]);
const PROVIDERS = new Set(["auto", "edge", "sapi", "piper"]);
const MODES = new Set(["full", "informative", "summary", "action-items", "errors-only", "warnings-only", "terminal-summary", "diff-summary"]);
const PROFILES = new Set(["concise", "engineering", "conversational"]);

function readDiagnostic(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) return {};
    const value = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

// Only typed operational facts are exportable, never logs or free-form text.
function sanitizeStatus(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output = {};
  for (const [key, allowed] of [["state", STATES], ["provider", PROVIDERS], ["mode", MODES], ["profile", PROFILES]]) {
    if (allowed.has(input[key])) output[key] = input[key];
  }
  for (const key of ["chunks", "chunkIndex", "watchedFiles", "watchedCodexFiles", "watchedOpenClawFiles"]) {
    if (Number.isSafeInteger(input[key]) && input[key] >= 0 && input[key] <= 1000000) output[key] = input[key];
  }
  output.hasError = typeof input.error === "string" && input.error.length > 0;
  return output;
}

function collectDiagnostics(root) {
  const pkg = readDiagnostic(path.join(root, "package.json"));
  const version = typeof pkg.version === "string" && /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(pkg.version) ? pkg.version : "unknown";
  const statuses = {};
  for (const name of ["status", "watcher-status", "duplex-status"]) {
    statuses[name] = sanitizeStatus(readDiagnostic(path.join(root, "state", `${name}.json`)));
  }
  return { schema: "dom-tts-support/1", product: "Dom TTS", version, platform: process.platform, arch: process.arch, node: process.version, statuses };
}

module.exports = { collectDiagnostics, sanitizeStatus };
