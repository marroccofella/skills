// MOMM 1.17.1 S1 and S2: how a reviewer's answer string is read. Zero dependencies; every function
// here is pure. One matrix of answers runs against every route in review-answer.test.mjs.
//
// What each route accepts today (multi-review.mjs unless another file is named):
// - copilot (copilotReviewPayload): the content of the last assistant message of a completed, tool-free
//   turn in the JSONL event stream, read by strictAnswer below.
// - antigravity (antigravityStreamPayload): the `response` of the one final SUCCESS result, read by
//   strictAnswer below. Until 1.17.1 it took bare JSON only and refused a fenced answer.
// - claude, gemini (unwrapReviewPayload over extractJsonObjects): stdout is a JSON envelope; the
//   review is looked for in its answer field (`result`, `response`).
// - codex (the same functions): stdout is the answer text itself.
// - grok (grok-stream.mjs, then the same functions): the `text` events joined, wrapped as the
//   {text, stopReason} envelope json mode printed.
//   These four extract the top-level JSON objects found anywhere in the text and take the last one that
//   has findings[]. Prose, a fence of any kind or tag and earlier blocks are passed over, so they never
//   needed the fence rule. That behaviour is older than this module and is deliberately unchanged:
//   strictAnswer is not used there, and extraction is not added to the two strict routes: they read
//   the one fenced block or the whole answer, and never choose between candidates.
// No route repairs an answer: JSON that does not parse is refused everywhere.

// 1.17.1: a model sometimes returns its answer inside one Markdown code fence, against the contract
// (Copilot CLI 1.0.91, 4 October 2026, twice on a real 10 KB review), and sometimes writes a sentence
// of narration before that fence ("Good, I have everything needed to complete the review.": two of
// three answers refused in a 108 KB review the same day, known from their shape records). A fence is a
// wrapper, not content, and narration is not the answer. An answer that holds exactly one fenced block
// (three backticks at the start of a line, optionally the tag json in any case, closed by three
// backticks alone on a line) is unwrapped and the inside parsed as strictly as a bare answer; text
// before or after that one block is ignored. There is exactly one candidate or none: a second block,
// any other line that starts with a fence (an indented one included), an unclosed fence, a tilde
// fence or another language tag leave it unmatched, and the answer is then parsed as it stands and
// refused. Narration around a bare answer is refused too: nothing is searched for.
const FENCE_LINE = /^[ \t]*```/, FENCE_OPEN = /^```(?:json)?[ \t]*$/i, FENCE_CLOSE = /^```[ \t]*$/;
// The inside of the one fenced block, or null when the answer does not hold exactly one.
function fencedBlock(answer) {
  const lines = answer.split(/\r?\n/), fences = [];
  for (let k = 0; k < lines.length; k++) if (FENCE_LINE.test(lines[k])) fences.push(k);
  if (fences.length !== 2 || !FENCE_OPEN.test(lines[fences[0]]) || !FENCE_CLOSE.test(lines[fences[1]])) return null;
  return lines.slice(fences[0] + 1, fences[1]).join("\n");
}
// V8 names an offset for some syntax errors and none for others ("Unexpected end of JSON input", or a
// quoted snippet). Anchored at the end so a number inside a quoted snippet is never read as one.
const PARSE_POSITION = / in JSON at position (\d+)(?: \(line \d+ column \d+\))?$/;

// The one strict reading of an answer string: {payload} for a JSON object, else {payload: null,
// problem: "not_json" | "not_object"}. `position` is the parser's error offset in the text it was
// given (the inside of the one fenced block, else the answer), or null when it names none.
export function strictAnswer(answer) {
  if (typeof answer !== "string") return { payload: null, problem: "not_json", position: null };
  const inside = fencedBlock(answer);
  let payload;
  try { payload = JSON.parse(inside ?? answer); } catch (error) {
    const at = PARSE_POSITION.exec(String(error?.message ?? ""));
    return { payload: null, problem: "not_json", position: at ? Number(at[1]) : null };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { payload: null, problem: "not_object" };
  return { payload };
}

// 1.17.1 S2: what a non-JSON answer looked like, for the private attempt record only: its length in
// code points, whether it starts and ends with a fence (backticks or tildes, after trimming), the
// parser's error position if it gave one (the parser's own offset, in UTF-16 code units, into the text
// it was given) and the first 80 code points after the caller's redaction (the dispatcher passes
// sanitizeText). That prefix is the only answer text kept: an answer of 80 characters or fewer is
// kept whole, and nothing past them of a longer one. The parser's message, which quotes the answer,
// is not kept.
export function answerShape(answer, { redact = (value) => value } = {}) {
  const text = typeof answer === "string" ? answer : "", trimmed = text.trim();
  return {
    length: [...text].length,
    starts_with_fence: /^(?:```|~~~)/.test(trimmed),
    ends_with_fence: /(?:```|~~~)$/.test(trimmed),
    parse_error_position: strictAnswer(text).position ?? null,
    prefix: [...String(redact(text))].slice(0, 80).join(""),
  };
}

// The answer string inside the envelopes an extracting route printed: the last object that has one of
// the wrapper fields unwrapReviewPayload descends into (same names, same order), or null when stdout
// held no such envelope and is itself the answer.
const ANSWER_FIELDS = ["response", "result", "message", "content", "structured_output", "text"];
export function envelopeAnswer(objects) {
  for (const candidate of Array.isArray(objects) ? [...objects].reverse() : []) {
    if (!candidate || typeof candidate !== "object") continue;
    for (const field of ANSWER_FIELDS) if (typeof candidate[field] === "string") return candidate[field];
  }
  return null;
}
