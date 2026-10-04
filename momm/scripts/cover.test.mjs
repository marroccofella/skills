// MOMM 1.17 B3: opt-in role cover with one attempt budget. Run: node momm/scripts/cover.test.mjs
// Zero provider calls: the production adapter and retry code run against a stubbed runProcess, and the
// completion validator runs on sealed synthetic fixtures.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PEER_CONTRACT, reviewProblem } from "./review-contract.mjs";
import { assemblePrompt } from "./guidance.mjs";
import { grokIsolationEnv } from "./route-isolation.mjs";
import * as reviewAnswer from "./review-answer.mjs";
import * as roles from "./roles.mjs";
import { captureSourceSnapshot, inspectCompletion, digest } from "./governor.mjs";
import { privateTestFixture } from "./private-test-fixture.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(scripts, "multi-review.mjs"), "utf8");
const passed = [], failures = [];
async function test(name, fn) { try { await fn(); passed.push(name); } catch (error) { failures.push({ test: name, error: String(error?.message ?? error).slice(0, 1500) }); } }
let cover = null;
try { cover = await import("./cover.mjs"); } catch (error) { failures.push({ test: "cover.mjs loads", error: error.message }); }
const need = () => assert.ok(cover, "momm/scripts/cover.mjs is missing");

// The closed reviewer status vocabulary (SKILL.md step 5) and the plan's rule for each.
const STATUSES = ["success", "self_excluded", "authentication_required", "provider_unavailable", "ineligible_tier", "timeout", "quota", "cancelled", "missing", "invalid_output", "disabled_no_oauth", "unsupported", "not_dispatched", "error"];
const COVERED = new Set(["timeout", "invalid_output", "provider_unavailable", "error"]);

// Production code, sliced as other suites do: prompt head, persona/contract builder, adapters, retry.
function productionChain() {
  const slice = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a > 0 && b > a, `${from} not found`); return source.slice(a, b); };
  const code = [
    slice("const REVIEW_PROMPT = `", "const REVIEW_JSON_SCHEMA"),
    slice("const DEFAULT_PERSONAS = {", "function inertPathLabel("),
    slice("function extractJsonObjects(", "\nfunction fingerprint("),
    slice("const PROVIDER_RETRY_DELAY_MS", "function createUi("),
  ].join("\n");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "momm-cover-test-"));
  const context = vm.createContext({
    fs, os, path, process, Buffer, setTimeout, PEER_CONTRACT, reviewProblem, assemblePrompt, grokIsolationEnv,
    createEvidenceWorkspace: (prefix) => fs.mkdtempSync(path.join(workspace, prefix)), requirePrivateScratch: () => ({ verified: true }),
    VALID_VERDICTS: new Set(["ACCEPT", "MODIFY", "REJECT"]), VALID_SEVERITIES: new Set(["CRITICAL", "WARNING", "NITPICK"]),
    attachmentRouting: () => [], attachmentContractSection: () => "", agentTimeoutMs: (_a, ms) => ms, cleanOauthEnv: () => ({}),
    parseUsage: () => null, LOGIN_HINTS: {}, sanitizeText: (s) => ({ value: s }), clipped: (s, n) => String(s ?? "").slice(0, n),
    antigravityCommand: () => "agy", grokCommand: () => "grok", REVIEW_JSON_SCHEMA: { type: "object" },
    ...roles, ...(cover ?? {}),
    // 1.17.1 S1/S2: the adapters read an answer through review-answer.mjs; the real functions.
    ...reviewAnswer,
  });
  vm.runInContext(`${code}\nthis.api = { buildContract, personaFor, invokeReviewer, invokeWithRetry, shouldRetryStatus };`, context);
  return { ...context.api, cleanup: () => fs.rmSync(workspace, { recursive: true, force: true }) };
}

const ARTIFACT = "export function add(a, b) {\n  return a + b;\n}\n";
const validReview = (extra = {}) => JSON.stringify({ review_status: "complete", verdict: "ACCEPT", confidence: 0.8, summary: "Synthetic.", reviewed_scope: [{ quote: "return a + b;", assessment: "adds" }], suggested_improvements: [], findings: [], ...extra });

try {
  await test("every terminal status has a tested cover rule", () => {
    need();
    for (const status of STATUSES) {
      const decision = cover.coverDecision({ status, invocations: 1 });
      assert.equal(decision.eligible, COVERED.has(status), `${status}: ${JSON.stringify(decision)}`);
      assert.equal(typeof decision.reason === "string" || decision.eligible, true, `${status} needs a stated reason`);
    }
    assert.deepEqual([...cover.COVERABLE_STATUSES].sort(), [...COVERED].sort());
    for (const status of ["authentication_required", "quota", "ineligible_tier", "disabled_no_oauth", "self_excluded", "cancelled", "unsupported", "missing", "not_dispatched"]) {
      assert.ok(cover.NEVER_COVERED_STATUSES.includes(status), status);
      assert.equal(cover.coverDecision({ status, invocations: 0 }).eligible, false, `${status} is never covered, whatever the budget`);
    }
    // An unknown status is terminal and never covered.
    assert.equal(cover.coverDecision({ status: "surprise", invocations: 1 }).eligible, false);
  });

  await test("one attempt budget: a retried outage or a --retry-invalid resend leaves nothing for a cover", () => {
    need();
    assert.equal(cover.ATTEMPT_BUDGET, 2);
    assert.equal(cover.coverDecision({ status: "provider_unavailable", invocations: 2 }).eligible, false, "an outage is retried once, which spends the budget");
    assert.match(cover.coverDecision({ status: "provider_unavailable", invocations: 2 }).reason, /budget/);
    assert.equal(cover.coverDecision({ status: "invalid_output", invocations: 2 }).eligible, false, "--retry-invalid already resent");
    assert.equal(cover.coverDecision({ status: "invalid_output", invocations: 1 }).eligible, true);
    assert.equal(cover.coverDecision({ status: "timeout", invocations: 1 }).eligible, true);
    for (const invocations of [undefined, null, 0, -1, 1.5, "1"]) assert.equal(cover.coverDecision({ status: "timeout", invocations }).eligible, false, `unknown count ${invocations} is not budget left`);
  });

  await test("the cover route is another requested route: never the governor, never the failed route; a working route first", () => {
    need();
    const natives = [{ agent: "codex", status: "timeout" }, { agent: "claude", status: "success" }, { agent: "grok", status: "error" }, { agent: "copilot", status: "authentication_required" }];
    const pick = (extra) => cover.chooseCoverRoute({ failedRoute: "codex", requested: ["codex", "claude", "grok", "copilot"], governor: "antigravity", natives, used: [], ...extra });
    assert.equal(pick(), "claude", "a route that just succeeded on this piece is preferred");
    assert.equal(pick({ used: ["claude"] }), "grok", "then a route that failed only transiently");
    assert.equal(pick({ used: ["claude", "grok"] }), null, "never a route that needs a login");
    assert.equal(pick({ governor: "claude" }), "grok", "never the governor");
    assert.equal(cover.chooseCoverRoute({ failedRoute: "codex", requested: ["codex"], governor: "other", natives: [{ agent: "codex", status: "timeout" }], used: [] }), null, "never the failed route");
    assert.equal(cover.chooseCoverRoute({ failedRoute: "codex", requested: ["codex", "claude"], governor: "other", natives: [{ agent: "codex", status: "timeout" }, { agent: "claude", status: "success" }, { agent: "gemini", status: "success" }], used: [] }), "claude", "only requested routes");
  });

  await test("the model family table is versioned", () => {
    need();
    assert.deepEqual(JSON.parse(JSON.stringify(cover.MODEL_FAMILIES)), { version: 1, map: { codex: "openai", claude: "anthropic", antigravity: "google", gemini: "google", grok: "xai", copilot: "unknown" } });
    assert.equal(cover.familyOf("copilot"), null);
    assert.equal(cover.familyOf("gemini"), "google");
    assert.equal(cover.familyOf("unheard-of"), null);
  });

  await test("a cover adds a vote only for a known family new to the piece", () => {
    need();
    const ok = (agent) => ({ agent, status: "success" });
    const votes = (covers, successFamilies) => cover.coverVotes(covers, { successFamilies }).map((c) => c.counted_for_quorum);
    assert.deepEqual(votes([ok("grok")], ["anthropic"]), [true]);
    assert.deepEqual(votes([ok("claude")], ["anthropic"]), [false], "same family as a native success");
    assert.deepEqual(votes([ok("copilot")], []), [false], "unknown family adds coverage only");
    assert.deepEqual(votes([ok("antigravity"), ok("gemini")], []), [true, false], "one vote per family, covers included");
    assert.deepEqual(votes([{ agent: "grok", status: "timeout" }], []), [false], "a failed cover is no vote");
  });

  await test("covers run once per eligible failure, with the vacated role and status only", async () => {
    need();
    const calls = [];
    const natives = [
      { agent: "codex", status: "timeout", attempts: 1, review: null },
      { agent: "claude", status: "success", attempts: 1, review: { findings: [{ id: "SENTINEL_CLAIM" }] } },
      { agent: "grok", status: "provider_unavailable", attempts: 2 },
      { agent: "copilot", status: "authentication_required", attempts: 1 },
      { agent: "antigravity", status: "self_excluded", attempts: 1 },
    ];
    const covers = await cover.runPieceCovers({ piece: "piece-01", natives, requested: ["codex", "claude", "grok", "copilot", "antigravity"], governor: "antigravity",
      roleOf: (agent) => ({ codex: "surgeon", claude: "architect", grok: "innovator", copilot: "verifier" })[agent] ?? null,
      invoke: async (route, request) => { calls.push({ route, request }); return { agent: route, status: "success", attempts: 1, review: { verdict: "ACCEPT", findings: [], improvements: [] } }; } });
    assert.equal(calls.length, 1, "grok spent its budget on the outage retry; copilot needs a login; the governor is excluded");
    assert.deepEqual(calls[0], { route: "claude", request: { role: "surgeon", covering_for: "codex", covered_status: "timeout" } }, "no other reviewer's claims travel with the request");
    assert.equal(covers.length, 1);
    const [c] = covers;
    assert.equal(c.cover, true); assert.equal(c.agent, "claude"); assert.equal(c.covering_for, "codex"); assert.equal(c.covered_status, "timeout");
    assert.equal(c.role, "surgeon"); assert.equal(c.piece, "piece-01"); assert.equal(c.invocations, 2, "one native invocation plus the cover");
    assert.equal(c.counted_for_quorum, false, "claude already reviewed this piece natively: same family, no second vote");
    const summary = cover.pieceCoverSummary(covers);
    assert.deepEqual(summary, [{ role: "surgeon", covering_for: "codex", covered_status: "timeout", by: "claude", status: "success", counted_for_quorum: false }]);
    // Disabled: nothing is attempted.
    const none = await cover.runPieceCovers({ enabled: false, natives, requested: ["codex", "claude"], governor: "other", roleOf: () => null, invoke: async () => { throw new Error("must not run"); } });
    assert.deepEqual(none, []);
  });

  await test("the cover prompt carries the vacated brief and the failure status, never other claims; a cover is one invocation", async () => {
    need();
    const chain = productionChain();
    try {
      const prompts = [];
      let answer = () => ({ code: 0, stdout: validReview(), stderr: "" });
      const runProcess = async (command, args, options) => { prompts.push({ command, input: options.input }); return answer(); };
      const natives = [{ agent: "codex", status: "timeout", attempts: 1 }, { agent: "claude", status: "success", attempts: 1, review: { findings: [{ id: "SENTINEL_CLAIM", issue: "SENTINEL_CLAIM_TEXT" }] } }];
      const invoke = (route, request) => chain.invokeWithRetry(chain.invokeReviewer, route, ARTIFACT, { governor: "other", timeoutMs: 1000, runProcess, cover: true, coverRequest: request, noRetry: true }, null, async () => {});
      const covers = await cover.runPieceCovers({ natives, requested: ["codex", "claude"], governor: "other", roleOf: (agent) => chain.personaFor(agent, {}), invoke });
      assert.equal(prompts.length, 1);
      const input = prompts[0].input;
      assert.ok(input.includes(roles.loadRole("surgeon").body), "the vacated (surgeon) brief is sent");
      assert.ok(!input.includes(roles.loadRole("architect").body), "not the cover route's own brief");
      assert.match(input, /ended with status "timeout"/);
      assert.ok(!input.includes("SENTINEL_CLAIM"), "no other reviewer's claims");
      assert.equal(covers[0].status, "success");
      assert.equal(covers[0].result.review.review_contract, PEER_CONTRACT, "the cover's answer passes the same validator");
      // An outage on the cover is not retried: the budget is already one native + one cover.
      prompts.length = 0; answer = () => ({ code: 1, stdout: "", stderr: "503 Service Unavailable" });
      const outage = await cover.runPieceCovers({ natives, requested: ["codex", "claude"], governor: "other", roleOf: (agent) => chain.personaFor(agent, {}), invoke });
      assert.equal(prompts.length, 1, "a cover never retries");
      assert.equal(outage[0].status, "provider_unavailable");
      assert.equal(outage[0].invocations, 2);
      // The retry rule itself: never for a cover, unchanged otherwise.
      assert.equal(chain.shouldRetryStatus("provider_unavailable", { noRetry: true }), false);
      assert.equal(chain.shouldRetryStatus("invalid_output", { retryInvalid: true, noRetry: true }), false);
      assert.equal(chain.shouldRetryStatus("provider_unavailable", {}), true);
      // Without a cover the prompt is the route's own contract, unchanged.
      assert.equal(chain.buildContract("claude", {}).includes("Role cover"), false);
      // The run-wide --cover flag is not a cover request: a native review under --cover keeps its own role.
      assert.equal(chain.buildContract("claude", { cover: true }), chain.buildContract("claude", {}), "--cover alone must not change a native prompt");
      assert.ok(chain.buildContract("claude", { cover: true, coverRequest: { role: null, covering_for: "codex", covered_status: "error" } }).includes('ended with status "error"'), "a vacated plain contract is covered as a plain contract");
      assert.throws(() => chain.buildContract("claude", { coverRequest: { role: "surgeon", covering_for: "codex", covered_status: "authentication_required" } }), /not a coverable status/);
    } finally { chain.cleanup(); }
  });

  await test("report rows label a cover and never present it as a native review", () => {
    need();
    const row = cover.coverReportRow({ agent: "grok", cover: true, covering_for: "codex", covered_status: "timeout", role: "surgeon", piece: "piece-02", status: "success", attempts: 1, invocations: 2, family: "xai", counted_for_quorum: true,
      result: { agent: "grok", status: "success", attempts: 1, duration_ms: 5, review: { verdict: "MODIFY", confidence: 0.5, summary: "s", review_contract: PEER_CONTRACT, reviewed_scope: [{ quote: "q", assessment: "a" }], improvements: ["idea"], findings: [] } } },
      { roleBrief: { version: 1, sha256: "a".repeat(64) } });
    for (const [key, value] of Object.entries({ agent: "grok", cover: true, native: false, covering_for: "codex", covered_status: "timeout", role: "surgeon", piece: "piece-02", status: "success", attempts: 1, counted_for_quorum: true, family: "xai", verdict: "MODIFY", review_contract: PEER_CONTRACT })) {
      assert.deepEqual(row[key], value, key);
    }
    assert.deepEqual(row.role_brief, { version: 1, sha256: "a".repeat(64) });
    assert.deepEqual(row.suggested_improvements, ["idea"]);
    // The dispatcher keeps covers out of reviewers[] (one row per route; the completion validator refuses duplicates).
    const reportBlock = source.slice(source.indexOf("  const report = {"), source.indexOf("  // Durable evidence, persisted BEFORE"));
    assert.match(reportBlock, /covers: coverRows/);
    assert.match(reportBlock, /model_families: MODEL_FAMILIES/);
    assert.match(reportBlock, /reviewers: results\.map\(/);
  });

  await test("--cover is opt-in and documented", () => {
    const help = spawnSync(process.execPath, [path.join(scripts, "multi-review.mjs"), "--cover", "--help"], { encoding: "utf8", windowsHide: true, timeout: 30000, env: { ...process.env, NO_UPDATE_CHECK: "1" } });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--cover\s+/);
    const parse = source.slice(source.indexOf("function parseArgs("), source.indexOf("export function parseReviewDepth("));
    assert.match(parse, /arg === "--cover"\) options\.cover = true/);
    assert.ok(!/cover: true/.test(parse.slice(0, parse.indexOf("for (let index"))), "off by default");
    assert.match(fs.readFileSync(path.join(scripts, "..", "SKILL.md"), "utf8"), /--cover/);
  });

  // Gate-3 follow-up: on a split run the same route covers the same role on several pieces, and each cover
  // reaches buildOutstanding under one label; the per-reviewer count kept only the last one.
  await test("outstanding suggestions by reviewer add every cover's suggestions under one label", () => {
    const code = source.slice(source.indexOf("function buildOutstanding("), source.indexOf("function buildInsights("));
    const evidenceLocation = ({ cwd }) => ({ dir: path.join(cwd, ".ensemble_reviews"), home: null });
    const build = vm.runInNewContext(`${code};buildOutstanding`, { fs, path, process, evidenceLocation });
    const piece = (n) => ({ agent: "claude (cover for codex)", status: "success", review: { improvements: Array.from({ length: n }, (_, i) => `s${i}`) } });
    const out = build([], [{ agent: "claude", status: "success", review: { improvements: ["native"] } }, piece(2), piece(3)], "rev_synthetic", os.tmpdir(), 1, null, { met: true });
    assert.equal(out.untriaged_suggestions, 6);
    assert.deepEqual({ ...out.suggestions_by_reviewer }, { claude: 1, "claude (cover for codex)": 5 });
  });

  // ---- completion validator: covers are recounted, never trusted ----------------------------------
  const base = privateTestFixture("momm-cover-governor-");
  const write = (dir, p, value) => { const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof value === "string" ? value : JSON.stringify(value, null, 2)); };
  const scope = [{ quote: "module.exports = 42;", assessment: "Synthetic fixture." }];
  function fixture(name, { reviewers, covers, split = null, quorum = undefined }) {
    const dir = path.join(base, name); fs.mkdirSync(dir, { recursive: true });
    const code = "module.exports = 42;\n";
    write(dir, "answer.cjs", code);
    write(dir, "answer.test.cjs", "require('node:assert/strict').equal(require('./answer.cjs'), 42); console.log('ok');\n");
    const run = spawnSync(process.execPath, ["answer.test.cjs"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(run.status, 0);
    write(dir, "output.txt", run.stdout + run.stderr);
    const ref = (p) => ({ path: p, sha256: digest(fs.readFileSync(path.join(dir, p))) });
    const id = `rev_synthetic_cover_${name}`;
    const report = { run_id: id, governor: "antigravity", label: "SYNTHETIC cover fixture — not a live review", input_sha256: digest(code), source_snapshot: captureSourceSnapshot(dir, code, "answer.cjs"),
      gate_policy: { strict: false, quorum_required: 2, requested_routes: ["claude", "codex", "grok"], cover: true }, model_families: cover?.MODEL_FAMILIES ?? null,
      reviewers, covers, findings: [], ...(split ? { split } : {}), ...(quorum ? { quorum } : {}) };
    const rp = `.ensemble_reviews/reports/${id}.json`; write(dir, rp, report);
    const seal = ref(rp).sha256;
    write(dir, ".ensemble_reviews/review-log.jsonl", JSON.stringify({ run_id: id, report_path: rp, report_sha256: seal, input_sha256: report.input_sha256 }) + "\n");
    write(dir, `.ensemble_reviews/verification/${id}.json`, { schema: "momm-check/1", run_id: id, item_id: "run", report_sha256: seal, input_sha256: report.input_sha256, phase: "final", exit_code: 0, observed_at: new Date().toISOString(), command_label: "node answer.test.cjs", test: ref("answer.test.cjs"), output: ref("output.txt"), artifacts: [ref("answer.cjs")] });
    return { dir, id, seal, report };
  }
  const native = (agent, status, extra = {}) => ({ agent, status, attempts: 1, ...(status === "success" ? { review_contract: "momm-peer-review/3", reviewed_scope: scope, suggested_improvements: [] } : {}), ...extra });
  const coverRow = (agent, extra = {}) => ({ agent, cover: true, native: false, covering_for: "codex", covered_status: "timeout", role: "surgeon", status: "success", attempts: 1, counted_for_quorum: true, review_contract: "momm-peer-review/3", reviewed_scope: scope, suggested_improvements: [], ...extra });
  const baseReviewers = () => [native("claude", "success"), native("codex", "timeout"), native("grok", "timeout"), native("antigravity", "self_excluded")];

  await test("the completion validator counts a cover's vote only under the family rule", () => {
    need();
    const counted = fixture("counted", { reviewers: baseReviewers(), covers: [coverRow("grok")] });
    const r = inspectCompletion(counted.dir, counted.id);
    assert.equal(r.quorum.achieved, 2, JSON.stringify(r.errors));
    assert.equal(r.complete, true, JSON.stringify({ errors: r.errors, unresolved: r.unresolved }));
    const sameFamily = fixture("same_family", { reviewers: baseReviewers(), covers: [coverRow("claude")] });
    const s = inspectCompletion(sameFamily.dir, sameFamily.id);
    assert.equal(s.complete, false);
    assert.equal(s.quorum.achieved, 1, "a second anthropic answer is not a second vote");
    assert.ok(s.errors.some((e) => /cover counted as a quorum vote against the model-family rule: claude covering codex/.test(e)), JSON.stringify(s.errors));
    const unknown = fixture("unknown_family", { reviewers: baseReviewers(), covers: [coverRow("copilot", { counted_for_quorum: false })] });
    assert.equal(inspectCompletion(unknown.dir, unknown.id).quorum.achieved, 1, "coverage only, no vote");
  });

  await test("the completion validator refuses a cover beyond the budget or of an uncoverable status", () => {
    need();
    const twice = fixture("cover_retried", { reviewers: baseReviewers(), covers: [coverRow("grok", { attempts: 2 })] });
    assert.ok(inspectCompletion(twice.dir, twice.id).errors.some((e) => /cover exceeds the attempt budget: grok covering codex/.test(e)));
    const spent = fixture("native_retried", { reviewers: baseReviewers().map((r) => (r.agent === "codex" ? { ...r, status: "provider_unavailable", attempts: 2 } : r)), covers: [coverRow("grok", { covered_status: "provider_unavailable" })] });
    assert.ok(inspectCompletion(spent.dir, spent.id).errors.some((e) => /cover exceeds the attempt budget: grok covering codex/.test(e)));
    const login = fixture("login", { reviewers: baseReviewers().map((r) => (r.agent === "codex" ? { ...r, status: "authentication_required" } : r)), covers: [coverRow("grok", { covered_status: "authentication_required" })] });
    assert.ok(inspectCompletion(login.dir, login.id).errors.some((e) => /cover does not match a coverable failure: grok covering codex/.test(e)));
    const mismatch = fixture("status_mismatch", { reviewers: baseReviewers(), covers: [coverRow("grok", { covered_status: "error" })] });
    assert.ok(inspectCompletion(mismatch.dir, mismatch.id).errors.some((e) => /cover does not match a coverable failure/.test(e)));
    const governorCover = fixture("governor_cover", { reviewers: baseReviewers(), covers: [coverRow("antigravity")] });
    assert.ok(inspectCompletion(governorCover.dir, governorCover.id).errors.some((e) => /malformed cover row/.test(e)));
  });

  // Gate-3 triage of rev_20260930003709_e5847282134d (cover-attempt-budget-leak): every row was checked
  // alone, so two covers of one failed route on one piece each passed native 1 + 1 <= 2.
  await test("the completion validator counts earlier covers of a role against its budget; a route covers one role per piece", () => {
    need();
    const reviewers = [...baseReviewers(), native("copilot", "timeout")];
    const both = fixture("two_covers_one_role", { reviewers, covers: [coverRow("grok"), coverRow("copilot", { counted_for_quorum: false })] });
    const twoCovers = inspectCompletion(both.dir, both.id);
    assert.ok(twoCovers.errors.some((e) => /cover exceeds the attempt budget: copilot covering codex/.test(e)), JSON.stringify(twoCovers.errors));
    assert.ok(!twoCovers.errors.some((e) => /attempt budget: grok covering codex/.test(e)), "the first cover stays within the budget");
    const oneRoute = fixture("one_route_two_roles", { reviewers, covers: [coverRow("grok"), coverRow("grok", { covering_for: "copilot", counted_for_quorum: false })] });
    const r = inspectCompletion(oneRoute.dir, oneRoute.id);
    assert.ok(r.errors.some((e) => /a route covers at most one role per piece: grok covering copilot/.test(e)), JSON.stringify(r.errors));
    const doc = fs.readFileSync(path.join(scripts, "..", "references", "governor-completion.md"), "utf8");
    assert.match(doc, /every earlier cover of that role on that piece count/);
  });

  // Gate-3 triage (role-cover-contradiction, and the two heading suggestions): the B6 paragraph must state
  // the cover exception the validator applies, and Role cover is its own section.
  await test("governor-completion.md states the decision-role rule for covers without contradiction", () => {
    const doc = fs.readFileSync(path.join(scripts, "..", "references", "governor-completion.md"), "utf8").replace(/\r\n/g, "\n");
    const para = doc.split("\n\n").find((p) => p.startsWith("Optional `role` (1.17)")) ?? "";
    assert.match(para, /for a cover's suggestion, the role that cover performed/);
    assert.match(para, /else, for a route that only covered, its one covered role/);
    assert.doesNotMatch(para, /differs from the report's value for the row's `reviewer`/);
    assert.match(doc, /^### Role cover \(1\.17, `--cover`\)$/m);
    assert.match(doc, /\n\n### Mechanical `style` \(1\.17\)/);
  });

  // Final review of 1.17.0 (rev_20260930034635_c08cfb6df42f): the scorecard's role fallback applies to findings only
  // (a suggestion's role feeds no roster column), and the Role cover section carries one worked example.
  await test("governor-completion.md says the role fallback is for findings and gives a cover-role example", () => {
    const doc = fs.readFileSync(path.join(scripts, "..", "references", "governor-completion.md"), "utf8").replace(/\r\n/g, "\n");
    const para = (doc.split("\n\n").find((p) => p.startsWith("Optional `role` (1.17)")) ?? "").replace(/\s+/g, " ");
    assert.match(para, /Only a finding's `role` reaches the scorecard/);
    assert.match(para, /its one covered role \(none when it covered more than one\)/);
    // Final review rev_20260930054910_0852b507489e: "The role feeds only the roster" read as the suggestion's role.
    assert.match(para, /its one covered role \(none when it covered more than one\); a finding's role feeds only the scorecard's per-route, per-role roster/);
    assert.doesNotMatch(para, / The role feeds only /);
    assert.match(para, /no suggestion row, a cover's included, with or without `role`, is credited to any role, native or covered, or to cover success\./);
    const section = doc.slice(doc.indexOf("### Role cover (1.17, `--cover`)"), doc.indexOf("An observation file has this shape")).replace(/\s+/g, " ");
    assert.match(section, /a row on the suggestion `cover:0:0` may carry `"role": "surgeon"` and is refused with `"role": "innovator"`; a row on a finding `grok` raised may carry either\./);
  });

  await test("a cover's suggestions are governor obligations like any reviewer's", () => {
    need();
    const f = fixture("suggestions", { reviewers: baseReviewers(), covers: [coverRow("grok", { suggested_improvements: ["Consider naming the constant."] })] });
    const r = inspectCompletion(f.dir, f.id);
    const item = r.items.find((i) => i.kind === "suggestion" && i.reviewer === "grok");
    assert.ok(item, JSON.stringify(r.items));
    assert.equal(item.content, "Consider naming the constant.");
    assert.equal(r.complete, false, "an untriaged cover suggestion keeps the run open");
  });

  await test("B6 with covers: a decision on a cover's suggestion carries the cover's role, not the route's native role", () => {
    need();
    const f = fixture("roles", { reviewers: baseReviewers().map((r) => (r.agent === "grok" ? { ...r, role: "innovator" } : r.agent === "claude" ? { ...r, role: "architect" } : r)),
      covers: [coverRow("grok", { suggested_improvements: ["Consider naming the constant."] })] });
    const decide = (role) => {
      const item = inspectCompletion(f.dir, f.id).items.find((i) => i.kind === "suggestion" && i.reviewer === "grok");
      write(f.dir, ".ensemble_reviews/dispositions.jsonl", JSON.stringify({ run_id: f.id, item_id: item.item_id, reviewer: "grok", governor: "antigravity", report_sha256: f.seal, input_sha256: f.report.input_sha256, disposition: "rejected", reason: "not needed", ...(role === undefined ? {} : { role }) }) + "\n");
      return inspectCompletion(f.dir, f.id);
    };
    assert.equal(decide("surgeon").complete, true, "the cover performed the vacated surgeon role");
    assert.equal(decide(undefined).complete, true, "role stays optional");
    const wrong = decide("innovator");
    assert.equal(wrong.complete, false, "grok's native role is not the role of its cover's suggestion");
    assert.ok(wrong.unresolved.some((u) => /role/.test(u.reason)), JSON.stringify(wrong.unresolved));
  });

  await test("split runs: a cover vote is counted per piece", () => {
    need();
    const pieceBlock = (reviewers, extra = {}) => ({ id: "piece-01", reviewers, ...extra });
    const reviewers = [native("claude", "success", { pieces: { success: 1 } }), native("codex", "timeout"), native("grok", "timeout"), native("antigravity", "self_excluded")];
    const f = fixture("split", { reviewers, covers: [coverRow("grok", { piece: "piece-01" })], split: { ceiling_bytes: 4096, pieces: [pieceBlock({ claude: "success", codex: "timeout", grok: "timeout", antigravity: "self_excluded" }, { external_successes: 2, quorum_met: true })], governor_direct: [] }, quorum: { required: 2, achieved: 2, met: true, pieces: 1 } });
    const r = inspectCompletion(f.dir, f.id);
    assert.equal(r.complete, true, JSON.stringify({ errors: r.errors }));
    assert.equal(r.quorum.achieved, 2);
    const orphan = fixture("split_orphan", { reviewers, covers: [coverRow("grok", { piece: "piece-09" })], split: { ceiling_bytes: 4096, pieces: [pieceBlock({ claude: "success", codex: "timeout", grok: "timeout" })], governor_direct: [] }, quorum: { required: 2, achieved: 1, met: false, pieces: 1 } });
    assert.ok(inspectCompletion(orphan.dir, orphan.id).errors.some((e) => /malformed cover row/.test(e)));
  });
  fs.rmSync(base, { recursive: true, force: true });
} finally {
  console.log(JSON.stringify({ passed, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
