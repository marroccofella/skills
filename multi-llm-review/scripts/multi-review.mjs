#!/usr/bin/env node
// Deprecated compatibility alias: multi-llm-review was renamed to momm (2026-08-17).
// This forwarder will be removed in a future release; invoke momm/scripts/multi-review.mjs directly.
const notice = "multi-llm-review is now momm; update your command to momm/scripts/multi-review.mjs";
// With --stream, stderr is a documented NDJSON-only channel; the notice must stay machine-parseable.
process.stderr.write(
  process.argv.includes("--stream")
    ? `${JSON.stringify({ ts: new Date().toISOString(), event: "deprecated", message: notice })}\n`
    : `[deprecated] ${notice}\n`,
);
await import("../../momm/scripts/multi-review.mjs");
