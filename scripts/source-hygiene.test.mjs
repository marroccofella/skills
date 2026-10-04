// Every tracked text source is reviewable text. A raw control byte (other than tab, LF, CR) makes Git
// treat the file as binary: it cannot be diffed, MOMM's own --range refuses it, and no reviewer can
// read it. Found on the 1.16.1 branch: a tool expanded a regex escape into raw NUL/0x1F/0x7F bytes in
// momm/scripts/installations.mjs and nothing noticed until a real committed-range review was tried.
// Zero provider calls, zero network.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { resolveGit } from '../momm/scripts/governor.mjs';
import { realTempDir } from './private-test-fixture.mjs';

// The two checks assess different contents on purpose: control bytes are checked in the WORKING
// TREE, because that is what a contributor is about to commit, while binary classification is
// asked of Git at HEAD, because that is what a reviewer and --range will actually be handed.
// Both digests quoted anywhere in this repository are SHA-256.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Git is resolved to an absolute path outside this checkout before anything is launched. A bare
// name here ran a git.exe planted in the checkout on Windows, and when that binary was an
// interpreter it loaded `ls-files` from the checkout as a script (independent review of 3d7a8be).
const GIT = resolveGit(root);
const gitAvailable = GIT !== null && spawnSync(GIT, ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0;
if (!gitAvailable) {
  console.error('source-hygiene: git is not on PATH, so neither the repository listing nor the binary-classification check can run.');
  process.exit(1);
}
const results = [];
const check = (name, fn) => { try { fn(); results.push({ name, passed: true }); } catch (e) { results.push({ name, passed: false, error: String(e.message).slice(0, 1200) }); process.exitCode = 1; } };
const TEXT = /\.(?:mjs|cjs|js|jsonl?|md|yml|yaml|html|css|txt|svg|vtt|csv|xml|sha256)$/i;
const listed = spawnSync(GIT, ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64_000_000 });
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
  const empty = spawnSync(GIT, ['hash-object', '-t', 'tree', '--stdin'], { cwd: root, input: '', encoding: 'utf8', windowsHide: true }).stdout.trim();
  const stat = spawnSync(GIT, ['diff', '--numstat', '-z', empty, 'HEAD', '--'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64_000_000 });
  assert.equal(stat.status, 0, stat.stderr);
  const binary = stat.stdout.split('\0').filter(row => row.startsWith('-\t-\t')).map(row => row.slice(4)).filter(f => TEXT.test(f));
  assert.deepEqual(binary, []);
});

// 1.17.1 S6. During 1.17 the publish scanner (myrepo/scripts/publish.mjs) refused a push four times
// for a literal in a test, each time after the work was done: a fixed UUID assigned to a token name
// and three machine home paths. The same classes are refused here, before any push. The rules are
// that scanner's, written again and never looser, plus the token shapes MOMM's own sanitizer knows.
// A test assembles such a value at run time, as the probes below do, so nothing here matches itself.
const SCANNED = /\.(?:mjs|cjs|js|ts|jsx|tsx|jsonl?|md|ya?ml|html?|css|txt|svg|vtt|csv|xml|sha256|py|rb|go|rs|java|c|h|sh|ps1|bas|toml|ini|cfg|env|conf|vue)$/i;
const scanned = listed.status === 0 ? listed.stdout.split('\0').filter(f => f && (SCANNED.test(f) || !path.extname(f))) : [];
const NAME = '([^\\\\/\\s"\'`<>]+)';
const HOME_PATHS = [
  new RegExp('[A-Za-z]:[\\\\/]+Users[\\\\/]+' + NAME, 'gi'),   // a Windows profile: single or doubled separators, any case
  new RegExp('/mnt/[a-z]/Users/' + NAME, 'gi'),                 // the same profile seen from WSL
  new RegExp('(?<![\\w.~}])/(?:Users|home)/' + NAME, 'gi'),     // a macOS or Linux home; a web address or relative path has a word before it
];
// The scanner's placeholder names, matched whole. `C:\Users\<you>` never matches: a name cannot start with "<".
const PLACEHOLDER_HOME = /^(?:\.{3}|\u2026|you|your-name|name|user|username|fixture(?:-user)?|private-name|example)[),.;:\]}]*$/i;
const assigned = (words, quotes) => new RegExp('["\']?[A-Za-z0-9_]*(?:' + words.join('|') + ')[A-Za-z0-9_]*["\']?\\s*[:=]\\s*([' + quotes + '])([^\\r\\n' + quotes + ']{8,})\\1', 'gi');
// Any real-looking quoted value given to one of the scanner's names is refused, as the scanner does.
const NAMED = assigned(['api[_-]?key', 'secret', 'passwd', 'password', 'private[_-]?key', 'token', 'bearer'], '"\'');
const PLACEHOLDER_VALUE = /^[<[]?(?:fixture|example|sample|test|sentinel|allowed|forbidden|redacted|hidden|dummy|wrong[-_ ]?local|provider[-_ ]?scoped|not[-_ ]?a[-_ ]?secret|change[-_ ]?me|your[-_ ])/i;
const looksReal = (value) => !PLACEHOLDER_VALUE.test(value) && !/CANARY|MUST_NOT_ESCAPE/i.test(value) && !/[\s$}{()]/.test(value);
// Wider names (any key or credential, any quote) are refused only for a value shaped like one: a UUID,
// 32 or more hex digits, or 24 or more base64 characters that mix digits and both letter cases.
const SHAPED = assigned(['key', 'credential', 'token', 'secret', 'passw(?:or)?d'], '"\'`');
const credentialShaped = (value) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) || /^[0-9a-f]{32,}$/i.test(value)
  || (/^[A-Za-z0-9+/_-]{24,}={0,2}$/.test(value) && /[0-9]/.test(value) && /[a-z]/.test(value) && /[A-Z]/.test(value));
// The token shapes sanitizeText in multi-review.mjs redacts, so a fixture for it is never written out whole.
// An option name such as --xai-api-base-url is not a key, so the two bare prefixes need an unbroken run.
const PREFIXED = [new RegExp('\\b(?:sk-ant-|sk-proj-|gh[pousr]_|github_pat_)[A-Za-z0-9._-]{12,}', 'g'), new RegExp('\\b(?:sk|xai)-[A-Za-z0-9]{20,}', 'g'), new RegExp('\\bAKIA[0-9A-Z]{16}\\b', 'g')];
const KEY_BLOCK = new RegExp('-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE ' + 'KEY-----', 'g');
const lineAt = (text, index) => { let line = 1; for (let at = text.indexOf('\n'); at !== -1 && at < index; at = text.indexOf('\n', at + 1)) line++; return line; };
// Every hit carries its line. `shown` is safe to print: a path is shown, a credential never is.
function leaks(text) {
  const found = [], seen = new Set();
  const add = (index, kind, shown, literal) => { const key = `${index} ${kind}`; if (!seen.has(key)) { seen.add(key); found.push({ line: lineAt(text, index), kind, shown, literal }); } };
  let rest = text;
  for (const pattern of HOME_PATHS) {
    for (const match of rest.matchAll(pattern)) if (!PLACEHOLDER_HOME.test(match[1])) add(match.index, 'machine home path', match[0].slice(0, 60), match[0]);
    rest = rest.replace(pattern, (whole) => ' '.repeat(whole.length)); // one report per path: a Windows profile is not also a macOS home
  }
  for (const [pattern, refused] of [[NAMED, looksReal], [SHAPED, credentialShaped]])
    for (const match of text.matchAll(pattern)) if (refused(match[2])) add(match.index, 'credential-looking literal', `${match[0].slice(0, -match[2].length - 1)}... (${match[2].length} characters)`, match[2]);
  for (const pattern of PREFIXED) for (const match of text.matchAll(pattern)) add(match.index, 'token-shaped literal', `${match[0].slice(0, 4)}... (${match[0].length} characters)`, match[0]);
  for (const match of text.matchAll(KEY_BLOCK)) add(match.index, 'private key block', 'BEGIN PRIVATE KEY', match[0]);
  return found;
}
const digest = (value) => createHash('sha256').update(value).digest('hex');
// The public evidence snapshot quotes reviewers' own test suggestions, which name five synthetic
// tokens. It is a dated record with a hash sidecar, so it is not rewritten; the publish scanner has no
// token-shape rule and passes it. Only these exact strings, by SHA-256, are accepted in those two
// files (the ledger page embeds the same snapshot). Anything else token-shaped there still fails.
const QUOTED_IN_PUBLIC_EVIDENCE = new Set(['8a0667873c5589a0f9e0ddb31465a80ae10a58712ba61abbd1d0e700e6ab279f', '7f9cd0e286e182729ca4bdfd0dc4bd32f173dfe7d66f1f0e14581fb10357d93f',
  '9f5489275a61ca80009c7b5c418cfae562e681562035a3000ec9399208245cef', 'ce6cda95d1d8e0207ee14ed9072077d9402fcf444387fd70efb052acbb92e0d0', '743554670c6065b3f7f13ac4f07e392f977b3556ceb7457411633c454bcbece8']);
const acceptedThere = (rel, hit) => ['docs/evidence/momm-evidence.json', 'docs/evidence/index.html'].includes(rel) && hit.kind === 'token-shaped literal' && QUOTED_IN_PUBLIC_EVIDENCE.has(digest(hit.literal));
const sep = String.fromCharCode(92), quote = String.fromCharCode(39), kinds = (text) => leaks(text).map(hit => hit.kind);
const fixedId = ['123e4567', 'e89b', '42d3', 'a456', '426614174000'].join('-');

check('the four literals the publish scanner refused during 1.17 are reported', () => {
  assert.deepEqual(kinds(['const TOK', 'EN = ', quote, fixedId, quote, ';'].join('')), ['credential-looking literal'], 'a fixed UUID assigned to a token name');
  assert.deepEqual(kinds(['C:', 'Users', 'synthetic-person'].join(sep + sep)), ['machine home path'], 'a Windows home with doubled separators');
  assert.deepEqual(kinds(quote + ['', 'home', 'u', 'project'].join('/') + quote), ['machine home path'], 'a Linux home');
  assert.deepEqual(kinds(['c:', 'users', 'u', 'project'].join(sep + sep)), ['machine home path'], 'a lower-case Windows home');
});
check('home paths: every spelling is reported, with its line; placeholders and web addresses are not', () => {
  for (const home of [['C:', 'Users', 'someone', 'x'].join(sep), ['D:', 'Users', 'someone'].join('/'), ['', 'Users', 'someone', ''].join('/'), ['', 'home', 'someone', ''].join('/'),
    'file://' + ['', 'Users', 'someone', 'notes.md'].join('/'), ['', 'mnt', 'c', 'Users', 'someone'].join('/'), 'PATH=/usr/bin:' + ['', 'home', 'someone', 'bin'].join('/')])
    assert.deepEqual(kinds('see ' + home), ['machine home path'], home);
  for (const fine of [['C:', 'Users', '<you>', 'x'].join(sep), ['C:', 'Users', '...'].join(sep + sep), ['', 'home', 'user', 'project'].join('/'), ['', 'Users', 'name,'].join('/'), ['C:', 'Users', 'fixture'].join('/'),
    'https://example.invalid' + ['', 'home', 'octocat', 'repo'].join('/'), '.' + ['', 'home', 'index.html'].join('/'), "['C:', 'Users', 'u'].join(sep)"])
    assert.deepEqual(kinds('see ' + fine), [], fine);
  // A name that only starts like a placeholder is still a name (the publish scanner excuses it; this is stricter).
  assert.deepEqual(kinds(['', 'home', 'username42', 'x'].join('/')), ['machine home path']);
  const [hit] = leaks('one\ntwo\n' + ['', 'home', 'someone', 'x'].join('/') + '\n');
  assert.equal(hit.line, 3);
});
check('credential-looking literals are reported without printing the value; generated and placeholder values are not', () => {
  const hex = 'a1b2c3d4'.repeat(5), mixed = ['Zm9v', 'YmFy', 'QmF6', 'MTIz', 'NDU2', 'Nzg5'].join('');
  for (const leak of [['service_tok', 'en: "', 'v7Zq4mN8rT2xK6pL', '"'].join(''), ['"pass', 'word": "', 'hunter2hunter2', '"'].join(''), ['signingK', 'ey = `', mixed, '`'].join(''),
    ['CREDEN', 'TIAL: ', quote, fixedId, quote].join(''), ['cacheK', 'ey = "', hex, '"'].join('')]) {
    const found = leaks(leak);
    assert.deepEqual(found.map(hit => hit.kind), ['credential-looking literal'], leak.slice(0, 12));
    assert(!found[0].shown.includes(leak.slice(-9, -1)), 'the report must not repeat the value');
  }
  for (const token of ['gh' + 'p_' + 'q'.repeat(30), 'github' + '_pat_' + 'Q'.repeat(22), 's' + 'k-' + 'q'.repeat(24), 's' + 'k-ant-' + 'q'.repeat(16), 'xa' + 'i-' + 'q'.repeat(24), 'AK' + 'IA' + 'Q'.repeat(16)])
    assert.deepEqual(kinds('x ' + token + ' y'), ['token-shaped literal'], token.slice(0, 6));
  assert.deepEqual(kinds('--xai-api-base-url <XAI_API_BASE_URL>'), [], 'an option name is not a key');
  assert.deepEqual(kinds('-----BEGIN ' + 'PRIVATE KEY-----'), ['private key block']);
  for (const fine of ["const sessionTok" + "en = crypto.randomBytes(24).toString('hex');", ['TOK', 'EN = ', quote, 'test-token-value', quote].join(''), ['tok', 'en: `${prefix}${fixedId}`'].join(''),
    ['cacheK', 'ey = "review-contract-v3"'].join(''), ['k', 'ey: ', quote, 'momm-peer-review/3', quote].join(''), ['sha256: "', hex, '"'].join(''), "const secret = 'gh" + "p_' + 'z'.repeat(32);"])
    assert.deepEqual(kinds(fine), [], fine.slice(0, 16));
});
check('no tracked text file contains a machine home path or a credential-looking literal', () => {
  assert(files.every(f => scanned.includes(f)), 'the wider listing must cover every file the control-byte check reads');
  const bad = [];
  for (const rel of scanned) {
    let text; try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; } // only a working-tree deletion may be absent
    for (const hit of leaks(text)) if (!acceptedThere(rel, hit)) bad.push(`${rel}:${hit.line} ${hit.kind}: ${hit.shown}`);
  }
  assert.deepEqual([...new Set(bad)], [], 'the publish scanner refuses these and is never waived: assemble the value at run time, for example [\'C:\', \'Users\', \'u\'].join(sep), or use a placeholder name such as fixture');
});

// 1.17.1 S5. Hosted Windows runners spell the temp folder as an 8.3 short name and macOS reaches it
// through /var -> /private/var, so the text of os.tmpdir() is not a prefix of a real path there. Three
// tests failed on hosted runners that way. The rule is deliberately narrow: a line of a test that takes a
// real path and compares against the unresolved temp folder. It cannot see a real path made on another line.
const RAW_TMP = String.raw`(?:path\.(?:resolve|join|normalize)\(\s*)?os\.tmpdir\(\)`;
const TMP_COMPARED = [new RegExp(String.raw`\.(?:includes|startsWith)\(\s*` + RAW_TMP), new RegExp(String.raw`[!=]==?\s*` + RAW_TMP), new RegExp(String.raw`(?:path\.(?:resolve|normalize)\(\s*os\.tmpdir\(\)\s*\)|os\.tmpdir\(\))\s*[!=]==?`)];
const tmpComparisons = (text) => text.split('\n').flatMap((line, index) => /realpathSync/.test(line) && TMP_COMPARED.some(pattern => pattern.test(line)) ? [index + 1] : []);
const tmp = 'os.' + 'tmpdir()', real = 'fs.realpath' + 'Sync';
check('a test line that compares the unresolved temp folder with a real path is reported', () => {
  for (const line of [`assert(${real}(dir).startsWith(${tmp}));`, `assert(${real}.native(dir).startsWith(path.resolve(${tmp}) + path.sep));`, `if (${real}(dir) === ${tmp}) done();`,
    `assert(${tmp} !== ${real}.native(dir));`, `assert(${real}(file).includes(path.join(${tmp}, 'momm-')));`])
    assert.deepEqual(tmpComparisons('first\n' + line + '\n'), [2], line);
  // Both sides real, the temp folder only joined or passed on, or no real path on the line: not this defect.
  for (const line of [`assert.equal(${real}(path.dirname(temp)), ${real}(${tmp}));`, `assert(${real}.native(dir).startsWith(${real}.native(${tmp}) + path.sep));`,
    `const base = fs.mkdtempSync(path.join(${real}.native(${tmp}), 'momm-x-'));`, `if (path.dirname(fixture) === ${tmp}) fs.rmSync(fixture);`, `assert(resolved.startsWith(path.resolve(${tmp}) + path.sep));`,
    `if (value === undefined) x(); assert.equal(path.dirname(a), ${real}(${tmp})); assert(path.basename(a).startsWith('momm-'));`])
    assert.deepEqual(tmpComparisons(line), [], line);
});
check('no tracked test compares the unresolved temp folder with a real path', () => {
  const bad = [];
  for (const rel of scanned.filter(f => f.endsWith('.test.mjs'))) {
    let text; try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const line of tmpComparisons(text)) bad.push(`${rel}:${line}`);
  }
  assert.deepEqual(bad, [], 'compare fs.realpathSync.native results on both sides, or start from realTempDir() in momm/scripts/private-test-fixture.mjs');
});
check('realTempDir gives the real native path of a new temp folder, however the environment spells it', () => {
  // A link stands in for the hosted runners' spellings: the child is told its temp folder is the link.
  const parent = fs.realpathSync.native(os.tmpdir()), base = realTempDir('momm-hygiene-real-');
  try {
    assert.equal(base, fs.realpathSync.native(base)); assert.equal(path.dirname(base), parent);
    assert(path.basename(base).startsWith('momm-hygiene-real-')); assert.deepEqual(fs.readdirSync(base), []);
    assert.throws(() => realTempDir('../escape-'), /Invalid synthetic fixture prefix/);
    const target = path.join(base, 'target'), link = path.join(base, 'spelled-differently');
    fs.mkdirSync(target); fs.symlinkSync(target, link, 'junction');
    const helper = pathToFileURL(path.join(root, 'momm/scripts/private-test-fixture.mjs')).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', 'const m = await import(process.argv[1]); process.stdout.write(m.realTempDir("momm-hygiene-child-"));', helper],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000, env: { ...process.env, TMPDIR: link, TEMP: link, TMP: link } });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(path.dirname(child.stdout), target, 'the real folder, not the spelling the environment gave');
    assert(path.basename(child.stdout).startsWith('momm-hygiene-child-') && fs.statSync(child.stdout).isDirectory());
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
console.log(JSON.stringify({ passed: results.every(r => r.passed), files: files.length, scanned: scanned.length, results }, null, 2));
