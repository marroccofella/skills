import assert from 'node:assert/strict';
import fs from 'node:fs';
import {homeCinema,homeDiagrams,releaseStatus,releaseStatusHtml,releaseStatusMarkdown,readmeStatusBlock,withReleaseStatus} from './momm-site-home.mjs';
import {bindHomePlayers} from '../docs/momm/home-player.mjs';
const tour=JSON.parse(fs.readFileSync(new URL('../docs/momm/tour.json',import.meta.url)));
const data=JSON.parse(fs.readFileSync(new URL('../docs/evidence/momm-evidence.json',import.meta.url)));
const stats=JSON.parse(fs.readFileSync(new URL('../docs/momm/data/public-stats.json',import.meta.url)));
const cinema=homeCinema(tour,tour.version);
assert.equal((cinema.match(/<video /g)||[]).length,1);
assert.equal((cinema.match(/class="chapter-frame"/g)||[]).length,4);
for(const id of ['install','setup','ledger','quality'])assert(cinema.includes(`watch/overview.html?t=${tour.chapters.find(c=>c.id===id).start}`));
assert(cinema.includes('same introduction, not four separate films'));
assert(cinema.includes('synthetic Dom narration at 1.5×'));
assert(cinema.includes('Video narration: <a href="https://www.promptus.ai/"><strong>Built with Promptus</strong> · promptus.ai ↗</a>'));
assert(!cinema.includes('autoplay'));
assert(!cinema.includes('replacement video will appear'));
assert(!cinema.includes('127.0.0.1'));
const pending=homeCinema({...tour,status:'pending_voice_acceptance'},tour.version);
assert(!pending.includes('<video'));assert(!pending.includes('coming soon'));assert(pending.includes('start.html'));
assert(homeCinema(tour,'9.9.9').includes('Current release: 9.9.9'));
assert.throws(()=>homeCinema({...tour,chapters:[]},tour.version),/chapter missing/);
const diagrams=homeDiagrams(data,stats,tour.version);
assert.equal((diagrams.match(/<figure /g)||[]).length,1);
assert.equal((diagrams.match(/<details /g)||[]).length,1);
assert(diagrams.includes('Full technical paper'));
assert(diagrams.includes('all seven diagrams'));
assert(!diagrams.includes('following table'));
assert(!diagrams.includes('10% shared-blind-spot floor'));
const home=fs.readFileSync(new URL('../docs/momm/index.html',import.meta.url),'utf8');
assert.equal((home.match(/id="walkthrough"/g)||[]).length,1);
assert.equal((home.match(/MOMM HOME COMPANIONS/g)||[]).length,1);
assert(home.indexOf('id="architecture-library"')<home.indexOf('id="walkthrough"'));
assert.equal((home.match(/<figure /g)||[]).length,1);
assert(!home.includes('private-draft-films'));
assert(!home.includes('The written walkthrough below is ready.'));
assert.equal((home.match(/<video /g)||[]).length,1);
assert.equal((home.match(/class="film-start"/g)||[]).length,1);
assert(home.includes('home-player.mjs'));
assert(!home.includes('films/ledger/'));
const films=JSON.parse(fs.readFileSync(new URL('../docs/momm/films.json',import.meta.url)));
assert.equal((homeCinema(tour,tour.version,films).match(/<video /g)||[]).length,1);
assert.equal((homeCinema(tour,tour.version,films.map(f=>({...f,status:'pending'}))).match(/<video /g)||[]).length,1);
// 1.17.1 S10: a tester could not tell where 1.17 lived or whether it was released. One status line, made
// from the manifest and the release catalogue, says which version is stable and which is under test.
{
  const plain=html=>html.replace(/<[^>]+>/g,'');
  const stableRow={version:'1.17.0',kind:'release',tag:'momm-1.17.0',published_date:'2026-10-03T17:50:26Z',notes_path:'momm/references/release-1.17.0.md'};
  const notesRow={version:'1.17.1',kind:'version-notes',notes_path:'momm/references/release-1.17.1.md'};
  const manifestFor=(version,rows=[{version:'1.17.1',tag:'momm-1.17.1'},{version:'1.17.0',tag:'momm-1.17.0'},{version:'1.14.1',tag:'momm-1.14.1',legacy_unsigned:true}])=>({momm:version,momm_releases:rows});
  // A sealed candidate that is not published: the stable release and the candidate, each with its link.
  const testing=releaseStatus(manifestFor('1.17.1'),[stableRow,notesRow]);
  assert.equal(plain(releaseStatusHtml(testing)),'Stable: 1.17.0 (signed tag) · Candidate under test: 1.17.1, not released');
  assert(releaseStatusHtml(testing).includes('<a href="releases/1.17.0.html">1.17.0 (signed tag)</a>')&&releaseStatusHtml(testing).includes('<a href="releases/1.17.1.html">1.17.1, not released</a>'));
  assert.equal(releaseStatusMarkdown(testing),'**MOMM release status.** Stable: [1.17.0 (signed tag)](momm/references/release-1.17.0.md) · Candidate under test: [1.17.1, not released](momm/references/release-1.17.1.md)');
  // After publication the same entry is a release: one stable version and no candidate.
  const publishedRow={...notesRow,kind:'release',tag:'momm-1.17.1',published_date:'2026-10-05T00:00:00Z'};
  const released=releaseStatus(manifestFor('1.17.1'),[stableRow,publishedRow]);
  assert.equal(plain(releaseStatusHtml(released)),'Stable: 1.17.1 (signed tag)');
  assert.equal(releaseStatusMarkdown(released),'**MOMM release status.** Stable: [1.17.1 (signed tag)](momm/references/release-1.17.1.md)');
  assert(!/Candidate|1\.17\.0/.test(releaseStatusHtml(released)+releaseStatusMarkdown(released)));
  // The line never claims more than the records say.
  assert.throws(()=>releaseStatus(manifestFor('1.17.0'),[stableRow,notesRow]),/versions\.json says 1\.17\.0/,'the manifest must name the candidate while one is under test');
  assert.throws(()=>releaseStatus(manifestFor('1.17.2'),[stableRow,publishedRow]),/versions\.json says 1\.17\.2/,'the manifest must name the stable release when nothing is under test');
  assert.throws(()=>releaseStatus(manifestFor('1.17.1'),[notesRow]),/no published release/i);
  assert.throws(()=>releaseStatus(manifestFor('1.16.9'),[stableRow,{version:'1.16.9',kind:'version-notes'}]),/not newer than the stable release/,'a candidate cannot be older than the stable release');
  assert.throws(()=>releaseStatus(manifestFor('1.17.1'),[]),/catalogue/i);
  assert.throws(()=>releaseStatus(manifestFor('<b>'),[stableRow,{...notesRow,version:'<b>'}]),/version/i,'a version is three numbers, never markup');
  // "Signed" is read from the manifest, never assumed; a note without its own file links to its site page.
  const legacy=releaseStatus(manifestFor('1.14.1'),[{version:'1.14.1',kind:'release',tag:'momm-1.14.1',published_date:'2026-09-04T15:59:07Z'}]);
  assert.equal(plain(releaseStatusHtml(legacy)),'Stable: 1.14.1 (tag, not signed)');
  assert(releaseStatusMarkdown(legacy).includes('](https://marroccofella.github.io/skills/momm/releases/1.14.1.html)'));
  // The README keeps its line between two markers, so the renderer replaces it and nobody edits it by hand.
  const stale=`# skills\n\n${readmeStatusBlock(testing)}\n\nText.\n`;
  assert.equal(withReleaseStatus(stale,released),`# skills\n\n${readmeStatusBlock(released)}\n\nText.\n`);
  assert.equal(withReleaseStatus(stale,testing),stale,'an up-to-date README is left byte for byte');
  assert(readmeStatusBlock(testing).split('\n').length===3&&readmeStatusBlock(testing).split('\n')[1]===releaseStatusMarkdown(testing));
  assert.throws(()=>withReleaseStatus('# skills\n',released),/exactly one/);
  assert.throws(()=>withReleaseStatus(stale+stale,released),/exactly one/);
  // The published home page carries today's line exactly once, directly under the version pill.
  const manifestNow=JSON.parse(fs.readFileSync(new URL('../versions.json',import.meta.url),'utf8'));
  const catalogueNow=JSON.parse(fs.readFileSync(new URL('../momm/references/release-history.json',import.meta.url),'utf8'));
  const line=releaseStatusHtml(releaseStatus(manifestNow,catalogueNow));
  assert.equal(home.split(line).length-1,1,'the home page must carry the generated status line once: run node scripts/render-momm-site.mjs');
  assert.equal((home.match(/id="release-status"/g)||[]).length,1);
  assert(home.indexOf('class="release-pill"')<home.indexOf(line)&&home.indexOf(line)<home.indexOf('<h1>'),'the status line sits between the version pill and the headline');
}
const listeners={},links=[{dataset:{play:'home-film',time:'113.14'},addEventListener(k,fn){this.click=fn;}},{dataset:{play:'home-setup'},addEventListener(k,fn){this.click=fn;}}];
const makeVideo=id=>({id,readyState:1,duration:220,currentTime:0,paused:true,addEventListener(k,fn){listeners[id+':'+k]=fn;},focus(){},scrollIntoView(){},getAttribute(){return id;},play(){this.paused=false;listeners[id+':play']();return Promise.resolve();},pause(){this.paused=true;}});
const main=makeVideo('home-film'),setup=makeVideo('home-setup'),status={},overlay={hidden:false};
const doc={querySelectorAll(q){return q==='[data-play]'?links:[main,setup];},querySelector(){return overlay;},getElementById(id){return {'home-film':main,'home-setup':setup,'home-player-status':status}[id];}};
bindHomePlayers(doc);let prevented=false;const click={button:0,preventDefault(){prevented=true;}};
await links[0].click({...click,ctrlKey:true});assert(!prevented,'modified clicks retain fallback navigation');
await links[0].click(click);assert(prevented);assert.equal(main.currentTime,113.14);assert.equal(main.paused,false);assert(overlay.hidden);
await links[1].click(click);assert(main.paused);assert(!setup.paused,'one film at a time');
links[0].dataset.time='9999';await links[0].click(click);assert.equal(main.currentTime,219.9);
main.readyState=0;links[0].dataset.time='34.08';await links[0].click(click);listeners['home-film:loadedmetadata']();assert.equal(main.currentTime,34.08);
main.play=()=>Promise.reject(Error('blocked'));await links[0].click(click);assert(status.textContent.includes('did not start'));
main.readyState=1;main.play=()=>{main.currentTime=0;return Promise.resolve();};links[0].dataset.time='189.3';await links[0].click(click);assert.equal(main.currentTime,189.3,'reapply chapter seek if initial media playback resets it');
console.log('Homepage: one approved introduction, in-page playable thumbnails, exact seeking, one audio stream, fallback links, one architecture overview and held-media exclusion pass.');
