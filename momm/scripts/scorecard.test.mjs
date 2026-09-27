// MOMM 1.16.1: effectiveness scorecard and training export, both read-only derivations of evidence the
// ledger already holds. Zero provider calls, zero network; synthetic evidence in a temporary folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preparePrivateEvidence } from './evidence-permissions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.join(here, 'scorecard.mjs');
const mod = fs.existsSync(modulePath) ? await import(new URL('./scorecard.mjs', import.meta.url).href) : null;
const results = [], failures = [];
const test = (name, fn) => { try { fn(); results.push(name); } catch (e) { failures.push({ name, error: String(e?.message ?? e).slice(0, 500) }); } };

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'momm-scorecard-'));
const er = path.join(root, '.ensemble_reviews'); fs.mkdirSync(path.join(er, 'reports'), { recursive: true });
const finding = (id, severity, sources, extra = {}) => ({ id, severity, target_file: 'src/a.mjs', line_range: [1, 2], issue: `issue ${id}`, rationale: `why ${id}`, test_suggestion: `test ${id}`, sources, ...extra });
const reviewer = (agent, status, extra = {}) => ({ agent, status, attempts: 1, duration_ms: 1000, persona: 'skeptic', suggested_improvements: [], usage: null, ...extra });
function run(id, reviewers, findings, { quorumMet = true } = {}) {
  const report = { run_id: id, dispatcher_version: '1.16.1', governor: 'claude', input_sha256: 'a'.repeat(64), input_bytes: 1000, quorum: { required: 2, met: quorumMet }, reviewers, findings };
  fs.writeFileSync(path.join(er, 'reports', id + '.json'), JSON.stringify(report));
  fs.appendFileSync(path.join(er, 'review-log.jsonl'), JSON.stringify({ timestamp: '2026-09-20T10:00:00.000Z', run_id: id, governor: 'claude', reviewer_status: Object.fromEntries(reviewers.map(r => [r.agent, r.status])), report_path: `.ensemble_reviews/reports/${id}.json` }) + '\n');
}
const rule = (runId, row) => fs.appendFileSync(path.join(er, 'dispositions.jsonl'), JSON.stringify({ timestamp: '2026-09-20T11:00:00.000Z', run_id: runId, governor: 'claude', ...row }) + '\n');

// Run 1: codex and grok both valid; antigravity answered with invalid output after a retry.
run('rev_1', [
  reviewer('codex', 'success', { suggested_improvements: ['tidy the helper'], usage: { reported: { total_tokens: 1000, cost_usd: null }, coverage: { tokens: true, cost: false } } }),
  reviewer('grok', 'success', { duration_ms: 3000, usage: { reported: { total_tokens: 2000, cost_usd: 0.5 }, coverage: { tokens: true, cost: true } } }),
  reviewer('antigravity', 'invalid_output', { attempts: 2, retried_after: 'invalid_output' }),
  reviewer('claude', 'self_excluded'),
], [
  finding('shared-bug', 'CRITICAL', ['codex', 'grok']),           // corroborated, accepted
  finding('grok-only-bug', 'WARNING', ['grok']),                  // unique catch, accepted
  finding('codex-inflated', 'CRITICAL', ['codex']),               // rejected critical: severity inflation
  finding('codex-later', 'NITPICK', ['codex']),                   // deferred
  finding('unruled', 'WARNING', ['grok']),                        // never ruled on
]);
rule('rev_1', { reviewer: 'codex', finding_id: 'shared-bug', severity: 'CRITICAL', sources: ['codex', 'grok'], disposition: 'applied', reason: 'reproduced and fixed' });
rule('rev_1', { reviewer: 'grok', finding_id: 'grok-only-bug', severity: 'WARNING', sources: ['grok'], disposition: 'applied-with-modification', reason: 'fixed differently' });
rule('rev_1', { reviewer: 'codex', finding_id: 'codex-inflated', severity: 'CRITICAL', sources: ['codex'], disposition: 'rejected', reason: 'designed behaviour' });
rule('rev_1', { reviewer: 'codex', finding_id: 'codex-later', severity: 'NITPICK', sources: ['codex'], disposition: 'deferred', reason: 'later' });
rule('rev_1', { reviewer: 'codex', finding_id: null, suggestion: 'tidy the helper', disposition: 'rejected', reason: 'refactor' });
fs.appendFileSync(path.join(er, 'dispositions.jsonl'), JSON.stringify({ kind: 'review_rating', run_id: 'rev_1', reviewer: 'grok', rating: 5, tags: ['specific'], note: '' }) + '\n');
fs.appendFileSync(path.join(er, 'dispositions.jsonl'), 'this line is not JSON\n');
// Run 3: a SPLIT run. The merged route row reads "success" if any piece succeeded; reliability must be
// counted per piece or a route that failed two pieces in five looks perfect (seen on the real 1.16 gate).
run('rev_3', [reviewer('copilot', 'success', { pieces: { success: 3, invalid_output: 1, timeout: 1 }, duration_ms: 5000, retried_pieces: [{ piece: 'piece-02', retried_after: 'invalid_output', final_status: 'success' }] }), reviewer('claude', 'self_excluded')], []);
// Run 2: quorum missed.
run('rev_2', [reviewer('codex', 'timeout'), reviewer('grok', 'success'), reviewer('claude', 'self_excluded')], [], { quorumMet: false });

try {
  test('module exists', () => assert(mod, 'momm/scripts/scorecard.mjs is missing'));
  if (mod) {
    const card = mod.buildScorecard(root);
    const who = (a) => card.reviewers.find(r => r.reviewer === a);
    test('reliability counts reviews asked and valid; the governor excluding itself is not a review', () => {
      assert.equal(who('codex').reviews_asked, 2); assert.equal(who('codex').reviews_valid, 1);
      assert.equal(who('grok').reviews_valid, 2); assert.equal(who('antigravity').reviews_valid, 0);
      assert.equal(who('antigravity').retries, 1); assert.equal(card.reviewers.some(r => r.reviewer === 'claude'), false);
    });
    test('a split run is counted per piece: asked, valid, outcomes, retries and time per review', () => {
      const c = who('copilot'); assert.equal(c.reviews_asked, 5); assert.equal(c.reviews_valid, 3); assert.equal(c.valid_rate, 0.6);
      assert.equal(c.outcomes.invalid_output, 1); assert.equal(c.outcomes.timeout, 1); assert.equal(c.retries, 1); assert.equal(c.median_seconds, 1);
    });
    test('acceptance is the governor acceptance rate over RULED findings; deferred and unruled never count as wins or losses', () => {
      const c = who('codex'); assert.equal(c.findings_raised, 3); assert.equal(c.accepted, 1); assert.equal(c.rejected, 1); assert.equal(c.deferred, 1);
      assert.equal(c.acceptance_rate, 0.5);
      const g = who('grok'); assert.equal(g.findings_raised, 3); assert.equal(g.accepted, 2); assert.equal(g.rejected, 0); assert.equal(g.unruled, 1); assert.equal(g.acceptance_rate, 1);
    });
    test('a corroborated finding credits every reviewer that raised it; a unique catch credits one', () => {
      assert.equal(who('grok').unique_catches, 1); assert.equal(who('codex').unique_catches, 0);
      assert.equal(card.ensemble.accepted_findings, 2); assert.equal(card.ensemble.accepted_corroborated, 1); assert.equal(card.ensemble.accepted_single_source, 1);
    });
    test('severity calibration: a rejected CRITICAL is inflation', () => {
      assert.equal(who('codex').critical_raised, 2); assert.equal(who('codex').critical_rejected, 1); assert.equal(who('codex').severity_inflation, 0.5);
      assert.equal(who('grok').severity_inflation, 0);
    });
    test('what MOMM adds: for each reviewer, the accepted findings it alone would have missed', () => {
      assert.equal(card.ensemble.missed_if_alone.codex, 1, 'codex alone misses the grok-only bug');
      assert.equal(card.ensemble.missed_if_alone.grok, 0);
      assert.equal(card.ensemble.runs, 3); assert.equal(card.ensemble.quorum_met, 2);
    });
    test('cost is never invented: an unmetered route says unmetered, not zero', () => {
      assert.equal(who('codex').cost_usd, null); assert.equal(who('codex').cost_label, 'unmetered');
      assert.equal(who('grok').cost_usd, 0.5); assert.equal(who('grok').cost_per_accepted_finding, null);
      assert.equal(who('grok').cost_label, 'partial');
      assert.equal(who('codex').tokens, 1000);
    });
    test('a score needs enough ruled findings; below the floor it says insufficient, never a number', () => {
      assert.equal(who('grok').score, null); assert.match(who('grok').score_note, /insufficient/i);
      const big = mod.scoreOf({ acceptance_rate: 0.8, valid_rate: 0.9, unique_share: 0.25, severity_inflation: 0.1, ruled: 20 });
      assert.equal(big.score, Math.round(100 * (0.4 * 0.8 + 0.25 * 0.9 + 0.2 * 0.25 + 0.15 * 0.9)));
      assert.equal(mod.scoreOf({ acceptance_rate: 1, valid_rate: 1, unique_share: 1, severity_inflation: 0, ruled: 7 }).score, null);
    });
    test('damaged ledger lines are counted and reported, never silently dropped or fatal', () => {
      assert.equal(card.integrity.unreadable_disposition_lines, 1); assert.equal(card.ratings.grok.n, 1);
    });
    test('the caveat travels with the numbers', () => assert.match(card.caveat, /not ground truth/i));
    test('markdown and HTML tables render every reviewer and escape hostile text', () => {
      const md = mod.renderMarkdown(card), html = mod.renderHtml(card, 'body{}');
      for (const a of ['codex', 'grok', 'antigravity', 'copilot']) { assert(md.includes(a)); assert(html.includes(a)); }
      assert.match(md, /\| Reviewer \|/); assert.match(html, /<table/);
      const hostile = mod.renderHtml({ ...card, reviewers: [{ ...who('grok'), reviewer: '<script>alert(1)</script>' }] }, '');
      assert(!hostile.includes('<script>alert(1)')); assert(hostile.includes('&lt;script&gt;'));
    });
    const records = mod.trainingRecords(root);
    test('training records: one per RULED finding or suggestion, labelled with the governor decision and its reason', () => {
      assert.equal(records.length, 5, 'four ruled findings and one ruled suggestion; the unruled finding and the rating are not examples');
      const r = records.find(x => x.finding_id === 'grok-only-bug');
      assert.equal(r.schema, 'momm-training/1'); assert.equal(r.label, 'applied-with-modification'); assert.equal(r.label_group, 'accepted');
      assert.equal(r.corroborated, false); assert.deepEqual(r.reviewers, ['grok']); assert.equal(r.text.issue, 'issue grok-only-bug');
      assert.match(r.label_source, /governor/); assert.equal(records.filter(x => x.kind === 'suggestion').length, 1);
    });
    test('chat format gives a triage example: the finding in, the decision and reason out', () => {
      const chat = mod.toChat(records[0]);
      assert.deepEqual(chat.messages.map(m => m.role), ['system', 'user', 'assistant']);
      assert.doesNotThrow(() => JSON.parse(chat.messages[2].content));
    });
    test('home folders are not exported', () => {
      const homey = mod.scrub(`see ${os.homedir()}${path.sep}secret${path.sep}file.txt for details`);
      assert(!homey.includes(os.homedir())); assert(homey.includes('~'));
      // Range review rev_20260925131115_6ed35d0bdf89 (home-scrub-substring): Windows paths are case-insensitive,
      // so a lower-cased home path must be scrubbed too; and a longer sibling name is not the home folder.
      if (process.platform === 'win32') assert(!mod.scrub(`see ${os.homedir().toLowerCase()}\\x`).toLowerCase().includes(path.basename(os.homedir()).toLowerCase()), 'a lower-cased home path keeps no user name');
      assert.equal(mod.scrub(`${os.homedir()}ow${path.sep}x`), `${os.homedir()}ow${path.sep}x`, 'a sibling folder that only starts with the home path is left alone');
    });
    const cli = (args) => spawnSync(process.execPath, [modulePath, '--dir', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    test('command line: --json, --markdown, and an export that is written only where told, owner-only', () => {
      assert.equal(JSON.parse(cli(['--json']).stdout).schema, 'momm-scorecard/1');
      assert.match(cli(['--markdown']).stdout, /\| Reviewer \|/);
      const out = path.join(root, 'out', 'train.jsonl');
      const p = cli(['--export-training', out]); assert.equal(p.status, 0, p.stderr);
      const lines = fs.readFileSync(out, 'utf8').trim().split('\n'); assert.equal(lines.length, 5); lines.forEach(l => JSON.parse(l));
      assert(fs.existsSync(out + '.README.md'), 'a dataset card is written beside the data');
      assert.match(fs.readFileSync(out + '.README.md', 'utf8'), /not ground truth/i);
      if (process.platform !== 'win32') assert.equal(fs.statSync(out).mode & 0o077, 0, 'owner-only on POSIX');
      const again = cli(['--export-training', out]); assert.notEqual(again.status, 0, 'an existing file is never overwritten silently');
      assert.equal(cli(['--export-training', out, '--format', 'chat', '--force']).status, 0);
      assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8').split('\n')[0])), ['messages']);
    });
    // macOS reaches every temp folder through a link (/var -> /private/var, /tmp -> /private/tmp). Refusing
    // any linked ancestor made every export fail there (CI run 35658394866, all four macOS jobs). The
    // path is resolved to its real place instead, that place is verified owner-only, and the owner is told.
    test('an output folder reached through a link is resolved, verified and reported; a linked FILE is still refused', () => {
      const real = path.join(root, 'real-out'); preparePrivateEvidence(real); // created private the way MOMM creates it; a plain mkdir inherits broad access on Windows
      const via = path.join(root, 'via-link'); fs.symlinkSync(real, via, process.platform === 'win32' ? 'junction' : 'dir');
      const p = cli(['--export-training', path.join(via, 'train.jsonl')]); assert.equal(p.status, 0, p.stderr);
      assert(fs.existsSync(path.join(real, 'train.jsonl')), 'the data is in the real folder');
      const reported = JSON.parse(p.stdout).file;
      assert.equal(fs.realpathSync.native(path.dirname(reported)), fs.realpathSync.native(real), 'the owner is told the real location: ' + reported);
      assert(!reported.includes('via-link'), 'the reported path is the resolved one');
      if (process.platform !== 'win32') { // a file symlink needs privileges on Windows; the rule is tested where it can be made
        const target = path.join(real, 'elsewhere.jsonl'); fs.writeFileSync(target, 'keep me\n', { mode: 0o600 });
        const linked = path.join(real, 'linked.jsonl'); fs.symlinkSync(target, linked);
        const refused = cli(['--export-training', linked, '--force']); assert.notEqual(refused.status, 0);
        assert.equal(fs.readFileSync(target, 'utf8'), 'keep me\n', 'the file behind the link is untouched');
      }
    });
    // Range review rev_20260925004814_1ed9f58c2c3a (html-overwrites-without-consent): --html replaced an
    // existing file without --force, unlike --export-training.
    test('command line: --html never overwrites an existing file without --force', () => {
      const out = path.join(root, 'out', 'card.html');
      assert.equal(cli(['--html', out]).status, 0, 'first write');
      fs.writeFileSync(out, 'keep me\n', { mode: 0o600 });
      const again = cli(['--html', out]);
      assert.notEqual(again.status, 0, 'an existing file is never overwritten silently');
      assert.match(again.stderr, /exists/i);
      assert.equal(fs.readFileSync(out, 'utf8'), 'keep me\n');
      assert.equal(cli(['--html', out, '--force']).status, 0, '--force consents to replacement');
      assert.match(fs.readFileSync(out, 'utf8'), /<table/);
    });
    // Range review rev_20260925004814_1ed9f58c2c3a (suggestion-reviewer-case-sensitivity): the suggestion key
    // kept the reviewer's case, so 'Codex' and 'codex' rulings on one item were both counted.
    test('a suggestion ruled twice under differently cased reviewer names counts once, the latest ruling', () => {
      const dir = fs.mkdtempSync(path.join(root, 'case-')), e = path.join(dir, '.ensemble_reviews');
      fs.mkdirSync(path.join(e, 'reports'), { recursive: true });
      const report = { run_id: 'rev_case', dispatcher_version: '1.16.1', governor: 'claude', input_sha256: 'b'.repeat(64), input_bytes: 10, quorum: { required: 1, met: true }, reviewers: [reviewer('codex', 'success', { suggested_improvements: ['one idea'] })], findings: [] };
      fs.writeFileSync(path.join(e, 'reports', 'rev_case.json'), JSON.stringify(report));
      fs.writeFileSync(path.join(e, 'review-log.jsonl'), JSON.stringify({ timestamp: '2026-09-20T10:00:00.000Z', run_id: 'rev_case', governor: 'claude', reviewer_status: { codex: 'success' }, report_path: '.ensemble_reviews/reports/rev_case.json' }) + '\n');
      fs.writeFileSync(path.join(e, 'dispositions.jsonl'), [
        { timestamp: '2026-09-20T11:00:00.000Z', run_id: 'rev_case', governor: 'claude', reviewer: 'Codex', finding_id: null, item_id: 'item-1', suggestion: 'one idea', disposition: 'rejected', reason: 'first' },
        { timestamp: '2026-09-20T12:00:00.000Z', run_id: 'rev_case', governor: 'claude', reviewer: 'codex', finding_id: null, item_id: 'item-1', suggestion: 'one idea', disposition: 'applied', reason: 'second' },
      ].map(r => JSON.stringify(r)).join('\n') + '\n');
      const row = mod.buildScorecard(dir).reviewers.find(r => r.reviewer === 'codex');
      assert.equal(row.suggestions_accepted, 1); assert.equal(row.suggestions_rejected, 0);
    });
    test('command line: no evidence folder is a clear message, not a crash', () => {
      const empty = fs.mkdtempSync(path.join(root, 'empty-'));
      const p = spawnSync(process.execPath, [modulePath, '--dir', empty, '--json'], { encoding: 'utf8', windowsHide: true });
      assert.equal(p.status, 0); assert.equal(JSON.parse(p.stdout).ensemble.runs, 0);
    });
    test('failed-attempt usage is counted without counting the final row twice', () => {
      const file = path.join(er,'reports','rev_1.json');
      const original = fs.readFileSync(file,'utf8'), value = JSON.parse(original);
      value.attempt_evidence = [
        {route:'grok',outcome:'invalid_output',usage:{reported:{total_tokens:40,cost_usd:0.2}}},
        {route:'grok',outcome:'succeeded',usage:{reported:{total_tokens:50,cost_usd:0.3}}},
        {route:'grok',outcome:'timeout',usage:null},
      ];
      fs.writeFileSync(file,JSON.stringify(value));
      try {
        const row = mod.buildScorecard(root).reviewers.find(r=>r.reviewer==='grok');
        assert.equal(row.tokens,90); assert.equal(row.cost_usd,0.5);
        assert.equal(row.cost_label,'partial');
        assert.deepEqual(row.cost_coverage,{reported:2,attempts:4});
        assert.equal(row.cost_per_accepted_finding,null,'partial spend must not look like the full cost of an accepted finding');
        assert.match(mod.renderMarkdown(mod.buildScorecard(root)),/partial/);
      }
      finally { fs.writeFileSync(file,original); }
    });
  }
} finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }

console.log(JSON.stringify({ passed: failures.length === 0, checks: results.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
