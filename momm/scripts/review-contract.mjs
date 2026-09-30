// Reply validation is structural evidence, not proof that a model reasoned correctly.
// artifact is the exact sanitized post-delimiter text, not the whole prompt.
// Optional-value finding keys must be present with explicit null, per the schema.
// The dispatcher stamps PEER_CONTRACT after validation; it is not peer negotiation.
import { createHash } from "node:crypto";
// /3 (1.17): optional finding claim_type (B2) and attachment observations in reviewed_scope (A3).
export const PEER_CONTRACT = "momm-peer-review/3";
// Typed claims, most blocking first; a merge keeps the earliest type of its sources. The type is
// separate from severity: a CRITICAL or WARNING gates acceptance whatever its type.
export const CLAIM_TYPES = Object.freeze(["DEFECT", "RISK", "QUESTION", "IDEA", "NOISE"]);
const text = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max;
const pixels = (r) => Array.isArray(r) && r.length === 4 && r.every(n => Number.isInteger(n) && n >= 0);
const bound = (n) => Number.isInteger(n) && n > 0;
// An attachment observation cannot be checked against pixels; it is anchored only to the digest of an
// attachment sent in this run and, where the header stated them, to that image's pixel bounds.
function observationProblem(s, sent) {
  if (!sent.size) return "reviewed_scope observation names an attachment, but no attachment was sent in this run";
  if (Object.hasOwn(s, "quote")) return "a reviewed_scope entry is either a quote or an attachment observation, not both";
  const attachment = typeof s.attachment_sha256 === "string" ? sent.get(s.attachment_sha256) : undefined;
  if (!attachment) return "reviewed_scope observation must name the full sha256 of an attachment sent in this run";
  if (!text(s.observation, 500) || !text(s.assessment, 1000)) return "reviewed_scope observation needs an observation (up to 500) and an assessment (up to 1000)";
  if (!Object.hasOwn(s, "region")) return null;
  if (!pixels(s.region)) return "invalid observation region; expected four nonnegative integer pixels";
  if (attachment.modality !== undefined && attachment.modality !== "image") return "an observation region applies to image attachments only";
  const [x, y, w, h] = s.region;
  if (bound(attachment.width) && bound(attachment.height) && (x + w > attachment.width || y + h > attachment.height)) {
    return `observation region lies outside the ${attachment.width}x${attachment.height} image`;
  }
  return null;
}
// Owner decision, 25 September 2026 (range review rev_20260925004814_1ed9f58c2c3a): models retype
// typographic characters when they quote documentation, and those answers were refused. Only these
// look-alikes and runs of whitespace compare equal; every other character still matches literally.
const lookAlike = (value) => value
  .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
  .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
  .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
  .replace(/\u2026/g, "...")
  .replace(/\s+/g, " ")
  .trim();
/**
 * The reviewed_scope quote rule on its own (1.17 B5 reuses it for a second look): 1 to 12 entries,
 * each quoting the supplied artifact exactly (typographic look-alikes and whitespace runs aside) with
 * an assessment, or an observation of an attachment sent in this run; at least one entry quotes text.
 */
export function scopeProblem(scope, artifact, { attachments = [] } = {}) {
  if (typeof artifact !== "string" || !artifact.trim()) return "invalid artifact: exact non-empty source text required";
  if (!Array.isArray(scope) || !scope.length) return "completed review needs reviewed_scope";
  if (scope.length > 12) return "over-limit reviewed_scope; request a concise complete review, never truncate it";
  // CLIs may carry Windows text using LF, and models retype typographic look-alikes
  // (see lookAlike); every other character still matches literally. Input hashes
  // remain over the original sanitized bytes and are never recomputed here.
  const quotedArtifact = artifact.replaceAll('\r\n', '\n');
  let comparableArtifact = null;
  const sent = new Map((Array.isArray(attachments) ? attachments : [])
    .filter(a => typeof a?.sha256 === "string" && /^[a-f0-9]{64}$/.test(a.sha256)).map(a => [a.sha256, a]));
  let quotes = 0;
  for (const s of scope) {
    if (s && typeof s === "object" && Object.hasOwn(s, "attachment_sha256")) {
      const problem = observationProblem(s, sent);
      if (problem) return problem;
      continue;
    }
    quotes += 1;
    if (!text(s?.quote, 500) || !text(s?.assessment, 1000)
      || !(artifact.includes(s.quote) || quotedArtifact.includes(s.quote.replaceAll('\r\n', '\n'))
        || (lookAlike(s.quote) && (comparableArtifact ??= lookAlike(artifact)).includes(lookAlike(s.quote))))) return "reviewed_scope must quote the supplied artifact exactly (typographic look-alikes and whitespace runs aside) and assess it";
  }
  // Observations are unverifiable: while there is text, the review must still quote it.
  if (!quotes) return "reviewed_scope must quote the supplied text artifact at least once; attachment observations alone cannot anchor the review";
  return null;
}
/**
 * Returns null when structurally valid, otherwise an actionable problem string.
 * attachments: the media actually sent in this run, as staged ({ sha256, modality?, width?, height? }).
 */
export function reviewProblem(p, artifact, { attachments = [] } = {}) {
  if (typeof artifact !== "string" || !artifact.trim()) return "invalid artifact: exact non-empty source text required";
  if (!p || p.review_status !== "complete") return "review_incomplete: explicit completed review required";
  if (!["ACCEPT", "MODIFY", "REJECT"].includes(p.verdict)) return "invalid verdict";
  if (typeof p.confidence !== "number" || !Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1) return "invalid confidence";
  if (!text(p.summary, 1000)) return "missing or oversized summary";
  const scoped = scopeProblem(p.reviewed_scope, artifact, { attachments });
  if (scoped) return scoped;
  if (!Array.isArray(p.suggested_improvements) || p.suggested_improvements.length > 20 || !p.suggested_improvements.every(s => text(s, 500))) return "invalid or over-limit suggestions; nothing may be silently dropped";
  if (!Array.isArray(p.findings) || p.findings.length > 50) return "invalid or over-limit findings";
  const ids = new Set();
  for (const f of p.findings) {
    if (!text(f?.id, 80) || f.id !== f.id.trim() || ids.has(f.id) || !["CRITICAL", "WARNING", "NITPICK"].includes(f.severity)
      || !text(f.issue, 2000) || !text(f.rationale, 2000)
      || !(f.target_file === null || text(f.target_file, 500))
      || !(f.test_suggestion === null || text(f.test_suggestion, 1500))
      || !(f.line_range === null || (Array.isArray(f.line_range) && f.line_range.length === 2 && f.line_range.every(n => Number.isInteger(n) && n >= 1) && f.line_range[0] <= f.line_range[1]))) return "invalid finding; nothing may be silently dropped";
    if (Object.hasOwn(f, "region") && !pixels(f.region)) return "invalid image region; expected four nonnegative integer pixels";
    // Additive: an absent or null claim_type is an untyped claim; any other value must be a known type.
    if (f.claim_type !== undefined && f.claim_type !== null && !CLAIM_TYPES.includes(f.claim_type)) return `invalid claim_type; expected one of ${CLAIM_TYPES.join(", ")} or omit it`;
    ids.add(f.id);
  }
  return null;
}

// 1.17 A4.2: for an answer refused by the quotation rule, what each failing quote was, without
// keeping it: its SHA-256, its length in characters, its first 80 characters after the caller's
// redaction (the dispatcher passes sanitizeText), and the comparisons tried, in the order
// reviewProblem tries them. Only quotes that fail are described; the answer itself is never
// returned. For the private attempt record only, never the report.
export function quotationDiagnostics(p, artifact, { redact = (value) => value } = {}) {
  if (typeof artifact !== "string" || !Array.isArray(p?.reviewed_scope)) return [];
  const quotedArtifact = artifact.replaceAll("\r\n", "\n");
  let comparableArtifact = null;
  const rows = [];
  for (const [index, entry] of p.reviewed_scope.slice(0, 12).entries()) {
    // An attachment observation (contract /3) is not a quote; reviewProblem judges it separately.
    if (entry && typeof entry === "object" && Object.hasOwn(entry, "attachment_sha256")) continue;
    const quote = entry?.quote;
    if (typeof quote !== "string" || !quote.trim()) { rows.push({ index, reason: "not_text", sha256: null, length: typeof quote === "string" ? [...quote].length : null, prefix: null, steps_tried: [] }); continue; }
    const steps = ["exact"];
    let found = artifact.includes(quote);
    if (!found) { steps.push("line_endings"); found = quotedArtifact.includes(quote.replaceAll("\r\n", "\n")); }
    if (!found && lookAlike(quote)) { steps.push("look_alikes_and_whitespace"); found = (comparableArtifact ??= lookAlike(artifact)).includes(lookAlike(quote)); }
    if (found && quote.length <= 500) continue;
    rows.push({ index, reason: found ? "oversized" : "not_found", sha256: createHash("sha256").update(quote).digest("hex"), length: [...quote].length,
      prefix: [...String(redact(quote))].slice(0, 80).join(""), steps_tried: steps });
  }
  return rows;
}
