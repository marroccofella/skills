// Fixed synthetic entry point; the original governor probe remains unchanged.
delete process.env.MOMM_EVIDENCE_HOME;
if(process.argv.length!==2)throw Error('This synthetic entry point accepts no arguments.');
process.argv.push('--case','task');
await import('./bumble-raw-identity-probes.test.mjs');
