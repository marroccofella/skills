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
  assert.throws(() => readMedia(path.join(linked, 'real.png')), /symlink|junction/);
  fs.unlinkSync(linked);
  assert.throws(() => validateMedia(jpeg, 'one.txt', { allowText: true }), /Media refused/);
  console.log('PASS: content identification, extension mismatch, truncation, HTML, empty, junction and text-bypass regressions');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
