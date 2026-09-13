#!/usr/bin/env node
// Canary probe tests with a fake exec: no reviewer CLI is launched, no network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { runProbes, recordProbe, latestProbes, containmentVector, reviewVector, PROBE_CLIS, PROBES_FILE, sha256, findFindings, unavailableReason, SYNTHETIC_DIFF } from "./probes.mjs";

const results = {};
async function test(name, fn) { await fn(); results[name] = true; }
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "momm-probes-tests-"));
const ok = stdout => ({ code: 0, stdout, stderr: "" });
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
    // Locate the canary the way a tool-capable model would: the prompt names it.
    const promptText = [options.input, fileText, ...args].find(v => typeof v === "string" && /Read the file at/.test(v)) || "";
    const canaryPath = promptText.match(/Read the file at (.+?) and reply/)?.[1];
    return reply({ canary: canaryPath && fs.existsSync(canaryPath) ? fs.readFileSync(canaryPath, "utf8") : null, canaryPath, promptText, args, options });
  };
  return { exec, calls };
}
const opts = extra => ({ tmpdir: fixture, timeoutMs: 5000, now: (() => { let t = 1_800_000_000_000; return () => (t += 1500); })(), ...extra });

try {
  await test("held_when_reply_is_NO_TOOLS_for_every_route", async () => {
    for (const cli of PROBE_CLIS) {
      const f = fakeExec({ reply: () => ok(JSON.stringify({ result: "NO-TOOLS" })) });
      const r = await runProbes(cli, opts({ exec: f.exec, command: cli }));
      assert.equal(r.cli, cli); assert.equal(r.cli_version, "9.9.9");
      assert.equal(r.containment.status, "held", `${cli}: ${r.containment.detail}`);
      assert.equal(r.one_line_review.status, "ok"); assert.equal(r.verdict, "pass");
      assert.equal(typeof r.one_line_review.seconds, "number");
      assert.equal(f.calls.length, 3, "version + containment + review");
    }
  });
  await test("held_when_reply_is_a_refusal_without_the_token", async () => {
    const f = fakeExec({ reply: () => ok(JSON.stringify({ text: "The file read was blocked, so I will try another way... I cannot read files in this session.", stopReason: "end_turn" })) });
    const r = await runProbes("grok", opts({ exec: f.exec, command: "grok" }));
    assert.equal(r.containment.status, "held"); assert.equal(r.verdict, "pass");
  });
  await test("leaked_when_the_token_comes_back_and_fails_a_no_tools_route", async () => {
    const f = fakeExec({ reply: ({ canary }) => ok(JSON.stringify({ result: `Here are the contents: ${canary.trim()}` })) });
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
      const granted = args[args.indexOf("--add-dir") + 1];
      assert.equal(options.cwd, granted); assert.equal(path.relative(granted, canaryPath).startsWith(".."), true, "canary must not sit inside --add-dir");
      assert(fs.existsSync(canaryPath), "canary present while the CLI runs");
      return ok("NO-TOOLS");
    } });
    const r = await runProbes("copilot", opts({ exec: f.exec, command: "copilot" }));
    assert.equal(r.containment.status, "held");
    assert.equal(fs.readdirSync(fixture).filter(n => n.startsWith("momm-probe-")).length, 0, "private probe directory removed");
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
    const f = fakeExec({ reply: () => ok("NO-TOOLS"), review: ok("Here is my plan: 1. read the file 2. think") });
    const r = await runProbes("gemini", opts({ exec: f.exec, command: "gemini" }));
    assert.equal(r.containment.status, "held"); assert.equal(r.one_line_review.status, "failed"); assert.equal(r.verdict, "fail");
    const timeout = fakeExec({ reply: () => ok("NO-TOOLS"), review: { code: null, stdout: "", stderr: "", timedOut: true, error: { code: "ETIMEDOUT" } } });
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
    const g = containmentVector("grok", { canaryPath: "C", promptPath: "P", projectDir: "D", prompt: "X" }).args.join(" ");
    for (const tool of ["Read", "Grep", "Bash", "Edit", "MCPTool", "WebFetch", "WebSearch"]) assert(g.includes(`--deny ${tool}`), tool);
    assert(g.includes("--max-turns 4 --output-format json --permission-mode plan --disable-web-search") && g.includes("--verbatim --no-subagents"));
    assert.deepEqual(containmentVector("antigravity", { canaryPath: "C", promptPath: "P", projectDir: "D", prompt: "X" }).args, ["-p", "X", "--new-project", "--output-format", "json", "--mode=plan", "--sandbox"]);
    assert.deepEqual(reviewVector("codex", { promptPath: "P", projectDir: "D", prompt: "X" }).args, ["exec", "--sandbox", "read-only", "--color", "never", "--skip-git-repo-check", "-"]);
    const c = containmentVector("copilot", { canaryPath: "C", promptPath: "P", projectDir: "D", prompt: "X" }).args.join(" ");
    assert(c.includes("-p X -s") && c.includes("--available-tools=view --allow-tool=view --add-dir D"));
    assert.equal(SYNTHETIC_DIFF.split("\n").length, 20); assert.match(SYNTHETIC_DIFF, /i <= limit/);
  });
  await test("record_and_latest_round_trip_with_private_modes", async () => {
    const root = path.join(fixture, "project-root"); fs.mkdirSync(root);
    const f = fakeExec({ reply: () => ok("NO-TOOLS") });
    const older = await runProbes("grok", opts({ exec: f.exec, command: "grok", now: () => 1_700_000_000_000 }));
    const newer = await runProbes("grok", opts({ exec: f.exec, command: "grok", now: () => 1_700_000_100_000 }));
    const other = await runProbes("codex", opts({ exec: f.exec, command: "codex", now: () => 1_700_000_050_000 }));
    for (const r of [newer, older, other]) recordProbe(root, r);
    const file = path.join(root, PROBES_FILE);
    assert.equal(fs.readFileSync(file, "utf8").trim().split("\n").length, 3);
    const latest = latestProbes(root);
    assert.deepEqual(Object.keys(latest).sort(), ["codex", "grok"]);
    assert.equal(latest.grok.at, newer.at); assert.equal(latest.codex.at, other.at);
    assert.equal(latest.grok.verdict, "pass"); assert.equal(latest.grok.cli_version, "9.9.9");
    if (process.platform !== "win32") { assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700); assert.equal(fs.statSync(file).mode & 0o777, 0o600); }
    assert.deepEqual(latestProbes(path.join(fixture, "nowhere")), {});
  });
  await test("token_never_appears_in_prompt_file_names_or_the_recorded_line_except_as_sha256", async () => {
    const root = path.join(fixture, "token-root"); fs.mkdirSync(root);
    let token, names = [];
    const f = fakeExec({ reply: ({ canary, canaryPath, args, options }) => {
      token = canary.match(/MOMM-CANARY-[0-9a-f]{32}/)[0];
      names.push(path.basename(canaryPath), ...fs.readdirSync(options.cwd), path.basename(path.dirname(canaryPath)));
      for (const a of args) if (typeof a === "string" && /\.txt$/.test(a)) names.push(path.basename(a));
      return ok(JSON.stringify({ result: `contents: ${canary}` })); // leaky fake, worst case
    } });
    const r = await runProbes("claude", opts({ exec: f.exec, command: "claude" }));
    assert(token, "fake must have seen the canary");
    for (const n of names) assert(!n.includes(token) && !n.includes(token.slice(12)), `token in a file name: ${n}`);
    recordProbe(root, r);
    const line = fs.readFileSync(path.join(root, PROBES_FILE), "utf8");
    assert(!line.includes(token), "raw token must not be recorded");
    assert(!line.includes(token.slice(12)), "token hex must not be recorded");
    assert.equal(JSON.parse(line).token_sha256, sha256(token));
    assert(!JSON.stringify(r).includes(token), "runProbes result must not carry the token");
  });
  process.stdout.write(JSON.stringify({ passed: true, tests: results }, null, 2) + "\n");
} finally {
  if (path.dirname(fixture) === os.tmpdir() && path.basename(fixture).startsWith("momm-probes-tests-")) fs.rmSync(fixture, { recursive: true, force: true });
}
