// MOMM 1.17 C2 (step alphabet): MOMM's review invariants as a depth-bounded, seeded property test.
// Run: node momm/scripts/invariants.test.mjs. Zero processes and zero providers: every step drives the
// production decision code (the retry wrapper, cover eligibility and route choice, vote counting, the
// claim-type merge in rationalize, the governor's re-type rule) with stubbed reviewer answers.
//
// Steps: retry, retry-invalid, cover, split, re-type, re-severity. Every sequence of length 1..DEPTH is
// run from a seeded start, and after every step none of these states may be reachable:
//   I1 a third route invocation for one piece and role;
//   I2 a cover counted as a vote for a family that already has one on that piece;
//   I3 a merged claim type lower than the type of any of its sources;
//   I4 a claim type or severity lowered without a recorded decision row (retyped_from/severity_from plus a reason).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { PEER_CONTRACT } from "./review-contract.mjs";
import { splitDiff } from "./split.mjs";
import * as governor from "./governor.mjs";

const DEPTH = 5;
const scripts = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(scripts, "multi-review.mjs"), "utf8");
const passed = [], failures = [];
async function test(name, fn) { try { await fn(); passed.push(name); } catch (error) { failures.push({ test: name, error: String(error?.message ?? error).slice(0, 2000) }); } }
let cover = null;
try { cover = await import("./cover.mjs"); } catch (error) { failures.push({ test: "cover.mjs loads", error: error.message }); }

const slice = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a > 0 && b > a, `${from} not found`); return source.slice(a, b); };
// Production code: persona defaults, the retry wrapper, and the aggregation (rationalize and its ranks).
const core = vm.runInNewContext([
  slice("const DEFAULT_PERSONAS = {", "function buildContract("),
  slice("const PROVIDER_RETRY_DELAY_MS", "function createUi("),
  slice("function fingerprint(", "function buildInsights("),
].join("\n") + "\n({ personaFor, invokeWithRetry, shouldRetryStatus, rationalize, CLAIM_TYPE_RANK, SEVERITY_RANK })", {
  PEER_CONTRACT, VALID_VERDICTS: new Set(["ACCEPT", "MODIFY", "REJECT"]), VALID_SEVERITIES: new Set(["CRITICAL", "WARNING", "NITPICK"]), fs, os, path, Date, setTimeout,
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ROUTES = ["codex", "claude", "grok", "copilot", "antigravity", "gemini"];
const GOVERNOR = "other";
const STEPS = ["retry", "retry-invalid", "cover", "split", "re-type", "re-severity"];
const CLAIM_TYPES = ["DEFECT", "RISK", "QUESTION", "IDEA", "NOISE", null];
const SEVERITIES = ["CRITICAL", "WARNING", "NITPICK"];
const OUTCOMES = ["success", "success", "timeout", "invalid_output", "error", "provider_unavailable", "authentication_required", "quota"];
const roleOf = (agent) => core.personaFor(agent, {});
const familyOf = (route) => cover.familyOf(route);
const DIFF = [
  "diff --git a/src/a.js b/src/a.js", "--- a/src/a.js", "+++ b/src/a.js",
  "@@ -1,3 +1,3 @@", " const one = 1;", "-const two = 2;", "+const two = 3;", " const three = 3;",
  "diff --git a/src/b.js b/src/b.js", "--- a/src/b.js", "+++ b/src/b.js",
  "@@ -1,2 +1,2 @@", "-export const b = 1;", "+export const b = 2;", " // end", "",
].join("\n");

function newState(rand) {
  return { rand, pieces: new Map([["whole", { natives: new Map(), covers: [] }]]), decisions: [], counters: { coversCounted: 0, coversNotCounted: 0, coversRefusedByBudget: 0, sameFamilyCoversInOnePass: 0, retries: 0, lowerAccepted: 0, lowerRefused: 0, splits: 0 } };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
function reviewFor(rand, agent) {
  const findings = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => {
    const id = pick(rand, ["f1", "f2", "f3"]);
    return { id, severity: pick(rand, SEVERITIES), claim_type: pick(rand, CLAIM_TYPES), target_file: "src/a.js", line_range: null, issue: `Synthetic issue ${id} from ${agent}`, rationale: "synthetic", test_suggestion: null };
  });
  return { agent, verdict: "MODIFY", confidence: 0.5, summary: "synthetic", review_contract: PEER_CONTRACT, reviewed_scope: [{ quote: "const two", assessment: "x" }], improvements: [], findings: findings.filter((f, i, all) => all.findIndex((g) => g.id === f.id) === i) };
}
// A stubbed reviewer: the first answer is forced, later answers are seeded. Every call is an invocation.
function stubInvoker(rand, first, ledger) {
  let calls = 0;
  return async (agent) => {
    calls += 1; ledger.count += 1;
    const status = calls === 1 && first ? first : pick(rand, OUTCOMES);
    return status === "success" ? { agent, status, review: reviewFor(rand, agent) } : { agent, status, detail: "synthetic" };
  };
}
const invocationKey = (piece, role, route) => `${piece}|${role ?? "none"}|${route}`;

async function dispatchNative(state, first, retryInvalid) {
  const open = [];
  for (const [id, piece] of state.pieces) for (const route of ROUTES) if (!piece.natives.has(route)) open.push([id, route]);
  if (!open.length) return;
  const [pieceId, route] = pick(state.rand, open);
  const ledger = { count: 0 };
  const result = await core.invokeWithRetry(stubInvoker(state.rand, first, ledger), route, "artifact", { retryInvalid }, null, async () => {});
  assert.equal(result.attempts, ledger.count, "attempts must equal the invocations actually made");
  if (ledger.count > 1) state.counters.retries += 1;
  state.pieces.get(pieceId).natives.set(route, { ...result, invocations: ledger.count });
}

async function coverStep(state) {
  const ids = [...state.pieces.keys()];
  const pieceId = pick(state.rand, ids), piece = state.pieces.get(pieceId);
  const natives = ROUTES.filter((r) => piece.natives.has(r)).map((r) => ({ agent: r, ...piece.natives.get(r) }));
  const eligibleBefore = natives.filter((n) => cover.coverDecision({ status: n.status, invocations: n.attempts }).eligible).length;
  const covers = await cover.runPieceCovers({ piece: pieceId, natives, requested: ROUTES, governor: GOVERNOR, roleOf, previous: piece.covers,
    invoke: async (route, request) => {
      const ledger = { count: 0 };
      const result = await core.invokeWithRetry(stubInvoker(state.rand, null, ledger), route, "artifact", { cover: true, coverRequest: request, noRetry: true, retryInvalid: state.rand() < 0.5 }, null, async () => {});
      assert.equal(result.attempts, ledger.count);
      return result;
    } });
  if (eligibleBefore > covers.length) state.counters.coversRefusedByBudget += eligibleBefore - covers.length;
  for (const c of covers) { if (c.counted_for_quorum) state.counters.coversCounted += 1; else if (c.status === "success") state.counters.coversNotCounted += 1; }
  const families = covers.filter((c) => c.status === "success").map((c) => familyOf(c.agent)).filter(Boolean);
  const nativeFamilies = natives.filter((n) => n.status === "success").map((n) => familyOf(n.agent));
  if (families.some((f, i) => families.indexOf(f) !== i && !nativeFamilies.includes(f))) state.counters.sameFamilyCoversInOnePass += 1;
  piece.covers.push(...covers);
}

function splitStep(state, depthIndex) {
  const ceiling = 4096 + Math.floor(state.rand() * 4096);
  const result = splitDiff(DIFF, { ceilingBytes: ceiling, lineSplit: true });
  for (const p of result.pieces) {
    const id = `s${depthIndex}-${state.counters.splits}-${p.id}`;
    assert.ok(!state.pieces.has(id), "a split never reuses a piece identity (budgets are per piece)");
    state.pieces.set(id, { natives: new Map(), covers: [] });
  }
  state.counters.splits += 1;
}

function merged(state) {
  const out = [];
  for (const [id, piece] of state.pieces) {
    const results = [...[...piece.natives.entries()].map(([agent, r]) => ({ ...r, agent })), ...piece.covers.map((c) => c.result)].filter((r) => r?.status === "success");
    for (const finding of core.rationalize(results, { prose: false, artifact: null })) out.push({ piece: id, finding, sources: results.flatMap((r) => r.review.findings.filter((f) => f.id === finding.id && (f.target_file || "") === (finding.target_file || ""))) });
  }
  return out;
}

function decisionStep(state, field) {
  const claims = merged(state);
  if (!claims.length) return;
  const claim = pick(state.rand, claims);
  const [allowed, fromKey, reasonKey] = field === "claim_type" ? [["DEFECT", "RISK", "QUESTION", "IDEA", "NOISE"], "retyped_from", "retype_reason"] : [SEVERITIES, "severity_from", "severity_reason"];
  const reported = claim.finding[field] ?? null;
  const row = { [field]: pick(state.rand, allowed) };
  const r = state.rand();
  if (r < 0.4) { row[fromKey] = reported; row[reasonKey] = "reproduced and re-typed with evidence"; }
  else if (r < 0.55) { row[fromKey] = reported; row[reasonKey] = pick(state.rand, ["", "   "]); }
  else if (r < 0.7) { row[fromKey] = pick(state.rand, allowed); row[reasonKey] = "wrong baseline"; }
  const lowers = field === "claim_type" ? (core.CLAIM_TYPE_RANK[row[field]] ?? 0) < (core.CLAIM_TYPE_RANK[reported] ?? 0) : (core.SEVERITY_RANK[row[field]] ?? 0) < (core.SEVERITY_RANK[reported] ?? 0);
  try {
    governor.recordedChange(row, claim.finding, { field, from: fromKey, reason: reasonKey, allowed, label: field === "claim_type" ? "re-typing" : "re-grading severity" });
    state.decisions.push({ field, reported, row, lowers });
    if (lowers) state.counters.lowerAccepted += 1;
  } catch { if (lowers) state.counters.lowerRefused += 1; }
}

function checkInvariants(state, trail) {
  const where = `after ${trail.join(" > ")}`;
  for (const [id, piece] of state.pieces) {
    // I1: invocations per piece and role, counted across outage retry, --retry-invalid and cover.
    const perRole = new Map();
    for (const [route, native] of piece.natives) { const key = invocationKey(id, roleOf(route), route); perRole.set(key, (perRole.get(key) ?? 0) + native.invocations); }
    for (const c of piece.covers) { const key = invocationKey(id, c.role, c.covering_for); perRole.set(key, (perRole.get(key) ?? 0) + c.attempts); }
    for (const [key, n] of perRole) assert.ok(n <= cover.ATTEMPT_BUDGET, `I1 ${where}: ${n} invocations for ${key}`);
    // I2: at most one vote per family per piece; covers never add a vote for a family a native already has.
    const nativeFamilies = new Set([...piece.natives].filter(([, r]) => r.status === "success").map(([route]) => familyOf(route)).filter(Boolean));
    const coverVoteFamilies = piece.covers.filter((c) => c.counted_for_quorum).map((c) => familyOf(c.agent));
    assert.ok(coverVoteFamilies.every(Boolean), `I2 ${where}: a cover of unknown family counted`);
    assert.equal(new Set(coverVoteFamilies).size, coverVoteFamilies.length, `I2 ${where}: two cover votes for one family`);
    assert.ok(coverVoteFamilies.every((f) => !nativeFamilies.has(f)), `I2 ${where}: a cover counted beside a native vote of its family`);
  }
  // I3: the merge never lowers a claim type below any of its sources.
  for (const { finding, sources } of merged(state)) {
    const top = Math.max(0, ...sources.map((f) => core.CLAIM_TYPE_RANK[f.claim_type] ?? 0));
    assert.ok((core.CLAIM_TYPE_RANK[finding.claim_type] ?? 0) >= top, `I3 ${where}: merged ${finding.claim_type} below a source`);
  }
  // I4: every accepted lowering carries the report's value and a reason.
  for (const d of state.decisions) {
    if (!d.lowers) continue;
    const [fromKey, reasonKey] = d.field === "claim_type" ? ["retyped_from", "retype_reason"] : ["severity_from", "severity_reason"];
    assert.ok(Object.hasOwn(d.row, fromKey) && d.row[fromKey] === d.reported && String(d.row[reasonKey] ?? "").trim(), `I4 ${where}: ${d.field} lowered without a recorded decision row`);
  }
}

async function runSequence(sequence, seed) {
  const state = newState(mulberry32(seed));
  const trail = [];
  for (const [i, step] of sequence.entries()) {
    trail.push(step);
    if (step === "timeouts") { for (const route of ROUTES) { const ledger = { count: 0 }; const r = await core.invokeWithRetry(stubInvoker(state.rand, "timeout", ledger), route, "artifact", {}, null, async () => {}); state.pieces.get("whole").natives.set(route, { ...r, invocations: ledger.count }); } }
    else if (step === "retry") await dispatchNative(state, "provider_unavailable", state.rand() < 0.5);
    else if (step === "retry-invalid") await dispatchNative(state, "invalid_output", state.rand() < 0.8);
    else if (step === "cover") await coverStep(state);
    else if (step === "split") splitStep(state, i);
    else if (step === "re-type") decisionStep(state, "claim_type");
    else if (step === "re-severity") decisionStep(state, "severity");
    checkInvariants(state, trail);
  }
  return state.counters;
}

function* sequences(depth) {
  for (let length = 1; length <= depth; length += 1) {
    const indices = new Array(length).fill(0);
    while (true) {
      yield indices.map((i) => STEPS[i]);
      let k = length - 1;
      while (k >= 0 && ++indices[k] === STEPS.length) { indices[k] = 0; k -= 1; }
      if (k < 0) break;
    }
  }
}

await test(`C2: every step sequence up to depth ${DEPTH} keeps the budget, vote, merge and re-type invariants`, async () => {
  assert.ok(cover, "momm/scripts/cover.mjs is missing");
  assert.equal(typeof governor.recordedChange, "function", "governor.mjs must export its re-type rule (recordedChange)");
  const totals = { coversCounted: 0, coversNotCounted: 0, coversRefusedByBudget: 0, sameFamilyCoversInOnePass: 0, retries: 0, lowerAccepted: 0, lowerRefused: 0, splits: 0 };
  const started = Date.now();
  let count = 0;
  // Prefixes of dispatches first give later steps something to act on (the last one fills every route
  // on the first piece, so one cover pass can hold several covers); the sequence under test follows.
  // "timeouts" is a setup step only (not in the alphabet): every route times out once on the first piece.
  const PREFIXES = [[], ["retry", "retry-invalid", "retry"], ["timeouts"]];
  for (const sequence of sequences(DEPTH)) {
    for (const prefix of PREFIXES) {
      const counters = await runSequence([...prefix, ...sequence], 0x117C2 + count);
      for (const key of Object.keys(totals)) totals[key] += counters[key];
      count += 1;
    }
  }
  assert.equal(count, PREFIXES.length * (6 + 36 + 216 + 1296 + 7776), `ran ${count} sequences`);
  // Not vacuous: the generator reaches every rule it is meant to exercise.
  for (const [key, value] of Object.entries(totals)) assert.ok(value > 0, `the generator never reached ${key}: ${JSON.stringify(totals)}`);
  assert.ok(Date.now() - started < 120_000, `bounded: ${Date.now() - started} ms`);
});

await test("C2: a cover pass repeated on the same piece cannot buy a third invocation", async () => {
  assert.ok(cover, "momm/scripts/cover.mjs is missing");
  const natives = [{ agent: "codex", status: "timeout", attempts: 1 }, { agent: "claude", status: "success", attempts: 1 }, { agent: "grok", status: "timeout", attempts: 1 }];
  let calls = 0;
  const invoke = async (route) => { calls += 1; return { agent: route, status: "timeout", attempts: 1 }; };
  const first = await cover.runPieceCovers({ piece: "p", natives, requested: ["codex", "claude", "grok"], governor: "other", roleOf, invoke });
  const second = await cover.runPieceCovers({ piece: "p", natives, requested: ["codex", "claude", "grok"], governor: "other", roleOf, invoke, previous: first });
  assert.equal(first.length, 2);
  assert.deepEqual(second, [], "every covered role has spent its budget");
  assert.equal(calls, 2);
});

await test("C2: a later cover pass cannot count a second vote for a family an earlier cover already counted", async () => {
  assert.ok(cover, "momm/scripts/cover.mjs is missing");
  const natives = [{ agent: "codex", status: "timeout", attempts: 1 }, { agent: "copilot", status: "timeout", attempts: 1 }, { agent: "antigravity", status: "timeout", attempts: 1 }, { agent: "gemini", status: "timeout", attempts: 1 }];
  const invoke = async (route) => ({ agent: route, status: "success", attempts: 1, review: { findings: [], improvements: [] } });
  const first = await cover.runPieceCovers({ piece: "p", natives: natives.slice(0, 2), requested: ["codex", "copilot", "antigravity", "gemini"], governor: "other", roleOf, invoke });
  const second = await cover.runPieceCovers({ piece: "p", natives, requested: ["codex", "copilot", "antigravity", "gemini"], governor: "other", roleOf, invoke, previous: first });
  const counted = [...first, ...second].filter((c) => c.counted_for_quorum).map((c) => familyOf(c.agent));
  assert.equal(new Set(counted).size, counted.length, JSON.stringify([...first, ...second].map((c) => [c.agent, c.counted_for_quorum])));
});

console.log(JSON.stringify({ depth: DEPTH, passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
