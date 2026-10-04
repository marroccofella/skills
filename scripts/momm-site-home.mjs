// The homepage presents existing approved media, not promised or held films.
import {runtimeLabel} from './momm-site-videos.mjs';
import {homeWorkflow} from './momm-site-flow.mjs';
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
export function homeCinema(tour,version,companions=[]){
  if(tour.status!=='accepted'||tour.schema!=='momm-tour/2')return `<section id="walkthrough" class="home-cinema"><p class="eyebrow">PUT MOMM TO WORK</p><h2>Install. Connect. Review. Verify.</h2><p>Open the practical guides and inspect an actual review.</p><div class="actions"><a class="button primary" href="start.html">Installation and Setup Center</a><a class="button" href="evidence.html#real-review">Real findings and decisions</a><a class="button" href="../evidence/index.html">Explore the public example ledger</a></div></section>`;
  const choices=[
    ['install','Install and connect','From the install prompt to your reviewer accounts.','start.html','Read the setup guide'],
    ['setup','Your dashboard','Choose the governor, connect reviewers and check versions.','start.html#connect','Open the dashboard guide'],
    ['ledger','Inside a real review','See who said what, what changed, and why.','evidence.html#real-review','Inspect the evidence'],
    ['quality','Why add a review team?','Challenge blind spots. Keep one agent responsible for verification.','technical.html#stacking','Understand the trade-offs'],
  ];
  const chapters=choices.map(([id,title,description,guide,guideLabel])=>{const chapter=tour.chapters.find(c=>c.id===id);if(!chapter)throw Error('Homepage video chapter missing: '+id);return {id,title,description,guide,guideLabel,chapter};});
  return `<section id="walkthrough" class="home-cinema"><div class="cinema-heading"><div><p class="eyebrow">WATCH MOMM AT WORK</p><h2>See it. Understand it.<br><span>Use it on your next change.</span></h2></div><p>Start with the film, or jump straight to the part you need. Real screens. A real review. Practical next steps.</p></div><div class="cinema-feature"><div class="cinema-screen"><div class="poster-player"><video id="home-film" controls playsinline preload="metadata" poster="tour/poster.jpg" aria-label="MOMM practical introduction"><source src="tour/walkthrough.mp4" type="video/mp4"><track kind="captions" label="English (also in picture)" srclang="en" src="tour/captions.vtt"><p><a href="tour/walkthrough.mp4">Download the introduction</a></p></video><a class="film-start" data-play="home-film" href="watch/overview.html" aria-label="Play the MOMM introduction"><span aria-hidden="true">▶</span> Play introduction</a></div><div class="film-caption"><span>THE PRACTICAL INTRODUCTION</span><span>${esc(runtimeLabel(tour.duration_seconds))} · captioned</span></div></div><div class="cinema-copy"><p class="eyebrow">KEEP YOUR AGENT. ADD THE REVIEW TEAM.</p><h3>From a second opinion<br>to a decision you can check.</h3><p>Understand what MOMM does, install it in your harness, connect your tools, and see the governor turn reviewer claims into recorded decisions.</p><a class="button primary" href="watch/overview.html">Watch with chapters &amp; transcript →</a><a class="text-link" href="releases/upgrade.html">Copy the install / upgrade prompt →</a><p>Video narration: <a href="https://www.promptus.ai/"><strong>Built with Promptus</strong> · promptus.ai ↗</a></p></div></div><p class="film-provenance">Recorded ${esc(tour.recorded_date)} with MOMM ${esc(tour.version)} · consented synthetic Dom narration at ${esc(tour.narration_speed)}×.${tour.version!==version?` Current release: ${esc(version)}; check the version notes.`:''} These chapter links play the same introduction, not four separate films.</p><p><a class="text-link" href="media.html">Browse setup guides and short films in the media gallery →</a></p><p id="home-player-status" role="status" aria-live="polite"></p><div class="chapter-heading"><h3>Just need one part?</h3><p>Play a chapter from the introduction, here on this page.</p></div><div class="cinema-chapters">${chapters.map(c=>`<article><a class="chapter-frame" data-play="home-film" data-time="${c.chapter.start}" href="watch/overview.html?t=${c.chapter.start}" aria-label="Watch ${esc(c.title)} from ${stamp(c.chapter.start)}"><img src="tour/scene-${c.id}.jpg" width="640" height="360" alt="" loading="lazy"><span class="chapter-play" aria-hidden="true">▶</span><span class="chapter-time">${stamp(c.chapter.start)}</span></a><div class="chapter-copy"><h3><a data-play="home-film" data-time="${c.chapter.start}" href="watch/overview.html?t=${c.chapter.start}">${esc(c.title)}</a></h3><p>${esc(c.description)}</p><a href="${c.guide}">${esc(c.guideLabel)} →</a></div></article>`).join('')}</div></section>`;
}
export function companionFilms(films,version){
  return '<div class="companion-grid">'+films.filter(f=>f.status==='accepted').map(f=>{
    if(!['setup','trailer'].includes(f.id))throw Error('Unknown homepage film');
    const id=f.id, title=id==='setup'?'Dashboard & setup':'The MOMM trailer';
    return `<article class="companion-film"><div class="poster-player"><video id="home-${id}" controls playsinline preload="none" poster="films/${id}/poster.jpg" aria-label="${title}"><source src="films/${id}/walkthrough.mp4" type="video/mp4"><track kind="captions" srclang="en" label="English (also in picture)" src="films/${id}/captions.vtt"><p><a href="films/${id}/walkthrough.mp4">Download video</a></p></video><a class="film-start" data-play="home-${id}" href="watch/${id}.html" aria-label="Play ${title} here"><span aria-hidden="true">▶</span> Play ${id==='setup'?'setup guide':'trailer'}</a></div><div class="companion-copy"><p class="eyebrow">${id==='setup'?'THE PRACTICAL WALKTHROUGH':'THE BIG IDEA'} · ${esc(runtimeLabel(f.duration_seconds))}</p><h3>${title}</h3><p>${esc(f.description)}</p><a href="watch/${id}.html">Chapters, transcript &amp; share →</a><p class="film-provenance">Recorded ${esc(f.recorded_date)} with MOMM ${esc(f.version)}. Consented synthetic Dom voice at ${esc(f.narration_speed)}×.${f.version!==version?' Current release: '+esc(version)+'.':''}</p></div></article>`;
  }).join('')+'</div>';
}
export function homeDiagrams(){
  return homeWorkflow();
}
// One release status line for the home page and the root README (1.17.1 S10), made from the manifest
// and the release catalogue so neither is edited by hand. Stable is the newest published release; a
// newest entry that is still version notes is a sealed candidate under test. Records that disagree
// are refused here, never rendered.
const newerVersion=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;};
export function releaseStatus(manifest,catalogue){
  if(!Array.isArray(catalogue)||!catalogue.length)throw Error('Release catalogue missing');
  for(const entry of catalogue)if(!/^\d+\.\d+\.\d+$/.test(entry.version)||(entry.notes_path&&entry.notes_path!==`momm/references/release-${entry.version}.md`))throw Error('Invalid release version or note path in the catalogue');
  // The newest entry and the stable release are read by position below, so the order is checked, not
  // assumed: an entry out of order, or a version listed twice, is refused rather than guessed around.
  for(let i=1;i<catalogue.length;i++)if(!newerVersion(catalogue[i].version,catalogue[i-1].version))throw Error(`The release catalogue is not in ascending version order: ${catalogue[i].version} follows ${catalogue[i-1].version}`);
  const newest=catalogue[catalogue.length-1],stable=[...catalogue].reverse().find(entry=>entry.kind==='release'&&entry.tag&&entry.published_date);
  if(!stable)throw Error('The release catalogue has no published release');
  const candidate=newest.kind==='version-notes'?newest:null;
  // Implied by the order check above; kept as a second guard on the claim the line makes.
  if(candidate&&!newerVersion(candidate.version,stable.version))throw Error(`Candidate ${candidate.version} is not newer than the stable release ${stable.version}`);
  const current=(candidate??stable).version;
  if(manifest.momm!==current)throw Error(`versions.json says ${manifest.momm}; the release catalogue says ${current} is ${candidate?'under test':'the stable release'}`);
  // "Signed" is the manifest's own record for that tag, not an assumption about every release.
  const signed=(manifest.momm_releases??[]).some(release=>release.version===stable.version&&release.tag===stable.tag&&!release.legacy_unsigned);
  const named=entry=>({version:entry.version,notes_path:entry.notes_path??null});
  return {stable:{...named(stable),signed},candidate:candidate&&named(candidate)};
}
const statusParts=(status,link)=>[
  ['Stable: ',`${status.stable.version} (${status.stable.signed?'signed tag':'tag, not signed'})`,link(status.stable)],
  ...(status.candidate?[['Candidate under test: ',`${status.candidate.version}, not released`,link(status.candidate)]]:[])];
export function releaseStatusHtml(status){
  return `<p class="micro" id="release-status">${statusParts(status,entry=>`releases/${entry.version}.html`).map(([label,text,href])=>`${label}<a href="${esc(href)}">${esc(text)}</a>`).join(' · ')}</p>`;
}
// The home page carries the line directly above its headline. A page that lost that headline, or repeats
// it, is refused: the home page is never rendered without its status line.
const HOME_HEADLINE='<h1>Give your AI agent';
export function homeWithReleaseStatus(html,status){
  if(html.split(HOME_HEADLINE).length!==2)throw Error('The home page must contain its headline exactly once to carry the release status line');
  return html.replace(HOME_HEADLINE,()=>releaseStatusHtml(status)+HOME_HEADLINE);
}
// The README links to the note in the same tree, which exists on every branch; the site page of a
// candidate is not live until its branch is merged.
export function releaseStatusMarkdown(status){
  return '**MOMM release status.** '+statusParts(status,entry=>entry.notes_path??`https://marroccofella.github.io/skills/momm/releases/${entry.version}.html`).map(([label,text,href])=>`${label}[${text}](${href})`).join(' · ');
}
// A README saved with CRLF line endings carries the same block; the line ending after the opening marker
// is captured so the replacement keeps it.
const README_STATUS=/<!-- momm-release-status:[^\r\n]*-->(\r?\n)[^\r\n]*\r?\n<!-- \/momm-release-status -->/g;
export const readmeStatusBlock=status=>`<!-- momm-release-status: generated by scripts/render-momm-site.mjs from versions.json and momm/references/release-history.json; do not edit -->\n${releaseStatusMarkdown(status)}\n<!-- /momm-release-status -->`;
export function withReleaseStatus(readme,status){
  if([...readme.matchAll(README_STATUS)].length!==1)throw Error('README.md must contain exactly one momm-release-status block');
  return readme.replace(README_STATUS,(_block,newline)=>readmeStatusBlock(status).replaceAll('\n',newline));
}
