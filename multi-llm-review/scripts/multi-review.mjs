// Deprecated compatibility alias: multi-llm-review was renamed to momm (2026-08-17).
// This forwarder will be removed in a future release; invoke momm/scripts/multi-review.mjs directly.
process.stderr.write("[deprecated] multi-llm-review is now momm; update your command to momm/scripts/multi-review.mjs\n");
await import("../../momm/scripts/multi-review.mjs");
