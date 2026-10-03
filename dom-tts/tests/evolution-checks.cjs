const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyMode } = require('../scripts/summarize');
const { prepare } = require('../scripts/speak');
const watcher = require('../scripts/watch-codex');
const runtime = require('../scripts/runtime');
const native = require('../scripts/providers/native');
const { recoverStale, inspectLock } = require('../scripts/lock');

function run(check = fn => fn()) {
  const tests = [
    ['terminal failure survives progress', () => {
      const input = ['FAILED: synthetic build failure.', ...Array.from({ length: 7 }, (_, i) => `Progress ${i + 1}.`)];
      assert.match(applyMode(input.join('\n'), 'terminal-summary'), /FAILED: synthetic build failure/);
    }],
    ['failures take priority over warnings', () => {
      assert.match(applyMode('Warning: one.\nWarning: two.\nWarning: three.\nFatal: database unavailable.', 'terminal-summary'), /^Fatal:/);
    }],
    ['saved inclusion options work', () => {
      const saved = { includeCodeBlocks: true, includeCommandBlocks: true };
      assert.match(prepare({ text: '```js\nprivateCode();\n```\nnpm test' }, { settings: saved }).chunks.join(' '), /private Code/);
      assert.match(prepare({ text: 'npm test' }, { settings: saved }).chunks.join(' '), /npm test/);
      assert.equal(prepare({ text: 'npm test', includeCommandBlocks: false }, { settings: saved }).chunks.length, 0);
    }],
    ['watcher preserves settings precedence', () => {
      assert.equal(watcher.parseArgs([]).profile, undefined);
      const args = watcher.speechArgs({ includeCodeBlocks: false });
      assert(!args.includes('--profile'));
      assert(args.includes('--includeCodeBlocks'));
      assert(args.includes('false'));
    }],
    ['git status lists retain files', () => {
      assert.match(applyMode(' M src/app.js\nA  tests/app.js\nError: failed.', 'diff-summary'), /Files touched: src\/app.js, tests\/app.js/);
      assert.match(applyMode('Git is useful.', 'diff-summary'), /Git is useful/);
    }],
    ['persistent markers cannot skip a fresh ACL check', () => {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dte-')));
      try {
        runtime.verifiedDirs.clear();
        runtime.ensurePrivate(dir, { platform: 'win32', run: () => ({ status: 0 }) });
        runtime.verifiedDirs.clear();
        assert.throws(() => runtime.ensurePrivate(dir, { platform: 'win32', run: () => ({ status: 3, stderr: 'DOM_TTS_NOT_PRIVATE' }) }), /grants access/);
      } finally { runtime.verifiedDirs.clear(); fs.rmSync(dir, { recursive: true, force: true }); }
    }],
    ['POSIX permission changes are rechecked', () => {
      if (process.platform === 'win32') return;
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dte-')));
      try {
        runtime.ensurePrivate(dir);
        fs.chmodSync(dir, 0o755);
        assert.throws(() => runtime.ensurePrivate(dir), /owner-only/);
      } finally { runtime.verifiedDirs.clear(); fs.rmSync(dir, { recursive: true, force: true }); }
    }],
    ['policy failure is actionable without bypass', () => {
      const modulePath = require.resolve('../scripts/providers/native');
      const childCode = "console.error('File cannot be loaded because running scripts is disabled. PSSecurityException');process.exit(1)";
      const probe = `require(${JSON.stringify(modulePath)}).runChild({file:process.execPath,args:['-e',${JSON.stringify(childCode)}]},'',{stopped:()=>false,setChild:()=>{}},()=>{}).catch(e=>console.log(e.message))`;
      const result = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /execution policy/);
      assert(!native.commandFor('sapi', {}, 'input.json').args.includes('-ExecutionPolicy'));
    }],
    ['recovery owns shared-state cleanup', () => {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dte-')));
      const original = fs.readdirSync;
      try {
        fs.writeFileSync(path.join(dir, 'playback.lock'), JSON.stringify({ pid: 123456, token: 'a'.repeat(32) }));
        let owned = false;
        fs.readdirSync = function (target, ...args) {
          if (target === dir) owned = inspectLock(dir).state === 'live';
          return original.call(this, target, ...args);
        };
        assert(recoverStale(dir, { isAlive: () => false }));
        assert(owned, 'Shared cleanup ran without a playback ownership lock');
      } finally { fs.readdirSync = original; fs.rmSync(dir, { recursive: true, force: true }); }
    }],
    ['relative and project-local engine paths are rejected', () => {
      const oldPath = process.env.PATH;
      const dir = fs.mkdtempSync(path.join(process.cwd(), '.engine-fixture-'));
      try {
        const file = path.join(dir, 'espeak-ng'); fs.writeFileSync(file, '#!/bin/sh\nexit 0\n'); fs.chmodSync(file, 0o755);
        process.env.PATH = path.relative(process.cwd(), dir);
        assert.equal(native.available('espeak-ng'), false);
        process.env.PATH = dir;
        assert.equal(native.available('espeak-ng'), false);
      } finally { process.env.PATH = oldPath; fs.rmSync(dir, { recursive: true, force: true }); }
    }],
  ];
  let failed = 0;
  for (const [name, test] of tests) {
    try { check(test); }
    catch (error) { failed++; console.error(`FAIL: ${name}: ${error.message}`); }
  }
  if (failed) throw new Error(`${failed} evolution regressions failed`);
  return tests.length;
}

if (require.main === module) {
  try { console.log(`PASS: ${run()} evolution regression groups`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = run;
