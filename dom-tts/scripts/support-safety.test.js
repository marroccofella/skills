const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectDiagnostics, sanitizeStatus } = require("./support-safety");
const { buildArchive } = require("./support-bundle");
const sentinel = "PRIVATE_SENTINEL_DO_NOT_EXPORT";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dom-tts-support-test-"));
try {
  fs.mkdirSync(path.join(root, "state"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.3.1", privateField: sentinel }));
  const hostile = { state: "speaking", provider: "sapi", mode: "summary", profile: "engineering", chunks: 2,
    currentChunk: sentinel, lastText: sentinel, error: sentinel, path: sentinel, token: sentinel, nested: { text: sentinel }, voice: sentinel };
  for (const name of ["status", "watcher-status", "duplex-status"]) {
    fs.writeFileSync(path.join(root, "state", `${name}.json`), JSON.stringify(hostile));
  }
  fs.writeFileSync(path.join(root, "state", "arbitrary.log"), sentinel);
  fs.writeFileSync(path.join(root, "assets", "settings.json"), sentinel);
  const report = collectDiagnostics(root);
  assert.equal(JSON.stringify(report).includes(sentinel), false);
  assert.equal(JSON.stringify(report).includes(root), false);
  assert.equal(report.statuses.status.hasError, true);
  assert.equal(report.statuses.status.chunks, 2);
  assert.deepEqual(sanitizeStatus({ state: sentinel, provider: sentinel, chunks: -1 }), { hasError: false });
  assert.deepEqual(sanitizeStatus([hostile]), {});
  fs.writeFileSync(path.join(root, "state", "status.json"), "malformed");
  assert.deepEqual(collectDiagnostics(root).statuses.status, { hasError: false });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: sentinel }));
  assert.equal(collectDiagnostics(root).version, "unknown");
  fs.writeFileSync(path.join(root, "package.json"), "null");
  assert.equal(collectDiagnostics(root).version, "unknown");
  assert.deepEqual(sanitizeStatus({ chunks: NaN, chunkIndex: Infinity }), { hasError: false });
  let calls = 0;
  const failRun = () => { calls += 1; return { status: null, error: new Error("fixture failure") }; };
  assert.throws(() => buildArchive(root, { platform: "linux", base: root, run: failRun }), /require Windows/);
  assert.equal(calls, 0);
  assert.throws(() => buildArchive(root, { platform: "win32", base: root, run: failRun }), /no diagnostic data was written/);
  assert.equal(calls, 1);
  const parent = path.join(root, "42uk", "DomTTS", "support-bundles");
  assert.deepEqual(fs.readdirSync(parent), []);
  let successCalls = 0;
  const successRun = () => {
    successCalls += 1;
    if (successCalls === 2) {
      const bundle = path.join(parent, fs.readdirSync(parent)[0]);
      fs.writeFileSync(path.join(bundle, "support.zip"), "fixture archive");
    }
    return { status: 0 };
  };
  const archive = buildArchive(root, { platform: "win32", base: root, run: successRun });
  assert.equal(successCalls, 2);
  assert.equal(fs.existsSync(archive), true);
  assert.equal(fs.existsSync(path.join(path.dirname(archive), "diagnostics.json")), false);
  console.log("PASS: support diagnostics exclude text, settings, logs, paths and unknown fields.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
