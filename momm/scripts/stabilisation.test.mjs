#!/usr/bin/env node
// Offline regressions for confirmed release-readiness defects. No accounts.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const passed = [], failed = [];
function test(name, fn) { try { fn(); passed.push(name); } catch (e) { failed.push({ name, error: e.message }); } }
function between(source, first, last) { const a = source.indexOf(first), b = source.indexOf(last, a); assert(a >= 0 && b > a, "fixture source boundaries moved"); return source.slice(a, b); }
const classify = vm.runInNewContext(between(read("momm/scripts/multi-review.mjs"), "function classifyFailure(", "async function invokeReviewer(") + ";classifyFailure", {
  stripAnsi: s => String(s ?? ""), clipped: (s, n) => String(s ?? "").slice(0, n),
  clippedTail: (s, n) => { const t = String(s ?? "").trim(); return t.length > n ? `…${t.slice(-(n - 1))}` : t; },
});
test("CLI/model incompatibility is not a login failure even when diagnostics mention OAuth", () => {
  const result = classify({ code: 1, stdout: "", stderr: "failed to load models cache: missing field supports_parallel_tool_calls\nOAuth session present; browser login available" });
  assert.equal(result.status, "error"); assert.match(result.detail, /upgrad|updat/i);
});
test("incidental browser terminology does not trigger login advice", () => assert.equal(classify({ code: 1, stdout: "", stderr: "invalid configuration: browser handler is unavailable" }).status, "error"));
test("genuine sign-in request still carries authentication status", () => assert.equal(classify({ code: 1, stdout: "", stderr: "Please sign in to continue" }).status, "authentication_required"));
test("quota classification needs a provider diagnostic, not echoed artifact words", () => {
  for (const stdout of ['if (status === 429) retry();', '// rate limit exceeded', 'quota exhausted']) {
    assert.equal(classify({code:1,stdout,stderr:'unexpected local failure'}).status, 'error');
  }
  for (const stderr of ['HTTP 429 Too Many Requests', 'Error: quota exhausted', 'Rate limit exceeded']) {
    assert.equal(classify({code:1,stdout:'',stderr}).status, 'quota');
  }
  assert.equal(classify({code:1,stdout:'',stderr:'',cancelled:true}).status, 'cancelled');
});
const retry = vm.runInNewContext(between(read('momm/scripts/multi-review.mjs'), 'const PROVIDER_RETRY_DELAY_MS', 'function createUi(') + ';invokeWithRetry', {setTimeout});
let retryCalls=0, callbackRows=[];
const retryResult = await retry(async()=> ++retryCalls === 1
  ? {agent:'claude',status:'invalid_output',detail:'synthetic-private-diagnostic',raw:'synthetic-private-output'}
  : {agent:'claude',status:'success',review:{verdict:'ACCEPT',findings:[],private_canary:'synthetic-private-output'}},
  'claude','synthetic artifact',{retryInvalid:true,onAttempt:row=>callbackRows.push(row)},null,async()=>{});
test('attempt history retains accounting without duplicating raw diagnostics or reviewer content', () => {
  assert.equal(retryCalls,2); assert.equal(callbackRows.length,2);
  assert.equal(callbackRows[0].detail,'synthetic-private-diagnostic','evidence callback still sees outcome context');
  assert.equal(retryResult.attempt_history.length,2);
  assert.doesNotMatch(JSON.stringify(retryResult.attempt_history),/synthetic-private/);
  assert.equal(retryResult.attempt_history[0].status,'invalid_output');
  assert.equal(retryResult.attempt_history[1].ordinal,2);
});
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
test("a leftover Git lock is reported with its age through read-only calls and is never removed", () => {
  // R8 (1.17.1): installing 1.17.0 stopped at the checkout on an empty index.lock, six days old, that no Git
  // process owned. The check is given a file system that can only list and stat: removing or rewriting a
  // lock would throw here, whatever its age.
  const code = between(read("momm/scripts/update.mjs"), "const CHECKOUT_LOCKS", "const POLICY_PATHS").replaceAll("export function", "function");
  const present = new Map(), listed = [];
  const files = { readdirSync: dir => { listed.push(dir); return []; }, lstatSync: p => { if (present.has(path.basename(p))) return { mtimeMs: present.get(path.basename(p)) }; throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); } };
  const refuse = vm.runInNewContext(code + ";refuseGitLocks", { path, process, fs: files, safeText: s => String(s), git: () => ".git\n.git" });
  const outcome = (...args) => { try { refuse("fixture", ...args); return null; } catch (e) { return e; } };
  assert.equal(outcome("Then repeat the command that was refused."), null, "no lock: nothing is refused");
  for (const age of [2_000, 6 * 864e5, 4000 * 864e5]) {
    present.set("index.lock", Date.now() - age);
    const error = outcome("Then repeat the command that was refused.");
    assert.equal(error?.code, "git_lock_present", `a lock ${age} ms old was let through`); assert.equal(error.locks.length, 1);
    assert.match(error.message, /index\.lock/); assert.match(error.message, /does not prove/i); assert.match(error.message, /remove that one file yourself/);
    assert.match(error.message, /never removes a Git lock/); assert.match(error.message, /3\. Then repeat the command that was refused\./);
    if (age === 6 * 864e5) assert.match(error.message, /last written 6 days ago/);
  }
  // Recovery consults only the two locks its checkout needs, and does not walk the refs.
  present.clear(); present.set("config.lock", Date.now()); listed.length = 0;
  assert.equal(outcome("Then retry recovery.", { checkoutOnly: true }), null); assert.equal(listed.length, 0);
  assert.equal(outcome("Then repeat the command that was refused.")?.code, "git_lock_present"); assert.equal(listed.length, 1, "one git directory: refs walked once");
});
for (const installer of ["install.mjs", "momm/scripts/install.mjs"]) test(`${installer} exposes successful links when receipt writing fails`, () => {
  let stdout = "", stderr = "", links = 0, readinessChecks = 0;
  const updateReadiness = { status: "prerequisites_missing", network_used: false, signature_verified: false };
  const proc = { argv: ["node", installer], stdout: { write: s => stdout += s }, stderr: { write: s => stderr += s }, exitCode: 0 };
  const options = { targets: [], customDirs: ["fixture"], dryRun: false, pretty: false };
  const linked = () => { links++; return { destination: "fixture/momm", status: "linked", skill: "momm" }; };
  const code = read(installer).slice(read(installer).indexOf("function main()"));
  vm.runInNewContext(code, { process: proc, path, os, repoRoot: root, skillRoot: path.join(root, "momm"), parseArgs: () => options,
    discoverSkills: () => ["momm"], commandExists: () => false, linkAll: () => [linked()], linkSkill: linked,
    readiness: () => { readinessChecks++; return updateReadiness; },
    installationCompletion: () => ({upgrade:{complete:true}}),
    recordInstall: () => { throw Object.assign(new Error("receipt blocked"), { code: "EACCES" }); } });
  assert.equal(links, 1); assert.equal(proc.exitCode, 1);
  assert.equal(readinessChecks, 1); assert(stdout.trim(), `installer returned no structured report: ${stderr}`);
  const result = JSON.parse(stdout); assert.equal(result.results.length, 1); assert.equal(result.installation.updater_available, false);
  assert.deepEqual(result.update_readiness, updateReadiness);
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
