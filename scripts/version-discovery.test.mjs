import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'momm/scripts/multi-review.mjs'), 'utf8');
const a = source.indexOf('async function commandVersion('), b = source.indexOf('// Presence-only', a);
assert(a >= 0 && b > a, 'Inspect changed commandVersion extraction boundaries');
const tests = [];
// Every row pins the reported version (null when none may be reported), so a spurious
// or unparsed version cannot hide behind a correct installed/version_status pair.
for (const [name, result, installed, versionStatus, expectedVersion] of [
  ['missing', { error: { code: 'ENOENT' } }, false, 'missing', null],
  ['timeout', { code: null, timedOut: true, stdout: '9.9.9' }, null, 'timeout', null],
  ['nonzero', { code: 1, stderr: 'private sentinel 9.9.9' }, null, 'error', null],
  ['empty success', { code: 0, stdout: '' }, null, 'error', null],
  ['valid', { code: 0, stdout: 'Copilot 1.0.85' }, true, 'success', '1.0.85'],
  // Gate rev_20260918172020_ehti version-semver-strict: a healthy "v"-prefixed
  // banner must not look like failed discovery; the prefix is never reported.
  ['v-prefixed banner', { code: 0, stdout: 'v1.2.3\n' }, true, 'success', '1.2.3'],
  ['v-prefixed banner after a name', { code: 0, stdout: 'example-cli v0.45.1 (build 7)' }, true, 'success', '0.45.1'],
  ['prerelease is kept', { code: 0, stdout: 'tool 1.0.5-beta.2' }, true, 'success', '1.0.5-beta.2'],
  ['two-part number is not a version', { code: 0, stdout: 'v1.2' }, null, 'error', null],
  ['digits glued to a word are not a version', { code: 0, stdout: 'build7.1.2.3x' }, null, 'error', null],
]) {
  try {
    const fn = vm.runInNewContext(source.slice(a, b) + ';commandVersion', { runProcess: async () => result, clipped: (s, n) => String(s ?? '').slice(0, n) });
    const actual = await fn('copilot');
    assert.equal(actual.installed, installed);
    assert.equal(actual.version_status, versionStatus);
    assert.equal(actual.version ?? null, expectedVersion);
    assert(!JSON.stringify(actual).includes('private sentinel'));
    tests.push({ name, passed: true });
  } catch (error) { tests.push({ name, passed: false, error: error.message }); }
}
async function check(name, test) {
  try { await test(); tests.push({ name, passed: true }); }
  catch (error) { tests.push({ name, passed: false, error: error.message }); }
}
await check('inconclusive preflight never infers auth or suggests installation', async () => {
  const start = source.indexOf('async function preflightCheck('), end = source.indexOf('const ANSI =', start);
  assert(start >= 0 && end > start);
  const preflight = vm.runInNewContext(source.slice(start, end) + ';preflightCheck', {
    commandVersion: async () => ({ installed: null, version: null, version_status: 'timeout' }),
    authEvidence: () => { throw new Error('Must not infer auth after failed discovery'); },
  });
  const [route] = await preflight(['copilot'], 'codex');
  assert.equal(route.installed, null);
  assert.equal(route.ready, false);
  assert.equal(route.auth, 'unknown');
  assert.equal(route.install_hint, undefined);
  assert.equal(route.login_hint, undefined);
});
await check('dashboard preserves unknown and disallows unknown maintenance actions', () => {
  const ui = fs.readFileSync(path.join(root, 'momm/assets/setup-ui/app.js'), 'utf8');
  const start = ui.indexOf('function routeState('), end = ui.indexOf('function stateLabel(', start);
  assert(start >= 0 && end > start);
  const state = vm.runInNewContext(ui.slice(start, end) + ';routeState', { liveResults: new Map() });
  assert.equal(state({ agent: 'copilot', installed: null, ready: false, version_status: 'timeout' }), 'unknown');
  assert.equal(state({ agent: 'copilot', installed: false, ready: false }), 'install');
  const rowStart = ui.indexOf('function cliRow('), rowEnd = ui.indexOf('function renderMaintenance(', rowStart);
  const escapeStart = ui.indexOf('function escapeHtml('), escapeEnd = ui.indexOf('\nfunction showToast(', escapeStart);
  assert(rowStart >= 0 && rowEnd > rowStart && escapeStart >= 0 && escapeEnd > escapeStart, 'Inspect changed dashboard extraction boundaries');
  // The page's own escaping helper, so an escaping regression in the row stays visible.
  const row = vm.runInNewContext(ui.slice(escapeStart, escapeEnd) + ui.slice(rowStart, rowEnd) + ';cliRow', {
    session: { providers: { copilot: { label: 'Copilot <b>', docs: 'https://example.invalid/help?a=1&b=2' } } },
    governorSelect: { value: 'codex' }, updateAttempts: new Map(), isBatchable: () => false,
    miniStatus: String,
  });
  const html = row({ agent: 'copilot', installed: null, update_command: 'must-not-run', status: 'unknown' });
  assert(html.includes('Version unknown'));
  assert(!html.includes('data-maint-action'));
  assert(!html.includes('Not detected'));
  // An unknown route is not maintainable: its command may not reach the page in any form.
  assert(!html.includes('must-not-run'));
  assert(html.includes('Copilot &lt;b&gt;') && !html.includes('<b>') && html.includes('a=1&amp;b=2'));
  // The same fixture IS offered once the installation is established, so the absence above is meaningful.
  const known = row({ agent: 'copilot', installed: true, current: '1.0.85', update_command: 'must-not-run', status: 'update_available' });
  assert(known.includes('data-maint-action="update"') && !known.includes('must-not-run'), 'commands stay server-side even for a maintainable row');
});
console.log(JSON.stringify({ passed: tests.every(t => t.passed), tests }, null, 2));
if (tests.some(t => !t.passed)) process.exitCode = 1;
