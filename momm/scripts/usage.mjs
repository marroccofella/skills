// MOMM 1.16.0 E1 — token and cost accounting per review.
//
// parseUsage(agent, stdout)  reads what a reviewer CLI reported about itself
//                            (never estimates; absent -> null, never 0).
// inputEstimate(text)        the dispatcher's own chars/4 heuristic, labelled.
// rollupUsage(rows)          per-route aggregates with separate coverage for
//                            tokens and cost; no cross-route sums, no NaN.
//
// Field semantics differ per route, so every parse carries a field_map saying
// whether cached tokens sit inside input_tokens and whether reasoning tokens
// sit inside output_tokens. Callers must not add input_tokens across routes.
// Zero dependencies; Node 18+; self-contained (nothing imported from
// multi-review.mjs so the dispatcher can import this without a cycle).

const ANSI_SEQUENCES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
export const ESTIMATE_METHOD = "chars/4 (ASCII heuristic; diverges on multi-byte or token-dense text)";

const FIELD_MAPS = {
  claude: { cache_in_input: false, reasoning_in_output: true },
  grok: { cache_in_input: true, reasoning_in_output: false },
  codex: { cache_in_input: null, reasoning_in_output: null },
  antigravity: { cache_in_input: null, reasoning_in_output: null },
  copilot: { cache_in_input: null, reasoning_in_output: null },
  gemini: { cache_in_input: null, reasoning_in_output: null },
};
const KEYS = {
  input: ["input_tokens", "prompt_tokens", "input", "prompt", "promptTokenCount"],
  output: ["output_tokens", "completion_tokens", "output", "candidates", "candidatesTokenCount"],
  total: ["total_tokens", "total", "totalTokenCount"],
  cached: ["cached_tokens", "cached_input_tokens", "cache_read_input_tokens", "cached", "cachedContentTokenCount"],
  reasoning: ["reasoning_tokens", "reasoning_output_tokens", "thoughts", "thoughts_tokens", "thoughtsTokenCount"],
};

export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_SEQUENCES, "");
}

// Non-negative finite NUMBER, or null. Arrays, strings, booleans and objects
// are shapes we do not understand, so they are "not reported", never 0
// (Number([]) is 0, Number(["5"]) is 5 — coercion would invent counts).
function num(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
// Plain-text captures such as codex's "tokens used\n7,200" are parsed here.
function numFromText(text) {
  const s = String(text ?? "").trim().replace(/[,_]/g, "");
  return s !== "" ? num(Number(s)) : null;
}
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const firstKey = (o) => (isObject(o) && Object.keys(o).length ? Object.keys(o)[0] : null);
const pick = (obj, names) => { for (const k of names) { const v = num(obj?.[k]); if (v !== null) return v; } return null; };

// Last balanced top-level JSON object in text (string-aware). Non-JSON around
// it is ignored; an unbalanced tail returns null rather than an earlier guess.
// A stray "{" in diagnostic text before the object would leave the scan unbalanced too, so the scan
// resumes just after an unclosed opener (a bounded number of times): a complete object that follows
// is still found, while a truncated tail, which nothing complete follows, still returns null.
export function lastJsonObject(text) {
  text = typeof text === "string" ? text : String(text ?? "");
  let from = 0;
  for (let attempt = 0; attempt < 16; attempt++) {
    let start = -1, depth = 0, inString = false, escaped = false, last = null;
    for (let i = from; i < text.length; i++) {
      const c = text[i];
      if (depth === 0) { if (c === "{") { start = i; depth = 1; } continue; }
      if (inString) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') inString = false; continue; }
      if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { try { last = JSON.parse(text.slice(start, i + 1)); } catch { /* keep previous */ } }
    }
    if (depth === 0) return isObject(last) ? last : null;
    from = start + 1;
  }
  return null;
}

// JSONL: one object per non-empty line; lines that are not JSON are skipped.
function jsonLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try { const o = JSON.parse(t); if (isObject(o)) out.push(o); } catch { /* not JSON */ }
  }
  return out;
}

// Read a token-count object through the alias table; null unless at least one
// of input/output/total is a number (a bare cached count is not usage).
function readTokens(obj) {
  if (!isObject(obj)) return null;
  const t = { input: pick(obj, KEYS.input), output: pick(obj, KEYS.output), total: pick(obj, KEYS.total), cached: pick(obj, KEYS.cached), reasoning: pick(obj, KEYS.reasoning) };
  return t.input === null && t.output === null && t.total === null ? null : t;
}

// Depth-first search for a usage-shaped object under the usual key names.
function findUsage(obj, depth = 0) {
  if (!isObject(obj) || depth > 6) return null;
  for (const key of ["usage", "token_usage", "tokens", "total_token_usage", "last_token_usage"]) {
    const t = readTokens(obj[key]);
    if (t) return t;
  }
  for (const value of Object.values(obj)) { const t = findUsage(value, depth + 1); if (t) return t; }
  return null;
}

const report = (f = {}) => ({
  input_tokens: f.input ?? null, output_tokens: f.output ?? null, reasoning_tokens: f.reasoning ?? null,
  cached_tokens: f.cached ?? null, total_tokens: f.total ?? null, cost_usd: f.cost ?? null,
  model: typeof f.model === "string" && f.model ? f.model : null, cli_version: typeof f.cli_version === "string" && f.cli_version ? f.cli_version : null,
});

const ROUTES = {
  claude(text) {
    const o = lastJsonObject(text), u = o?.usage;
    if (!isObject(u)) return null;
    const cacheRead = num(u.cache_read_input_tokens), cacheCreate = num(u.cache_creation_input_tokens);
    const cached = cacheRead === null && cacheCreate === null ? null : (cacheRead ?? 0) + (cacheCreate ?? 0);
    const input = num(u.input_tokens), output = num(u.output_tokens);
    // Claude gives no total; cached is outside input_tokens, so the sum of
    // all reported buckets is the total processed (arithmetic, not estimate).
    const total = input !== null && output !== null ? input + output + (cached ?? 0) : null;
    return report({ input, output, cached, total, reasoning: num(u.output_tokens_details?.thinking_tokens),
      cost: num(o.total_cost_usd), model: firstKey(o.modelUsage) });
  },
  grok(text) {
    const o = lastJsonObject(text), u = o?.usage;
    if (!isObject(u)) return null;
    // Observed Grok envelopes carry Anthropic-style cache_read_input_tokens /
    // cache_creation_input_tokens (references/plan-1.16.0.md); an OpenAI-style
    // prompt_tokens_details.cached_tokens is accepted when those are absent.
    const cacheRead = num(u.cache_read_input_tokens), cacheCreate = num(u.cache_creation_input_tokens);
    const cached = cacheRead === null && cacheCreate === null ? num(u.prompt_tokens_details?.cached_tokens) : (cacheRead ?? 0) + (cacheCreate ?? 0);
    return report({ input: num(u.input_tokens), output: num(u.output_tokens), reasoning: num(u.reasoning_tokens), cached,
      total: num(u.total_tokens), cost: num(o.total_cost_usd ?? u.total_cost_usd), model: firstKey(o.modelUsage) ?? (typeof o.model === "string" ? o.model : null) });
  },
  codex(text) {
    const model = text.match(/^\s*model:\s*(\S+)/im)?.[1] ?? null;
    const cli_version = text.match(/OpenAI Codex v(\d+\.\d+\.\d+)/i)?.[1] ?? null;
    // --json: take the last token_count / turn.completed event that carries usage.
    const events = jsonLines(text).filter((o) => /token_count|turn\.completed/i.test(String(o.type ?? "")));
    for (const event of events.reverse()) {
      const t = findUsage(event) ?? readTokens(event);
      if (t) return report({ ...t, model, cli_version });
    }
    // plain exec: "tokens used\n7,200" | "tokens used: 7200" | "tokens used 7200"
    const plain = [...text.matchAll(/tokens used[:\s]*\r?\n?\s*([\d][\d,_]*)/gi)].pop();
    const total = plain ? numFromText(plain[1]) : null;
    return total === null ? null : report({ total, model, cli_version });
  },
  antigravity() { return null; }, // envelope has duration_seconds/num_turns, no token fields
  copilot(text) {
    const withCounts = (o) => { const t = findUsage(o); return t && (t.input !== null || t.output !== null) ? report({ ...t, model: typeof o.model === "string" ? o.model : null }) : null; };
    for (const o of jsonLines(text).reverse()) { const r = withCounts(o); if (r) return r; }
    // Multi-line envelope: a child object sitting on its own line parses as a
    // JSONL candidate without counters, so the enclosing envelope is always
    // tried when no line-based candidate carried usage.
    const envelope = lastJsonObject(text);
    return envelope ? withCounts(envelope) : null;
  },
  gemini(text) {
    const s = lastJsonObject(text)?.stats;
    if (!isObject(s)) return null;
    let t = readTokens(s) ?? readTokens(s.tokens);
    let model = null;
    if (!t && isObject(s.models)) { // {models:{<id>:{tokens:{prompt,candidates,total,cached,thoughts}}}}
      const per = Object.entries(s.models).map(([id, m]) => [id, readTokens(m?.tokens) ?? readTokens(m)]).filter(([, x]) => x);
      if (per.length) {
        model = per.length === 1 ? per[0][0] : null;
        const sum = (k) => per.every(([, x]) => x[k] !== null) ? per.reduce((a, [, x]) => a + x[k], 0) : null;
        t = { input: sum("input"), output: sum("output"), total: sum("total"), cached: sum("cached"), reasoning: sum("reasoning") };
      }
    }
    return t ? report({ ...t, model }) : null;
  },
};
ROUTES.agy = ROUTES.antigravity;

export function parseUsage(agent, rawStdout) {
  const route = String(agent ?? "").toLowerCase();
  const field_map = { ...(FIELD_MAPS[route === "agy" ? "antigravity" : route] ?? { cache_in_input: null, reasoning_in_output: null }), units: "tokens", source: "cli" };
  let reported = null;
  try { reported = ROUTES[route]?.(stripAnsi(rawStdout)) ?? null; } catch { reported = null; }
  const hasTokens = reported !== null && [reported.input_tokens, reported.output_tokens, reported.total_tokens].some((v) => v !== null);
  if (reported && !hasTokens && reported.cost_usd === null) reported = null;
  return { reported, field_map, coverage: { tokens: hasTokens, cost: reported !== null && reported.cost_usd !== null } };
}

export function inputEstimate(text) {
  const chars = String(text ?? "").length;
  return { chars, tokens_est: Math.ceil(chars / 4), method: ESTIMATE_METHOD };
}

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round6 = (x) => Math.round(x * 1e6) / 1e6;

export function rollupUsage(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isObject(row)) continue;
    const agent = String(row.agent ?? "unknown");
    if (!groups.has(agent)) groups.set(agent, []);
    groups.get(agent).push(row);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([agent, set]) => {
    const n = set.length;
    const totals = set.map((r) => {
      const rep = isObject(r.reported) ? r.reported : null;
      if (!rep || r.coverage?.tokens === false) return null;
      const t = num(rep.total_tokens); if (t !== null) return t;
      const i = num(rep.input_tokens), o = num(rep.output_tokens);
      if (i === null || o === null) return null;
      // Reconstruct only from buckets the row's field_map says are disjoint:
      // reasoning reported outside output_tokens, cached outside input_tokens.
      // Unknown semantics (null field_map) add nothing rather than double count.
      const fm = isObject(r.field_map) ? r.field_map : {};
      const reasoning = fm.reasoning_in_output === false ? num(rep.reasoning_tokens) ?? 0 : 0;
      const cached = fm.cache_in_input === false ? num(rep.cached_tokens) ?? 0 : 0;
      return i + o + reasoning + cached;
    }).filter((t) => t !== null);
    // Cost and the findings it bought are taken from the SAME rows: a review
    // whose cost is unknown contributes neither to the numerator nor to the
    // denominator, so the ratio describes the observed sample, not a mix.
    const costed = set.map((r) => ({ cost: num(isObject(r.reported) ? r.reported.cost_usd : null) ?? num(r.cost), accepted: num(r.accepted_findings) ?? 0 })).filter((x) => x.cost !== null);
    const acceptedCosted = costed.reduce((a, x) => a + x.accepted, 0);
    const totalCost = costed.length ? round6(costed.reduce((a, x) => a + x.cost, 0)) : null;
    const ratio = (k) => (n ? round6(k / n) : 0);
    return {
      agent, reviews: n, tokens_reported: totals.length, cost_reported: costed.length,
      coverage: { tokens: `${totals.length} of ${n}`, cost: `${costed.length} of ${n}`, tokens_ratio: ratio(totals.length), cost_ratio: ratio(costed.length) },
      median_total_tokens: median(totals),
      total_cost_usd: totalCost,
      cost_per_accepted_finding: totalCost === null ? null : acceptedCosted === 0 ? "no accepted findings" : round6(totalCost / acceptedCosted),
    };
  });
}
