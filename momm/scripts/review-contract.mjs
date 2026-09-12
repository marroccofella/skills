// Reply validation is structural evidence, not proof that a model reasoned correctly.
// artifact is the exact sanitized post-delimiter text, not the whole prompt.
// Optional-value finding keys must be present with explicit null, per the schema.
// The dispatcher stamps PEER_CONTRACT after validation; it is not peer negotiation.
export const PEER_CONTRACT = "momm-peer-review/2";
const text = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max;
/** Returns null when structurally valid, otherwise an actionable problem string. */
export function reviewProblem(p, artifact) {
  if (typeof artifact !== "string" || !artifact.trim()) return "invalid artifact: exact non-empty source text required";
  if (!p || p.review_status !== "complete") return "review_incomplete: explicit completed review required";
  if (!["ACCEPT", "MODIFY", "REJECT"].includes(p.verdict)) return "invalid verdict";
  if (typeof p.confidence !== "number" || !Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1) return "invalid confidence";
  if (!text(p.summary, 1000)) return "missing or oversized summary";
  if (!Array.isArray(p.reviewed_scope) || !p.reviewed_scope.length) return "completed review needs reviewed_scope";
  if (p.reviewed_scope.length > 12) return "over-limit reviewed_scope; request a concise complete review, never truncate it";
  // CLIs may carry Windows text using LF. Only CRLF/LF equivalence is allowed;
  // spaces, code, and every other character still match literally. Input hashes
  // remain over the original sanitized bytes and are never recomputed here.
  const quotedArtifact = artifact.replaceAll('\r\n', '\n');
  for (const s of p.reviewed_scope) {
    if (!text(s?.quote, 500) || !text(s?.assessment, 1000) || !quotedArtifact.includes(s.quote.replaceAll('\r\n', '\n'))) return "reviewed_scope must quote the supplied artifact exactly (CRLF/LF equivalent) and assess it";
  }
  if (!Array.isArray(p.suggested_improvements) || p.suggested_improvements.length > 20 || !p.suggested_improvements.every(s => text(s, 500))) return "invalid or over-limit suggestions; nothing may be silently dropped";
  if (!Array.isArray(p.findings) || p.findings.length > 50) return "invalid or over-limit findings";
  const ids = new Set();
  for (const f of p.findings) {
    if (!text(f?.id, 80) || f.id !== f.id.trim() || ids.has(f.id) || !["CRITICAL", "WARNING", "NITPICK"].includes(f.severity)
      || !text(f.issue, 2000) || !text(f.rationale, 2000)
      || !(f.target_file === null || text(f.target_file, 500))
      || !(f.test_suggestion === null || text(f.test_suggestion, 1500))
      || !(f.line_range === null || (Array.isArray(f.line_range) && f.line_range.length === 2 && f.line_range.every(n => Number.isInteger(n) && n >= 1) && f.line_range[0] <= f.line_range[1]))) return "invalid finding; nothing may be silently dropped";
    ids.add(f.id);
  }
  return null;
}
