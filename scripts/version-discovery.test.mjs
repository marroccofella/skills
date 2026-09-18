import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'momm/scripts/multi-review.mjs'), 'utf8');
const a = source.indexOf('async function commandVersion('), b = source.indexOf('// Presence-only', a);
const tests = [];
for (const [name, result, installed, versionStatus, expectedVersion] of [
  ['missing', { error: { code: 'ENOENT' } }, false, 'missing'],
  ['timeout', { code: null, timedOut: true, stdout: '' }, null, 'timeout'],
  ['nonzero', { code: 1, stderr: 'private sentinel' }, null, 'error'],
  ['empty success', { code: 0, stdout: '' }, null, 'error'],
  ['valid', { code: 0, stdout: 'Copilot 1.0.85' }, true, 'success'],
  // Gate rev_20260918172020_ehti version-semver-strict: a healthy "v"-prefixed
  // banner must not look like failed discovery; the prefix is never reported.
  ['v-prefixed banner', { code: 0, stdout: 'v1.2.3\n' }, true, 'success', '1.2.3'],
  ['v-prefixed banner after a name', { code: 0, stdout: 'example-cli v0.45.1 (build 7)' }, true, 'success', '0.45.1'],
  ['prerelease is kept', { code: 0, stdout: 'tool 1.0.5-beta.2' }, true, 'success', '1.0.5-beta.2'],
  ['two-part number is not a version', { code: 0, stdout: 'v1.2' }, null, 'error'],
  ['digits glued to a word are not a version', { code: 0, stdout: 'build7.1.2.3x' }, null, 'error'],
]) {
  try {
    const fn = vm.runInNewContext(source.slice(a, b) + ';commandVersion', { runProcess: async () => result, clipped: (s, n) => String(s ?? '').slice(0, n) });
    const actual = await fn('copilot');
    assert.equal(actual.installed, installed);
    assert.equal(actual.version_status, versionStatus);
    if (expectedVersion !== undefined) assert.equal(actual.version, expectedVersion);
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
  const row = vm.runInNewContext(ui.slice(rowStart, rowEnd) + ';cliRow', {
    session: { providers: { copilot: { label: 'Copilot', docs: 'https://example.invalid/help' } } },
    governorSelect: { value: 'codex' }, updateAttempts: new Map(), isBatchable: () => false,
    escapeHtml: String, miniStatus: String,
  });
  const html = row({ agent: 'copilot', installed: null, update_command: 'must-not-run', status: 'unknown' });
  assert(html.includes('Version unknown'));
  assert(!html.includes('data-maint-action'));
  assert(!html.includes('Not detected'));
});
console.log(JSON.stringify({ passed: tests.every(t => t.passed), tests }, null, 2));
if (tests.some(t => !t.passed)) process.exitCode = 1;
