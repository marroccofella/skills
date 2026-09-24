// Governor-authored regressions from the triage of review rev_20260922162715_cc7e49c40234.
// Synthetic fixtures only: no provider calls, no network, nothing written outside a temporary
// directory. Each block names the finding it reproduces so a later reader can tell what it guards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
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
  // Delta review of 99d612f..99db87d, antigravity: the check ran on the RESOLVED path while the
  // unresolved candidate was returned. A repo-internal PATH entry holding a link that currently
  // points outward passes the check, and spawning the candidate would follow that link again at
  // exec time, when it need no longer point outward. Return the path that was actually checked.
  {
    const linked = {
      statSync: (q) => { if (q !== '/proj/bin/git') { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return { isFile: () => true }; },
      realpathSync: Object.assign((q) => (q === '/proj/bin/git' ? '/opt/real/git' : q), { native: (q) => q }),
    };
    assert.equal(resolveGit('/proj', { platform: 'linux', env: { PATH: '/proj/bin' }, fs: linked, path: posix }), '/opt/real/git',
      'the resolved path is returned, never the in-project name that was resolved through');
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

console.log('PASS: triage regressions from rev_20260922162715_cc7e49c40234');
