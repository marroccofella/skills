#!/usr/bin/env node
// Offline trust-boundary tests. Fake signatures are never a live release proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readiness, inspectExisting, trustedEnv, prepare, parse, packageHash, SIGNER, ISSUER, REMOTE, VERIFIER_FLAGS, errorReport, execute } from './bootstrap.mjs';
import { treeHash, SIGNER as UPDATER_SIGNER, ISSUER as UPDATER_ISSUER, REMOTE as UPDATER_REMOTE } from './update.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-bootstrap-tests-'));
const results = {};
async function test(name, fn) { try { await fn(); results[name] = true; } catch(error) { results[name]={failure:error.message};process.exitCode=1; } }
const available = (name) => name === 'gitsign' ? VERIFIER_FLAGS.join(' ') : 'git version fixture';
const missing = () => { throw Object.assign(Error('not installed'), { code: 'ENOENT' }); };
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
const hash = packageHash('.', 'fixture', (cmd, args) => args[0] === 'ls-tree' ? '100644 blob abc\tSKILL.md\0' : Buffer.from('fixture protocol'));
function fixture({ unsigned = false, badSignature = false, badHash = false } = {}) {
  const calls = [], commit = 'a'.repeat(40), object = 'b'.repeat(40);
  const run = (cmd, args, cwd) => {
    calls.push([cmd, ...args]);
    assert(['git', 'gitsign'].includes(cmd), 'no installer or candidate process');
    if (args.includes('--version') || args.includes('--help')) return available(cmd);
    if (args.includes('init')) { fs.mkdirSync(path.join(cwd, '.git'));write(path.join(cwd,'.git/config'),'[core]\nrepositoryformatversion = 0\nbare = false\n'); return ''; }
    if (args[0] === 'for-each-ref') return '';
    if (args[0] === 'fsck') return '';
    if (args.includes('fetch')) { assert(args.includes(REMOTE)); return ''; }
    if (args[0] === 'rev-parse') return args[1].includes('^{commit}') || args[1] === 'HEAD' ? commit : object;
    if (args[0] === 'cat-file' && args[1] === '-t') return unsigned ? 'commit' : 'tag';
    if (cmd === 'gitsign') {
      assert.deepEqual(fs.readdirSync(cwd), ['.git'], 'no candidate files before verification');
      for (const value of [SIGNER, ISSUER, commit, 'momm-1.15.1', 'marroccofella/skills', 'refs/heads/main']) assert(args.includes(value));
      assert.equal(args.at(-1), 'momm-1.15.1', 'gitsign resolves a tag reference, not a raw object ID');
      if (badSignature) throw Error('wrong signing identity');
      return '';
    }
    if (args[0] === 'show') return JSON.stringify({ momm: '1.15.1', momm_releases: [{ version: '1.15.1', tag: 'momm-1.15.1', sha256: badHash ? '0'.repeat(64) : hash, hash_covers: 'git-tree-blobs-excluding-versions/1' }] });
    if (args[0] === 'ls-tree') return '100644 blob abc\tSKILL.md\0';
    if (args[0] === 'cat-file') return Buffer.from('fixture protocol');
    if (args.includes('checkout')) { assert(args.includes('core.eol=lf'),'pin Git checkout line endings, including text=auto on Windows');write(path.join(cwd, 'SKILL.md'), 'fixture protocol'); return ''; }
    if (args[0] === 'status') return '';
    throw Error(`unexpected fixture call ${cmd} ${args.join(' ')}`);
  };
  return { run, calls, releaseRecord: async () => ({ tag_name: 'momm-1.15.1', draft: false, prerelease: false }) };
}
try {
  await test('offline_check_distinguishes_missing_tool_from_signature_failure', () => {
    const r = readiness({ run: missing, platform: 'darwin' });
    assert.equal(r.status, 'prerequisites_missing');
    assert.equal(r.network_used, false); assert.equal(r.signature_verified, false);
    assert.equal(r.tools[1].code, 'gitsign_missing'); assert.match(r.tools[1].next_step, /approval.*brew install gitsign/);
    assert.equal(readiness({ run: available }).status, 'ready_to_verify');
    assert.equal(readiness({ run: () => 'old unsupported help' }).tools[1].status, 'unusable');
  });
  await test('trust_overrides_removed_without_exposing_environment_values', () => {
    const e = trustedEnv({ PATH: 'kept', GITSIGN_REKOR: 'hostile', Sigstore_ROOT: 'hostile', GIT_CONFIG_COUNT: '1', TUF_ROOT: 'hostile' });
    assert.equal(e.PATH, 'kept'); assert(!Object.values(e).includes('hostile')); assert(!('GIT_CONFIG_COUNT' in e));
  });
  await test('every_required_verifier_flag_is_probed', () => {
    assert.equal(readiness({ run: name => name === 'git' ? 'git version fixture' : '--certificate-identity --certificate-oidc-issuer' }).tools[1].status, 'unusable');
  });
  await test('bootstrap_and_recovery_updater_share_trust_identity_without_runtime_coupling', () => {
    assert.equal(SIGNER,UPDATER_SIGNER);assert.equal(ISSUER,UPDATER_ISSUER);assert.equal(REMOTE,UPDATER_REMOTE);
    const workflow=fs.readFileSync(new URL('../../.github/workflows/momm-release.yml',import.meta.url),'utf8');
    assert(workflow.includes('tag -s "$ref" "$GITHUB_SHA"'),'release workflow must tag the commit represented by its signing identity');
  });
  await test('retained_diagnostic_path_survives_long_provider_errors', () => {
    const result=errorReport(Object.assign(Error('x'.repeat(5000)),{diagnostic_directory:root}));
    assert.equal(result.diagnostic_directory,root);assert(result.error.length<=1200);
  });
  await test('real_git_hash_matches_release_updater_and_inspection_does_not_write_index', () => {
    const repo=path.join(root,'real git');fs.mkdirSync(repo);
    const git=(...args)=>execute('git',args,repo).trim();git('-c','init.templateDir=','init','.');
    write(path.join(repo,'versions.json'),'{"momm":"1.10.2"}');write(path.join(repo,'file with spaces.txt'),'line one\nline two\n');
    git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture');
    assert.equal(packageHash(repo,'HEAD'),treeHash(repo,'HEAD'));
    const index=path.join(repo,'.git/index'),before=fs.readFileSync(index),mtime=fs.statSync(index).mtimeMs;
    assert.equal(inspectExisting(repo).route,'legacy_bootstrap');assert.deepEqual(fs.readFileSync(index),before);assert.equal(fs.statSync(index).mtimeMs,mtime);
    assert.equal(trustedEnv({GIT_OPTIONAL_LOCKS:'1'}).GIT_OPTIONAL_LOCKS,'0');
  });
  await test('new_legacy_missing_invalid_and_staging_receipts_have_distinct_routes', () => {
    assert.equal(inspectExisting().route, 'new_install');
    const old = path.join(root, 'old clone with spaces'); fs.mkdirSync(old);
    write(path.join(old, 'versions.json'), JSON.stringify({ momm: '1.10.2' }));
    const run = (cmd, args) => args.includes('--show-toplevel') ? old : args.includes('--git-path') ? '.git/momm' : ' M user-file';
    const before = fs.readdirSync(old);
    assert.equal(inspectExisting(old, run).route, 'legacy_bootstrap');
    assert.equal(inspectExisting(old, run).local_changes, true); assert.deepEqual(fs.readdirSync(old), before);
    write(path.join(old, 'momm/scripts/update.mjs'), '// fixture');
    write(path.join(old, 'versions.json'), JSON.stringify({ momm: '1.15.0' }));
    const lock = path.join(old, '.git/momm/momm.lock');
    write(lock, JSON.stringify({ schema: 'momm-lock/1', installations: [{}] }));
    assert.equal(inspectExisting(old, run).route, 'staging_bootstrap');
    assert.equal(inspectExisting(old, run).receipt, 'present_not_validated');
    write(path.join(old, 'versions.json'), JSON.stringify({ momm: '1.15.1' }));
    assert.equal(inspectExisting(old, run).route, 'updater_preview');
    write(lock, '{}'); assert.equal(inspectExisting(old, run).route, 'receipt_repair');
    write(lock, '{broken'); assert.equal(inspectExisting(old, run).route, 'inspection_required');assert.equal(inspectExisting(old,run).reason_code,'receipt');
  });
  await test('missing_tools_and_existing_destination_stop_before_network_or_mutation', async () => {
    const destination = path.join(root, 'never-created'); let network = false;
    await assert.rejects(prepare({ version: '1.15.1', destination }, { run: missing, releaseRecord: async () => { network = true; } }), { code: 'prerequisites_missing' });
    assert(!fs.existsSync(destination)); assert(!network);
    write(path.join(destination, 'keep.txt'), 'user data');
    await assert.rejects(prepare({ version: '1.15.1', destination }, { ...fixture(), releaseRecord: async () => { network = true; } }), { code: 'destination_conflict' });
    assert.equal(fs.readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'user data'); assert(!network);
  });
  await test('draft_prerelease_and_mismatched_release_are_refused_before_fetch', async () => {
    for (const record of [{ draft: true }, { prerelease: true }, { tag_name: 'momm-9.9.9' }]) {
      const destination = path.join(root, `metadata-${Object.keys(record)[0]}`), f = fixture();
      await assert.rejects(prepare({ version: '1.15.1', destination }, { ...f, releaseRecord: async () => ({ tag_name: 'momm-1.15.1', draft: false, prerelease: false, ...record }) }), { code: 'release_not_stable' });
      assert(!fs.existsSync(destination)); assert(!f.calls.some(c => c.includes('fetch')));
    }
  });
  for (const [name, options, code] of [['unsigned', { unsigned: true }, 'signature_unverified'], ['wrong-identity', { badSignature: true }, 'signature_unverified'], ['hash', { badHash: true }, 'hash_mismatch']]) {
    await test(`${name}_failure_never_checks_out_or_executes_candidate`, async () => {
      const destination = path.join(root, name), f = fixture(options);
      await assert.rejects(prepare({ version: '1.15.1', destination }, f), { code });
      assert.deepEqual(fs.readdirSync(destination), ['.git']); assert(!f.calls.some(c => c.includes('checkout')));
    });
  }
  await test('verified_preparation_is_not_installation_and_never_creates_receipt', async () => {
    const destination = path.join(root, 'verified fixture'), f = fixture();
    const r = await prepare({ version: '1.15.1', destination }, f);
    assert.equal(r.status, 'verified_prepared'); assert.equal(r.installed, false); assert.equal(r.receipt_created, false);
    assert.equal(r.package_sha256, hash); assert(!fs.existsSync(path.join(destination, '.git/momm/momm.lock')));
    assert(f.calls.findIndex(c => c[0] === 'gitsign' && !c.includes('--help')) < f.calls.findIndex(c => c.includes('checkout')));
  });
  await test('no_force_auto_install_or_implicit_version_flags', () => {
    for (const args of [['--apply'], ['--force'], ['--yes'], ['--prepare', '--check'], ['--version', '1.15.1']]) assert.throws(() => parse(args));
    assert.deepEqual(parse([]), {});
  });
  await test('real_cli_without_tools_reports_missing_not_verified', () => {
    const p = spawnSync(process.execPath, [fileURLToPath(new URL('./bootstrap.mjs', import.meta.url)), '--check'], { cwd: root, env: { ...process.env, PATH: '', Path: '' }, encoding: 'utf8', timeout: 20000, windowsHide: true });
    assert.equal(p.status, 2, p.stderr); const r = JSON.parse(p.stdout);
    assert.equal(r.signature_verified, false); assert.equal(r.network_used, false); assert.equal(r.installed, false);
    assert(r.tools.every(t => t.status === 'missing'));
  });
  await test('replacement_refs_cannot_change_the_hash_of_a_pinned_commit',()=>{
    const repo=path.join(root,'replace-ref');fs.mkdirSync(repo);
    const git=(...args)=>execute('git',args,repo).trim();git('-c','init.templateDir=','init','.');
    const commit=value=>{write(path.join(repo,'payload.txt'),value);git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m',value);return git('rev-parse','HEAD');};
    const original=commit('original'),expected=packageHash(repo,original),replacement=commit('replacement');
    git('replace',original,replacement);assert.equal(packageHash(repo,original),expected,'replacement refs must not redirect signed-object reads');
  });
  await test('windows_tool_lookup_ignores_an_executable_in_the_inspected_clone',()=>{
    if(process.platform!=='win32')return;
    const repo=path.join(root,'cwd-tool');fs.mkdirSync(repo);fs.copyFileSync(process.execPath,path.join(repo,'git.exe'));
    assert.match(execute('git',['--version'],repo),/^git version /,'Never execute a same-named binary from the inspected directory');
  });
  await test('readiness_from_home_keeps_explicit_user_scoped_path_tools',()=>{
    if(process.platform!=='win32')return;
    const home=path.join(root,'home-cwd'),bin=path.join(home,'bin');fs.mkdirSync(bin,{recursive:true});fs.copyFileSync(process.execPath,path.join(bin,'git.exe'));
    // A harmless Node executable stands in for a PATH tool. This tests lookup,
    // not Git functionality or verifier authenticity.
    const p=spawnSync(process.execPath,[fileURLToPath(new URL('./bootstrap.mjs',import.meta.url)),'--check'],{cwd:home,env:{...process.env,PATH:bin,Path:bin},encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(JSON.parse(p.stdout).tools.find(t=>t.name==='git').status,'available');
  });
  await test('existing_clone_inspection_disables_local_fsmonitor_execution',()=>{
    const repo=path.join(root,'monitor-check');fs.mkdirSync(repo);const git=(...a)=>execute('git',a,repo);
    git('-c','init.templateDir=','init','.');write(path.join(repo,'versions.json'),'{"momm":"1.10.2"}');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture');
    write(path.join(repo,'.git/fsmonitor-probe'),'#!/bin/sh\n: > monitor-marker\nprintf "\\0"\n');fs.chmodSync(path.join(repo,'.git/fsmonitor-probe'),0o755);fs.appendFileSync(path.join(repo,'.git/config'),'\n[core]\nfsmonitor = .git/fsmonitor-probe\n');
    inspectExisting(repo);assert(!fs.existsSync(path.join(repo,'monitor-marker')),'inspection must not run the local fsmonitor helper');
  });
  console.log(JSON.stringify({ ok: Object.values(results).every(v=>v===true), tests: Object.keys(results).length, results }, null, 2));
} finally {
  const resolved = fs.realpathSync(root), parent = fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(resolved), parent); assert(path.basename(resolved).startsWith('momm-bootstrap-tests-'));
  fs.rmSync(resolved, { recursive: true });
}
