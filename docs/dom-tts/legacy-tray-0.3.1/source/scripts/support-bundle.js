const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOME = process.env.USERPROFILE || process.env.HOME || "";
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local");
const PRODUCT = path.join(LOCAL, "42uk", "DomTTS");
const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const OUT_ROOT = path.join(PRODUCT, "support-bundles");

function read(file, fallback = "") {
  try { return fs.readFileSync(file, "utf8"); } catch { return fallback; }
}

function readJson(file, fallback = null) {
  try { return JSON.parse(read(file).replace(/^\uFEFF/, "")); } catch { return fallback; }
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 45000,
  });
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function redact(text) {
  return String(text || "")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\r\n,}]+/gi, "$1=<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer <redacted>");
}

function tailSafe(file, maxLines = 200) {
  const base = path.basename(file).toLowerCase();
  if (/queue|turns|transcript|audio|\.mp3|\.wav/.test(base)) return "";
  const lines = read(file).split(/\r?\n/).slice(-maxLines);
  return redact(lines.join("\n"));
}

function collectFiles(bundleDir) {
  const safeFiles = [
    [path.join(PRODUCT, "install-manifest.json"), "install-manifest.json"],
    [path.join(PRODUCT, "current.json"), "current.json"],
    [path.join(CODEX_HOME, ".agents", "plugins", "marketplace.json"), "codex-marketplace.json"],
    [path.join(CODEX_HOME, "plugins", "dom-tts", ".codex-plugin", "plugin.json"), "dom-tts-plugin.json"],
    [path.join(CODEX_HOME, "plugins", "read-aloud", ".codex-plugin", "plugin.json"), "read-aloud-plugin-compat.json"],
    [path.join(ROOT, "package.json"), "skill-package.json"],
    [path.join(ROOT, "assets", "settings.json"), "settings-redacted.json"],
    [path.join(ROOT, "state", "status.json"), "status.json"],
    [path.join(ROOT, "state", "watcher-status.json"), "watcher-status.json"],
    [path.join(ROOT, "state", "duplex-status.json"), "duplex-status.json"],
    [path.join(ROOT, "state", "transcript-schema-report.json"), "transcript-schema-report.json"],
  ];

  for (const [source, relative] of safeFiles) {
    if (fs.existsSync(source)) write(path.join(bundleDir, relative), redact(read(source)));
  }

  const logsDir = path.join(bundleDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  for (const file of fs.existsSync(STATE) ? fs.readdirSync(STATE) : []) {
    const full = path.join(STATE, file);
    if (fs.statSync(full).isFile() && /\.(log|jsonl)$/i.test(file) && !/queue|turns|telemetry/i.test(file)) {
      write(path.join(logsDir, `${file}.tail.txt`), tailSafe(full));
    }
  }
}

function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bundleDir = path.join(OUT_ROOT, `dom-tts-support-${stamp}`);
  const zipPath = `${bundleDir}.zip`;
  fs.mkdirSync(bundleDir, { recursive: true });

  const doctor = run(process.execPath, [path.join(__dirname, "doctor.js")]);
  const schema = run(process.execPath, [path.join(__dirname, "check-codex-transcript-schema.js")]);
  const voiceDoctor = run(process.execPath, [path.join(__dirname, "voice-doctor.js")], { timeout: 30000 });

  write(path.join(bundleDir, "doctor.txt"), redact(`${doctor.stdout}\n${doctor.stderr}`));
  write(path.join(bundleDir, "transcript-schema-check.txt"), redact(`${schema.stdout}\n${schema.stderr}`));
  write(path.join(bundleDir, "voice-doctor.txt"), redact(`${voiceDoctor.stdout}\n${voiceDoctor.stderr}`));
  write(path.join(bundleDir, "environment.json"), JSON.stringify({
    product: "Dom TTS",
    publisher: "42.uk",
    author: "Prof Dom Marrocco",
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    windowsRelease: os.release(),
    codeHome: CODEX_HOME,
    runtimeRoot: PRODUCT,
    skillRoot: ROOT,
  }, null, 2));

  collectFiles(bundleDir);

  const ps = run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    `Compress-Archive -LiteralPath '${bundleDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
  ], { timeout: 120000 });

  if (ps.status !== 0) {
    console.error(ps.stderr || ps.stdout || "Compress-Archive failed.");
    process.exitCode = 1;
    return;
  }
  console.log("Dom TTS support bundle created.");
  console.log(zipPath);
}

main();
