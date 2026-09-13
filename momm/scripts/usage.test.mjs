// Tests for usage.mjs (MOMM 1.16.0 E1). Run: node momm/scripts/usage.test.mjs
import assert from "node:assert/strict";
import { parseUsage, inputEstimate, rollupUsage, lastJsonObject, ESTIMATE_METHOD } from "./usage.mjs";

const passed = [], failures = [];
const test = (name, fn) => { try { fn(); passed.push(name); } catch (e) { failures.push({ test: name, error: e.message }); } };
const ESC = String.fromCharCode(27);
const noNaN = (v) => { const s = JSON.stringify(v); assert(!/NaN|Infinity/.test(s), `NaN/Infinity in ${s}`); };

const CLAUDE = JSON.stringify({
  type: "result", subtype: "success", is_error: false, num_turns: 1, result: "{\"findings\":[]}",
  total_cost_usd: 0.0421, duration_ms: 24000,
  usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 500, cache_creation_input_tokens: 100, output_tokens_details: { thinking_tokens: 120 } },
  modelUsage: { "claude-fable-5-1": { inputTokens: 1200, outputTokens: 340 } },
});
const GROK = JSON.stringify({
  text: "{\"findings\":[]}", stopReason: "end_turn", total_cost_usd: 0.0187,
  usage: { input_tokens: 28700, output_tokens: 900, reasoning_tokens: 650, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, total_tokens: 30250 },
  modelUsage: { "grok-4.6-build": { input_tokens: 28700 } },
});

test("claude json envelope parses exactly", () => {
  const u = parseUsage("claude", CLAUDE);
  assert.deepEqual(u.reported, { input_tokens: 1200, output_tokens: 340, reasoning_tokens: 120, cached_tokens: 600, total_tokens: 2140, cost_usd: 0.0421, model: "claude-fable-5-1", cli_version: null });
  assert.deepEqual(u.field_map, { cache_in_input: false, reasoning_in_output: true, units: "tokens", source: "cli" });
  assert.deepEqual(u.coverage, { tokens: true, cost: true });
});

test("grok json envelope parses exactly", () => {
  const u = parseUsage("grok", `Some banner line\n${GROK}\n`);
  assert.deepEqual(u.reported, { input_tokens: 28700, output_tokens: 900, reasoning_tokens: 650, cached_tokens: 4000, total_tokens: 30250, cost_usd: 0.0187, model: "grok-4.6-build", cli_version: null });
  assert.deepEqual(u.field_map, { cache_in_input: true, reasoning_in_output: false, units: "tokens", source: "cli" });
  assert.deepEqual(u.coverage, { tokens: true, cost: true });
});

test("ANSI-wrapped JSON parses", () => {
  const wrapped = `${ESC}[32m${CLAUDE.slice(0, 40)}${ESC}[0m${CLAUDE.slice(40)}${ESC}]0;title${String.fromCharCode(7)}`;
  assert.equal(parseUsage("claude", wrapped).reported.input_tokens, 1200);
  assert.equal(parseUsage("claude", wrapped).reported.cost_usd, 0.0421);
});

test("antigravity envelope has no usage -> null, coverage false", () => {
  const u = parseUsage("antigravity", JSON.stringify({ conversation_id: "x", status: "SUCCESS", response: "{\"findings\":[]}", duration_seconds: 44.2, num_turns: 1 }));
  assert.equal(u.reported, null);
  assert.deepEqual(u.coverage, { tokens: false, cost: false });
  assert.equal(parseUsage("agy", "{\"status\":\"SUCCESS\",\"response\":\"\"}").reported, null);
});

test("codex plain 'tokens used' parses as total only", () => {
  const out = `OpenAI Codex v0.154.0 (research preview)\n--------\nworkdir: D:\\tmp\nmodel: gpt-6-astra\nprovider: openai\nreasoning effort: ultra\n--------\n{"findings":[]}\ntokens used\n7,200\n`;
  const u = parseUsage("codex", out);
  assert.deepEqual(u.reported, { input_tokens: null, output_tokens: null, reasoning_tokens: null, cached_tokens: null, total_tokens: 7200, cost_usd: null, model: "gpt-6-astra", cli_version: "0.154.0" });
  assert.deepEqual(u.coverage, { tokens: true, cost: false });
  assert.equal(parseUsage("codex", "tokens used: 512").reported.total_tokens, 512);
  assert.equal(parseUsage("codex", "tokens used 64\nlater tokens used 65").reported.total_tokens, 65);
  assert.equal(parseUsage("codex", "no usage here").reported, null);
});

test("codex JSONL token_count events use the last one", () => {
  const lines = [
    { type: "thread.started", thread_id: "t1" },
    { type: "token_count", info: { total_token_usage: { input_tokens: 1000, output_tokens: 50, total_tokens: 1050 } } },
    { type: "item.completed", item: { type: "agent_message", text: "{\"findings\":[]}" } },
    { type: "token_count", info: { total_token_usage: { input_tokens: 5000, cached_input_tokens: 2000, output_tokens: 300, total_tokens: 5300 } } },
  ].map((o) => JSON.stringify(o)).join("\n");
  const u = parseUsage("codex", lines);
  assert.equal(u.reported.input_tokens, 5000);
  assert.equal(u.reported.output_tokens, 300);
  assert.equal(u.reported.total_tokens, 5300);
  assert.equal(u.reported.cached_tokens, 2000);
  assert.equal(u.reported.cost_usd, null);
  assert.deepEqual(u.coverage, { tokens: true, cost: false });
});

test("copilot JSONL with a usage object parses; without one -> null", () => {
  const withUsage = [{ type: "message", content: "{\"findings\":[]}" }, { type: "result", usage: { input_tokens: 800, output_tokens: 120 }, model: "gpt-5.5" }].map((o) => JSON.stringify(o)).join("\n");
  const u = parseUsage("copilot", withUsage);
  assert.equal(u.reported.input_tokens, 800);
  assert.equal(u.reported.output_tokens, 120);
  assert.equal(u.reported.model, "gpt-5.5");
  assert.equal(u.reported.total_tokens, null);
  assert.deepEqual(u.coverage, { tokens: true, cost: false });
  const bare = parseUsage("copilot", JSON.stringify({ type: "message", content: "{\"findings\":[]}" }));
  assert.equal(bare.reported, null);
  assert.deepEqual(bare.coverage, { tokens: false, cost: false });
});

test("gemini stats parse; stats without token numbers -> null", () => {
  const u = parseUsage("gemini", JSON.stringify({ response: "{}", stats: { models: { "gemini-3.8-flash": { tokens: { prompt: 900, candidates: 200, total: 1100, cached: 300, thoughts: 50 } } } } }));
  assert.deepEqual(u.reported, { input_tokens: 900, output_tokens: 200, reasoning_tokens: 50, cached_tokens: 300, total_tokens: 1100, cost_usd: null, model: "gemini-3.8-flash", cli_version: null });
  const flat = parseUsage("gemini", JSON.stringify({ response: "{}", stats: { input_tokens: 10, output_tokens: 5 } }));
  assert.equal(flat.reported.input_tokens, 10);
  assert.equal(parseUsage("gemini", JSON.stringify({ response: "{}", stats: { duration_ms: 3000 } })).reported, null);
});

test("absent fields are null, never 0; garbage and unbalanced JSON -> null", () => {
  const u = parseUsage("claude", JSON.stringify({ usage: { input_tokens: 5 } }));
  assert.equal(u.reported.output_tokens, null);
  assert.equal(u.reported.cached_tokens, null);
  assert.equal(u.reported.total_tokens, null);
  assert.equal(u.reported.cost_usd, null);
  assert.equal(parseUsage("claude", "not json at all").reported, null);
  assert.equal(parseUsage("claude", `${CLAUDE}\n{"usage": {"input_tokens": 1`).reported, null);
  assert.equal(parseUsage("unknown-route", CLAUDE).reported, null);
  assert.equal(parseUsage("claude", null).reported, null);
  assert.equal(lastJsonObject("x {\"a\":\"}\"} y {\"b\":{\"c\":1}} z").b.c, 1);
});

test("inputEstimate labels its method", () => {
  const e = inputEstimate("a".repeat(4001));
  assert.deepEqual(e, { chars: 4001, tokens_est: 1001, method: ESTIMATE_METHOD });
  assert.match(e.method, /ASCII heuristic/);
  assert.deepEqual(inputEstimate(""), { chars: 0, tokens_est: 0, method: ESTIMATE_METHOD });
});

const row = (agent, reported, extra = {}) => ({ agent, status: "success", reported, coverage: { tokens: reported?.total_tokens != null || reported?.input_tokens != null, cost: reported?.cost_usd != null }, ...extra });
const rep = (total, cost) => ({ input_tokens: null, output_tokens: null, reasoning_tokens: null, cached_tokens: null, total_tokens: total, cost_usd: cost, model: null, cli_version: null });

test("rollup with zero accepted findings returns the string", () => {
  const [r] = rollupUsage([row("claude", rep(2000, 0.04), { accepted_findings: 0 }), row("claude", rep(3000, 0.06), { accepted_findings: 0 })]);
  assert.equal(r.cost_per_accepted_finding, "no accepted findings");
  assert.equal(r.total_cost_usd, 0.1);
  assert.equal(r.median_total_tokens, 2500);
  assert.equal(r.coverage.tokens, "2 of 2");
  noNaN(r);
});

test("rollup with no reported rows gives null medians and '0 of n'", () => {
  const [r] = rollupUsage([row("antigravity", null), row("antigravity", null), { agent: "antigravity", status: "timeout" }]);
  assert.deepEqual(r, { agent: "antigravity", reviews: 3, tokens_reported: 0, cost_reported: 0, coverage: { tokens: "0 of 3", cost: "0 of 3", tokens_ratio: 0, cost_ratio: 0 }, median_total_tokens: null, total_cost_usd: null, cost_per_accepted_finding: null });
  noNaN(r);
});

test("rollup counts token and cost coverage separately, includes uncosted reviews in the divisor", () => {
  const rows = [
    row("codex", rep(7200, null), { accepted_findings: 2 }),
    row("codex", rep(9000, null), { accepted_findings: 0 }),
    row("codex", null, { accepted_findings: 1 }),
    row("grok", rep(30250, 0.02), { accepted_findings: 1 }),
    row("grok", rep(10000, 0.01), { accepted_findings: 0 }),
    row("grok", rep(20000, null), { accepted_findings: 2 }),
  ];
  const out = rollupUsage(rows);
  assert.deepEqual(out.map((r) => r.agent), ["codex", "grok"]);
  const [codex, grok] = out;
  assert.equal(codex.coverage.tokens, "2 of 3");
  assert.equal(codex.coverage.cost, "0 of 3");
  assert.equal(codex.median_total_tokens, 8100);
  assert.equal(codex.total_cost_usd, null);
  assert.equal(codex.cost_per_accepted_finding, null);
  assert.equal(grok.coverage.cost, "2 of 3");
  assert.equal(grok.cost_ratio ?? grok.coverage.cost_ratio, grok.coverage.cost_ratio);
  assert.equal(grok.total_cost_usd, 0.03);
  assert.equal(grok.cost_per_accepted_finding, 0.01); // 0.03 / (1+0+2)
  assert.equal(grok.median_total_tokens, 20000);
  assert.ok(!("input_tokens" in grok), "no cross-route or per-route summed input_tokens");
  noNaN(out);
  assert.deepEqual(rollupUsage([]), []);
});

console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
