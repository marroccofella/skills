// Canonical entry point: synthetic private bytes only, no login or inference.
delete process.env.MOMM_EVIDENCE_HOME;
await import('../development-tests/bumble-oauth-handoff.test.mjs');
