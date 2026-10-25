const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packet-manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
let checked = 0;
const published = new Map();
for (const entry of manifest.files) {
  if (!/^(source\/|original-source-hashes\.json$)/.test(entry.path) || entry.path.includes('..')) {
    throw new Error('Invalid manifest path');
  }
  const file = path.resolve(root, entry.path);
  if (!file.startsWith(root + path.sep)) throw new Error('Path escaped packet');
  const bytes = fs.readFileSync(file);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== entry.sha256) throw new Error(`Hash mismatch: ${entry.path}`);
  if (published.has(entry.path)) throw new Error('Duplicate manifest path');
  published.set(entry.path, hash);
  if (/\.(js|cjs)$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`Syntax check failed: ${entry.path}`);
  }
  checked++;
}
const originals = JSON.parse(fs.readFileSync(path.join(root, 'original-source-hashes.json'), 'utf8').replace(/^\uFEFF/, ''));
const sanitized = new Set(['scripts/export-distribution.ps1', 'scripts/install-dom-tts.ps1']);
for (const entry of originals) {
  const hash = published.get('source/' + entry.path);
  if (!hash) throw new Error(`Missing original source: ${entry.path}`);
  if (!sanitized.has(entry.path) && hash !== entry.originalSha256) throw new Error(`Undocumented source change: ${entry.path}`);
}
const settings = JSON.parse(fs.readFileSync(path.join(root, 'source/assets/settings.json'), 'utf8'));
for (const key of ['watchCodex', 'watchOpenClaw', 'watchAgentLab', 'speakStartup']) {
  if (settings[key] !== false) throw new Error('Unsafe review default');
}
console.log(JSON.stringify({ status: 'PASS', checked, scope: 'hashes and syntax only; no runtime or audio claim' }));
