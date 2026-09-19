// Every MOMM script that can start a process must carry the Windows launch guard on its OWN process,
// because a bare command launched without a shell is looked up in the caller's current directory
// first. A child-environment entry does not protect that lookup. Zero provider calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, fn) => { try { fn(); results.push({name, passed: true}); } catch (e) { results.push({name, passed: false, error: e.message}); process.exitCode = 1; } };
const scripts = fs.readdirSync(path.join(root, 'momm/scripts')).filter(n => n.endsWith('.mjs') && !n.endsWith('.test.mjs')).map(n => 'momm/scripts/' + n)
  .concat(['install.mjs', 'multi-llm-review/scripts/install.mjs'].filter(f => fs.existsSync(path.join(root, f))));
check('every process-launching script sets the guard on its own process', () => {
  const missing = [];
  for (const rel of scripts) {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    if (!/from ['\"]node:child_process['\"]|import\(['\"]node:child_process['\"]\)/.test(source)) continue;
    const shared = /^import ['\"]\.\/launch-guard\.mjs['\"];/m.test(source);
    const inline = source.includes('process.env.NoDefaultCurrentDirectoryInExePath = \"1\"');
    if (!shared && !inline) missing.push(rel);
  }
  assert.deepEqual(missing, [], 'scripts that launch processes without the launch guard');
});
check('the shared guard is the first import where it is used', () => {
  for (const rel of scripts) {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    if (!source.includes('./launch-guard.mjs')) continue;
    const first = source.split('\n').find(l => /^import\s/.test(l));
    assert.match(first, /launch-guard\.mjs/, rel + ': launch-guard.mjs must be the first import');
  }
});
check('importing the guard sets the variable on a process that lacks it, and never overrides one that has it', () => {
  const url = pathToFileURL(path.join(root, 'momm/scripts/launch-guard.mjs')).href;
  const code = `await import(${JSON.stringify(url)}); process.stdout.write(String(process.env.NoDefaultCurrentDirectoryInExePath));`;
  const strip = {...process.env}; for (const k of Object.keys(strip)) if (k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete strip[k];
  const bare = spawnSync(process.execPath, ['--input-type=module', '-e', code], {env: strip, encoding: 'utf8', windowsHide: true});
  assert.equal(bare.status, 0, bare.stderr);
  assert.equal(bare.stdout, process.platform === 'win32' ? '1' : 'undefined');
  const kept = spawnSync(process.execPath, ['--input-type=module', '-e', code], {env: {...strip, NoDefaultCurrentDirectoryInExePath: 'owner-set'}, encoding: 'utf8', windowsHide: true});
  assert.equal(kept.stdout, 'owner-set');
});
console.log(JSON.stringify({passed: results.every(r => r.passed), results}, null, 2));
