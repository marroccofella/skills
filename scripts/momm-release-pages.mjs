import fs from 'node:fs';
import path from 'node:path';
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds = {'release':'Published release','tag':'Historical tag · no Release record','code-history':'Public code history · no release tag','version-notes':'Version notes · publication verified separately'};
const base = 'https://github.com/marroccofella/skills/blob/main/momm/references/';
export function inline(text) {
  let output='',at=0;
  for(const m of text.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g)){
    output+=escape(text.slice(at,m.index));
    if(m[3])output+='<code>'+escape(m[3])+'</code>';
    else if(m[4])output+='<strong>'+escape(m[4])+'</strong>';
    else {let href;const sibling=m[2].match(/^release-(\d+\.\d+\.\d+)\.md(#[A-Za-z0-9_-]+)?$/);try{const url=new URL(m[2],base);if(url.protocol==='https:')href=sibling?sibling[1]+'.html'+(sibling[2]||''):url.href;}catch{}
      output+=href?`<a href="${escape(href)}">${escape(m[1])}</a>`:escape(m[0]);}
    at=m.index+m[0].length;
  }
  return output+escape(text.slice(at));
}
export function markdown(text) {
  const out=[];let paragraph=[],list=[],fence=null;
  const flush=()=>{if(paragraph.length){out.push('<p>'+inline(paragraph.join(' '))+'</p>');paragraph=[];}if(list.length){out.push('<ul>'+list.map(s=>'<li>'+inline(s)+'</li>').join('')+'</ul>');list=[];}};
  const lines=text.replaceAll('\r\n','\n').split('\n');
  const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(s=>s.trim());
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(line.startsWith('```')){if(fence){out.push('<pre><code>'+escape(fence.join('\n'))+'</code></pre>');fence=null;}else{flush();fence=[];}continue;}
    if(fence){fence.push(line);continue;}
    if(line.trim().startsWith('|')&&lines[i+1]?.trim().startsWith('|')&&cells(lines[i+1]).every(c=>/^:?-{3,}:?$/.test(c))){
      flush();const headers=cells(line),rows=[];i++;
      while(lines[i+1]?.trim().startsWith('|')){const row=cells(lines[++i]);if(row.length!==headers.length)throw Error('Release table column mismatch');rows.push(row);}
      out.push('<div class="table-wrap"><table><thead><tr>'+headers.map(s=>'<th scope="col">'+inline(s)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(s=>'<td>'+inline(s)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>');continue;
    }
    const heading=line.match(/^(#{1,6})\s+(.+)/),bullet=line.match(/^\s*[-*]\s+(.+)/);
    if(heading){flush();const level=Math.min(4,heading[1].length+1);out.push(`<h${level}>${inline(heading[2])}</h${level}>`);}
    else if(bullet){if(paragraph.length)flush();list.push(bullet[1]);}
    else if(!line.trim())flush();
    else if(list.length&&/^\s{2,}\S/.test(line))list[list.length-1]+=' '+line.trim();
    else{if(list.length)flush();paragraph.push(line);}
  }
  flush();if(fence)out.push('<pre><code>'+escape(fence.join('\n'))+'</code></pre>');return out.join('\n');
}
const shell=(title,body)=>`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · MOMM</title><link rel="stylesheet" href="../site.css"><script src="../site.js" defer></script></head><body><a class="skip" href="#main">Skip to content</a><header class="site-header"><a class="brand" href="../index.html"><span class="mark">◆</span> momm <span class="brand-note">by 42.uk</span></a><nav aria-label="Release navigation"><a href="index.html">All versions</a><a href="../updates.html">Update safely</a><a href="../start.html">Get started</a></nav><a class="repo" href="https://github.com/marroccofella/skills">GitHub ↗</a></header><main id="main">${body}</main><footer><a href="https://42.uk">◆ 42.uk</a><p>RELAX. IT'S ALREADY OVER.</p><a href="https://github.com/marroccofella/skills/blob/main/LICENSE">MIT licence</a></footer></body></html>\n`;
export function releasePages(root) {
  const catalogue=JSON.parse(fs.readFileSync(path.join(root,'momm/references/release-history.json'),'utf8')),seen=new Set(),output={};
  if(!Array.isArray(catalogue)||!catalogue.length)throw Error('Release catalogue missing');
  for(const entry of catalogue){
    if(!/^\d+\.\d+\.\d+$/.test(entry.version)||seen.has(entry.version)||!kinds[entry.kind]||typeof entry.summary!=='string')throw Error('Invalid or duplicate release entry');seen.add(entry.version);
    const source=new URL(entry.source_url);if(source.origin!=='https://github.com'||!source.pathname.startsWith('/marroccofella/skills/'))throw Error('Release provenance must name the canonical repository');
    let notes;
    if(entry.notes_path){if(entry.notes_path!==`momm/references/release-${entry.version}.md`)throw Error('Unsafe release note path');notes=fs.readFileSync(path.join(root,entry.notes_path),'utf8');}
    else notes='## Historical change record\n\n'+entry.summary+'\n\nThis summary is attributed to the linked public release or commit. A separate contemporary Markdown note was not found; no new test results or release guarantees are inferred.';
    const date=entry.published_date?`Published ${entry.published_date.slice(0,10)}`:entry.commit_date?`Commit dated ${entry.commit_date.slice(0,10)} (not a publication date)`:'This snapshot does not assert publication status.';
    const body=`<section class="page-hero"><p class="eyebrow">${escape(kinds[entry.kind])}</p><h1>${entry.version==='0.1.0'?'multi-llm-review':'MOMM'} <span>${escape(entry.version)}</span></h1><p class="lead">${escape(entry.summary)}</p><p>${escape(date)}${entry.tag?' · Tag '+escape(entry.tag):''}</p><a class="text-link" href="${escape(entry.source_url)}">Original source record ↗</a></section><div class="doc-body wide"><aside class="notice"><strong>History is not an update target.</strong><p>Historical tags are not retroactively trusted by the signed updater. Read the <a href="../updates.html">upgrade procedure</a>; candidate notes do not establish that a release exists.</p></aside>${markdown(notes)}<p><a href="index.html">← All version notes</a></p></div>`;
    output[`docs/momm/releases/${entry.version}.html`]=shell('Version '+entry.version,body);
  }
  const ordered=[...catalogue].reverse();
  output['docs/momm/releases/index.html']=shell('Version history',`<section class="page-hero"><p class="eyebrow">VERSION HISTORY</p><h1>Every change.<br><span>Its original record.</span></h1><p class="lead">Release notes, historical tags and published code milestones are distinguished—not silently treated as equivalent releases.</p></section><div class="doc-body wide"><aside class="notice"><strong>Gaps stay visible.</strong><p>No public 1.6–1.8 release is evidenced. The installed 1.11/1.12 development line is described in <a href="1.13.0.html">1.13.0’s reconciliation notes</a>, not invented as separate public releases.</p></aside>${ordered.map(e=>`<section><p class="eyebrow">${escape(kinds[e.kind])}</p><h2><a href="${e.version}.html">${escape(e.version)} →</a></h2><p>${escape(e.summary)}</p></section>`).join('')}</div>`);
  const prompt=fs.readFileSync(path.join(root,'momm/references/upgrade-prompt.md'),'utf8').replace(/^# [^\n]+\r?\n\r?\n/,'');
  const bootstrap=fs.readFileSync(path.join(root,'momm/references/bootstrap.md'),'utf8');
  output['docs/momm/releases/bootstrap.html']=shell('New and legacy installations',`<div class="doc-body wide">${markdown(bootstrap)}<p><a href="upgrade.html">Copy the install / upgrade prompt →</a></p></div>`);
  output['docs/momm/releases/upgrade.html']=shell('Upgrade prompt',`<section class="page-hero"><p class="eyebrow">EXISTING MOMM USERS</p><h1>One prompt.<br><span>A verified upgrade.</span></h1><p class="lead">Paste this into your coding agent. It discovers your installation, checks the latest public stable release and asks before changing anything.</p></section><div class="doc-body wide"><p><a href="../updates.html">Read the update and recovery procedure →</a></p><div class="code"><div class="code-label"><span>Existing-user upgrade prompt</span><button type="button" data-copy="upgrade-prompt" aria-label="Copy the upgrade prompt">Copy</button></div><pre id="upgrade-prompt" style="white-space:pre-wrap;overflow-wrap:anywhere"><code>${escape(prompt)}</code></pre></div><p>Legacy users may need an explicitly approved bootstrap. A release candidate is not an upgrade target.</p></div>`);
  output['docs/momm/releases/index.html']=output['docs/momm/releases/index.html'].replace('<div class="doc-body wide">','<div class="doc-body wide"><p><a class="button primary" href="upgrade.html">Copy the existing-user upgrade prompt →</a></p>');
  output['docs/momm/releases/upgrade.html']=output['docs/momm/releases/upgrade.html'].replace('<div class="doc-body wide">','<div class="doc-body wide"><p><a href="bootstrap.html">New install, legacy migration or verification problem? Follow the complete bootstrap guide →</a></p>');
  return output;
}
