// Deprecated compatibility alias: multi-llm-review was renamed to momm (2026-08-17).
// This forwarder installs the skill under its new name, momm.
process.stderr.write("[deprecated] multi-llm-review is now momm; this installs/links the skill as momm\n");
await import("../../momm/scripts/install.mjs");
