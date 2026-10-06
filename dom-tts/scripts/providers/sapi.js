const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { powershell, marker, safeEnv } = require("../runtime");

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sapiRate(speed) {
  const numeric = Number(speed || 1);
  return Math.max(-10, Math.min(10, Math.round((numeric - 1) * 10)));
}

function speakChunk(text, options, context) {
  return new Promise((resolve, reject) => {
    const file = path.join(context.stateDir, `sapi-${Date.now()}-${process.pid}.txt`);
    fs.writeFileSync(file, text, { encoding: "utf8", mode: 0o600 });
    const voice = options.voice || "";
    const rate = Number.isInteger(options.rate) ? options.rate : sapiRate(options.speed);
    const command = [
      "$ErrorActionPreference = 'Stop'",
      "$env:PSModulePath = Join-Path $PSHOME 'Modules'",
      `$DomTTSMarker = '${marker}'`,
      `Add-Type -AssemblyName System.Speech`,
      `$text = Get-Content -LiteralPath ${psQuote(file)} -Raw -Encoding UTF8`,
      `$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer`,
      voice ? `try { $speaker.SelectVoice(${psQuote(voice)}) } catch { }` : "",
      `$speaker.Rate = ${rate}`,
      "$speaker.Speak($text)",
    ].filter(Boolean).join("; ");

    const child = spawn(powershell, ["-NoProfile", "-Command", command], {
      windowsHide: true,
      stdio: "ignore",
      env: safeEnv(),
    });
    context.setCurrentPid(child.pid);
    const deadline = setTimeout(() => {
      child.kill();
      cleanup(file, context);
      reject(new Error("SAPI playback exceeded the two-minute limit"));
    }, 120000);
    child.on("error", error => {
      clearTimeout(deadline);
      cleanup(file, context);
      reject(error);
    });
    child.on("exit", code => {
      clearTimeout(deadline);
      cleanup(file, context);
      code === 0 ? resolve() : reject(new Error(`SAPI playback exited with code ${code}`));
    });
  });
}

function cleanup(file, context) {
  context.clearCurrentPid();
  try { fs.unlinkSync(file); } catch {}
}

module.exports = { speakChunk, sapiRate };
