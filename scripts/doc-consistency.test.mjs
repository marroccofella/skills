import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../momm/scripts/update-clock.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
assert(!read('README.md').includes('POSIX process-group coverage remains open work'),'README contradicts implemented supervised process groups');
assert(!read('momm/references/release-1.15.0.md').includes('POSIX descendant cleanup and unsupported'),'release notes must distinguish detached processes from supervised descendants');
// Superseded by the complete rule below. This named six suites while sixty-five others drifted out of
// CONTRIBUTING unnoticed (1.16.0 gate, new-tests-absent-from-verification-list). Each of the six is run
// by .github/workflows/self-test.yml and described in the catalogue, both of which are now asserted.
for(const file of ['momm/scripts/process-scope.test.mjs','momm/scripts/entrypoint.test.mjs','momm/scripts/setup-maintenance.test.mjs','scripts/momm-release-pages.test.mjs','scripts/public-export.test.mjs','scripts/doc-consistency.test.mjs']){
  assert(read('.github/workflows/self-test.yml').includes('node '+file),'CI must run '+file);
  assert(read('momm/references/test-catalog-1.16.1.md').includes('`'+file+'`'),'the catalogue must describe '+file);
}
assert.equal(DEFAULT_SETTINGS.auto_update.enabled,false,'Automatic updates must remain off by default');
assert.equal(DEFAULT_SETTINGS.auto_update.accept_protocol,false,'Automatic protocol acceptance is separately off by default');
assert(read('momm/SKILL.md').includes('Automatic updates (1.16): off by default.'));
assert(read('momm/references/updating.md').includes('off-by-default automation setting'));
assert(read('momm/references/updating.md').includes('independent setting, also off by default'));
// 1.16.1 D, from the 1.16.0 gate finding new-tests-absent-from-verification-list: a contributor who
// follows CONTRIBUTING must be able to reach EVERY suite. A hand-written list of seventy names is
// what went stale, so CONTRIBUTING names the two authoritative sources instead, and every suite it
// does name must exist. The catalogue's own completeness is enforced by review-workflow.test.mjs.
{
  const contributing = read('CONTRIBUTING.md');
  for (const source of ['.github/workflows/self-test.yml', 'momm/references/test-catalog-1.16.1.md'])
    assert(contributing.includes(source), `CONTRIBUTING must name the authoritative verification source ${source}`);
  // Runnable paths only: a bare file name in a descriptive table is not an instruction to run it.
  const named = [...contributing.matchAll(/(?:momm\/scripts|scripts)\/[\w.-]+\.test\.mjs/g)].map(m => m[0]);
  for (const suite of new Set(named))
    assert(fs.existsSync(path.join(root, suite)), `CONTRIBUTING names a suite that does not exist: ${suite}`);
  const workflow = read('.github/workflows/self-test.yml');
  const ran = new Set([...workflow.matchAll(/node ([\w./-]+\.test\.mjs)/g)].map(m => m[1]));
  for (const suite of new Set(named))
    assert(ran.has(suite), `CONTRIBUTING tells a contributor to run ${suite}, which CI does not run: keep the two in step`);
}
// The public change list is what a user reads on the site. --split divides an oversize hunk at line
// boundaries by default; only a hunk that cannot be divided becomes governor scope (1.16.0 gate
// finding changelog-omits-major-1-16-surfaces).
{
  const entry = JSON.parse(read('versions.json')).momm_releases.find(r => r.version === '1.16.0').changes.find(c => c.startsWith('--split'));
  assert(entry, 'the 1.16.0 change list must describe --split');
  assert(/cannot be divided|undividable|line boundaries/.test(entry), 'the --split entry must not imply every oversize hunk goes to the governor: line splitting is the default');
}
// A file cannot name its own commit: writing the SHA changes it, so the value is stale as soon as it
// is committed. That was got wrong three times on 1.16.1, each time caught by a reviewer. The gate
// record therefore carries CI history only, and points at the PR for the candidate under test.
{
  const gates = read('momm/references/gates-1.16.1.md');
  const claiming = gates.split(String.fromCharCode(10)).filter(l => /^\|/.test(l) && /\(current\)/i.test(l));
  assert.deepEqual(claiming, [], 'the gate record must not mark a table row as the current candidate: name the PR, not a SHA');
  assert(/pull\/18/.test(gates), 'the gate record must point at the PR whose head is the candidate');
}
console.log(JSON.stringify({passed:true,checks:'supervised-vs-detached process limitations, verification checklist and separate default-off update controls'}));
