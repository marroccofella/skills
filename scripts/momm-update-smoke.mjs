#!/usr/bin/env node
// Release gate with the actual signed tag and gitsign, not a mocked verifier.
// Only manifest transport and Git transport are redirected to the local
// release candidate so this can run before its immutable tags are published.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {git, run, treeHash, verifySignature, update, readLock, provenance} from '../momm/scripts/update.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [tag, ...extra] = process.argv.slice(2);
assert(/^momm-\d+\.\d+\.\d+$/.test(tag || '') && !extra.length, 'Usage: node scripts/momm-update-smoke.mjs momm-x.y.z');
assert.equal(git(source, 'status', '--porcelain').trim(), '', 'Release smoke requires a clean committed candidate');
const commit = git(source, 'rev-parse', `${tag}^{commit}`);
assert.equal(commit, git(source, 'rev-parse', 'HEAD'), 'Signed tag must name this exact tested source');
verifySignature(source, tag, 'stable');
const manifest = JSON.parse(git(source, 'show', `${tag}:versions.json`));
const release = manifest.momm_releases.find(r => r.tag === tag);
assert.equal(release?.version, manifest.momm);
assert.equal(release.hash_covers, 'git-tree-blobs-excluding-versions/1');
assert.equal(treeHash(source, tag), release.sha256);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-signed-smoke-'));
try {
  const installed = path.join(fixture, 'installed'), harness = path.join(fixture, 'harness');
  git(fixture, 'clone', '--no-checkout', '--no-hardlinks', source, installed);
  verifySignature(installed, tag, 'stable');
  git(installed, 'checkout', '--detach', tag);
  run(process.execPath, ['install.mjs', '--custom-dir', harness, '--skills', 'momm'], installed);
  const before = readLock(installed), refs = git(installed, 'show-ref');
  const options = {remote: source, manifest: async () => manifest, log: () => {}};
  await update(['--repo', installed, '--version', release.version, '--dry-run'], options);
  assert.deepEqual(readLock(installed), before, 'Preview must not mutate the receipt');
  assert.equal(git(installed, 'show-ref'), refs, 'Preview must not mutate installed refs');
  await update(['--repo', installed, '--version', release.version, '--apply', '--yes', '--accept-protocol'], options);
  const after = readLock(installed);
  assert.equal(after.current.verified, true);
  assert.equal(after.current.commit, commit);
  assert.equal(provenance(installed).release_verified, true);
  assert.deepEqual(after.installations, before.installations);
  assert.equal(fs.realpathSync(path.join(harness, 'momm')), fs.realpathSync(path.join(installed, 'momm')));
  console.log(JSON.stringify({passed: true, version: release.version, commit, genuine_signature_preview_and_apply: true}));
} finally {
  if (path.dirname(fixture) === os.tmpdir() && path.basename(fixture).startsWith('momm-signed-smoke-')) fs.rmSync(fixture, {recursive: true, force: true});
}
