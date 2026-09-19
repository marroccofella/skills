import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
// Recursively cover public guides and references, including newly added files.
// This focused regression supplements, never replaces, the publication scanner.
function publicTextFiles(relative) {
  return fs.readdirSync(new URL(relative + '/', root), { withFileTypes: true }).flatMap(entry => {
    const file = relative + '/' + entry.name;
    assert.ok(!entry.isSymbolicLink(), `${relative}: public documentation symlinks require explicit review`);
    return entry.isDirectory() ? publicTextFiles(file)
      : entry.isFile() && /\.(?:md|txt|html|json|csv|xml|vtt)$/i.test(entry.name) ? [file] : [];
  });
}
// The root and skill READMEs are version surfaces of the release flow, so they are public text too.
const files = [...publicTextFiles('docs'), ...publicTextFiles('momm/references'), 'README.md', 'momm/README.md', 'momm/scripts/capabilities.test.mjs', 'momm/scripts/modality.test.mjs'];
const homeNames = source => [...source.matchAll(/(?:[A-Za-z]:[\\/]+[Uu][Ss][Ee][Rr][Ss][\\/]+|\/(?:home|Users)\/)([^\\/\s"'`<>]+)/g)].map(m => m[1]);
// Scanner controls (gate rev_20260919000938_1nkh privacy-scan-case-and-allowlist): Windows paths are
// case-insensitive, so a lower-case drive path names a machine identity just the same.
const backslash = String.fromCharCode(92);
assert.deepEqual(homeNames(['C:', 'Users', 'someone', 'project'].join(backslash)), ['someone']);
assert.deepEqual(homeNames(['c:', 'users', 'someone', 'project'].join(backslash)), ['someone'], 'a lower-case Windows home path must be detected');
assert.deepEqual(homeNames('see /home/someone/x and /Users/other/y'), ['someone', 'other']);
assert.deepEqual(homeNames('https://api.example.invalid/users/octocat'), [], 'a URL path segment is not a home directory');
for (const file of files) {
  const source = fs.readFileSync(new URL(file, root), 'utf8');
  const homes = homeNames(source);
  assert.ok(homes.every(name => /^(?:fixture|example|user|username)$/.test(name)), `${file}: use explicit placeholder homes, not machine identities`);
  assert.ok(!/[A-Za-z]:[\\/]+1code projects[\\/]+/i.test(source), `${file}: use repository-relative documentation paths`);
}
console.log(`${files.length} public text files and media fixtures contain only explicit placeholder home paths.`);
