// Canonical entry for the generated-signature protected-plan broker controls.
// No model call, real credential or backend release is exercised by this suite.
delete process.env.MOMM_EVIDENCE_HOME;
await import('../development-tests/bumble-shadow-broker-controls.mjs');
