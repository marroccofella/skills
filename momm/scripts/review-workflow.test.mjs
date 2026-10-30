// Offline CI/documentation contract. Does not claim the matrix has actually run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
for(const [canonical,probe]of [['dispatcher-review-regressions.test.mjs','dispatcher-review-repro-20261027.test.mjs'],['bumble-oauth-http-review-regressions.test.mjs','oauth-http-review-repro-20261027.test.mjs'],['bumble-oauth-worker-review-regressions.test.mjs','oauth-worker-review-repro-20261027.test.mjs']])assert.deepEqual(fs.readFileSync(path.join(root,'momm/scripts',canonical)),fs.readFileSync(path.join(root,'momm/development-tests',probe)),'27October canonical review regression differs from actual governor probe: '+canonical);
// Canonical mirrors must never drift from exact before/after probe bytes.
for(const name of ['bumble-contract-boundary-probes.test.mjs','bumble-stage-attestation-before.test.mjs','bumble-raw-identity-probes.test.mjs','bumble-stage-revalidation.test.mjs','bumble-stage-review-probes.test.mjs','bumble-immutable-boundary-probes.test.mjs','bumble-publication-followup.test.mjs'])assert.deepEqual(fs.readFileSync(path.join(root,'momm/scripts',name)),fs.readFileSync(path.join(root,'momm/development-tests',name)),'canonical boundary probe mirror differs: '+name);
const workflow=fs.readFileSync(path.join(root,'.github/workflows/self-test.yml'),'utf8').replace(/\r\n/g,'\n');
assert.match(workflow,/self-test:\s+(?:#[^\n]*\n\s*)*timeout-minutes: 100/,'the complete offline job has an explicit measured 100-minute ceiling, not the360-minute default');
// Measured completed 167-command Windows pack: 70m44s. These are recorded
// offline timing floors, not a claim that a hosted runner has passed.
const packObservedMs=4_243_796;
const requiredJobMs=Math.ceil(packObservedMs*1.25+300_000);
const jobMinutes=Number(workflow.match(/self-test:\s+(?:#[^\n]*\n\s*)*timeout-minutes: (\d+)/)?.[1]);
assert(jobMinutes*60_000>=requiredJobMs,'The complete offline job budget must fit the measured pack plus 25% and five minutes.');
assert(jobMinutes<=100,'The offline job retains an explicit 100-minute ceiling.');
const releaseWorkflow=fs.readFileSync(path.join(root,'.github/workflows/momm-release.yml'),'utf8');
const releaseMinutes=Number(releaseWorkflow.match(/^ {4}timeout-minutes: (\d+)/m)?.[1]);
assert(releaseMinutes*60_000>=requiredJobMs,'The release job must fit the complete sequential pack before signing/publishing.');
assert(releaseMinutes<=120,'The release job retains an explicit two-hour ceiling.');
for(const [name,observedMs] of [
  ['guided image generation rounds, fake runner only (1.17 E)',225_088],
  ['Bumbler terminal preconditions and unsent write-fault recovery (offline)',307_050],
  ['Bumbler immutable original-result adoption and conflict refusal (offline)',228_560],
]){
  const step=workflow.split('      - name: ').find(s=>s.startsWith(name+'\n'));
  assert(step,'Missing measured offline timing gate: '+name);
  const minutes=Number(step.match(/^ {8}timeout-minutes: (\d+)/m)?.[1]);
  assert(minutes*60_000>=observedMs*1.25+30_000,'Step budget must fit the measured offline suite plus 25% and30seconds: '+name);
  assert(minutes<=10,'Measured offline step remains bounded to ten minutes: '+name);
}
for(const name of ['Media byte validation','Installation completion boundary','Capability expiry refusal','Attempt accounting and tool-produced checks','Fail-closed Windows PATH identity']) {
  const step=workflow.split('      - name: ').find(s=>s.startsWith(name+'\n'));
  assert(step,`missing step ${name}`);assert.match(step,/^\s*timeout-minutes: 2[ \t]*$/m,`missing short per-step limit: ${name}`);
}
// The signed release must not be a weaker gate than a pull request. Eleven suites, including every
// one that verifies 1.16.1's own behaviour, ran on PRs but not in the release job (committed-range
// self-review rev_20260922084714, release-list-omits-patch-gates).
{
  const names=f=>[...new Set([...fs.readFileSync(path.join(root,f),'utf8').matchAll(/node ([\w./-]+\.test\.mjs)/g)].map(m=>m[1]))];
  const missing=names('.github/workflows/self-test.yml').filter(n=>!names('.github/workflows/momm-release.yml').includes(n));
  assert.deepEqual(missing,[],'the signed release workflow must run every suite the safety matrix runs');
}
const catalog=fs.readFileSync(path.join(root,'momm/references/test-catalog-1.16.1.md'),'utf8');
const gates=fs.readFileSync(path.join(root,'momm/references/gates-1.16.1.md'),'utf8');
assert.match(gates,/Node 18 and Node 24 lifecycle drills remain required/,'primary targets must not silently remove the charter\'s legacy lifecycle drill');
for(const directory of ['momm/scripts','scripts']) for(const name of fs.readdirSync(path.join(root,directory))) {
  if(name.endsWith('.test.mjs'))assert(catalog.includes('`'+directory+'/'+name+'`'),`missing catalog entry: ${directory}/${name}`);
}
// The suite list stays in sorted order, so a new entry has one place to go (gate-3 triage of
// rev_20260930003709_e5847282134d: invariants and roles had been appended out of order).
{
  const list=catalog.replace(/\r\n/g,'\n').slice(catalog.replace(/\r\n/g,'\n').indexOf('- `momm/scripts/adapter-cleanup.test.mjs`')).split('\n\n')[0].split('\n').filter(l=>l.startsWith('- `'));
  assert(list.length>40,'catalog suite list not found');
  assert.deepEqual(list,[...list].sort(),'the catalog suite list must be sorted');
}
console.log('PASS: short new CI step limits, bounded whole job, and every repository/MOMM suite is catalogued');
