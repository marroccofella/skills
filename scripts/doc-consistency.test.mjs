import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../momm/scripts/update-clock.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives
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
  assert(/Known limitation:\*\* on macOS and Linux, reviewer CLIs/.test(read('momm/references/release-1.16.1.md')), 'the release notes must state the macOS/Linux reviewer-launch limitation');
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
// 1.17 gate 3, review rev_20260930003709_e5847282134d (docs packet). Each statement is checked against the
// code it describes where that is cheap, so the doc cannot drift from it.
{
  const flatText = (t) => t.replace(/\s+/g, ' ');
  const skillFlat = flatText(read('momm/SKILL.md'));
  const draft = read('momm/references/release-1.17-draft-notes.md');
  // protect-flag-and-mark: the evidence commands follow --evidence-home only when it is passed again
  // (takeEvidenceHomeOption applies it per process), and protectEvidence recognises an evidence-home
  // folder by its hash name and project.json marker.
  const evidenceText = flatText(read('momm/SKILL.md').split('## Private evidence folder')[1].split('\n## ')[0]);
  assert(/same `--evidence-home <dir>`/.test(evidenceText), 'SKILL must tell the owner to repeat --evidence-home on evidence --status/--protect');
  assert(evidenceText.includes('`project.json`') && !evidenceText.includes('its marked folder under `MOMM_EVIDENCE_HOME`'), 'SKILL must name the evidence-home folder --protect accepts');
  // blind-judge-fixed-three: blind() labels one file per picture; validateCritique wants evidence for every
  // result except cant_tell.
  const blindStep = skillFlat.slice(skillFlat.indexOf('4. Judge blind'), skillFlat.indexOf('5. Further rounds'));
  assert(/one per picture/.test(blindStep) && !blindStep.includes('A, B, C files') && !blindStep.includes('each of the first three'), 'SKILL step 4 must not fix blind judging at three files');
  assert(blindStep.includes('`met`, `partly` or `missed` (`cant_tell` needs none)'), 'SKILL step 4 must say which results need evidence');
  assert(!draft.includes('labelled A, B, C'), 'the draft notes must not fix blind labels at three');
  // suggestion-index-undefined: selectionOf takes k from 1 to suggested_rounds.length.
  assert(/`--suggestion <k>`, where k counts the previous round's `suggested_rounds` from 1/.test(skillFlat), 'SKILL must say --suggestion counts from 1');
  // claim-type-order-undefined: CLAIM_TYPE_RANK in multi-review.mjs, most blocking first, null lowest.
  assert(/most blocking first: `DEFECT`, `RISK`, `QUESTION`, `IDEA`, `NOISE`; null when untyped, which ranks below `NOISE`/.test(skillFlat), 'SKILL must publish the claim-type order');
  // draft-notes-contradict-header: the superseded long form must not say 1.17 is unreleased.
  assert(!/Not a release note until|Nothing here is released until/.test(draft), 'the superseded draft notes must not contradict their header');
  // release-claim-signal-vs-docs (doc side): releaseClaim treats any kill(pid, 0) error but ESRCH as running.
  assert(/not running \(a process that exists but cannot be signalled counts as running\)/.test(flatText(draft)), 'the draft notes must state the unsignalable-process rule as updating.md does');
  // unpinned-drill-branch: the drill tool is pinned by commit, verified and reported.
  const plan = read('momm/references/third-party-test-plan-1.17.md');
  assert(!plan.includes('--branch drills/momm-1.17') && plan.includes('git checkout --detach <DRILL_SHA>') && /Drill commit: <DRILL_SHA/.test(plan), 'the reviewer pack must pin, verify and report the drill commit');
  // mutation-item-is-not-a-path: checks.mjs wants a 64-hex --item and one --artifact per reverted file.
  const checksText = flatText(read('momm/references/verification-checks.md'));
  assert(/`--item` names the decision \(its validator `item_id`\)/.test(checksText) && /repeat `--artifact` for each such file/.test(checksText), 'verification-checks must separate --item from the reverted --artifact files');
  // grok-typeless-line-unspecified: grokStreamReview refuses the whole answer on a typeless line.
  const grokText = flatText(read('momm/references/cli/grok.md'));
  assert(/a line that is not a JSON object with a string `type` makes the whole answer `invalid_output` \(it is never skipped\)/.test(grokText), 'grok.md must say what a typeless line does');
  // Final review of 1.17.0 (rev_20260930034635_c08cfb6df42f): the rules are an ordered list, so "first decisive one
  // wins" is not read as covering unknown types, and an error line after the end is an error, as the code decides.
  const grokRaw = read('momm/references/cli/grok.md').replace(/\r\n/g, '\n');
  assert(['1. Anywhere in the stream, a line', '2. Otherwise the lines are read in order', '3. A line of an unknown type decides nothing', '4. After the last line'].every((item) => grokRaw.includes(`\n${item}`)), 'grok.md must give the stream rules as an ordered list');
  assert(/an `error` line, or a line marked as an error, makes the run an `error`, even after the `end`; any other line after the `end` \(a second `end` included\) makes it `invalid_output`/.test(grokText), 'grok.md must say what a line after the end does');
  assert(/a missing `end`, or an `end` whose `stopReason` is not `end_turn`, is `invalid_output`/.test(grokText), 'grok.md must say what a missing end or another stopReason does');
  const { grokStreamReview } = await import('../momm/scripts/grok-stream.mjs');
  const end = JSON.stringify({ type: 'end', stopReason: 'end_turn' });
  assert(grokStreamReview(`{"data":"x"}\n${end}\n`).envelope === null && grokStreamReview(`${end}\n${end}\n`).envelope === null && grokStreamReview('{"type":"end","stopReason":"max_turns"}\n').envelope === null, 'grok-stream.mjs must refuse what grok.md says it refuses');
  assert(grokStreamReview(`${end}\n{"type":"error"}\n`).status === 'error' && grokStreamReview(`{"type":"mystery"}\n${end}\n`).envelope !== null && grokStreamReview(`${end}\n{"type":"mystery"}\n`).envelope === null, 'grok-stream.mjs must decide a line after the end as grok.md says');
}
// 1.17.1 gate review rev_20261004085941_a8b4e58041e1 (records packet). The plan, the gate record and the
// release notes are held to each other and, where that is cheap, to the code they describe.
{
  const flatText = (t) => t.replace(/\s+/g, ' ');
  const lf = (name) => read(name).replace(/\r\n/g, '\n');
  const plan = lf('momm/references/plan-1.17.1.md'), gates = lf('momm/references/gates-1.17.1.md'), notes = lf('momm/references/release-1.17.1.md');
  const item = (id) => flatText(plan.split('\n- **' + id + '. ')[1].split('\n- **')[0].split('\n## ')[0]);
  const part = (text, heading) => text.split('\n## ' + heading + '\n')[1].split('\n## ')[0];
  // runner-outcome-contract: plan R5 quoted "93 of 93 passed; report not saved; exit 1", which the runner
  // never prints. It names the runner's three closing lines, as the reviewer pack does.
  const runner = read('scripts/run-ci-suites.mjs');
  assert(!plan.includes('93 of 93 passed; report not saved; exit 1'), 'plan R5 must not quote an outcome line the runner does not print');
  for (const [said, printed] of [['suites passed on', 'suites passed on '], ['`Report saved: no', 'Report saved: '], ['`Exit status: 1`', 'Exit status: '], ['`Report saved: not requested', 'not requested (']])
    assert(item('R5').includes(said) && runner.includes(printed), 'plan R5 and run-ci-suites.mjs must name the same outcome line: ' + said);
  assert(flatText(read('momm/references/third-party-test-plan-1.17.md')).includes('`Report saved: …` (`not requested` unless you add `--save-report`) and `Exit status: N`'), 'the reviewer pack must name the same closing lines, and what the second says without --save-report');
  // unwrap-rule-scope: S1 said "for every route"; the fence rule is used by the two strict routes only, as
  // the test catalogue and review-answer.mjs say.
  assert(!/for every route/i.test(item('S1')) && /Copilot and Antigravity/.test(item('S1')) && /Claude, Codex, Gemini and Grok extract/.test(item('S1')), 'plan S1 must give the fence rule to Copilot and Antigravity and leave the extracting routes unchanged');
  assert(/Copilot and Antigravity read one answer string by the rule in `momm\/scripts\/review-answer\.mjs`; Claude, Codex, Gemini and Grok extract/.test(flatText(read('momm/references/test-catalog-1.16.1.md'))), 'the test catalogue must state the same scope as plan S1');
  // evidence-dropped-pass-confirmation: the evidence for the Copilot fix says the suite passes with the
  // fence change, with its count.
  assert(/\*\*Evidence\.\*\*.*?the suite had \d+ checks, all passing/.test(flatText(gates.split('- **Lesson.**')[0])), 'the gate record must say that the Copilot suite passes with the fence change, with its count');
  // owner-approval-gate-dropped: the list of what is still required says where the owner's approval is
  // and what it depends on.
  const still = flatText(part(gates, 'Still required before the tag'));
  assert(/owner's approval for the signed tag/.test(still) && still.includes('4 October 2026') && /every gate passes on the final sealed commit/.test(still), 'the gate record must state the owner approval for the tag and its condition');
  // gate3-receipts-partial: gate 3 covers every change. While it is open the record says so; it cannot
  // read as recorded while only the two reviews of the Copilot fix are listed.
  const gate3 = gates.split('\n').find((line) => line.startsWith('| 3. MOMM range reviews')) ?? '';
  const listed = part(gates, 'Reviews').split('\n').filter((line) => /^- `rev_\d{14}_[0-9a-f]{12}`/.test(line)).length;
  assert(/Gate 3 is met only when every range review of the 1\.17\.1 changes is listed here with a complete receipt/.test(flatText(part(gates, 'Reviews'))), 'the Reviews section must say what meets gate 3');
  if (/when complete/.test(gate3)) assert(/Gate 3/.test(still), 'while gate 3 is open, the list of what is still required must name it');
  else assert(listed > 2, 'gate 3 cannot read as recorded while only the two reviews of the Copilot fix are listed');
  // answer-prefix-vs-never: the notes said a prefix of a refused answer is kept and then "Never the
  // answer". The records say what answerShape keeps, whatever that is.
  const { answerShape, strictAnswer } = await import('../momm/scripts/review-answer.mjs');
  const kept = answerShape('x'.repeat(200)).prefix;
  for (const [name, text] of [['plan-1.17.1.md', plan], ['gates-1.17.1.md', gates], ['release-1.17.1.md', notes]]) {
    if (typeof kept === 'string' && kept.length) {
      assert(!/never\s+the\s+answer/i.test(text), name + ' must not say the answer is never kept while the shape record keeps a prefix of it');
      assert(flatText(text).includes(`first ${kept.length} characters`), name + ' must say how much of a refused answer the shape record keeps');
    } else assert(!/first \d+ characters|character prefix/.test(flatText(text)), name + ' must not say a prefix is kept when answerShape keeps none');
  }
  // tilde-fence-dropped, and one list everywhere: what is still refused, in the gate record, the release
  // notes and both adapter notes, and true of the rule itself.
  const refusedList = 'a second fenced block, any other line that starts with a fence, an unclosed fence, a tilde fence, another language tag, narration around a bare answer or broken json inside';
  for (const name of ['momm/references/gates-1.17.1.md', 'momm/references/release-1.17.1.md', 'momm/references/cli/copilot.md', 'momm/references/cli/antigravity.md'])
    assert(flatText(read(name)).toLowerCase().includes(refusedList), name + ' must give the whole list of fenced answers that are still refused');
  const fence = '`'.repeat(3), tilde = '~'.repeat(3), answer = '{"findings":[]}';
  assert.deepEqual(strictAnswer(`${fence}json\n${answer}\n${fence}`).payload, { findings: [] }, 'one fenced block is unwrapped');
  for (const narrated of [`Here it is:\n${fence}json\n${answer}\n${fence}`, `${fence}json\n${answer}\n${fence}\nThat is all.`])
    assert.deepEqual(strictAnswer(narrated).payload, { findings: [] }, 'text around the one fenced block is ignored, as the records say');
  for (const refusedAnswer of [`${fence}json\n${answer}\n${fence}\n${fence}json\n${answer}\n${fence}`, `${fence}\n${fence}\n${answer}\n${fence}`, `Here it is:\n${fence}json\n${answer}`,
    `${tilde}json\n${answer}\n${tilde}`, `${fence}js\n${answer}\n${fence}`, `Here it is:\n${answer}`, `${fence}json\n{"findings":[\n${fence}`])
    assert.equal(strictAnswer(refusedAnswer).payload, null, 'review-answer.mjs must refuse what the records say is still refused');
  // every-reviewer-lede: the release repairs Copilot and flags a CLI that is too old; it does not make
  // every route work, and the records do not say so.
  for (const name of ['momm/references/release-1.17.1.md', 'momm/references/plan-1.17.1.md', 'momm/ROADMAP.md'])
    assert(!/every reviewer usable/i.test(read(name)), name + ' must not claim that every reviewer is usable');
}
// 1.17.1 closing review rev_20261004111650_5ab46e76a382 (records packet).
{
  const flatText = (t) => t.replace(/\s+/g, ' ');
  const lf = (name) => read(name).replace(/\r\n/g, '\n');
  const gates = lf('momm/references/gates-1.17.1.md'), plan = lf('momm/references/plan-1.17.1.md');
  // gate5-false-all-routes-valid: gate 5 said each route returned valid reviews in all three range
  // reviews, above an entry that recorded Copilot refused on both attempts on one piece. An entry that
  // records a route with no valid review of a piece does not call all four routes valid, and while one
  // does the gate 5 status says that validity was not on every piece (or that the gate is open).
  const reviews = gates.split('\n## Reviews\n')[1].split('\n## ')[0];
  const entries = reviews.split(/\n(?=- `rev_)/).filter((block) => block.startsWith('- `rev_')).map((block) => flatText(block.split('\n\n')[0]));
  const missed = entries.filter((text) => /both attempts|timed out/.test(text));
  for (const text of missed) assert(!/All four routes valid/.test(text), 'a review entry must not call all four routes valid while it records a route that gave no valid review of a piece: ' + text.slice(0, 36));
  const gate5 = (gates.split('\n').find((line) => line.startsWith('| 5. ')) ?? '').split('|').slice(-2)[0].trim();
  if (missed.length) assert(/^open\b/.test(gate5) || /not (?:of|on|for) (?:every|each) piece|no valid review/.test(gate5), 'gate 5 must say that a route gave no valid review of some piece while the Reviews section records one');
  // lock-repeat-does-not-name-rest: updating.md said that repeating the command names the locks the
  // message does not show. The updater decides: ten locks in a throwaway clone, asked twice.
  const os = (await import('node:os')).default, updater = await import('../momm/scripts/update.mjs');
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-doc-locks-'));
  try {
    updater.git(clone, 'init', '--quiet');
    const names = Array.from({ length: 10 }, (_, i) => `doc-${i}.lock`);
    for (const name of names) fs.writeFileSync(path.join(clone, '.git', 'refs', 'heads', name), '');
    const named = () => { try { updater.refuseGitLocks(clone, 'Then repeat the command.'); } catch (error) { return names.filter((name) => String(error.message).includes(name)); } return assert.fail('ten Git locks must stop the update'); };
    const first = named(), again = named();
    const paragraph = flatText(lf('momm/references/updating.md').split('\n\n').find((block) => /Git lock file/.test(block)) ?? '');
    assert.equal(/names at most eight locks/.test(paragraph), first.length === 8, 'updating.md and refuseGitLocks must agree on how many locks the message names');
    if (first.length < names.length && !again.some((name) => !first.includes(name))) {
      const unconditional = paragraph.split(/(?<=[.:]) /).find((sentence) => /repeat/i.test(sentence) && /names (?:them|the rest|the others)/.test(sentence) && !/same|only|once|after/.test(sentence));
      assert(!unconditional, 'updating.md must not say that repeating the command names the hidden locks: the same locks give the same names');
      assert(/names the same/.test(paragraph), 'updating.md must say what repeating the command does while the same locks exist');
    }
  } finally { fs.rmSync(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  // r10-acceptance-criteria-gap: R10 came to promise three things while its "Done when" still covered the
  // first. The "Done when" covers each and names the suite that tests them; and every record that mentions
  // the mark says when the page adds it (app.js staleNoticeAfterFailure: a failed refresh whose answer
  // carries the version check verifies the notice again and adds no mark).
  const done = flatText(plan.split('\n- **R10. ')[1].split('\n- **')[0].split('\n## ')[0]).split('Done when:')[1] ?? '';
  const stale = read('momm/scripts/setup-maintenance.test.mjs');
  assert(/control/.test(done) && /not checked again/.test(done) && /setup-maintenance\.test\.mjs/.test(done), 'plan R10: the "Done when" must cover the named control and the mark after a failed refresh, and name the suite');
  assert(/not checked again/.test(stale) && /Close Setup Center/.test(stale), 'setup-maintenance.test.mjs must test what plan R10 says it tests');
  for (const name of ['momm/references/plan-1.17.1.md', 'momm/references/gates-1.17.1.md', 'momm/references/release-1.17.1.md']) {
    const text = flatText(read(name)), at = text.indexOf('not checked again');
    assert(at > 0 && /fails without/.test(text.slice(Math.max(0, at - 220), at)), name + ' must say that the notice is marked after a refresh that fails without the version check');
  }
}
// 1.17.1 final review rev_20261004130329_38fbda81466d (closing-receipt-fix-count): the entry of the second
// closing review counted one real finding and then listed two things as fixed. The second came from a
// suggestion, and the sentence that names it says so.
{
  const reviews = read('momm/references/gates-1.17.1.md').replace(/\r\n/g, '\n').split('\n## Reviews\n')[1].split('\n## ')[0];
  const entry = (reviews.split(/\n(?=- `rev_)/).find((block) => block.startsWith('- `rev_20261004112834_a8bab82d9d93`')) ?? '').replace(/\s+/g, ' ');
  const sentence = entry.split(/(?<=\.) /).find((one) => one.includes('anything is written')) ?? '';
  assert(/one real and fixed/.test(entry) && /suggestion/.test(sentence), 'gates-1.17.1.md: the entry of rev_20261004112834 counts one real finding, so the second thing it lists as fixed must be given to the suggestion it came from');
}
// 1.17.1 last review rev_20261004140004_37cfc29e0951 (final-review-quorum-contradiction): the entry of the
// final review named three routes that failed on two different pieces and then said that none of them
// gave a valid review of "that piece", beside "quorum was met on all five pieces". It says how many
// valid reviews each affected piece had.
{
  const reviews = read('momm/references/gates-1.17.1.md').replace(/\r\n/g, '\n').split('\n## Reviews\n')[1].split('\n## ')[0];
  const entry = (reviews.split(/\n(?=- `rev_)/).find((block) => block.startsWith('- `rev_20261004130329_38fbda81466d`')) ?? '').replace(/\s+/g, ' ');
  assert(entry && !/none of the three/.test(entry) && /piece 1 had three valid reviews/.test(entry) && /piece 5 had two/.test(entry), 'gates-1.17.1.md: the entry of rev_20261004130329 must say how many valid reviews pieces 1 and 5 had, so that "quorum on all five pieces" can be checked against it');
}
console.log(JSON.stringify({passed:true,checks:'supervised-vs-detached process limitations, verification checklist and separate default-off update controls'}));
