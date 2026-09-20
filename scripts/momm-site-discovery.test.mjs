import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {llmsText} from './momm-site-discovery.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const version=JSON.parse(read('versions.json')).momm;
const text=read('docs/momm/llms.txt');
assert.equal(text,llmsText(version),'published text matches the versioned generator');
assert(read('scripts/render-momm-site.mjs').includes("output['docs/momm/llms.txt'] = llmsText(version);"),'renderer keeps the versioned guide wired into its output set');
assert(fs.existsSync(path.join(root,'docs/.nojekyll')),'raw Markdown documentation requires Pages without Jekyll processing');
const hub=read('docs/index.html');
assert(hub.includes('<meta name="google-site-verification" content="MmBxQeWgAlwSuRf05d7MuOxD0jiPd0pcTz8Frgwzd94" />'),'preserve Google ownership proof');
assert(hub.includes('<meta name="msvalidate.01" content="D7210BC76760DE231028BABCE8EF7984" />'),'preserve Bing ownership proof');
assert(text.startsWith('# MOMM — Mixture of Model Modality\n'));
assert(llmsText('9.9.9').includes('/releases/9.9.9.html'),'release links follow version changes');
assert.throws(()=>llmsText('1.0.0\nInjected'));
for(const phrase of ['sole writer and verifier','zero model calls','not API keys','off by default','--min-success 2','redaction is not a confidentiality guarantee','not a synthetic modality probe','--dry-run']) assert(text.includes(phrase),phrase);
assert(text.indexOf('preparing and verifying')<text.indexOf('node momm/scripts/install.mjs'));
for(const match of text.matchAll(/https:\/\/marroccofella\.github\.io\/skills\/[^\s)]+/g)) {
  let relative=new URL(match[0]).pathname.slice('/skills/'.length);
  if(relative.endsWith('/')) relative+='index.html';
  // GitHub Pages serves the established spoken /momm/install URL as install.html.
  if(relative==='momm/install') relative+='.html';
  assert(fs.existsSync(path.join(root,'docs',relative)),`broken documentation link: ${relative}`);
}
const home=read('docs/momm/index.html');
const visible=home.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
assert(visible.includes('href="llms.txt"'),'ordinary HTML discovery link');
assert(visible.includes('href="../sitemap.xml"'),'project sitemap linked from homepage');
for(const word of ['governor','reviewer','quorum','Install in one line']) assert(visible.includes(word),`${word} available without JS or video`);
assert(home.includes('<meta name="robots" content="index,follow">'));
const sitemap=read('docs/sitemap.xml');
for(const page of ['', 'install.html','start.html','reference.html','evidence.html',`releases/${version}.html`]) assert(sitemap.includes(`<loc>https://marroccofella.github.io/skills/momm/${page}</loc>`));
for(const name of fs.readdirSync(path.join(root,'docs/momm/watch')).filter(n=>n.endsWith('.html'))) {
  const html=read(`docs/momm/watch/${name}`);
  if(/<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(html)) {
    assert(!sitemap.includes(`/watch/${name}`),`${name}: noindex film remains outside sitemap`);
  }
}
assert(read('.gitattributes').includes('docs/momm/llms.txt text eol=lf'),'generated text retains LF on Windows');
console.log(JSON.stringify({passed:true,checks:'version-bound llms guide, safety boundaries, documentation links, static HTML and sitemap'}));
