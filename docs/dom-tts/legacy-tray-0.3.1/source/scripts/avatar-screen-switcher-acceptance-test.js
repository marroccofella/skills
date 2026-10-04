const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  ROOT,
  STATE,
  AVATAR_STATUS,
  ensureState,
  readJson,
  writeJson,
  writeAvatarStatus,
} = require("./avatar-state");
const { shouldShowAvatar } = require("./avatar-screen-switcher");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: "GET",
      timeout: options.timeout || 5000,
      headers: { Accept: "application/json" },
    }, response => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { data += chunk; });
      response.on("end", () => {
        try {
          const parsedBody = JSON.parse(data);
          if (response.statusCode >= 400) reject(new Error(parsedBody.error || `HTTP ${response.statusCode}`));
          else resolve(parsedBody);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("request timed out")));
    request.on("error", reject);
    request.end();
  });
}

async function waitForServer(child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const status = readJson(AVATAR_STATUS, {});
    if (Number(status.pid) === child.pid && status.url) {
      try {
        await requestJson(`${status.url}health`, { timeout: 1200 });
        return status.url;
      } catch {}
    }
    await sleep(150);
  }
  throw new Error("avatar server did not become healthy");
}

function writeRuntimeState(agent, phase) {
  ensureState();
  const now = new Date().toISOString();
  const active = phase !== "idle";
  writeJson(path.join(STATE, "duplex-status.json"), {
    state: "idle",
    runtimeMode: "duplex",
    agent,
    avatarId: agent,
    updatedAt: now,
  });
  writeJson(path.join(STATE, "status.json"), {
    state: active ? "speaking" : "idle",
    mode: "full",
    profile: "conversational",
    provider: "test",
    agent,
    avatarId: agent,
    currentChunk: active ? `${agent} screen switch acceptance` : "",
    updatedAt: now,
  });
  writeJson(path.join(STATE, "queue.json"), {
    mode: "full",
    profile: "conversational",
    provider: "test",
    agent,
    chunks: active ? [`${agent} screen switch acceptance`] : [],
    createdAt: now,
  });
  writeAvatarStatus({
    activeAgent: agent,
    agent,
    phase,
    speakingText: active ? `${agent} screen switch acceptance` : null,
    error: null,
  });
}

function switcherOnce(url, deviceId) {
  const result = spawnSync(process.execPath, [
    path.join(__dirname, "avatar-screen-switcher.js"),
    "--device", deviceId,
    "--once",
    "--no-launch",
    "--no-start-server",
    "--url", url,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `switcher once failed for ${deviceId}`);
  return JSON.parse(result.stdout);
}

async function main() {
  const child = spawn(process.execPath, [path.join(__dirname, "avatar-server.js"), "--no-open"], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stdout.on("data", chunk => { childOutput += chunk.toString(); });
  child.stderr.on("data", chunk => { childOutput += chunk.toString(); });

  try {
    const url = await waitForServer(child);
    writeRuntimeState("bob", "speaking");
    const sb3Bob = switcherOnce(url, "sb3");
    const sb2Bob = switcherOnce(url, "sb2");
    writeRuntimeState("bab", "speaking");
    const sb2Bab = switcherOnce(url, "sb2");
    const sb3Bab = switcherOnce(url, "sb3");
    writeRuntimeState("bob", "idle");
    const sb3Idle = switcherOnce(url, "sb3");
    const fakeConfig = { devices: { showOnLockPage: true, map: { sb2: { agent: "bab" }, sb3: { agent: "bob" } } } };
    const disabledLockConfig = { devices: { showOnLockPage: false, map: { sb3: { agent: "bob" } } } };

    const checks = [
      ["Server healthy", Boolean(url)],
      ["SB3 shows Bob while Bob speaks", sb3Bob.active === true && sb3Bob.activeAgent === "bob" && sb3Bob.phase === "speaking"],
      ["SB2 ignores Bob while Bob speaks", sb2Bob.active === false],
      ["SB2 shows Bab while Bab speaks", sb2Bab.active === true && sb2Bab.activeAgent === "bab" && sb2Bab.phase === "speaking"],
      ["SB3 ignores Bab while Bab speaks", sb3Bab.active === false],
      ["SB3 returns to standby on idle", sb3Idle.active === false && sb3Idle.phase === "idle"],
      ["SB3 shows avatar on lock page", shouldShowAvatar({ config: fakeConfig, activeAgent: "", phase: "idle" }, "sb3", { lockPage: true })],
      ["Lock page can be disabled", !shouldShowAvatar({ config: disabledLockConfig, activeAgent: "", phase: "idle" }, "sb3", { locked: true })],
    ];
    console.log("Dom TTS Avatar Screen Switcher Acceptance Test");
    for (const [name, ok] of checks) console.log(`${name}: ${ok ? "yes" : "no"}`);
    if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  } finally {
    writeRuntimeState("bob", "idle");
    spawnSync(process.execPath, [path.join(__dirname, "stop-avatar-screen-switcher.js")], {
      cwd: ROOT,
      windowsHide: true,
      stdio: "ignore",
    });
    spawnSync(process.execPath, [path.join(__dirname, "stop-avatar-server.js")], {
      cwd: ROOT,
      windowsHide: true,
      stdio: "ignore",
    });
    child.kill();
    await sleep(200);
    if (process.exitCode && childOutput.trim()) console.error(childOutput.trim());
  }
}

main().catch(error => {
  console.error(`Dom TTS Avatar Screen Switcher Acceptance Test failed: ${error.message}`);
  process.exitCode = 1;
});
