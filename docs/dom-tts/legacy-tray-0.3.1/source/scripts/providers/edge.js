const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function generateMp3(text, options, outputFile) {
  const { EdgeTTS } = require("node-edge-tts");
  const tts = new EdgeTTS({
    voice: options.voice || "en-US-AriaNeural",
    lang: "en-US",
    outputFormat: "audio-24khz-96kbitrate-mono-mp3",
    rate: options.rate || "default",
    pitch: options.pitch || "default",
    timeout: 10000,
  });
  await tts.ttsPromise(text, outputFile);
  if (!fs.existsSync(outputFile)) throw new Error("Edge TTS did not create an audio file");
}

function playMp3(file, context) {
  if (hasCommand("ffplay.exe")) return playWithFfplay(file, context);
  return playWithWmp(file, context);
}

function hasCommand(command) {
  const result = spawnSync("where.exe", [command], { stdio: "ignore", windowsHide: true });
  return result.status === 0;
}

function playWithFfplay(file, context) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffplay.exe", ["-nodisp", "-autoexit", "-loglevel", "quiet", file], {
      windowsHide: true,
      stdio: "ignore",
    });
    context.setCurrentPid(child.pid);
    child.on("error", error => {
      context.clearCurrentPid();
      reject(error);
    });
    child.on("exit", code => {
      context.clearCurrentPid();
      code === 0 ? resolve() : reject(new Error(`ffplay exited with code ${code}`));
    });
  });
}

function playWithWmp(file, context) {
  return new Promise((resolve, reject) => {
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `$player = New-Object -ComObject WMPlayer.OCX`,
      `$player.URL = ${psQuote(file)}`,
      "$player.controls.play()",
      "$started = $false",
      "$deadline = (Get-Date).AddSeconds(30)",
      "while ($true) {",
      "  Start-Sleep -Milliseconds 100",
      "  if ($player.playState -eq 3) { $started = $true }",
      "  if ($started -and ($player.playState -eq 1 -or $player.playState -eq 8)) { break }",
      "  if ((Get-Date) -gt $deadline) { break }",
      "}",
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true,
      stdio: "ignore",
    });
    context.setCurrentPid(child.pid);
    child.on("error", error => {
      context.clearCurrentPid();
      reject(error);
    });
    child.on("exit", code => {
      context.clearCurrentPid();
      code === 0 ? resolve() : reject(new Error(`Edge audio playback exited with code ${code}`));
    });
  });
}

async function speakChunk(text, options, context) {
  const outputFile = path.join(context.stateDir, `edge-${Date.now()}-${process.pid}.mp3`);
  await generateMp3(text, options, outputFile);
  await playMp3(outputFile, context);
  try { fs.unlinkSync(outputFile); } catch {}
}

module.exports = { speakChunk };
