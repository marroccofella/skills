const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

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
    fs.writeFileSync(file, text, "utf8");
    const voice = options.voice || "";
    const rate = Number.isInteger(options.rate) ? options.rate : sapiRate(options.speed);
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Add-Type -AssemblyName System.Speech`,
      `$text = Get-Content -LiteralPath ${psQuote(file)} -Raw`,
      `$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer`,
      voice ? `try { $speaker.SelectVoice(${psQuote(voice)}) } catch { }` : "",
      `$speaker.Rate = ${rate}`,
      "$speaker.Speak($text)",
    ].filter(Boolean).join("; ");

    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true,
      stdio: "ignore",
    });
    context.setCurrentPid(child.pid);
    child.on("error", error => {
      cleanup(file, context);
      reject(error);
    });
    child.on("exit", code => {
      cleanup(file, context);
      code === 0 ? resolve() : reject(new Error(`SAPI playback exited with code ${code}`));
    });
  });
}

function cleanup(file, context) {
  context.clearCurrentPid();
  try { fs.unlinkSync(file); } catch {}
}

module.exports = { speakChunk };
