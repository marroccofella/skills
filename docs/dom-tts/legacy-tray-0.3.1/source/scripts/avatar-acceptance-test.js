const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { AVATAR_STATUS, readJson } = require("./avatar-state");
const { shouldShowAvatar, avatarUrl } = require("./avatar-screen-switcher");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = options.body ? JSON.stringify(options.body) : "";
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      timeout: options.timeout || 15000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
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
    if (body) request.write(body);
    request.end();
  });
}

function firstEvent(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: "/events",
      method: "GET",
      headers: { Accept: "text/event-stream" },
    }, response => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        data += chunk;
        if (data.includes("event: snapshot")) {
          response.destroy();
          request.destroy();
          resolve(true);
        }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error("event stream timed out")));
    request.on("error", error => {
      if (data.includes("event: snapshot")) resolve(true);
      else reject(error);
    });
    request.end();
  });
}

function requestStatus(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: "GET",
      timeout: 5000,
    }, response => {
      response.resume();
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          location: response.headers.location || "",
        });
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
        await requestJson(`${status.url}health`, { timeout: 1500 });
        return status.url;
      } catch {}
    }
    await sleep(150);
  }
  throw new Error("avatar server did not become healthy");
}

async function main() {
  const child = spawn(process.execPath, [path.join(__dirname, "avatar-server.js"), "--no-open"], {
    cwd: path.resolve(__dirname, ".."),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stdout.on("data", chunk => { childOutput += chunk.toString(); });
  child.stderr.on("data", chunk => { childOutput += chunk.toString(); });

  let url = "";
  try {
    url = await waitForServer(child);
    await firstEvent(url);
    const deviceMap = await requestJson(`${url}device-map`);
    const sb2Device = await requestStatus(`${url}device/sb2`);
    const turn = await requestJson(`${url}turn`, {
      method: "POST",
      body: {
        agent: "bab",
        text: "avatar acceptance test",
        simulatedReply: "Bab avatar acceptance reply.",
        skipSpeech: true,
      },
    });
    const snapshot = await requestJson(`${url}snapshot`);
    const fakeConfig = { devices: { map: { sb2: { agent: "bab" }, sb3: { agent: "bob" } } } };
    const switcherUrl = avatarUrl(url, "sb3");
    const checks = [
      ["Server healthy", Boolean(url)],
      ["SSE snapshot", true],
      ["Device map exposes SB2/Bab", deviceMap.devices?.map?.sb2?.agent === "bab"],
      ["Device map exposes SB3/Bob", deviceMap.devices?.map?.sb3?.agent === "bob"],
      ["SB2 device route", sb2Device.statusCode === 302 && /device=sb2/.test(sb2Device.location) && /fullscreen=1/.test(sb2Device.location)],
      ["Auto switch URL", /device=sb3/.test(switcherUrl) && /autoswitch=1/.test(switcherUrl)],
      ["Auto SB3 lights for Bob", shouldShowAvatar({ config: fakeConfig, activeAgent: "bob", phase: "speaking" }, "sb3")],
      ["Auto SB2 lights for Bab", shouldShowAvatar({ config: fakeConfig, activeAgent: "bab", phase: "listening" }, "sb2")],
      ["Auto SB2 ignores Bob", !shouldShowAvatar({ config: fakeConfig, activeAgent: "bob", phase: "speaking" }, "sb2")],
      ["Auto SB3 returns on idle", !shouldShowAvatar({ config: fakeConfig, activeAgent: "bob", phase: "idle" }, "sb3")],
      ["Turn accepted", turn.ok === true],
      ["Agent routed Bab", turn.result?.agent === "bab"],
      ["Avatar active Bab", snapshot.activeAgent === "bab"],
      ["Avatar idle", snapshot.phase === "idle"],
      ["No avatar error", !snapshot.error],
    ];
    console.log("Dom TTS Avatar Acceptance Test");
    for (const [name, ok] of checks) console.log(`${name}: ${ok ? "yes" : "no"}`);
    if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  } finally {
    spawnSync(process.execPath, [path.join(__dirname, "stop-avatar-server.js")], {
      cwd: path.resolve(__dirname, ".."),
      windowsHide: true,
      stdio: "ignore",
    });
    child.kill();
    await sleep(200);
    if (process.exitCode && childOutput.trim()) console.error(childOutput.trim());
  }
}

main().catch(error => {
  console.error(`Dom TTS Avatar Acceptance Test failed: ${error.message}`);
  process.exitCode = 1;
});
