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
import { inspectCompletion, recordCompletion, captureSourceSnapshot, normalizeTarget, digest, reviewStaleness } from "./governor.mjs";
import { resolveGit as resolveGitForTest } from './governor.mjs';
import { pathEntryOutside, executableOutside } from './process-scope.mjs';
import { classifyStyleChange, STYLE_DIRECTIVES, STYLE_CLASSIFIER_VERSION } from "./style-classifier.mjs";
import { commandShapeSha256 } from "./route-isolation.mjs";
// Git by resolved absolute path, never a bare name: see executable-resolution.test.mjs.
const GIT = resolveGitForTest(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')) ?? 'git-not-found-outside-the-checkout';
import { PEER_CONTRACT, reviewProblem } from "./review-contract.mjs";
import { evidenceLocation } from "./evidence-location.mjs";
import {privateTestFixture} from './private-test-fixture.mjs';
const scripts = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(scripts, "multi-review.mjs"), "utf8");
// Execute production parser/normalizer/aggregation functions, not a copied algorithm.
const core = vm.runInNewContext(source.slice(source.indexOf("function extractJsonObjects("), source.indexOf("function classifyFailure("))
  + source.slice(source.indexOf("function fingerprint("), source.indexOf("function buildInsights("))
  + "\n({unwrapReviewPayload,normalizeReview,rationalize,buildOutstanding})", {
    PEER_CONTRACT, VALID_VERDICTS: new Set(["ACCEPT", "MODIFY", "REJECT"]), VALID_SEVERITIES: new Set(["CRITICAL", "WARNING", "NITPICK"]), fs, os, path, evidenceLocation, process,
  });
const passed = [];
const test = (name, fn) => { fn(); passed.push(name); };
const fixture = privateTestFixture("momm-governor-test-");
const write = (relative, value) => { const file = path.join(fixture, relative); fs.mkdirSync(path.dirname(file), { recursive: true, mode:0o700 }); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", {mode:0o600}); return file; };
const ref = relative => ({ path: relative, sha256: digest(fs.readFileSync(path.join(fixture, relative))) });
const run = args => spawnSync(process.execPath, args, { cwd: fixture, encoding: "utf8", timeout: 30000, windowsHide: true,
  env: { ...process.env, NO_UPDATE_CHECK: "1", MOMM_NO_UPDATE_CHECK: "1", DO_NOT_TRACK: "1" } });
const good = 'module.exports = a => a.reduce((s, x) => s + x, 0) / a.length;\n';
const buggy = good.replace("/ a.length", "/ (a.length + 1)");
const peer = (changes = {}) => ({ review_status: "complete", reviewed_scope: [{ quote: "a.length", assessment: "The denominator determines the arithmetic mean." }], verdict: "ACCEPT", confidence: 0, summary: "The arithmetic mean calculation is assessed below.", findings: [], suggested_improvements: [], ...changes });
try {
  test("completed clean review and zero confidence remain valid", () => assert.equal(reviewProblem(peer(), good), null));
  // Owner decision, 25 September 2026: line endings, typographic look-alikes and runs of whitespace
  // compare equal (review-contract.mjs lookAlike); any other changed character is still refused.
  test('quotation matching tolerates line endings and whitespace runs, never a changed character', () => {
    const sample='const x = 1;\nconst y = 2;';
    const p=peer({reviewed_scope:[{quote:sample,assessment:'Two constant declarations.'}]});
    assert.equal(reviewProblem(p,sample.replaceAll('\n','\r\n')),null);
    assert.equal(reviewProblem({...p,reviewed_scope:[{quote:sample.replaceAll('\n','\r\n'),assessment:'Two declarations.'}]},sample),null);
    assert(reviewProblem(p,sample.replace('x = 1','x = 9')));
    assert.equal(reviewProblem(p,sample.replace('x = 1','x  = 1')),null);
    assert(reviewProblem(p,sample.replace('x = 1','x = 1;')));
  });
  test('a literal excerpt ending between CR and LF still matches', () => {
    const quote='const x = 1;\r';
    const p=peer({reviewed_scope:[{quote,assessment:'Literal source excerpt ending at CR.'}]});
    assert.equal(reviewProblem(p,'const x = 1;\r\nconst y = 2;'),null);
    // Whitespace-only differences compare equal since the owner decision of 25 September 2026.
    assert.equal(reviewProblem(p,'const x = 1;\nconst y = 2;'),null,'a trailing CR is whitespace');
    assert(reviewProblem(p,'const x = 2;\nconst y = 2;'),'a changed character is still refused');
  });
  test('diff scope preserves prefixes instead of reconstructing source', () => {
    const artifact = '+  const value = read();\n+  return value;\n';
    const check = quote => reviewProblem(peer({ reviewed_scope: [{ quote, assessment: 'The value is read then returned.' }] }), artifact);
    assert.equal(check('+  const value = read();\n+  return value;'), null);
    assert.equal(check('const value = read();'), null, 'a literal single-line substring is valid');
    assert(check('  const value = read();\n  return value;'), 'stripping diff prefixes must remain invalid');
    // Owner decision, 25 September 2026: runs of whitespace compare equal, so a reindented quote is
    // accepted as evidence of scope; the diff markers are characters and must still be kept.
    assert.equal(check('+ const value = read();\n+ return value;'), null, 'reindentation is a whitespace-run difference');
    assert(check('+ const value = read();\n  return value;'), 'a dropped diff marker is still refused');
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
  // 1.17 B2 typed claims (plan-1.17.md). The type is additive and separate from severity.
  const typed = (claim_type, extra = {}) => ({ id: "typed-claim", severity: "WARNING", target_file: null, line_range: null, issue: "The typed claim issue.", rationale: "The typed claim reason.", test_suggestion: null, ...(claim_type === undefined ? {} : { claim_type }), ...extra });
  test("B2: a typed claim survives validation and normalisation; an untyped claim stays valid", () => {
    for (const t of ["DEFECT", "RISK", "QUESTION", "IDEA", "NOISE"]) {
      assert.equal(reviewProblem(peer({ findings: [typed(t)] }), good), null, t);
      assert.equal(core.normalizeReview("claude", peer({ findings: [typed(t)] })).findings[0].claim_type, t);
    }
    assert.equal(reviewProblem(peer({ findings: [typed(undefined)] }), good), null);
    assert.equal(reviewProblem(peer({ findings: [typed(null)] }), good), null);
    assert.equal(core.normalizeReview("claude", peer({ findings: [typed(undefined)] })).findings[0].claim_type, null, "an untyped claim is recorded as null");
  });
  test("B2: an unknown claim_type is refused, never coerced", () => {
    for (const bad of ["BUG", "defect", "", 1, ["DEFECT"], {}]) assert.match(reviewProblem(peer({ findings: [typed(bad)] }), good) ?? "accepted", /claim_type/, JSON.stringify(bad));
  });
  test("B2: a merged claim takes the most blocking type of its sources and a merge never lowers it", () => {
    const merge = (...types) => core.rationalize(types.map((t, i) => ({ agent: `route${i}`, status: "success", review: core.normalizeReview(`route${i}`, peer({ findings: [typed(t)] })) })), { artifact: good });
    const one = (...types) => { const merged = merge(...types); assert.equal(merged.length, 1, "same-id claims must merge"); assert.equal(merged[0].sources.length, types.length); return merged[0].claim_type; };
    assert.equal(one("NOISE", "RISK"), "RISK");
    assert.equal(one("RISK", "NOISE"), "RISK");
    assert.equal(one("QUESTION", "DEFECT", "IDEA"), "DEFECT");
    assert.equal(one("IDEA", "QUESTION"), "QUESTION");
    assert.equal(one(undefined, "IDEA"), "IDEA");
    assert.equal(one("NOISE", undefined), "NOISE");
    assert.equal(one(undefined, undefined), null);
  });
  test("B2: severity gates independently of type: a CRITICAL IDEA and a WARNING NOISE are still material", () => {
    for (const [type, severity] of [["IDEA", "CRITICAL"], ["NOISE", "WARNING"]]) {
      const review = core.normalizeReview("claude", peer({ findings: [typed(type, { severity })] }));
      assert.equal(review.findings[0].claim_type, type);
      const results = [{ agent: "claude", status: "success", review }];
      const merged = core.rationalize(results, { artifact: good });
      assert.equal(core.buildOutstanding(merged, results, "rev_typed_material", fixture, 1).material_findings_awaiting_reproduction, 1);
    }
  });
  // 1.17 A3 image observations: kept as unverifiable observations, never as quotes.
  test("A3: observation entries are recorded as unverifiable observations; unknown bounds are recorded as unchecked", () => {
    const sha = "a".repeat(64);
    const payload = peer({ reviewed_scope: [peer().reviewed_scope[0], { attachment_sha256: sha, observation: "A red square fills the frame.", assessment: "Matches the brief.", region: [0, 0, 8, 8] }] });
    const checked = core.normalizeReview("claude", payload, { attachments: [{ sha256: sha, width: 64, height: 64 }] }).reviewed_scope;
    assert.equal(checked[0].quote, "a.length"); assert.equal(checked[0].kind, undefined, "quote entries are unchanged");
    assert.equal(checked[1].kind, "observation"); assert.equal(checked[1].quote, undefined); assert.equal(checked[1].attachment_sha256, sha);
    assert.equal(checked[1].unverifiable, true); assert.equal(checked[1].region.join(","), "0,0,8,8"); assert.equal(checked[1].region_unchecked, undefined);
    const unchecked = core.normalizeReview("claude", payload, { attachments: [{ sha256: sha }] }).reviewed_scope[1];
    assert.equal(unchecked.kind, "observation"); assert.equal(unchecked.region_unchecked, true);
  });

  // 1.17 B4.1: `style` is decided mechanically from the bytes, never from the governor's label.
  const S = (file, before, after) => classifyStyleChange(file, Buffer.isBuffer(before) ? before : Buffer.from(before), Buffer.isBuffer(after) ? after : Buffer.from(after));
  test('mechanical style: whitespace and comment-only edits classify as style', () => {
    for (const [file, before, after] of [
      ['a.js', 'x();\n', 'x();\n'],
      ['README.md', 'unchanged\n', 'unchanged\n'],
      ['a.js', 'x();\n', '// explain x\nx();\n'],
      ['a.mjs', '// old words\nx();\n', '// new words\nx();\n'],
      ['a.cjs', 'x();\n', '    x();   \n'],
      ['a.cjs', 'x();\r\n', 'x();\n'],
      ['a.ts', 'x();\ny();\n', 'x();\n\ny();\n'],
      ['a.tsx', 'const a = 1;\n', '/* note */\nconst a = 1;\n'],
      ['a.js', 'if (a) {\n  b();\n}\n', 'if (a) {\n\tb();\n}\n'],
      ['a.js', 'const r = /\\/\\//;\n', '// matches two slashes\nconst r = /\\/\\//;\n'],
      ['a.java', 'int x = 1;\n', '// why\nint x = 1;\n'],
      ['a.go', 'x := 1\n', '// why\nx := 1\n'],
      ['a.rs', 'let x = 1;\n', '// why\nlet x = 1;\n'],
      ['a.c', 'int x;\n', '/* why */\nint x;\n'],
      ['a.css', 'a { color: red; }\n', '/* brand */\na { color: red; }\n'],
      ['a.py', '# old\nx = 1\n', '# new\nx = 1\n'],
      ['a.py', 'x = 1\ny = 2\n', 'x = 1\n\ny = 2\n'],
      ['a.sh', 'echo hi\n', '# greet\necho hi\n'],
      ['a.bash', 'echo "${#arr[@]}"\n', 'echo "${#arr[@]}"\n# count\n'],
      ['a.yaml', 'a: 1\n', '# setting\na: 1\n'],
      ['a.yml', 'a: 1 # old\n', 'a: 1 # old\n# new line\n'],
      ['a.toml', 'a = 1\n', '# setting\na = 1\n'],
      ['a.rb', 'puts 1\n', '# say\nputs 1\n'],
      ['a.ps1', 'Write-Host 1\n', '# say\nWrite-Host 1\n'],
    ]) { const r = S(file, before, after); assert.equal(r.style, true, `${file}: ${JSON.stringify(r)}`); assert.equal(r.reason, null); }
  });
  test('mechanical style: a commented-out code line is behavior (the change_kind loophole)', () => {
    const r = S('src/a.js', 'a();\nb();\n', 'a();\n// b();\n');
    assert.equal(r.style, false); assert.equal(r.reason, 'src/a.js:2 changes code');
    assert.match(S('a.js', 'a();\n// b();\n', 'a();\nb();\n').reason, /a\.js:2 changes code/, 'a comment turned into code is behavior too');
    assert.match(S('a.py', 'x = 1\n', '# x = 1\n').reason, /a\.py:1 changes code/);
    assert.match(S('a.sh', 'rm -rf build\n', '# rm -rf build\n').reason, /a\.sh:1 changes code/);
    assert.match(S('a.css', 'a { color: red; }\n', '/* a { color: red; } */\n').reason, /changes code/);
  });
  test('mechanical style: code, string content, trailing comments and hidden strings count as code', () => {
    for (const [file, before, after] of [
      ['a.js', 'x = a + 1;\n', 'x = a + 2;\n'],
      ['a.js', 's = "a b";\n', 's = "a  b";\n'],
      ['a.js', 'return x;\n', 'returnx;\n'],
      ['a.js', 'x();\n', 'x(); // why\n'],
      ['a.js', 'a = b + c;\n', 'a = b +\n  c;\n'],
      ['a.js', 'const t = `\n// inside\n`;\n', 'const t = `\n// changed\n`;\n'],
      ['a.js', 'const t = `\nx\n`;\n', 'const t = `\n  x\n`;\n'],
      ['a.js', 'const t = `${a}\n// inside\n`;\n', 'const t = `${a}\n// changed\n`;\n'],
      ['a.js', '/*\n * old\n */\nx();\n', '/*\n * new\n */\nx();\n'],
      ['a.py', 's = """\n# inside\n"""\n', 's = """\n# changed\n"""\n'],
      ['a.py', "s = '''\n# inside\n'''\n", "s = '''\n# changed\n'''\n"],
      ['a.yaml', 'run: |\n  # inside\n  echo\n', 'run: |\n  # changed\n  echo\n'],
      ['a.sh', 'cat <<EOF\n# inside\nEOF\n', 'cat <<EOF\n# changed\nEOF\n'],
      ['a.sh', 'echo "a\n# inside\n"\n', 'echo "a\n# changed\n"\n'],
      ['a.rb', 'x = <<~TXT\n  # inside\nTXT\n', 'x = <<~TXT\n  # changed\nTXT\n'],
      ['a.toml', 's = """\n# inside\n"""\n', 's = """\n# changed\n"""\n'],
      ['a.ps1', "$s = @'\n# inside\n'@\n", "$s = @'\n# changed\n'@\n"],
      ['a.rs', 'let s = r#"\n// inside\n"#;\n', 'let s = r#"\n// changed\n"#;\n'],
      ['a.rs', 'let s = "\n// inside\n";\n', 'let s = "\n// changed\n";\n'],
      ['a.cs', 'var s = @"\n// inside\n";\n', 'var s = @"\n// changed\n";\n'],
      ['a.go', 's := `\n// inside\n`\n', 's := `\n// changed\n`\n'],
      ['a.java', 'String s = """\n// inside\n""";\n', 'String s = """\n// changed\n""";\n'],
      ['a.c', '// note\nint x;\n', '// note \\\nint x;\n'],
      ['a.c', '#define X a \\\n  b\n', '#define X a \\\n\n  b\n'],
    ]) { const r = S(file, before, after); assert.equal(r.style, false, `${file} ${JSON.stringify(after)} must not be style`); assert.match(r.reason, /changes code|unclassifiable/, r.reason); }
  });
  test('mechanical style: a comment carrying a tool directive is behavior', () => {
    for (const id of ['eslint-disable', 'eslint-enable', '@ts-ignore', '@ts-expect-error', '@ts-nocheck', 'prettier-ignore', 'istanbul ignore', 'c8 ignore', 'noqa', 'type: ignore', 'pragma', '#!', '-*- coding', 'nolint', 'NOSONAR'])
      assert(STYLE_DIRECTIVES.some(d => d.id === id), `directive list must carry ${id}`);
    assert.match(STYLE_CLASSIFIER_VERSION, /^momm-style\/\d+$/);
    for (const [file, before, after] of [
      ['a.js', 'x();\n', '// eslint-disable-next-line\nx();\n'],
      ['a.js', '// eslint-disable-next-line no-console\nx();\n', 'x();\n'],
      ['a.js', '/* eslint-enable */\nx();\n', 'x();\n'],
      ['a.ts', '// @ts-ignore\nx();\n', '// @ts-expect-error\nx();\n'],
      ['a.ts', 'x();\n', '// @ts-nocheck\nx();\n'],
      ['a.js', 'x();\n', '/* istanbul ignore next */\nx();\n'],
      ['a.js', 'x();\n', '// c8 ignore next\nx();\n'],
      ['a.js', 'x();\n', '// prettier-ignore\nx();\n'],
      ['a.py', 'x = 1\n', '# noqa: E501\nx = 1\n'],
      ['a.py', 'x = 1\n', '# type: ignore\nx = 1\n'],
      ['a.py', 'x = 1\n', '# pragma: no cover\nx = 1\n'],
      ['a.py', 'x = 1\n', '# -*- coding: latin-1 -*-\nx = 1\n'],
      ['a.sh', '#!/bin/bash\necho\n', '#!/bin/sh\necho\n'],
      ['a.go', 'x()\n', '//nolint:errcheck\nx()\n'],
      ['a.java', 'x();\n', '// NOSONAR\nx();\n'],
    ]) { const r = S(file, before, after); assert.equal(r.style, false, `${file}: ${after}`); assert.match(r.reason, new RegExp(`^${file.replace('.', '\\.')}:\\d+ carries a directive$`), r.reason); }
  });
  test('mechanical style: whitespace-significant files fail closed on whitespace changes to code', () => {
    assert.match(S('a.py', 'if a:\n    b()\n', 'if a:\n  b()\n').reason, /a\.py:2 changes whitespace in a whitespace-significant file/);
    assert.match(S('a.yml', 'a:\n  b: 1\n', 'a:\n    b: 1\n').reason, /whitespace-significant/);
    assert.match(S('a.py', 'x = 1\n', 'x = 1   \n').reason, /whitespace-significant/);
    for (const file of ['Makefile', 'makefile', 'rules.mk', 'Main.hs']) assert.match(S(file, 'all:\n\techo\n', 'all:\n\techo\n# note\n').reason, /unclassifiable/, file);
  });
  test('mechanical style: files without a known comment syntax are unclassifiable', () => {
    for (const [file, before, after] of [
      ['README.md', 'a\n', 'b\n'], ['a.json', '{"a":1}\n', '{"a": 1}\n'], ['a.html', '<p>a</p>\n', '<!-- n -->\n<p>a</p>\n'],
      ['a.unknown', 'a\n', ' a\n'], ['LICENSE', 'a\n', 'a \n'],
      ['a.js', Buffer.from([0x78, 0x00, 0x0a]), Buffer.from([0x78, 0x00, 0x0a, 0x0a])],
      ['a.js', Buffer.from([0x78, 0xff, 0x0a]), Buffer.from([0x78, 0xff, 0x0a, 0x0a])],
      ['a.js', '// @generated by protoc\nx();\n', '// @generated by protoc\n// hi\nx();\n'],
      ['a.go', '// Code generated by stringer. DO NOT EDIT.\nx()\n', '// Code generated by stringer. DO NOT EDIT.\n\nx()\n'],
      ['vendor.min.js', 'x();\n', '// hi\nx();\n'],
      ['a.jsx', 'const a = (\n  <div>\n    // hello\n  </div>\n);\n', 'const a = (\n  <div>\n    // goodbye\n  </div>\n);\n'],
      ['a.swift', 'let s = #"\n// inside\n"#\n', 'let s = #"\n// changed\n"#\n'],
    ]) { const r = S(file, before, after); assert.equal(r.style, false, file); assert.match(r.reason, /unclassifiable/, `${file}: ${r.reason}`); }
  });
  test('mechanical style: a long minified line is classified in linear time', () => {
    // A per-character slice made this quadratic: 400 KB took minutes. Linear, it is well under a second.
    const line = 'x = a(b)/c; ' + 'q(r)/s; '.repeat(50_000) + '\n', started = Date.now();
    assert.equal(S('a.js', line, '// minified\n' + line).style, true);
    assert(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
  });

  write("mean.cjs", buggy);
  write("mean.test.cjs", 'const assert = require("node:assert/strict"); const mean = require("./mean.cjs"); assert.equal(mean([2,4]),3); assert.equal(mean([1,2]),1.5); console.log("mean checks passed");\n');
  const dispatch = run([path.join(scripts, "multi-review.mjs"), "--governor", "codex", "--reviewers", "codex", "--input", "mean.cjs", "--min-success", "1", "--no-ui"]);
  const base = JSON.parse(dispatch.stdout);
  test("real dispatcher self-excludes governor and refuses quorum", () => { assert.equal(dispatch.status, 3); assert.equal(base.reviewers[0].status, "self_excluded"); assert.equal(base.outstanding.complete, false); });
  test("real dispatcher captures reviewed source", () => assert.equal(base.source_snapshot.files[0].sha256, digest(buggy)));
  // Typed IDEA on purpose: a real defect mistyped as an idea must still gate on its severity (plan-1.17 gate self-audit).
  const finding = { id: "wrong-divisor", severity: "WARNING", claim_type: "IDEA", target_file: "mean.cjs", line_range: [1, 1], issue: "The extra divisor count produces an incorrect mean.", rationale: "[2,4] must average to 3.", test_suggestion: 'require("fs").writeFileSync("PEER_EXECUTED", "bad")' };
  const responses = [
    { agent: "claude", status: "success", review: core.normalizeReview("claude", peer({ verdict: "MODIFY", findings: [finding], suggested_improvements: ["Round all results", "Change the public API"] })) },
    { agent: "grok", status: "success", review: core.normalizeReview("grok", peer({ verdict: "MODIFY", suggested_improvements: ["Keep fractional precision", "Change the public API"] })) },
  ];
  const findings = core.rationalize(responses, { artifact: buggy, prose: false });
  const report = { ...base, attempt_evidence: undefined, attempt_accounting: undefined, test_fixture: "controlled reviewer transport; not real provider approval", run_id: "rev_fixture_lifecycle", source_snapshot: captureSourceSnapshot(fixture, buggy, "mean.cjs"),
    quorum: { required: 2, achieved: 2, met: true }, gate_policy: { strict: false, quorum_required: 2, requested_routes: ["claude", "grok"] },
    reviewers: responses.map(r => ({ agent: r.agent, status: r.status, verdict: r.review.verdict, confidence: r.review.confidence, summary: r.review.summary, review_contract: PEER_CONTRACT, reviewed_scope: r.review.reviewed_scope, suggested_improvements: r.review.improvements,
      // B6: a 1.17 report records `role`; an older one only `persona`, which stands in for it.
      ...(r.agent === "claude" ? { role: "adversary", persona: "adversary" } : { persona: "architect" }) })),
    findings, outstanding: core.buildOutstanding(findings, responses, "rev_fixture_lifecycle", fixture, 2) };
  const reportPath = `.ensemble_reviews/reports/${report.run_id}.json`;
  write(reportPath, report);
  const sealed = ref(reportPath);
  write(".ensemble_reviews/review-log.jsonl", JSON.stringify({ run_id: report.run_id, governor: "codex", report_path: reportPath, report_sha256: sealed.sha256, input_sha256: report.input_sha256, reviewer_status: { claude: "success", grok: "success" } }) + "\n");
  const pending = inspectCompletion(fixture, report.run_id);
  test("quorum alone cannot complete governor work", () => { assert.equal(report.outstanding.complete, false); assert.equal(pending.complete, false); assert.equal(pending.items.length, 5, JSON.stringify(pending.errors)); });
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
  // B2: the governor may re-type (or re-grade) a claim only in its decision row, recorded against the report's value.
  const onFinding = change => rows.map(r => r.finding_id ? { ...r, ...change } : r);
  const withRows = (value, fn) => { decisions(value); try { return fn(healthy()); } finally { decisions(rows); } };
  test("B2: the report keeps the merged claim type and a WARNING IDEA still awaits reproduction", () => {
    assert.equal(report.findings[0].claim_type, "IDEA");
    assert.equal(report.outstanding.material_findings_awaiting_reproduction, 1);
  });
  test("B2: an unrecorded re-type in a decision row is refused", () => withRows(onFinding({ claim_type: "DEFECT" }), result => {
    assert.equal(result.complete, false);
    assert(result.unresolved.some(u => /re-typ/.test(u.reason)), JSON.stringify(result.unresolved));
  }));
  for (const [name, change] of [
    ["a re-type naming the wrong original type", { claim_type: "DEFECT", retyped_from: "RISK", retype_reason: "Reproduced as a real defect." }],
    ["a re-type without a reason", { claim_type: "DEFECT", retyped_from: "IDEA", retype_reason: "  " }],
    ["a re-type to an unknown type", { claim_type: "BUG", retyped_from: "IDEA", retype_reason: "Reproduced." }],
    ["a stray retyped_from that is not the report's type", { retyped_from: "NOISE", retype_reason: "Reproduced." }],
    ["an unrecorded severity change", { severity: "NITPICK" }],
    ["a severity change naming the wrong original", { severity: "NITPICK", severity_from: "CRITICAL", severity_reason: "Cosmetic only." }],
    ["a severity change without a reason", { severity: "NITPICK", severity_from: "WARNING" }],
  ]) test(`B2: ${name} is refused`, () => withRows(onFinding(change), result => assert.equal(result.complete, false, JSON.stringify(change))));
  test("B2: a recorded re-type is accepted", () => withRows(onFinding({ claim_type: "DEFECT", retyped_from: "IDEA", retype_reason: "Reproduced by mean.test.cjs; a real defect, not an idea." }),
    result => assert.equal(result.complete, true, JSON.stringify(result.unresolved))));
  test("B2: a decision row repeating the report's type needs no re-type record", () => withRows(onFinding({ claim_type: "IDEA" }), result => assert.equal(result.complete, true, JSON.stringify(result.unresolved))));
  test("B2: a recorded severity lowering is accepted but never waives reproduction", () => {
    const lowered = { severity: "NITPICK", severity_from: "WARNING", severity_reason: "Governor judges the impact cosmetic." };
    withRows(onFinding(lowered), result => assert.equal(result.complete, true, JSON.stringify(result.unresolved)));
    withRows(onFinding({ ...lowered, change_kind: "style", reproduction: null }), result => assert.equal(result.complete, false, "the report's WARNING stays material"));
  });
  // B6: a decision row may carry `role`; when given it must be the report's role for that reviewer.
  test("B6: a decision row may copy its reviewer's role from the report", () => withRows(onFinding({ role: "adversary" }),
    result => assert.equal(result.complete, true, JSON.stringify(result.unresolved))));
  test("B6: for an older report the reviewer's persona is its role", () => withRows(rows.map(r => r.reviewer === "grok" ? { ...r, role: "architect" } : r),
    result => { assert(rows.some(r => r.reviewer === "grok")); assert.equal(result.complete, true, JSON.stringify(result.unresolved)); }));
  for (const [name, role] of [["a role the report does not record for that reviewer", "surgeon"], ["another reviewer's role", "architect"], ["an empty role", ""], ["a non-string role", 7]])
    test(`B6: ${name} is refused`, () => withRows(onFinding({ role }), result => {
      assert.equal(result.complete, false, JSON.stringify(role));
      assert(result.unresolved.some(u => /role/.test(u.reason)), JSON.stringify(result.unresolved));
    }));
  test("peer contract momm-peer-review/3 is current; a sealed 1.16.1 /2 report still validates; /1 stays legacy", () => {
    assert.equal(PEER_CONTRACT, "momm-peer-review/3");
    const originalLog = fs.readFileSync(path.join(fixture, ".ensemble_reviews/review-log.jsonl"), "utf8");
    try {
      for (const [contract, legacy] of [["momm-peer-review/3", false], ["momm-peer-review/2", false], ["momm-peer-review/1", true], [undefined, true]]) {
        const variant = { ...report, run_id: `rev_fixture_contract_${String(contract).replace(/\W/g, "_")}`, reviewers: report.reviewers.map(r => ({ ...r, review_contract: contract })) };
        const p = `.ensemble_reviews/reports/${variant.run_id}.json`; write(p, variant);
        fs.appendFileSync(path.join(fixture, ".ensemble_reviews/review-log.jsonl"), JSON.stringify({ run_id: variant.run_id, report_path: p, report_sha256: ref(p).sha256, input_sha256: variant.input_sha256 }) + "\n");
        const errors = inspectCompletion(fixture, variant.run_id).errors;
        assert.equal(errors.some(e => /legacy\/unverified reply contract/.test(e)), legacy, `${contract}: ${JSON.stringify(errors)}`);
      }
    } finally { write(".ensemble_reviews/review-log.jsonl", originalLog); }
  });
  test('growing append-only logs do not exhaust the per-evidence-file allowance',()=>{
    for(const name of ['review-log.jsonl','dispositions.jsonl']){
      const file=path.join(fixture,'.ensemble_reviews',name),original=fs.readFileSync(file);
      // Many individually bounded UTF-8 records; not one oversized record.
      const unrelated=(JSON.stringify({run_id:'rev_other',note:'é'.repeat(500)})+'\r\n').repeat(9000);
      try {fs.appendFileSync(file,unrelated);assert(fs.statSync(file).size>8_000_000);
        const result=healthy();assert.equal(result.complete,true,JSON.stringify(result.errors));
        assert.equal(result.validated_files['.ensemble_reviews/'+name],digest(fs.readFileSync(file)));
      } finally {fs.writeFileSync(file,original);}
    }
  });
  test('documented completion command runs from the reviewed project',()=>{
    const skill=fs.readFileSync(path.join(scripts,'../SKILL.md'),'utf8');
    const match=skill.match(/Run `node "([^"`]+\/governor\.mjs)" --run <run_id>` from the reviewed project/);
    assert(match,'completion invocation missing');
    const command=match[1].replace('<installed-momm>',path.dirname(scripts));
    const result=run([command,'--run',report.run_id]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).complete,true);
  });
  test('oversized records and corrupt unrelated log lines remain refused',()=>{
    const file=path.join(fixture,'.ensemble_reviews/review-log.jsonl'),original=fs.readFileSync(file);
    try {
      fs.appendFileSync(file,JSON.stringify({run_id:'rev_other',note:'x'.repeat(8_000_000)})+'\n');assert(healthy().errors.some(s=>s.includes('ledger record exceeds')));
      fs.writeFileSync(file,original);fs.appendFileSync(file,'{broken\n');assert.equal(healthy().complete,false);
    }finally {fs.writeFileSync(file,original);}
  });
  test('log growth during its fixed-size read is refused',()=>{
    const file=path.join(fixture,'.ensemble_reviews/review-log.jsonl'),original=fs.readFileSync(file),readSync=fs.readSync;let changed=false;
    fs.readSync=(fd,...args)=>{const n=readSync(fd,...args);if(!changed&&fs.fstatSync(fd).size===original.length){changed=true;fs.appendFileSync(file,'\n');}return n;};
    try{const result=healthy();assert(changed);assert.equal(result.complete,false);assert(result.errors.includes('evidence changed during read'));}
    finally{fs.readSync=readSync;fs.writeFileSync(file,original);}
  });
  // A separately sealed one-file run whose only obligation is one suggestion, closed as `style`.
  // `original` is reviewed; `changed` is what the governor leaves. Returns the validator's result.
  const styleCase = (id, file, original, changed, { baseline = true, storeInput = false, row: extra = {} } = {}) => {
    write(file, original);
    const styleReport = { ...report, run_id: id, input_sha256: digest(original), source_snapshot: captureSourceSnapshot(fixture, original, file), findings: [],
      reviewers: report.reviewers.map((r, i) => ({ ...r, suggested_improvements: i ? [] : ['Tidy the explanation'] })), ...(storeInput ? { input_text: original } : {}) };
    const p = `.ensemble_reviews/reports/${id}.json`; write(p, styleReport); const seal = ref(p);
    const log = path.join(fixture, '.ensemble_reviews/review-log.jsonl'), originalLog = fs.readFileSync(log);
    fs.appendFileSync(log, JSON.stringify({ run_id: id, governor: 'codex', report_path: p, report_sha256: seal.sha256, input_sha256: styleReport.input_sha256 }) + '\n');
    try {
      const item = inspectCompletion(fixture, id).items[0];
      const obs = (phase, at) => ({ schema: 'momm-check/1', run_id: id, item_id: phase === 'final' ? 'run' : item.item_id, report_sha256: seal.sha256, input_sha256: styleReport.input_sha256,
        phase, exit_code: 0, observed_at: at, command_label: 'node mean.test.cjs (governor-authored)', test: ref('mean.test.cjs'), output: ref('evidence/after.txt'), artifacts: [ref(file)] });
      let reproduction = null;
      if (baseline) {
        write(`evidence/${id}.original`, original);
        const b = obs('before', '2026-01-02T00:00:00Z'); b.artifacts[0].snapshot = ref(`evidence/${id}.original`);
        write(`evidence/${id}.before.json`, b); reproduction = ref(`evidence/${id}.before.json`);
      }
      write(file, changed);
      write(`evidence/${id}.after.json`, obs('after', '2026-01-02T00:00:01Z'));
      write(`.ensemble_reviews/verification/${id}.json`, obs('final', '2026-01-02T00:00:02Z'));
      const row = { run_id: id, governor: 'codex', reviewer: 'claude', item_id: item.item_id, report_sha256: seal.sha256, input_sha256: styleReport.input_sha256,
        suggestion: 'Tidy the explanation', disposition: 'applied', change_kind: 'style', reason: 'Comment-only edit; the same checks pass before and after.',
        verification: ref(`evidence/${id}.after.json`), ...(reproduction ? { reproduction } : {}), ...extra };
      decisions([...rows, row]);
      return { result: inspectCompletion(fixture, id), item };
    } finally { decisions(rows); fs.writeFileSync(log, originalLog); }
  };
  test('style-only suggestions need after evidence but not invented failing tests',()=>{
    // The baseline record may pass (exit 0): it supplies the reviewed bytes, not a failing test.
    const withBaseline = styleCase('rev_fixture_style_ok', 'style-ok.cjs', 'module.exports = 1;\n', '// The answer.\nmodule.exports = 1;\n').result;
    assert.equal(withBaseline.complete, true, JSON.stringify(withBaseline));
    // A report that stored its input carries the reviewed bytes itself.
    const stored = styleCase('rev_fixture_style_stored', 'style-stored.cjs', 'module.exports = 2;\n', '    module.exports = 2;\n', { baseline: false, storeInput: true }).result;
    assert.equal(stored.complete, true, JSON.stringify(stored));
  });
  test('a commented-out line recorded as style is refused (B4.1)', () => {
    const { result, item } = styleCase('rev_fixture_style_hidden', 'style-hidden.cjs', 'check();\nmodule.exports = 3;\n', '// check();\nmodule.exports = 3;\n');
    assert.equal(result.complete, false);
    assert.deepEqual(result.unresolved, [{ item_id: item.item_id, reason: 'change_kind style refused: style-hidden.cjs:1 changes code' }]);
  });
  test('style refusals name directives, unclassifiable files and missing baselines', () => {
    const reason = r => r.result.unresolved.map(u => u.reason).join('; ');
    assert.match(reason(styleCase('rev_fixture_style_directive', 'style-directive.cjs', 'module.exports = 4;\n', '// eslint-disable-next-line\nmodule.exports = 4;\n')),
      /^change_kind style refused: style-directive\.cjs:1 carries a directive$/);
    assert.match(reason(styleCase('rev_fixture_style_markdown', 'style-notes.md', '# Notes\n', '# Notes\n\nMore.\n')),
      /^change_kind style refused: style-notes\.md: file type unclassifiable/);
    assert.match(reason(styleCase('rev_fixture_style_python', 'style_indent.py', 'if True:\n    x = 1\n', 'if True:\n  x = 1\n')),
      /^change_kind style refused: style_indent\.py:2 changes whitespace in a whitespace-significant file$/);
    assert.match(reason(styleCase('rev_fixture_style_nobase', 'style-nobase.cjs', 'module.exports = 5;\n', '// Five.\nmodule.exports = 5;\n', { baseline: false })),
      /^change_kind style refused: style-nobase\.cjs: the reviewed bytes are not available/);
  });
  test('a style decision cannot cover a file whose code another fix changed', () => {
    // Before 1.17 this closed: the suggestion's after check bound mean.cjs, whose divisor the finding's fix changed.
    const item = pending.items.find(i => i.kind === 'suggestion'); write('evidence/style.json', observation(item.item_id, 'after', 'evidence/after.txt', 0, '2026-01-01T00:00:04Z'));
    decisions(rows.map(r => r.item_id === item.item_id ? { ...r, disposition: 'applied', change_kind: 'style', verification: ref('evidence/style.json') } : r));
    try {
      const result = healthy(); assert.equal(result.complete, false);
      assert.match(result.unresolved.find(u => u.item_id === item.item_id).reason, /^change_kind style refused: mean\.cjs: the reviewed bytes are not available/);
      // With the reviewed bytes available, the divisor fix itself is what refuses the label.
      const baseline = observation(item.item_id, 'before', 'evidence/after.txt', 0, '2026-01-01T00:00:00Z');
      baseline.artifacts = [{ path: 'mean.cjs', sha256: digest(buggy), snapshot: ref('evidence/original.cjs') }]; write('evidence/style-baseline.json', baseline);
      decisions(rows.map(r => r.item_id === item.item_id ? { ...r, disposition: 'applied', change_kind: 'style', verification: ref('evidence/style.json'), reproduction: ref('evidence/style-baseline.json') } : r));
      assert.equal(healthy().unresolved.find(u => u.item_id === item.item_id).reason, 'change_kind style refused: mean.cjs:1 changes code');
    } finally { decisions(rows); }
  });
  // 1.17 B4.2: a recorded mutation (the one decision's change reverted) is optional and only counted.
  const fixRow = () => rows.find(r => r.disposition === 'applied');
  const mutationRecord = (name, bytes, code, extra = {}) => {
    write(`evidence/${name}.mutated`, bytes);
    const m = observation(fixRow().item_id, 'mutation', 'evidence/before.txt', code, '2026-01-01T00:00:01.500Z');
    m.artifacts = [{ path: 'mean.cjs', sha256: digest(bytes), snapshot: ref(`evidence/${name}.mutated`) }];
    write(`evidence/${name}.json`, { ...m, ...extra }); return ref(`evidence/${name}.json`);
  };
  const withMutation = mutation => { decisions(rows.map(r => r === fixRow() ? { ...r, mutation } : r)); try { return healthy(); } finally { decisions(rows); } };
  test('mutation records are optional and reported as a count (B4.2)', () => {
    const plain = healthy();
    assert.equal(plain.complete, true);
    assert.deepEqual(plain.mutation, { applied_decisions: 1, with_mutation_record: 0, mutation_survived: [], invalid: [] });
    const counted = withMutation(mutationRecord('mutation-fails', buggy, 1));
    assert.equal(counted.complete, true, JSON.stringify(counted));
    assert.deepEqual(counted.mutation, { applied_decisions: 1, with_mutation_record: 1, mutation_survived: [], invalid: [] });
  });
  test('a surviving mutation is a warning, not a refusal', () => {
    const survived = withMutation(mutationRecord('mutation-survives', buggy, 0));
    assert.equal(survived.complete, true);
    assert.deepEqual(survived.mutation, { applied_decisions: 1, with_mutation_record: 0, mutation_survived: [fixRow().item_id], invalid: [] });
  });
  test('a mutation record that reverted nothing, or ran another test, never counts', () => {
    const nothing = withMutation(mutationRecord('mutation-nothing', good, 1));
    assert.equal(nothing.complete, true); assert.equal(nothing.mutation.with_mutation_record, 0);
    assert.match(nothing.mutation.invalid[0].reason, /reverted nothing/);
    write('other.test.cjs', 'process.exit(1)\n');
    const other = withMutation(mutationRecord('mutation-other', buggy, 1, { test: ref('other.test.cjs') }));
    assert.equal(other.mutation.with_mutation_record, 0); assert.match(other.mutation.invalid[0].reason, /same test/);
    const wrongPhase = withMutation(ref('evidence/before.json'));
    assert.equal(wrongPhase.mutation.with_mutation_record, 0); assert.match(wrongPhase.mutation.invalid[0].reason, /invalid check observation/);
  });
  // 1.17 B4.3: the review is compared with what is installed now; a stale review can still complete.
  test('current installation is not stale; a changed peer contract is (B4.3)', () => {
    const current = healthy();
    assert.equal(current.complete, true);
    assert.equal(current.stale.stale, false, JSON.stringify(current.stale));
    assert.deepEqual(current.stale.changed, []);
    for (const field of ['dispatcher_sha256', 'peer_contract_sha256', 'process_scope_sha256', 'governor_sha256']) assert(current.stale.matched.includes(field), field);
    const install = path.join(fixture, 'install-copy'), here = path.join(install, 'momm/scripts');
    fs.mkdirSync(here, { recursive: true });
    for (const name of ['multi-review.mjs', 'review-contract.mjs', 'process-scope.mjs', 'governor.mjs']) fs.copyFileSync(path.join(scripts, name), path.join(here, name));
    assert.deepEqual(inspectCompletion(fixture, report.run_id, { installRoot: install }).stale.changed, []);
    fs.appendFileSync(path.join(here, 'review-contract.mjs'), '\n// a later contract\n');
    const stale = inspectCompletion(fixture, report.run_id, { installRoot: install });
    assert.equal(stale.complete, true, 'a stale review can still be completed');
    // Per-route identity this older-shaped fixture does not record is unknown, never a match.
    const routeUnknown = ['claude', 'grok'].flatMap(r => ['cli_version', 'model', 'command_shape_sha256'].map(f => `reviewers.${r}.${f}`));
    // 1.17 B1: claude records a role (B6 fixture) but no role_brief, so its brief identity is unknown too.
    routeUnknown.push('reviewers.claude.role_brief');
    assert.deepEqual(stale.stale, { stale: true, changed: ['peer_contract_sha256'], unknown: routeUnknown, matched: ['dispatcher_sha256', 'process_scope_sha256', 'governor_sha256'] });
    fs.rmSync(install, { recursive: true, force: true });
  });
  test('absent identity is unknown, never a match; route identity is compared where recorded', () => {
    const older = { ...report }; delete older.dispatcher_sha256; delete older.guidance;
    const a = reviewStaleness(older, fixture);
    assert(a.unknown.includes('dispatcher_sha256') && a.unknown.includes('guidance') && !a.matched.includes('dispatcher_sha256') && !a.changed.includes('dispatcher_sha256'), JSON.stringify(a));
    const routed = { ...report, attachments: [{ name: 'shot.png', modality: 'image', bytes: 3, sha256: 'a'.repeat(64) }],
      reviewers: [{ ...report.reviewers[0], usage: { reported: { cli_version: '2.1.0', model: 'model-x' } }, command_shape_sha256: commandShapeSha256('claude', 'input', 'text') },
        { ...report.reviewers[1], command_shape_sha256: 'b'.repeat(64) }] };
    const b = reviewStaleness(routed, fixture);
    assert(b.matched.includes('reviewers.claude.command_shape_sha256'), JSON.stringify(b));
    assert(b.changed.includes('reviewers.grok.command_shape_sha256'), JSON.stringify(b));
    for (const field of ['reviewers.claude.cli_version', 'reviewers.claude.model', 'attachments.shot.png.sha256']) assert(b.unknown.includes(field), field);
    assert.equal(b.stale, true);
    const guided = { ...report, guidance: { routes: { claude: { sha256: 'c'.repeat(64), layers: [{ name: 'project:.reviewrules', sha256: 'd'.repeat(64) }] } }, governor_sha256: null } };
    const c = reviewStaleness(guided, fixture, { home: path.join(fixture, 'no-home') });
    assert(c.changed.includes('guidance.routes.claude'), JSON.stringify(c));
    const unguided = { ...report, guidance: { routes: { claude: { sha256: null, layers: [] } }, governor_sha256: null } };
    assert(reviewStaleness(unguided, fixture, { home: path.join(fixture, 'no-home') }).matched.includes('guidance.routes.claude'));
    // Receipts carry names and booleans only: no hashes, versions or text travel in this block.
    assert(!JSON.stringify(b).includes('2.1.0') && !JSON.stringify(b).includes('b'.repeat(64)));
  });
  test('an updated final manifest alone cannot justify changed source',()=>{
    const file=path.join(fixture,`.ensemble_reviews/verification/${report.run_id}.json`),original=fs.readFileSync(file);
    write('mean.cjs',good+'// unaccounted change\n');write(`.ensemble_reviews/verification/${report.run_id}.json`,observation('run','final','evidence/after.txt',0,'2026-01-01T00:00:05Z'));
    try{assert.equal(healthy().complete,false);}finally{write('mean.cjs',good);fs.writeFileSync(file,original);}
  });
  test('a rejected nonexistent target must remain absent',()=>{
    const id='rev_fixture_absent_target',target='never-created.cjs';
    const absentReport={...report,run_id:id,input_sha256:digest(good),source_snapshot:captureSourceSnapshot(fixture,good,'mean.cjs'),findings:[{...findings[0],target_file:target}],reviewers:report.reviewers.map(r=>({...r,suggested_improvements:[]}))};
    const p=`.ensemble_reviews/reports/${id}.json`;write(p,absentReport);const seal=ref(p);
    const log=path.join(fixture,'.ensemble_reviews/review-log.jsonl'),original=fs.readFileSync(log);
    fs.appendFileSync(log,JSON.stringify({run_id:id,governor:'codex',report_path:p,report_sha256:seal.sha256,input_sha256:absentReport.input_sha256,reviewer_status:{claude:'success',grok:'success'}})+'\n');
    const item=inspectCompletion(fixture,id).items[0];
    const check={...observation(item.item_id,'investigation','evidence/after.txt',0,'2026-01-01T00:00:06Z'),run_id:id,report_sha256:seal.sha256,input_sha256:absentReport.input_sha256,absent_paths:[target]};
    write('evidence/absent.json',check);write(`.ensemble_reviews/verification/${id}.json`,{...check,item_id:'run',phase:'final'});
    const row={run_id:id,governor:'codex',reviewer:'claude',item_id:item.item_id,report_sha256:seal.sha256,input_sha256:absentReport.input_sha256,disposition:'rejected',reason:'Controlled nonexistent-target fixture.',verification:ref('evidence/absent.json')};decisions([...rows,row]);
    try{assert.equal(inspectCompletion(fixture,id).complete,true,JSON.stringify(inspectCompletion(fixture,id)));write(target,'now exists\n');assert.equal(inspectCompletion(fixture,id).complete,false);}
    finally{if(fs.existsSync(path.join(fixture,target)))fs.unlinkSync(path.join(fixture,target));decisions(rows);fs.writeFileSync(log,original);}
  });
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
  test('the recorded receipt carries the stale and mutation blocks', () => {
    const receipt = JSON.parse(fs.readFileSync(path.join(fixture, '.ensemble_reviews/completions', report.run_id + '.json'), 'utf8'));
    assert.deepEqual(Object.keys(receipt.stale), ['stale', 'changed', 'unknown', 'matched']);
    assert.equal(receipt.stale.stale, false);
    assert.deepEqual(receipt.mutation, { applied_decisions: 1, with_mutation_record: 0, mutation_survived: [], invalid: [] });
  });
  test('re-recording preserves the previous receipt by content hash',()=>{
    const file=path.join(fixture,'.ensemble_reviews/completions',report.run_id+'.json'),before=fs.readFileSync(file);
    recordCompletion(fixture,report.run_id);
    assert.deepEqual(fs.readFileSync(path.join(fixture,'.ensemble_reviews/completions',report.run_id+'.'+digest(before)+'.json')),before);
  });
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
  test("stale direct source input refused", () => assert.equal(captureSourceSnapshot(fixture, buggy, "mean.cjs").complete, false));
  test("finding paths preserve actual a/b directories before removing diff prefixes", () => {
    const target = (name, paths) => normalizeTarget(name, paths.map(path => ({path})), fixture);
    assert.equal(target("a/mean.cjs", ["a/mean.cjs", "mean.cjs"]), "a/mean.cjs");
    assert.equal(target("a/mean.cjs", ["mean.cjs"]), "mean.cjs");
    assert.equal(target("b/other.cjs", ["mean.cjs"]), "b/other.cjs");
    assert.equal(target('mean.cjs:1', ['mean.cjs']), 'mean.cjs');
    assert.equal(target('a/mean.cjs:1-2', ['mean.cjs']), 'mean.cjs');
    assert.equal(target(path.join(fixture, 'mean.cjs')+':1', ['mean.cjs']), 'mean.cjs');
    assert.equal(target('../outside.cjs:1', ['mean.cjs']), '../outside.cjs:1');
    assert.equal(target('a/mean.cjs:1', ['a/mean.cjs','mean.cjs']), 'a/mean.cjs');
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
    const capture=vm.runInNewContext(gov.slice(gov.indexOf('export function captureSourceSnapshot'),gov.indexOf('export function normalizeTarget')).replaceAll('export function','function')+';captureSourceSnapshot',
      {fs:fakeFs,path:path.win32,process:{platform:'win32',env:{Path:'Q:\\git\\cmd'}},digest,pathEntryOutside,executableOutside,demand:(ok,message)=>{if(!ok)throw Error(message);},spawnSync:(_cmd,args)=>(assert.equal(_cmd,'Q:\\git\\cmd\\git.exe','Git is launched by its absolute PATH location, never by bare name'),{status:0,stdout:args[0]==='rev-parse'?'Q:\\runner.long\\repo\n':args.includes('--name-status')?'M\0x.txt\0':artifact})});
    const result=capture('Q:\\RUNNER~1\\repo',artifact);assert.equal(result.complete,true,result.reason);
    assert.match(capture('Q:\\RUNNER~1\\repo\\child',artifact).reason,/repository root/);
  });
  // 1.17 A1 (29 September 2026): off Windows the snapshot's Git was the bare name "git", so a PATH
  // entry inside the reviewed project could supply the Git that verifies it. It is now resolved like the
  // range snapshot's: an executable outside the project on an absolute PATH entry outside it, or refusal.
  test('POSIX Git for the diff snapshot comes from an absolute PATH entry outside the project, never a bare name',()=>{
    const gov=fs.readFileSync(path.join(scripts,'governor.mjs'),'utf8');
    const artifact='diff --git a/x.txt b/x.txt\n';
    const present={'/usr/bin/git':0o100755,'/repo/bin/git':0o100755};
    const fakeFs={realpathSync:Object.assign(p=>p,{native:p=>p}),statSync:p=>p in present?{isFile:()=>true,mode:present[p],size:8}:(p.startsWith('/repo/')&&!p.startsWith('/repo/bin'))?{isFile:()=>true,mode:0o100644,size:8}:(()=>{throw Object.assign(Error('ENOENT'),{code:'ENOENT'});})(),readFileSync:()=>Buffer.from('fixture\n')};
    const launched=[];
    const context={fs:fakeFs,path:path.posix,digest,demand:(ok,message)=>{if(!ok)throw Error(message);},pathEntryOutside,executableOutside,
      spawnSync:(cmd,args)=>{launched.push(cmd);return {status:0,stdout:args[0]==='rev-parse'?'/repo\n':args.includes('--name-status')?'M\0x.txt\0':artifact};}};
    const capture=env=>vm.runInNewContext(gov.slice(gov.indexOf('export function captureSourceSnapshot'),gov.indexOf('export function normalizeTarget')).replaceAll('export function','function')+';captureSourceSnapshot',
      {...context,process:{platform:'linux',env}});
    const result=capture({PATH:'/repo/bin:.::/usr/bin'})('/repo',artifact);assert.equal(result.complete,true,result.reason);
    assert(launched.length>0&&launched.every(c=>c==='/usr/bin/git'),JSON.stringify(launched));
    launched.length=0;const refused=capture({PATH:'/repo/bin'})('/repo',artifact);
    assert.equal(refused.complete,false);assert.match(refused.reason,/git was not found on an absolute PATH entry outside the project/);assert.deepEqual(launched,[]);
  });
  test("fresh Git scope accepted; stale, deleted and binary scope refused", () => {
    const cwd = path.join(fixture, "scope"); fs.mkdirSync(cwd);
    const git = args => { const r = spawnSync(GIT, ["-c", "core.autocrlf=false", "-c", "core.hooksPath=.git/no-hooks", ...args], { cwd, encoding: "utf8", timeout: 10000 }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    git(["init", "-q"]); fs.writeFileSync(path.join(cwd, "x.txt"), "before\n"); fs.writeFileSync(path.join(cwd, "blob.bin"), Buffer.from([0,1,2]));
    git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture baseline"]);
    fs.writeFileSync(path.join(cwd, "x.txt"), "after\n"); const diff = git(["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"]);
    assert.equal(captureSourceSnapshot(cwd, diff).complete, true);
    const actual=spawnSync(process.execPath,[path.join(scripts,'multi-review.mjs'),'--governor','codex','--reviewers','codex','--min-success','1','--no-ui'],{cwd,encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,NO_UPDATE_CHECK:'1'}});
    assert.equal(actual.status,3,actual.stderr);assert.equal(JSON.parse(actual.stdout).source_snapshot.complete,true);
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
    const capture = vm.runInNewContext(gov.slice(gov.indexOf("export function captureSourceSnapshot"), gov.indexOf("export function normalizeTarget")).replaceAll("export function", "function") + ";captureSourceSnapshot", {
      fs: racedFs, path, process, spawnSync, digest, demand: (ok, message) => { if (!ok) throw Error(message); }, pathEntryOutside, executableOutside,
    });
    const raced=capture(raceCwd,diff);
    assert.equal(changed,true,'race fixture did not mutate the aliased source');
    assert.equal(raced.complete, false, "concurrent source must not bind to an older reviewed diff");
    fs.writeFileSync(path.join(cwd, "x.txt"), "stale\n"); assert.equal(captureSourceSnapshot(cwd, diff).complete, false);
    fs.writeFileSync(path.join(cwd, "blob.bin"), Buffer.from([0,5,6])); assert.equal(captureSourceSnapshot(cwd, git(["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"])).complete, false);
    fs.writeFileSync(path.join(cwd, "blob.bin"), Buffer.from([0,1,2])); fs.unlinkSync(path.join(cwd, "blob.bin")); assert.equal(captureSourceSnapshot(cwd, git(["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"])).complete, false);
  });
  test("junction evidence cannot escape project", () => {
    const link = path.join(fixture, "evidence-link"); fs.symlinkSync(path.join(fixture, "evidence"), link, process.platform === "win32" ? "junction" : "dir");
    const malicious = rows.map(r => r.disposition === "applied" ? { ...r, verification: { ...r.verification, path: "evidence-link/after.json" } } : r);
    decisions(malicious); assert.equal(healthy().complete, false); decisions(rows); fs.unlinkSync(link);
  });
  test("peer-authored command never executed", () => assert(!fs.existsSync(path.join(fixture, "PEER_EXECUTED"))));
  test("real completion CLI and ledger rebuild", () => { const result = run([path.join(scripts, "governor.mjs"), "--run", report.run_id, "--record"]); assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).ledger_rebuilt, true); assert.match(fs.readFileSync(path.join(fixture, ".ensemble_reviews/ledger.html"), "utf8"), /Local completion evidence validated/); });
  test('receipt success cannot hide dashboard rebuild failure',()=>{
    const copy=write('isolated/governor.mjs',fs.readFileSync(path.join(scripts,'governor.mjs'),'utf8'));
    // The governor's own sibling modules, followed transitively; ledger.mjs is deliberately absent.
    const pending=['governor.mjs'],copied=new Set(pending);
    while(pending.length){for(const [,name] of fs.readFileSync(path.join(scripts,pending.pop()),'utf8').matchAll(/^import [^;]*? from ["']\.\/([\w.-]+\.mjs)["']/gm))if(!copied.has(name)){copied.add(name);pending.push(name);write('isolated/'+name,fs.readFileSync(path.join(scripts,name),'utf8'));}}
    assert(copied.has('evidence-permissions.mjs')&&copied.has('process-scope.mjs')&&copied.has('evidence-location.mjs')&&!copied.has('ledger.mjs'));
    const result=run([copy,'--run',report.run_id,'--record']),body=JSON.parse(result.stdout);
    assert.equal(result.status,5,result.stdout+result.stderr);assert.equal(body.complete,true);assert.equal(body.ledger_rebuilt,false);assert.equal(body.ledger_url,null);assert(body.ledger_error);
  });
  process.stdout.write(JSON.stringify({ passed: true, tests: passed, model_calls: 0, limitations: "Controlled reviewer replies and governor-authored execution; not live provider/harness certification" }, null, 2) + "\n");
} finally {
  const resolved = path.resolve(fixture), temp = path.resolve(os.tmpdir());
  if (resolved.startsWith(temp + path.sep) && path.basename(resolved).startsWith("momm-governor-test-")) fs.rmSync(resolved, { recursive: true, force: true });
}
