// Canonical entry point for the owned-baseline synthetic source/seal tests.
delete process.env.MOMM_EVIDENCE_HOME;
await import('../development-tests/bumble-baseline.test.mjs');
