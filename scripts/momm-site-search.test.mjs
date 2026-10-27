import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SITE,PROMPTUS,BIO_SOURCE,UNLV_SOURCE,canonicalUrl,pageMetadata,enhanceSearch,addAttribution,evidenceBenefits,answers,definition} from './momm-site-search.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives

// A verified landing page can have a body without a footer. Keep attribution
// inside that body and stable when the deterministic renderer runs again.
{
  const output={'docs/index.html':'<!doctype html><html><head><meta name="msvalidate.01" content="test"></head><body><main>Skill directory</main>\n</body></html>\n'};
  addAttribution(output);
  const once=output['docs/index.html'];
  assert(once.indexOf('<!-- MOMM CREDIT START -->')<once.indexOf('</body>'),'attribution must stay inside an explicit body');
  assert.equal((once.match(/MOMM CREDIT START/g)||[]).length,1);
  assert(once.includes('<meta name="msvalidate.01" content="test">'));
  addAttribution(output);assert.equal(output['docs/index.html'],once,'body-only landing page must render idempotently');
  for(const raw of ['<script>const example="</body>";</script>','<!-- example </body> -->','<textarea>example </body></textarea>']) {
    const fixture={'t.html':'<!doctype html><html><body>'+raw+'<main>Directory</main>\n</body></html><!-- trailing </body> -->\n'};
    addAttribution(fixture);const result=fixture['t.html'];assert(result.includes(raw),'raw text stays untouched');
    assert(result.indexOf('MOMM CREDIT START')>result.indexOf('</main>'));
    assert(result.indexOf('MOMM CREDIT START')<result.indexOf('</body></html>'));
    addAttribution(fixture);assert.equal(fixture['t.html'],result);
  }
  assert.throws(()=>addAttribution({'broken.html':'<html><body></body><script></script></html>'}),/Unsupported closing body boundary: broken\.html/);
  const fragment={'fragment.html':'<main>Directory</main>'};addAttribution(fragment);const rendered=fragment['fragment.html'];
  assert(rendered.includes('<main>Directory</main>'));addAttribution(fragment);assert.equal(fragment['fragment.html'],rendered);
}

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalogue=JSON.parse(fs.readFileSync(path.join(root,'momm/references/release-history.json')));
const version=JSON.parse(fs.readFileSync(path.join(root,'versions.json'))).momm;
const files=['index.html','start.html','updates.html','evidence.html','technical.html','reference.html','data/index.html','releases/index.html','releases/upgrade.html',...catalogue.map(r=>`releases/${r.version}.html`)].map(f=>'docs/momm/'+f).concat('docs/evidence/index.html');
const seenTitles=new Set(),seenDescriptions=new Set(),seenCanonicals=new Set();
const sitemap=fs.readFileSync(path.join(root,'docs/sitemap.xml'),'utf8');
const decode=s=>s.replace(/&(?:amp|lt|gt|quot|#39);/g,c=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[c]));
for(const file of files){
  const html=fs.readFileSync(path.join(root,file),'utf8'),meta=pageMetadata(file,catalogue),url=canonicalUrl(file);
  assert.equal(decode(html.match(/<title>(.*?)<\/title>/s)?.[1]||''),meta.title,file+': title');
  const descriptions=[...html.matchAll(/<meta name="description" content="([^"]*)">/g)];
  assert.equal(descriptions.length,1,file+': one description');
  assert.equal(decode(descriptions[0][1]),meta.description);
  assert(meta.description.length<=190,file+': concise description, not a fixed search-engine display limit');
  const links=[...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)];
  assert.equal(links.length,1,file+': one canonical');assert.equal(links[0][1],url);
  assert(sitemap.includes(`<loc>${url}</loc>`),file+': canonical in sitemap');
  for(const [set,value] of [[seenTitles,meta.title],[seenDescriptions,meta.description],[seenCanonicals,url]]){assert(!set.has(value),file+': duplicate metadata');set.add(value);}
  const structured=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(structured.length,1,file+': one structured graph');
  const data=JSON.parse(structured[0][1]);assert.equal(data['@context'],'https://schema.org');
  const page=data['@graph'].find(n=>n['@type']==='WebPage');assert.equal(page.url,url);assert.equal(page.name,meta.title);assert.equal(page.description,meta.description);
  const breadcrumbs=data['@graph'].find(n=>n['@type']==='BreadcrumbList').itemListElement;
  assert.equal(breadcrumbs.at(-1).item,url);assert.deepEqual(breadcrumbs.map(x=>x.position),breadcrumbs.map((_,i)=>i+1));
  if(file.startsWith('docs/momm/'))assert(html.includes('aria-label="Breadcrumb"'),file+': visible breadcrumb');
  assert(!/"(?:aggregateRating|reviewRating|VideoObject|SearchAction)"/.test(structured[0][1]),file+': no invented ratings, unavailable media or search');
  assert(!/<meta[^>]*name="robots"[^>]*content="[^"]*(?:noindex|nosnippet)/i.test(html),file+': indexable metadata');
  assert.equal((html.match(/<!-- MOMM CREDIT START -->/g)||[]).length,1,file+': one visible attribution');
  assert(html.includes(`href="${PROMPTUS}"`),file+': Promptus backlink');
  assert(html.includes(`<a href="${PROMPTUS}">Built with Promptus · promptus.ai ↗</a>`),file+': visible built-with credit and domain');
  if(meta.release)assert.equal(page.citation,meta.release.source_url);
}
const home=fs.readFileSync(path.join(root,'docs/momm/index.html'),'utf8');
// The watch generator owns its VideoObject; common metadata must remain unique.
for(const film of ['overview','setup','trailer']){
const watchFile=`docs/momm/watch/${film}.html`,watch=fs.readFileSync(path.join(root,watchFile),'utf8');
const watchFixture={[watchFile]:watch};enhanceSearch(watchFixture,{version,catalogue});assert.equal(watchFixture[watchFile],watch,'watch metadata is explicitly preserved');
for(const [set,re] of [[seenTitles,/<title>(.*?)<\/title>/s],[seenDescriptions,/<meta name="description" content="([^"]*)">/],[seenCanonicals,/<link rel="canonical" href="([^"]+)">/]]){const matches=[...watch.matchAll(new RegExp(re.source,re.flags+'g'))];assert.equal(matches.length,1);assert(!set.has(decode(matches[0][1])),'watch metadata must be unique');set.add(decode(matches[0][1]));}
assert(fs.readFileSync(path.join(root,'docs/sitemap.xml'),'utf8').includes(`/momm/watch/${film}.html`));
}
assert(home.includes(definition),'definition visible without JavaScript');
assert(home.includes(`"version":"${version}"`),'software version follows manifest');
assert(home.includes(BIO_SOURCE)&&home.includes(UNLV_SOURCE),'dated biography sources remain linked');
assert(home.includes('not confirmation of current university appointments'),'historic roles must not imply current appointments');
assert(home.includes('Promptus is not required to run'),'voice credit is not a claimed reviewer dependency');
assert(!/two.year|2.year|since 2024/i.test(home),'do not insert an unverified two-year origin claim');
const reference=decode(fs.readFileSync(path.join(root,'docs/momm/reference.html'),'utf8'));
for(const [id,question,answer] of answers){assert(reference.includes(`id="${id}"`));assert(reference.includes(question));assert(reference.includes(answer));}
assert.equal(canonicalUrl('docs/momm/data/index.html'),SITE+'momm/data/');
assert.throws(()=>canonicalUrl('docs/../private.html'));
assert.throws(()=>pageMetadata('docs/momm/unknown.html',catalogue));
const dangerous=[{version:'9.9.9',kind:'version-notes',summary:'A "quoted" </script><script>alert(1)</script> & text.',source_url:'https://github.com/marroccofella/skills/commit/fixture'}];
const fixture={'docs/momm/releases/9.9.9.html':'<html><head><title>old</title></head><body><main id="main">Test</main></body></html>'};
enhanceSearch(fixture,{version:'9.9.9',catalogue:dangerous});
const escaped=fixture['docs/momm/releases/9.9.9.html'];
assert(!escaped.includes('</script><script>alert'));
const record=JSON.parse(escaped.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
assert(record['@graph'][0].description.includes('</script>'),'serialization retains data without creating script tags');
// The persisted public ledger is also a template; repeated builds must not
// append metadata or mutate its original UI and embedded evidence.
const ledger={'docs/evidence/index.html':fs.readFileSync(path.join(root,'docs/evidence/index.html'),'utf8')};
const before=ledger['docs/evidence/index.html'];enhanceSearch(ledger,{version,catalogue});assert.equal(ledger['docs/evidence/index.html'],before);
addAttribution(ledger);assert.equal(ledger['docs/evidence/index.html'],before,'credit re-render is idempotent');
const hub={'docs/index.html':fs.readFileSync(path.join(root,'docs/index.html'),'utf8')};const hubBefore=hub['docs/index.html'];addAttribution(hub);assert.equal(hub['docs/index.html'],hubBefore);
assert.equal((hubBefore.match(/<!-- MOMM CREDIT START -->/g)||[]).length,1,'hub credit appears exactly once');
assert(hubBefore.includes(`href="${PROMPTUS}"`),'hub includes the Promptus backlink');
const indented={'docs/fixture.html':'<footer>\n  </footer>'};addAttribution(indented);
assert(!/^[ \t]+$/m.test(indented['docs/fixture.html']),'credit insertion must not strand footer indentation');
assert(indented['docs/fixture.html'].includes('Optional F5 narration'),'do not misattribute browser-native ledger speech to Promptus');
const stats=JSON.parse(fs.readFileSync(path.join(root,'docs/momm/data/public-stats.json'))),evidence=fs.readFileSync(path.join(root,'docs/momm/evidence.html'),'utf8');
assert(evidence.includes(evidenceBenefits(stats)),'benefit counts derive from the same public snapshot');
assert(evidence.includes('No controlled AI-alone versus AI-plus-MOMM comparison'),'no invented causal improvement');
assert(evidenceBenefits({...stats,decisions:{...stats.decisions,applied:7}}).includes('7 recorded applied decisions'),'changed data cannot leave a hardcoded applied total');
console.log(JSON.stringify({passed:true,pages:files.length,checks:'unique metadata, canonical/sitemap alignment, JSON-LD, visible answers, safe serialization, stable ledger rendering'}));
