// Tests for usage.mjs (MOMM 1.16.0 E1). Run: node momm/scripts/usage.test.mjs
import assert from "node:assert/strict";
import { parseUsage, inputEstimate, rollupUsage, lastJsonObject, ESTIMATE_METHOD } from "./usage.mjs";

const passed = [], failures = [];
const test = (name, fn) => { try { fn(); passed.push(name); } catch (e) { failures.push({ test: name, error: e.message }); } };
const ESC = String.fromCharCode(27);
// Walks the value BEFORE serialisation: JSON.stringify turns NaN/Infinity into
// null, which would hide exactly the evidence this guard exists to catch.
const nonfinite = (v, path = "$") => {
  if (typeof v === "number") return Number.isFinite(v) ? null : `${path}=${v}`;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i += 1) { const r = nonfinite(v[i], `${path}[${i}]`); if (r) return r; } return null; }
  if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) { const r = nonfinite(x, `${path}.${k}`); if (r) return r; } return null; }
  return null;
};
const noNaN = (v) => { const hit = nonfinite(v); assert.equal(hit, null, `non-finite number at ${hit}`); };

test("noNaN helper catches NaN and Infinity before serialisation hides them", () => {
  assert.throws(() => noNaN({ a: NaN }), /non-finite/);
  assert.throws(() => noNaN({ rows: [{ ratio: Infinity }] }), /non-finite/);
  assert.throws(() => noNaN([-Infinity]), /non-finite/);
  noNaN({ a: 1, b: [0, { c: -2.5 }], d: null, e: "NaN" }); // a string is not a number
  assert.equal(JSON.stringify({ a: NaN }), '{"a":null}', "serialisation erases the evidence a stringify-based check relies on");
});

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
  assert.equal(codex.coverage.tokens_ratio, 0.666667);
  assert.equal(codex.coverage.cost_ratio, 0);
  assert.equal(grok.coverage.tokens_ratio, 1);
  assert.equal(grok.coverage.cost_ratio, 0.666667);
  assert.equal(grok.total_cost_usd, 0.03);
  assert.equal(grok.cost_per_accepted_finding, 0.03); // 0.03 over the 1 accepted finding of the two costed rows; the uncosted row's 2 findings are outside the covered population
  assert.equal(grok.median_total_tokens, 20000);
  assert.ok(!("input_tokens" in grok), "no cross-route or per-route summed input_tokens");
  noNaN(out);
  assert.deepEqual(rollupUsage([]), []);
});


test("rollup fallback total honours field_map: separate reasoning/cached tokens are added, embedded ones are not", () => {
  const separate = { cache_in_input: true, reasoning_in_output: false, units: "tokens", source: "cli" }; // grok
  const embedded = { cache_in_input: false, reasoning_in_output: true, units: "tokens", source: "cli" }; // claude
  const parts = (input, output, reasoning, cached) => ({ input_tokens: input, output_tokens: output, reasoning_tokens: reasoning, cached_tokens: cached, total_tokens: null, cost_usd: null, model: null, cli_version: null });
  const [grok] = rollupUsage([row("grok", parts(10, 5, 20, 3), { field_map: separate })]);
  assert.equal(grok.median_total_tokens, 35); // reasoning sits outside output_tokens; cached sits inside input_tokens
  const [claude] = rollupUsage([row("claude", parts(10, 5, 20, 3), { field_map: embedded })]);
  assert.equal(claude.median_total_tokens, 18); // reasoning inside output; cached outside input
  const [unknown] = rollupUsage([row("codex", parts(10, 5, 20, 3))]);
  assert.equal(unknown.median_total_tokens, 15); // no field_map: only the buckets known to be disjoint
  const [reported] = rollupUsage([row("grok", { ...parts(10, 5, 20, 3), total_tokens: 99 }, { field_map: separate })]);
  assert.equal(reported.median_total_tokens, 99); // a CLI-reported total always wins
  const [noReasoning] = rollupUsage([row("grok", parts(10, 5, null, null), { field_map: separate })]);
  assert.equal(noReasoning.median_total_tokens, 15);
  noNaN([grok, claude, unknown, reported, noReasoning]);
});

test("copilot: a child object on its own line does not hide the enclosing envelope's usage", () => {
  const envelope = ["{", '  "type": "result",', '  "model": "gpt-5.5",', '  "usage": {"input_tokens": 800, "output_tokens": 120},', '  "message":', '    {"role": "assistant", "content": "{\\"findings\\":[]}"}', "}"].join("\n");
  const u = parseUsage("copilot", envelope);
  assert.equal(u.reported?.input_tokens, 800);
  assert.equal(u.reported?.output_tokens, 120);
  assert.equal(u.reported?.model, "gpt-5.5");
  assert.deepEqual(u.coverage, { tokens: true, cost: false });
  // JSONL lines that do carry usage still win over the envelope fallback
  const jsonl = [JSON.stringify({ type: "message" }), JSON.stringify({ type: "result", usage: { input_tokens: 1, output_tokens: 2 } })].join("\n");
  assert.equal(parseUsage("copilot", jsonl).reported.input_tokens, 1);
});

test("counts are finite numbers only: arrays and numeric strings in JSON are not counts", () => {
  const arrays = parseUsage("claude", JSON.stringify({ usage: { input_tokens: [], output_tokens: [] } }));
  assert.equal(arrays.reported, null);
  assert.deepEqual(arrays.coverage, { tokens: false, cost: false });
  assert.equal(parseUsage("claude", JSON.stringify({ usage: { input_tokens: ["5"], output_tokens: 3 } })).reported.input_tokens, null);
  assert.equal(parseUsage("grok", JSON.stringify({ usage: { input_tokens: "1200", output_tokens: "340", total_tokens: "1540" } })).reported, null);
  assert.equal(parseUsage("grok", JSON.stringify({ usage: { input_tokens: 1200, output_tokens: -1 } })).reported.output_tokens, null);
  assert.equal(parseUsage("grok", JSON.stringify({ usage: { input_tokens: 1200, output_tokens: 340, total_cost_usd: "0.02" } })).reported.cost_usd, null);
  // the codex plain-text path still reads its own "7,200" capture
  assert.equal(parseUsage("codex", "tokens used\n7,200\n").reported.total_tokens, 7200);
});

test("cost_per_accepted_finding uses the costed rows for both numerator and denominator", () => {
  const [mixed] = rollupUsage([row("grok", rep(1000, 1), { accepted_findings: 1 }), row("grok", rep(2000, null), { accepted_findings: 9 })]);
  assert.equal(mixed.total_cost_usd, 1);
  assert.equal(mixed.cost_per_accepted_finding, 1); // not 0.10: the nine findings came from a review whose cost is unknown
  const [none] = rollupUsage([row("grok", rep(1000, 1), { accepted_findings: 0 }), row("grok", rep(2000, null), { accepted_findings: 5 })]);
  assert.equal(none.cost_per_accepted_finding, "no accepted findings");
  const [all] = rollupUsage([row("grok", rep(1000, 0.5), { accepted_findings: 2 }), row("grok", rep(2000, 0.5), { accepted_findings: 2 })]);
  assert.equal(all.cost_per_accepted_finding, 0.25);
  noNaN([mixed, none, all]);
});

test("lastJsonObject: a stray opening brace in earlier diagnostic text does not hide a later complete object", () => {
  // Gate rev_20260919000938_1nkh. The truncated-tail rule is unchanged: nothing complete follows it.
  assert.deepEqual(lastJsonObject('progress {\n{"usage":{"input_tokens":1}}'), { usage: { input_tokens: 1 } });
  assert.deepEqual(lastJsonObject('a { b { c {"k":1} trailing'), { k: 1 });
  assert.equal(lastJsonObject('{"early":1}\n{"usage": {"input_tokens": 1'), null);
  assert.equal(lastJsonObject("{".repeat(5000)), null, "bounded on hostile input");
  assert.equal(parseUsage("claude", `warning: unmatched { in hook output\n${CLAUDE}`).reported.input_tokens, parseUsage("claude", CLAUDE).reported.input_tokens);
});
test("lastJsonObject tolerates missing text", () => {
  assert.equal(lastJsonObject(null), null);
  assert.equal(lastJsonObject(undefined), null);
  assert.equal(lastJsonObject(""), null);
  assert.equal(lastJsonObject(42), null);
  assert.deepEqual(lastJsonObject('{"a":1}'), { a: 1 });
});

test("grok cached tokens: cache_read_input_tokens (the route's own field) or prompt_tokens_details.cached_tokens", () => {
  const openai = parseUsage("grok", JSON.stringify({ text: "{}", usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 40 } } }));
  assert.equal(openai.reported.cached_tokens, 40);
  const both = parseUsage("grok", JSON.stringify({ text: "{}", usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 25, prompt_tokens_details: { cached_tokens: 40 } } }));
  assert.equal(both.reported.cached_tokens, 25); // the route's own field wins when both appear
  assert.equal(parseUsage("grok", JSON.stringify({ text: "{}", usage: { input_tokens: 100, output_tokens: 10, prompt_tokens_details: { cached_tokens: [] } } })).reported.cached_tokens, null);
  assert.equal(parseUsage("grok", JSON.stringify({ text: "{}", usage: { input_tokens: 100, output_tokens: 10 } })).reported.cached_tokens, null);
});

console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
