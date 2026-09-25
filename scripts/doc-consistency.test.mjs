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
  // A missing release must be reported, not thrown: reading .changes off undefined raised a
  // TypeError before the assertion below could say what was wrong.
  const release = JSON.parse(read('versions.json')).momm_releases.find(r => r.version === '1.16.0');
  assert(release && Array.isArray(release.changes), 'versions.json must carry a 1.16.0 release with a change list');
  const entry = release.changes.find(c => c.startsWith('--split'));
  assert(entry, 'the 1.16.0 change list must describe --split');
  // The old test accepted any sentence containing "line boundaries", including copy that still sent
  // every oversize hunk to the governor. Both halves of the claim are now required.
  assert(/line boundaries/.test(entry) && /by default/.test(entry), 'the --split entry must state that dividing at line boundaries is the default');
  assert(/only a hunk that cannot be divided/.test(entry), 'the --split entry must state that governor-direct scope is the exception, not the rule');
  assert(!/every oversize hunk|all oversize hunks/i.test(entry), 'the --split entry must not say every oversize hunk becomes governor scope');
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
// The Node policy is stated once, in the gate record. It drifted apart from the ideas register on
// 1.16.1: the register grouped 18 with 20 as CI-only while the charter still required Node 18
// lifecycle drills, which would have let a reviewer read the weaker statement and skip a drill.
{
  const ideas = read('momm/references/ideas-register.md');
  const gates = read('momm/references/gates-1.16.1.md');
  assert(/Node 18 and Node 24 lifecycle drills/.test(gates), 'the gate record must carry the single statement of the Node lifecycle policy');
  if (/Node 18/.test(ideas)) {
    assert(/gates-1.16.1\.md/.test(ideas), 'a second file that discusses Node 18 must point at the single statement of the policy');
    assert(!/stay in CI as compatibility checks and are labelled as such/.test(ideas), 'the ideas register must not restate the Node policy in a form that drops the Node 18 lifecycle obligation');
  }
}
// A withdrawn plan must not still tell an agent to execute it. The 1.9.1 plan carried a banner
// withdrawing it and, in the very next paragraph, the instruction to run the exercises in order.
{
  const plan = read('momm/references/test-plan.md');
  assert(/\*\*Do not run this plan\.\*\*/.test(plan), 'the historical plan must open with a do-not-execute fence');
  assert(!/Hand this whole file to a fresh agent session/.test(plan), 'the withdrawn plan must not instruct an agent to run it');
}
// Owner decision, 24 September 2026: the macOS/Linux reviewer-launch gap ships as an accepted,
// documented risk. It must stay stated where users and reviewers read, until 1.17 closes it.
{
  assert(/Known limitation:\*\* on macOS and Linux, reviewer CLIs/.test(read('momm/references/draft-1.16.1.md')), 'the release notes must state the macOS/Linux reviewer-launch limitation');
  assert(/## Accepted risk \(owner decision, 24 September 2026\)/.test(read('momm/references/gates-1.16.1.md')), 'the gate record must carry the accepted risk');
}
// Delta review rev_20260924234524_89d8189794c3 (Grok findings deep-2x-vs-360-cap, grok-736-valid-vs-timeout,
// five-of-five-unused-prompt): the Grok budget, the lab conditions and the sample behind the default
// must be stated so the numbers cannot be read two ways.
{
  const cap = /Grok receives 2x headroom, capped at 360 seconds unless `--timeout` is explicit/;
  assert(cap.test(read('momm/SKILL.md')), 'SKILL must state the 360 s cap on Grok headroom');
  assert(/Grok: 2x, capped at 360/.test(read('momm/README.md')), 'README must state the 360 s cap on Grok headroom');
  const gates = read('momm/references/gates-1.16.1.md');
  assert(/lab runs had no MOMM deadline/i.test(gates), 'the gate record must say the lab runs had no MOMM deadline');
  assert(/3 of 3 in the shipped setup/.test(gates), 'the gate record must give the shipped setup its own sample');
  assert(!/valid in 5 of 5 measured runs/.test(read('momm/SKILL.md')), 'SKILL must not credit the shipped Grok setup with runs it did not make');
}
// Range review rev_20260925004814_1ed9f58c2c3a (standing-rules-outside-dry-run): the install prompt told the
// agent to write the user's standing instructions without showing them first, while the page promises
// nothing is installed or replaced until the user says yes. Checked in the source and the rendered page.
{
  for (const [file, text] of [['momm/references/upgrade-prompt.md', read('momm/references/upgrade-prompt.md').replace(/\s+/g, ' ')], ['docs/momm/install.html', read('docs/momm/install.html').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')]]) {
    const at = text.indexOf('documented user-level standing instructions');
    assert(at > 0, file + ' carries the standing-instructions step');
    const step = text.slice(Math.max(0, at - 200), at + 900);
    assert(/show me the exact section and where it goes, and wait for my yes/i.test(step), file + ': the standing-instructions step must be shown and approved before it is written');
  }
}
// Range review rev_20260925004814_1ed9f58c2c3a (posix-promoted-and-deferred): the deferred-findings snapshot
// still promoted the POSIX PATH-shadowing finding into 1.16.1 E after the owner deferred it to 1.17.
{
  const row = read('momm/references/deferred-from-1.16.0.md').split('\n').find(l => l.startsWith('| `posix-relative-path-command-shadowing`'));
  assert(row && /deferred to 1\.17/.test(row), 'the POSIX PATH-shadowing row must record the 24 September deferral to 1.17');
}
// Range review rev_20260925004814_1ed9f58c2c3a (offline-ci-green-without-named-run): the gate record called
// Windows 24.19.0 offline CI green while every recorded run predated that pin (13 jobs). A green claim
// for the current matrix needs a recorded run of at least the current matrix's size.
{
  const gates = read('momm/references/gates-1.16.1.md');
  if (/24\.19\.0\)? *\|?/.test(gates) && /offline CI green \([^)]*24\.19\.0/.test(gates)) {
    const counts = [...gates.matchAll(/\| (\d+) of \1 jobs passed/g)].map(m => Number(m[1]));
    assert(counts.some(n => n >= 15), 'a recorded CI run of the current 15-job workflow must back the 24.19.0 green claim');
  }
  assert(!/The results above are:/.test(gates), 'the CI history must not point at the lifecycle table above it');
}
// Range review rev_20260925004814_1ed9f58c2c3a (grok suggestion 52): ROADMAP rule 5 says versions.json decides
// "current"; its opening line must say the same version.
assert(read('momm/ROADMAP.md').includes('Today they say **' + JSON.parse(read('versions.json')).momm + '**'), 'ROADMAP must state the versions.json version');
// Range review rev_20260925131115_6ed35d0bdf89 (grok suggestion 44): every consent step of the install prompt stays
// in the source and in both rendered pages, not only the standing-instructions one.
for (const [file, text] of [['momm/references/upgrade-prompt.md', read('momm/references/upgrade-prompt.md')], ['docs/momm/install.html', read('docs/momm/install.html')], ['docs/momm/releases/upgrade.html', read('docs/momm/releases/upgrade.html')]]) {
  const flat = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const phrase of ['Stop if verification is unavailable', 'ask before installing a missing verifier', 'Ask me before applying']) assert(flat.includes(phrase), file + ' must keep: ' + phrase);
}
console.log(JSON.stringify({passed:true,checks:'supervised-vs-detached process limitations, verification checklist and separate default-off update controls'}));
