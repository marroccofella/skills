#!/usr/bin/env node
// Controlled transport/records, real governor-authored regression execution.
// No model calls. This does not certify every host agent's judgment.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectCompletion, recordCompletion, captureSourceSnapshot, digest } from "./governor.mjs";
import { PEER_CONTRACT, reviewProblem } from "./review-contract.mjs";
const scripts = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(scripts, "multi-review.mjs"), "utf8");
// Execute production parser/normalizer/aggregation functions, not a copied algorithm.
const core = vm.runInNewContext(source.slice(source.indexOf("function extractJsonObjects("), source.indexOf("function classifyFailure("))
  + source.slice(source.indexOf("function fingerprint("), source.indexOf("function buildInsights("))
  + "\n({unwrapReviewPayload,normalizeReview,rationalize,buildOutstanding})", {
    PEER_CONTRACT, VALID_VERDICTS: new Set(["ACCEPT", "MODIFY", "REJECT"]), VALID_SEVERITIES: new Set(["CRITICAL", "WARNING", "NITPICK"]), fs, os, path,
  });
const passed = [];
const test = (name, fn) => { fn(); passed.push(name); };
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "momm-governor-test-"));
const write = (relative, value) => { const file = path.join(fixture, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n"); return file; };
const ref = relative => ({ path: relative, sha256: digest(fs.readFileSync(path.join(fixture, relative))) });
const run = args => spawnSync(process.execPath, args, { cwd: fixture, encoding: "utf8", timeout: 30000, windowsHide: true,
  env: { ...process.env, NO_UPDATE_CHECK: "1", MOMM_NO_UPDATE_CHECK: "1", DO_NOT_TRACK: "1" } });
const good = 'module.exports = a => a.reduce((s, x) => s + x, 0) / a.length;\n';
const buggy = good.replace("/ a.length", "/ (a.length + 1)");
const peer = (changes = {}) => ({ review_status: "complete", reviewed_scope: [{ quote: "a.length", assessment: "The denominator determines the arithmetic mean." }], verdict: "ACCEPT", confidence: 0, summary: "The arithmetic mean calculation is assessed below.", findings: [], suggested_improvements: [], ...changes });
try {
  test("completed clean review and zero confidence remain valid", () => assert.equal(reviewProblem(peer(), good), null));
  test('quotation matching tolerates only platform line endings', () => {
    const sample='const x = 1;\nconst y = 2;';
    const p=peer({reviewed_scope:[{quote:sample,assessment:'Two constant declarations.'}]});
    assert.equal(reviewProblem(p,sample.replaceAll('\n','\r\n')),null);
    assert.equal(reviewProblem({...p,reviewed_scope:[{quote:sample.replaceAll('\n','\r\n'),assessment:'Two declarations.'}]},sample),null);
    assert(reviewProblem(p,sample.replace('x = 1','x = 9')));
    assert(reviewProblem(p,sample.replace('x = 1','x  = 1')));
  });
  test('a literal excerpt ending between CR and LF still matches', () => {
    const quote='const x = 1;\r';
    const p=peer({reviewed_scope:[{quote,assessment:'Literal source excerpt ending at CR.'}]});
    assert.equal(reviewProblem(p,'const x = 1;\r\nconst y = 2;'),null);
    assert(reviewProblem(p,'const x = 1;\nconst y = 2;'),'lone CR must not become an invented LF');
  });
  test('diff scope preserves prefixes instead of reconstructing source', () => {
    const artifact = '+  const value = read();\n+  return value;\n';
    const check = quote => reviewProblem(peer({ reviewed_scope: [{ quote, assessment: 'The value is read then returned.' }] }), artifact);
    assert.equal(check('+  const value = read();\n+  return value;'), null);
    assert.equal(check('const value = read();'), null, 'a literal single-line substring is valid');
    assert(check('  const value = read();\n  return value;'), 'stripping diff prefixes must remain invalid');
    assert(check('+ const value = read();\n+ return value;'), 'reindentation must remain invalid');
    assert.match(source, /short single-line excerpts/);
    assert.match(source, /do not remove diff markers, reindent, or reformat/);
  });
  test("validator rejects absent or non-string artifact without coercion", () => {
    for (const a of [undefined, null, {}, 42, Buffer.from("a.length")]) {
      const payload = peer({ reviewed_scope: [{ quote: String(a), assessment: "Fabricated coercion corpus" }] });
      assert(reviewProblem(payload, a));
    }
  });
  test("scope overflow identifies over-limit rather than missing work", () => assert.match(reviewProblem(peer({ reviewed_scope: Array(13).fill(peer().reviewed_scope[0]) }), good), /over-limit/));
  test("short legitimate artifacts remain reviewable", () => assert.equal(reviewProblem(peer({ reviewed_scope: [{ quote: "x", assessment: "Single symbol" }] }), "x"), null));
  for (const [name, payload] of [
    ["missing fields", { findings: [] }], ["starting-review placeholder", { verdict: "MODIFY", confidence: 0, findings: [], summary: "Reading the full artifact before issuing a verdict.", suggested_improvements: [] }],
    ["declared incomplete", peer({ review_status: "incomplete" })], ["missing assessed scope", peer({ reviewed_scope: [] })],
    ["fabricated quotation", peer({ reviewed_scope: [{ quote: "not in source", assessment: "test" }] })],
    ["silent suggestion overflow", peer({ suggested_improvements: Array(21).fill("x") })],
    ["malformed finding", peer({ findings: [{ issue: "" }] })], ["wrong confidence type", peer({ confidence: "0" })],
  ]) test(name, () => assert(reviewProblem(payload, good)));
  test("legitimate loading discussion is not blacklisted", () => assert.equal(reviewProblem(peer({ summary: "The loading flag is checked correctly." }), good), null));
  test("explicit error wrapper refused", () => assert.equal(core.unwrapReviewPayload(JSON.stringify({ is_error: true, structured_output: peer() })), null));
  test("nested terminal errors are not hidden by wrappers", () => assert.equal(core.unwrapReviewPayload(JSON.stringify({ text: JSON.stringify(peer()) + '\n{"is_error":true}' })), null));
  test("nested error-marked review is refused", () => assert.equal(core.unwrapReviewPayload(JSON.stringify({ structured_output: { ...peer(), is_error: true } })), null));
  test("truncated terminal envelope refuses earlier plausible reply", () => assert.equal(core.unwrapReviewPayload(JSON.stringify(peer()) + '\n{"is_error":true'), null));
  test("finding ids cannot collide after normalization", () => { const f = { id: "same", severity: "WARNING", target_file: null, line_range: null, issue: "Issue", rationale: "Reason", test_suggestion: null }; assert(reviewProblem(peer({ findings: [f, { ...f, id: " same " }] }), good)); });
  test("nonfinal/error terminal cannot rescue earlier output", () => assert.equal(core.unwrapReviewPayload(JSON.stringify(peer()) + '\n{"stopReason":"tool_use"}'), null));
  test("final review follows intermediate envelope", () => assert(core.unwrapReviewPayload('{"stopReason":"tool_use"}\n' + JSON.stringify(peer()))));

  write("mean.cjs", buggy);
  write("mean.test.cjs", 'const assert = require("node:assert/strict"); const mean = require("./mean.cjs"); assert.equal(mean([2,4]),3); assert.equal(mean([1,2]),1.5); console.log("mean checks passed");\n');
  const dispatch = run([path.join(scripts, "multi-review.mjs"), "--governor", "codex", "--reviewers", "codex", "--input", "mean.cjs", "--min-success", "1", "--no-ui"]);
  const base = JSON.parse(dispatch.stdout);
  test("real dispatcher self-excludes governor and refuses quorum", () => { assert.equal(dispatch.status, 3); assert.equal(base.reviewers[0].status, "self_excluded"); assert.equal(base.outstanding.complete, false); });
  test("real dispatcher captures reviewed source", () => assert.equal(base.source_snapshot.files[0].sha256, digest(buggy)));
  const finding = { id: "wrong-divisor", severity: "WARNING", target_file: "mean.cjs", line_range: [1, 1], issue: "The extra divisor count produces an incorrect mean.", rationale: "[2,4] must average to 3.", test_suggestion: 'require("fs").writeFileSync("PEER_EXECUTED", "bad")' };
  const responses = [
    { agent: "claude", status: "success", review: core.normalizeReview("claude", peer({ verdict: "MODIFY", findings: [finding], suggested_improvements: ["Round all results", "Change the public API"] })) },
    { agent: "grok", status: "success", review: core.normalizeReview("grok", peer({ verdict: "MODIFY", suggested_improvements: ["Keep fractional precision", "Change the public API"] })) },
  ];
  const findings = core.rationalize(responses, { artifact: buggy, prose: false });
  const report = { ...base, test_fixture: "controlled reviewer transport; not real provider approval", run_id: "rev_fixture_lifecycle", source_snapshot: captureSourceSnapshot(fixture, buggy, "mean.cjs"),
    quorum: { required: 2, achieved: 2, met: true }, gate_policy: { strict: false, quorum_required: 2, requested_routes: ["claude", "grok"] },
    reviewers: responses.map(r => ({ agent: r.agent, status: r.status, verdict: r.review.verdict, confidence: r.review.confidence, summary: r.review.summary, review_contract: PEER_CONTRACT, reviewed_scope: r.review.reviewed_scope, suggested_improvements: r.review.improvements })),
    findings, outstanding: core.buildOutstanding(findings, responses, "rev_fixture_lifecycle", fixture, 2) };
  const reportPath = `.ensemble_reviews/reports/${report.run_id}.json`;
  write(reportPath, report);
  const sealed = ref(reportPath);
  write(".ensemble_reviews/review-log.jsonl", JSON.stringify({ run_id: report.run_id, governor: "codex", report_path: reportPath, report_sha256: sealed.sha256, input_sha256: report.input_sha256, reviewer_status: { claude: "success", grok: "success" } }) + "\n");
  const pending = inspectCompletion(fixture, report.run_id);
  test("quorum alone cannot complete governor work", () => { assert.equal(report.outstanding.complete, false); assert.equal(pending.complete, false); assert.equal(pending.items.length, 5); });
  test("duplicate text across reviewers has distinct obligations", () => assert.equal(new Set(pending.items.map(i => i.item_id)).size, 5));
  const defect = pending.items.find(i => i.kind === "finding");
  write("evidence/original.cjs", buggy);
  const before = run(["mean.test.cjs"]);
  test("governor reproduces defect before fix", () => assert.equal(before.status, 1));
  write("evidence/before.txt", before.stdout + before.stderr);
  const observation = (itemId, phase, output, code, at) => ({ schema: "momm-check/1", run_id: report.run_id, item_id: itemId,
    report_sha256: sealed.sha256, input_sha256: report.input_sha256, phase, exit_code: code, observed_at: at, command_label: "node mean.test.cjs (governor-authored)",
    test: ref("mean.test.cjs"), output: ref(output), artifacts: [ref("mean.cjs")] });
  const beforeCheck = observation(defect.item_id, "before", "evidence/before.txt", before.status, "2026-01-01T00:00:00Z");
  beforeCheck.artifacts[0].snapshot = ref("evidence/original.cjs");
  write("evidence/before.json", beforeCheck);
  write("mean.cjs", good);
  const after = run(["mean.test.cjs"]);
  test("same regression passes after governor-authored fix", () => assert.equal(after.status, 0));
  write("evidence/after.txt", after.stdout + after.stderr);
  write("evidence/after.json", observation(defect.item_id, "after", "evidence/after.txt", after.status, "2026-01-01T00:00:01Z"));
  write(`.ensemble_reviews/verification/${report.run_id}.json`, observation("run", "final", "evidence/after.txt", after.status, "2026-01-01T00:00:02Z"));
  let rows = pending.items.map(i => ({ run_id: report.run_id, governor: "codex", reviewer: i.reviewer ?? "claude", item_id: i.item_id, report_sha256: sealed.sha256, input_sha256: report.input_sha256,
    suggestion: i.kind === "finding" ? i.content.issue : i.content,
    disposition: i.kind === "finding" ? "applied" : "rejected", change_kind: "behavior",
    reason: i.kind === "finding" ? "Correct divisor; identical assertions fail before and pass after." : "Preserve fractional arithmetic and the existing API; no additional change warranted.",
    ...(i.kind === "finding" ? { finding_id: i.content.id, reproduction: ref("evidence/before.json"), verification: ref("evidence/after.json") } : {}) }));
  const decisions = value => write(".ensemble_reviews/dispositions.jsonl", value.map(r => JSON.stringify(r)).join("\n") + "\n");
  decisions(rows);
  const healthy = () => inspectCompletion(fixture, report.run_id);
  test("all actual lifecycle evidence closes the run", () => assert.equal(healthy().complete, true, JSON.stringify(healthy())));
  for (const [name, mutate] of [
    ["missing decision", r => r.slice(1)], ["duplicate decision", r => [...r, r[0]]],
    ["unrelated matching-run row", r => [...r, { ...r[0], item_id: "fake" }]],
    ["deferred item stays open", r => r.map((x,i) => i ? x : { ...x, disposition: "deferred" })],
    ["wrong input binding", r => r.map((x,i) => i ? x : { ...x, input_sha256: "0".repeat(64) })],
    ["applied without reproduction", r => r.map(x => x.disposition === "applied" ? { ...x, reproduction: null } : x)],
    ["wrong governor", r => r.map((x,i) => i ? x : { ...x, governor: "grok" })],
    ["unsafe evidence path", r => r.map(x => x.disposition === "applied" ? { ...x, verification: { path: "../outside", sha256: "0".repeat(64) } } : x)],
  ]) test(name, () => { decisions(mutate(rows)); assert.equal(healthy().complete, false); decisions(rows); });
  test("malformed JSONL fails visibly", () => { write(".ensemble_reviews/dispositions.jsonl", "{bad\n"); assert.equal(healthy().complete, false); decisions(rows); });
  test("recorded completion does not mutate sealed report", () => { assert.equal(recordCompletion(fixture, report.run_id).complete, true); assert.equal(ref(reportPath).sha256, sealed.sha256); });
  test("later source change invalidates completion", () => { write("mean.cjs", buggy); assert.equal(healthy().complete, false); write("mean.cjs", good); });
  test("later test change invalidates completion", () => { const original = fs.readFileSync(path.join(fixture, "mean.test.cjs"), "utf8"); write("mean.test.cjs", "process.exit(0)"); assert.equal(healthy().complete, false); write("mean.test.cjs", original); });
  test("changed report cannot be resealed by recalculating only its hash", () => { write(reportPath, { ...report, governor: "claude" }); assert.equal(healthy().complete, false); write(reportPath, report); });
  test("changed recorded output invalidates completion", () => { const original = fs.readFileSync(path.join(fixture, "evidence/after.txt")); fs.writeFileSync(path.join(fixture, "evidence/after.txt"), "forged pass"); assert.equal(healthy().complete, false); fs.writeFileSync(path.join(fixture, "evidence/after.txt"), original); });
  test("clean review still binds final source", () => {
    const clean = { ...report, run_id: "rev_fixture_clean", findings: [], input_sha256: digest(good), source_snapshot: captureSourceSnapshot(fixture, good, "mean.cjs"), reviewers: report.reviewers.map(r => ({ ...r, suggested_improvements: [] })) };
    const p = `.ensemble_reviews/reports/${clean.run_id}.json`; write(p, clean); const sha = ref(p).sha256;
    const originalLog = fs.readFileSync(path.join(fixture, ".ensemble_reviews/review-log.jsonl"), "utf8");
    write(".ensemble_reviews/review-log.jsonl", originalLog + JSON.stringify({ run_id: clean.run_id, report_path: p, report_sha256: sha, input_sha256: clean.input_sha256 }) + "\n");
    const final = { ...observation("run", "final", "evidence/after.txt", 0, "2026-01-01T00:00:03Z"), run_id: clean.run_id, report_sha256: sha, input_sha256: clean.input_sha256 };
    write(`.ensemble_reviews/verification/${clean.run_id}.json`, final);
    assert.equal(inspectCompletion(fixture, clean.run_id).complete, true);
    write("mean.cjs", buggy); assert.equal(inspectCompletion(fixture, clean.run_id).complete, false); write("mean.cjs", good);
    write(".ensemble_reviews/review-log.jsonl", originalLog);
  });
  test("strict policy and zero external reviews cannot be waived", () => {
    const p = `.ensemble_reviews/reports/rev_fixture_strict.json`;
    const fail = { ...report, run_id: "rev_fixture_strict", gate_policy: { strict: true, quorum_required: 1, requested_routes: ["claude", "grok"] }, reviewers: [{ ...report.reviewers[0], status: "timeout" }, { agent: "codex", status: "success" }], findings: [] };
    write(p, fail); const originalLog = fs.readFileSync(path.join(fixture, ".ensemble_reviews/review-log.jsonl"), "utf8");
    write(".ensemble_reviews/review-log.jsonl", originalLog + JSON.stringify({ run_id: fail.run_id, report_path: p, report_sha256: ref(p).sha256, input_sha256: fail.input_sha256 }) + "\n");
    const result = inspectCompletion(fixture, fail.run_id); assert.equal(result.complete, false); assert(result.errors.includes("external review quorum not met")); assert(result.errors.includes("strict reviewer policy not met"));
    write(".ensemble_reviews/review-log.jsonl", originalLog);
  });
  test("direct source changed during capture refused", () => assert.equal(captureSourceSnapshot(fixture, buggy, "mean.cjs").complete, false));
  test("finding paths preserve actual a/b directories before removing diff prefixes", () => {
    const gov = fs.readFileSync(path.join(scripts, "governor.mjs"), "utf8");
    const start = gov.indexOf("// A cited real project file"), end = gov.indexOf("if (target &&", start);
    assert(start >= 0 && end > start);
    const target = (name, paths) => vm.runInNewContext(gov.slice(start, end) + ";target", {
      obligation: { kind: "finding", content: { target_file: name } }, report: { source_snapshot: { files: paths.map(path => ({ path })) } },
    });
    assert.equal(target("a/mean.cjs", ["a/mean.cjs", "mean.cjs"]), "a/mean.cjs");
    assert.equal(target("a/mean.cjs", ["mean.cjs"]), "mean.cjs");
    assert.equal(target("b/other.cjs", ["mean.cjs"]), "b/other.cjs");
  });
  test("explicit source containing a sample diff is still file input", () => {
    const sample = 'const sample = `\ndiff --git a/x b/x\n`;\n'; write("sample.cjs", sample);
    assert.equal(captureSourceSnapshot(fixture, sample, "sample.cjs").complete, true);
  });
  test("malformed strict policy retains item inventory and explains missing routes", () => {
    const malformed = { ...report, run_id: "rev_fixture_malformed_policy", gate_policy: { strict: true, quorum_required: 2 } };
    const p = `.ensemble_reviews/reports/${malformed.run_id}.json`; write(p, malformed);
    const originalLog = fs.readFileSync(path.join(fixture, ".ensemble_reviews/review-log.jsonl"), "utf8");
    write(".ensemble_reviews/review-log.jsonl", originalLog + JSON.stringify({ run_id: malformed.run_id, report_path: p, report_sha256: ref(p).sha256, input_sha256: malformed.input_sha256 }) + "\n");
    const result = inspectCompletion(fixture, malformed.run_id);
    assert.equal(result.complete, false); assert.equal(result.items.length, 5); assert(result.errors.some(e => /requested_routes/.test(e)));
    write(".ensemble_reviews/review-log.jsonl", originalLog);
  });
  test('Windows short root alias matches only the same canonical Git root',()=>{
    const gov=fs.readFileSync(path.join(scripts,'governor.mjs'),'utf8');
    const legacy=p=>path.win32.normalize(p);legacy.native=p=>legacy(p).replace('Q:\\RUNNER~1','Q:\\runner.long');
    const artifact='diff --git a/x.txt b/x.txt\n';
    const fakeFs={realpathSync:legacy,statSync:()=>({isFile:()=>true,size:8}),readFileSync:()=>Buffer.from('fixture\n')};
    const capture=vm.runInNewContext(gov.slice(gov.indexOf('export function captureSourceSnapshot'),gov.indexOf('export function inspectCompletion')).replace('export function','function')+';captureSourceSnapshot',
      {fs:fakeFs,path:path.win32,process:{platform:'win32'},digest,demand:(ok,message)=>{if(!ok)throw Error(message);},spawnSync:(_cmd,args)=>({status:0,stdout:args[0]==='rev-parse'?'Q:\\runner.long\\repo\n':args.includes('--name-status')?'M\0x.txt\0':artifact})});
    const result=capture('Q:\\RUNNER~1\\repo',artifact);assert.equal(result.complete,true,result.reason);
    assert.match(capture('Q:\\RUNNER~1\\repo\\child',artifact).reason,/repository root/);
  });
  test("fresh Git scope accepted; stale, deleted and binary scope refused", () => {
    const cwd = path.join(fixture, "scope"); fs.mkdirSync(cwd);
    const git = args => { const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "core.hooksPath=.git/no-hooks", ...args], { cwd, encoding: "utf8", timeout: 10000 }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    git(["init", "-q"]); fs.writeFileSync(path.join(cwd, "x.txt"), "before\n"); fs.writeFileSync(path.join(cwd, "blob.bin"), Buffer.from([0,1,2]));
    git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture baseline"]);
    fs.writeFileSync(path.join(cwd, "x.txt"), "after\n"); const diff = git(["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"]);
    assert.equal(captureSourceSnapshot(cwd, diff).complete, true);
    const subdir = path.join(cwd, "subdir"); fs.mkdirSync(subdir);
    assert.match(captureSourceSnapshot(subdir, diff).reason, /repository root/i);
    // Mutate after the initial diff comparison, at the first source read.
    // This makes the race deterministic rather than relying on wall-clock timing.
    const raceCwd=path.join(fixture,'race-alias');fs.symlinkSync(cwd,raceCwd,process.platform==='win32'?'junction':'dir');
    const raceTarget=fs.realpathSync(path.join(raceCwd,'x.txt'));
    let changed = false;
    const racedFs = new Proxy(fs, { get(target, key) {
      if (key !== "readFileSync") return target[key];
      return (file, ...args) => { if (!changed && fs.realpathSync(file) === raceTarget) { changed = true; fs.writeFileSync(file, "concurrent\n"); } return fs.readFileSync(file, ...args); };
    } });
    const gov = fs.readFileSync(path.join(scripts, "governor.mjs"), "utf8");
    const capture = vm.runInNewContext(gov.slice(gov.indexOf("export function captureSourceSnapshot"), gov.indexOf("export function inspectCompletion")).replace("export function", "function") + ";captureSourceSnapshot", {
      fs: racedFs, path, process, spawnSync, digest, demand: (ok, message) => { if (!ok) throw Error(message); },
    });
    const raced=capture(raceCwd,diff);
    assert.equal(changed,true,'race fixture did not mutate the aliased source');
    assert.equal(raced.complete, false, "concurrent source must not bind to an older reviewed diff");
    fs.writeFileSync(path.join(cwd, "x.txt"), "stale\n"); assert.equal(captureSourceSnapshot(cwd, diff).complete, false);
    fs.writeFileSync(path.join(cwd, "blob.bin"), Buffer.from([0,5,6])); assert.equal(captureSourceSnapshot(cwd, git(["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"])).complete, false);
    fs.writeFileSync(path.join(cwd, "blob.bin"), Buffer.from([0,1,2])); fs.unlinkSync(path.join(cwd, "blob.bin")); assert.equal(captureSourceSnapshot(cwd, git(["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"])).complete, false);
  });
  test("junction evidence cannot escape project", () => {
    const link = path.join(fixture, "evidence-link"); fs.symlinkSync(path.join(fixture, "evidence"), link, process.platform === "win32" ? "junction" : "dir");
    const malicious = rows.map(r => r.disposition === "applied" ? { ...r, verification: { ...r.verification, path: "evidence-link/after.json" } } : r);
    decisions(malicious); assert.equal(healthy().complete, false); decisions(rows); fs.unlinkSync(link);
  });
  test("peer-authored command never executed", () => assert(!fs.existsSync(path.join(fixture, "PEER_EXECUTED"))));
  test("real completion CLI and ledger rebuild", () => { const result = run([path.join(scripts, "governor.mjs"), "--run", report.run_id, "--record"]); assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).ledger_rebuilt, true); assert.match(fs.readFileSync(path.join(fixture, ".ensemble_reviews/ledger.html"), "utf8"), /Local completion evidence validated/); });
  process.stdout.write(JSON.stringify({ passed: true, tests: passed, model_calls: 0, limitations: "Controlled reviewer replies and governor-authored execution; not live provider/harness certification" }, null, 2) + "\n");
} finally {
  const resolved = path.resolve(fixture), temp = path.resolve(os.tmpdir());
  if (resolved.startsWith(temp + path.sep) && path.basename(resolved).startsWith("momm-governor-test-")) fs.rmSync(resolved, { recursive: true, force: true });
}
