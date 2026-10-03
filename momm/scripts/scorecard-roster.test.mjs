// MOMM 1.17 B6: role on decisions and a per-route, per-role roster in the scorecard. Measurement only:
// nothing routes on these numbers. Synthetic reports, decisions and check files in a temporary folder;
// zero provider calls, zero network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as mod from './scorecard.mjs';
import { evidenceDir } from './evidence-location.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const results = [], failures = [];
const test = (name, fn) => { try { fn(); results.push(name); } catch (e) { failures.push({ name, error: String(e?.message ?? e).slice(0, 500) }); } };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'momm-roster-'));
const er = path.join(root, '.ensemble_reviews'); fs.mkdirSync(path.join(er, 'reports'), { recursive: true }); fs.mkdirSync(path.join(er, 'checks'));
const finding = (id, severity, sources) => ({ id, severity, target_file: 'src/a.mjs', line_range: [1, 2], issue: `issue ${id}`, rationale: 'r', test_suggestion: 't', sources });
const reviewer = (agent, status, extra = {}) => ({ agent, status, attempts: 1, duration_ms: 1000, suggested_improvements: [], usage: null, ...extra });
// A cover as the dispatcher records it (1.17 B3): its own row in covers[], never a reviewers[] row.
const cover = (agent, coveringFor, role, status, extra = {}) => ({ agent, cover: true, native: false, covering_for: coveringFor, covered_status: 'timeout', role, role_brief: null, status, attempts: 1, family: 'unknown', counted_for_quorum: false, duration_ms: 1000, suggested_improvements: [], ...extra });
function run(id, reviewers, findings, covers = undefined) {
  const report = { run_id: id, dispatcher_version: '1.17.0', governor: 'claude', input_sha256: 'a'.repeat(64), quorum: { required: 1, met: true }, reviewers, findings, ...(covers ? { covers } : {}) };
  fs.writeFileSync(path.join(er, 'reports', id + '.json'), JSON.stringify(report));
  fs.appendFileSync(path.join(er, 'review-log.jsonl'), JSON.stringify({ run_id: id, governor: 'claude', report_path: `.ensemble_reviews/reports/${id}.json` }) + '\n');
}
// A momm-check/1 observation, as checks.mjs writes it; returns the decision-row reference to it.
function check(name, phase, exitCode, { forge = false } = {}) {
  const rel = `.ensemble_reviews/checks/${name}.json`, bytes = JSON.stringify({ schema: 'momm-check/1', phase, exit_code: exitCode, observed_at: '2026-09-29T10:00:00Z', command_label: 'node t.mjs' });
  fs.writeFileSync(path.join(root, rel), bytes);
  return { path: rel, sha256: forge ? '0'.repeat(64) : sha(bytes) };
}
const rule = (runId, row) => fs.appendFileSync(path.join(er, 'dispositions.jsonl'), JSON.stringify({ run_id: runId, governor: 'claude', reason: 'r', ...row }) + '\n');

// Run A: roles from B1 (`role`) and, for an older reply, from `persona` only.
run('rev_a', [
  reviewer('codex', 'success', { role: 'surgeon', persona: 'surgeon', duration_ms: 4000 }),
  reviewer('grok', 'success', { persona: 'adversary', duration_ms: 10000 }),
  reviewer('gemini', 'timeout', { role: 'architect', duration_ms: 60000 }),
  reviewer('claude', 'self_excluded', { role: 'governor' }),
  // A reviewers[] row that merely looks like a cover is a native review: covers are read from covers[] only.
  reviewer('copilot', 'success', { role: 'verifier', cover: true, covering_for: 'gemini' }),
], [
  finding('crit-false', 'CRITICAL', ['codex']),
  finding('crit-real', 'CRITICAL', ['codex', 'grok']),
  finding('warn-no-repro', 'WARNING', ['grok']),
  finding('warn-forged', 'WARNING', ['grok']),
  finding('crit-rejected-unchecked', 'CRITICAL', ['antigravity']),
], [cover('antigravity', 'gemini', 'architect', 'success', { duration_ms: 8000, family: 'google', counted_for_quorum: true })]);
rule('rev_a', { reviewer: 'codex', finding_id: 'crit-false', disposition: 'rejected', verification: check('a1-investigation', 'investigation', 0) });
rule('rev_a', { reviewer: 'codex', finding_id: 'crit-real', disposition: 'applied', change_kind: 'behavior', reproduction: check('a2-before', 'before', 1), verification: check('a2-after', 'after', 0) });
rule('rev_a', { reviewer: 'grok', finding_id: 'warn-no-repro', disposition: 'applied', change_kind: 'behavior', reproduction: check('a3-before', 'before', 0) });
rule('rev_a', { reviewer: 'grok', finding_id: 'warn-forged', disposition: 'applied-with-modification', change_kind: 'behavior', reproduction: check('a4-before', 'before', 3, { forge: true }) });
rule('rev_a', { reviewer: 'antigravity', finding_id: 'crit-rejected-unchecked', disposition: 'rejected' });
rule('rev_a', { reviewer: 'codex', suggestion: 'tidy', disposition: 'applied', change_kind: 'style' });

// Run B: a failed cover, a route with no role at all, and a row that records its role itself.
run('rev_b', [
  reviewer('codex', 'success', { role: 'surgeon', duration_ms: 2000 }),
  reviewer('copilot', 'success', { duration_ms: 7000 }),
  reviewer('<script>x</script>', 'success', { role: '<img src=x onerror=alert(1)>' }),
], [finding('warn-b', 'WARNING', ['codex'])], [cover('gemini', 'grok', 'surgeon', 'invalid_output', { duration_ms: 5000, piece: 'piece-01' })]);
rule('rev_b', { reviewer: 'codex', role: 'surgeon', finding_id: 'warn-b', disposition: 'applied', change_kind: 'behavior', reproduction: check('b1-before', 'before', 2) });

try {
  const card = mod.buildScorecard(root);
  const row = (route, role) => card.roster?.rows?.find(r => r.route === route && r.role === role);
  test('the roster is keyed by route and role and labelled as this project\'s decisions, not a benchmark', () => {
    assert(card.roster && Array.isArray(card.roster.rows), 'card.roster.rows missing');
    assert.match(card.roster.label, /this project's governor decisions, not a benchmark/);
    assert(row('codex', 'surgeon') && row('gemini', 'architect') && row('gemini', 'surgeon'), JSON.stringify(card.roster.rows.map(r => [r.route, r.role])));
    assert.equal(card.roster.rows.filter(r => r.route === 'claude').length, 0, 'the governor excluding itself is not a review');
  });
  test('valid-review rate: successful reviews over reviews asked', () => {
    assert.deepEqual([row('codex', 'surgeon').reviews_valid, row('codex', 'surgeon').reviews_asked, row('codex', 'surgeon').valid_review_rate], [2, 2, 1]);
    assert.deepEqual([row('gemini', 'architect').reviews_valid, row('gemini', 'architect').reviews_asked, row('gemini', 'architect').valid_review_rate], [0, 1, 0]);
  });
  test('a missing role falls back to the report persona; no role at all is kept as null', () => {
    assert(row('grok', 'adversary'), 'grok persona fallback missing');
    assert(row('copilot', null), 'copilot without role or persona');
  });
  test('reproduced-claim rate: applied findings whose reproduction check (hash-verified) exited non-zero', () => {
    const codex = row('codex', 'surgeon');
    assert.deepEqual([codex.reproduced_claims, codex.applied_findings, codex.reproduced_claim_rate], [2, 2, 1]);
    const grok = row('grok', 'adversary');
    assert.deepEqual([grok.reproduced_claims, grok.applied_findings, grok.reproduced_claim_rate], [0, 2, 0], 'exit 0 and a forged hash are not reproductions');
  });
  test('false-CRITICAL rate: CRITICALs rejected after an investigation check over CRITICALs ruled', () => {
    const codex = row('codex', 'surgeon');
    assert.deepEqual([codex.critical_false, codex.critical_ruled, codex.false_critical_rate], [1, 2, 0.5]);
    const anti = row('antigravity', 'architect');
    assert.deepEqual([anti.critical_false, anti.critical_ruled, anti.false_critical_rate], [0, 1, 0], 'a rejection without investigation is not counted as false');
  });
  test('median review time comes from the report duration_ms', () => {
    assert.equal(row('codex', 'surgeon').median_review_seconds, 3);
    assert.equal(row('gemini', 'architect').median_review_seconds, 60);
  });
  test('cover success: covers that succeeded over covers attempted, zero-safe', () => {
    assert.deepEqual([row('antigravity', 'architect').covers_succeeded, row('antigravity', 'architect').covers_attempted, row('antigravity', 'architect').cover_success_rate], [1, 1, 1]);
    assert.deepEqual([row('gemini', 'surgeon').covers_succeeded, row('gemini', 'surgeon').covers_attempted, row('gemini', 'surgeon').cover_success_rate], [0, 1, 0]);
    assert.equal(row('codex', 'surgeon').cover_success_rate, null);
    assert.equal(row('copilot', 'verifier').covers_attempted, 0, 'a reviewers[] row is never counted as a cover');
  });
  test('a cover is a review asked of the covering route in the covered role; a finding raised only by a cover is credited to that role', () => {
    const anti = row('antigravity', 'architect');
    assert.deepEqual([anti.reviews_valid, anti.reviews_asked, anti.median_review_seconds], [1, 1, 8]);
    assert.deepEqual([row('gemini', 'surgeon').reviews_valid, row('gemini', 'surgeon').reviews_asked], [0, 1]);
    assert.equal(card.roster.rows.filter(r => r.route === 'antigravity').length, 1, 'no role-less antigravity seat from the cover finding');
  });
  test('zero denominators are null, never 0', () => {
    const grok = row('grok', 'adversary');
    assert.equal(grok.critical_ruled, 0); assert.equal(grok.false_critical_rate, null);
    assert.equal(row('gemini', 'architect').reproduced_claim_rate, null);
  });
  test('HTML shows the roster table with its label, "no data" for zero denominators, and escapes hostile names', () => {
    const html = mod.renderHtml(card, '');
    const section = html.slice(html.indexOf('aria-label="Route and role roster"'));
    assert(section.length > 30 && section.includes('<table'), 'roster table missing');
    assert.match(html, /this project(&#39;|')s governor decisions, not a benchmark/);
    const grokRow = section.split('<tr>').find(r => r.includes('>grok<'));
    assert(grokRow, 'grok roster row missing');
    assert.match(grokRow, /no data/); assert(!/>0%/.test(grokRow.split('</td>')[3] ?? ''), 'a zero denominator must not render as 0%');
    assert(!html.includes('<img src=x') && !html.includes('<script>x'), 'hostile role or route rendered raw');
  });
  test('--json carries the roster', () => {
    const r = spawnSync(process.execPath, [path.join(here, 'scorecard.mjs'), '--dir', root, '--json'], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert(Array.isArray(json.roster?.rows) && json.roster.rows.length >= 6);
    assert.equal(json.roster.rows.find(x => x.route === 'grok').false_critical_rate, null);
  });
  // Gate-3 triage of rev_20260930003709_e5847282134d (root-project-check-path): for a project at a
  // filesystem root the containment prefix doubled the separator, so no check file was ever credited.
  // The root is simulated: the project's real path is reported as the root, and reads under a probe
  // folder at the root are served from the temporary project.
  test('a project at a filesystem root still credits its check files', () => {
    const project = path.join(root, 'at-root'), rer = path.join(project, '.ensemble_reviews'), ROOT = path.parse(project).root, probe = 'momm-roster-root-probe';
    fs.mkdirSync(path.join(rer, 'reports'), { recursive: true }); fs.mkdirSync(path.join(project, probe));
    const bytes = JSON.stringify({ schema: 'momm-check/1', phase: 'before', exit_code: 1, observed_at: '2026-09-30T00:00:00Z', command_label: 't' });
    fs.writeFileSync(path.join(project, probe, 'before.json'), bytes);
    fs.writeFileSync(path.join(rer, 'reports', 'rev_root.json'), JSON.stringify({ run_id: 'rev_root', governor: 'claude', input_sha256: 'a'.repeat(64), reviewers: [reviewer('codex', 'success', { role: 'surgeon' })], findings: [finding('f1', 'WARNING', ['codex'])] }));
    fs.writeFileSync(path.join(rer, 'dispositions.jsonl'), JSON.stringify({ run_id: 'rev_root', finding_id: 'f1', reviewer: 'codex', disposition: 'applied', reason: 'r', reproduction: { path: `${probe}/before.json`, sha256: sha(bytes) } }) + '\n');
    const fake = path.join(ROOT, probe), map = p => (typeof p === 'string' && (p === fake || p.startsWith(fake + path.sep)) ? path.join(project, p.slice(ROOT.length)) : p);
    const original = { native: fs.realpathSync.native, lstat: fs.lstatSync, readFile: fs.readFileSync };
    fs.realpathSync.native = (p, ...rest) => (p === project ? ROOT : typeof p === 'string' && p.startsWith(fake) ? p : original.native(p, ...rest));
    fs.lstatSync = (p, ...rest) => original.lstat(map(p), ...rest);
    fs.readFileSync = (p, ...rest) => original.readFile(map(p), ...rest);
    let seat;
    try { seat = mod.buildScorecard(project).roster.rows.find(r => r.route === 'codex' && r.role === 'surgeon'); }
    finally { fs.realpathSync.native = original.native; fs.lstatSync = original.lstat; fs.readFileSync = original.readFile; }
    assert.deepEqual([seat?.applied_findings, seat?.reproduced_claims], [1, 1]);
  });
  // Gate-3 follow-up: with MOMM_EVIDENCE_HOME (1.17 A7) the check records a decision row names as
  // '.ensemble_reviews/checks/...' live in the evidence home, and readCheck looked for them in the project.
  test('with an evidence home, reproduced claims and false CRITICALs are read from checks stored there', () => {
    const project = path.join(root, 'homed-project'), home = path.join(root, 'evidence-home');
    fs.mkdirSync(project); fs.mkdirSync(home);
    const saved = process.env.MOMM_EVIDENCE_HOME;
    process.env.MOMM_EVIDENCE_HOME = home;
    let seat;
    try {
      const dir = evidenceDir({ cwd: project, env: process.env });
      assert(!dir.startsWith(project + path.sep), 'the evidence folder must be outside the project');
      fs.mkdirSync(path.join(dir, 'reports'), { recursive: true }); fs.mkdirSync(path.join(dir, 'checks'));
      const stored = (name, phase, exitCode) => {
        const bytes = JSON.stringify({ schema: 'momm-check/1', phase, exit_code: exitCode, observed_at: '2026-09-30T00:00:00Z', command_label: 't' });
        fs.writeFileSync(path.join(dir, 'checks', `${name}.json`), bytes);
        return { path: `.ensemble_reviews/checks/${name}.json`, sha256: sha(bytes) };
      };
      fs.writeFileSync(path.join(dir, 'reports', 'rev_home.json'), JSON.stringify({ run_id: 'rev_home', governor: 'claude', input_sha256: 'a'.repeat(64), reviewers: [reviewer('codex', 'success', { role: 'surgeon' })], findings: [finding('h1', 'WARNING', ['codex']), finding('h2', 'CRITICAL', ['codex'])] }));
      fs.writeFileSync(path.join(dir, 'dispositions.jsonl'), [
        { run_id: 'rev_home', finding_id: 'h1', reviewer: 'codex', disposition: 'applied', reason: 'r', reproduction: stored('before', 'before', 1) },
        { run_id: 'rev_home', finding_id: 'h2', reviewer: 'codex', disposition: 'rejected', reason: 'r', verification: stored('probe', 'investigation', 0) },
      ].map(r => JSON.stringify(r)).join('\n') + '\n');
      assert.equal(fs.existsSync(path.join(project, '.ensemble_reviews')), false);
      seat = mod.buildScorecard(project).roster.rows.find(r => r.route === 'codex' && r.role === 'surgeon');
    } finally { if (saved === undefined) delete process.env.MOMM_EVIDENCE_HOME; else process.env.MOMM_EVIDENCE_HOME = saved; }
    assert.deepEqual([seat?.applied_findings, seat?.reproduced_claims, seat?.critical_ruled, seat?.critical_false], [1, 1, 1, 1]);
  });
  // Final review of 1.17.0 (roster-empty-says-no-reviews, median-undefined-renders-word and the partial-roster
  // suggestion): a card from before the roster, or a partial roster, rendered "No reviews recorded yet."
  // under reviews that were listed above it, "undefined s" for a missing median, or threw.
  test('an empty, partial or legacy roster renders its own empty message and never "undefined"', () => {
    const region = (html) => html.slice(html.indexOf('aria-label="Route and role roster"'));
    const legacy = { ...card }; delete legacy.roster;
    for (const shape of [legacy, { ...card, roster: { label: 'x' } }, { ...card, roster: { rows: [] } }]) {
      const html = mod.renderHtml(shape, '');
      assert(html.includes('<th scope="row">codex</th>'), 'the reviewer table lists reviews');
      assert(!region(html).includes('No reviews recorded yet'), 'the roster must not say no reviews were recorded');
      assert(region(html).includes('No routes or roles recorded yet.'));
      assert.match(mod.renderMarkdown(shape), /## Route and role roster/);
      // Final review of 1.17.0 (two suggestions): the markdown table said nothing, a header with no rows.
      assert(mod.renderMarkdown(shape).includes('\n| No routes or roles recorded yet. | | | | | | |\n'), 'the markdown roster says it is empty');
    }
    assert(!mod.renderMarkdown(card).includes('No routes or roles recorded yet.'), 'a roster with rows has no placeholder');
    assert(mod.renderHtml({ ...card, roster: { rows: [] } }, '').includes(mod.ROSTER_LABEL.slice(0, 40)), 'a roster without a label gets the standard one');
    const bare = { ...row('codex', 'surgeon') }; delete bare.median_review_seconds;
    const shown = { ...card, roster: { ...card.roster, rows: [bare] } };
    assert(!region(mod.renderHtml(shown, '')).includes('undefined'));
    assert(region(mod.renderHtml(shown, '')).includes('<td class="muted">no data</td>'));
    assert(!mod.renderMarkdown(shown).includes('undefined s'));
  });
} finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }

console.log(JSON.stringify({ passed: failures.length === 0, checks: results.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
