// Fixed synthetic entry point: preserve the exact original before/after probe.
delete process.env.MOMM_EVIDENCE_HOME;
if(process.argv.length!==2)throw Error('This synthetic entry point accepts no arguments.');
process.argv.push('--case','grounding');
await import('./bumble-contract-boundary-probes.test.mjs');
