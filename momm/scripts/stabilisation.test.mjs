#!/usr/bin/env node
// Offline regressions for confirmed release-readiness defects. No accounts.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const passed = [], failed = [];
function test(name, fn) { try { fn(); passed.push(name); } catch (e) { failed.push({ name, error: e.message }); } }
function between(source, first, last) { const a = source.indexOf(first), b = source.indexOf(last, a); assert(a >= 0 && b > a, "fixture source boundaries moved"); return source.slice(a, b); }
const classify = vm.runInNewContext(between(read("momm/scripts/multi-review.mjs"), "function classifyFailure(", "async function invokeReviewer(") + ";classifyFailure", {
  stripAnsi: s => String(s ?? ""), clipped: (s, n) => String(s ?? "").slice(0, n),
});
test("CLI/model incompatibility is not a login failure even when diagnostics mention OAuth", () => {
  const result = classify({ code: 1, stdout: "", stderr: "failed to load models cache: missing field supports_parallel_tool_calls\nOAuth session present; browser login available" });
  assert.equal(result.status, "error"); assert.match(result.detail, /upgrad|updat/i);
});
test("incidental browser terminology does not trigger login advice", () => assert.equal(classify({ code: 1, stdout: "", stderr: "invalid configuration: browser handler is unavailable" }).status, "error"));
test("genuine sign-in request still carries authentication status", () => assert.equal(classify({ code: 1, stdout: "", stderr: "Please sign in to continue" }).status, "authentication_required"));
for(const installer of ['install.mjs','momm/scripts/install.mjs']) test(`${installer} recognizes a short-name alias without overwriting other links`,()=>{
  const code=between(read(installer),'function sameTarget(','\n}')+'\n}';
  const realpathSync=p=>path.win32.normalize(p);realpathSync.native=p=>realpathSync(p).replace('Q:\\SHORT~1','Q:\\long-installation');
  const same=vm.runInNewContext(code+';sameTarget',{fs:{realpathSync},process:{platform:'win32'},canon:p=>path.win32.resolve(p).toLowerCase()});
  assert.equal(same('Q:\\SHORT~1\\momm','Q:\\long-installation\\momm'),true);
  assert.equal(same('Q:\\SHORT~1\\another-skill','Q:\\long-installation\\momm'),false);
});
for(const installer of ['install.mjs','momm/scripts/install.mjs']) test(`${installer} keeps the non-Windows resolver and fails closed on resolution errors`,()=>{
  const code=between(read(installer),'function sameTarget(','\n}')+'\n}';
  const realpathSync=p=>path.posix.normalize(p);
  realpathSync.native=()=>{throw new Error('native resolver must not run on POSIX');};
  const same=vm.runInNewContext(code+';sameTarget',{fs:{realpathSync},process:{platform:'darwin'},canon:p=>path.posix.resolve(p)});
  assert.equal(same('/fixture/./momm','/fixture/momm'),true);
  assert.equal(same('/fixture/other','/fixture/momm'),false);
  const failed=vm.runInNewContext(code+';sameTarget',{fs:{realpathSync},process:{platform:'win32'},canon:p=>p});
  assert.equal(failed('Q:\\fixture\\momm','Q:\\fixture\\momm'),false,'unverified native targets must not be reported as verified links');
});
test("skill list trims and deduplicates without accepting empty scope", () => {
  const parse = vm.runInNewContext(between(read("install.mjs"), "function parseArgs(", "function linkOne(") + ";parseArgs", { path });
  assert.equal(JSON.stringify(parse(["--skills", "momm, myrepo,momm"]).skills), JSON.stringify(["momm", "myrepo"]));
  assert.equal(parse(["--skills", " , "]).skills.length, 0);
});
test("torn update claim fails closed with recovery guidance without removing it", () => {
  let removed = false;
  const exclusive = vm.runInNewContext(between(read("momm/scripts/update.mjs"), "function exclusive(", "export async function update(") + ";exclusive", {
    path, directory() {}, regular: () => true, readJSON: () => { throw new SyntaxError("Unexpected end of JSON input"); },
    fs: { unlinkSync: () => { removed = true; } }, process,
  });
  assert.throws(() => exclusive("fixture", () => {}), /update.*claim|claim.*invalid/i); assert.equal(removed, false);
});
for (const installer of ["install.mjs", "momm/scripts/install.mjs"]) test(`${installer} exposes successful links when receipt writing fails`, () => {
  let stdout = "", stderr = "", links = 0;
  const proc = { argv: ["node", installer], stdout: { write: s => stdout += s }, stderr: { write: s => stderr += s }, exitCode: 0 };
  const options = { targets: [], customDirs: ["fixture"], dryRun: false, pretty: false };
  const linked = () => { links++; return { destination: "fixture/momm", status: "linked", skill: "momm" }; };
  const code = read(installer).slice(read(installer).indexOf("function main()"));
  vm.runInNewContext(code, { process: proc, path, os, repoRoot: root, skillRoot: path.join(root, "momm"), parseArgs: () => options,
    discoverSkills: () => ["momm"], commandExists: () => false, linkAll: () => [linked()], linkSkill: linked,
    recordInstall: () => { throw Object.assign(new Error("receipt blocked"), { code: "EACCES" }); } });
  assert.equal(links, 1); assert.equal(proc.exitCode, 1);
  const result = JSON.parse(stdout); assert.equal(result.results.length, 1); assert.equal(result.installation.updater_available, false);
  assert.match(result.installation.error, /receipt blocked/); assert.match(stderr, /receipt|install/i);
});
test("release check refuses dirty worktree rather than certifying HEAD alone", () => {
  const manifest = { momm: "1.15.0", momm_releases: [{ version: "1.15.0", tag: "momm-1.15.0", sha256: "seal", hash_covers: "git-tree-blobs-excluding-versions/1" }] };
  const text = read("scripts/momm-release.mjs").replace(/^import .*;\r?\n/gm, "").replaceAll("import.meta.url", JSON.stringify("file:///fixture/scripts/momm-release.mjs"));
  const fakeFs = { readFileSync: p => String(p).endsWith("versions.json") ? JSON.stringify(manifest) : String(p).endsWith("README.md") ? "momm-1.15.0-" : 'const MOMM_VERSION = "1.15.0"' };
  assert.throws(() => vm.runInNewContext(text, { fs: fakeFs, path, fileURLToPath: () => path.join(root, "scripts/momm-release.mjs"),
    process: { argv: ["node", "script", "--check"], stdout: { write() {} } }, treeHash: () => "seal",
    git: (_root, ...args) => args[0] === "status" ? " M momm/scripts/multi-review.mjs" : JSON.stringify(manifest) }), /dirty|uncommitted|working tree/i);
});
test("directory preview redirects before resolving relative assets", () => {
  let handler, status, headers, body;
  const code = read("scripts/preview-momm-site.mjs").replace(/^import .*;\r?\n/gm, "").replaceAll("import.meta.url", JSON.stringify("file:///fixture/scripts/preview-momm-site.mjs"));
  vm.runInNewContext(code, { http: { createServer: fn => { handler = fn; return { listen() {} }; } }, path, URL,
    fs: { statSync: () => ({ isDirectory: () => true }), realpathSync: p => p, createReadStream: () => ({ pipe() {} }) },
    fileURLToPath: () => path.join(root, "scripts/preview-momm-site.mjs"), process: { argv: ["node", "script"] } });
  handler({ method: "GET", url: "/momm?view=local" }, { writeHead: (s, h) => { status = s; headers = h; }, end: s => { body = s; } });
  assert.equal(status, 308); assert.equal(headers.Location, "/momm/?view=local"); assert.equal(body, undefined);
});
test("preview stream failures are handled and unsupported methods declare Allow", () => {
  let handler, status, headers, destroyed = false;
  const stream = new PassThrough();
  const code = read("scripts/preview-momm-site.mjs").replace(/^import .*;\r?\n/gm, "").replaceAll("import.meta.url", JSON.stringify("file:///fixture/scripts/preview-momm-site.mjs"));
  vm.runInNewContext(code, { http: { createServer: fn => { handler = fn; return { listen() {} }; } }, path, URL,
    fs: { statSync: () => ({ isDirectory: () => false }), realpathSync: p => p, createReadStream: () => stream },
    fileURLToPath: () => path.join(root, "scripts/preview-momm-site.mjs"), process: { argv: ["node", "script"] } });
  const res = new PassThrough(); res.writeHead = (s, h) => { status = s; headers = h; }; res.destroy = () => { destroyed = true; };
  handler({ method: "GET", url: "/momm/site.css" }, res);
  assert.doesNotThrow(() => stream.emit("error", new Error("synthetic read failure"))); assert.equal(destroyed, true);
  handler({ method: "POST", url: "/momm/" }, { writeHead: (s, h) => { status = s; headers = h; }, end() {} });
  assert.equal(status, 405); assert.equal(headers.Allow, "GET, HEAD");
});
let click, change, pageshow, nextTimer = 0;
const timers = new Map(), button = { dataset: { copy: "copy-source" }, textContent: "Copy", addEventListener: (_event, fn) => { click = fn; } };
const harness = { value: "claude", addEventListener: (_event, fn) => { change = fn; } }, preview = { textContent: "codex" }, apply = { textContent: "codex" };
vm.runInNewContext(read("docs/momm/site.js"), { document: {
  querySelectorAll: () => [button], getElementById: id => id === "harness" ? harness : { textContent: "command" },
  querySelector: selector => selector === "#install-preview code" ? preview : apply,
}, navigator: { clipboard: { writeText: async () => {} } }, window: { addEventListener: (event, fn) => { if (event === "pageshow") pageshow = fn; } },
setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id) });
test("restored harness selection synchronizes install commands immediately", () => { assert.match(preview.textContent, /--target claude/); assert.match(apply.textContent, /--target claude/); });
await click(); const earlierReset = [...timers.values()][0]; await click();
test("earlier copy feedback cannot clear the newer result", () => { earlierReset(); assert.equal(button.textContent, "Copied"); assert.equal(timers.size, 1); });
test("back-forward page restore resynchronizes harness selection", () => { harness.value = "gemini"; assert.equal(typeof pageshow, "function"); pageshow(); assert.match(apply.textContent, /--target gemini/); });
process.stdout.write(JSON.stringify({ passed, failed, model_calls: 0 }, null, 2) + "\n");
if (failed.length) process.exitCode = 1;
