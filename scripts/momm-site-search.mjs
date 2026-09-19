// Search metadata and answer content for the existing static GitHub Pages site.
// No model calls, crawler-policy changes, invented ratings or ranking promises.
export const SITE = 'https://marroccofella.github.io/skills/';
const REPO = 'https://github.com/marroccofella/skills';
export const PROMPTUS = 'https://www.promptus.ai/';
export const BIO_SOURCE = 'https://nevadabusiness.com/2016/08/equiinet-chairman-address-roundtable-local-innovation-future-las-vegas-tech/';
export const UNLV_SOURCE = 'https://www.unlv.edu/news/release/unlv-engineering-students-take-top-prize-2014-southern-nevada-business-plan';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
export const definition = 'MOMM (Mixture of Model Modality) is an open-source Agent Skill for multi-model code and document review through installed AI CLIs. Your current agent stays the sole writer and verifier; other reviewers return claims, and your agent records the decisions in a private local ledger.';
export const answers = [
  ['what-is-momm', 'What is MOMM?', definition, 'start.html', 'Installation and first review'],
  ['reviewer-support', 'Which AI reviewers can MOMM use?', 'The default reviewer pool is Codex, Claude Code, Antigravity, GitHub Copilot and Grok. Gemini is opt-in for eligible accounts. MOMM excludes the current governor and uses available, authenticated routes; these CLI names do not prove which underlying model answered.', 'reference.html#troubleshooting', 'Route status and limitations'],
  ['local-versus-private', 'Is MOMM entirely local, and is my code private?', 'Orchestration and the private review ledger are local. Selected providers receive the sanitized review input through their CLIs. Redaction is not a confidentiality guarantee: approve the provider set and sharing scope before using private material.', 'reference.html#privacy', 'What leaves your machine'],
  ['cost-and-logins', 'Is MOMM free, and does it require API keys?', 'MOMM is MIT-licensed open-source software. Provider subscriptions, usage limits and quotas still apply, so a review is not necessarily free. MOMM uses existing OAuth or account logins and has no API-key fallback.', 'reference.html', 'Protocol and account requirements'],
  ['install-or-upgrade', 'How do I install or upgrade MOMM?', 'Use the install or upgrade prompt to identify your harness and any existing installation, verify a published stable release, preview the changes and ask before applying them. Keep the clone in a permanent folder. Protocol changes require separate acceptance; updates are never automatic.', 'releases/upgrade.html', 'Copy the install or upgrade prompt'],
  ['two-dashboards', 'Where are the dashboard and review results?', 'Setup Center manages reviewer connections and CLI versions. Each reviewed project has its own local ledger containing reports and governor decisions. This public website provides guidance and a separately sanitized historical example; it is not your private dashboard.', 'start.html#dashboard', 'Open your private ledger'],
  ['what-evidence-proves', 'Does reviewer agreement prove that code is correct?', 'No. Findings are claims, and a unanimous ACCEPT is not a test. The governor investigates findings, verifies changes and records every decision. The published development snapshot is evidence of this project’s workflow, not an independent accuracy benchmark.', 'evidence.html#real-review', 'Inspect a reproduced fix and rejected claim'],
];

export function answerSection() {
  return `<section class="doc-body wide" id="questions"><h2>Common questions about MOMM</h2>${answers.map(([id,question,answer,href,label])=>`<section id="${id}"><h3>${escape(question)}</h3><p>${escape(answer)}</p><p><a href="${href}">${escape(label)} →</a></p></section>`).join('')}</section>`;
}

export function projectStory() {
  return `<section class="doc-body wide" id="project-background"><p class="eyebrow">PEOPLE, PURPOSE AND PROVENANCE</p><h2>Professor Dominic Marrocco: turning technology into practical use</h2><p>MOMM is a project by Professor Dominic Marrocco in the <a href="https://42.uk">42.uk</a> collection, alongside his work with <a href="${PROMPTUS}">Promptus</a>. Its practical aim is to make AI-assisted work easier to challenge, verify and explain—not simply to collect more model opinions.</p><p>His background spans technology entrepreneurship and commercialisation. A <a href="${BIO_SOURCE}">2016 Equiinet announcement published by Nevada Business</a> described him as a serial entrepreneur and a professor of technology commercialisation at Peking University. <a href="${UNLV_SOURCE}">UNLV’s 2014 account</a> records engineering students developing a drone business through the business-plan competition bearing his name. These are dated background sources, not confirmation of current university appointments or an academic endorsement of MOMM.</p><h3>Promptus and the portable MOMM skill</h3><p><a href="${PROMPTUS}blog/nano-banana-available-on-promptus">Promptus documents a MoMM creative interface</a>. This portable Agent Skill is a distinct delivery form: it coordinates installed reviewer CLIs and keeps your agent as governor. The linked public skill history begins with <a href="releases/0.1.0.html">the predecessor release on 17 August 2026</a>; that release date does not establish when earlier private research or prototypes began.</p><p>Local voice workflows are powered by <a href="${PROMPTUS}">Promptus</a>, including the optional consented narration workflow. Promptus is not required to run this skill’s CLI reviews, and your review input is sent to the providers you select—not to a Promptus review backend.</p><p><a href="releases/">Explore the source-linked version history →</a> · <a href="evidence.html#user-benefits">See what the current evidence supports →</a></p></section>`;
}

export function evidenceBenefits(stats) {
  const d=stats.decisions;
  return `<section id="user-benefits"><h2>What could improve for you—and what we have measured</h2><p>MOMM adds an explicit challenge-and-verification step to AI-assisted work. The practical benefits to look for are additional defects identified, unsupported suggestions rejected, and a review history you can inspect. Their size depends on your tasks, reviewers and the governor’s tests.</p><div class="table-wrap" role="region" tabindex="0" aria-label="Observed development decisions and measurement limits"><table><thead><tr><th>Potential benefit</th><th>Observation in this development snapshot</th><th>What it does not establish</th></tr></thead><tbody><tr><th>Find changes worth making</th><td>${d.applied} recorded applied decisions; the linked supervisor case includes a named regression test.</td><td>Not ${d.applied} unique bugs, independently verified fixes or a user defect-reduction percentage.</td></tr><tr><th>Filter unsupported advice</th><td>${d.rejected} recorded rejected decisions; a rejected CRITICAL claim remains inspectable.</td><td>Not a measured false-positive rate or a guarantee that the governor always rules correctly.</td></tr><tr><th>Keep an inspectable decision trail</th><td>${stats.dispositions} decision records across ${stats.runs} logged runs; ${stats.stored_reports} detailed stored reports. ${d.deferred} decisions are deferred and ${d.historical_other} retain historical labels.</td><td>Not a count of users, deployments, commercial outcomes or independent replications.</td></tr></tbody></table></div><p><strong>No controlled AI-alone versus AI-plus-MOMM comparison is included in this snapshot.</strong> It cannot establish an average accuracy gain, time saving, cost saving or return on investment. The timing charts measure reviewer responses, not end-to-end developer productivity. Adding reviewers can add time and provider cost.</p><p>Snapshot date: ${escape(stats.generated.slice(0,10))}. <a href="data/dispositions.csv">Inspect the decision rows</a> · <a href="data/public-stats.json">Recompute the statistics</a> · <a href="#real-review">Inspect the concrete cases</a>.</p><h3>Measure the benefit on your own work</h3><p>Use a held-out set of representative tasks and a pre-defined test oracle. Compare the same base model and settings with and without MOMM, vary run order, and repeat trials. Include failed routes, total elapsed time, provider costs, confirmed defects and regressions introduced. Report the sample size, uncertainty and evaluation method before claiming a general improvement.</p></section>`;
}

export function addAttribution(output) {
  const credit=`\n<!-- MOMM CREDIT START -->\n<p class="momm-credit">Optional F5 narration: <a href="${PROMPTUS}">Built with Promptus · promptus.ai ↗</a> · A project by <a href="${SITE}momm/#project-background">Professor Dominic Marrocco</a>.</p>\n<!-- MOMM CREDIT END -->\n`;
  for(const [file,original] of Object.entries(output)) {
    if(!file.endsWith('.html'))continue;
    const html=original.replace(/\n?<!-- MOMM CREDIT START -->[\s\S]*?<!-- MOMM CREDIT END -->\n?/g,'');
    output[file]=html.includes('</footer>')?html.replace(/[ \t]*<\/footer>/,credit+'</footer>'):html+credit;
  }
}

export function canonicalUrl(file) {
  if (!/^docs\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.html$/.test(file) || file.split('/').some(p=>p==='.'||p==='..')) throw Error('Unsupported public page path');
  return SITE + file.slice(5).replace(/(^|\/)index\.html$/, '$1');
}

export function pageMetadata(file, catalogue) {
  const fixed = {
    'docs/momm/index.html': ['MOMM: Multi-Model Code Review for AI Agents', 'MOMM brings peer review to your coding agent through existing CLI logins. One writer, verified findings, explicit decisions and a private local ledger.'],
    'docs/momm/install.html': ['Install MOMM in One Line: Verified Install or Upgrade', 'Paste one line into your coding agent to install or upgrade MOMM. It finds your setup, verifies the signed release, shows a dry run and asks before changing anything.'],
    'docs/momm/start.html': ['Install MOMM: Setup, First Review and Dashboard', 'Install MOMM in your AI harness, connect an OAuth reviewer, run a first review and open your private ledger. Includes macOS, Windows and Linux guidance.'],
    'docs/momm/updates.html': ['Update MOMM Safely: Signed Releases and Rollback', 'Preview a signed MOMM update, inspect protocol changes, choose stable or pinned versions and recover a retained installation. No automatic updates.'],
    'docs/momm/evidence.html': ['MOMM Review Evidence: Results, Data and Limitations', 'Inspect MOMM’s historical development reviews, route outcomes, verified fixes and rejected claims. Download the data; this is not an accuracy benchmark.'],
    'docs/momm/technical.html': ['MOMM Architecture: Multi-Model Review, Evidence and Scaling', 'Explore MOMM’s governor, CLI adapters, privacy boundaries and evidence chain. Includes real route counts, reviewer-stacking assumptions and an evaluation plan.'],
    'docs/momm/reference.html': ['MOMM FAQ: Reviewers, Privacy, Costs and Troubleshooting', 'Understand MOMM’s reviewers, governor duties, account logins, costs, privacy boundaries and failure statuses. Clear answers with links to the evidence.'],
    'docs/momm/data/index.html': ['MOMM Evidence Downloads: CSV, JSON and Definitions', 'Download the historical MOMM review snapshot as CSV, JSON and Markdown. Includes route outcomes, governor decisions, timings and denominator definitions.'],
    'docs/momm/releases/index.html': ['MOMM Version History and Release Notes', 'Browse MOMM release notes and original source records. Published releases, historical tags and code milestones are distinguished, with gaps disclosed.'],
    'docs/momm/releases/bootstrap.html': ['MOMM New and Legacy Installations: Verify Before You Install', 'Prepare a verified MOMM release before any candidate code runs, and move an old installation aside with an approved plan and a rollback journal. Nothing is automatic.'],
    'docs/momm/releases/upgrade.html': ['MOMM Install or Upgrade Prompt for Your AI Harness', 'Copy a prompt for new or existing MOMM users: detect the harness, verify a stable release, preview changes and ask before installation or protocol updates.'],
    'docs/evidence/index.html': ['MOMM Public Evidence Ledger: Historical Reviews', 'Explore the sanitized historical MOMM development ledger: reviewer claims, route failures and governor decisions. This is not a user’s private dashboard.'],
  };
  if (fixed[file]) return {title:fixed[file][0], description:fixed[file][1]};
  const version=file.match(/^docs\/momm\/releases\/(\d+\.\d+\.\d+)\.html$/)?.[1];
  const release=catalogue.find(r=>r.version===version);
  if (!release) throw Error('Missing page search metadata: '+file);
  const kind=release.kind==='release'?'Release Notes':release.kind==='tag'?'Historical Tag Notes':release.kind==='code-history'?'Code History':'Version Notes';
  const full=`MOMM ${version}: ${release.summary}`;
  const excerpt=full.slice(0,189);
  const description=full.length<=190?full:excerpt.slice(0,excerpt.lastIndexOf(' '))+'…';
  return {title:`MOMM ${version}: ${kind}`, description, release};
}

export function enhanceSearch(output, {version, catalogue}) {
  for (const [file, original] of Object.entries(output)) {
    if (!file.endsWith('.html') || file.startsWith('docs/momm/watch/') || !(file.startsWith('docs/momm/') || file==='docs/evidence/index.html')) continue; // Watch pages own their VideoObject graph.
    const meta=pageMetadata(file,catalogue),url=canonicalUrl(file);
    const crumbs=[['Skills',SITE],['MOMM',SITE+'momm/']];
    if (file.startsWith('docs/momm/releases/') && file!=='docs/momm/releases/index.html') crumbs.push(['Version history',SITE+'momm/releases/']);
    if (file!=='docs/momm/index.html') crumbs.push([meta.title,url]);
    const graph=[
      {'@type':'WebPage','@id':url+'#page',url,name:meta.title,description:meta.description,inLanguage:'en',about:{'@id':SITE+'momm/#software'},breadcrumb:{'@id':url+'#breadcrumbs'},...(meta.release?{citation:meta.release.source_url}:{})},
      {'@type':'BreadcrumbList','@id':url+'#breadcrumbs',itemListElement:crumbs.map(([name,item],i)=>({'@type':'ListItem',position:i+1,name,item}))},
    ];
    if(file==='docs/momm/index.html')graph.push({'@type':'SoftwareSourceCode','@id':SITE+'momm/#software',name:'MOMM',alternateName:'Mixture of Model Modality',description:definition,url:SITE+'momm/',codeRepository:REPO,license:REPO+'/blob/main/LICENSE',version,inLanguage:'en'});
    // Generated metadata is replaced, not accumulated, when the public ledger
    // is read back as a template. Do not touch its executable UI scripts.
    let html=original.replace(/\n?<!-- MOMM SEARCH START -->[\s\S]*?<!-- MOMM SEARCH END -->\n?/g,'');
    const endHead=html.indexOf('</head>');if(endHead<0)throw Error('Missing head: '+file);
    let body=html.slice(endHead+7);html=html.slice(0,endHead);
    html=html.replace(/<title>[\s\S]*?<\/title>/,()=>`<title>${escape(meta.title)}</title>`)
      .replace(/<meta\b(?=[^>]*\bname="description")[^>]*>/g,'');
    const head=`\n<!-- MOMM SEARCH START -->\n<meta name="description" content="${escape(meta.description)}">\n<link rel="canonical" href="${url}">\n<meta name="robots" content="index,follow">\n<script type="application/ld+json">${json({'@context':'https://schema.org','@graph':graph})}</script>\n<!-- MOMM SEARCH END -->\n`;
    html=html+head+'</head>'+body;
    if(file.startsWith('docs/momm/')) {
      const trail=`<nav class="doc-body wide" aria-label="Breadcrumb">${crumbs.map(([label,href],i)=>i===crumbs.length-1?`<span aria-current="page">${escape(label)}</span>`:`<a href="${href}">${escape(label)}</a>`).join(' / ')}</nav>`;
      html=html.replace(/<!-- MOMM BREADCRUMB START -->[\s\S]*?<!-- MOMM BREADCRUMB END -->/g,'');
      html=html.replace('<main id="main">',()=>'<main id="main"><!-- MOMM BREADCRUMB START -->'+trail+'<!-- MOMM BREADCRUMB END -->');
    }
    output[file]=html;
  }
}
