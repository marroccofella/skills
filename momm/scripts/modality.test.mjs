#!/usr/bin/env node
// E7 planner and runner tests with a fake exec: no reviewer CLI is launched, no network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import * as mod from "./modality.mjs";
import { loadBaseline, effective, sha256 } from "./capabilities.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const passed = [], failures = [];
const filter = process.argv.find(arg => arg.startsWith('--filter='))?.slice('--filter='.length);
async function test(name, fn) {
  if (filter && !name.includes(filter)) return;
  const started = Date.now();
  process.stderr.write(`START ${name}\n`);
  try { await fn(); passed.push(name); }
  catch (e) { failures.push({ name, error: e.message, stack: String(e.stack ?? "").split("\n").slice(1, 4).map((l) => l.trim()) }); }
  finally { process.stderr.write(`END ${name} (${Date.now() - started}ms)\n`); }
}
const baseline = loadBaseline();
const stamp = { machine_id: "m-test", cli_version: "1.0.0", login_identity_sha256: null, at: "2026-09-13T00:00:00.000Z", expires_at: null };
const matrix = (entries = []) => effective({ baseline, machine: "m-test", overlay: { path: null, entries: entries.map((e) => ({ ...stamp, ...e })), invalidated: [], stale: [] } });
const PROMPT = "A red circle on a white background, flat vector style. IMMUTABLE-PROMPT-7f3a";
const {privateTestFixture} = await import('./private-test-fixture.mjs');
process.umask(0o077); // Only this synthetic test process.
const tmp = privateTestFixture("momm-modality-tests-");
const fresh = (name) => { const d = fs.mkdtempSync(path.join(tmp, `${name}-`)); return d; };
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file; };
const ok = (stdout) => ({ code: 0, stdout, stderr: "" });
const PNG_A = Buffer.from("89504e470d0a1a0a-A-PNG-BYTES", "utf8"), MP4_B = Buffer.from("0000001c667479706d703432-B-MP4", "utf8");

await test("native checkpoint budget: first running report shares the dispatch privacy inspection", async () => {
  const cwd = fresh("checkpoint-cwd"), home = fresh("checkpoint-home"), m = matrix();
  const planned = mod.plan(m, { chain: ["text", "text"] }, { prompt: PROMPT });
  planned.steps[0].chosen = "claude";
  const original = childProcess.spawnSync;
  const inspectedPaths = [];
  let calls = 0, runDir;
  try {
    childProcess.spawnSync = function (exe, args, options) {
      if (args?.some(arg => typeof arg === "string" && arg.includes("$stage = 'read_acl'"))) inspectedPaths.push(JSON.parse(options.input).path);
      return original.call(childProcess, exe, args, options);
    };
    syncBuiltinESMExports();
    const result = await mod.run(planned, { consent: true, cwd, home, effective: m, exec: async (_cmd, _args, options) => {
      calls++;
      runDir = path.resolve(options.cwd, "..");
      const saved = JSON.parse(fs.readFileSync(path.join(runDir, "report.json"), "utf8"));
      assert.equal(saved.status, "running", "durable running state must precede provider dispatch");
      if (process.platform === "win32") assert.deepEqual(inspectedPaths, [path.join(cwd, ".ensemble_reviews"), runDir], "full project preparation plus full run-tree inspection, not merely the report file");
      return ok(JSON.stringify({ type: "result", result: "Synthetic checkpoint answer", is_error: false }));
    } });
    assert.equal(calls, 1);
    assert.equal(result.report.status, "complete");
    if (process.platform === "win32") assert.deepEqual(inspectedPaths, [path.join(cwd, ".ensemble_reviews"), runDir, runDir], "terminal persistence must independently recheck the complete run tree after the provider");
  } finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
});

await test("Claude composed output retains explicitly requested tools without changing permission mode", () => {
  const route = baseline.routes.claude;
  const dir = path.join(tmp, "composed"), input = path.join(dir, "input.png");
  const bound = mod.bindArtefacts(route.input, [input], dir);
  for (const [outputs, expected] of [
    [["text"], ["Read"]],
    [["web"], ["Read", "WebSearch", "WebFetch"]],
    [["code_exec"], ["Read", "Bash"]],
    [["web", "code_exec"], ["Read", "WebSearch", "WebFetch", "Bash"]],
  ]) {
    const cmd = mod.commandFor("claude", { prompt: PROMPT, promptFile: path.join(dir, "prompt.txt"), workDir: dir, generative: false, bound, outputs });
    assert.equal(cmd.args.filter(a => a === "--tools").length, 1);
    assert.deepEqual(cmd.args[cmd.args.indexOf("--tools") + 1].split(","), expected);
    assert.ok(cmd.label.includes(`tools=${expected.join(",")}`), "Audit label must disclose the effective tool list");
    assert.equal(cmd.args[cmd.args.indexOf("--permission-mode") + 1], "plan");
    assert.ok(!cmd.args.includes("--dangerously-skip-permissions"));
  }
});

await test("runner forwards requested web output to Claude tool composition", async () => {
  const cwd = fresh("composed-cwd"), home = fresh("composed-home"), m = matrix();
  const input = write(path.join(cwd, "input.png"), PNG_A);
  const planned = mod.plan(m, { input: ["image"], output: ["web"] }, { prompt: PROMPT });
  planned.steps[0].chosen = "claude";
  let calls = 0;
  const exec = async (_command, args) => {
    calls++;
    assert.equal(args[args.indexOf("--tools") + 1], "Read,WebSearch,WebFetch");
    assert.equal(args[args.indexOf("--permission-mode") + 1], "plan");
    return ok(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Synthetic reply; not a live web search." }));
  };
  const result = await mod.run(planned, { consent: true, inputs: [input], cwd, home, effective: m, exec });
  assert.equal(calls, 1);
  assert.equal(result.report.status, "complete");
});

// ---- planner ------------------------------------------------------------------------------------
await test("plan: image -> text is possible; candidates carry route, level, blocker, how, clearing_action", () => {
  const p = mod.plan(matrix(), { input: ["image"], output: ["text"] }, { prompt: PROMPT });
  assert.equal(p.schema, mod.PLAN_SCHEMA);
  assert.equal(p.possible, true);
  assert.equal(p.steps.length, 1);
  assert.deepEqual(p.blocked_by, []);
  assert.equal(p.prompt, PROMPT);
  assert.deepEqual(p.chain, [{ from: ["image"], to: ["text"] }]);
  assert.ok(p.steps[0].chosen);
  for (const c of p.steps[0].candidates) for (const key of ["route", "level", "blocker", "how", "clearing_action", "evidence", "cells"]) assert.ok(key in c, `${c.route} lacks ${key}`);
  const routes = p.steps[0].candidates.filter((c) => c.routable).map((c) => c.route);
  assert.deepEqual(routes, ["codex", "claude", "antigravity", "gemini", "copilot", "grok"]);
  assert.equal(p.steps[0].candidates[0].how["input.image"], "-i {file}");
  assert.equal(p.steps[0].candidates[0].evidence["input.image"].help_capture, "references/cli/help/codex-exec.txt:37");
});

await test("plan: a chain blocked by a level names the level and that it is not clearable; no candidates at all is reported", () => {
  const speech = mod.plan(matrix(), { input: ["speech"], output: ["text"] });
  assert.equal(speech.possible, false);
  assert.ok(speech.blocked_by.length >= 4);
  for (const b of speech.blocked_by) { assert.equal(b.level, "model-only"); assert.equal(b.blocker, null); assert.match(b.clearing_action, /No headless path/); assert.match(b.reason, /below documented/); }
  assert.ok(!speech.blocked_by.some((b) => b.route === "codex"), "a no cell is not a candidate");
  const tts = mod.plan(matrix(), { input: ["text"], output: ["speech"] });
  assert.equal(tts.possible, false);
  assert.deepEqual(tts.steps[0].candidates, []);
  assert.equal(tts.blocked_by[0].route, null);
  assert.match(tts.blocked_by[0].reason, /no route has a path for text -> speech/);
});

await test("plan: a chain blocked only by a blocker names the blocker and the clearing action", () => {
  const p = mod.plan(matrix([{ route: "grok", direction: "output", modality: "video_gen", blocker: "zdr", reason: "ZDR gate" }]), { input: ["image"], output: ["video"] });
  assert.equal(p.possible, false);
  assert.equal(p.blocked_by.length, 1);
  assert.equal(p.blocked_by[0].route, "grok");
  assert.equal(p.blocked_by[0].blocker, "zdr");
  assert.equal(p.blocked_by[0].level, "documented");
  assert.match(p.blocked_by[0].clearing_action, /\/privacy/);
  assert.match(p.blocked_by[0].clearing_action, /zdr-video-storage/);
  const unblocked = mod.plan(matrix(), { input: ["image"], output: ["video"] });
  assert.equal(unblocked.possible, true);
  assert.equal(unblocked.steps[0].chosen, "grok");
  const reprobe = mod.plan(matrix([{ route: "grok", direction: "output", modality: "video_gen", blocker: "reprobe" }]), { chain: ["image", "video"] });
  assert.match(reprobe.blocked_by[0].clearing_action, /probes\.mjs grok --modalities/);
});

await test("plan: a two-route chain when one route cannot take the first step", () => {
  const p = mod.plan(matrix([{ route: "grok", direction: "output", modality: "image_gen", blocker: "probe_failed" }]), { chain: ["text", "image", "video"] });
  assert.equal(p.possible, true);
  assert.equal(p.steps[0].chosen, "codex");
  assert.equal(p.steps[1].chosen, "grok");
  assert.deepEqual(p.routes_used, ["codex", "grok"]);
  assert.deepEqual(p.chain, [{ from: ["text"], to: ["image_gen"] }, { from: ["image"], to: ["video_gen"] }]);
});

await test("plan: adjacent steps prefer one route (look-ahead and carry-over)", () => {
  const video = mod.plan(matrix(), { chain: ["text", "image", "video"] });
  assert.equal(video.possible, true);
  assert.deepEqual(video.steps.map((s) => s.chosen), ["grok", "grok"], "grok is the only video route, so it is chosen for the image step too");
  const critique = mod.plan(matrix(), { chain: ["text", "image", "text"] });
  assert.deepEqual(critique.steps.map((s) => s.chosen), ["codex", "codex"]);
  const three = mod.plan(matrix([{ route: "codex", direction: "input", modality: "image", blocker: "probe_failed" }]), { chain: ["text", "image", "text"] });
  assert.deepEqual(three.steps.map((s) => s.chosen), ["antigravity", "antigravity"], "codex cannot read the image back, so the first image-capable generator carries both steps");
});

await test("plan: an empty intersection over several inputs is a refusal listing the blocker", () => {
  const p = mod.plan(matrix([{ route: "gemini", direction: "input", modality: "text", blocker: "auth_tier" }]), { input: ["image", "audio"], output: ["text"] });
  assert.equal(p.possible, false);
  // gemini is the only route with an audio path and its text cell is blocked; antigravity's audio is model-only.
  assert.deepEqual(p.blocked_by.map((b) => [b.route, b.level, b.blocker]), [["antigravity", "model-only", null], ["gemini", "documented", "auth_tier"]]);
  assert.match(p.blocked_by.find((b) => b.route === "gemini").clearing_action, /Code Assist/);
  assert.match(p.blocked_by.find((b) => b.route === "antigravity").clearing_action, /No headless path/);
  assert.equal(mod.plan(matrix(), { input: ["image", "audio"], output: ["text"] }).steps[0].chosen, "gemini", "unblocked, gemini alone serves image+audio");
});

await test("plan: an input template the runner cannot bind is a missing_flag blocker", () => {
  const m = matrix();
  m.routes.claude.input.image.requires = ["--add-dir {workspace}"];
  const p = mod.plan(m, { input: ["image"], output: ["text"] });
  const claude = p.steps[0].candidates.find((c) => c.route === "claude");
  assert.equal(claude.routable, false);
  assert.equal(claude.blocker, "missing_flag");
  assert.match(claude.clearing_action, /\{file\}, \{dir\}/);
  assert.notEqual(p.steps[0].chosen, "claude");
});

await test("normaliseNeed: aliases, defaults, rejects unknown names", () => {
  assert.deepEqual(mod.normaliseNeed({ chain: ["text", "image", "video"] }), [{ from: ["text"], to: ["image_gen"] }, { from: ["image"], to: ["video_gen"] }]);
  assert.deepEqual(mod.normaliseNeed({ input: ["pdf", "image", "image"] }), [{ from: ["pdf", "image"], to: ["text"] }]);
  assert.deepEqual(mod.normaliseNeed({ output: ["image_gen"] }), [{ from: ["text"], to: ["image_gen"] }]);
  assert.throws(() => mod.normaliseNeed({ input: ["hologram"] }), /unknown input modality/);
  assert.throws(() => mod.normaliseNeed({ output: ["smell"] }), /unknown output modality/);
  assert.throws(() => mod.normaliseNeed({ chain: ["text"] }), /at least two/);
  assert.throws(() => mod.normaliseNeed(null), /need must be an object/);
});

// ---- glob and binding ------------------------------------------------------------------------------
await test("globFiles: ** spans zero or more directories, * stays within a segment, ~ expands to the given home", () => {
  const root = fresh("glob");
  for (const f of ["a/x.png", "a/b/y.png", "a/b/c/z.png", "a/b/w.jpg", "other/q.png"]) write(path.join(root, f), "x");
  const rel = (list) => list.map((f) => path.relative(root, f).replace(/\\/g, "/")).sort();
  assert.deepEqual(rel(mod.globFiles(`${root}/a/**/*.png`)), ["a/b/c/z.png", "a/b/y.png", "a/x.png"]);
  assert.deepEqual(rel(mod.globFiles(`${root}/a/*.png`)), ["a/x.png"]);
  assert.deepEqual(rel(mod.globFiles(`${root}/a/*/*.jpg`)), ["a/b/w.jpg"]);
  assert.deepEqual(rel(mod.globFiles(`${root}/**/q.png`)), ["other/q.png"]);
  assert.deepEqual(mod.globFiles(`${root}/nope/**/*.png`), []);
  assert.equal(mod.expandHome("~/.codex/generated_images/**/*.png", "C:\\Users\\fixture"), "C:/Users/fixture/.codex/generated_images/**/*.png");
  assert.equal(mod.expandHome("~/x", "/home/fixture"), "/home/fixture/x");
  assert.equal(mod.expandHome("/abs/x", "/home/fixture"), "/abs/x");
  assert.throws(() => mod.globFiles("relative/*.png"), /absolute/);
});

await test("bindInputs and commandFor: every route binds staged files through its templates into argv or the prompt", () => {
  const m = matrix();
  const dir = path.join(tmp, "work"), f1 = path.join(dir, "in", "01-a.png"), f2 = path.join(dir, "in", "02-b.png");
  const cell = (route) => m.routes[route].input.image;
  const codex = mod.bindInputs([cell("codex")], { files: [f1, f2], dir });
  assert.deepEqual(codex.args, [["-i", f1], ["-i", f2]]); assert.deepEqual(codex.refs, []); assert.deepEqual(codex.flags, ["-i"]);
  const copilot = mod.bindInputs([cell("copilot")], { files: [f1], dir });
  assert.deepEqual(copilot.args, [["--attachment", f1]]);
  const claude = mod.bindInputs([cell("claude")], { files: [f1], dir });
  assert.deepEqual(claude.args, [["--tools", "Read"], ["--add-dir", dir]]); assert.deepEqual(claude.refs, [f1.replace(/\\/g, "/")]);
  const agy = mod.bindInputs([cell("antigravity")], { files: [f1], dir });
  assert.deepEqual(agy.args, [["--new-project"], ["--add-dir", dir]]); assert.deepEqual(agy.refs, [f1.replace(/\\/g, "/")]);
  const grok = mod.bindInputs([cell("grok")], { files: [f1], dir });
  assert.deepEqual(grok.args, [["--cwd", dir]]); assert.deepEqual(grok.refs, [f1.replace(/\\/g, "/")]);
  const gemini = mod.bindInputs([cell("gemini")], { files: [f1], dir });
  assert.deepEqual(gemini.args, []); assert.deepEqual(gemini.refs, [`@${f1.replace(/\\/g, "/")}`]);
  // image + pdf together on claude: identical groups are bound once.
  const both = mod.bindInputs([cell("claude"), m.routes.claude.input.pdf], { files: [f1], dir });
  assert.deepEqual(both.args, [["--tools", "Read"], ["--add-dir", dir]]);
  assert.match(mod.bindInputs([{ how: "-x {nope}" }], { files: [f1], dir }).problem, /unknown placeholder/);
  assert.match(mod.bindInputs([cell("claude")], { files: [f1] }).problem, /work directory/);
  // Bound groups land in argv next to the route's own non-interactive vector, deduplicated.
  const promptFile = path.join(dir, "prompt.txt");
  const argvOf = (route, bound, generative = false) => mod.commandFor(route, { prompt: "P", promptFile, workDir: dir, generative, bound }).args;
  const has = (argv, flag, value) => argv.some((a, i) => a === flag && (value === undefined || argv[i + 1] === value));
  const cx = argvOf("codex", codex); assert.ok(has(cx, "-i", f1) && has(cx, "-i", f2)); assert.equal(cx.at(-1), "-"); assert.ok(has(cx, "--sandbox", "read-only"));
  assert.ok(has(argvOf("codex", codex, true), "--sandbox", "workspace-write"));
  const cp = argvOf("copilot", copilot); assert.ok(has(cp, "--attachment", f1)); assert.ok(has(cp, "--add-dir", dir)); assert.ok(cp.includes("--available-tools=view"));
  const cl = argvOf("claude", claude); assert.ok(has(cl, "--tools", "Read")); assert.ok(has(cl, "--add-dir", dir)); assert.ok(has(cl, "--permission-mode", "plan"));
  const ag = argvOf("antigravity", agy); assert.equal(ag.filter((a) => a === "--new-project").length, 1, "deduplicated"); assert.ok(has(ag, "--add-dir", dir));
  const gk = argvOf("grok", grok); assert.equal(gk.filter((a) => a === "--cwd").length, 1); assert.ok(has(gk, "--prompt-file", promptFile)); assert.ok(has(gk, "--permission-mode", "plan"));
  assert.ok(has(argvOf("grok", grok, true), "--permission-mode", "acceptEdits"));
  const gm = mod.commandFor("gemini", { prompt: "P", promptFile, workDir: dir, generative: false, bound: gemini }); assert.equal(gm.input, "P", "gemini takes the prompt on stdin"); assert.ok(gm.args.includes("--prompt") && !gm.args.includes("P"));
  const label = mod.commandFor("codex", { prompt: PROMPT, promptFile, workDir: dir, generative: true, bound: codex }).label;
  assert.ok(!label.includes(PROMPT) && !label.includes(f1)); assert.match(label, /\[bound -i\]/);
  const prompt = mod.stepPrompt(PROMPT, { index: 1, total: 2, to: ["text"], how: "x", refs: claude.refs });
  assert.ok(prompt.startsWith(PROMPT)); assert.ok(prompt.includes(f1.replace(/\\/g, "/")));
  assert.throws(() => mod.commandFor("hal9000", { prompt: "P", promptFile, workDir: dir }), /no non-interactive command/);
});

// ---- runner refusals ---------------------------------------------------------------------------------
await test("run: refuses without consent, without a prompt, when the plan is impossible; exec is never called", async () => {
  const calls = [];
  const exec = async (...a) => { calls.push(a); return ok(""); };
  const m = matrix();
  const good = mod.plan(m, { chain: ["text", "image"] }, { prompt: PROMPT });
  await assert.rejects(mod.run(good, { exec, home: fresh("h"), cwd: fresh("c"), effective: m }), (e) => e.code === "MOMM_CONSENT_REQUIRED");
  await assert.rejects(mod.run(good, { consent: "yes", exec, home: fresh("h"), cwd: fresh("c"), effective: m }), (e) => e.code === "MOMM_CONSENT_REQUIRED");
  const noPrompt = mod.plan(m, { chain: ["text", "image"] });
  await assert.rejects(mod.run(noPrompt, { consent: true, exec, home: fresh("h"), cwd: fresh("c"), effective: m }), (e) => e.code === "MOMM_PROMPT_REQUIRED");
  await assert.rejects(mod.run(noPrompt, { consent: true, prompt: "   ", exec, home: fresh("h"), cwd: fresh("c"), effective: m }), (e) => e.code === "MOMM_PROMPT_REQUIRED");
  const impossible = mod.plan(m, { input: ["text"], output: ["speech"] }, { prompt: PROMPT });
  await assert.rejects(mod.run(impossible, { consent: true, exec, home: fresh("h"), cwd: fresh("c"), effective: m }), (e) => e.code === "MOMM_PLAN_BLOCKED");
  await assert.rejects(mod.run({ schema: "nope" }, { consent: true, exec, effective: m }), (e) => e.code === "MOMM_BAD_PLAN");
  assert.equal(calls.length, 0);
});

await test("run: refuses a step whose live cell gained a blocker, dropped below documented, or cannot bind; nothing runs, nothing is staged", async () => {
  const calls = [];
  const exec = async (...a) => { calls.push(a); return ok(""); };
  const planned = mod.plan(matrix(), { chain: ["text", "image", "video"] }, { prompt: PROMPT });
  assert.deepEqual(planned.routes_used, ["grok"]);
  const cwd = fresh("cwd");
  const zdr = matrix([{ route: "grok", direction: "output", modality: "video_gen", blocker: "zdr" }]);
  await assert.rejects(mod.run(planned, { consent: true, exec, home: fresh("h"), cwd, effective: zdr }), (e) => e.code === "MOMM_STEP_BLOCKED" && e.step === 1 && e.route === "grok" && e.blocker === "zdr" && /\/privacy/.test(e.clearing_action));
  const reprobe = matrix([{ route: "grok", direction: "input", modality: "text", blocker: "reprobe" }]);
  await assert.rejects(mod.run(planned, { consent: true, exec, home: fresh("h"), cwd, effective: reprobe }), (e) => e.code === "MOMM_STEP_BLOCKED" && e.blocker === "reprobe" && /probes\.mjs grok/.test(e.clearing_action));
  const lowered = matrix(); lowered.routes.grok.output.image_gen.level = "model-only";
  await assert.rejects(mod.run(planned, { consent: true, exec, home: fresh("h"), cwd, effective: lowered }), (e) => e.code === "MOMM_STEP_BLOCKED" && e.level === "model-only" && e.blocker === null);
  const unbindable = matrix(); unbindable.routes.grok.input.image.requires = ["--cwd {workspace}"];
  await assert.rejects(mod.run(planned, { consent: true, exec, home: fresh("h"), cwd, effective: unbindable }), (e) => e.code === "MOMM_STEP_BLOCKED" && e.blocker === "missing_flag");
  assert.equal(calls.length, 0);
  assert.ok(!fs.existsSync(path.join(cwd, mod.MEDIA_DIR)), "no media directory is created for a refused chain");
});

// ---- runner execution --------------------------------------------------------------------------------
function chainFake({ home, calls, codexFile = "exec-new.png", grokFile = "1.mp4", grokWrites = true }) {
  return async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "codex") {
      write(path.join(home, ".codex", "generated_images", "sess-1", codexFile), PNG_A);
      return ok("STEP1-SECRET-OUTPUT-TOKEN saved the image");
    }
    if (command === "grok") {
      const promptFile = args[args.indexOf("--prompt-file") + 1];
      const text = fs.readFileSync(promptFile, "utf8");
      calls.at(-1).promptText = text;
      if (grokWrites) write(path.join(home, ".grok", "sessions", "enc", "sess-2", grokFile), MP4_B);
      return ok("STEP2-SECRET-OUTPUT-TOKEN wrote the clip");
    }
    throw new Error(`unexpected command ${command}`);
  };
}
await test("run: two-route chain harvests step-scoped by glob, stages and hashes, keeps the prompt immutable, and never forwards step text", async () => {
  const home = fresh("home"), cwd = fresh("cwd"), calls = [];
  const old = write(path.join(home, ".codex", "generated_images", "old-session", "exec-old.png"), "OLD");
  const past = new Date(Date.now() - 3_600_000); fs.utimesSync(old, past, past);
  const m = matrix([{ route: "grok", direction: "output", modality: "image_gen", blocker: "probe_failed" }]);
  const planned = mod.plan(m, { chain: ["text", "image", "video"] }, { prompt: PROMPT });
  assert.deepEqual(planned.routes_used, ["codex", "grok"]);
  const now = new Date("2026-09-13T15:04:05.000Z");
  const { run_id, dir, report } = await mod.run(planned, { consent: true, exec: chainFake({ home, calls }), home, cwd, now, effective: m });
  assert.match(run_id, /^media_20260913150405_[0-9a-f]{8}$/);
  assert.equal(report.schema, mod.MEDIA_SCHEMA);
  assert.equal(report.status, "complete");
  assert.equal(report.prompt_sha256, sha256(PROMPT));
  assert.deepEqual(report.chain, planned.chain);
  assert.equal(report.steps.length, 2);
  assert.equal(calls.length, 2);
  // Step 1: codex, no artefacts, prompt on stdin starts with the user prompt.
  const s1 = report.steps[0];
  assert.equal(s1.route, "codex"); assert.equal(s1.exit_code, 0); assert.equal(s1.prompt_included, true); assert.deepEqual(s1.bound_flags, []);
  assert.ok(calls[0].options.input.startsWith(PROMPT)); assert.equal(calls[0].args.at(-1), "-"); assert.ok(calls[0].args.includes("workspace-write"));
  assert.equal(s1.files.length, 1, "only the new file, never old.png");
  assert.equal(s1.files[0].mime, "image/png"); assert.equal(s1.files[0].sha256, sha256(PNG_A)); assert.equal(s1.files[0].bytes, PNG_A.length);
  assert.match(s1.files[0].path, /^\.ensemble_reviews\/media\/media_.*\/step-1\/out\/01-exec-new\.png$/);
  assert.match(s1.files[0].harvested_from, /^~\/\.codex\/generated_images\/sess-1\/exec-new\.png$/);
  assert.ok(fs.existsSync(path.join(cwd, s1.files[0].path)));
  assert.ok(!fs.readdirSync(path.join(dir, "step-1", "out")).some((f) => f.includes("old")));
  // Step 2: grok gets the staged png bound via --cwd {dir} and the path in the prompt file.
  const s2 = report.steps[1];
  assert.equal(s2.route, "grok"); assert.equal(s2.exit_code, 0); assert.deepEqual(s2.bound_flags, ["--cwd"]);
  const stepDir = path.join(dir, "step-2");
  assert.ok(calls[1].args.includes("--cwd") && calls[1].args[calls[1].args.indexOf("--cwd") + 1] === stepDir);
  assert.ok(calls[1].args.includes("acceptEdits"));
  const staged = fs.readdirSync(path.join(stepDir, "in")).map((f) => path.join(stepDir, "in", f));
  assert.equal(staged.length, 1);
  assert.equal(sha256(fs.readFileSync(staged[0])), sha256(PNG_A), "staged input is the previous output, byte for byte");
  const promptText = calls[1].promptText;
  assert.ok(promptText.startsWith(PROMPT), "the same immutable prompt heads step 2");
  assert.ok(promptText.includes(staged[0].replace(/\\/g, "/")), "the staged artefact path is referenced");
  assert.ok(!promptText.includes("STEP1-SECRET-OUTPUT-TOKEN"), "no text from step 1 in step 2's prompt");
  assert.ok(!calls[1].args.some((a) => a.includes("STEP1-SECRET")));
  assert.equal(s2.files[0].mime, "video/mp4"); assert.equal(s2.files[0].sha256, sha256(MP4_B));
  assert.equal(s2.stdout_sha256, sha256("STEP2-SECRET-OUTPUT-TOKEN wrote the clip"));
  for (const s of report.steps) { assert.ok(!s.command_label.includes(PROMPT)); assert.ok(!JSON.stringify(s).includes("SECRET-OUTPUT-TOKEN"), "report never carries step text"); }
  // Report on disk, private, and the lock released.
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
  assert.deepEqual(onDisk, report);
  assert.deepEqual(fs.readdirSync(path.join(home, ".momm", "harvest-locks")), []);
});

await test("run: a generative step with no new file fails the chain; nothing is staged and no later step runs", async () => {
  const home = fresh("home"), cwd = fresh("cwd"), calls = [];
  write(path.join(home, ".codex", "generated_images", "old", "exec-old.png"), "OLD");
  const m = matrix([{ route: "grok", direction: "output", modality: "image_gen", blocker: "probe_failed" }]);
  const planned = mod.plan(m, { chain: ["text", "image", "video"] }, { prompt: PROMPT });
  const exec = async (command, args, options) => { calls.push({ command, args, options }); return ok("nothing written"); };
  const { dir, report } = await mod.run(planned, { consent: true, exec, home, cwd, effective: m });
  assert.equal(report.status, "failed");
  assert.equal(report.failure, "no_new_output");
  assert.equal(report.failed_step, 1);
  assert.equal(report.steps.length, 1);
  assert.deepEqual(report.steps[0].files, []);
  assert.equal(calls.length, 1, "step 2 never runs");
  assert.deepEqual(fs.readdirSync(path.join(dir, "step-1", "out")), []);
  assert.ok(!fs.existsSync(path.join(dir, "step-2")));
  // An unchanged pre-existing file that merely matches the glob is not output either; a rewritten one is.
  const touched = fresh("home2"), cwd2 = fresh("cwd2");
  const existing = write(path.join(touched, ".codex", "generated_images", "s", "exec-same.png"), "V1");
  const rewrite = async () => { fs.writeFileSync(existing, "V2-longer"); return ok(""); };
  const second = await mod.run(mod.plan(m, { chain: ["text", "image"] }, { prompt: PROMPT }), { consent: true, exec: rewrite, home: touched, cwd: cwd2, effective: m });
  assert.equal(second.report.status, "complete");
  assert.equal(second.report.steps[0].files[0].sha256, sha256("V2-longer"));
  // A non-zero exit fails the step even when a file appeared.
  const crash = async () => { write(path.join(touched, ".codex", "generated_images", "s", "exec-crash.png"), "X"); return { code: 1, stdout: "", stderr: "boom \u001b[31mred\u001b[0m" }; };
  const third = await mod.run(mod.plan(m, { chain: ["text", "image"] }, { prompt: PROMPT }), { consent: true, exec: crash, home: touched, cwd: cwd2, effective: m });
  assert.equal(third.report.status, "failed"); assert.equal(third.report.failure, "exit_code"); assert.ok(!/[\x00-\x1f]/.test(third.report.stderr_excerpt));
});

await test("run: two concurrent chains into the same harvest glob keep separate artefacts", async () => {
  const home = fresh("home"), cwd = fresh("cwd");
  const m = matrix();
  const planned = mod.plan(m, { chain: ["text", "image"] }, { prompt: PROMPT });
  assert.equal(planned.steps[0].chosen, "codex");
  const fakeFor = (name, delay) => async () => { await new Promise((r) => setTimeout(r, delay)); write(path.join(home, ".codex", "generated_images", `sess-${name}`, `exec-${name}.png`), `PNG-${name}`); return ok(`done ${name}`); };
  const [a, b] = await Promise.all([
    mod.run(planned, { consent: true, exec: fakeFor("a", 60), home, cwd, effective: m }),
    mod.run(planned, { consent: true, exec: fakeFor("b", 10), home, cwd, effective: m }),
  ]);
  assert.notEqual(a.run_id, b.run_id);
  assert.notEqual(a.dir, b.dir);
  assert.equal(a.report.status, "complete"); assert.equal(b.report.status, "complete");
  assert.deepEqual(a.report.steps[0].files.map((f) => path.basename(f.path)), ["01-exec-a.png"]);
  assert.deepEqual(b.report.steps[0].files.map((f) => path.basename(f.path)), ["01-exec-b.png"]);
  assert.equal(a.report.steps[0].files[0].sha256, sha256("PNG-a"));
  assert.equal(b.report.steps[0].files[0].sha256, sha256("PNG-b"));
  assert.deepEqual(fs.readdirSync(path.join(home, ".momm", "harvest-locks")), [], "lock released by both");
});

await test("run: initial inputs are staged and bound for the first step; a text step records the reply as a file", async () => {
  const home = fresh("home"), cwd = fresh("cwd"), calls = [];
  const red = write(path.join(fresh("in"), "red.png"), PNG_A);
  const m = matrix();
  const planned = mod.plan(m, { input: ["image"], output: ["text"] }, { prompt: "What colour is the shape?" });
  assert.equal(planned.steps[0].chosen, "codex");
  const exec = async (command, args, options) => { calls.push({ command, args, options }); return ok("Red"); };
  const { dir, report } = await mod.run(planned, { consent: true, inputs: [red], exec, home, cwd, effective: m });
  assert.equal(report.status, "complete");
  const staged = path.join(dir, "step-1", "in", "01-red.png");
  assert.ok(fs.existsSync(staged));
  assert.equal(sha256(fs.readFileSync(staged)), sha256(PNG_A));
  assert.ok(calls[0].args.includes("-i") && calls[0].args[calls[0].args.indexOf("-i") + 1] === staged, "codex binds the staged file through -i {file}");
  assert.ok(calls[0].args.includes("read-only"), "a text step stays read-only");
  assert.deepEqual(report.steps[0].bound_flags, ["-i"]);
  assert.equal(report.steps[0].files[0].mime, "text/plain");
  assert.equal(fs.readFileSync(path.join(cwd, report.steps[0].files[0].path), "utf8"), "Red");
  assert.equal(report.steps[0].files[0].harvested_from, "stdout");
  await assert.rejects(mod.run(planned, { consent: true, inputs: [path.join(tmp, "absent.png")], exec, home, cwd, effective: m }), (e) => e.code === "MOMM_INPUT_MISSING");
  // resolveCommand lets the CLI map a route to its installed binary.
  const seen = [];
  await mod.run(planned, { consent: true, inputs: [red], exec: async (c) => { seen.push(c); return ok("Red"); }, resolveCommand: (route) => `/opt/bin/${route}`, home, cwd, effective: m });
  assert.deepEqual(seen, ["/opt/bin/codex"]);
});

await test("CLI: plan prints JSON with the prompt; run without --consent exits 2 and runs nothing", () => {
  const home = fresh("home"), cwd = fresh("cwd");
  const script = path.join(here, "modality.mjs");
  const planned = spawnSync(process.execPath, [script, "plan", "--need", JSON.stringify({ input: ["image"], output: ["text"] }), "--prompt", PROMPT, "--home", home], { encoding: "utf8", cwd, timeout: 30_000, windowsHide: true });
  assert.equal(planned.status, 0, planned.stderr);
  const json = JSON.parse(planned.stdout);
  assert.equal(json.schema, mod.PLAN_SCHEMA); assert.equal(json.prompt, PROMPT); assert.equal(json.possible, true);
  const planFile = path.join(cwd, "plan.json");
  fs.writeFileSync(planFile, planned.stdout);
  const refused = spawnSync(process.execPath, [script, "run", "--plan", planFile, "--home", home], { encoding: "utf8", cwd, timeout: 30_000, windowsHide: true });
  assert.equal(refused.status, 2); assert.match(refused.stderr, /consent/);
  assert.ok(!fs.existsSync(path.join(cwd, mod.MEDIA_DIR)));
  const impossible = spawnSync(process.execPath, [script, "plan", "--need", JSON.stringify({ output: ["speech"] }), "--home", home], { encoding: "utf8", cwd, timeout: 30_000, windowsHide: true });
  assert.equal(impossible.status, 3); assert.equal(JSON.parse(impossible.stdout).possible, false);
  const usage = spawnSync(process.execPath, [script], { encoding: "utf8", cwd, timeout: 30_000, windowsHide: true });
  assert.equal(usage.status, 4); assert.match(usage.stderr, /Usage/);
});

// ---- gate review rev_20260913213315_o8c2: one failing test per finding, then the fix ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockDirs = (home, cwds) => [path.join(home, ".momm", "harvest-locks"), ...cwds.map((c) => path.join(c, mod.MEDIA_DIR, ".locks"))];
const ageLocks = (dirs) => { const past = new Date(Date.now() - 3_600_000); for (const d of dirs) { try { for (const f of fs.readdirSync(d)) fs.utimesSync(path.join(d, f), past, past); } catch {} } };

await test("finding harvest-lock-is-workspace-scoped / shared-harvest-mixes-concurrent-runs: runs from different cwds serialise snapshot -> exec -> harvest on one shared glob", async () => {
  const home = fresh("home"), cwdA = fresh("cwdA"), cwdB = fresh("cwdB");
  const m = matrix();
  const planned = mod.plan(m, { chain: ["text", "image"] }, { prompt: PROMPT });
  const marks = {};
  const fake = (name, delay) => async () => { marks[`${name}.start`] = Date.now(); await sleep(delay); write(path.join(home, ".codex", "generated_images", `s-${name}`, `exec-${name}.png`), `PNG-${name}`); marks[`${name}.end`] = Date.now(); return ok(name); };
  const [a, b] = await Promise.all([
    mod.run(planned, { consent: true, exec: fake("a", 150), home, cwd: cwdA, effective: m }),
    (async () => { await sleep(20); return mod.run(planned, { consent: true, exec: fake("b", 10), home, cwd: cwdB, effective: m }); })(),
  ]);
  assert.ok(marks["b.start"] >= marks["a.end"], `B's exec (${marks["b.start"]}) must not start before A harvested (${marks["a.end"]})`);
  assert.deepEqual(a.report.steps[0].files.map((f) => path.basename(f.path)), ["01-exec-a.png"]);
  assert.deepEqual(b.report.steps[0].files.map((f) => path.basename(f.path)), ["01-exec-b.png"]);
  for (const d of lockDirs(home, [cwdA, cwdB])) if (fs.existsSync(d)) assert.deepEqual(fs.readdirSync(d), [], `lock released in ${d}`);
});

await test("finding live-harvest-lock-can-be-stolen: an old lock whose owner is alive is never removed", async () => {
  const home = fresh("home"), cwd = fresh("cwd");
  const m = matrix();
  const planned = mod.plan(m, { chain: ["text", "image"] }, { prompt: PROMPT });
  let release; const held = new Promise((r) => { release = r; });
  const marks = {};
  const slow = async () => { ageLocks(lockDirs(home, [cwd])); await held; write(path.join(home, ".codex", "generated_images", "s-a", "exec-a.png"), "A"); marks.aEnd = Date.now(); return ok("a"); };
  const quick = async () => { marks.bStart = Date.now(); write(path.join(home, ".codex", "generated_images", "s-b", "exec-b.png"), "B"); return ok("b"); };
  const runA = mod.run(planned, { consent: true, exec: slow, home, cwd, effective: m });
  await sleep(50);
  const runB = mod.run(planned, { consent: true, exec: quick, home, cwd, effective: m });
  await sleep(300);
  assert.equal(marks.bStart, undefined, "B must wait while A (alive) holds an aged lock");
  release();
  const [a, b] = await Promise.all([runA, runB]);
  assert.ok(marks.bStart >= marks.aEnd);
  assert.deepEqual(a.report.steps[0].files.map((f) => path.basename(f.path)), ["01-exec-a.png"]);
  assert.deepEqual(b.report.steps[0].files.map((f) => path.basename(f.path)), ["01-exec-b.png"]);
});

await test("finding only-first-generative-output-is-harvested: every generative output of a step is harvested and each must produce a file", async () => {
  const home = fresh("home"), cwd = fresh("cwd");
  const m = matrix();
  const planned = mod.plan(m, { input: ["text"], output: ["image", "video"] }, { prompt: PROMPT });
  assert.equal(planned.steps[0].chosen, "grok");
  const both = async () => { write(path.join(home, ".grok", "sessions", "e", "s1", "images", "1.jpg"), "JPG"); write(path.join(home, ".grok", "sessions", "e", "s1", "clip.mp4"), "MP4"); return ok(""); };
  const r1 = await mod.run(planned, { consent: true, exec: both, home, cwd, effective: m });
  assert.equal(r1.report.status, "complete");
  assert.deepEqual(r1.report.steps[0].files.map((f) => f.mime).sort(), ["image/jpeg", "video/mp4"]);
  const imageOnly = async () => { write(path.join(home, ".grok", "sessions", "e", "s2", "images", "1.jpg"), "JPG2"); return ok(""); };
  const r2 = await mod.run(planned, { consent: true, exec: imageOnly, home, cwd, effective: m });
  assert.equal(r2.report.status, "failed");
  assert.equal(r2.report.failure, "no_new_output");
  assert.match(String(r2.report.failure_detail ?? ""), /video_gen/);
});

await test("finding text-intermediate-has-no-binding: a staged text artefact is referenced by path in the next prompt, its content never is", async () => {
  const home = fresh("home"), cwd = fresh("cwd"), calls = [];
  const m = matrix();
  const planned = mod.plan(m, { chain: ["text", "text", "image"] }, { prompt: PROMPT });
  assert.deepEqual(planned.steps.map((s) => s.chosen), ["codex", "codex"]);
  const exec = async (command, args, options) => {
    calls.push({ command, args, options });
    if (calls.length === 1) return ok("SECRET-STEP1-TEXT the answer is forty-two");
    write(path.join(home, ".codex", "generated_images", "s", "exec-2.png"), "PNG");
    return ok("");
  };
  const { dir, report } = await mod.run(planned, { consent: true, exec, home, cwd, effective: m });
  assert.equal(report.status, "complete");
  const staged = path.join(dir, "step-2", "in", "01-01-response.txt").replace(/\\/g, "/");
  assert.ok(fs.existsSync(staged));
  const prompt2 = calls[1].options.input;
  assert.ok(prompt2.startsWith(PROMPT));
  assert.ok(prompt2.includes(staged), `step 2 prompt must reference ${staged}`);
  assert.ok(!prompt2.includes("SECRET-STEP1-TEXT") && !prompt2.includes("forty-two"), "step 1 text never enters step 2");
  assert.ok(!calls[1].args.some((a) => a.includes("SECRET-STEP1")));
});

await test("finding glob-terminal-double-star-misses-files: a pattern ending in ** matches every file below", () => {
  const root = fresh("glob2");
  for (const f of ["a/x.png", "a/b/y.txt", "a/b/c/z.mp4"]) write(path.join(root, f), "x");
  const rel = (list) => list.map((f) => path.relative(root, f).replace(/\\/g, "/")).sort();
  assert.deepEqual(rel(mod.globFiles(`${root}/a/**`)), ["a/b/c/z.mp4", "a/b/y.txt", "a/x.png"]);
  assert.deepEqual(rel(mod.globFiles(`${root}/**`)), ["a/b/c/z.mp4", "a/b/y.txt", "a/x.png"]);
});

await test("finding timeout-misclassified-as-exit-code / timeout-not-a-failure: a timed-out exec fails the step as timeout whatever the code", async () => {
  const home = fresh("home"), cwd = fresh("cwd");
  const m = matrix();
  const planned = mod.plan(m, { chain: ["text", "image", "video"] }, { prompt: PROMPT });
  const calls = [];
  const zeroButTimedOut = async () => { calls.push(1); write(path.join(home, ".grok", "sessions", "e", "s", "images", "1.jpg"), "J"); return { code: 0, stdout: "", stderr: "", timedOut: true }; };
  const r1 = await mod.run(planned, { consent: true, exec: zeroButTimedOut, home, cwd, effective: m });
  assert.equal(r1.report.status, "failed"); assert.equal(r1.report.failure, "timeout"); assert.equal(r1.report.steps.length, 1); assert.equal(calls.length, 1, "the chain stops");
  const nullCode = async () => ({ code: null, stdout: "", stderr: "", timedOut: true, error: Object.assign(new Error("spawn ETIMEDOUT"), { code: "ETIMEDOUT" }) });
  const r2 = await mod.run(planned, { consent: true, exec: nullCode, home, cwd, effective: m });
  assert.equal(r2.report.failure, "timeout"); assert.equal(r2.report.steps[0].timed_out, true);
});

await test("finding empty-inputs-skip-bind: a first step that needs media refuses to run without initial inputs", async () => {
  const home = fresh("home"), cwd = fresh("cwd"), calls = [];
  const m = matrix();
  const planned = mod.plan(m, { chain: ["image", "video"] }, { prompt: PROMPT });
  const exec = async (...a) => { calls.push(a); return ok(""); };
  await assert.rejects(mod.run(planned, { consent: true, inputs: [], exec, home, cwd, effective: m }), (e) => e.code === "MOMM_INPUT_MISSING" && /image/.test(e.message));
  assert.equal(calls.length, 0);
  assert.ok(!fs.existsSync(path.join(cwd, mod.MEDIA_DIR)));
  assert.match(mod.bindInputs([{ how: "-i {file}" }], { files: [], dir: cwd }).problem ?? "", /no artefact/);
});

await test("finding prompt-in-argv: the prompt never travels in argv; stdin or a prompt file carries it, and antigravity's --print-timeout follows the runner timeout", async () => {
  const long = "x".repeat(9000);
  const dir = fresh("work"), promptFile = path.join(dir, "prompt.txt");
  for (const route of ["codex", "claude", "antigravity", "gemini", "copilot", "grok"]) {
    const cmd = mod.commandFor(route, { prompt: long, promptFile, workDir: dir, generative: false, timeout: 600_000 });
    assert.ok(!cmd.args.some((a) => a.includes(long)), `${route} puts the prompt in argv`);
    assert.ok(cmd.input === long || cmd.args.includes(promptFile) || cmd.args.some((a) => a.includes(path.basename(promptFile))), `${route} must carry the prompt on stdin or via the prompt file`);
    assert.ok(cmd.args.every((a) => a.length < 2000), `${route} argv stays short`);
  }
  const agy = mod.commandFor("antigravity", { prompt: long, promptFile, workDir: dir, generative: true, timeout: 600_000 });
  assert.equal(agy.args[agy.args.indexOf("--print-timeout") + 1], "600s");
  assert.equal(mod.commandFor("antigravity", { prompt: long, promptFile, workDir: dir, generative: true, timeout: 90_500 }).args.at(mod.commandFor("antigravity", { prompt: long, promptFile, workDir: dir, generative: true, timeout: 90_500 }).args.indexOf("--print-timeout") + 1), "91s");
  // End to end on claude: the prompt arrives on stdin and the artefact reference sits in it.
  const home = fresh("home"), cwd = fresh("cwd"), calls = [];
  const m = matrix([{ route: "codex", direction: "input", modality: "image", blocker: "probe_failed" }]);
  const planned = mod.plan(m, { input: ["image"], output: ["text"] }, { prompt: PROMPT });
  assert.equal(planned.steps[0].chosen, "claude");
  const red = write(path.join(fresh("in"), "red.png"), PNG_A);
  const completed = await mod.run(planned, { consent: true, inputs: [red], exec: async (c, a, o) => { calls.push({ c, a, o }); return ok(JSON.stringify({ type: "result", result: "Red", is_error: false })); }, home, cwd, effective: m });
  assert.equal(completed.report.status, "complete");
  assert.ok(calls[0].o.input.startsWith(PROMPT));
  assert.ok(!calls[0].a.some((a) => a.includes(PROMPT)));
  assert.ok(calls[0].a.includes("--tools") && calls[0].a.includes("--add-dir"));
});

await test("finding codex-harvest-ignores-configured-home: CODEX_HOME and COPILOT_HOME redirect the harvest root", async () => {
  const home = fresh("home"), cwd = fresh("cwd"), codexHome = fresh("codex-home");
  assert.equal(mod.expandHome("~/.codex/generated_images/**/*.png", home, { CODEX_HOME: codexHome }), `${codexHome.replace(/\\/g, "/")}/generated_images/**/*.png`);
  assert.equal(mod.expandHome("~/.copilot/x/*.png", home, { COPILOT_HOME: "/cp" }), "/cp/x/*.png");
  assert.equal(mod.expandHome("~/.codex/generated_images/**/*.png", home, {}), `${home.replace(/\\/g, "/")}/.codex/generated_images/**/*.png`);
  const m = matrix();
  const planned = mod.plan(m, { chain: ["text", "image"] }, { prompt: PROMPT });
  const exec = async () => { write(path.join(codexHome, "generated_images", "s", "exec-1.png"), "CUSTOM"); return ok(""); };
  const { report } = await mod.run(planned, { consent: true, exec, home, cwd, effective: m, env: { CODEX_HOME: codexHome } });
  assert.equal(report.status, "complete");
  assert.equal(report.steps[0].files[0].sha256, sha256("CUSTOM"));
  assert.match(report.steps[0].files[0].harvested_from, /^\$CODEX_HOME\//);
});

// ---- suggestions applied with tests -----------------------------------------------------------------
await test("suggestion: an exec that throws leaves a persisted report with the error, releases the lock, and the next run completes", async () => {
  const home = fresh("home"), cwd = fresh("cwd");
  const m = matrix();
  const planned = mod.plan(m, { chain: ["text", "image", "video"] }, { prompt: PROMPT });
  let n = 0;
  const flaky = async () => { n++; if (n === 1) { write(path.join(home, ".grok", "sessions", "e", "s", "images", "1.jpg"), "J"); return ok(""); } throw new Error("provider exploded"); };
  await assert.rejects(mod.run(planned, { consent: true, exec: flaky, home, cwd, effective: m }), /provider exploded/);
  const runs = fs.readdirSync(path.join(cwd, mod.MEDIA_DIR)).filter((d) => d.startsWith("media_"));
  assert.equal(runs.length, 1);
  const report = JSON.parse(fs.readFileSync(path.join(cwd, mod.MEDIA_DIR, runs[0], "report.json"), "utf8"));
  assert.equal(report.status, "error"); assert.match(report.error, /provider exploded/); assert.equal(report.steps.length, 1, "step 1 stays auditable");
  const fine = async () => { write(path.join(home, ".grok", "sessions", "e", "s2", "images", "1.jpg"), "J2"); write(path.join(home, ".grok", "sessions", "e", "s2", "c.mp4"), "V"); return ok(""); };
  const next = await mod.run(planned, { consent: true, exec: fine, home, cwd, effective: m });
  assert.equal(next.report.status, "complete");
  for (const d of lockDirs(home, [cwd])) if (fs.existsSync(d)) assert.deepEqual(fs.readdirSync(d), []);
});

await test("suggestion: a saved plan is re-derived from its from/to, so a tampered candidate.cells cannot hide a blocked cell", async () => {
  const home = fresh("home"), cwd = fresh("cwd"), calls = [];
  const planned = mod.plan(matrix(), { chain: ["text", "image", "video"] }, { prompt: PROMPT });
  for (const step of planned.steps) for (const c of step.candidates) c.cells = c.cells.filter((cell) => cell.modality !== "video_gen");
  const live = matrix([{ route: "grok", direction: "output", modality: "video_gen", blocker: "zdr" }]);
  await assert.rejects(mod.run(planned, { consent: true, exec: async (...a) => { calls.push(a); return ok(""); }, home, cwd, effective: live }), (e) => e.code === "MOMM_STEP_BLOCKED" && e.blocker === "zdr");
  assert.equal(calls.length, 0);
});

await test("suggestion: harvest is capped so a wide glob cannot ingest an unbounded directory", async () => {
  const home = fresh("home"), cwd = fresh("cwd");
  const m = matrix();
  const planned = mod.plan(m, { chain: ["text", "image"] }, { prompt: PROMPT });
  const flood = async () => { for (let i = 0; i < mod.HARVEST_MAX_FILES + 5; i++) write(path.join(home, ".codex", "generated_images", "s", `exec-${i}.png`), `P${i}`); return ok(""); };
  const { report } = await mod.run(planned, { consent: true, exec: flood, home, cwd, effective: m });
  assert.equal(report.status, "failed"); assert.equal(report.failure, "too_many_outputs"); assert.deepEqual(report.steps[0].files, []);
});

await test("suggestion: harvestNew window — unchanged, older-than-start and unlisted files are excluded; new and changed ones included", () => {
  const root = fresh("hv");
  const pattern = `${root}/**/*.png`;
  const old = write(path.join(root, "old.png"), "old"), same = write(path.join(root, "same.png"), "same");
  const past = new Date(Date.now() - 60_000); fs.utimesSync(old, past, past);
  const before = mod.snapshotFiles(pattern);
  const started = Date.now();
  write(path.join(root, "fresh.png"), "fresh"); write(path.join(root, "other.txt"), "no");
  fs.writeFileSync(same, "changed-size");
  fs.utimesSync(old, new Date(), new Date(started - 30_000));
  const found = mod.harvestNew(pattern, before, started).map((f) => path.basename(f)).sort();
  assert.deepEqual(found, ["fresh.png", "same.png"]);
});

// ---- 1.16 readiness audit (2026-09-14): three runner hardening findings, reproduced first ----
await test("audit: a saved plan that is not possible refuses with the typed error even when blocked_by is missing or malformed", async () => {
  const home = fresh("home"), cwd = fresh("cwd"), m = matrix();
  let calls = 0;
  const exec = async () => { calls++; return ok("never"); };
  for (const plan of [
    { schema: mod.PLAN_SCHEMA, steps: [{}], possible: false, prompt: PROMPT },
    { schema: mod.PLAN_SCHEMA, steps: [{}], possible: false, prompt: PROMPT, blocked_by: "not a list" },
    { schema: mod.PLAN_SCHEMA, steps: [{}], possible: false, prompt: PROMPT, blocked_by: [null, { step: 0 }] },
  ]) {
    await assert.rejects(mod.run(plan, { consent: true, exec, home, cwd, effective: m }), (e) => e.code === "MOMM_PLAN_BLOCKED" && /not possible/.test(e.message) && Array.isArray(e.blocked_by), JSON.stringify(plan.blocked_by ?? null));
  }
  assert.equal(calls, 0);
  assert.ok(!fs.existsSync(path.join(cwd, mod.MEDIA_DIR)), "a refused plan writes no media directory");
});

await test("audit: an initial input that cannot be read for hashing ends the run as error, never leaves the saved report running", async () => {
  const home = fresh("home"), cwd = fresh("cwd"), m = matrix();
  const planned = mod.plan(m, { input: ["image"], output: ["text"] }, { prompt: PROMPT });
  const red = write(path.join(fresh("in"), "red.png"), PNG_A);
  let calls = 0;
  const open = fs.openSync;
  fs.openSync = function (file, ...rest) { if (path.resolve(String(file)) === path.resolve(red) && String(rest[0] ?? "r").startsWith("r")) throw Object.assign(new Error("synthetic EACCES"), { code: "EACCES" }); return open.call(fs, file, ...rest); };
  try {
    await assert.rejects(mod.run(planned, { consent: true, inputs: [red], exec: async () => { calls++; return ok("never"); }, home, cwd, effective: m }), (e) => e.code === "EACCES" || e.code === "MOMM_INPUT_MISSING");
  } finally { fs.openSync = open; }
  assert.equal(calls, 0, "no provider is contacted");
  const media = path.join(cwd, mod.MEDIA_DIR);
  const reports = fs.readdirSync(media).map((n) => JSON.parse(fs.readFileSync(path.join(media, n, "report.json"), "utf8")));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].status, "error", "terminal state persisted");
  assert.match(reports[0].error ?? "", /EACCES|could not be read/);
});

await test("audit: the recorded step level comes from the live cells the run checked, not from the saved plan's claim", async () => {
  const home = fresh("home"), cwd = fresh("cwd");
  const m = matrix();
  const planned = mod.plan(m, { chain: ["text", "text"] }, { prompt: PROMPT });
  const step = planned.steps[0];
  step.chosen = "claude";
  step.candidates.find((c) => c.route === "claude").level = "verified";
  for (const side of ["input", "output"]) m.routes.claude[side].text.level = "documented";
  const r = await mod.run(planned, { consent: true, exec: async () => ok(JSON.stringify({ type: "result", result: "Hello.", is_error: false })), home, cwd, effective: m });
  assert.equal(r.report.status, "complete");
  assert.equal(r.report.steps[0].level, "documented", "live level wins");
  assert.equal(r.report.steps[0].plan_level, "verified", "the plan's stale claim is kept beside it");
  // When plan and live agree (a fresh plan on the current matrix), no plan_level field is added
  // and the recorded level is the chosen route's live text level.
  const agreed = mod.plan(m, { chain: ["text", "text"] }, { prompt: PROMPT });
  const r2 = await mod.run(agreed, { consent: true, exec: async () => ok(JSON.stringify({ type: "result", result: "Hello.", is_error: false })), home, cwd, effective: m });
  const chosen = r2.report.steps[0].route;
  assert.equal(r2.report.steps[0].level, m.routes[chosen].input.text.level); assert.equal("plan_level" in r2.report.steps[0], false);
});

await test("audit: failed terminal report writes expose stale saved state without claiming completion", async () => {
  const home = fresh("home"), cwd = fresh("cwd"), m = matrix();
  const planned = mod.plan(m, { chain: ["text", "text"] }, { prompt: PROMPT });
  planned.steps[0].chosen = "claude";
  const rename = fs.renameSync;
  let deny = false, caught;
  fs.renameSync = function (from, to, ...rest) {
    if (deny && path.basename(String(to)) === "report.json") throw Object.assign(new Error("synthetic write refusal"), { code: "EACCES" });
    return rename.call(fs, from, to, ...rest);
  };
  try {
    await mod.run(planned, { consent: true, home, cwd, effective: m, exec: async () => {
      deny = true;
      return ok(JSON.stringify({ type: "result", result: "Retained answer", is_error: false }));
    } });
  } catch (error) { caught = error; }
  finally { fs.renameSync = rename; }
  assert.equal(caught?.code, "MOMM_MEDIA_EVIDENCE_WRITE");
  assert.equal(caught.cause?.code, "EACCES", "preserve the original in-memory cause without publishing its message");
  assert.equal(caught.evidence.write_error_code, "EACCES");
  assert(!JSON.stringify(caught.evidence).includes("synthetic write refusal"), "public diagnostic contains no raw failure text");
  assert.equal(caught.evidence.persisted, false);
  assert.equal(caught.evidence.status, "error");
  assert.equal(caught.evidence.last_saved_status, "running");
  const runDir = path.join(cwd, mod.MEDIA_DIR, caught.evidence.run_id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, "report.json"))).status, "running");
  assert.equal(fs.readFileSync(path.join(runDir, "step-1/out/01-response.txt"), "utf8"), "Retained answer");
});

for (const success of [true, false]) await test(`audit: no redundant terminal checkpoint (${success ? "success" : "failure"})`, async () => {
  const home = fresh("home"), cwd = fresh("cwd"), m = matrix();
  const planned = mod.plan(m, { chain: ["text", "text"] }, { prompt: PROMPT });
  planned.steps[0].chosen = "claude";
  const rename = fs.renameSync;
  let writes = 0, result;
  fs.renameSync = function (from, to, ...rest) {
    if (path.basename(String(to)) === "report.json") writes++;
    return rename.call(fs, from, to, ...rest);
  };
  try {
    result = await mod.run(planned, { consent: true, home, cwd, effective: m,
      exec: async () => success ? ok(JSON.stringify({ type: "result", result: "Synthetic answer", is_error: false })) : { code: 1, stdout: "", stderr: "Synthetic failure" } });
  } finally { fs.renameSync = rename; }
  assert.equal(result.report.status, success ? "complete" : "failed");
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.dir, "report.json"))).status, result.report.status);
  assert.equal(writes, 2, "one initial and one terminal checkpoint; do not rewrite an unchanged terminal state");
});

for (const writeCode of ["ENOSPC", "synthetic-private-diagnostic"]) await test(`audit: separate run and terminal persistence errors (${writeCode})`, async () => {
  const home = fresh("home"), cwd = fresh("cwd"), m = matrix();
  const planned = mod.plan(m, { chain: ["text", "text"] }, { prompt: PROMPT });
  planned.steps[0].chosen = "claude";
  const rename = fs.renameSync;
  let deny = false, caught;
  fs.renameSync = function (from, to, ...rest) {
    if (deny && path.basename(String(to)) === "report.json") throw Object.assign(new Error("synthetic private write detail"), { code: writeCode });
    return rename.call(fs, from, to, ...rest);
  };
  try {
    await mod.run(planned, { consent: true, home, cwd, effective: m, exec: async () => {
      deny = true;
      throw Object.assign(new Error("synthetic private provider detail"), { code: "EPROVIDER" });
    } });
  } catch (error) { caught = error; }
  finally { fs.renameSync = rename; }
  assert.equal(caught?.code, "MOMM_MEDIA_EVIDENCE_WRITE");
  assert.equal(caught.cause?.code, "EPROVIDER", "retain the original run failure privately");
  assert.equal(caught.evidence.write_error_code, writeCode === "ENOSPC" ? "ENOSPC" : "unknown");
  assert.equal(caught.write_cause?.code, writeCode, "retain the distinct write failure privately");
  assert.equal(Object.prototype.propertyIsEnumerable.call(caught, "write_cause"), false);
  assert.doesNotMatch(JSON.stringify(caught), /synthetic private|synthetic-private-diagnostic/);
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length || (filter && !passed.length)) process.exitCode = 1;
