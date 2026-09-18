#!/usr/bin/env node
// Real child pipes plus isolated launcher fixtures; no accounts or model calls.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createProcessScope } from "./process-scope.mjs";
import {privateTestFixture} from './private-test-fixture.mjs';
const source = fs.readFileSync(new URL("./multi-review.mjs", import.meta.url), "utf8");
const start = source.indexOf("function platformCommand("), end = source.indexOf("function clipped(");
assert(start >= 0 && end > start, "transport fixture boundaries moved; update the production extraction");
const code = source.slice(start, end);
const context = vm.createContext({ fs, os, path, process, spawn, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
  processScope:createProcessScope(), DEFAULT_TIMEOUT_MS: 30000, MAX_OUTPUT_BYTES: 4096, cleanOauthEnv: () => process.env });
vm.runInContext(code + "\nthis.core = {platformCommand,runProcess,extractJsonObjects,unwrapReviewPayload};", context);
const { core } = context;
for (const fn of ["platformCommand", "runProcess", "extractJsonObjects", "unwrapReviewPayload"]) assert.equal(typeof core[fn], "function", `missing production helper ${fn}`);
const passed = [], failed = [];
async function test(name, fn) { try { await fn(); passed.push(name); } catch (e) { failed.push({ name, error: e.message }); } }
const fixture = privateTestFixture("momm-transport-");
try {
  await test("default review collects a real Git diff without shell wrappers", () => {
    const repo = path.join(fixture, "git-repo"); fs.mkdirSync(repo);
    const git = (...args) => { const r=spawnSync("git", args, {cwd:repo,encoding:"utf8",windowsHide:true,timeout:10000}); assert.equal(r.status,0,r.stderr); };
    git("init"); fs.writeFileSync(path.join(repo,"code.cjs"),"module.exports = 1;\n"); git("add","code.cjs");
    // A user's explicit color setting must not inject ANSI into machine input.
    git("config","color.ui","always");
    git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","-c","core.hooksPath=.git/no-hooks","commit","-m","fixture");
    fs.writeFileSync(path.join(repo,"code.cjs"),"module.exports = 2;\n");
    const r=spawnSync(process.execPath,[fileURLToPath(new URL("./multi-review.mjs",import.meta.url)),"--governor","codex","--reviewers","codex","--min-success","1","--stream"],
      {cwd:repo,encoding:"utf8",windowsHide:true,timeout:30000,env:{...process.env,NO_UPDATE_CHECK:"1"}});
    assert.equal(r.status,3,r.stderr);
    const report=JSON.parse(r.stdout); assert.equal(report.source_snapshot.complete,true,report.source_snapshot.reason); assert.equal(report.source_snapshot.files[0].path,"code.cjs");
    assert(!report.outstanding.completion_check.includes("<installed-momm>"), "completion command must resolve the installed script");
    assert(report.outstanding.completion_check.includes("governor.mjs"));
  });
  await test("failed quorum keeps every stderr line valid NDJSON", () => {
    const input = path.join(fixture, "control.txt"); fs.writeFileSync(input, "x");
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./multi-review.mjs", import.meta.url)), "--governor", "codex", "--reviewers", "codex", "--input", input, "--stream", "--min-success", "1"],
      { cwd: fixture, encoding: "utf8", timeout: 30000, windowsHide: true, env: { ...process.env, NO_UPDATE_CHECK: "1" } });
    assert.equal(result.status, 3);
    const events=result.stderr.trim().split(/\r?\n/).map(line=>JSON.parse(line));
    assert.equal(events.filter(e=>e.event==='quorum_failed').length,1);
    assert.deepEqual(JSON.parse(JSON.stringify(events.find(e=>e.event==='quorum_failed'),['event','achieved','required'])),{event:'quorum_failed',achieved:0,required:1});
    assert.equal(JSON.parse(result.stdout).quorum.met, false);
  });
  await test('completion event and saved report share redacted diagnostic detail', () => {
    const secret='ghp_'+'z'.repeat(32), events=[];
    const result={agent:'claude',status:'error',attempts:1,detail:'Provider diagnostic '+secret};
    // 1.16: the completion block lives in the per-piece runner reviewOne; slice from its info object through its return.
    const a=source.indexOf('    const info = {',source.indexOf('const reviewOne = async'));
    const b=source.indexOf('\n  };\n  let results, pieceResults',a);
    const c=source.indexOf('results.map((result) => ({',source.indexOf('source_snapshot: sourceSnapshot'));
    const d=source.indexOf('    })),',c);
    assert(a>0&&b>a&&c>0&&d>c);
    const clean=source.slice(source.indexOf('function sanitizeText('),source.indexOf('function platformCommand('));
    const normalized=vm.runInNewContext(clean+'\n(()=>{'+source.slice(a,b)+'})()',
      {result,agent:'claude',startedAt:0,Date,options:{stream:true},ui:{complete(){}},emitEvent:(_stream,e)=>events.push(e),clipped:(s,n)=>s.slice(0,n),tag:{},pieceId:null});
    const rows=vm.runInNewContext(clean+'\n'+source.slice(c,d+7),{results:[normalized],options:{governor:'codex'},personaFor:()=>null,clipped:(s,n)=>s.slice(0,n)});
    assert(!JSON.stringify(events).includes(secret));
    assert(!JSON.stringify(rows).includes(secret),'saved report/stdout must not retain a token removed from progress');
    assert.equal(rows[0].detail,events[0].detail);
  });
  await test("split UTF-8 survives real stdout and stderr pipes", async () => {
    const expected = JSON.stringify({ quote: "é😀", text: "ab" });
    const r = await core.runProcess(process.execPath, ["-e", `const b=Buffer.from(${JSON.stringify(expected)});let i=0;const t=setInterval(()=>{process.stdout.write(b.subarray(i,i+1));process.stderr.write(b.subarray(i,i+1));if(++i===b.length)clearInterval(t)},5)`]);
    assert.equal(r.code, 0); assert.equal(r.stdout, expected); assert.equal(r.stderr, expected);
  });
  await test("output cap bounds retained bytes and is explicit", async () => {
    const r = await core.runProcess(process.execPath, ["-e", "process.stdout.write('é'.repeat(5000))"]);
    assert.equal(r.code, 0); assert.equal(r.outputLimited, true); assert(Buffer.byteLength(r.stdout) <= 4096);
  });
  await test("fixed timeout settles and exposes content-free progress", async () => {
    const seen = [], start = Date.now();
    const r = await core.runProcess(process.execPath, ["-e", "process.stdout.write('PRIVATE_SENTINEL');setInterval(()=>{},1000)"],
      { timeoutMs: 200, progressIntervalMs: 30, onProgress: p => seen.push(p) });
    assert.equal(r.timedOut, true); assert(Date.now() - start < 8000);
    assert(seen.length > 0); assert(!JSON.stringify(seen).includes("PRIVATE_SENTINEL"));
    assert(seen.every(p => p.timeout_ms === 200 && Number.isInteger(p.elapsed_ms)));
  });
  await test("malformed two-megabyte response parses within a bounded deadline", () => {
    context.malformed = "{".repeat(2_000_000);
    assert.equal(vm.runInContext("core.extractJsonObjects(malformed).length", context, { timeout: 2000 }), 0);
  });
  await test("parser preserves wrappers, escaped braces and terminal failure", () => {
    const p = { findings: [], summary: 'literal { brace and "quote"' };
    assert.equal(core.unwrapReviewPayload(JSON.stringify({ result: JSON.stringify(p) })).summary, p.summary);
    assert.equal(core.unwrapReviewPayload(JSON.stringify(p) + '\n{"is_error":true}'), null);
    assert.equal(core.unwrapReviewPayload(JSON.stringify(p) + '\n{"unfinished":'), null);
    assert.equal(core.extractJsonObjects('{bad}\n{"fine":1}')[0].fine, 1);
    assert.equal(core.unwrapReviewPayload('{unfinished prefix\n'+JSON.stringify(p)),null,'ambiguous nested review must not rescue an unfinished envelope');
  });
  await test("preflight preserves unsupported installed launcher instead of inventing missing CLI", async () => {
    const probe = vm.runInNewContext(source.slice(source.indexOf("async function commandVersion("), source.indexOf("const ANSI =")) + "\n({commandVersion,preflightCheck})", {
      runProcess: async () => ({ error: { code: "MOMM_UNSUPPORTED_LAUNCHER", message: "Unsupported Windows launcher: shell shim refused" }, stdout: "", stderr: "", code: null }),
      clipped: s => s, fs, os, path, INSTALL_HINTS: {}, LOGIN_HINTS: {},
    });
    const [route] = await probe.preflightCheck(["claude"], "codex");
    assert.equal(route.installed, true); assert.equal(route.ready, false); assert.equal(route.status, "unsupported");
    assert.match(route.note, /shim refused/); assert.equal(route.login_hint, undefined); assert.equal(route.install_hint, undefined);
  });
  if (process.platform === "win32") {
    const bin = path.join(fixture, "space & 100% ! ü");
    const pkg = path.join(bin, "node_modules/@openai/codex");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(bin, "codex.cmd"), "@echo SHIM_MUST_NOT_RUN\r\n");
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@openai/codex", bin: { codex: "runner.cjs" } }));
    fs.writeFileSync(path.join(pkg, "runner.cjs"), "console.log(JSON.stringify(process.argv.slice(2)))");
    const values = ["", "space path", "left&echo.second", "%SENTINEL%", "!value!", 'quoted "x"', "é😀", "a\r\nb", JSON.stringify({ p: "x&y" })];
    await test("Windows npm launcher round-trips shell metacharacters without a shell", async () => {
      const env = { ...process.env }; for (const k of Object.keys(env)) if (k.toLowerCase() === "path") delete env[k]; env.Path = bin;
      const r = await core.runProcess("codex", values, { env });
      assert.equal(r.code, 0); assert.deepEqual(JSON.parse(r.stdout), values);
    });
    await test("unknown Windows shim fails closed without execution", async () => {
      fs.writeFileSync(path.join(bin, "untrusted.cmd"), "@echo SHIM_MUST_NOT_RUN\r\n");
      const r = await core.runProcess("untrusted", [], { env: { Path: bin } });
      assert(!r.stdout.includes("SHIM_MUST_NOT_RUN")); assert.match(r.error?.message ?? "", /launcher|shim/i);
    });
    await test("npm bin cannot escape its verified package", async () => {
      fs.writeFileSync(path.join(pkg, "../outside.cjs"), 'console.log("ESCAPED_PACKAGE")');
      fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@openai/codex", bin: { codex: "../outside.cjs" } }));
      const r = await core.runProcess("codex", [], { env: { Path: bin } });
      assert(r.error); assert.equal(r.stdout, "");
    });
    await test("Windows npm interpreter honors adjacent native runtime", () => {
      fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@openai/codex", bin: { codex: "runner.cjs" } }));
      const adjacent = path.join(bin, "node.exe");
      fs.writeFileSync(adjacent, "resolver-only fixture; never executed");
      assert.equal(core.platformCommand("codex", [], { Path: bin }).command, adjacent);
    });
    await test("all official npm routes resolve verified bins and native-only routes stay native", () => {
      for (const [name, packageName] of Object.entries({codex:"@openai/codex",claude:"@anthropic-ai/claude-code",copilot:"@github/copilot",gemini:"@google/gemini-cli"})) {
        const root=path.join(bin,"node_modules",packageName);fs.mkdirSync(root,{recursive:true});
        fs.writeFileSync(path.join(bin,name+".cmd"),"@echo MUST_NOT_EXECUTE\r\n");
        fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({name:packageName,bin:{[name]:"runner.cjs"}}));
        fs.writeFileSync(path.join(root,"runner.cjs"),"// resolver-only fixture\n");
        assert.equal(core.platformCommand(name,[],{Path:bin}).args[0],path.join(root,"runner.cjs"));
      }
      for (const nativeName of ["grok","agy"]) {
        const native=path.join(bin,nativeName+".exe");fs.writeFileSync(native,"resolver-only fixture; never executed");
        assert.equal(core.platformCommand(native,[]).command,native);
      }
    });
  }
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
console.log(JSON.stringify({ passed: passed.length, checks: passed, failures: failed }, null, 2));
if (failed.length) process.exitCode = 1;
