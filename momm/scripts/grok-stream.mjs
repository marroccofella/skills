// MOMM 1.17 A4.3 — Grok review output read as a stream. Zero dependencies.
//
// `grok --output-format json` prints nothing until the turn ends, so a review that ran out of time left
// stdout_bytes 0 and first_output_ms null and no way to tell a slow model from a stalled one (Grok on
// dense pieces, 29 September 2026). `--output-format streaming-json` prints one JSON object per line as
// the turn proceeds; runProcess counts those bytes as they arrive. This module turns the finished stream
// back into the {text, stopReason} envelope json mode printed, so the review is validated exactly as
// before, and summarises a partial stream for the record. Stream text is never echoed: only counts and
// a checked event name leave this module.
//
// Verified shape (captured 29 September 2026, Grok CLI 1.0.41; fixtures/grok-streaming-json-1.0.41.jsonl):
// every line is a bare object with a string `type`. `text` lines carry the answer in `data`, in order;
// `thought`, `available_commands` and `usage` carry no answer; one final
// {"type":"end","stopReason":"end_turn",...,"usage":{...}} ends the turn. Only end_turn is a finished
// answer. The help text's "one ACP session update per line" did not match this output, so the ACP and
// JSON-RPC shapes are not accepted: a line without a `type` is malformed. A type this MOMM does not know is
// counted and otherwise ignored (it carries no answer text); `error`, or any line marked as an error, ends
// the run as an error.
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_./-]{0,47}$/;
const STOP_NAME = /^[a-z_]{1,32}$/;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isEvent = (value) => isObject(value) && typeof value.type === "string";

function parseLines(stdout) {
  return String(stdout ?? "").split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    try { const value = JSON.parse(line); return isEvent(value) ? value : undefined; } catch { return undefined; }
  });
}
const eventName = (event) => (EVENT_NAME.test(event.type) ? event.type : "unrecognized");
const isError = (event) => event.type === "error" || event.is_error === true || (event.error !== undefined && event.error !== null && event.error !== false);

// Progress for the record, from whatever arrived; a torn last line (a timeout mid-write) is not counted.
export function grokStreamProgress(stdout) {
  const events = parseLines(stdout).filter(Boolean);
  return { stream_events: events.length, last_event_type: events.length ? eventName(events.at(-1)) : null };
}

// The finished stream. Returns {envelope} for unwrapReviewPayload, or {status:"error", detail}, or
// {envelope:null, problem} for invalid_output (problem is null when stdout was empty).
export function grokStreamReview(stdout) {
  const events = parseLines(stdout);
  if (!events.length) return { envelope: null, problem: null };
  if (events.some((event) => event === undefined)) return { envelope: null, problem: "malformed streaming-json: a line is not a JSON object with a type" };
  let text = "", end = null;
  for (const event of events) {
    if (isError(event)) return { envelope: null, status: "error", detail: "Grok returned an error in its event stream; the stream is not echoed and no earlier text was accepted. A new completed dispatch is required." };
    if (end) return { envelope: null, problem: "streaming-json continued after the end event" };
    if (event.type === "end") { end = event; continue; }
    if (event.type === "text" && typeof event.data === "string") text += event.data;
  }
  if (!end) return { envelope: null, problem: "streaming-json ended without a final end event" };
  if (end.stopReason !== "end_turn") {
    const reason = typeof end.stopReason === "string" && STOP_NAME.test(end.stopReason) ? end.stopReason : "missing or unrecognized";
    return { envelope: null, problem: `the turn ended with stopReason ${reason}, not end_turn` };
  }
  return { envelope: JSON.stringify({ text, stopReason: end.stopReason }) };
}
