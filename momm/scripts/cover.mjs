// MOMM 1.17 B3: opt-in role cover with one attempt budget. Pure decisions (eligibility, route choice,
// vote counting, report rows) plus one small orchestrator that takes the invoker as an argument, so the
// C2 property test drives exactly this code without processes.
//
// With --cover, when a route's review of a piece ends timeout, invalid_output, provider_unavailable or
// error, the same role brief may go to another requested route for that piece. Rules:
// - One attempt budget per piece and role: at most ATTEMPT_BUDGET route invocations in total, counted
//   across the outage retry, --retry-invalid and the cover; every invocation counts, failed ones too.
//   An outage is retried once automatically, so in practice it has no budget left for a cover.
// - Never around a login or an allowance (NEVER_COVERED_STATUSES), and never an unknown status.
// - The cover route gets the vacated role's brief and the failure status, and no other reviewer's
//   claims: route CLIs take one prompt, and sharing claims would make the cover's opinion depend on theirs.
// - A cover adds a quorum vote only if its model family is known and differs from every family that
//   already has a successful review of the piece (natives and earlier covers). Otherwise it adds role
//   coverage only. Native reviews keep their counting.
export const ATTEMPT_BUDGET = 2;
export const COVERABLE_STATUSES = Object.freeze(["timeout", "invalid_output", "provider_unavailable", "error"]);
export const NEVER_COVERED_STATUSES = Object.freeze(["authentication_required", "quota", "ineligible_tier", "disabled_no_oauth", "self_excluded", "cancelled", "unsupported", "missing", "not_dispatched"]);
// Versioned, reported with every --cover run. copilot runs a model the user configures, so its family
// is unknown: as a cover it adds coverage, never a vote.
export const MODEL_FAMILIES = Object.freeze({ version: 1, map: Object.freeze({ codex: "openai", claude: "anthropic", antigravity: "google", gemini: "google", grok: "xai", copilot: "unknown" }) });

export function familyOf(route, table = MODEL_FAMILIES) {
  const family = table?.map && Object.hasOwn(table.map, route) ? table.map[route] : null;
  return typeof family === "string" && family && family !== "unknown" ? family : null;
}

// invocations: every route invocation already spent on this piece and role (native attempts plus any
// earlier cover). An unknown count is never treated as budget left.
export function coverDecision({ status, invocations }) {
  if (status === "success") return { eligible: false, reason: "the review succeeded" };
  if (NEVER_COVERED_STATUSES.includes(status)) return { eligible: false, reason: `${status} is never covered (a login, an allowance or a deliberate exclusion)` };
  if (!COVERABLE_STATUSES.includes(status)) return { eligible: false, reason: `unknown status ${JSON.stringify(String(status))} is terminal and never covered` };
  if (!Number.isInteger(invocations) || invocations < 1) return { eligible: false, reason: "the invocation count is unknown, so no budget is assumed" };
  if (invocations >= ATTEMPT_BUDGET) return { eligible: false, reason: `attempt budget spent (${invocations} of ${ATTEMPT_BUDGET} invocations)` };
  return { eligible: true, remaining: ATTEMPT_BUDGET - invocations };
}

// A requested route other than the failed one and the governor, not already covering on this piece:
// first one whose own review of the piece succeeded (known to work now), then one that failed only
// transiently. A route blocked by a login, allowance or modality is never chosen.
export function chooseCoverRoute({ failedRoute, requested, governor, natives, used = [] }) {
  const statusOf = (route) => natives.find((n) => n.agent === route)?.status;
  const candidates = [...new Set(requested)].filter((route) => route !== failedRoute && route !== governor && !used.includes(route));
  return candidates.find((route) => statusOf(route) === "success") ?? candidates.find((route) => COVERABLE_STATUSES.includes(statusOf(route))) ?? null;
}

// Covers in order; each successful cover's family joins the set, so one family never votes twice.
export function coverVotes(covers, { successFamilies = [], table = MODEL_FAMILIES } = {}) {
  const seen = new Set(successFamilies.filter(Boolean));
  return covers.map((c) => {
    if (c.status !== "success") return { ...c, family: familyOf(c.agent, table) ?? "unknown", counted_for_quorum: false };
    const family = familyOf(c.agent, table);
    const counted = family !== null && !seen.has(family);
    if (family) seen.add(family);
    return { ...c, family: family ?? "unknown", counted_for_quorum: counted };
  });
}

// The contract section a cover route receives, after the vacated role's brief. Dispatcher-authored:
// the status comes from the closed vocabulary and is checked here.
export function coverSection({ role, covered_status: status }) {
  if (!COVERABLE_STATUSES.includes(status)) throw new Error(`cover refused: ${JSON.stringify(String(status))} is not a coverable status`);
  return `\n\n## Role cover\nThe route first assigned ${role ? `the ${role} role` : "the plain review contract"} for this artifact ended with status "${status}", so you are covering that role. Review the artifact independently: you are shown no other reviewer's output, and your answer is recorded as a cover, never as that route's review.`;
}

// natives: [{ agent, status, attempts }] for one piece (the governor's row included or not).
// previous: covers already run for this piece (the dispatcher makes one pass; a second pass can never
// buy more invocations or a second vote for a family). invoke(route, { role, covering_for,
// covered_status }) runs ONE invocation and returns the reviewer result.
export async function runPieceCovers({ piece = null, natives, requested, governor, roleOf, invoke, previous = [], enabled = true, table = MODEL_FAMILIES }) {
  if (!enabled) return [];
  const spent = (route) => previous.filter((c) => c.covering_for === route).reduce((n, c) => n + (Number.isInteger(c.attempts) ? c.attempts : ATTEMPT_BUDGET), 0);
  const used = previous.map((c) => c.agent);
  const plans = [];
  for (const native of natives) {
    if (native.agent === governor) continue;
    const invocations = Number.isInteger(native.attempts) ? native.attempts + spent(native.agent) : native.attempts;
    if (!coverDecision({ status: native.status, invocations }).eligible) continue;
    const route = chooseCoverRoute({ failedRoute: native.agent, requested, governor, natives, used });
    if (!route) continue;
    used.push(route);
    plans.push({ route, invocations, request: { role: roleOf(native.agent) ?? null, covering_for: native.agent, covered_status: native.status } });
  }
  const results = await Promise.all(plans.map((plan) => invoke(plan.route, { ...plan.request })));
  const covers = plans.map((plan, i) => {
    const result = results[i] ?? { agent: plan.route, status: "error", attempts: 1 };
    const attempts = Number.isInteger(result.attempts) ? result.attempts : 1;
    return { agent: plan.route, cover: true, ...plan.request, ...(piece ? { piece } : {}), status: result.status, attempts, invocations: plan.invocations + attempts, result };
  });
  const successFamilies = [
    ...natives.filter((n) => n.agent !== governor && n.status === "success").map((n) => familyOf(n.agent, table)),
    ...previous.filter((c) => c.status === "success").map((c) => familyOf(c.agent, table)),
  ];
  return coverVotes(covers, { successFamilies, table });
}

// The report entry for one cover: labelled, never a native review row.
export function coverReportRow(c, { roleBrief = null } = {}) {
  const r = c.result ?? {};
  return {
    agent: c.agent, cover: true, native: false, covering_for: c.covering_for, covered_status: c.covered_status,
    role: c.role ?? null, role_brief: roleBrief ?? null, ...(c.piece ? { piece: c.piece } : {}),
    status: c.status, attempts: c.attempts, family: c.family ?? "unknown", counted_for_quorum: c.counted_for_quorum === true,
    duration_ms: r.duration_ms ?? null, detail: r.detail || null,
    verdict: r.review?.verdict || null, confidence: r.review?.confidence ?? null, summary: r.review?.summary || null,
    review_contract: r.review?.review_contract ?? null, reviewed_scope: r.review?.reviewed_scope ?? null,
    suggested_improvements: r.review?.improvements ?? null, usage: r.usage ?? null,
  };
}

// What a split piece block lists: the roles covered on it and how.
export function pieceCoverSummary(covers) {
  return covers.map((c) => ({ role: c.role ?? null, covering_for: c.covering_for, covered_status: c.covered_status, by: c.agent, status: c.status, counted_for_quorum: c.counted_for_quorum === true }));
}
