import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import vm from 'node:vm';import {fileURLToPath}from'node:url';
import {watchOutputs,validateTour}from'./momm-site-videos.mjs';
import {normalizeNavigation} from './momm-site-community.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tour=JSON.parse(fs.readFileSync(path.join(root,'docs/momm/tour.json'))),version=JSON.parse(fs.readFileSync(path.join(root,'versions.json'))).momm;
assert.deepEqual(watchOutputs({...tour,status:'pending'},version,root),{});
assert.throws(()=>validateTour({...tour,video_sha256:'0'.repeat(64)},root),/hash mismatch/);
assert.throws(()=>validateTour({...tour,chapters:tour.chapters.map((c,i)=>i===1?{...c,start:0}:c)},root),/timing/);
const output=watchOutputs(tour,version,root);normalizeNavigation(output);const html=output['docs/momm/watch/overview.html'];assert.equal(fs.readFileSync(path.join(root,'docs/momm/watch/overview.html'),'utf8'),html);
const graph=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]),video=graph['@graph'].find(x=>x['@type']==='VideoObject');
assert.equal(video.hasPart.length,12);assert.equal(video.transcript,tour.chapters.map(c=>c.display_text).join('\n\n'));assert(video.contentUrl.startsWith('https://marroccofella.github.io/skills/'));assert.equal(video.uploadDate,tour.published_date);
assert(html.indexOf('<video')<html.indexOf('Full transcript'));assert(html.includes('id="share-video"'));assert(html.includes('id="copy-video"'));assert(!html.includes('autoplay'));
assert(!/file:\/\/|[A-Z]:\\|localhost|127\.0\.0\.1/.test(html));assert(!html.includes('awaiting approval'));
for(const m of html.matchAll(/(?:href|src)="([^"]+)"/g)){if(/^(?:https?:|mailto:|#|\?)/.test(m[1]))continue;const f=m[1].split('#')[0],dest=path.resolve(root,'docs/momm/watch',f);assert(fs.existsSync(dest),'missing watch link '+f);}
for(const c of tour.chapters){assert(html.includes('id="chapter-'+c.id+'"'));assert(video.hasPart.some(x=>x.startOffset===c.start));}
const js=fs.readFileSync(path.join(root,'docs/momm/watch.js'),'utf8');new vm.Script(js);assert(!/fetch\(|localStorage|document\.cookie/.test(js),'sharing must not add tracking');
const listeners={},anchors=[],v={duration:220,currentTime:0,readyState:1,addEventListener(){},play(){return Promise.resolve();}},status={};
const document={getElementById(id){return id==='watch-video'?v:id==='share-status'?status:null;},querySelectorAll(){return anchors;},querySelector(){return{href:'https://marroccofella.github.io/skills/momm/watch/overview.html'};}};
const context={document,location:{href:'https://marroccofella.github.io/skills/momm/watch/overview.html?t=113.14'},URL,window:{addEventListener(k,fn){listeners[k]=fn;}},navigator:{},history:{}};
vm.runInNewContext(js+'\nseek(999999);',context);assert.equal(v.currentTime,219.9);context.location.href='https://marroccofella.github.io/skills/momm/watch/overview.html?t=34';listeners.popstate();assert.equal(v.currentTime,34);
assert(fs.readFileSync(path.join(root,'docs/sitemap.xml'),'utf8').includes('/momm/watch/overview.html'));assert(output['docs/video-sitemap.xml'].includes('<video:content_loc>'));
console.log(JSON.stringify({passed:true,approved_media_hashes:true,chapters:12,structured_data:true,deep_link_logic:true,privacy:true}));
const companions=JSON.parse(fs.readFileSync(path.join(root,'docs/momm/films.json')));
for(const f of companions){
  const pages=watchOutputs(f,version,root,f.id);normalizeNavigation(pages);const page=pages[`docs/momm/watch/${f.id}.html`];
  assert.equal(page,fs.readFileSync(path.join(root,`docs/momm/watch/${f.id}.html`),'utf8'));
  assert(page.includes(`../films/${f.id}/walkthrough.mp4`));
  assert(page.includes(`<h1>${f.title.replaceAll('&','&amp;')}</h1>`));
  const entity=JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'].find(e=>e['@type']==='VideoObject');
  assert.equal(entity.transcript,f.chapters.map(c=>c.display_text).join('\n\n'));
  assert(entity.contentUrl.endsWith(`/films/${f.id}/walkthrough.mp4`));
}
assert.throws(()=>watchOutputs(tour,version,root,'../secret'),/Unknown/);
assert.equal((fs.readFileSync(path.join(root,'docs/video-sitemap.xml'),'utf8').match(/<video:video>/g)||[]).length,3);
// Range review rev_20260925004814_1ed9f58c2c3a (caption-splits-on-periods): the preview film's captions split
// "1.16", "git.exe" and the site address at their dots, so a cue read "Version 1." and the next "16 adds".
// No caption file may end a cue on a dot that the next cue continues with a digit or a lower-case letter.
for (const folder of fs.readdirSync(path.join(root, 'docs/momm/films'), { withFileTypes: true }).filter(d => d.isDirectory())) {
  const file = path.join(root, 'docs/momm/films', folder.name, 'captions.vtt');
  if (!fs.existsSync(file)) continue;
  const cues = fs.readFileSync(file, 'utf8').replace(/\r/g, '').split(/\n\n+/).map(b => b.split('\n')).filter(l => l.some(x => x.includes('-->')));
  const text = c => c.slice(c.findIndex(x => x.includes('-->')) + 1).join(' ').trim();
  for (let i = 0; i < cues.length - 1; i++) {
    const a = text(cues[i]), b = text(cues[i + 1]);
    assert(!(/\S\.$/.test(a) && /^[0-9a-z]/.test(b)), `${folder.name}/captions.vtt splits a word or number between cues: "${a.slice(-30)}" | "${b.slice(0, 30)}"`);
  }
}
// Range review rev_20260925131115_6ed35d0bdf89 (grok suggestions 11, 69, 62; antigravity 36): runtimes said
// "0 minutes 51 seconds", and the skip link landed before the breadcrumb instead of on the video.
{
  const { runtimeLabel } = await import('./momm-site-videos.mjs');
  assert.equal(runtimeLabel(51), '51 seconds');
  assert.equal(runtimeLabel(61), '1 minute 1 second');
  assert.equal(runtimeLabel(212.4), '3 minutes 32 seconds');
  for (const page of ['overview', 'setup', 'trailer']) assert(fs.readFileSync(path.join(root, 'docs/momm/watch', page + '.html'), 'utf8').includes('<a class="skip" href="#watch-video">Skip to video</a>'), page + ': skip link lands on the video');
}
