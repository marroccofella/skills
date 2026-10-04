// MOMM 1.17.1 R1: a CLI/model compatibility failure is remembered per machine and shown at the next
// preflight and dispatch, before any allowance is spent. Zero providers: every home is a synthetic
// folder in the temp dir, every CLI answer is a fake runProcess, and no process is started.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as registry from './capabilities.mjs';
import { UPDATE_COMMANDS } from './update-clock.mjs';
let memory = {}; try { memory = await import('./compatibility.mjs'); } catch { /* absent before R1: every check below then fails by name */ }
const need = (name) => { assert.equal(typeof memory[name], 'function', `compatibility.mjs must export ${name}`); return memory[name]; };
const source = fs.readFileSync(new URL('./multi-review.mjs', import.meta.url), 'utf8');
const between = (text, first, last) => { const a = text.indexOf(first), b = text.indexOf(last, a); assert(a >= 0 && b > a, `source boundaries moved: ${first}`); return text.slice(a, b); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-compatibility-test-'));
const checks = []; let sequence = 0;
async function test(name, fn) { try { await fn(); checks.push({ name, passed: true }); } catch (e) { checks.push({ name, passed: false, error: e.message }); } }
const plain = (v) => JSON.parse(JSON.stringify(v));
// A synthetic home with a Codex configuration; the real home and CODEX_HOME are never read.
function home(model = 'gpt-test-9') {
  const dir = path.join(root, `home-${++sequence}`); fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
  if (model !== null) fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), `model = "${model}"\nmodel_reasoning_effort = "high"\n`);
  return dir;
}
const setModel = (dir, model) => fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), `model = "${model}"\n`);
const tree = (dir) => fs.readdirSync(dir).sort().map((name) => { const file = path.join(dir, name), stat = fs.statSync(file); return { name, size: stat.size, mtimeMs: stat.mtimeMs, bytes: stat.isFile() ? fs.readFileSync(file, 'hex') : null }; });
// The two details the dispatcher gives this class today, taken from the classifier itself.
const classify = vm.runInNewContext(between(source, 'function classifyFailure(', 'async function invokeReviewer(') + ';classifyFailure', {
  stripAnsi: (s) => String(s ?? ''), clipped: (s, n) => String(s ?? '').slice(0, n), clippedTail: (s, n) => String(s ?? '').trim().slice(-n),
});
const codexGap = { agent: 'codex', ...classify({ code: 1, stdout: '', stderr: 'error: The model is not supported when using Codex with a ChatGPT account.' }, 'codex') };
const failed = (model = 'gpt-test-9') => ({ ...codexGap, route_settings: { model, model_from: 'user_config' } });
const settle = (dir, results, versions, extra = {}) => need('settleCompatibility')({ home: dir, results, versions, governor: 'claude', ...extra });
const known = (dir, cliVersion, extra = {}) => need('knownIncompatibility')({ home: dir, env: {}, route: 'codex', cliVersion, ...extra });
try {
  await test('the record lives beside the capability overlay, named for this machine', () => {
    assert.equal(need('machineId')(), registry.machineId(), 'one machine identity for every per-machine file');
    const dir = home();
    assert.equal(need('compatibilityPath')(dir), path.join(dir, '.momm', `compatibility-${registry.machineId()}.json`));
    assert.equal(path.dirname(need('compatibilityPath')(dir)), path.dirname(registry.overlayPath(dir)));
  });
  await test('both compatibility details the dispatcher gives are recognised; other failures are not', () => {
    const generic = classify({ code: 1, stdout: '', stderr: 'failed to load models cache: missing field supports_parallel_tool_calls' }, 'grok');
    for (const failure of [codexGap, generic]) { assert.equal(failure.status, 'error'); assert.equal(need('isCompatibilityFailure')(failure), true, failure.detail.slice(0, 60)); }
    // The stored detail is redacted and clipped on its way to the report; the class must survive that.
    assert.equal(need('isCompatibilityFailure')({ status: 'error', detail: codexGap.detail.slice(0, 1200) }), true);
    for (const other of [classify({ code: 1, stdout: '', stderr: 'Please sign in to continue' }), classify({ code: 1, stdout: '', stderr: 'HTTP 429 Too Many Requests' }), classify({ timedOut: true }),
      { status: 'error', detail: 'exit 1' }, { status: 'success' }, { status: 'invalid_output', detail: 'CLI/model compatibility error: quoted by a reviewer' }, null]) assert.equal(need('isCompatibilityFailure')(other), false, JSON.stringify(other));
  });
  await test('a compatibility failure is remembered with route, CLI version, configured model and time', () => {
    const dir = home(), at = new Date('2026-10-03T14:02:11.000Z');
    const outcome = settle(dir, [failed()], { codex: '0.157.1' }, { now: at });
    assert.deepEqual(plain(outcome), { recorded: ['codex'], cleared: [], error: null });
    const file = need('compatibilityPath')(dir), doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(doc.schema, 'momm-compatibility/1'); assert.equal(doc.machine_id, registry.machineId());
    assert.deepEqual(doc.entries, [{ route: 'codex', cli_version: '0.157.1', model: 'gpt-test-9', at: '2026-10-03T14:02:11.000Z', machine_id: registry.machineId() }]);
    // Nothing but those fields: no detail, no provider text, no project path, no run id.
    assert.ok(!fs.readFileSync(file, 'utf8').includes('ChatGPT'));
    assert.deepEqual(fs.readdirSync(path.dirname(file)), [path.basename(file)], 'no lock or temporary file is left');
    if (process.platform !== 'win32') { assert.equal(fs.statSync(file).mode & 0o777, 0o600); assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700); }
  });
  await test('the next check says what failed, when, and the official update command', () => {
    const dir = home(); settle(dir, [failed()], { codex: '0.157.1' }, { now: new Date('2026-10-03T14:02:11.000Z') });
    const found = known(dir, '0.157.1');
    assert.ok(found, 'same CLI version and model: known');
    assert.deepEqual(plain({ route: found.route, cli_version: found.cli_version, model: found.model, at: found.at, update_command: found.update_command }),
      { route: 'codex', cli_version: '0.157.1', model: 'gpt-test-9', at: '2026-10-03T14:02:11.000Z', update_command: UPDATE_COMMANDS.codex });
    for (const part of ['codex', '0.157.1', 'gpt-test-9', '2026-10-03', 'CLI/model compatibility error', UPDATE_COMMANDS.codex]) assert.ok(found.notice.includes(part), `the notice names ${part}: ${found.notice}`);
    assert.match(found.notice, /MOMM changes no CLI setting/);
    assert.ok(!found.notice.includes(dir) && !/config\.toml/.test(found.notice), 'no path in the notice');
  });
  await test('the run that first sees the failure says it was remembered, with the update command', () => {
    const said = need('rememberedNotice')('codex');
    for (const part of ['codex', 'remembered', '--preflight', UPDATE_COMMANDS.codex]) assert.ok(said.includes(part), `${part}: ${said}`);
    assert.match(need('rememberedNotice')('no-such-route'), /provider's official command/);
  });
  await test('the record stops applying when the CLI version changes', () => {
    const dir = home(); settle(dir, [failed()], { codex: '0.157.1' });
    assert.ok(known(dir, '0.157.1')); assert.equal(known(dir, '0.158.0'), null); assert.equal(known(dir, null), null, 'an unread version confirms nothing');
  });
  await test('the record stops applying when the configured model changes', () => {
    const dir = home(); settle(dir, [failed()], { codex: '0.157.1' });
    assert.ok(known(dir, '0.157.1'));
    setModel(dir, 'gpt-test-10'); assert.equal(known(dir, '0.157.1'), null);
    fs.rmSync(path.join(dir, '.codex', 'config.toml')); assert.equal(known(dir, '0.157.1'), null, 'no configured model is a different model');
  });
  await test('a later success clears the record, and only that route\'s', () => {
    const dir = home();
    settle(dir, [failed(), { agent: 'grok', status: 'error', detail: 'CLI/model compatibility error: check the installed CLI version' }], { codex: '0.157.1', grok: '1.0.41' });
    assert.ok(known(dir, '0.157.1'));
    // A route MOMM reads no model for is bound to its CLI version alone, and its notice says so.
    const grok = need('knownIncompatibility')({ home: dir, env: {}, route: 'grok', cliVersion: '1.0.41' });
    assert.equal(grok.model, null); assert.match(grok.notice, /The CLI version has not changed/); assert.ok(grok.notice.includes(UPDATE_COMMANDS.grok) && !/configured model/.test(grok.notice), grok.notice);
    const outcome = settle(dir, [{ agent: 'codex', status: 'success', route_settings: { model: 'gpt-test-9' } }], { codex: '0.157.1' });
    assert.deepEqual(plain(outcome), { recorded: [], cleared: ['codex'], error: null });
    assert.equal(known(dir, '0.157.1'), null);
    assert.ok(need('knownIncompatibility')({ home: dir, env: {}, route: 'grok', cliVersion: '1.0.41' }), 'grok is untouched');
    assert.deepEqual(need('readCompatibility')(dir).entries.map((e) => e.route), ['grok']);
  });
  await test('another failure keeps the record while version and model stand, and drops it once either changed', () => {
    const dir = home(); settle(dir, [failed()], { codex: '0.157.1' }, { now: new Date('2026-10-03T14:02:11.000Z') });
    const timeout = { agent: 'codex', status: 'timeout', route_settings: { model: 'gpt-test-9' } };
    assert.deepEqual(plain(settle(dir, [timeout], { codex: '0.157.1' })), { recorded: [], cleared: [], error: null });
    assert.equal(known(dir, '0.157.1').at, '2026-10-03T14:02:11.000Z');
    assert.deepEqual(plain(settle(dir, [timeout], { codex: null })), { recorded: [], cleared: [], error: null }, 'an unread version is not a changed version');
    assert.deepEqual(plain(settle(dir, [timeout], { codex: '0.158.0' })), { recorded: [], cleared: ['codex'], error: null });
    assert.deepEqual(need('readCompatibility')(dir).entries, []);
    settle(dir, [failed()], { codex: '0.158.0' });
    assert.deepEqual(plain(settle(dir, [{ ...timeout, route_settings: { model: 'gpt-test-10' } }], { codex: '0.158.0' })), { recorded: [], cleared: ['codex'], error: null });
  });
  await test('split runs: one reviewed piece clears, every piece failing records once', () => {
    const dir = home();
    assert.deepEqual(plain(settle(dir, [failed(), failed(), failed()], { codex: '0.157.1' })).recorded, ['codex']);
    assert.equal(need('readCompatibility')(dir).entries.length, 1);
    assert.deepEqual(plain(settle(dir, [failed(), { agent: 'codex', status: 'success' }], { codex: '0.157.1' })).cleared, ['codex']);
  });
  await test('the governor, excluded and undispatched rows, and an unread version record nothing', () => {
    const dir = home();
    const outcome = need('settleCompatibility')({ home: dir, governor: 'codex', versions: { codex: '0.157.1', grok: null },
      results: [failed(), { agent: 'claude', status: 'self_excluded' }, { agent: 'copilot', status: 'not_dispatched' }, { agent: 'grok', status: 'error', detail: codexGap.detail }] });
    assert.deepEqual(plain(outcome), { recorded: [], cleared: [], error: null });
    assert.equal(fs.existsSync(path.join(dir, '.momm')), false, 'nothing to remember: nothing is created');
  });
  await test('the Codex configuration is read, never written, locked or touched', () => {
    const dir = home(), codex = path.join(dir, '.codex'), before = tree(codex);
    settle(dir, [failed()], { codex: '0.157.1' }); known(dir, '0.157.1'); known(dir, '0.158.0');
    settle(dir, [{ agent: 'codex', status: 'success' }], { codex: '0.157.1' });
    assert.deepEqual(tree(codex), before, 'bytes, size, time and file list unchanged');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['.codex', '.momm'], 'MOMM writes only its own folder');
  });
  await test('the module starts no process and makes no request', () => {
    const text = fs.readFileSync(new URL('./compatibility.mjs', import.meta.url), 'utf8');
    for (const banned of ['child_process', 'spawn(', 'fetch(', 'node:http', 'node:net']) assert.ok(!text.includes(banned), `compatibility.mjs must not use ${banned}`);
  });
  await test('a damaged or hand-edited record is never shown and never breaks a check', () => {
    const dir = home(), file = need('compatibilityPath')(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"schema":"momm-compatibility/1","entries":[');
    assert.equal(known(dir, '0.157.1'), null); assert.deepEqual(need('readCompatibility')(dir).entries, []);
    const escape = String.fromCharCode(27);
    const entry = (extra) => ({ route: 'codex', cli_version: '0.157.1', model: 'gpt-test-9', at: '2026-10-03T14:02:11.000Z', machine_id: registry.machineId(), ...extra });
    for (const bad of [entry({ model: `gpt${escape}[31m` }), entry({ model: 'two words' }), entry({ cli_version: `0.157.1${escape}]0;x` }), entry({ at: 'yesterday' }), entry({ route: 'codex; rm' }), entry({ machine_id: 'another-machine' }), 'text', null]) {
      fs.writeFileSync(file, JSON.stringify({ schema: 'momm-compatibility/1', entries: [bad] }));
      assert.equal(known(dir, '0.157.1'), null, JSON.stringify(bad));
    }
    // The next recorded failure replaces the damaged file with a valid one.
    fs.writeFileSync(file, 'not json');
    assert.deepEqual(plain(settle(dir, [failed()], { codex: '0.157.1' })), { recorded: ['codex'], cleared: [], error: null });
    assert.ok(known(dir, '0.157.1'));
  });
  await test('a held lock is never stolen: the update is refused and reported', () => {
    const dir = home(), file = need('compatibilityPath')(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.lock`, '999999\n');
    const outcome = settle(dir, [failed()], { codex: '0.157.1' }, { lockTimeoutMs: 60 });
    assert.deepEqual(plain(outcome.recorded), []); assert.match(outcome.error, /lock/i);
    assert.ok(!outcome.error.includes(dir), 'the report carries no home path');
    assert.equal(fs.readFileSync(`${file}.lock`, 'utf8'), '999999\n', 'the lock is left exactly as found');
    assert.equal(fs.existsSync(file), false);
  });
  await test('a record that is a link is neither followed nor replaced', () => {
    const dir = home(), file = need('compatibilityPath')(dir), elsewhere = path.join(dir, 'elsewhere.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(elsewhere, JSON.stringify({ schema: 'momm-compatibility/1', entries: [{ route: 'codex', cli_version: '0.157.1', model: 'gpt-test-9', at: '2026-10-03T14:02:11.000Z', machine_id: registry.machineId() }] }));
    try { fs.symlinkSync(elsewhere, file); } catch { return; /* links need a privilege this account lacks (Windows without developer mode) */ }
    const before = fs.readFileSync(elsewhere, 'utf8');
    assert.equal(known(dir, '0.157.1'), null);
    const outcome = settle(dir, [failed()], { codex: '0.157.1' });
    assert.deepEqual(plain(outcome.recorded), []); assert.ok(outcome.error);
    assert.equal(fs.readFileSync(elsewhere, 'utf8'), before); assert.ok(fs.lstatSync(file).isSymbolicLink());
  });
  // ---- preflight ----
  function preflight(dir, version) {
    const calls = [];
    const context = { fs, os: { homedir: () => dir }, path, INSTALL_HINTS: {}, LOGIN_HINTS: { codex: 'codex login' }, ADAPTER_MEDIA: { codex: ['image'] }, MODALITY_SUPPORT: { codex: { text: 'stdin', image: '-i' } },
      antigravityCommand: () => 'agy', grokCommand: () => 'grok',
      runProcess: async (command, args) => { calls.push([command, ...args]); return args[0] === '--version' ? { code: 0, stdout: `codex-cli ${version}\n`, stderr: '' } : { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' }; },
      // The real function, pointed at the synthetic home.
      knownIncompatibility: (args) => need('knownIncompatibility')({ ...args, home: dir, env: {} }) };
    const check = vm.runInNewContext(between(source, 'async function commandVersion(', 'const ANSI =') + ';preflightCheck', context);
    return check(['codex'], 'claude').then((entries) => ({ entry: plain(entries[0]), calls }));
  }
  await test('preflight marks the route not ready with the reason, and makes no model call', async () => {
    const dir = home(); settle(dir, [failed()], { codex: '0.157.1' }, { now: new Date('2026-10-03T14:02:11.000Z') });
    const { entry, calls } = await preflight(dir, '0.157.1');
    assert.equal(entry.installed, true); assert.equal(entry.auth, 'ok');
    assert.equal(entry.ready, false, 'a known mismatch is not ready');
    assert.deepEqual({ cli_version: entry.compatibility.cli_version, model: entry.compatibility.model, at: entry.compatibility.at }, { cli_version: '0.157.1', model: 'gpt-test-9', at: '2026-10-03T14:02:11.000Z' });
    assert.equal(entry.update_hint, UPDATE_COMMANDS.codex);
    assert.equal(entry.note, entry.compatibility.notice); assert.match(entry.note, /CLI\/model compatibility error/);
    assert.equal(entry.login_hint, undefined, 'a mismatch is never answered with a login');
    assert.deepEqual(calls, [['codex', '--version'], ['codex', 'login', 'status']], 'version and login status only');
  });
  await test('preflight is ready again after a CLI update, a model change, or a success', async () => {
    const dir = home(); settle(dir, [failed()], { codex: '0.157.1' });
    assert.equal((await preflight(dir, '0.157.1')).entry.ready, false);
    const updated = (await preflight(dir, '0.158.0')).entry;
    assert.equal(updated.ready, true); assert.ok(!('compatibility' in updated) && !('update_hint' in updated) && !('note' in updated));
    setModel(dir, 'gpt-test-10'); assert.equal((await preflight(dir, '0.157.1')).entry.ready, true);
    setModel(dir, 'gpt-test-9'); assert.equal((await preflight(dir, '0.157.1')).entry.ready, false, 'the same pair is still the pair that failed');
    settle(dir, [{ agent: 'codex', status: 'success' }], { codex: '0.157.1' });
    assert.equal((await preflight(dir, '0.157.1')).entry.ready, true);
  });
  await test('a machine with no record gets the same preflight as before', async () => {
    const { entry } = await preflight(home(), '0.157.1');
    assert.deepEqual(entry, { agent: 'codex', installed: true, version: '0.157.1', ready: true, auth: 'ok', modalities: ['text', 'image'] });
  });
  // ---- wiring in the dispatcher ----
  const mainBody = source.slice(source.indexOf('async function main()'));
  await test('--preflight prints the notice on stderr and the update command in its row', () => {
    const block = between(mainBody, 'if (options.preflight) {', 'const currentDepth =');
    assert.match(block, /momm compatibility: \$\{e\.compatibility\.notice\}/);
    assert.match(block, /e\.update_hint/);
  });
  await test('dispatch says it before any route is asked, in the report too, and settles the record afterwards', () => {
    const notice = mainBody.indexOf('event: "compatibility.notice"'), scheduler = mainBody.indexOf('createScheduler('), settled = mainBody.indexOf('settleCompatibility('), report = mainBody.indexOf('const report = {');
    assert.ok(notice > 0 && scheduler > notice, 'the notice comes before the scheduler exists');
    assert.ok(settled > scheduler && report > settled, 'the record is settled after dispatch and before the report');
    assert.match(mainBody.slice(notice - 600, scheduler), /momm compatibility: /);
    assert.match(between(mainBody, 'const report = {', '  // Durable evidence, persisted BEFORE'), /notices: runNotices/);
    // Every piece result of a split run is settled, not the merged row (which hides a reviewed piece).
    assert.match(mainBody.slice(settled, settled + 400), /pieceResults \? pieceResults\.flatMap\(\(piece\) => piece\.results\) : results/);
  });
  await test('the live display names the mismatch and the update command, not a login', () => {
    const ui = between(source, 'function createUi(', 'function doctorVersions(');
    const make = vm.runInNewContext(`${ui};createUi`, { process: { env: { NO_COLOR: '1' }, on() {} }, ANSI: { reset: '', bold: '', dim: '', red: '', green: '', yellow: '', cyan: '', magenta: '' }, SPINNER_FRAMES: ['-'], LOGIN_HINTS: { codex: 'codex login' }, setInterval: () => ({ unref() {} }), clearInterval() {}, Date });
    let painted = ''; const display = make(true, { write: (text) => { painted += text; }, columns: 400 });
    display.preflight([{ agent: 'codex', installed: true, ready: false, auth: 'ok', update_hint: UPDATE_COMMANDS.codex, compatibility: { cli_version: '0.157.1', model: 'gpt-test-9', at: '2026-10-03T14:02:11.000Z', notice: 'n' } }]);
    display.start('claude', ['codex'], 1); display.stop();
    assert.match(painted, /codex\s+CLI\/model compatibility error on 2026-10-03/); assert.ok(painted.includes(UPDATE_COMMANDS.codex));
    assert.ok(!painted.includes('auth ok') && !painted.includes('codex login'));
  });
  // ---- Setup Center: a mismatch is not a sign-in ----
  await test('the Setup Center never answers a remembered mismatch with "Sign in"', () => {
    const app = fs.readFileSync(new URL('../assets/setup-ui/app.js', import.meta.url), 'utf8');
    const state = vm.runInNewContext(between(app, 'function routeState(', 'function stateLabel(') + ';routeState', { liveResults: new Map() });
    const route = { agent: 'codex', installed: true, ready: false, auth: 'ok', version: '0.157.1', note: 'reason', compatibility: { cli_version: '0.157.1' } };
    assert.equal(state(route), 'update', 'its own state: never Sign in, and not an inconclusive check');
    const copy = vm.runInNewContext(between(app, 'function routeCopy(', 'function providerMaintenance(') + ';routeCopy', { liveResults: new Map() });
    assert.match(copy(route, state(route)), /The installed CLI \(0\.157\.1\) needs an update to work with its configured model\./, 'the card says what to do; setup-maintenance.test.mjs covers the command and the action');
    assert.doesNotMatch(copy(route, state(route)), /sign[\s-]?in/i);
    assert.equal(state({ agent: 'codex', installed: true, ready: false, auth: 'absent' }), 'login', 'a signed-out route still reads Sign in');
    const setup = fs.readFileSync(new URL('./setup-ui.mjs', import.meta.url), 'utf8');
    const models = between(setup, 'async function modelStatus(', '\n}\n');
    assert.match(models, /route\.compatibility \? "update_required" : "login_required"/);
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ node: process.version, passed: checks.filter((c) => c.passed).length, total: checks.length, checks }, null, 2));
process.exitCode = checks.every((c) => c.passed) ? 0 : 1;
