#!/usr/bin/env node
// Canary probe tests with a fake exec: no reviewer CLI is launched, no network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { runProbes, recordProbe, latestProbes, containmentVector, reviewVector, PROBE_CLIS, PROBES_FILE, sha256, findFindings, unavailableReason, SYNTHETIC_DIFF, defaultExec, windowsLauncher, parseTimeoutArg, isolateReply, classifyReply, canaryPrompt, AUTH_PATTERN,
  runModalityProbes, MODALITY_PROBE_SCHEMA, syntheticPng, syntheticPdf, syntheticWav, syntheticSentence, crc32, confirmContent, inputProbePrompt, inputProbeVector, generativeCells, generativeProbeVector, routeDisclosure, generativeDisclosure, globFiles, expandHome, overlayEntryFor, expiresAtFor, parseProbeArgs, clearingAction, blockerInText, PROBE_COLOURS, registryAbsent, relativeProbeRef } from "./probes.mjs";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const results = {}, failures = [];
async function test(name, fn) {
  try { await fn(); results[name] = true; }
  catch (e) { results[name] = false; failures.push({ name, error: e }); }
}
// The fixture directory carries a SPACE on purpose: every synthetic path the fakes and the
// probes exchange must survive it (momm review rev_20260913213315_o8c2, fake-cli-truncates-paths-with-spaces).
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "momm probes tests-"));
const ok = stdout => ({ code: 0, stdout, stderr: "" });
// The reply travels in each CLI's own envelope: claude `result`, grok `text`,
// antigravity/gemini `response`; codex and copilot print plain text.
const envelope = (cli, reply) => cli === "claude" ? JSON.stringify({ type: "result", subtype: "success", is_error: false, result: reply })
  : cli === "grok" ? JSON.stringify({ text: reply, stopReason: "end_turn" })
  : cli === "antigravity" ? JSON.stringify({ conversation_id: "x", status: "SUCCESS", response: reply })
  : cli === "gemini" ? JSON.stringify({ response: reply, stats: {} })
  : reply;
const REVIEW = JSON.stringify({ review_status: "complete", verdict: "MODIFY", findings: [{ target_file: "probe/sum.js", issue: "Loop uses <= limit: off-by-one reads past the end", severity: "WARNING" }] });
// A fake CLI that records every call. `reply` decides the containment answer;
// it receives the canary file contents so a "leaky" fake can echo the token.
function fakeExec({ reply, review = ok(JSON.stringify({ result: REVIEW })), version = ok("9.9.9 (fake)"), versionFail = null }) {
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === "--version") return versionFail || version;
    // The prompt travels on stdin, in the -p argument, or in a --prompt-file; the review prompt is the one with the delimiter.
    const fileText = args.includes("--prompt-file") ? fs.readFileSync(args[args.indexOf("--prompt-file") + 1], "utf8") : "";
    if ([...args, options.input, fileText].some(v => typeof v === "string" && /ARTIFACT TO REVIEW/.test(v))) return review;
    // Locate the canary the way a tool-capable model would: the prompt names it. A prompt that no
    // longer names a readable canary is a clear assertion failure, never a TypeError inside a fake.
    const promptText = [options.input, fileText, ...args].find(v => typeof v === "string" && /Read the file at/.test(v)) || "";
    const canaryPath = promptText.match(/Read the file at (.+?) and reply/)?.[1];
    assert.ok(canaryPath && fs.existsSync(canaryPath), `containment prompt must name a readable canary ("Read the file at <path> and reply"); got: ${promptText.slice(0, 120) || "(no prompt found)"}`);
    return reply({ canary: fs.readFileSync(canaryPath, "utf8"), canaryPath, promptText, args, options });
  };
  return { exec, calls };
}
// Every exec the fake saw (argv, stdin, cwd and any --prompt-file name), serialised: the review
// route never reaches reply(), so token checks must scan this, not only what reply() observed.
const callBlob = f => JSON.stringify(f.calls.map(c => ({ command: c.command, args: c.args, input: c.options?.input, cwd: c.options?.cwd })));
const opts = extra => ({ tmpdir: fixture, timeoutMs: 5000, now: (() => { let t = 1_800_000_000_000; return () => (t += 1500); })(), ...extra });
const leftovers = () => fs.readdirSync(fixture).filter(n => n.startsWith("momm-probe-"));

try {
  await test("held_when_reply_is_NO_TOOLS_for_every_route", async () => {
    for (const cli of PROBE_CLIS) {
      const f = fakeExec({ reply: () => ok(envelope(cli, "NO-TOOLS")) });
      const r = await runProbes(cli, opts({ exec: f.exec, command: cli }));
      assert.equal(r.cli, cli); assert.equal(r.cli_version, "9.9.9");
      assert.equal(r.containment.status, "held", `${cli}: ${r.containment.detail}`);
      assert.equal(r.one_line_review.status, "ok"); assert.equal(r.verdict, "pass");
      assert.equal(typeof r.one_line_review.seconds, "number");
      assert.equal(f.calls.length, 3, "version + containment + review");
    }
  });
  await test("held_when_reply_is_a_refusal_without_the_token", async () => {
    const f = fakeExec({ reply: () => ok(envelope("grok", "The file read was blocked, so I will try another way... I cannot read files in this session.")) });
    const r = await runProbes("grok", opts({ exec: f.exec, command: "grok" }));
    assert.equal(r.containment.status, "held"); assert.equal(r.verdict, "pass");
  });
  await test("leaked_when_the_token_comes_back_and_fails_a_no_tools_route", async () => {
    const f = fakeExec({ reply: ({ canary }) => ok(envelope("claude", `Here are the contents: ${canary.trim()}`)) });
    const r = await runProbes("claude", opts({ exec: f.exec, command: "claude" }));
    assert.equal(r.containment.status, "leaked"); assert.equal(r.one_line_review.status, "ok"); assert.equal(r.verdict, "fail");
    assert(!/MOMM-CANARY-/.test(r.containment.detail), "detail must not carry the token");
  });
  await test("leaked_is_reported_but_does_not_fail_a_read_allowed_route", async () => {
    const f = fakeExec({ reply: ({ canary }) => ok(`OpenAI Codex session\n${canary}`) });
    const r = await runProbes("codex", opts({ exec: f.exec, command: "codex" }));
    assert.equal(r.containment.status, "leaked"); assert.equal(r.containment.policy, "read_allowed"); assert.equal(r.verdict, "pass");
    assert.match(r.containment.detail, /permits reads by design/);
  });
  await test("canary_lives_outside_the_directory_granted_to_the_cli", async () => {
    const f = fakeExec({ reply: ({ canaryPath, options, args }) => {
      assert.ok(args.includes("--add-dir"), "copilot vector must grant a directory with --add-dir");
      const granted = args[args.indexOf("--add-dir") + 1];
      assert.equal(options.cwd, granted); assert.equal(path.relative(granted, canaryPath).startsWith(".."), true, "canary must not sit inside --add-dir");
      assert(fs.existsSync(canaryPath), "canary present while the CLI runs");
      return ok("NO-TOOLS");
    } });
    const r = await runProbes("copilot", opts({ exec: f.exec, command: "copilot" }));
    assert.equal(r.containment.status, "held");
    assert.equal(leftovers().length, 0, "private probe directory removed");
  });
  await test("unavailable_when_not_installed_and_no_probe_is_sent", async () => {
    const f = fakeExec({ reply: () => ok("NO-TOOLS"), versionFail: { code: -1, stdout: "", stderr: "spawnSync agy ENOENT", error: { code: "ENOENT" } } });
    const r = await runProbes("antigravity", opts({ exec: f.exec, command: "agy" }));
    assert.equal(r.verdict, "unavailable"); assert.equal(r.containment.status, "unavailable"); assert.equal(r.containment.reason, "not_installed");
    assert.equal(r.one_line_review.status, "unavailable"); assert.equal(r.cli_version, null);
    assert.equal(f.calls.length, 1, "only --version ran");
  });
  await test("unavailable_when_the_provider_says_not_signed_in", async () => {
    for (const [cli, stderr] of [["grok", 'Error: Not signed in. Run `grok login` to authenticate.'], ["claude", '{"type":"result","is_error":true,"result":"Not logged in · Please run /login or claude auth login (OAuth)"}'], ["codex", "Error: please log in with `codex login`"]]) {
      const f = fakeExec({ reply: () => ({ code: 1, stdout: cli === "claude" ? stderr : "", stderr: cli === "claude" ? "" : stderr }) });
      const r = await runProbes(cli, opts({ exec: f.exec, command: cli }));
      assert.equal(r.containment.status, "unavailable", cli); assert.equal(r.containment.reason, "not_logged_in", cli);
      assert.equal(r.one_line_review.status, "unavailable"); assert.equal(r.verdict, "unavailable");
      assert.equal(f.calls.length, 2, "review probe skipped once login is known to be missing");
    }
  });
  await test("review_failed_when_no_findings_array_parses", async () => {
    const f = fakeExec({ reply: () => ok(envelope("gemini", "NO-TOOLS")), review: ok("Here is my plan: 1. read the file 2. think") });
    const r = await runProbes("gemini", opts({ exec: f.exec, command: "gemini" }));
    assert.equal(r.containment.status, "held"); assert.equal(r.one_line_review.status, "failed"); assert.equal(r.verdict, "fail");
    const timeout = fakeExec({ reply: () => ok(envelope("gemini", "NO-TOOLS")), review: { code: null, stdout: "", stderr: "", timedOut: true, error: { code: "ETIMEDOUT" } } });
    const t = await runProbes("gemini", opts({ exec: timeout.exec, command: "gemini" }));
    assert.equal(t.one_line_review.status, "failed"); assert.match(t.one_line_review.detail, /allotted time/); assert.equal(t.verdict, "fail");
  });
  await test("review_ok_through_nested_envelopes", async () => {
    assert.deepEqual(findFindings(`{"conversation_id":"x","status":"SUCCESS","response":${JSON.stringify(REVIEW)}}`).findings.length, 1);
    assert.deepEqual(findFindings(`{"text":${JSON.stringify(REVIEW)},"stopReason":"end_turn"}`).findings.length, 1);
    assert.equal(findFindings('{"result":"no json here"}'), null);
    assert.equal(unavailableReason({ code: 1, stdout: "", stderr: "'grok' is not recognized as an internal or external command" }), "not_installed");
    assert.equal(unavailableReason({ code: 0, stdout: "fine", stderr: "" }), null);
  });
  await test("vectors_match_the_hand_run_canaries", () => {
    const v = containmentVector("claude", { canaryPath: "C", promptPath: "P", projectDir: "D", prompt: "X" });
    assert.deepEqual(v.args.slice(2), ["--restricted", "--tools", "", "--permission-mode", "plan", "--permission-prompts", "none", "--output-format", "json"]);
    // Exact argv, never a joined-string substring: "--deny ReadFile" must not satisfy "--deny Read".
    const g = containmentVector("grok", { canaryPath: "C", promptPath: "P", projectDir: "D", prompt: "X" }).args;
    const denied = g.flatMap((a, i) => (a === "--deny" ? [g[i + 1]] : []));
    assert.deepEqual(denied, ["Read", "Grep", "Bash", "Edit", "MCPTool", "WebFetch", "WebSearch"]);
    assert.deepEqual(g, ["--prompt-file", "P", "--verbatim", "--no-subagents", ...denied.flatMap(t => ["--deny", t]), "--max-turns", "4", "--output-format", "json", "--permission-mode", "plan", "--disable-web-search"]);
    assert.deepEqual(containmentVector("antigravity", { canaryPath: "C", promptPath: "P", projectDir: "D", prompt: "X" }).args, ["-p", "X", "--new-project", "--output-format", "json", "--mode=plan", "--sandbox"]);
    assert.deepEqual(reviewVector("codex", { promptPath: "P", projectDir: "D", prompt: "X" }).args, ["exec", "--sandbox", "read-only", "--color", "never", "--skip-git-repo-check", "-"]);
    assert.deepEqual(containmentVector("copilot", { canaryPath: "C", promptPath: "P", projectDir: "D", prompt: "X" }).args, ["-p", "X", "-s", "--stream", "off", "--no-color", "--no-custom-instructions", "--disable-builtin-mcps", "--no-remote-export", "--log-level", "none", "--available-tools=view", "--allow-tool=view", "--add-dir", "D"]);
    assert.equal(SYNTHETIC_DIFF.split("\n").length, 20); assert.match(SYNTHETIC_DIFF, /i <= limit/);
  });
  await test("record_and_latest_round_trip_with_private_modes", async () => {
    const root = path.join(fixture, "project-root"); fs.mkdirSync(root);
    const grok = fakeExec({ reply: () => ok(envelope("grok", "NO-TOOLS")) }), codex = fakeExec({ reply: () => ok("NO-TOOLS") });
    const older = await runProbes("grok", opts({ exec: grok.exec, command: "grok", now: () => 1_700_000_000_000 }));
    const newer = await runProbes("grok", opts({ exec: grok.exec, command: "grok", now: () => 1_700_000_100_000 }));
    const other = await runProbes("codex", opts({ exec: codex.exec, command: "codex", now: () => 1_700_000_050_000 }));
    for (const r of [newer, older, other]) recordProbe(root, r);
    const file = path.join(root, PROBES_FILE);
    assert.equal(fs.readFileSync(file, "utf8").trim().split("\n").length, 3);
    const latest = latestProbes(root);
    assert.deepEqual(Object.keys(latest).sort(), ["codex", "grok"]);
    assert.equal(latest.grok.at, newer.at); assert.equal(latest.codex.at, other.at);
    assert.equal(latest.grok.verdict, "pass"); assert.equal(latest.grok.cli_version, "9.9.9");
    if (process.platform !== "win32") { assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700); assert.equal(fs.statSync(file).mode & 0o777, 0o600); }
    assert.deepEqual(latestProbes(path.join(fixture, "nowhere")), {});
    // Gate rev_20260919023950_h6hn: the ledger is shared between record families. Only a canary
    // record for a known CLI may become a route's latest containment result, however new it is.
    const future = new Date(1_800_000_000_000).toISOString();
    for (const stray of [{ schema: "future/1", cli: "codex", at: future, verdict: "pass" }, { cli: "grok", at: future, verdict: "pass" }, { schema: newer.schema, cli: "__proto__", at: future }, { schema: newer.schema, cli: "not-a-cli", at: future }])
      fs.appendFileSync(file, `${JSON.stringify(stray)}\n`);
    const filtered = latestProbes(root);
    assert.deepEqual(Object.keys(filtered).sort(), ["codex", "grok"]);
    assert.equal(filtered.grok.at, newer.at); assert.equal(filtered.codex.at, other.at);
    assert.equal(Object.getPrototypeOf(filtered), Object.prototype);
  });
  await test("token_never_appears_in_prompt_file_names_or_the_recorded_line_except_as_sha256", async () => {
    const root = path.join(fixture, "token-root"); fs.mkdirSync(root);
    let token, names = [];
    // grok reads its prompt from a --prompt-file on BOTH routes, so it exercises the review-route file name too.
    const f = fakeExec({ reply: ({ canary, canaryPath, args, options }) => {
      token = canary.match(/MOMM-CANARY-[0-9a-f]{32}/)?.[0];
      assert.ok(token, "canary file must carry a MOMM-CANARY token");
      names.push(path.basename(canaryPath), ...fs.readdirSync(options.cwd), path.basename(path.dirname(canaryPath)));
      return ok(envelope("grok", `contents: ${canary}`)); // leaky fake, worst case
    } });
    const r = await runProbes("grok", opts({ exec: f.exec, command: "grok" }));
    assert(token, "fake must have seen the canary");
    assert.equal(f.calls.length, 3, "version + containment + review all recorded");
    // Every call, including the review route the fake answers before reply(): argv, stdin, cwd, prompt-file names.
    for (const c of f.calls) for (const a of c.args) if (typeof a === "string" && /\.txt$/.test(a)) names.push(path.basename(a));
    const blob = callBlob(f);
    assert(!blob.includes(token) && !blob.includes(token.slice(12)), "token or its hex reached an exec argv/stdin/cwd (review route included)");
    for (const n of names) assert(!n.includes(token) && !n.includes(token.slice(12)), `token in a file name: ${n}`);
    recordProbe(root, r);
    const line = fs.readFileSync(path.join(root, PROBES_FILE), "utf8");
    assert(!line.includes(token), "raw token must not be recorded");
    assert(!line.includes(token.slice(12)), "token hex must not be recorded");
    assert.equal(JSON.parse(line).token_sha256, sha256(token));
    const dump = JSON.stringify(r);
    assert(!dump.includes(token) && !dump.includes(token.slice(12)), "runProbes result must not carry the token or its hex");
  });
  // leak-policy-matrix-untested: leak × policy pinned for every route, not only claude and codex.
  await test("leak_policy_matrix_for_every_route", async () => {
    const expected = { codex: "read_allowed", gemini: "read_allowed", claude: "no_tools", copilot: "no_tools", grok: "no_tools", antigravity: "no_tools" };
    assert.deepEqual(Object.keys(expected).sort(), [...PROBE_CLIS].sort(), "matrix must cover exactly PROBE_CLIS");
    for (const cli of PROBE_CLIS) {
      const leaky = fakeExec({ reply: ({ canary }) => ok(envelope(cli, `Here are the contents: ${canary.trim()}`)) });
      const r = await runProbes(cli, opts({ exec: leaky.exec, command: cli }));
      assert.equal(r.containment.status, "leaked", `${cli}: ${r.containment.detail}`);
      assert.equal(r.containment.policy, expected[cli], `${cli} policy`);
      assert.equal(r.verdict, expected[cli] === "read_allowed" ? "pass" : "fail", `${cli} leak verdict`);
      assert.equal(/permits reads by design/.test(r.containment.detail), expected[cli] === "read_allowed", `${cli} detail`);
      assert.equal(r.one_line_review.status, "ok", `${cli}: a leak must not skip the review probe`);
    }
  });

  // ---- momm run rev_20260913145408_oxfr reproductions ------------------------------
  // false-held-from-prompt-echo / echoed-prompt-passes-containment: a CLI wrapper that
  // echoes the request (which itself says "NO-TOOLS" and "cannot") is not a refusal.
  await test("echoed_prompt_is_not_held", async () => {
    // claude envelope with the prompt echoed in an unrelated field and no `result`.
    const echo = fakeExec({ reply: ({ promptText }) => ok(JSON.stringify({ type: "request", request: promptText })) });
    const r = await runProbes("claude", opts({ exec: echo.exec, command: "claude" }));
    assert.notEqual(r.containment.status, "held", r.containment.detail);
    assert.equal(r.containment.status, "unavailable"); assert.equal(r.containment.reason, "reply_not_isolated");
    assert.notEqual(r.verdict, "pass");
    // grok: the prompt sentence echoed inside the reply field itself.
    const inReply = fakeExec({ reply: ({ promptText }) => ok(envelope("grok", `You asked: ${promptText}`)) });
    const g = await runProbes("grok", opts({ exec: inReply.exec, command: "grok" }));
    assert.notEqual(g.containment.status, "held", g.containment.detail); assert.notEqual(g.verdict, "pass");
    // codex prints the prompt (containing NO-TOOLS) then a non-refusal answer.
    const codex = fakeExec({ reply: ({ promptText }) => ok(`user\n${promptText}\ncodex\nI looked and found nothing interesting.\ntokens used: 42`) });
    const c = await runProbes("codex", opts({ exec: codex.exec, command: "codex" }));
    assert.notEqual(c.containment.status, "held", c.containment.detail); assert.equal(c.containment.reason, "no_reply");
    // ... but the same layout with a real NO-TOOLS answer after the echo is held.
    const codexHeld = fakeExec({ reply: ({ promptText }) => ok(`user\n${promptText}\ncodex\nNO-TOOLS\ntokens used: 42`) });
    assert.equal((await runProbes("codex", opts({ exec: codexHeld.exec, command: "codex" }))).containment.status, "held");
    // An unrelated error mentioning "cannot" is not a refusal either.
    const err = fakeExec({ reply: () => ({ code: 1, stdout: "", stderr: "Error: cannot open config: EACCES" }) });
    const e = await runProbes("claude", opts({ exec: err.exec, command: "claude" }));
    assert.notEqual(e.containment.status, "held", e.containment.detail); assert.notEqual(e.verdict, "pass");
    // Long essays are not a tight refusal even when they mention tools.
    const essay = fakeExec({ reply: () => ok(envelope("antigravity", `${"I would love to help with this request. ".repeat(20)}Note that no tools are configured.`)) });
    assert.notEqual((await runProbes("antigravity", opts({ exec: essay.exec, command: "antigravity" }))).containment.status, "held");
  });
  await test("windows_tree_kill_is_named_by_its_absolute_system32_path", async () => {
    // Gate rev_20260919023950_h6hn: probes run inside projects that are not trusted. Older libuv
    // (Node 18/20) looks for a bare command name in the working directory before PATH, so the tree
    // killer is always named by its absolute path, as process-scope.mjs already does.
    if (process.platform !== "win32") return; // POSIX kills the process group; no command is launched
    const { EventEmitter } = await import("node:events");
    const childProcess = (await import("node:child_process")).default, { syncBuiltinESMExports } = await import("node:module");
    const original = { spawn: childProcess.spawn, spawnSync: childProcess.spawnSync };
    const killers = [];
    childProcess.spawn = () => { const child = new EventEmitter(); const pipe = () => Object.assign(new EventEmitter(), { destroy() {} }); child.pid = 424242; child.kill = () => false; child.stdout = pipe(); child.stderr = pipe(); child.stdin = Object.assign(new EventEmitter(), { end() {} }); return child; };
    childProcess.spawnSync = (command, args) => { killers.push({ command, args }); return { status: 0 }; };
    syncBuiltinESMExports();
    try {
      const outcome = await defaultExec(process.execPath, ["-e", "0"], { cwd: fixture, timeout: 40, killGraceMs: 40, env: { PATH: "", SystemRoot: "D:\\WinRoot" } });
      assert.equal(outcome.timedOut, true);
      assert.equal(killers.length, 1); assert.equal(killers[0].command, "D:\\WinRoot\\System32\\taskkill.exe");
      assert.deepEqual(killers[0].args, ["/T", "/F", "/PID", "424242"]);
      killers.length = 0;
      await defaultExec(process.execPath, ["-e", "0"], { cwd: fixture, timeout: 40, killGraceMs: 40, env: { PATH: "" } });
      assert.match(killers[0].command, /^[A-Za-z]:\\.*\\System32\\taskkill\.exe$/, "still absolute without SystemRoot in the child environment");
    } finally { Object.assign(childProcess, original); syncBuiltinESMExports(); }
  });
  await test("default_exec_settles_even_when_the_child_never_reports_exit", async () => {
    // Gate rev_20260919000938_1nkh: the deadline must hold even if the kill does not produce an exit
    // (a child the OS will not end, a refused taskkill). A synthetic child that never exits stands in.
    const { EventEmitter } = await import("node:events");
    const childProcess = (await import("node:child_process")).default, { syncBuiltinESMExports } = await import("node:module");
    const original = childProcess.spawn;
    const destroyed = [];
    childProcess.spawn = () => {
      const child = new EventEmitter();
      const pipe = (name) => Object.assign(new EventEmitter(), { destroy: () => destroyed.push(name) });
      child.pid = undefined; child.kill = () => false;
      child.stdout = pipe("stdout"); child.stderr = pipe("stderr"); child.stdin = Object.assign(new EventEmitter(), { end() {} });
      return child;
    };
    syncBuiltinESMExports();
    try {
      const started = Date.now();
      const outcome = await Promise.race([
        defaultExec(process.execPath, ["-e", "0"], { cwd: fixture, timeout: 60, killGraceMs: 80 }),
        new Promise((resolve) => setTimeout(() => resolve("HUNG"), 3000)),
      ]);
      assert.notEqual(outcome, "HUNG", "defaultExec never settled after its deadline");
      assert.equal(outcome.timedOut, true); assert.equal(outcome.error?.code, "ETIMEDOUT"); assert.equal(outcome.code, -1);
      assert(Date.now() - started < 2000);
      assert.deepEqual(destroyed.sort(), ["stderr", "stdout"], "pipes are released so nothing keeps the caller waiting");
    } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
  });
  await test("record_probe_never_writes_through_a_link", () => {
    // Gate rev_20260919000938_1nkh: a checkout can ship .ensemble_reviews or probes.jsonl as a link.
    // A real link where the platform allows one; otherwise lstat is made to report one.
    const result = { cli: "codex", verdict: "pass" };
    for (const which of ["file", "dir"]) {
      const root = fs.mkdtempSync(path.join(fixture, `link-${which}-`)), outside = fs.mkdtempSync(path.join(fixture, "outside-"));
      const sentinel = path.join(outside, "sentinel.txt"); fs.writeFileSync(sentinel, "UNCHANGED");
      const dir = path.join(root, ".ensemble_reviews"), file = path.join(root, PROBES_FILE), linked = which === "file" ? file : dir;
      let real = true;
      try { if (which === "file") { fs.mkdirSync(dir); fs.symlinkSync(sentinel, file, "file"); } else fs.symlinkSync(outside, dir, process.platform === "win32" ? "junction" : "dir"); }
      catch (e) { if (e.code !== "EPERM") throw e; real = false; fs.writeFileSync(file, ""); }
      const lstat = fs.lstatSync;
      if (!real) fs.lstatSync = (p, ...rest) => { const st = lstat(p, ...rest); if (path.resolve(String(p)) === linked) st.isSymbolicLink = () => true; return st; };
      try { assert.throws(() => recordProbe(root, result), /link/); } finally { fs.lstatSync = lstat; }
      assert.equal(fs.readFileSync(sentinel, "utf8"), "UNCHANGED");
      assert.deepEqual(fs.readdirSync(outside), ["sentinel.txt"], "nothing was written through the link");
      if (!real) assert.equal(fs.readFileSync(file, "utf8"), "");
    }
    // Gate rev_20260919023950_h6hn: the path can be redirected AFTER the link check. The descriptor
    // that was opened must be the ledger inside the (still unlinked) folder, or nothing is appended.
    const root = fs.mkdtempSync(path.join(fixture, "link-swap-")), outside = fs.mkdtempSync(path.join(fixture, "outside-"));
    const sentinel = path.join(outside, "sentinel.txt"); fs.writeFileSync(sentinel, "UNCHANGED");
    recordProbe(root, result); // an ordinary first record
    const ledger = path.join(root, PROBES_FILE), before = fs.readFileSync(ledger, "utf8"), open = fs.openSync;
    fs.openSync = function (p, ...rest) { return open.call(fs, path.resolve(String(p)) === ledger ? sentinel : p, ...rest); };
    try { assert.throws(() => recordProbe(root, result), /changed while it was being opened/); } finally { fs.openSync = open; }
    assert.equal(fs.readFileSync(sentinel, "utf8"), "UNCHANGED"); assert.equal(fs.readFileSync(ledger, "utf8"), before);
    recordProbe(root, result); assert.equal(fs.readFileSync(ledger, "utf8").trim().split("\n").length, 2);
  });
  await test("final_error_envelope_never_falls_through_to_an_earlier_reply", () => {
    // Gate rev_20260919000938_1nkh: the last envelope decides. An error envelope that carries no
    // string reply (result:null, or no reply field at all) must not expose an earlier answer.
    const earlier = JSON.stringify({ type: "result", result: "NO-TOOLS", is_error: false });
    for (const last of [{ is_error: true, result: null }, { is_error: true, type: "error" }, { type: "error" }]) {
      const iso = isolateReply("claude", ok(`${earlier}\n${JSON.stringify(last)}`), "prompt");
      assert.equal(iso.isolated, false, JSON.stringify(last)); assert.equal(iso.reply, ""); assert.match(iso.detail, /provider reported an error/);
    }
    // An unrelated trailing object (no reply field, not an error) is still skipped, as before.
    assert.equal(isolateReply("claude", ok(`${earlier}\n${JSON.stringify({ type: "stats", tokens: 3 })}`), "prompt").reply, "NO-TOOLS");
    assert.equal(isolateReply("claude", ok(JSON.stringify({ type: "result", result: "boom", is_error: true })), "prompt").detail, "provider reported an error: boom");
  });
  await test("isolate_and_classify_reply_per_cli", () => {
    const prompt = canaryPrompt("/x/canary.txt");
    assert.deepEqual(isolateReply("claude", ok(envelope("claude", "NO-TOOLS")), prompt).reply, "NO-TOOLS");
    assert.equal(isolateReply("grok", ok(envelope("grok", " NO-TOOLS\n")), prompt).reply.trim(), "NO-TOOLS");
    assert.equal(isolateReply("antigravity", ok(envelope("antigravity", "no tools here")), prompt).reply, "no tools here");
    assert.equal(isolateReply("gemini", ok(envelope("gemini", "NO-TOOLS")), prompt).reply, "NO-TOOLS");
    assert.equal(isolateReply("grok", ok(JSON.stringify({ result: "NO-TOOLS" })), prompt).isolated, false, "wrong envelope field is not a reply");
    assert.equal(isolateReply("claude", ok(JSON.stringify({ type: "result", is_error: true, result: "NO-TOOLS" })), prompt).isolated, false, "is_error is a provider error, not a reply");
    assert.equal(isolateReply("codex", ok(`user\n${prompt}\ncodex\nNO-TOOLS\ntokens used: 9`), prompt).reply, "NO-TOOLS");
    assert.equal(isolateReply("copilot", ok(`${prompt}\n\nNO-TOOLS\n`), prompt).reply, "NO-TOOLS");
    assert.equal(isolateReply("copilot", ok("\u001b[1mNO-TOOLS\u001b[0m\u001b]0;title\u0007"), prompt).reply, "NO-TOOLS", "ANSI colour and OSC sequences are stripped");
    assert.equal(classifyReply("NO-TOOLS", prompt), "no_tools");
    assert.equal(classifyReply("I cannot read files in this session.", prompt), "refusal");
    assert.equal(classifyReply(prompt, prompt), "echo");
    assert.equal(classifyReply(`Sure: ${prompt}`, prompt), "echo");
    assert.equal(classifyReply("I looked and found nothing interesting.", prompt), null);
    assert.equal(classifyReply("", prompt), "empty");
    assert.equal(classifyReply(`${"blah ".repeat(200)} cannot`, prompt), "long");
  });
  // unsupported-launcher-verdict-override / unsupported-launcher-scored-fail
  await test("unsupported_launcher_is_unavailable_not_fail", async () => {
    const shim = { code: -1, stdout: "", stderr: "Unsupported Windows launcher for claude: shell shim refused", error: Object.assign(new Error("shim"), { code: "MOMM_UNSUPPORTED_LAUNCHER" }) };
    const f = fakeExec({ reply: () => ok("NO-TOOLS"), versionFail: shim });
    const r = await runProbes("claude", opts({ exec: f.exec, command: "claude" }));
    assert.equal(r.verdict, "unavailable"); assert.equal(r.containment.reason, "unsupported_launcher"); assert.equal(r.one_line_review.reason, "unsupported_launcher");
    assert.equal(f.calls.length, 1);
    // ...and when the refusal only surfaces on the containment call (PATH changed between calls).
    const late = fakeExec({ reply: () => shim });
    const l = await runProbes("claude", opts({ exec: late.exec, command: "claude" }));
    assert.equal(l.verdict, "unavailable"); assert.equal(l.containment.reason, "unsupported_launcher"); assert.equal(late.calls.length, 2, "review skipped");
  });
  // timeout-leaves-descendants-running
  await test("timeout_kills_the_whole_process_tree", async () => {
    // On Windows the grandchild breaks away (detached) so it is outside libuv's kill-on-close job object and
    // only a tree kill reaches it. On POSIX a reviewer's worker stays in the probe's process group (a setsid'd
    // descendant is outside any group kill by definition), so the grandchild is spawned attached and must die
    // with the group SIGKILL. It exits on
    // its own after 20s as a safety net should the tree kill fail.
    const script = "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),20000); setInterval(()=>{},1000)'],{stdio:'ignore',detached: process.platform === 'win32'}); child.unref(); process.stdout.write(String(child.pid)+'\\n'); setInterval(()=>{},1000);";
    const result = await defaultExec(process.execPath, ["-e", script], { timeout: 2500, cwd: fixture, env: process.env });
    const pid = Number(String(result.stdout).trim());
    try {
      assert.equal(result.timedOut, true, "must time out"); assert(pid > 0, "grandchild pid captured");
      await new Promise(r => setTimeout(r, 300));
      assert.throws(() => process.kill(pid, 0), "grandchild must be dead after the timeout");
    } finally { try { process.kill(pid); } catch {} }
  });
  // relative-temp-root-skips-cleanup / cleanup-guard-path-mismatch / relative-tmpdir-cleanup-leak
  await test("relative_or_unnormalized_tmpdir_still_cleans_up", async () => {
    const prev = process.cwd(); process.chdir(fixture);
    try {
      for (const rel of ["rel-root", path.join("rel-root", "..", "rel-root"), "."]) {
        fs.mkdirSync(path.resolve(rel), { recursive: true });
        const f = fakeExec({ reply: () => ok("NO-TOOLS") });
        const r = await runProbes("codex", opts({ tmpdir: rel, exec: f.exec, command: "codex" }));
        assert.equal(r.verdict, "pass");
        assert.deepEqual(fs.readdirSync(path.resolve(rel)).filter(n => n.startsWith("momm-probe-")), [], `tmpdir ${rel}: probe directory leaked`);
      }
    } finally { process.chdir(prev); }
  });
  // envelope-findings-shortcircuit
  await test("empty_envelope_findings_do_not_count_as_a_review", async () => {
    const inner = findFindings(`{"findings":[],"result":${JSON.stringify(REVIEW)}}`);
    assert.equal(inner?.findings.length, 1, "must unwrap past the empty envelope array");
    assert.equal(findFindings('{"findings":[]}'), null, "zero findings and no verdict+summary is not a review");
    assert.equal(findFindings('{"review_status":"complete","verdict":"APPROVE","findings":[]}'), null, "zero findings without a summary is not a review");
    assert.equal(findFindings('{"verdict":"APPROVE","summary":"Loop bound is inclusive; otherwise fine.","findings":[]}')?.verdict, "APPROVE");
    assert.equal(findFindings(`{"status":"SUCCESS","response":${JSON.stringify(JSON.parse(REVIEW))}}`)?.findings.length, 1, "object-nested review unwraps");
    const f = fakeExec({ reply: () => ok(envelope("claude", "NO-TOOLS")), review: ok('{"type":"result","findings":[],"result":"done"}') });
    const r = await runProbes("claude", opts({ exec: f.exec, command: "claude" }));
    assert.equal(r.one_line_review.status, "failed"); assert.equal(r.verdict, "fail");
  });
  // unauthorized-masks-refusal
  await test("refusal_wins_over_bare_unauthorized", async () => {
    const f = fakeExec({ reply: () => ok(envelope("grok", "unauthorized: file read denied by sandbox")) });
    const r = await runProbes("grok", opts({ exec: f.exec, command: "grok" }));
    assert.equal(r.containment.status, "held", r.containment.detail); assert.equal(r.verdict, "pass");
    assert.equal(AUTH_PATTERN.test("HTTP 401 unauthorized"), false, "bare unauthorized is not a login failure");
    assert.equal(AUTH_PATTERN.test("Unauthorized: please sign in with `grok login`"), true);
    assert.equal(AUTH_PATTERN.test("unauthenticated — run codex login"), true);
    assert.equal(unavailableReason({ code: 1, stdout: "", stderr: "401 unauthorized" }), null);
  });
  // rmsync-finally-throws / rmdir-exception-skips-sanitization
  await test("cleanup_failure_never_skips_verdict_or_token_scrub", async () => {
    const real = fs.rmSync; let thrown = 0;
    fs.rmSync = (...a) => { if (String(a[0]).includes("momm-probe-")) { thrown++; throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" }); } return real(...a); };
    let r;
    try {
      const f = fakeExec({ reply: ({ canary }) => ok(envelope("claude", `contents: ${canary}`)) });
      r = await runProbes("claude", opts({ exec: f.exec, command: "claude" }));
    } finally { fs.rmSync = real; }
    assert.equal(thrown, 1, "cleanup was attempted");
    assert.equal(r.verdict, "fail"); assert.equal(r.containment.status, "leaked");
    assert(!/MOMM-CANARY-/.test(JSON.stringify(r)), "token scrubbed even when cleanup throws");
    assert.match(String(r.cleanup_error ?? ""), /EBUSY/);
    for (const n of leftovers()) real(path.join(fixture, n), { recursive: true, force: true });
  });
  // windows-shim-aborts-path-walk
  await test("shim_directory_does_not_shadow_a_later_native_exe", () => {
    const shims = path.join(fixture, "shims"), native = path.join(fixture, "native");
    fs.mkdirSync(shims); fs.mkdirSync(native);
    fs.writeFileSync(path.join(shims, "claude.cmd"), "@echo off\r\n"); fs.writeFileSync(path.join(native, "claude.exe"), "MZ");
    const env = { PATH: [shims, native].join(path.delimiter) };
    const launch = windowsLauncher("claude", ["-p", "x"], env, "win32");
    assert.equal(launch.error, undefined, launch.error?.message); assert.equal(launch.command, path.join(native, "claude.exe"));
    const onlyShim = windowsLauncher("claude", [], { PATH: shims }, "win32");
    assert.equal(onlyShim.error?.code, "MOMM_UNSUPPORTED_LAUNCHER", "an unverifiable shim with no native fallback is still refused");
    assert.deepEqual(windowsLauncher("claude", ["a"], env, "linux"), { command: "claude", args: ["a"] });
  });
  await test("windows_launcher_never_hands_a_bare_name_to_spawn", () => {
    // Gate rev_20260919023950_h6hn: on Windows a bare name given to spawn can be looked up in the
    // working directory (older libuv), which for a probe is a project that is not trusted. A name
    // is resolved against the absolute PATH entries here, or refused as not installed.
    const bin = path.join(fixture, "launcher-bin"); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "grok.exe"), "MZ");
    const env = { PATH: [".", "relative\\dir", bin].join(path.delimiter) };
    assert.equal(windowsLauncher("grok", ["x"], env, "win32").command, path.join(bin, "grok.exe"));
    assert.equal(windowsLauncher("grok.exe", ["x"], env, "win32").command, path.join(bin, "grok.exe"), "a bare .exe name is resolved too");
    for (const missing of ["codex", "codex.exe"]) {
      const refused = windowsLauncher(missing, [], env, "win32");
      assert.equal(refused.command, undefined, "no bare fallback"); assert.equal(refused.error?.code, "ENOENT");
    }
    const cwdOnly = windowsLauncher("grok", [], { PATH: "." }, "win32");
    assert.equal(cwdOnly.error?.code, "ENOENT", "a relative PATH entry (the working directory) is never searched");
    const absolute = path.join(bin, "grok.exe");
    assert.deepEqual(windowsLauncher(absolute, ["x"], env, "win32"), { command: absolute, args: ["x"] });
  });
  // nan-timeout-from-argv
  await test("timeout_argument_is_validated", () => {
    assert.equal(parseTimeoutArg([]), 120_000);
    assert.equal(parseTimeoutArg(["claude", "--timeout", "5000"]), 5000);
    for (const bad of [["--timeout"], ["--timeout", "--record"], ["--timeout", "abc"], ["--timeout", "0"], ["--timeout", "-5"], ["--timeout", "1.5"], ["--timeout", "NaN"]]) assert.throws(() => parseTimeoutArg(bad), /--timeout/, bad.join(" "));
    // Gate rev_20260919023950_h6hn: a timer delay above 2^31-1 ms is silently run as 1 ms by Node, which
    // would kill every probe at once; an overflowing digit string becomes Infinity. Both are refused.
    for (const bad of ["2147483648", "3000000000", "1".repeat(400)]) assert.throws(() => parseTimeoutArg(["--timeout", bad]), /--timeout.*at most 2147483647/, bad.slice(0, 12));
    assert.equal(parseTimeoutArg(["--timeout", "2147483647"]), 2147483647);
  });
  // run-probes-drops-env-option
  await test("env_option_reaches_every_exec_call", async () => {
    const f = fakeExec({ reply: () => ok("NO-TOOLS") });
    await runProbes("codex", opts({ exec: f.exec, command: "codex", env: { ...process.env, MOMM_PROBE_CUSTOM: "1" } }));
    assert.equal(f.calls.length, 3);
    for (const c of f.calls) assert.equal(c.options.env?.MOMM_PROBE_CUSTOM, "1", `env dropped on ${c.args[0]}`);
  });
  await test("default_exec_scrubs_secrets_from_a_caller_env", async () => {
    const r = await defaultExec(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], { cwd: fixture, env: { ...process.env, MY_API_KEY: "x", MOMM_PROBE_CUSTOM: "1" }, timeout: 20_000 });
    const seen = JSON.parse(r.stdout);
    assert.equal(seen.MY_API_KEY, undefined); assert.equal(seen.MOMM_PROBE_CUSTOM, "1"); assert.equal(seen.NO_COLOR, "1"); assert.equal(r.code, 0);
  });
  await test("default_exec_scrub_matches_the_dispatchers_forbidden_names", async () => {
    // Gate rev_20260919000938_1nkh: a probe child must not see any credential the review dispatcher
    // withholds. The list is read from the dispatcher so the two cannot drift; OAuth tokens stay.
    const dispatcherSource = fs.readFileSync(new URL("./multi-review.mjs", import.meta.url), "utf8");
    const from = dispatcherSource.indexOf("const FORBIDDEN_ENV_NAMES = new Set(["), to = dispatcherSource.indexOf("]);", from);
    assert(from >= 0 && to > from, "dispatcher forbidden list not found");
    const names = [...dispatcherSource.slice(from, to).matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);
    assert(names.includes("AWS_SECRET_ACCESS_KEY") && names.includes("ANTHROPIC_AUTH_TOKEN") && names.length >= 10);
    const planted = Object.fromEntries(names.map((name) => [name, "sentinel"]));
    const r = await defaultExec(process.execPath, ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env)))"], { cwd: fixture, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...planted, aws_session_token: "lowercase", CLAUDE_CODE_OAUTH_TOKEN: "allowed-oauth" }, timeout: 20_000 });
    const seen = JSON.parse(r.stdout).map((k) => k.toUpperCase());
    assert.deepEqual(names.filter((name) => seen.includes(name)), [], "forbidden names reached the child");
    assert(seen.includes("CLAUDE_CODE_OAUTH_TOKEN"), "OAuth tokens are preserved, as in the dispatcher");
  });

  // ==== Modality probes (1.16 E7) =====================================================
  // Fake registry: the effective matrix is whatever the test declares; every overlay write
  // is captured, and the baseline object handed in is checked afterwards for mutation.
  function fakeRegistry(routes) {
    const baseline = JSON.parse(JSON.stringify({ schema: "momm-capabilities/1", routes }));
    const entries = [];
    return { entries, baseline, effectiveCalls: [], effective(args) { this.effectiveCalls.push(args); return JSON.parse(JSON.stringify(baseline)); }, writeOverlayEntry(home, entry) { entries.push({ home, entry }); }, routable: c => !!c && ["verified", "documented"].includes(c.level) && !c.blocker };
  }
  // Where an input probe put its synthetic file, read the way each CLI receives it.
  function probeFileIn(args, input, cwd) {
    // codex -i <path> / copilot --attachment <path>: the path is its own argv element.
    const flagged = args.find((a, i) => i > 0 && ["-i", "--attachment"].includes(args[i - 1]) && /probe\.(?:png|pdf|wav)$/.test(a));
    if (flagged) return flagged;
    const blob = [...args, input].filter(s => typeof s === "string").join("\n");
    // claude / antigravity / grok: "... file at <path> with|and ..." — the path may contain spaces.
    const named = blob.match(/file at (.+?probe\.(?:png|pdf|wav)) (?:with|and)\b/);
    if (named) return named[1];
    // gemini: an @reference relative to the probe directory.
    const ref = blob.match(/(?:^|\s)@(probe\.(?:png|pdf|wav))\b/);
    return ref ? path.join(cwd ?? ".", ref[1]) : null;
  }
  // Fake CLI: finds the synthetic file the prompt (argv, stdin or @ref) names, checks it exists
  // while the CLI runs, and answers through `replies[kind]`; anything else goes to `generate`.
  function modalityExec({ replies = {}, version = ok("9.9.9 (fake)"), generate = null, log = [] } = {}) {
    const calls = [];
    const exec = async (command, args, options) => {
      calls.push({ command, args, options }); log.push(["exec", args.slice(0, 3).join(" ")]);
      if (args[0] === "--version") return version;
      const blob = [...args, options?.input].filter(s => typeof s === "string").join("\n");
      const p = /This is a capability probe/.test(blob) ? probeFileIn(args, options?.input, options?.cwd) : null;
      if (p) {
        const kind = path.extname(p).slice(1);
        assert.ok(fs.existsSync(p), `synthetic ${kind} must exist while the CLI runs: ${p}`);
        assert.ok(replies[kind], `unexpected ${kind} probe`);
        return replies[kind]({ args, options, path: p, bytes: fs.readFileSync(p) });
      }
      assert.ok(generate, `unexpected exec without a synthetic file: ${args.join(" ")}`);
      return generate({ args, options });
    };
    return { exec, calls, log };
  }
  const allInputs = level => ({ image: { level }, pdf: { level }, audio: { level }, video: { level } });
  const mopts = extra => ({ tmpdir: fixture, timeoutMs: 5000, home: path.join(fixture, "home"), ...extra });
  fs.mkdirSync(path.join(fixture, "home"), { recursive: true });
  const cellOf = (r, m) => r.cells.find(c => c.modality === m);
  const SENT = "WALNUT ORCHID 4471";

  await test("modality_verified_for_every_route_when_the_reply_describes_the_content", async () => {
    for (const cli of PROBE_CLIS) {
      const reg = fakeRegistry({ [cli]: { input: allInputs("documented") } });
      const f = modalityExec({ replies: { png: () => ok(envelope(cli, "Red.")), pdf: ({ options, args }) => ok(envelope(cli, `The page says: ${SENT}`)), wav: () => ok(envelope(cli, "A steady 440 Hz sine tone, one second long.")) } });
      const r = await runModalityProbes(cli, mopts({ registry: reg, exec: f.exec, command: cli, colour: "red", sentence: SENT }));
      assert.equal(r.schema, MODALITY_PROBE_SCHEMA); assert.equal(r.cli_version, "9.9.9"); assert.equal(r.consent, false);
      for (const m of ["image", "pdf", "audio"]) assert.equal(cellOf(r, m).status, "verified", `${cli} ${m}: ${cellOf(r, m).reason}`);
      assert.equal(cellOf(r, "video").status, "skipped"); assert.match(cellOf(r, "video").reason, /no synthetic/);
      assert.equal(r.verdict, "pass", JSON.stringify(r.summary));
      assert.equal(f.calls.length, 4, `${cli}: version + 3 input probes`);
      assert.equal(reg.entries.length, 3);
      for (const { home, entry } of reg.entries) { assert.equal(home, path.join(fixture, "home")); assert.equal(entry.level, "verified"); assert.equal(entry.blocker, null); assert.equal(entry.expires_at, null); assert.equal(entry.cli_version, "9.9.9"); assert.match(entry.machine_id, /^[0-9a-f]{32}$/); assert.equal(entry.direction, "input"); assert.equal(entry.evidence.probe, MODALITY_PROBE_SCHEMA); assert.match(entry.evidence.material_sha256, /^[0-9a-f]{64}$/); }
      assert.deepEqual(reg.effectiveCalls[0].installedVersions, { [cli]: "9.9.9" });
      assert.equal(cellOf(r, "image").material.bytes, syntheticPng("red").length);
      assert.equal(fs.readdirSync(fixture).filter(n => n.startsWith("momm-modality-")).length, 0, "private probe directory removed");
    }
  });
  // A generic answer never counts, whatever the baseline level was; the overlay keeps that
  // level (never `no`) and records probe_failed with no expiry (momm review rev_..._pd6p #2).
  await test("generic_reply_is_probe_failed_and_keeps_the_baseline_level", async () => {
    const reg = fakeRegistry({ claude: { input: { image: { level: "verified", evidence: { help_capture: "cli/help/claude.txt:164" } }, pdf: { level: "verified" }, audio: { level: "no" } } } });
    const before = JSON.stringify(reg.baseline);
    const f = modalityExec({ replies: { png: () => ok(envelope("claude", "I looked at the image and it seems to be a small square. Nothing else to report.")), pdf: () => ok(envelope("claude", "This appears to be a short one-page document.")) } });
    const r = await runModalityProbes("claude", mopts({ registry: reg, exec: f.exec, command: "claude", colour: "blue", sentence: SENT }));
    assert.equal(cellOf(r, "image").status, "probe_failed"); assert.match(cellOf(r, "image").reason, /generic reply: no colour named \(expected blue\)/);
    assert.equal(cellOf(r, "pdf").status, "probe_failed"); assert.match(cellOf(r, "pdf").reason, /generic reply: the planted sentence/);
    assert.equal(r.verdict, "fail");
    assert.equal(reg.entries.length, 2);
    for (const { entry } of reg.entries) { assert.equal(entry.level, "verified", "the baseline level is preserved on the entry"); assert.notEqual(entry.level, "no"); assert.equal(entry.blocker, "probe_failed"); assert.equal(entry.expires_at, null, "probe_failed holds until the next probe"); assert.match(entry.reason, /generic/); }
    assert.equal(JSON.stringify(reg.baseline), before, "the baseline object is never mutated");
    assert.equal(cellOf(r, "audio").status, "skipped"); assert.match(cellOf(r, "audio").reason, /level no/);
  });
  await test("wrong_colour_cannot_view_echo_and_toneless_replies_do_not_confirm", async () => {
    const material = { colour: "green", sentence: SENT };
    const prompt = inputProbePrompt("image", "/x/probe.png");
    assert.equal(confirmContent("image", "Green", material, prompt).confirmed, true);
    assert.equal(confirmContent("image", "It is mostly blue with a hint of green.", material, prompt).confirmed, false);
    assert.match(confirmContent("image", "Blue", material, prompt).reason, /named blue, expected green/);
    assert.match(confirmContent("image", "CANNOT-VIEW", material, prompt).reason, /CANNOT-VIEW/);
    assert.match(confirmContent("image", `Sure: ${prompt}`, material, prompt).reason, /echoed/);
    assert.equal(confirmContent("image", "", material, prompt).reason, "empty reply");
    assert.equal(confirmContent("pdf", `text: walnut orchid   4471 end`, material, "").confirmed, true, "case and whitespace insensitive");
    assert.equal(confirmContent("pdf", "WALNUT 4471", material, "").confirmed, false);
    assert.equal(confirmContent("audio", "A short beep.", material, "").confirmed, true);
    assert.equal(confirmContent("audio", "I processed the file successfully.", material, "").confirmed, false);
    assert.equal(confirmContent("image", "A red square", { colour: "red" }, inputProbePrompt("image", "/p/probe.png")).confirmed, true, "the prompt itself names no colour");
    for (const m of ["image", "pdf", "audio"]) for (const c of Object.keys(PROBE_COLOURS)) assert.equal(new RegExp(`\\b${c}\\b`, "i").test(inputProbePrompt(m, "/p/probe.png")), false, `${m} prompt must not name ${c}`);
  });
  await test("timeout_and_unisolated_reply_are_probe_failed", async () => {
    const reg = fakeRegistry({ grok: { input: { image: { level: "verified" }, pdf: { level: "verified" } } } });
    const f = modalityExec({ replies: { png: () => ({ code: null, stdout: "", stderr: "", timedOut: true, error: { code: "ETIMEDOUT" } }), pdf: () => ok(JSON.stringify({ result: "wrong envelope field" })) } });
    const r = await runModalityProbes("grok", mopts({ registry: reg, exec: f.exec, command: "grok" }));
    assert.equal(cellOf(r, "image").status, "probe_failed"); assert.match(cellOf(r, "image").reason, /timed out after 5 s/);
    assert.equal(cellOf(r, "pdf").status, "probe_failed"); assert.match(cellOf(r, "pdf").reason, /not isolated/);
    assert.equal(reg.entries.length, 2); assert.equal(reg.entries[0].entry.blocker, "probe_failed"); assert.equal(reg.entries[0].entry.expires_at, null);
  });
  await test("reply_naming_a_gate_records_that_blocker_with_its_expiry", async () => {
    const at = 1_800_000_000_000;
    // gemini: IneligibleTierError → auth_tier (7 d); copilot: monthly quota → quota (24 h); grok video: ZDR → zdr (7 d).
    const gem = fakeRegistry({ gemini: { input: { image: { level: "documented" } } } });
    const g = modalityExec({ replies: { png: () => ({ code: 1, stdout: "", stderr: "IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals" }) } });
    const gr = await runModalityProbes("gemini", mopts({ registry: gem, exec: g.exec, command: "gemini", now: () => at }));
    assert.equal(cellOf(gr, "image").status, "blocked"); assert.equal(cellOf(gr, "image").blocker, "auth_tier"); assert.match(cellOf(gr, "image").clearing_action, /Code Assist/);
    assert.equal(gem.entries[0].entry.blocker, "auth_tier"); assert.equal(gem.entries[0].entry.level, "documented"); assert.equal(gem.entries[0].entry.expires_at, new Date(at + 7 * 86_400_000).toISOString());
    const cop = fakeRegistry({ copilot: { input: { image: { level: "verified" } } } });
    const c = modalityExec({ replies: { png: () => ({ code: 1, stdout: "You have exceeded your monthly quota.", stderr: "" }) } });
    const cr = await runModalityProbes("copilot", mopts({ registry: cop, exec: c.exec, command: "copilot", now: () => at }));
    assert.equal(cellOf(cr, "image").blocker, "quota"); assert.equal(cop.entries[0].entry.expires_at, new Date(at + 24 * 3_600_000).toISOString());
    const grok = fakeRegistry({ grok: { input: {}, output: { video_gen: { level: "verified", harvest: "~/.grok/sessions/**/videos/*.mp4" } } } });
    const seen = [];
    const v = modalityExec({ generate: ({ args }) => { seen.push(args); return ok(envelope("grok", "Video generation tools are unavailable under zero data retention (ZDR). To enable, either turn off /privacy mode to disable ZDR or supply a user-hosted storage bucket.")); } });
    const vr = await runModalityProbes("grok", mopts({ registry: grok, exec: v.exec, command: "grok", consent: true, disclose: () => {}, now: () => at }));
    const video = cellOf(vr, "video_gen");
    assert.equal(video.status, "blocked"); assert.equal(video.blocker, "zdr"); assert.match(video.clearing_action, /privacy|bucket/);
    assert.equal(seen.length, 1, "the gate is learned from one request"); assert.ok(seen[0].some(a => /image_to_video/.test(a)) && seen[0].some(a => /probe\.png/.test(a)), "video probe uses the synthetic PNG");
    assert.equal(grok.entries[0].entry.blocker, "zdr"); assert.equal(grok.entries[0].entry.level, "verified"); assert.equal(grok.entries[0].entry.expires_at, new Date(at + 7 * 86_400_000).toISOString());
    assert.equal(blockerInText('{"denied_actions":[{"action":"run_command","display_name":"RunCommand"}]}'), "allowlist");
    assert.equal(blockerInText('{"denied_actions":[{"action":"read_file","display_name":"ViewFile"}]}'), "missing_flag");
    assert.equal(clearingAction("reprobe").includes("--modalities"), true); assert.equal(clearingAction("nonsense"), null);
    assert.equal(expiresAtFor("probe_failed", at), null);
  });
  await test("version_is_the_printed_semver_whatever_the_exit_code", async () => {
    // Live 2026-09-14: gemini 0.59 exited non-zero from --version while printing "0.59.0"; the
    // whole probe then recorded "cli version unknown: entry not written" and no blocker reached
    // the overlay. The printed semver is the version; the exit code is recorded beside it.
    const reg = fakeRegistry({ gemini: { input: allInputs("documented") } });
    const tier = () => ({ code: 1, stdout: "", stderr: "Error authenticating: IneligibleTierError: This client is no longer eligible" });
    const f = modalityExec({ version: { code: 1, stdout: "0.59.0\n", stderr: "Warning: True color (24-bit) support not detected." }, replies: { png: tier, pdf: tier, wav: tier } });
    const r = await runModalityProbes("gemini", mopts({ registry: reg, exec: f.exec, command: "gemini" }));
    assert.equal(r.cli_version, "0.59.0"); assert.equal(r.version_exit_code, 1);
    assert.equal(cellOf(r, "image").status, "blocked"); assert.equal(cellOf(r, "image").blocker, "auth_tier");
    assert.equal(cellOf(r, "image").overlay_written, true, "a blocker seen live must reach the overlay even when --version exits non-zero");
    assert.ok(reg.entries.some(({ entry }) => entry.route === "gemini" && entry.cli_version === "0.59.0" && entry.blocker === "auth_tier"), JSON.stringify(reg.entries[0]));
    const none = modalityExec({ version: { code: 1, stdout: "", stderr: "unknown option --version" }, replies: { png: tier, pdf: tier, wav: tier } });
    const n = await runModalityProbes("gemini", mopts({ registry: reg, exec: none.exec, command: "gemini" }));
    assert.equal(n.cli_version, null, "no semver printed: still unknown");
    assert.equal(cellOf(n, "image").overlay_written, false, "nothing binds to an unknown version");
  });

  await test("not_logged_in_is_unavailable_and_writes_nothing", async () => {
    const reg = fakeRegistry({ grok: { input: allInputs("verified"), output: { image_gen: { level: "verified", harvest: "~/.grok/**/*.jpg" } } } });
    const f = modalityExec({ replies: { png: () => ({ code: 1, stdout: "", stderr: "Error: Not signed in. Run `grok login` to authenticate." }) } });
    const r = await runModalityProbes("grok", mopts({ registry: reg, exec: f.exec, command: "grok", consent: true, disclose: () => {} }));
    assert.equal(cellOf(r, "image").status, "unavailable"); assert.equal(cellOf(r, "image").reason, "not_logged_in");
    assert.equal(cellOf(r, "pdf").status, "unavailable"); assert.equal(cellOf(r, "image_gen").status, "unavailable");
    assert.equal(f.calls.length, 2, "version + first probe; nothing more is sent once the login is known to be missing");
    assert.equal(reg.entries.length, 0, "environment problems are not evidence about a cell"); assert.equal(r.verdict, "unavailable");
    const missing = modalityExec({ version: { code: -1, stdout: "", stderr: "spawn grok ENOENT", error: { code: "ENOENT" } } });
    const readsBefore = reg.effectiveCalls.length;
    const m = await runModalityProbes("grok", mopts({ registry: reg, exec: missing.exec, command: "grok" }));
    assert.equal(m.reason, "not_installed"); assert.equal(m.verdict, "unavailable"); assert.equal(reg.effectiveCalls.length, readsBefore, "no registry read for an absent CLI");
  });
  await test("generation_probe_ignores_a_file_that_was_already_there", async () => {
    // Gate rev_20260919000938_1nkh: only a file this request produced verifies a generative cell. A
    // matching file that existed before the request, even one whose time stamp is not older than
    // the request (same second, clock skew), is not evidence; one rewritten by the request is.
    const home = path.join(fixture, "stale-gen-home");
    const routes = { codex: { input: {}, output: { image_gen: { level: "documented", harvest: "~/.codex/generated_images/**/*.png", mime: "image/png" } } } };
    const stale = path.join(home, ".codex", "generated_images", "earlier", "exec-old.png");
    fs.mkdirSync(path.dirname(stale), { recursive: true }); fs.writeFileSync(stale, syntheticPng("red"));
    const ahead = new Date(Date.now() + 60_000); fs.utimesSync(stale, ahead, ahead);
    const reg = fakeRegistry(routes);
    const idle = modalityExec({ replies: {}, generate: () => ok("Done.") });
    const r = await runModalityProbes("codex", mopts({ home, registry: reg, exec: idle.exec, command: "codex", consent: true, inputs: false, disclose: () => {} }));
    const cell = cellOf(r, "image_gen");
    assert.equal(cell.status, "probe_failed", JSON.stringify(cell)); assert.deepEqual(cell.harvested, []);
    assert.equal(reg.entries.some(e => e.entry.level === "verified"), false, "no verified overlay from a stale file");
    const rewriting = modalityExec({ replies: {}, generate: () => { fs.writeFileSync(stale, syntheticPng("blue")); return ok("Done."); } });
    const again = await runModalityProbes("codex", mopts({ home, registry: fakeRegistry(routes), exec: rewriting.exec, command: "codex", consent: true, inputs: false, disclose: () => {} }));
    assert.equal(cellOf(again, "image_gen").status, "verified", cellOf(again, "image_gen").reason);
  });
  // Consent gate (spec + review #1): without --consent the generative cell is listed with its
  // disclosure and nothing is sent; with consent, exactly one request per UNBLOCKED cell, the
  // disclosure printed before it; a blocked cell is skipped with its clearing action and no exec.
  await test("generative_probes_need_consent_skip_blocked_cells_and_disclose_before_sending", async () => {
    const home = path.join(fixture, "gen-home"); fs.mkdirSync(home, { recursive: true });
    const routes = { codex: { input: { image: { level: "verified" } }, output: { image_gen: { level: "documented", harvest: "~/.codex/generated_images/**/*.png", mime: "image/png" } } } };
    const listed = generativeCells("codex", routes.codex);
    assert.equal(listed.length, 1); assert.equal(listed[0].blocked, false); assert.match(listed[0].disclosure, /quota is spent/); assert.match(listed[0].disclosure, /\.codex\/generated_images/); assert.ok(listed[0].disclosure.includes(listed[0].prompt), "the exact prompt is disclosed");
    const refused = fakeRegistry(routes);
    const noConsent = modalityExec({ replies: { png: () => ok("Red") } });
    const r0 = await runModalityProbes("codex", mopts({ home, registry: refused, exec: noConsent.exec, command: "codex", colour: "red" }));
    assert.equal(cellOf(r0, "image_gen").status, "skipped"); assert.match(cellOf(r0, "image_gen").reason, /consent_required/); assert.equal(cellOf(r0, "image_gen").disclosure, listed[0].disclosure);
    assert.equal(noConsent.calls.length, 2, "version + image; no generation request without consent"); assert.equal(refused.entries.length, 1);
    // With consent: the fake writes the file where the registry glob looks, so harvest finds and hashes it.
    const log = [];
    const reg = fakeRegistry(routes);
    const generated = path.join(home, ".codex", "generated_images", "sess-1", "exec-abc.png");
    const f = modalityExec({ log, replies: { png: () => ok("Red") }, generate: ({ args, options }) => { assert.ok(/image generation tool/.test(options.input) && args.includes("workspace-write")); fs.mkdirSync(path.dirname(generated), { recursive: true }); fs.writeFileSync(generated, syntheticPng("blue")); return ok(`Wrote ${generated}`); } });
    const r = await runModalityProbes("codex", mopts({ home, registry: reg, exec: f.exec, command: "codex", consent: true, colour: "red", now: Date.now, disclose: text => log.push(["disclose", text]) }));
    const gen = cellOf(r, "image_gen");
    assert.equal(gen.status, "verified", gen.reason); assert.equal(gen.harvested.length, 1); assert.equal(gen.harvested[0].path, generated); assert.equal(gen.harvested[0].sha256, sha256(syntheticPng("blue")));
    const disclosed = log.findIndex(e => e[0] === "disclose"), sent = log.findIndex((e, i) => e[0] === "exec" && i > disclosed);
    assert.ok(disclosed >= 0 && sent > disclosed, `disclosure must precede the request: ${JSON.stringify(log)}`);
    assert.equal(log.filter(e => e[0] === "disclose").length, 1); assert.equal(f.calls.length, 3, "version + image + one generation");
    const entry = reg.entries.find(e => e.entry.modality === "image_gen").entry;
    assert.equal(entry.level, "verified"); assert.equal(entry.direction, "output"); assert.deepEqual(entry.evidence.harvested_sha256, [sha256(syntheticPng("blue"))]);
    assert.equal(r.verdict, "pass");
    // Blocked cell: verified image_gen under zdr is skipped, its clearing action shown, and exec never called for it.
    const blockedRoutes = { grok: { input: {}, output: { image_gen: { level: "verified", blocker: "zdr", harvest: "~/.grok/sessions/**/images/*.jpg" }, video_gen: { level: "documented", harvest: "~/.grok/sessions/**/videos/*.mp4" } } } };
    const cells = generativeCells("grok", blockedRoutes.grok);
    assert.equal(cells.find(c => c.cell === "image_gen").blocked, true); assert.equal(cells.find(c => c.cell === "image_gen").disclosure, null);
    assert.equal(routeDisclosure(cells).includes("image_gen"), false); assert.ok(routeDisclosure(cells).includes("video_gen"));
    const breg = fakeRegistry(blockedRoutes);
    const sentArgs = [];
    const b = modalityExec({ generate: ({ args }) => { sentArgs.push(args.join(" ")); const dir = path.join(home, ".grok", "sessions", "s", "videos"); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "1.mp4"), "mp4"); return ok(envelope("grok", "done")); } });
    const br = await runModalityProbes("grok", mopts({ home, registry: breg, exec: b.exec, command: "grok", consent: true, now: Date.now, disclose: () => {} }));
    assert.equal(cellOf(br, "image_gen").status, "skipped"); assert.equal(cellOf(br, "image_gen").blocker, "zdr"); assert.match(cellOf(br, "image_gen").reason, /not sent/); assert.match(cellOf(br, "image_gen").clearing_action, /privacy/);
    assert.equal(sentArgs.length, 1, "exactly one request, for the unblocked cell"); assert.match(sentArgs[0], /image_to_video/); assert.equal(sentArgs.some(a => /image_gen tool/.test(a)), false);
    assert.equal(cellOf(br, "video_gen").status, "verified", cellOf(br, "video_gen").reason);
    assert.equal(breg.entries.length, 1); assert.equal(breg.entries[0].entry.modality, "video_gen");
    // Consent but no file harvested → probe_failed, level kept.
    const dry = fakeRegistry(routes);
    const d = modalityExec({ replies: { png: () => ok("Red") }, generate: () => ok("I could not generate anything.") });
    const dr = await runModalityProbes("codex", mopts({ home: path.join(fixture, "empty-home"), registry: dry, exec: d.exec, command: "codex", consent: true, colour: "red", now: Date.now, disclose: () => {} }));
    assert.equal(cellOf(dr, "image_gen").status, "probe_failed"); assert.match(cellOf(dr, "image_gen").reason, /no hashed file matched/);
    assert.equal(dry.entries.find(e => e.entry.modality === "image_gen").entry.level, "documented");
  });
  await test("modality_records_share_the_ledger_but_never_displace_a_canary_verdict", async () => {
    const root = path.join(fixture, "modality-root"); fs.mkdirSync(root);
    const canary = fakeExec({ reply: () => ok("NO-TOOLS") });
    const c = await runProbes("codex", opts({ exec: canary.exec, command: "codex", now: () => 1_700_000_000_000 }));
    const reg = fakeRegistry({ codex: { input: { image: { level: "verified" } } } });
    const f = modalityExec({ replies: { png: () => ok("Red") } });
    const m = await runModalityProbes("codex", mopts({ registry: reg, exec: f.exec, command: "codex", colour: "red", now: () => 1_700_000_500_000 }));
    recordProbe(root, c); recordProbe(root, m);
    const lines = fs.readFileSync(path.join(root, PROBES_FILE), "utf8").trim().split("\n").map(l => JSON.parse(l));
    assert.equal(lines.length, 2); assert.equal(lines[1].schema, MODALITY_PROBE_SCHEMA); assert.equal(lines[1].cells[0].status, "verified");
    assert.equal(latestProbes(root).codex.schema, "momm-probe/1", "the newer modality record does not become the latest canary");
  });
  await test("a_modality_record_without_a_readable_time_never_holds_the_latest_slot", async () => {
    // Gate round five [30]: Date.parse("not-a-date") is NaN and every comparison with NaN is
    // false, so one malformed line stayed "latest" for that CLI whatever was recorded after it.
    const { latestModalityProbes } = await import("./probes.mjs");
    const root = path.join(fixture, "modality-latest-root"); fs.mkdirSync(path.join(root, path.dirname(PROBES_FILE)), { recursive: true });
    const row = (at, verdict) => JSON.stringify({ schema: MODALITY_PROBE_SCHEMA, cli: "codex", at, verdict, cells: [] });
    fs.writeFileSync(path.join(root, PROBES_FILE), [row("not-a-date", "malformed"), row("2026-09-01T10:00:00.000Z", "older"), row("2026-09-02T10:00:00.000Z", "newest"), row("also bad", "malformed")].join("\n") + "\n");
    assert.equal(latestModalityProbes(root).codex?.verdict, "newest");
    fs.writeFileSync(path.join(root, PROBES_FILE), row("not-a-date", "malformed") + "\n");
    assert.equal(latestModalityProbes(root).codex, undefined, "a record with no readable time is not a latest result at all");
  });
  await test("synthetic_material_is_well_formed", () => {
    const png = syntheticPng("yellow");
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a"); assert.equal(png.readUInt32BE(16), 64); assert.equal(png.readUInt32BE(20), 64);
    const idatLen = png.readUInt32BE(33); assert.equal(png.subarray(37, 41).toString("latin1"), "IDAT");
    const raw = zlib.inflateSync(png.subarray(41, 41 + idatLen)); assert.equal(raw.length, 64 * (1 + 64 * 3)); assert.deepEqual([raw[1], raw[2], raw[3]], PROBE_COLOURS.yellow); assert.equal(raw[0], 0);
    for (let y = 0; y < 64; y++) { const row = raw.subarray(y * 193, (y + 1) * 193); assert.equal(row[0], 0, `row ${y} filter`); for (let x = 0; x < 64; x++) assert.deepEqual([row[1 + x * 3], row[2 + x * 3], row[3 + x * 3]], PROBE_COLOURS.yellow, `pixel ${x},${y}`); }
    assert.equal(png.readUInt32BE(41 + idatLen), crc32(png.subarray(37, 41 + idatLen)), "IDAT crc");
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926, "crc32 check value");
    const pdf = syntheticPdf("AMBER (FALCON) 1234"), text = pdf.toString("latin1");
    assert.ok(text.startsWith("%PDF-1.4")); assert.ok(text.endsWith("%%EOF\n")); assert.ok(text.includes("(AMBER \\(FALCON\\) 1234) Tj"));
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)[1]); assert.equal(text.slice(startxref, startxref + 4), "xref");
    for (const m of text.matchAll(/(\d{10}) 00000 n/g)) assert.match(text.slice(Number(m[1]), Number(m[1]) + 8), /^\d 0 obj/);
    const wav = syntheticWav();
    assert.equal(wav.subarray(0, 4).toString(), "RIFF"); assert.equal(wav.subarray(8, 12).toString(), "WAVE"); assert.equal(wav.readUInt16LE(20), 1); assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt32LE(24), 8000); assert.equal(wav.readUInt16LE(34), 16); assert.equal(wav.readUInt32LE(40), 16000); assert.equal(wav.length, 16044);
    // The samples carry the 440 Hz tone, not silence: zero crossings ≈ 2 × 440 per second, peak ≈ 12000.
    let crossings = 0, peak = 0, previous = wav.readInt16LE(44);
    for (let i = 1; i < 8000; i++) { const s = wav.readInt16LE(44 + i * 2); if ((s >= 0) !== (previous >= 0)) crossings++; peak = Math.max(peak, Math.abs(s)); previous = s; }
    assert.ok(crossings >= 870 && crossings <= 890, `zero crossings ${crossings}`); assert.ok(peak >= 11500 && peak <= 12000, `peak ${peak}`);
    assert.match(syntheticSentence(), /^[A-Z]+ [A-Z]+ \d{4}$/); assert.notEqual(syntheticSentence(() => Buffer.from([3, 3, 0, 0])).split(" ")[0], syntheticSentence(() => Buffer.from([3, 3, 0, 0])).split(" ")[1]);
    assert.throws(() => syntheticPng("mauve"), /Unknown probe colour/);
  });
  await test("vectors_bind_the_file_and_codex_closes_the_variadic_image_flag", () => {
    const v = inputProbeVector("codex", { filePath: "F", projectDir: "D", prompt: "P" });
    assert.deepEqual(v.args, ["exec", "-i", "F", "--sandbox", "read-only", "--color", "never", "--skip-git-repo-check", "-"]); assert.equal(v.input, "P");
    assert.ok(inputProbeVector("claude", { filePath: "F", projectDir: "D", prompt: "P" }).args.includes("--add-dir"));
    // gemini @refs split on whitespace, so the reference is relative to the probe cwd: compared
    // against the same realpath-based computation, on real paths, never a literal (CI run 34785555601).
    const gdir = path.join(fixture, "gemini dir"); fs.mkdirSync(gdir, { recursive: true }); const gfile = path.join(gdir, "probe.png"); fs.writeFileSync(gfile, "x");
    const gref = inputProbeVector("gemini", { filePath: gfile, projectDir: gdir, prompt: "P" }).args.at(-1);
    assert.equal(gref, `@${relativeProbeRef(gfile, gdir)} P`); assert.equal(relativeProbeRef(gfile, gdir), "probe.png"); assert.ok(!/\s/.test(gref.slice(1).split(" ")[0]), "the reference carries no whitespace");
    assert.equal(relativeProbeRef(path.join(gdir, "sub", "probe.png"), gdir), "sub/probe.png", "forward slashes, whatever the platform");
    assert.equal(relativeProbeRef("F", "D"), "F", "fake paths fall back to the basename");
    assert.deepEqual(inputProbeVector("antigravity", { filePath: "F", projectDir: "D", prompt: "P" }).args, ["-p", "P", "--new-project", "--output-format", "json", "--mode=plan"]);
    const cp = inputProbeVector("copilot", { filePath: "F", projectDir: "D", prompt: "P" }).args; assert.equal(cp[cp.indexOf("--attachment") + 1], "F"); assert.equal(cp[cp.indexOf("--add-dir") + 1], "D");
    const gk = inputProbeVector("grok", { filePath: "F", projectDir: "D", prompt: "P" }).args; assert.equal(gk[gk.indexOf("--cwd") + 1], "D"); assert.ok(gk.includes("--disable-web-search"));
    assert.equal(generativeProbeVector("claude", "image_gen", { projectDir: "D" }), null); assert.equal(generativeProbeVector("codex", "video_gen", { projectDir: "D" }), null);
    assert.ok(generativeProbeVector("antigravity", "image_gen", { projectDir: "D" }).args.includes("--new-project"));
    assert.equal(generativeDisclosure("codex", "image_gen", { prompt: "P", harvest: "~/x/*.png" }), generativeDisclosure("codex", "image_gen", { prompt: "P", harvest: "~/x/*.png" }), "deterministic, so the Setup Center can demand the exact echo");
    assert.match(generativeDisclosure("codex", "image_gen", { prompt: "P", harvest: null }), /no harvest glob/);
    // Gate rev_20260919000938_1nkh: the video probe names a synthetic image by path, and that path is
    // only known once the temporary folder exists. The disclosure says what the placeholder stands
    // for instead of calling a prompt with a placeholder "exactly" the one sent.
    const video = generativeCells("grok", { input: {}, output: { video_gen: { level: "documented", harvest: "~/.grok/sessions/**/*.mp4" } } })[0];
    assert.ok(video.prompt.includes("<probe-dir>/probe.png"));
    assert.match(video.disclosure, /<probe-dir> stands for a temporary folder MOMM creates for this probe/);
    assert.match(video.disclosure, /the synthetic image MOMM writes there/);
    const image = generativeCells("codex", { input: {}, output: { image_gen: { level: "documented", harvest: "~/x/*.png" } } })[0];
    assert.ok(!image.disclosure.includes("<probe-dir>"), "a prompt without a placeholder keeps the plain wording");
  });
  await test("glob_harvest_matches_double_star_and_filters_by_mtime", () => {
    const home = path.join(fixture, "glob-home");
    for (const rel of ["a/b/c/x.png", "a/y.png", "a/b/z.jpg", "other/w.png"]) { fs.mkdirSync(path.join(home, ".gen", path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(home, ".gen", rel), rel); }
    assert.equal(expandHome("~/.gen/**/*.png", home), path.join(home, ".gen/**/*.png")); assert.equal(expandHome("/abs/x", home), "/abs/x"); assert.equal(expandHome("~user/x", home), "~user/x");
    const all = globFiles("~/.gen/**/*.png", { home }).map(f => path.relative(path.join(home, ".gen"), f.path).replaceAll("\\", "/")).sort();
    assert.deepEqual(all, ["a/b/c/x.png", "a/y.png", "other/w.png"]);
    assert.deepEqual(globFiles("~/.gen/a/*.png", { home }).map(f => path.basename(f.path)), ["y.png"]);
    assert.deepEqual(globFiles("~/.gen/a/*/z.jpg", { home }).map(f => path.basename(f.path)), ["z.jpg"]);
    assert.deepEqual(globFiles("~/.gen/**/q?.png", { home }), []);
    assert.deepEqual(globFiles("~/.gen/**/*.png", { home, since: Date.now() + 60_000 }), [], "older files are not harvested");
    assert.deepEqual(globFiles("~/nowhere/**/*.png", { home }), []);
    for (const f of globFiles("~/.gen/**/*.png", { home })) assert.equal(typeof f.bytes, "number");
  });
  await test("probe_args_parse_modalities_and_consent", () => {
    assert.deepEqual(parseProbeArgs(["grok", "--modalities", "--consent", "--timeout", "9000"]), { record: false, modalities: true, consent: true, timeoutMs: 9000, clis: ["grok"] });
    assert.deepEqual(parseProbeArgs([]).clis, [...PROBE_CLIS]); assert.equal(parseProbeArgs(["all", "--record"]).record, true);
    assert.throws(() => parseProbeArgs(["--bogus"]), /Unknown argument/);
    const entry = overlayEntryFor("codex", "1.0.0", "2026-09-13T00:00:00.000Z", { direction: "input", modality: "image", level_before: "documented", status: "probe_failed", blocker: "probe_failed", reason: "generic" }, { machineId: "m", loginIdentitySha256: "l" });
    assert.deepEqual([entry.level, entry.blocker, entry.expires_at, entry.machine_id, entry.login_identity_sha256, entry.cli_version], ["documented", "probe_failed", null, "m", "l", "1.0.0"]);
    assert.equal("level" in overlayEntryFor("codex", "1", "2026-09-13T00:00:00.000Z", { direction: "input", modality: "image", level_before: "no", status: "probe_failed" }), false, "no is never written");
  });

  // Against the REAL registry module (a temp home, so the machine's own overlay is untouched):
  // a failed probe lands as blocker probe_failed with the baseline level standing; a later
  // success clears it and upgrades the level; a blocked generative cell is never sent.
  // ---- momm gate review rev_20260913213315_o8c2 reproductions --------------------------------
  // generation-reprobe-lockout: probe_failed and reprobe are cleared BY a probe, so those cells
  // are sent under --consent; every other blocker is skipped with its clearing action.
  await test("generative_cells_under_probe_failed_or_reprobe_are_probed_other_blockers_skipped", async () => {
    const base = { level: "documented", harvest: "~/.grok/sessions/**/images/*.jpg", mime: "image/jpeg" };
    for (const blocker of ["probe_failed", "reprobe"]) { const [cell] = generativeCells("grok", { output: { image_gen: { ...base, blocker } } }); assert.equal(cell.blocked, false, `${blocker} must permit a recovery probe`); assert.equal(typeof cell.disclosure, "string"); assert.equal(cell.reprobe, true); }
    for (const blocker of ["zdr", "quota", "auth_tier", "allowlist", "missing_flag"]) { const [cell] = generativeCells("grok", { output: { image_gen: { ...base, blocker } } }); assert.equal(cell.blocked, true, blocker); assert.equal(cell.disclosure, null); }
    const home = path.join(fixture, "reprobe-home"); fs.mkdirSync(home, { recursive: true });
    const reg = fakeRegistry({ grok: { input: {}, output: { image_gen: { ...base, blocker: "reprobe" }, video_gen: { level: "documented", blocker: "zdr", harvest: "~/.grok/sessions/**/*.mp4" } } } });
    const sent = [];
    const f = modalityExec({ generate: ({ args }) => { sent.push(args.join(" ")); const dir = path.join(home, ".grok", "sessions", "s", "images"); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "1.jpg"), "jpg"); return ok(envelope("grok", "done")); } });
    const r = await runModalityProbes("grok", mopts({ home, registry: reg, exec: f.exec, command: "grok", consent: true, now: Date.now, disclose: () => {} }));
    assert.equal(cellOf(r, "image_gen").status, "verified", cellOf(r, "image_gen").reason);
    assert.equal(sent.length, 1); assert.match(sent[0], /image_gen tool/);
    assert.equal(cellOf(r, "video_gen").status, "skipped"); assert.equal(cellOf(r, "video_gen").blocker, "zdr");
    const entry = reg.entries.find(e => e.entry.modality === "image_gen").entry; assert.equal(entry.level, "verified"); assert.equal(entry.blocker, null, "the recovery probe clears the blocker");
  });
  // audio-refusal-verifies-capability: a refusal defeats every content pattern, not only CANNOT-VIEW.
  await test("refusals_never_confirm_any_modality", () => {
    for (const reply of ["Please note that I cannot access this file.", "I am unable to listen to audio files.", "The frequency of the tone could not be determined because the file read was denied.", "Sorry, I don't have access to audio; no tone here."]) assert.equal(confirmContent("audio", reply, { frequency: 440 }, "").confirmed, false, reply);
    assert.equal(confirmContent("image", "I cannot view the image, but red is a common colour.", { colour: "red" }, "").confirmed, false);
    assert.equal(confirmContent("pdf", `I could not open the file. Was it ${SENT}?`, { sentence: SENT }, "").confirmed, false);
    assert.equal(confirmContent("audio", "A steady 440 Hz sine tone.", { frequency: 440 }, "").confirmed, true, "control");
  });
  // generation-verifies-unrelated-artifacts: only a hashed file produced AFTER this request
  // counts, and an isolated refusal never verifies on files alone.
  await test("generation_counts_only_hashed_files_produced_by_this_request", async () => {
    const routes = { codex: { input: {}, output: { image_gen: { level: "documented", harvest: "~/.codex/generated_images/**/*.png" } } } };
    const home = path.join(fixture, "unrelated-home"), dir = path.join(home, ".codex", "generated_images", "old"); fs.mkdirSync(dir, { recursive: true });
    const stale = path.join(dir, "exec-old.png"); fs.writeFileSync(stale, syntheticPng("red")); const t = (Date.now() - 1000) / 1000; fs.utimesSync(stale, t, t);
    const gen = extra => mopts({ home, registry: fakeRegistry(routes), command: "codex", consent: true, now: Date.now, disclose: () => {}, ...extra });
    const none = modalityExec({ generate: () => ok("I have created the image you asked for.") });
    const r1 = await runModalityProbes("codex", gen({ exec: none.exec }));
    assert.equal(cellOf(r1, "image_gen").status, "probe_failed", "a file from one second before the request is not this request's output");
    const fresh = path.join(home, ".codex", "generated_images", "new", "exec-new.png");
    const writes = modalityExec({ generate: () => { fs.mkdirSync(path.dirname(fresh), { recursive: true }); fs.writeFileSync(fresh, "png"); return ok("written"); } });
    // hashFile opens with fs.openSync(file, "r") and reads synchronously, so an EACCES at open is
    // a file that cannot be hashed on every Node line. The stub refuses READ opens of `fresh`
    // only: on Node 18 writeFileSync also routes through the public fs.openSync (flag "w"), and
    // a path-only stub would make the fake generator's own write throw (CI run 34785555601).
    const realOpen = fs.openSync; fs.openSync = (...a) => { if (String(a[0]) === fresh && /^r/.test(String(a[1] ?? "r"))) throw Object.assign(new Error("EACCES: denied"), { code: "EACCES" }); return realOpen(...a); };
    let r2; try { r2 = await runModalityProbes("codex", gen({ exec: writes.exec })); } finally { fs.openSync = realOpen; }
    assert.equal(cellOf(r2, "image_gen").status, "probe_failed", "an unhashable file is not evidence"); assert.equal((cellOf(r2, "image_gen").harvested ?? []).length, 0);
    const refuses = modalityExec({ generate: () => { fs.writeFileSync(fresh, syntheticPng("blue")); return ok("I cannot generate images in this session."); } });
    const r3 = await runModalityProbes("codex", gen({ exec: refuses.exec }));
    assert.equal(cellOf(r3, "image_gen").status, "probe_failed", "a refusal is not verified on files alone"); assert.match(cellOf(r3, "image_gen").reason, /refus/);
    // The refusal case above left the same bytes at `fresh`. A fake generator answers within the same
    // millisecond, so an identical rewrite would keep the size:mtime signature of the pre-request
    // listing and be ignored as unchanged (CI run 35418666762, macOS Node 20). A real request takes
    // seconds; age the leftover so this control tests the rule rather than the clock.
    const aged = (Date.now() - 5000) / 1000; fs.utimesSync(fresh, aged, aged);
    const good = modalityExec({ generate: () => { fs.writeFileSync(fresh, syntheticPng("blue")); return ok("wrote it"); } });
    const r4 = await runModalityProbes("codex", gen({ exec: good.exec }));
    assert.equal(cellOf(r4, "image_gen").status, "verified", cellOf(r4, "image_gen").reason); assert.equal(cellOf(r4, "image_gen").harvested.length, 1, "control: exactly the file this request wrote");
  });
  // windows-literal-glob-case-mismatch (+ terminal ** suggestion).
  await test("glob_literal_segments_follow_the_filesystem_case_and_terminal_double_star_collects_files", () => {
    const base = path.join(fixture, "glob-case"); fs.mkdirSync(path.join(base, "Generated", "deep"), { recursive: true });
    fs.writeFileSync(path.join(base, "Generated", "result.png"), "x"); fs.writeFileSync(path.join(base, "Generated", "deep", "more.png"), "y");
    if (process.platform === "win32") assert.equal(globFiles(path.join(base, "generated", "*.png")).length, 1, "literal segments match case-insensitively on win32");
    assert.equal(globFiles(path.join(base, "Generated", "*.png")).length, 1);
    assert.deepEqual(globFiles(path.join(base, "Generated", "**")).map(f => path.basename(f.path)).sort(), ["more.png", "result.png"], "a terminal ** yields every file below");
  });
  // fake-cli-truncates-paths-with-spaces: the fake reads the path the way each CLI does.
  await test("fake_cli_resolves_synthetic_paths_with_spaces", () => {
    const spaced = path.join(fixture, "Jane Doe", "probe.png");
    assert.equal(probeFileIn(["exec", "-i", spaced, "--sandbox"], "This is a capability probe. View the image", "D"), spaced);
    assert.equal(probeFileIn(["-p", `This is a capability probe. View the image file at ${spaced} with your file or image tool`], "", "D"), spaced);
    assert.equal(probeFileIn(["--prompt", "@probe.png This is a capability probe."], "", path.join(fixture, "x y")), path.join(fixture, "x y", "probe.png"));
    assert.ok(/\s/.test(fixture), "the suite itself runs in a directory containing a space");
  });
  // registry-import-hides-missing-dependencies: only a missing capabilities.mjs is "absent".
  await test("registry_absence_is_only_a_missing_capabilities_file", () => {
    const here = path.join(fixture, "reg"); fs.mkdirSync(here, { recursive: true });
    const file = path.join(here, "capabilities.mjs");
    const notFound = message => Object.assign(new Error(message), { code: "ERR_MODULE_NOT_FOUND" });
    assert.equal(registryAbsent(notFound(`Cannot find module '${file}' imported from probes.mjs`), file), true);
    fs.writeFileSync(file, "import 'left-pad';\n");
    assert.equal(registryAbsent(notFound(`Cannot find package 'left-pad' imported from ${file}`), file), false, "a missing dependency inside an existing registry is a failure, not absence");
    assert.equal(registryAbsent(notFound(`Cannot find module '${file}'`), file), false, "the file exists: whatever failed, it is not absence");
    assert.equal(registryAbsent(new SyntaxError("Unexpected token"), file), false);
  });

  // auth_tier and quota are ACCOUNT-level: one probe that hits them blocks every non-`no` cell of
  // the route (reason route_level:<blocker>); the first successful probe of a later run clears
  // exactly those; a cell-level blocker elsewhere is touched by neither step.
  await test("account_level_blockers_cover_every_non_no_cell_of_the_route_and_clear_together", async () => {
    let registry;
    const registryFile = fileURLToPath(new URL("./capabilities.mjs", import.meta.url));
    try { registry = await import("./capabilities.mjs"); } catch (e) { if (registryAbsent(e, registryFile)) { results.account_level_blockers_cover_every_non_no_cell_of_the_route_and_clear_together = "unchecked: capabilities.mjs absent"; return; } throw e; }
    const home = path.join(fixture, "route-level-home"); fs.mkdirSync(home, { recursive: true });
    const view = cli => registry.effective({ home, installedVersions: { [cli]: "9.9.9" } }).routes[cli];
    registry.writeOverlayEntry(home, { route: "gemini", direction: "output", modality: "web", blocker: "probe_failed", reason: "generic reply", cli_version: "9.9.9" });
    const tier = () => ({ code: 1, stdout: "", stderr: "IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals" });
    const refused = modalityExec({ replies: { png: tier, pdf: tier, wav: tier } });
    const r1 = await runModalityProbes("gemini", mopts({ home, registry, exec: refused.exec, command: "gemini" }));
    assert.equal(cellOf(r1, "image").blocker, "auth_tier");
    const v1 = view("gemini");
    const covered = [["input", "text"], ["input", "pdf"], ["input", "audio"], ["input", "video"], ["output", "text"], ["output", "code_exec"]];
    for (const [dir, mod] of covered) { assert.equal(v1[dir][mod].blocker, "auth_tier", `${dir}.${mod} carries the account-level blocker`); assert.equal(v1[dir][mod].source, "overlay"); assert.equal(typeof v1[dir][mod].overlay?.expires_at, "string", `${dir}.${mod} expires with the auth_tier class`); }
    assert.match(v1.input.video.reason, /^route_level:auth_tier/, "the propagated entry says where it came from"); assert.match(v1.input.video.reason, /input\.image/);
    assert.match(v1.input.image.reason, /reply named the auth_tier gate/, "the probed cell keeps its own reason");
    assert.equal(v1.input.speech.level, "no"); assert.equal(v1.input.speech.blocker, null, "a baseline no cell is untouched"); assert.equal(v1.output.image_gen.blocker, null);
    assert.equal(v1.output.web.blocker, "probe_failed"); assert.equal(v1.output.web.reason, "generic reply", "a cell-level blocker is not overwritten by propagation");
    assert.equal(r1.route_level?.[0]?.blocker, "auth_tier"); assert.ok(r1.route_level[0].applied_to.includes("input.video"));
    // The account is fixed: the first probed cell succeeds, so every route_level entry clears;
    // cells probed in this run get their own evidence; the cell-level probe_failed stays.
    const fixed = modalityExec({ replies: { png: () => ok(envelope("gemini", "Red")), pdf: () => ok(envelope("gemini", `The page reads: ${SENT}`)), wav: () => ok(envelope("gemini", "A 440 Hz sine tone.")) } });
    const r2 = await runModalityProbes("gemini", mopts({ home, registry, exec: fixed.exec, command: "gemini", colour: "red", sentence: SENT }));
    assert.equal(cellOf(r2, "image").status, "verified", cellOf(r2, "image").reason);
    const v2 = view("gemini");
    for (const [dir, mod] of [["input", "text"], ["input", "video"], ["output", "text"], ["output", "code_exec"]]) { assert.equal(v2[dir][mod].blocker, null, `${dir}.${mod} cleared with the route-level blocker`); assert.match(v2[dir][mod].reason ?? "", /^cleared: route_level:auth_tier/); assert.equal(v2[dir][mod].level, v1[dir][mod].level, "clearing changes no level"); }
    for (const mod of ["image", "pdf", "audio"]) { assert.equal(v2.input[mod].blocker, null, mod); assert.equal(v2.input[mod].level, "verified", `${mod} has its own evidence`); }
    assert.equal(v2.output.web.blocker, "probe_failed", "a cell-level probe_failed elsewhere is not cleared by the route-level clearing");
    assert.ok(r2.route_level?.some(x => x.cleared?.includes("input.video")), "the run records what it cleared");
    // Quota, same shape; and a later run whose first probed cell FAILS clears nothing.
    const quota = () => ({ code: 1, stdout: "You have exceeded your monthly quota.", stderr: "" });
    await runModalityProbes("copilot", mopts({ home, registry, exec: modalityExec({ replies: { png: quota, pdf: quota } }).exec, command: "copilot" }));
    const c1 = view("copilot");
    for (const [dir, mod] of [["input", "text"], ["input", "pdf"], ["input", "speech"], ["output", "text"], ["output", "code_exec"], ["output", "web"]]) assert.equal(c1[dir][mod].blocker, "quota", `copilot ${dir}.${mod}`);
    assert.equal(c1.input.audio.blocker, null, "copilot audio is a no cell");
    const generic = modalityExec({ replies: { png: () => ok("a small square"), pdf: () => ok("a short document") } });
    await runModalityProbes("copilot", mopts({ home, registry, exec: generic.exec, command: "copilot" }));
    const c2 = view("copilot");
    assert.equal(c2.input.image.blocker, "probe_failed"); assert.equal(c2.input.speech.blocker, "quota", "a failed first probe clears no route-level entry"); assert.equal(c2.output.web.blocker, "quota");
  });

  await test("real_registry_round_trip_probe_failed_then_verified", async () => {
    let registry;
    const registryFile = fileURLToPath(new URL("./capabilities.mjs", import.meta.url));
    try { registry = await import("./capabilities.mjs"); } catch (e) { if (registryAbsent(e, registryFile)) { results.real_registry_round_trip_probe_failed_then_verified = "unchecked: capabilities.mjs absent"; return; } throw e; }
    const home = path.join(fixture, "real-home"); fs.mkdirSync(home, { recursive: true });
    const view = () => registry.effective({ home, installedVersions: { codex: "9.9.9" } }).routes.codex;
    assert.equal(view().input.image.level, "verified", "baseline codex image is verified from the help capture");
    const generic = modalityExec({ replies: { png: () => ok("It looks like a small square image.") } });
    const r1 = await runModalityProbes("codex", mopts({ home, registry, exec: generic.exec, command: "codex", colour: "green" }));
    assert.equal(cellOf(r1, "image").status, "probe_failed"); assert.equal(cellOf(r1, "image").overlay_written, true, cellOf(r1, "image").overlay_error);
    const failed = view().input.image;
    assert.equal(failed.blocker, "probe_failed"); assert.equal(failed.level, "verified", "the baseline level stands"); assert.equal(failed.source, "overlay"); assert.equal(registry.routable(failed), false);
    assert.equal(cellOf(r1, "image_gen").status, "skipped"); assert.match(cellOf(r1, "image_gen").reason, /consent_required/); assert.equal(cellOf(r1, "image_gen").level_before, "documented");
    const named = modalityExec({ replies: { png: () => ok("Green") } });
    const r2 = await runModalityProbes("codex", mopts({ home, registry, exec: named.exec, command: "codex", colour: "green" }));
    assert.equal(cellOf(r2, "image").status, "verified");
    const cleared = view().input.image;
    assert.equal(cleared.blocker, null); assert.equal(cleared.level, "verified"); assert.equal(registry.routable(cleared), true);
    // An upgraded CLI invalidates the entry: a blocker becomes reprobe, never a silent unblock.
    const stale = modalityExec({ replies: { png: () => ok("nothing to say") }, version: ok("9.9.9") });
    await runModalityProbes("codex", mopts({ home, registry, exec: stale.exec, command: "codex", colour: "green" }));
    assert.equal(registry.effective({ home, installedVersions: { codex: "10.0.0" } }).routes.codex.input.image.blocker, "reprobe");
    assert.match(registry.clearingAction("reprobe", "codex"), /probes\.mjs codex --modalities/);
    // The overlay file lives under the temp home only, mode-restricted, and names this machine.
    const files = fs.readdirSync(path.join(home, ".momm")).filter(n => n.startsWith("capabilities-"));
    assert.equal(files.length, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(home, ".momm", files[0]), "utf8")).machine_id, registry.machineId());
    if (process.platform !== "win32") { assert.equal(fs.statSync(path.join(home, ".momm", files[0])).mode & 0o777, 0o600, "overlay is owner-only"); assert.equal(fs.statSync(path.join(home, ".momm")).mode & 0o777, 0o700); }
    // The projection of the shipped baseline is what the dispatcher pins as MODALITY_SUPPORT.
    const projected = registry.projection(registry.loadBaseline());
    assert.deepEqual(Object.keys(projected.grok).sort(), ["image", "pdf", "text"]);
  });

  if (failures.length) {
    for (const { name, error } of failures) process.stderr.write(`FAIL ${name}\n  ${String(error?.stack || error).split("\n").slice(0, 6).join("\n  ")}\n`);
    process.stdout.write(JSON.stringify({ passed: false, tests: results }, null, 2) + "\n");
    process.exitCode = 1;
  } else process.stdout.write(JSON.stringify({ passed: true, tests: results }, null, 2) + "\n");
} finally {
  if (path.dirname(fixture) === os.tmpdir() && path.basename(fixture).startsWith("momm probes tests-")) fs.rmSync(fixture, { recursive: true, force: true });
}
