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
  fs.unlinkSync(linked);
  assert.throws(() => validateMedia(jpeg, 'one.txt', { allowText: true }), /Media refused/);
  console.log('PASS: content identification, extension mismatch, truncation, HTML, empty, junction and text-bypass regressions');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
