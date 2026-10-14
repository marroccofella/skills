const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

if (process.platform === "win32") process.env.NoDefaultCurrentDirectoryInExePath = "1";
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
const marker = "DomTTSStandardPlayback";

function safeEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(?:API.?KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL)/i.test(name)));
}

function playbackProcessLooksOwned(pid) {
  if (process.platform !== "win32" || !/^[1-9]\d*$/.test(String(pid))) return false;
  const result = spawnSync(powershell, ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`,
  ], { encoding: "utf8", windowsHide: true, timeout: 5000, env: safeEnv() });
  if (result.error || result.status !== 0) return false;
  const command = String(result.stdout || "");
  return command.includes(marker) && command.includes("System.Speech.Synthesis.SpeechSynthesizer");
}

function readObject(file, fallback = {}) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch { return fallback; }
}

function parseCli(argv, defaults = {}) {
  const args = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) throw new Error("Expected a named command-line option");
    const key = argv[i].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key === "dryRun") args[key] = true;
    else {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${argv[i]}`);
      args[key] = argv[++i];
    }
  }
  return args;
}

module.exports = { powershell, taskkill, marker, safeEnv, playbackProcessLooksOwned, readObject, parseCli };
