import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {releasePages,inline,markdown} from './momm-release-pages.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),catalogue=JSON.parse(fs.readFileSync(path.join(root,'momm/references/release-history.json'))),pages=releasePages(root);
assert.equal(Object.keys(pages).length,catalogue.length+3);
assert(pages['docs/momm/releases/bootstrap.html'].includes('gitsign_missing'));
assert(pages['docs/momm/releases/bootstrap.html'].includes('cannot authenticate itself'));
assert(pages['docs/momm/releases/upgrade.html'].includes('href="bootstrap.html"'));
for(const e of catalogue){assert(pages[`docs/momm/releases/${e.version}.html`].includes(e.version));assert(pages[`docs/momm/releases/${e.version}.html`].includes(e.source_url));assert(pages['docs/momm/releases/index.html'].includes(`href="${e.version}.html"`));}
assert(!inline('[unsafe](javascript:alert) <img src=x onerror=alert(1)>').includes('<img'));
assert(!inline('[unsafe](javascript:alert)').includes('href='));assert(!inline('[unsafe](file:///private)').includes('href='));
assert(inline('[safe](https://example.com/?a=1&b=2)').includes('a=1&amp;b=2'));
assert(markdown('# Heading\n\n- first\n- second\n\n```js\n<script>\n```').includes('&lt;script&gt;'));
assert(markdown('| Route | State |\n| --- | --- |\n| Test | ready |').includes('<th scope="col">Route</th>'));
assert(markdown('- one long\n  item\n- second').includes('<li>one long item</li>'));
assert(inline('[older](release-1.10.1.md)').includes('href="1.10.1.html"'));
// Range review rev_20260925004814_1ed9f58c2c3a: an in-page link stays in the page (bootstrap.html sent the
// verifier link to a GitHub 404), and a code span inside bold text is rendered as code, not backticks.
assert.equal(inline('[x](#getting-the-verifier)'),'<a href="#getting-the-verifier">x</a>');
assert.equal(inline('**a `b`**'),'<strong>a <code>b</code></strong>');
assert(!fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'..','docs','momm','releases','bootstrap.html'),'utf8').includes('references/#'),'bootstrap.html links its own sections in-page');
assert(pages['docs/momm/releases/upgrade.html'].includes('data-copy="upgrade-prompt"'));
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'momm-release-catalogue-'));
try{fs.mkdirSync(path.join(fixture,'momm/references'),{recursive:true});const file=path.join(fixture,'momm/references/release-history.json');
 const first=catalogue[0];fs.writeFileSync(file,JSON.stringify([first,first]));assert.throws(()=>releasePages(fixture),/duplicate/);
 fs.writeFileSync(file,JSON.stringify([{...first,notes_path:'../private'}]));assert.throws(()=>releasePages(fixture),/Unsafe/);
 fs.writeFileSync(file,JSON.stringify([{...first,source_url:'https://evil.invalid/release'}]));assert.throws(()=>releasePages(fixture),/canonical/);
}finally{assert(path.basename(fixture).startsWith('momm-release-catalogue-'));assert.equal(fs.realpathSync(path.dirname(fixture)),fs.realpathSync(os.tmpdir()));fs.rmSync(fixture,{recursive:true,force:true});}
console.log(JSON.stringify({passed:true,entries:catalogue.length,checks:'coverage, original source links, markup escaping, unsafe URLs, duplicate identities and traversal refusal'}));
