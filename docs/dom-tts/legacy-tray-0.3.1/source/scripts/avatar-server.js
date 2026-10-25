const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  ROOT,
  AVATAR_STATUS,
  ensureState,
  loadAvatarConfig,
  writeAvatarStatus,
  readSnapshot,
  readJson,
} = require("./avatar-state");
const { processTextTurn, stopSpeech, loadConfig, whisperPath } = require("./voice-runtime");
const { appendTelemetry } = require("./telemetry");

const UI_FILE = path.join(ROOT, "assets", "avatar-ui.html");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-open") args.noOpen = true;
    else if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[i + 1] || "";
      i += 1;
    }
  }
  return args;
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        const params = new URLSearchParams(body);
        resolve(Object.fromEntries(params.entries()));
      }
    });
    request.on("error", reject);
  });
}

function withAgentPrefix(text, agentId) {
  const clean = String(text || "").trim();
  if (!clean) return "";
  if (/^(hey|hay)\s+/i.test(clean)) return clean;
  if (agentId === "bab") return `Hey Bab ${clean}`;
  if (agentId === "bob") return `Hey Bob ${clean}`;
  return clean;
}

function openBrowser(url) {
  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return;
  }
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(opener, [url], { detached: true, stdio: "ignore" });
  child.unref();
}

function serveUi(response) {
  const html = fs.readFileSync(UI_FILE, "utf8");
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Cache-Control": "no-store",
  });
  response.end(html);
}

function deviceRedirect(response, config, deviceId, searchParams = new URLSearchParams()) {
  const id = String(deviceId || "").trim().toLowerCase();
  const device = config.devices?.map?.[id];
  if (!device) {
    sendJson(response, 404, { ok: false, error: `Unknown avatar device '${id || "unknown"}'.` });
    return;
  }
  const autoswitch = searchParams.get("autoswitch") === "1" ? "&autoswitch=1" : "";
  const location = `/?device=${encodeURIComponent(id)}&fullscreen=1${autoswitch}`;
  response.writeHead(302, {
    "Location": location,
    "Cache-Control": "no-store",
  });
  response.end();
}

function recordAndTranscribe() {
  const config = loadConfig();
  const captureDevice = String(config.audio?.captureDevice || "").trim();
  const whisper = whisperPath(config);
  const model = String(config.stt?.modelPath || "").trim();
  if (!captureDevice) throw new Error("No microphone capture device configured. Set audio.captureDevice in assets/voice-runtime.json.");
  if (!whisper) throw new Error("Whisper.cpp executable not found. Set stt.whisperPath in assets/voice-runtime.json.");
  if (!model || !fs.existsSync(model)) throw new Error("Whisper.cpp modelPath is not configured or does not exist.");
  let audio = "";
  const record = spawnSync(process.execPath, [path.join(__dirname, "record-audio.js")], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  if (record.status !== 0) throw new Error(record.stderr || record.stdout || "record-audio failed");
  audio = record.stdout.trim().split(/\r?\n/).pop();
  try {
    const transcribe = spawnSync(process.execPath, [path.join(__dirname, "transcribe-audio.js"), "--audio", audio], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    });
    if (transcribe.status !== 0) throw new Error(transcribe.stderr || transcribe.stdout || "transcribe-audio failed");
    return {
      audio,
      text: transcribe.stdout.trim(),
    };
  } finally {
    if (audio && config.privacy?.retainAudio !== true) {
      try { fs.unlinkSync(audio); } catch {}
    }
  }
}

function createServer() {
  const clients = new Set();
  const config = loadAvatarConfig();
  const eventIntervalMs = Math.max(750, Number(config.eventIntervalMs || 400));
  let snapshotCache = null;
  let snapshotCacheAt = 0;

  function getSnapshot(maxAgeMs = eventIntervalMs) {
    const now = Date.now();
    if (snapshotCache && now - snapshotCacheAt <= maxAgeMs) return snapshotCache;
    try {
      snapshotCache = readSnapshot();
      snapshotCacheAt = Date.now();
      return snapshotCache;
    } catch (error) {
      if (snapshotCache) return { ...snapshotCache, phase: "error", error: error.message };
      return {
        activeAgent: config.defaultAgent || "bob",
        phase: "error",
        spokenText: "",
        userText: "",
        config,
        error: error.message,
      };
    }
  }

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && requestUrl.pathname === "/") {
        serveUi(response);
        return;
      }
      const deviceMatch = /^\/device\/([^/]+)$/.exec(requestUrl.pathname);
      if (request.method === "GET" && deviceMatch) {
        deviceRedirect(response, config, deviceMatch[1], requestUrl.searchParams);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/device-map") {
        sendJson(response, 200, { ok: true, devices: config.devices || {} });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/health") {
        sendJson(response, 200, { ok: true, snapshot: getSnapshot(2500) });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/snapshot") {
        sendJson(response, 200, getSnapshot(1000));
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/events") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.write(`event: snapshot\ndata: ${JSON.stringify(getSnapshot(1000))}\n\n`);
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/turn") {
        const body = await readBody(request);
        const text = withAgentPrefix(body.text, String(body.agent || "").toLowerCase());
        if (!text) {
          sendJson(response, 400, { ok: false, error: "No turn text was provided." });
          return;
        }
        const activeAgent = String(body.agent || "").toLowerCase() || undefined;
        writeAvatarStatus({ activeAgent, phase: "thinking", lastUserText: text, error: null });
        const options = {
          source: "avatar",
          interrupt: "hotkey",
          simulatedReply: body.simulatedReply || "",
          skipSpeech: body.skipSpeech === true || body.skipSpeech === "true",
          timeoutMs: Number(body.timeoutMs || 90000),
        };
        const shouldWait = body.wait === true || body.wait === "true" || options.simulatedReply || options.skipSpeech;
        if (shouldWait) {
          const result = await processTextTurn(text, options);
          sendJson(response, 200, { ok: true, result, snapshot: getSnapshot(0) });
          return;
        }
        sendJson(response, 202, { ok: true, accepted: true, snapshot: getSnapshot(0) });
        setImmediate(() => {
          processTextTurn(text, options)
            .catch(error => {
              writeAvatarStatus({ phase: "error", error: error.message });
              appendTelemetry({ event: "avatar_turn_failed", error: error.message });
            });
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/record-once") {
        const body = await readBody(request);
        writeAvatarStatus({ activeAgent: body.agent || undefined, phase: "listening", error: null });
        const capture = recordAndTranscribe();
        const text = withAgentPrefix(capture.text, String(body.agent || "").toLowerCase());
        const result = await processTextTurn(text, {
          source: "avatar-audio",
          interrupt: "hotkey",
          simulatedReply: body.simulatedReply || "",
          skipSpeech: body.skipSpeech === true || body.skipSpeech === "true",
          timeoutMs: Number(body.timeoutMs || 90000),
        });
        sendJson(response, 200, { ok: true, transcript: capture.text, result, snapshot: getSnapshot(0) });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/stop") {
        writeAvatarStatus({ phase: "idle", speakingText: null, error: null });
        sendJson(response, 200, { ok: true, snapshot: getSnapshot(0) });
        setImmediate(() => {
          try {
            stopSpeech();
          } catch (error) {
            writeAvatarStatus({ phase: "error", error: error.message });
            appendTelemetry({ event: "avatar_stop_failed", error: error.message });
          }
        });
        return;
      }
      sendJson(response, 404, { ok: false, error: "Not found" });
    } catch (error) {
      writeAvatarStatus({ phase: "error", error: error.message });
      appendTelemetry({ event: "avatar_server_error", error: error.message });
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });

  const timer = setInterval(() => {
    const data = `event: snapshot\ndata: ${JSON.stringify(getSnapshot(0))}\n\n`;
    for (const client of [...clients]) {
      try {
        client.write(data);
      } catch {
        clients.delete(client);
      }
    }
  }, eventIntervalMs);

  server.on("close", () => clearInterval(timer));
  return server;
}

function listen(server, host, port, attempts = 20) {
  return new Promise((resolve, reject) => {
    function tryPort(candidate, remaining) {
      function onError(error) {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && remaining > 0) {
          tryPort(candidate + 1, remaining - 1);
        } else {
          reject(error);
        }
      }
      function onListening() {
        server.off("error", onError);
        resolve(candidate);
      }
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(candidate, host);
    }
    tryPort(port, attempts);
  });
}

async function main() {
  ensureState();
  const args = parseArgs(process.argv.slice(2));
  const config = loadAvatarConfig();
  if (config.enabled === false) throw new Error("Avatar is disabled in assets/avatar.json.");
  const host = config.host || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Avatar server must bind to localhost.");
  const server = createServer();
  const port = await listen(server, host, Number(args.port || config.port || 42742));
  const url = `http://${host}:${port}/`;
  const deviceId = String(args.device || "").trim().toLowerCase();
  const launchUrl = deviceId ? `http://${host}:${port}/device/${encodeURIComponent(deviceId)}` : url;
  writeAvatarStatus({
    pid: process.pid,
    url,
    launchUrl,
    activeAgent: config.defaultAgent || "bob",
    phase: "ready",
    lastUserText: null,
    speakingText: null,
    error: null,
  });
  appendTelemetry({ event: "avatar_server_started", url, pid: process.pid });
  console.log(`Dom TTS Avatar running at ${url}`);
  if (config.launchBrowser !== false && !args.noOpen) openBrowser(launchUrl);

  function shutdown() {
    appendTelemetry({ event: "avatar_server_stopped", url, pid: process.pid });
    writeAvatarStatus({ pid: null, phase: "stopped", stoppedAt: new Date().toISOString() });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1200).unref();
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(error => {
  ensureState();
  const current = readJson(AVATAR_STATUS, {});
  writeAvatarStatus({ ...current, phase: "error", error: error.message });
  appendTelemetry({ event: "avatar_server_failed", error: error.message });
  console.error(error.message);
  process.exitCode = 1;
});
