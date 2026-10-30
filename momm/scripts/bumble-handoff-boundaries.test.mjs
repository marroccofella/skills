// Canonical entry point for revocation, grammar and connector-mutation controls.
delete process.env.MOMM_EVIDENCE_HOME;
await import('../development-tests/bumble-handoff-boundaries.test.mjs');
