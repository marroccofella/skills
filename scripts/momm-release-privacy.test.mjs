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
const files = [...publicTextFiles('docs'), ...publicTextFiles('momm/references'), 'momm/scripts/capabilities.test.mjs', 'momm/scripts/modality.test.mjs'];
for (const file of files) {
  const source = fs.readFileSync(new URL(file, root), 'utf8');
  const homes = [...source.matchAll(/(?:[A-Za-z]:[\\/]+Users[\\/]+|\/(?:home|Users)\/)([^\\/\s"'`<>]+)/g)].map(m => m[1]);
  assert.ok(homes.every(name => /^(?:fixture|example|user|username)$/.test(name)), `${file}: use explicit placeholder homes, not machine identities`);
  assert.ok(!/[A-Za-z]:[\\/]+1code projects[\\/]+/i.test(source), `${file}: use repository-relative documentation paths`);
}
console.log(`${files.length} public text files and media fixtures contain only explicit placeholder home paths.`);
