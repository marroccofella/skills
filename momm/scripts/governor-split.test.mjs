#!/usr/bin/env node
// Sealed synthetic fixtures for the completion validator's 1.16 rules: per-piece
// quorum, governor_direct obligations, and review_rating rows. A real local test
// supplies the final evidence; only the SYNTHETIC review metadata varies. No
// model calls. Adapted from the 2026-09-13 pre-release audit's negative fixtures.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { captureSourceSnapshot, inspectCompletion, digest } from "./governor.mjs";
import {privateTestFixture} from './private-test-fixture.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const passed = [], failures = [];
const test = (name, fn) => { try { fn(); passed.push(name); } catch (error) { failures.push({ name, error: error.message }); } };
process.umask(0o077); // This isolated synthetic test process only.
const base = privateTestFixture("momm-governor-split-");
const write = (dir, p, value) => { const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof value === "string" ? value : JSON.stringify(value, null, 2)); };

function fixture(name, { pieces, governorDirect = [], quorum, strict = false }) {
  const dir = path.join(base, name); fs.mkdirSync(dir, { recursive: true });
  const code = "module.exports = 42;\n";
  write(dir, "answer.cjs", code);
  write(dir, "answer.test.cjs", "require('node:assert/strict').equal(require('./answer.cjs'), 42); console.log('ok');\n");
  const run = spawnSync(process.execPath, ["answer.test.cjs"], { cwd: dir, encoding: "utf8", windowsHide: true });
  assert.equal(run.status, 0);
  write(dir, "output.txt", run.stdout + run.stderr);
  const ref = (p) => ({ path: p, sha256: digest(fs.readFileSync(path.join(dir, p))) });
  const id = `rev_synthetic_${name}`;
  const report = {
    run_id: id, governor: "codex", label: "SYNTHETIC validator fixture — not a live review", input_sha256: digest(code),
    source_snapshot: captureSourceSnapshot(dir, code, "answer.cjs"),
    gate_policy: { strict, quorum_required: 2, requested_routes: ["claude", "grok"] },
    reviewers: ["claude", "grok"].map((agent) => ({ agent, status: "success", review_contract: "momm-peer-review/2", reviewed_scope: [{ quote: "module.exports = 42;", assessment: "Synthetic fixture." }], suggested_improvements: [] })),
    findings: [],
    quorum, split: { ceiling_bytes: 4096, pieces, governor_direct: governorDirect },
  };
  const rp = `.ensemble_reviews/reports/${id}.json`; write(dir, rp, report);
  const seal = ref(rp).sha256;
  write(dir, ".ensemble_reviews/review-log.jsonl", JSON.stringify({ run_id: id, report_path: rp, report_sha256: seal, input_sha256: report.input_sha256 }) + "\n");
  const check = (item_id, phase, file) => write(dir, file, { schema: "momm-check/1", run_id: id, item_id, report_sha256: seal, input_sha256: report.input_sha256, phase, exit_code: 0, observed_at: new Date().toISOString(), command_label: "node answer.test.cjs", test: ref("answer.test.cjs"), output: ref("output.txt"), artifacts: [ref("answer.cjs")] });
  check("run", "final", `.ensemble_reviews/verification/${id}.json`);
  return { dir, id, seal, report, ref, check };
}
const piece = (id, statuses) => ({ id, quorum_met: Object.values(statuses).filter((s) => s === "success").length >= 2, external_successes: Object.values(statuses).filter((s) => s === "success").length, reviewers: statuses });
const ok2 = { claude: "success", grok: "success" };

try {
  test("clean split run with both pieces at quorum completes", () => {
    const f = fixture("clean", { pieces: [piece("piece-01", ok2), piece("piece-02", ok2)], quorum: { required: 2, achieved: 2, met: true, pieces: 2 } });
    const r = inspectCompletion(f.dir, f.id);
    assert.equal(r.complete, true, JSON.stringify(r.errors));
    assert.equal(r.quorum.pieces, 2);
  });
  test("a piece that missed quorum fails completion even though merged route rows say success (audit finding 1)", () => {
    const f = fixture("failed_piece", { pieces: [piece("piece-01", ok2), piece("piece-02", { claude: "success", grok: "timeout" })], quorum: { required: 2, achieved: 1, met: false, pieces: 2 } });
    const r = inspectCompletion(f.dir, f.id);
    assert.equal(r.complete, false);
    assert(r.errors.some((e) => /quorum not met on piece\(s\): piece-02/.test(e)), JSON.stringify(r.errors));
  });
  test("strict policy is enforced per piece", () => {
    const f = fixture("strict_piece", { strict: true, pieces: [piece("piece-01", ok2), piece("piece-02", { claude: "success", grok: "success", antigravity: "success" })], quorum: { required: 2, achieved: 2, met: true, pieces: 2 } });
    fs.writeFileSync(path.join(f.dir, `.ensemble_reviews/reports/${f.id}.json`), JSON.stringify({ ...f.report, split: { ...f.report.split, pieces: [piece("piece-01", ok2), piece("piece-02", { claude: "success", grok: "invalid_output", antigravity: "success" })] }, quorum: { required: 2, achieved: 2, met: true, pieces: 2 } }, null, 2));
    // re-seal
    const rp = `.ensemble_reviews/reports/${f.id}.json`; const seal = digest(fs.readFileSync(path.join(f.dir, rp)));
    fs.writeFileSync(path.join(f.dir, ".ensemble_reviews/review-log.jsonl"), JSON.stringify({ run_id: f.id, report_path: rp, report_sha256: seal, input_sha256: f.report.input_sha256 }) + "\n");
    const v = JSON.parse(fs.readFileSync(path.join(f.dir, `.ensemble_reviews/verification/${f.id}.json`), "utf8")); v.report_sha256 = seal; fs.writeFileSync(path.join(f.dir, `.ensemble_reviews/verification/${f.id}.json`), JSON.stringify(v, null, 2));
    const r = inspectCompletion(f.dir, f.id);
    assert.equal(r.complete, false);
    assert(r.errors.some((e) => /strict reviewer policy not met on piece-02: grok/.test(e)), JSON.stringify(r.errors));
  });
  test("aggregate quorum metadata that contradicts the piece structure is an error", () => {
    const f = fixture("contradiction", { pieces: [piece("piece-01", ok2), piece("piece-02", { claude: "success", grok: "timeout" })], quorum: { required: 2, achieved: 2, met: true, pieces: 2 } });
    const r = inspectCompletion(f.dir, f.id);
    assert.equal(r.complete, false);
    assert(r.errors.some((e) => /contradicts the sealed piece structure/.test(e)), JSON.stringify(r.errors));
  });
  test("governor_direct scope without a recorded decision leaves the run incomplete (audit finding 6)", () => {
    const f = fixture("oversize_undecided", { pieces: [piece("piece-01", ok2)], governorDirect: [{ id: "oversize-01", path: "answer.cjs", bytes: 8000, status: "governor_direct" }], quorum: { required: 2, achieved: 2, met: true, pieces: 1 } });
    const r = inspectCompletion(f.dir, f.id);
    assert.equal(r.complete, false);
    assert.equal(r.unresolved.length, 1);
    assert.equal(r.items.find((i) => i.kind === "governor_direct").content.path, "answer.cjs");
  });
  test("governor_direct scope with a 'reviewed' decision and investigation evidence completes", () => {
    const f = fixture("oversize_reviewed", { pieces: [piece("piece-01", ok2)], governorDirect: [{ id: "oversize-01", path: "answer.cjs", bytes: 8000, status: "governor_direct" }], quorum: { required: 2, achieved: 2, met: true, pieces: 1 } });
    const item = inspectCompletion(f.dir, f.id).items.find((i) => i.kind === "governor_direct");
    f.check(item.item_id, "investigation", ".ensemble_reviews/checks/direct.json");
    write(f.dir, ".ensemble_reviews/dispositions.jsonl", JSON.stringify({ run_id: f.id, item_id: item.item_id, reviewer: "codex", governor: "codex", report_sha256: f.seal, input_sha256: f.report.input_sha256, disposition: "reviewed", reason: "governor read the oversize hunk directly; no defect", verification: f.ref(".ensemble_reviews/checks/direct.json") }) + "\n");
    const r = inspectCompletion(f.dir, f.id);
    assert.equal(r.complete, true, JSON.stringify({ errors: r.errors, unresolved: r.unresolved }));
  });
  test("a split run whose every hunk was governor_direct has no external review and cannot complete", () => {
    const f = fixture("all_oversize", { pieces: [], governorDirect: [{ id: "oversize-01", path: "answer.cjs", bytes: 8000, status: "governor_direct" }], quorum: { required: 2, achieved: 0, met: true, pieces: 0, governor_direct_only: true } });
    const r = inspectCompletion(f.dir, f.id);
    assert.equal(r.complete, false);
    assert.equal(r.quorum.achieved, 0);
    assert(r.errors.some((e) => /no reviewed pieces/.test(e)), JSON.stringify(r.errors));
  });
  test("valid review_rating rows never break completion; malformed ones do (audit finding 2)", () => {
    const f = fixture("ratings", { pieces: [piece("piece-01", ok2)], quorum: { required: 2, achieved: 2, met: true, pieces: 1 } });
    assert.equal(inspectCompletion(f.dir, f.id).complete, true);
    const rate = spawnSync(process.execPath, [path.join(scripts, "ledger.mjs"), "--rate", f.id, "claude", "4", "--tags", "specific"], { cwd: f.dir, encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(rate.status, 0, rate.stderr);
    const after = inspectCompletion(f.dir, f.id);
    assert.equal(after.complete, true, JSON.stringify(after.errors));
    fs.appendFileSync(path.join(f.dir, ".ensemble_reviews/dispositions.jsonl"), JSON.stringify({ kind: "review_rating", run_id: f.id, reviewer: "claude", rating: 9, tags: [] }) + "\n");
    const bad = inspectCompletion(f.dir, f.id);
    assert.equal(bad.complete, false);
    assert(bad.errors.some((e) => /malformed review_rating/.test(e)), JSON.stringify(bad.errors));
  });
} finally {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
}
console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
