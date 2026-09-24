// Every tracked text source is reviewable text. A raw control byte (other than tab, LF, CR) makes Git
// treat the file as binary: it cannot be diffed, MOMM's own --range refuses it, and no reviewer can
// read it. Found on the 1.16.1 branch: a tool expanded a regex escape into raw NUL/0x1F/0x7F bytes in
// momm/scripts/installations.mjs and nothing noticed until a real committed-range review was tried.
// Zero provider calls, zero network.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The two checks assess different contents on purpose: control bytes are checked in the WORKING
// TREE, because that is what a contributor is about to commit, while binary classification is
// asked of Git at HEAD, because that is what a reviewer and --range will actually be handed.
// Both digests quoted anywhere in this repository are SHA-256.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0;
if (!gitAvailable) {
  console.error('source-hygiene: git is not on PATH, so neither the repository listing nor the binary-classification check can run.');
  process.exit(1);
}
const results = [];
const check = (name, fn) => { try { fn(); results.push({ name, passed: true }); } catch (e) { results.push({ name, passed: false, error: String(e.message).slice(0, 1200) }); process.exitCode = 1; } };
const TEXT = /\.(?:mjs|cjs|js|json|md|yml|yaml|html|css|txt|svg|vtt|csv|xml|sha256)$/i;
const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64_000_000 });
const files = listed.status === 0 ? listed.stdout.split('\0').filter(f => f && TEXT.test(f)) : [];

check('the repository listing is available', () => assert(files.length > 50, 'git ls-files returned too little: ' + (listed.stderr || files.length)));
check('no tracked text source contains a raw control byte', () => {
  const bad = [];
  for (const rel of files) {
    let bytes; try { bytes = fs.readFileSync(path.join(root, rel)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; } // only a working-tree deletion may be absent
    for (let i = 0; i < bytes.length; i++) { const c = bytes[i]; if (c < 9 || c === 11 || c === 12 || (c > 13 && c < 32) || c === 127) { bad.push(`${rel} offset ${i} byte 0x${c.toString(16).padStart(2, '0')}`); break; } }
  }
  assert.deepEqual(bad, [], 'write the character with String.fromCharCode or an escape that survives your tools');
});
check('Git agrees: no tracked text source is classified as binary', () => {
  // numstat prints "-\t-\t<path>" for a file Git considers binary, against the empty tree.
  const empty = spawnSync('git', ['hash-object', '-t', 'tree', '--stdin'], { cwd: root, input: '', encoding: 'utf8', windowsHide: true }).stdout.trim();
  const stat = spawnSync('git', ['diff', '--numstat', '-z', empty, 'HEAD', '--'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64_000_000 });
  assert.equal(stat.status, 0, stat.stderr);
  const binary = stat.stdout.split('\0').filter(row => row.startsWith('-\t-\t')).map(row => row.slice(4)).filter(f => TEXT.test(f));
  assert.deepEqual(binary, []);
});
console.log(JSON.stringify({ passed: results.every(r => r.passed), files: files.length, results }, null, 2));
