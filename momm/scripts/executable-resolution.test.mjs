// Named security regression (1.16.1 charter item 8): executable resolution.
//
// What this covers: none of MOMM's five executable resolvers may take an executable from a PATH
// directory inside the project, and nothing in this repository may launch a bare `git`. What it does
// NOT cover: reviewer launches on macOS and Linux still pass a bare name to spawn, so a PATH entry
// inside the project could supply a reviewer CLI there (owner decision 3 in plan-1.16.1.md).
// The independent review of 3d7a8be found two ways a repository could choose the executable:
//   1. A PATH directory INSIDE the project holding a `git` link to any executable outside it. The
//      resolvers checked only where the executable resolved to, so the project picked the binary,
//      and it was then run with Git's arguments.
//   2. A test suite launching a bare `git` with the checkout as its working directory. On Windows that
//      runs a git.exe planted in the checkout; when the planted binary is an interpreter, it loads
//      `ls-files` from the checkout as a script. That is code execution from repository contents.
//
// Every resolver is held to one attack matrix here, because an earlier fix was applied to one resolver
// and missed in the next. Synthetic material only; nothing leaves the temporary folders. Zero network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { windowsTool, windowsChildEnv } from './process-scope.mjs';
import { resolveGit } from './governor.mjs';
import { resolveTool } from './update.mjs';
import { windowsLauncher } from './probes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..');
const isWindows = process.platform === 'win32';
const results = [], skipped = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, passed: true }); }
  catch (e) { results.push({ name, passed: false, error: String(e?.message ?? e).slice(0, 700) }); process.exitCode = 1; }
};
const skip = (name, why) => skipped.push({ name, why });

// ---- 1. Filesystem doubles: the same four attacks against every injectable resolver -----------------
{
  const W = path.win32, root = 'C:\\project', trusted = 'C:\\trusted';
  const links = {
    'c:\\project\\bin\\git.exe': 'C:\\evil\\python.exe',     // A: a file link inside the project
    'c:\\project\\linkdir': 'C:\\evil',                     // B: a directory junction inside the project
    'c:\\project\\linkdir\\git.exe': 'C:\\evil\\git.exe',
    'c:\\alias': 'C:\\project\\bin',                        // C: an alias outside that lands inside
    'c:\\alias\\git.exe': 'C:\\project\\bin\\git.exe',
    'c:\\outside\\git.exe': 'C:\\project\\planted.exe',     // D: outside directory, executable inside
  };
  const real = (p) => links[String(p).toLowerCase()] ?? String(p);
  // Only the planted files exist. A double where every path exists lets a resolver "find" git.com
  // beside a refused git.exe, which tests the double rather than the resolver.
  const present = new Set(['c:\\project\\bin\\git.exe', 'c:\\project\\linkdir\\git.exe', 'c:\\alias\\git.exe', 'c:\\outside\\git.exe', 'c:\\trusted\\git.exe']);
  const stat = (p) => { if (!present.has(String(p).toLowerCase())) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { isFile: () => true }; };
  const files = { statSync: stat, realpathSync: Object.assign(real, { native: real }) };
  const attacks = { A: 'C:\\project\\bin', B: 'C:\\project\\linkdir', C: 'C:\\alias', D: 'C:\\outside' };
  for (const [label, entry] of Object.entries(attacks)) {
    const env = { PATH: `${entry};${trusted}`, SystemRoot: 'C:\\Windows' };
    check(`windowsTool refuses attack ${label} and takes the trusted Git`, () =>
      assert.equal(windowsTool('git', { cwd: root, env, platform: 'win32', fs: files }), W.join(trusted, 'git.exe')));
    check(`resolveGit (Windows) refuses attack ${label} and takes the trusted Git`, () =>
      assert.equal(resolveGit(root, { platform: 'win32', env, fs: files, path: W }), W.join(trusted, 'git.exe')));
    check(`resolveGit (Windows) resolves nothing when attack ${label} is the only entry`, () =>
      assert.equal(resolveGit(root, { platform: 'win32', env: { PATH: entry }, fs: files, path: W }), null));
    if (label !== 'D') check(`windowsChildEnv removes the attack-${label} directory from the child PATH`, () =>
      assert.equal(windowsChildEnv(env, { cwd: root, fs: files }).PATH, trusted));
  }
  check('windowsTool never falls back to a project binary when only attacks are on PATH', () => {
    const only = windowsTool('git', { cwd: root, env: { PATH: Object.values(attacks).join(';'), SystemRoot: 'C:\\Windows' }, platform: 'win32', fs: files });
    assert.match(only, /momm-tool-not-found/);
  });

  const P = path.posix, proot = '/proj', ptrusted = '/usr/bin';
  const plinks = { '/proj/bin/git': '/usr/bin/python3', '/proj/linkdir': '/opt/evil', '/proj/linkdir/git': '/opt/evil/git', '/alias': '/proj/bin', '/alias/git': '/proj/bin/git', '/outside/git': '/proj/planted' };
  const preal = (p) => plinks[String(p)] ?? String(p);
  const ppresent = new Set(['/proj/bin/git', '/proj/linkdir/git', '/alias/git', '/outside/git', '/usr/bin/git']);
  const pstat = (p) => { if (!ppresent.has(String(p))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { isFile: () => true }; };
  const pfiles = { statSync: pstat, realpathSync: Object.assign(preal, { native: preal }) };
  for (const [label, entry] of Object.entries({ A: '/proj/bin', B: '/proj/linkdir', C: '/alias', D: '/outside' })) {
    check(`resolveGit (POSIX) refuses attack ${label} and takes the trusted Git`, () =>
      assert.equal(resolveGit(proot, { platform: 'linux', env: { PATH: `${entry}:${ptrusted}` }, fs: pfiles, path: P }), P.join(ptrusted, 'git')));
  }
}

// ---- 2. Real folders: windowsLauncher (every host) and resolveTool (Windows) --------------------------
{
  const base = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'momm-exe-resolution-'));
  try {
    const project = path.join(base, 'project'), trusted = path.join(base, 'trusted'), evil = path.join(base, 'evil');
    for (const d of [path.join(project, 'bin'), trusted, evil]) fs.mkdirSync(d, { recursive: true });
    const plant = (dir, name) => { fs.writeFileSync(path.join(dir, name), 'synthetic executable'); return path.join(dir, name); };
    let linked = true;
    try { fs.symlinkSync(evil, path.join(project, 'linkdir'), isWindows ? 'junction' : 'dir'); } catch { linked = false; }
    const inProject = [path.join(project, 'bin'), ...(linked ? [path.join(project, 'linkdir')] : [])];
    if (!linked) skip('directory link inside the project', 'this host could not create a directory link');

    for (const name of ['grok.exe', 'git.exe']) { plant(path.join(project, 'bin'), name); plant(evil, name); }
    const trustedGrok = plant(trusted, 'grok.exe'), trustedGit = plant(trusted, 'git.exe');

    // Before 1.16.1, windowsLauncher took the first match on ANY absolute PATH entry; a plain regular
    // file in a project directory was enough, no link needed.
    check('windowsLauncher refuses project directories on PATH, plain and linked, and takes the trusted binary', () => {
      const env = { PATH: [...inProject, trusted].join(path.delimiter) };
      assert.equal(windowsLauncher('grok', [], env, 'win32', project).command, fs.realpathSync(trustedGrok));
    });
    check('windowsLauncher reports not installed rather than using a project binary', () => {
      const r = windowsLauncher('grok', [], { PATH: inProject.join(path.delimiter) }, 'win32', project);
      assert.ok(r.error || r.command === 'grok' || !String(r.command).startsWith(project), JSON.stringify(r));
      if (r.command) assert.ok(!fs.realpathSync.native(r.command === 'grok' ? trustedGrok : r.command).startsWith(fs.realpathSync.native(project)));
    });

    if (isWindows) {
      // The updater keeps its own copy of the rule so that it stays self-contained; this is what keeps
      // the copy from drifting away from process-scope.mjs.
      check('resolveTool (the updater copy) refuses project directories and takes the trusted Git', () =>
        assert.equal(resolveTool('git', project, { env: { PATH: [...inProject, trusted].join(';') }, platform: 'win32' }).toLowerCase(), fs.realpathSync.native(trustedGit).toLowerCase()));
      check('resolveTool (the updater copy) finds nothing when only project directories are on PATH', () =>
        assert.throws(() => resolveTool('git', project, { env: { PATH: inProject.join(';') }, platform: 'win32' }), /not found on an absolute PATH entry outside/));
    } else skip('resolveTool real-folder matrix', 'resolveTool only resolves on Windows; elsewhere it returns the name unchanged');
  } finally { fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

// ---- 3. Windows: the planted-git.exe code-execution path, with the masking variable REMOVED -------------
// NoDefaultCurrentDirectoryInExePath in the PARENT process stops the working-directory search. A
// developer shell that already carries it hides this hazard completely, which is how it went unseen
// locally, so the children below are started without it. Setting it in the CHILD's environment does
// nothing for the parent's own lookup.
if (isWindows) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'momm-planted-git-'));
  try {
    const checkout = path.join(base, 'checkout'), sentinel = path.join(base, 'SENTINEL-checkout-code-ran');
    fs.mkdirSync(checkout);
    fs.copyFileSync(process.execPath, path.join(checkout, 'git.exe'));   // an interpreter posing as git
    fs.writeFileSync(path.join(checkout, 'ls-files'), `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran');`);
    const unguarded = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'nodefaultcurrentdirectoryinexepath'));
    const script = (name, body) => { const f = path.join(base, name); fs.writeFileSync(f, body); return f; };
    const run = (file) => spawnSync(process.execPath, [file], { cwd: base, env: unguarded, encoding: 'utf8', windowsHide: true, timeout: 60_000 });

    // Control: the hazard as it existed, so the check below is known not to be vacuous on this runtime.
    const bareName = ['g', 'i', 't'].join('');
    run(script('control.mjs', `import { spawnSync } from 'node:child_process';\nspawnSync(${JSON.stringify(bareName)}, ['ls-files', '-z'], { cwd: ${JSON.stringify(checkout)}, windowsHide: true });\n`));
    const controlReproduced = fs.existsSync(sentinel);
    fs.rmSync(sentinel, { force: true });
    if (!controlReproduced) skip('planted git.exe control', 'this runtime did not search the working directory, so the check below is not exercised here');

    // The fix: resolve to an absolute path outside the checkout, with the checkout also placed on PATH,
    // and prove the planted binary never runs even with the guard variable absent.
    const probe = run(script('safe.mjs', [
      `import { spawnSync } from 'node:child_process';`,
      `const { resolveGit } = await import(${JSON.stringify(pathToFileURL(path.join(here, 'governor.mjs')).href)});`,
      `const { windowsTool } = await import(${JSON.stringify(pathToFileURL(path.join(here, 'process-scope.mjs')).href)});`,
      `delete process.env.NoDefaultCurrentDirectoryInExePath; // the absolute path alone must be enough`,
      `const env = { ...process.env, PATH: ${JSON.stringify(checkout)} + ';' + (process.env.PATH ?? process.env.Path ?? '') };`,
      `const viaGovernor = resolveGit(${JSON.stringify(checkout)}, { env });`,
      `const viaScope = windowsTool('git', { cwd: ${JSON.stringify(checkout)}, env });`,
      `for (const exe of [viaGovernor, viaScope]) if (exe) spawnSync(exe, ['ls-files', '-z'], { cwd: ${JSON.stringify(checkout)}, windowsHide: true });`,
      `console.log(JSON.stringify({ viaGovernor, viaScope }));`,
    ].join('\n')));
    check('with the guard variable absent, resolved Git never runs a git.exe planted in the checkout', () => {
      assert.equal(probe.status, 0, probe.stderr);
      assert.equal(fs.existsSync(sentinel), false, 'the planted interpreter ran code from the checkout');
      const { viaGovernor, viaScope } = JSON.parse(probe.stdout.trim().split('\n').pop());
      const inside = (p) => p && !path.relative(fs.realpathSync.native(checkout).toLowerCase(), p.toLowerCase()).startsWith('..');
      assert.ok(viaGovernor, 'resolveGit found no Git outside the checkout on this runner');
      assert.ok(!inside(viaGovernor) && !inside(viaScope), JSON.stringify({ viaGovernor, viaScope }));
    });
    results.push({ name: 'planted git.exe control reproduced the hazard on this runtime', passed: true, reproduced: controlReproduced });
  } finally { fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
} else skip('planted git.exe code-execution check', 'the working-directory search is Windows behaviour');

// ---- 4. Static: nothing in this repository launches a bare git -----------------------------------------
check('no script or suite launches a literal bare `git` (spawn, execFile, execSync); computed names are not detected by this check', () => {
  const self = path.resolve(fileURLToPath(import.meta.url));
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['node_modules', '.git', '.ensemble_reviews'].includes(e.name) ? [] : walk(p);
    return /\.(?:mjs|cjs|js)$/.test(e.name) ? [p] : [];
  });
  const launches = /(?<![.\w])(?:spawnSync|spawn|execFileSync|execFile)\(\s*(['"])git(?:\.exe)?\1|(?<![.\w])execSync\(\s*['"`]git\b/g;
  const offenders = [...walk(path.join(repo, 'momm')), ...walk(path.join(repo, 'scripts')), path.join(repo, 'install.mjs')]
    .filter((f) => fs.existsSync(f) && path.resolve(f) !== self)
    .flatMap((f) => (fs.readFileSync(f, 'utf8').match(launches) ?? []).map((m) => `${path.relative(repo, f)}: ${m}`));
  assert.deepEqual(offenders, []);
});

console.log(JSON.stringify({ passed: results.every((r) => r.passed), checks: results.length, failures: results.filter((r) => !r.passed), skipped }, null, 2));
