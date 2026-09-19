import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {privateTestFixture} from './private-test-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = [];
process.umask(0o077); // Synthetic test process only; private fixture descendants.
for (const scenario of ['valid-control', 'null-row', 'wrong-report-shape', 'missing-modern-report', 'false-sources', 'tampered-report']) {
  const dir = privateTestFixture('momm-ledger-integrity-');
  try {
    const er = path.join(dir, '.ensemble_reviews');
    fs.mkdirSync(path.join(er, 'reports'), { recursive: true });
    const row = { run_id: 'rev_fixture', timestamp: '2026-01-01T00:00:00Z', governor: 'codex', report_sha256: 'a'.repeat(64), reviewer_status: { claude: 'success' } };
    const valid = JSON.stringify({ run_id: 'rev_valid', reviewers: [{ agent: 'claude', status: 'success', verdict: 'ACCEPT', summary: 'Valid history remains visible', suggested_improvements: [] }], findings: [] });
    const validRow = { ...row, run_id: 'rev_valid', report_sha256: createHash('sha256').update(valid).digest('hex') };
    fs.writeFileSync(path.join(er, 'reports/rev_valid.json'), valid);
    fs.writeFileSync(path.join(er, 'dispositions.jsonl'), JSON.stringify({ run_id: 'rev_valid', reviewer: 'claude', disposition: 'rejected', suggestion: 'Synthetic rendering control', reason: 'Fixture only' }) + '\n');
    // Each named fault is the ONLY fault in its scenario (gate rev_20260919000938_1nkh): a malformed
    // report is sealed with its own real digest and the null row travels without the bad-digest row,
    // so a regression in one check cannot hide behind another check's warning.
    const malformed = scenario === 'wrong-report-shape' ? '{}' : scenario === 'false-sources' ? JSON.stringify({ reviewers: [], findings: [{ severity: 'WARNING', sources: false }] }) : null;
    const faultRow = malformed === null ? row : { ...row, report_sha256: createHash('sha256').update(malformed).digest('hex') };
    const logBytes = JSON.stringify(validRow) + '\n' + (scenario === 'valid-control' || scenario === 'null-row' ? '' : JSON.stringify(faultRow) + '\n') + (scenario === 'null-row' ? 'null\n' : '');
    fs.writeFileSync(path.join(er, 'review-log.jsonl'), logBytes);
    if (malformed !== null) fs.writeFileSync(path.join(er, 'reports/rev_fixture.json'), malformed);
    // Valid shape, but not the bytes whose digest the run record sealed (gate rev_20260918172020_ehti).
    if (scenario === 'tampered-report') fs.writeFileSync(path.join(er, 'reports/rev_fixture.json'), JSON.stringify({ run_id: 'rev_fixture', reviewers: [{ agent: 'claude', status: 'success', verdict: 'ACCEPT', summary: 'ALTERED AFTER SEALING', suggested_improvements: [] }], findings: [] }));
    const result = spawnSync(process.execPath, [path.join(root, 'momm/scripts/ledger.mjs')], { cwd: dir, encoding: 'utf8', timeout: 30000, env: { ...process.env, NO_UPDATE_CHECK: '1' } });
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(path.join(er, 'ledger.html'), 'utf8');
    if (scenario === 'valid-control') assert.doesNotMatch(html, /Evidence integrity warning/);
    else assert.match(html, /Evidence integrity warning/);
    const expectedWarning = { 'null-row': /review-log\.jsonl line 2: damaged record/, 'wrong-report-shape': /rev_fixture\.json: report unreadable or corrupt/, 'false-sources': /rev_fixture\.json: report unreadable or corrupt/, 'missing-modern-report': /rev_fixture: Missing sealed report/ }[scenario];
    if (expectedWarning) assert.match(html, expectedWarning, 'the warning must name this scenario\'s own fault');
    if (scenario === 'tampered-report') {
      assert.match(html, /rev_fixture: Stored report does not match the digest sealed in its run record/);
      assert.doesNotMatch(html, /ALTERED AFTER SEALING/, 'an unverified report must not be presented as the run transcript');
    }
    assert.doesNotMatch(html, /summary-only record \(predates sealed reports\)/);
    assert.match(html, /Valid history remains visible/);
    const tables = html.match(/<table class="momm-table">/g) || [];
    const scrollRegions = html.match(/<div class="table-scroll" role="region" tabindex="0" aria-label="Review evidence table; scroll horizontally if needed"><table class="momm-table">/g) || [];
    assert(tables.length > 0, 'Fixture must exercise the track-record tables');
    assert.equal(scrollRegions.length, tables.length, 'Every evidence table needs a labelled keyboard-focusable scroll region');
    if (scenario !== 'valid-control' && scenario !== 'null-row') assert.match(html, /rev_fixture/);
    assert.equal(fs.readFileSync(path.join(er, 'review-log.jsonl'), 'utf8'), logBytes);
    assert.equal(fs.readFileSync(path.join(er, 'reports/rev_valid.json'), 'utf8'), valid);
    tests.push({ scenario, passed: true });
  } catch (error) { tests.push({ scenario, passed: false, error: error.message }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// Every permission refusal in the ledger is reported as a plain message with exit 1, never as an
// uncaught exception with a stack trace (the check before writing used to be bare).
try {
  const ledgerSource = fs.readFileSync(path.join(root, 'momm/scripts/ledger.mjs'), 'utf8');
  const calls = ledgerSource.split('\n').filter(line => line.includes('requirePrivateEvidence(er)'));
  assert(calls.length >= 2, 'the ledger checks before reading and again before writing');
  for (const line of calls) assert.match(line, /^try \{ requirePrivateEvidence\(er\); \}/, 'unguarded permission check: ' + line.trim());
  tests.push({ scenario: 'permission-refusals-are-messages', passed: true });
} catch (error) { tests.push({ scenario: 'permission-refusals-are-messages', passed: false, error: error.message }); }
console.log(JSON.stringify({ passed: tests.every(t => t.passed), tests }, null, 2));
if (tests.some(t => !t.passed)) process.exitCode = 1;
