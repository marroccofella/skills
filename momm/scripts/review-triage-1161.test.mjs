// Governor-authored regressions from the triage of review rev_20260922162715_cc7e49c40234.
// Synthetic fixtures only: no provider calls, no network, nothing written outside a temporary
// directory. Each block names the finding it reproduces so a later reader can tell what it guards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { harvest } from './probes.mjs';
import { resolveGit } from './governor.mjs';
import { identifyMedia } from './media-bytes.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
const temp = (name) => fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), name));

// F16. hashFile, directly above harvest, exists so that an unreadable artefact yields null instead
// of an exception that escapes the caller, and harvest's only caller already filters on a string
// hash. harvest itself threw on the first refused path, discarding every other harvested file.
{
  const home = temp('momm-triage-harvest-');
  try {
    const dir = path.join(home, 'out');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'good.png'), PNG);
    fs.writeFileSync(path.join(dir, 'refused.png'), Buffer.from('this is not an image'));
    const files = harvest(path.join(dir, '*.png'), { home });
    assert.equal(files.length, 2, 'every glob match is reported');
    const good = files.find((f) => f.path.endsWith('good.png'));
    const refused = files.find((f) => f.path.endsWith('refused.png'));
    assert.equal(typeof good.sha256, 'string', 'a readable artefact is still hashed when a sibling is refused');
    assert.equal(refused.sha256, null, 'a refused artefact is reported without a hash');
    assert.ok(refused.refused, 'a refused artefact records why it was refused');
  } finally { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 }); }
}

// F17. Range capture on POSIX returned the bare name "git" and let PATH decide, so a PATH entry
// inside the checkout (or a relative one such as ".") could hand the repository under review the
// Git that verifies it. The Windows containment scan now applies on every platform.
{
  const posix = path.posix;
  const present = new Set(['/proj/bin/git', '/usr/bin/git']);
  const files = {
    statSync: (p) => { if (!present.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return { isFile: () => true }; },
    realpathSync: Object.assign((p) => p, { native: (p) => p }),
  };
  const at = (PATH) => resolveGit('/proj', { platform: 'linux', env: { PATH }, fs: files, path: posix });
  assert.equal(at('/proj/bin:/usr/bin'), '/usr/bin/git', 'a Git inside the checkout is skipped for one outside it');
  assert.equal(at('/proj/bin'), null, 'a checkout-supplied Git is never returned');
  assert.equal(at('bin:.'), null, 'relative PATH entries are not searched');
  assert.equal(at(''), null, 'an empty PATH resolves nothing rather than falling back to the bare name');
  // This assertion used to expect '/opt/real/git' here, and in doing so enshrined the defect: a
  // `git` link in a PATH directory INSIDE the project let the project choose any executable outside
  // it, which was then run with Git's arguments. Returning the resolved path (the delta review's
  // suggestion) only stopped the link being followed twice; the independent review of 3d7a8be showed
  // the directory itself has to be refused. The full attack matrix is in executable-resolution.test.mjs.
  {
    const linked = {
      statSync: (q) => { if (q !== '/proj/bin/git') { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return { isFile: () => true }; },
      realpathSync: Object.assign((q) => (q === '/proj/bin/git' ? '/opt/real/git' : q), { native: (q) => q }),
    };
    assert.equal(resolveGit('/proj', { platform: 'linux', env: { PATH: '/proj/bin' }, fs: linked, path: posix }), null,
      'a PATH directory inside the project is refused even when its git resolves outside the project');
  }
}

// F21. An all-ones EBML size means "length not stated". A Segment written that way is legal and is
// what a streaming muxer produces, and it was refused as "unbounded EBML segment", so a perfectly
// valid screen recording could not be attached. Only the Segment may be unknown-sized.
{
  const header = Buffer.concat([
    Buffer.from([0x42, 0x82, 0x84]), Buffer.from('webm'),            // DocType = webm
  ]);
  const ebml = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | header.length]), header]);
  const unknown = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const segment = Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67]), unknown, Buffer.from([1, 2, 3, 4])]);
  assert.equal(identifyMedia(Buffer.concat([ebml, segment])).modality, 'video', 'a Segment of unknown size is accepted');
  assert.equal(identifyMedia(Buffer.concat([ebml, segment])).mime, 'video/webm');
  // Any other element with an unknown size is still refused: the bound has to come from somewhere.
  const elsewhere = Buffer.concat([ebml, Buffer.from([0x1f, 0x43, 0xb6, 0x75]), unknown, Buffer.from([1, 2, 3, 4])]);
  assert.throws(() => identifyMedia(elsewhere), /unbounded EBML element/, 'only the Segment may omit its length');
}


// Independent review of 3d7a8be: a dry run that met an existing MOMM link exited 1 with nothing on
// stderr, and the only readable line in its output was the inventory's "every active path loads
// 1.16.0" with complete: true. Both installers must now say why the exit code is 1, and that the
// inventory describes what is already installed rather than what the command did.
{
  const home = temp('momm-triage-installer-'), other = temp('momm-triage-other-copy-');
  try {
    fs.mkdirSync(path.join(other, 'momm', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(other, 'momm', 'scripts', 'multi-review.mjs'), 'const MOMM_VERSION = "1.16.0";' + String.fromCharCode(10));
    fs.writeFileSync(path.join(other, 'momm', 'SKILL.md'), ['---', 'name: momm', '---', ''].join(String.fromCharCode(10)));
    fs.mkdirSync(path.join(home, '.agents', 'skills'), { recursive: true });
    fs.symlinkSync(path.join(other, 'momm'), path.join(home, '.agents', 'skills', 'momm'), process.platform === 'win32' ? 'junction' : 'dir');
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const env = { ...process.env, HOME: home, USERPROFILE: home, NO_UPDATE_CHECK: '1', MOMM_NO_UPDATE_CHECK: '1' };
    for (const [label, args] of [['skill installer', ['momm/scripts/install.mjs', '--target', 'codex', '--dry-run']], ['repository installer', ['install.mjs', '--skills', 'momm', '--target', 'codex', '--dry-run']]]) {
      const r = spawnSync(process.execPath, args, { cwd: repo, env, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
      assert.equal(r.status, 1, `${label}: a refused link still exits 1`);
      assert.match(r.stderr, /exit code 1: 1 link would be refused because the path already exists/, `${label}: the non-zero exit is explained`);
      assert.doesNotMatch(r.stderr, /stays 0/, `${label}: no line may claim exit 0 when the exit is 1`);
      assert.match(r.stderr, /not the result of this command/, `${label}: the inventory is not presented as the outcome`);
      assert.match(JSON.parse(r.stdout).exit_reason, /would be refused/, `${label}: machine readers get the reason too`);
      assert.ok(fs.lstatSync(path.join(home, '.agents', 'skills', 'momm')).isSymbolicLink(), `${label}: the existing link is untouched`); // a Windows junction reports as a link too
    }
    // Delta review of b0a2dfe (antigravity and grok, independently): an unknown target was reported as
    // "a requested link would be refused" with advice to delete an existing entry that did not exist.
    for (const [label, args] of [['skill installer', ['momm/scripts/install.mjs', '--target', 'no-such-harness', '--dry-run']], ['repository installer', ['install.mjs', '--skills', 'momm', '--target', 'no-such-harness', '--dry-run']]]) {
      const r = spawnSync(process.execPath, args, { cwd: repo, env, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
      assert.equal(r.status, 1, `${label}: an unsupported target still exits 1`);
      assert.match(r.stderr, /1 target is not supported \(no-such-harness\)/, `${label}: an unsupported target is named as such`);
      assert.doesNotMatch(r.stderr, /move or remove|already exists|refused/, `${label}: no advice to delete an entry that does not exist`);
      assert.doesNotMatch(r.stderr, /stays 0/, `${label}: no line may claim exit 0 when the exit is 1`);
      assert.match(JSON.parse(r.stdout).exit_reason, /not supported/, `${label}: machine readers get the real reason`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 });
    fs.rmSync(other, { recursive: true, force: true, maxRetries: 3 });
  }
}

console.log('PASS: triage regressions from rev_20260922162715_cc7e49c40234');
