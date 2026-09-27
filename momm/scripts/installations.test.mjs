// MOMM 1.16.1 F: "installed somewhere" is not "the version this harness loads". Zero provider calls,
// zero network, read-only against real temporary folders (junctions on Windows, symlinks elsewhere).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.join(here, 'installations.mjs');
const mod = fs.existsSync(modulePath) ? await import(new URL('./installations.mjs', import.meta.url).href) : null;
const results = [], failures = [];
const test = (name, fn) => { try { fn(); results.push(name); } catch (e) { failures.push({ name, error: String(e?.message ?? e).slice(0, 400) }); } };

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'momm-installations-'));
const link = (target, at) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir'); };
// A copy is a clone folder holding the skill; the version lives in the dispatcher source as it does for real.
function copy(name, version, { skill = 'momm', dispatcher } = {}) {
  const skillRoot = path.join(root, 'clones', name, skill);
  fs.mkdirSync(path.join(skillRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: ' + skill + '\n---\n');
  fs.writeFileSync(path.join(skillRoot, 'scripts', 'multi-review.mjs'), dispatcher ?? `const MOMM_VERSION = "${version}";\n`);
  return skillRoot;
}
const home = (name) => { const h = path.join(root, 'homes', name); fs.mkdirSync(h, { recursive: true }); return h; };
const inv = (h, extra = {}) => mod.inventory({ home: h, ...extra });

try {
  test('module exists', () => assert(mod, 'momm/scripts/installations.mjs is missing'));
  if (mod) {
    test('nothing installed: no entries, no conflict, and it says so', () => {
      const r = inv(home('empty'));
      assert.equal(r.entries.length, 0); assert.equal(r.copies.length, 0);
      assert.equal(r.verdict.status, 'none'); assert.equal(r.verdict.consistent, true);
    });
    test('one link: the harness loads that copy, version read from its source, never guessed', () => {
      const h = home('one'), a = copy('a', '1.16.1'); link(a, path.join(h, '.claude', 'skills', 'momm'));
      const r = inv(h);
      assert.equal(r.entries.length, 1);
      const e = r.entries[0];
      assert.equal(e.harness, 'claude'); assert.equal(e.kind, 'link'); assert.equal(e.version, '1.16.1');
      assert.equal(fs.realpathSync.native(e.resolved), fs.realpathSync.native(a));
      assert.equal(r.harnesses.claude.status, 'single'); assert.equal(r.harnesses.claude.loads.version, '1.16.1');
      assert.equal(r.verdict.status, 'consistent');
    });
    test('the same copy on two discovery paths is consistent, and is ONE copy', () => {
      const h = home('same'), a = copy('same-a', '1.16.1');
      link(a, path.join(h, '.claude', 'skills', 'momm')); link(a, path.join(h, '.agents', 'skills', 'momm'));
      const r = inv(h);
      assert.equal(r.entries.length, 2); assert.equal(r.copies.length, 1); assert.equal(r.copies[0].entries.length, 2);
      assert.equal(r.verdict.status, 'consistent'); assert.equal(r.verdict.consistent, true);
    });
    test('two active paths on DIFFERENT versions is a conflict that names both, and an upgrade cannot be called complete', () => {
      const h = home('split'), a = copy('new', '1.16.1'), b = copy('old', '1.15.1');
      link(a, path.join(h, '.claude', 'skills', 'momm')); link(b, path.join(h, '.agents', 'skills', 'momm'));
      const r = inv(h);
      assert.equal(r.verdict.status, 'conflict'); assert.equal(r.verdict.consistent, false);
      assert.deepEqual(r.verdict.versions, ['1.15.1', '1.16.1']);
      assert.match(r.verdict.detail, /1\.15\.1/); assert.match(r.verdict.detail, /1\.16\.1/);
      assert.equal(r.upgrade_complete_for('1.16.1').complete, false);
      assert.match(r.upgrade_complete_for('1.16.1').reason, /\.agents/);
      const same = inv(home('done-' + Date.now()));
      assert.equal(same.upgrade_complete_for('1.16.1').complete, false, 'nothing installed is not a completed upgrade either');
    });
    test('two copies on the SAME version are reported as duplicate copies, not hidden', () => {
      const h = home('dupe'), a = copy('dupe-a', '1.16.1'), b = copy('dupe-b', '1.16.1');
      link(a, path.join(h, '.claude', 'skills', 'momm')); link(b, path.join(h, '.agents', 'skills', 'momm'));
      const r = inv(h);
      assert.equal(r.copies.length, 2); assert.equal(r.verdict.status, 'duplicate_copies'); assert.equal(r.verdict.consistent, false);
      assert.equal(r.upgrade_complete_for('1.16.1').complete, false, 'ambiguous duplicate copies must not certify completion');
    });
    test('the legacy name beside the new name in one discovery folder is a conflict: the harness sees two skills', () => {
      const h = home('legacy'), a = copy('l-new', '1.16.1'), b = copy('l-old', '1.10.2', { skill: 'multi-llm-review' });
      link(a, path.join(h, '.claude', 'skills', 'momm')); link(b, path.join(h, '.claude', 'skills', 'multi-llm-review'));
      const r = inv(h);
      assert.equal(r.harnesses.claude.status, 'conflict'); assert.match(r.harnesses.claude.detail, /multi-llm-review/);
      assert.equal(r.verdict.status, 'conflict');
    });
    test('one harness with two discovery folders on different copies: precedence is stated as undetermined, never invented', () => {
      const h = home('agy'), a = copy('agy-a', '1.16.1'), b = copy('agy-b', '1.16.0');
      link(a, path.join(h, '.gemini', 'config', 'skills', 'momm')); link(b, path.join(h, '.gemini', 'antigravity-cli', 'skills', 'momm'));
      const r = inv(h);
      assert.equal(r.harnesses.antigravity.status, 'conflict'); assert.equal(r.harnesses.antigravity.loads, null);
      assert.match(r.harnesses.antigravity.detail, /cannot tell which/i);
    });
    test('a broken link is reported as broken and does not crash or count as an installation', () => {
      const h = home('broken'), gone = path.join(root, 'clones', 'gone', 'momm'); fs.mkdirSync(gone, { recursive: true });
      link(gone, path.join(h, '.claude', 'skills', 'momm')); fs.rmSync(gone, { recursive: true, force: true });
      const r = inv(h);
      assert.equal(r.entries.length, 1); assert.equal(r.entries[0].kind, 'broken_link'); assert.equal(r.entries[0].version, null);
      assert.equal(r.copies.length, 0); assert.equal(r.harnesses.claude.status, 'broken');
    });
    test('a real directory copy (not a link) is found and labelled as a directory', () => {
      const h = home('dir'), at = path.join(h, '.claude', 'skills', 'momm');
      fs.mkdirSync(path.join(at, 'scripts'), { recursive: true }); fs.writeFileSync(path.join(at, 'scripts', 'multi-review.mjs'), 'const MOMM_VERSION = "1.14.1";\n');
      const r = inv(h);
      assert.equal(r.entries[0].kind, 'directory'); assert.equal(r.entries[0].version, '1.14.1');
    });
    test('a dispatcher without SKILL.md is not a usable installation', () => {
      const h = home('missing-protocol'), at = path.join(h, '.claude', 'skills', 'momm');
      fs.mkdirSync(path.join(at, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(at, 'scripts', 'multi-review.mjs'), 'const MOMM_VERSION = "1.16.1";\n');
      const r = inv(h);
      assert.equal(r.entries[0].has_skill_md, false);
      assert.equal(r.verdict.consistent, false);
      assert.equal(r.harnesses.claude.loads, null);
      assert.equal(r.upgrade_complete_for('1.16.1').complete, false);
    });
    test('unreadable discovery entries are recorded, not mistaken for absent installations', () => {
      const h = home('denied'), a = copy('denied-a', '1.16.1');
      link(a, path.join(h, '.claude', 'skills', 'momm'));
      const blocked = path.join(h, '.agents', 'skills', 'momm');
      const files = { ...fs, lstatSync(at, ...args) {
        if (at === blocked) throw Object.assign(new Error('private diagnostic must not escape'), { code: 'EACCES' });
        return fs.lstatSync(at, ...args);
      } };
      const r = inv(h, { fs: files });
      assert.equal(r.entries.find(e => e.path === blocked)?.kind, 'unreadable');
      assert.equal(r.verdict.consistent, false);
      assert.equal(r.upgrade_complete_for('1.16.1').complete, false);
      assert.doesNotMatch(JSON.stringify(r), /private diagnostic/);
    });
    test('a valid and an unusable entry for one harness do not certify its loaded copy', () => {
      const h = home('partly-broken'), a = copy('partly-broken-a', '1.16.1');
      link(a, path.join(h, '.agents', 'skills', 'momm'));
      fs.mkdirSync(path.join(h, '.codex', 'skills', 'momm'), { recursive: true });
      const r = inv(h);
      assert.equal(r.verdict.consistent, false);
      assert.equal(r.harnesses.codex.status, 'broken');
      assert.equal(r.harnesses.codex.loads, null);
      assert.equal(r.upgrade_complete_for('1.16.1').complete, false);
    });
    test('an unreadable or absent version is "unknown", and unknown never equals a real version', () => {
      const h = home('unknown'), a = copy('u-a', null, { dispatcher: '// no version here\n' }), b = copy('u-b', '1.16.1');
      link(a, path.join(h, '.claude', 'skills', 'momm')); link(b, path.join(h, '.agents', 'skills', 'momm'));
      const r = inv(h);
      assert.equal(r.entries.find(e => e.harness === 'claude').version, null);
      assert.equal(r.verdict.consistent, false); assert.equal(r.upgrade_complete_for('1.16.1').complete, false);
    });
    test('other copies are READ, never executed or imported', () => {
      const h = home('exec'), marker = path.join(root, 'EXECUTED');
      const a = copy('exec-a', null, { dispatcher: `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "x");\nconst MOMM_VERSION = "9.9.9";\n` });
      link(a, path.join(h, '.claude', 'skills', 'momm'));
      const r = inv(h);
      assert.equal(r.entries[0].version, '9.9.9'); assert.equal(fs.existsSync(marker), false, 'the inventory ran code from another copy');
    });
    test('a hostile version string is bounded and stripped of control characters', () => {
      const h = home('hostile'), a = copy('h-a', null, { dispatcher: 'const MOMM_VERSION = "1.0.0\\u001b[31m' + 'x'.repeat(500) + '";\n' });
      link(a, path.join(h, '.claude', 'skills', 'momm'));
      const v = inv(h).entries[0].version;
      assert.equal(v, null, 'anything that is not a plain semantic version is unknown');
    });
    test('this running copy is identified, and whether any harness path actually loads it', () => {
      const h = home('running'), a = copy('run-a', '1.16.1'), b = copy('run-b', '1.16.1');
      link(a, path.join(h, '.claude', 'skills', 'momm'));
      assert.equal(inv(h, { runningSkillRoot: a }).running.linked_from.length, 1);
      const orphan = inv(h, { runningSkillRoot: b }).running;
      assert.equal(orphan.linked_from.length, 0); assert.match(orphan.note, /no harness discovery path/i);
    });
    test('extra discovery folders (a custom harness) are inventoried when named', () => {
      const h = home('custom'), a = copy('c-a', '1.16.1'), custom = path.join(h, 'my-harness', 'skills'); link(a, path.join(custom, 'momm'));
      const r = inv(h, { customDirs: [custom] });
      assert.equal(r.entries.length, 1); assert.equal(r.entries[0].harness, 'custom');
    });
    test('command line: JSON on stdout, exit 0 when consistent and 1 on a conflict', () => {
      const ok = home('cli-ok'), a = copy('cli-a', '1.16.1'); link(a, path.join(ok, '.claude', 'skills', 'momm'));
      const bad = home('cli-bad'), b = copy('cli-b', '1.15.1'); link(a, path.join(bad, '.claude', 'skills', 'momm')); link(b, path.join(bad, '.agents', 'skills', 'momm'));
      const run = (h) => spawnSync(process.execPath, [modulePath, '--home', h], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
      const p1 = run(ok), p2 = run(bad);
      assert.equal(p1.status, 0, p1.stderr); assert.equal(JSON.parse(p1.stdout).verdict.status, 'consistent');
      assert.equal(p2.status, 1, p2.stderr); assert.equal(JSON.parse(p2.stdout).verdict.status, 'conflict');
      assert.match(p2.stderr, /different MOMM versions/i);
    });
    // Triage of rev_20260922162715 F23/F72: the version is read from the source text, so a mention
    // in a comment or a string must not be able to impersonate the declaration. An unanchored match
    // took whichever came first, letting a stale copy claim any version its comments named.
    test('a version named in a comment or a string never becomes the installed version', () => {
      const h = home('decoy');
      const decoy = '// const MOMM_VERSION = "9.9.9";' + String.fromCharCode(10)
        + 'const NOTE = `const MOMM_VERSION = "8.8.8";`;' + String.fromCharCode(10)
        + 'const MOMM_VERSION = "1.16.0";' + String.fromCharCode(10);
      link(copy('decoy', null, { dispatcher: decoy }), path.join(h, '.claude', 'skills', 'momm'));
      assert.equal(inv(h).entries[0].version, '1.16.0', 'the real declaration wins over a comment and a string');
    });
    // F24: the dispatcher is opened to read the version. Opening a named pipe blocks until something
    // writes to it, which would hang the whole inventory; only a regular file is read. A directory
    // stands in for the pipe because Windows has no mkfifo. This is a guard against an unchecked
    // open being reintroduced, not a reproduction: a directory already failed the old open too.
    test('a dispatcher that is not a regular file leaves the version unknown instead of blocking', () => {
      const h = home('pipe'), skillRoot = path.join(root, 'clones', 'pipe', 'momm');
      fs.mkdirSync(path.join(skillRoot, 'scripts', 'multi-review.mjs'), { recursive: true });
      fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---' + String.fromCharCode(10) + 'name: momm' + String.fromCharCode(10) + '---' + String.fromCharCode(10));
      link(skillRoot, path.join(h, '.claude', 'skills', 'momm'));
      assert.equal(inv(h).entries[0].version, null, 'a non-regular dispatcher reports no version');
    });
    // F72: a short read must not split the declaration. The declaration is placed past a chunk
    // boundary and the reader is forced to return one byte at a time.
    test('a dispatcher read in short chunks still yields the declared version', () => {
      const h = home('short');
      const padding = '// padding'.repeat(4000) + String.fromCharCode(10);
      link(copy('short', null, { dispatcher: padding + 'const MOMM_VERSION = "1.16.0";' + String.fromCharCode(10) }), path.join(h, '.claude', 'skills', 'momm'));
      const dribble = Object.create(fs);
      dribble.readSync = (fd, buffer, offset, length, position) => fs.readSync(fd, buffer, offset, Math.min(length, 1), position);
      assert.equal(inv(h, { fs: dribble }).entries[0].version, '1.16.0', 'the reader keeps going until the buffer is full');
    });
  }
} finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }

console.log(JSON.stringify({ passed: failures.length === 0, checks: results.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
