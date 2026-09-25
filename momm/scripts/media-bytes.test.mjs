import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readMedia, validateMedia } from './media-bytes.mjs';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from([255,216,255,192,0,8,8,0,1,0,1,1,255,218,0,6,1,1,0,0,1,255,217]);
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'momm-bytes-'));
try {
  assert.equal(validateMedia(png, 'one.png').mime, 'image/png');
  assert.equal(validateMedia(jpeg, 'one.jpeg').modality, 'image');
  for (const [bytes, name] of [[jpeg, 'one.txt'], [png, 'one.jpg'], [png.subarray(0, 35), 'one.png'], [Buffer.from('<html>not an image</html>'), 'one.png'], [Buffer.alloc(0), 'one.png']]) assert.throws(() => validateMedia(bytes, name), /Media refused/);
  fs.writeFileSync(path.join(tmp, 'real.png'), png);
  assert.equal(readMedia(path.join(tmp, 'real.png')).format, 'png');
  const linked = path.join(tmp, 'alias'); fs.symlinkSync(tmp, linked, process.platform === 'win32' ? 'junction' : 'dir');
  // The rule is "no link INSIDE the project tree": a link planted in a reviewed project could point at
  // the user's private files. The machine's own layout ABOVE the project is not the project's doing:
  // macOS reaches every temp folder through /var -> /private/var, and refusing that made every
  // attachment fail there (CI run 35660646922, all four macOS jobs).
  assert.throws(() => readMedia(path.join(linked, 'real.png'), { root: tmp }), /symlink|junction/, 'a link inside the project is refused');
  const project = path.join(tmp, 'outer-real', 'project'); fs.mkdirSync(project, { recursive: true }); fs.writeFileSync(path.join(project, 'shot.png'), png);
  const outerAlias = path.join(tmp, 'outer-alias'); fs.symlinkSync(path.join(tmp, 'outer-real'), outerAlias, process.platform === 'win32' ? 'junction' : 'dir');
  const viaAlias = path.join(outerAlias, 'project');
  assert.equal(readMedia(path.join(viaAlias, 'shot.png'), { root: viaAlias }).format, 'png', 'a link ABOVE the project root is the machine\'s layout, not a refusal');
  assert.equal(readMedia(path.join(viaAlias, 'shot.png'), { root: path.join(tmp, 'somewhere-else') }).format, 'png', 'a file outside the project is judged on itself');
  if (process.platform !== 'win32') { // a file symlink needs privileges on Windows
    fs.symlinkSync(path.join(project, 'shot.png'), path.join(project, 'alias.png'));
    assert.throws(() => readMedia(path.join(project, 'alias.png'), { root: project }), /symlink|junction/, 'a linked FILE is always refused');
    assert.throws(() => readMedia(path.join(project, 'alias.png'), { root: path.join(tmp, 'somewhere-else') }), /symlink|junction/, 'also when it lies outside the project');
  }
  fs.unlinkSync(outerAlias);
  // Independent audit of a5a37b5: a link planted INSIDE the project escaped the check when the project
  // was reached through an alias. Containment was decided on literal paths against a resolved root, so
  // every component of an aliased path looked "outside" and none was inspected. Node's process.cwd()
  // resolves links on POSIX, so the real CLI could be given exactly this shape.
  {
    const realProject = path.join(tmp, 'aliased', 'project'), outsideProject = path.join(tmp, 'aliased', 'outside');
    fs.mkdirSync(realProject, { recursive: true }); fs.mkdirSync(outsideProject, { recursive: true });
    fs.writeFileSync(path.join(outsideProject, 'private.png'), png);
    const planted = path.join(realProject, 'evil');                       // a link inside the project...
    fs.symlinkSync(outsideProject, planted, process.platform === 'win32' ? 'junction' : 'dir');
    const projectAlias = path.join(tmp, 'aliased', 'by-another-name');    // ...and another name for the project
    fs.symlinkSync(realProject, projectAlias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => readMedia(path.join(planted, 'private.png'), { root: realProject }), /symlink|junction/, 'a link inside the project is refused by its own name');
    assert.throws(() => readMedia(path.join(projectAlias, 'evil', 'private.png'), { root: realProject }), /symlink|junction/, 'and through an alias of the project: containment must be decided on real paths');
    assert.throws(() => readMedia(path.join(projectAlias, 'evil', 'private.png'), { root: projectAlias }), /symlink|junction/, 'and when the root is given by its aliased name too');
    // The other name for the project is not itself an escape: an ordinary file under it still reads.
    fs.writeFileSync(path.join(realProject, 'ok.png'), png);
    assert.equal(readMedia(path.join(projectAlias, 'ok.png'), { root: realProject }).format, 'png', 'an alias of the project root is just another name, not a refusal');
  }
  fs.unlinkSync(linked);
  assert.throws(() => validateMedia(jpeg, 'one.txt', { allowText: true }), /Media refused/);
  console.log('PASS: content identification, extension mismatch, truncation, HTML, empty, junction and text-bypass regressions');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

// Range review rev_20260925004814_1ed9f58c2c3a (binary-media-accepted-as-text; codex suggestion 7): an EBML
// (Matroska/WebM) header or an ISO media box type is valid UTF-8 without a NUL byte and was relabelled text.
assert.throws(() => validateMedia(Buffer.from('1a45dfa3', 'hex'), 'input.md', { allowText: true }), undefined, 'EBML magic is never text');
assert.throws(() => validateMedia(Buffer.from('abcdftypisom-text', 'latin1'), 'input.txt', { allowText: true }), undefined, 'an ISO ftyp box type is never text');
assert.equal(validateMedia(Buffer.from('plain notes about ftyp boxes', 'utf8'), 'input.txt', { allowText: true }).modality, 'text', 'the word ftyp elsewhere is ordinary text');
