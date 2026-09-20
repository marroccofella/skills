// Deterministic public metadata only. Never execute tagged code or upload local files.
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const REPO='marroccofella/skills';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const versionPattern=/^momm-(\d+\.\d+\.\d+)$/;
export function summary({tag, commit, checker, manifestVersion, assets}) {
  if(!versionPattern.test(tag)||![commit,checker].every(s=>/^[a-f0-9]{40}$/.test(s)))throw Error('Invalid public identity');
  const version=tag.slice(5);
  const matches=manifestVersion===version;
  // Asset names and arbitrary API/release prose are never interpolated into public output.
  const rows=[
    `| Tag resolves to a commit | Observed | \`${commit}\` |`,
    `| Tagged versions.json matches ${version} | ${matches?'Observed':'Needs investigation'} | ${matches?'Exact version match':'Missing, unreadable or different; inspect the tagged manifest'} |`,
    `| Uploaded release assets | Observed | ${assets} listed; MOMM installs from signed Git tags. Zero uploads is not a missing release. Contents and signatures not verified here. |`,
  ];
  return `## MOMM release observations — ${version}\n\n`+
    `Public metadata check only. Not a review verdict, signature verification or release approval.\n\n`+
    `- Release: https://github.com/${REPO}/releases/tag/${tag}\n`+
    `- Exact tag commit: \`${commit}\`\n- Observer code commit: \`${checker}\`\n`+
    `- Runs: https://github.com/${REPO}/actions/workflows/momm-observations.yml\n\n`+
    `| Check | Observation | Evidence / limitation |\n| --- | --- | --- |\n${rows.join('\n')}\n\n`+
    `### Suggested follow-up\n${matches?'No mismatch in these narrow checks. This does not establish install, runtime or review quality.':'Reproduce the indicated metadata gap before deciding whether a patch is needed.'}\n\n`+
    `Maintainership checklist: confirm release notes, isolated install/upgrade/rollback evidence, website version and accepted media. These are not tested by this observer. Record a ruling and link any independently reviewed fix.\n\n`+
    `Private ledgers, reviewer output, account data and source code are not uploaded. No model calls, fixes, merges, updates or releases run here. Close this issue to stop updates for this release.\n`;
}
export function managedBody(tag, text) {
  if(!versionPattern.test(tag))throw Error('Invalid tag');
  return `<!-- momm-observation:${tag} -->\n<!-- summary-sha256:${hash(text)} -->\n${text}`;
}
export function intact(body) {
  const match=body?.match(/^<!-- momm-observation:momm-\d+\.\d+\.\d+ -->\n<!-- summary-sha256:([a-f0-9]{64}) -->\n([\s\S]*)$/);
  return !!match && hash(match[2])===match[1];
}
export async function publish(api, tag, text) {
  const marker=`<!-- momm-observation:${tag} -->`, body=managedBody(tag,text);
  let found;
  for(let page=1;page<=10;page++) {
    const issues=await api('GET',`/repos/${REPO}/issues?state=all&per_page=100&page=${page}`);
    // Identify edited CRLF bodies too; integrity below still binds exact bytes.
    found=issues.find(i=>!i.pull_request&&i.user?.login==='github-actions[bot]'&&i.user?.type==='Bot'&&(i.body?.startsWith(marker+'\n')||i.body?.startsWith(marker+'\r\n')));
    if(found||issues.length<100)break;
    if(page===10)throw Error('Issue scan limit reached; refusing a potentially duplicate issue');
  }
  if(found){
    if(found.state==='closed')return 'closed: skipped (no issue update)';
    if(!intact(found.body))throw Error('Managed summary was edited; refusing to overwrite it');
    if(found.body===body)return 'unchanged';
    await api('PATCH',`/repos/${REPO}/issues/${found.number}`,{body});
    return 'updated summary; discussion preserved';
  }
  await api('POST',`/repos/${REPO}/issues`,{title:`MOMM release observations — ${tag.slice(5)}`,body});
  return 'created';
}
export async function observe(api, {releaseId, checker}) {
  const releases=releaseId
    ? [await api('GET',`/repos/${REPO}/releases/${releaseId}`)]
    : await api('GET',`/repos/${REPO}/releases?per_page=100`);
  const release=releases.find(r=>!r.draft&&!r.prerelease&&versionPattern.test(r.tag_name));
  if(!release)return 'no stable MOMM release in bounded catalogue';
  const tag=release.tag_name;
  const commit=(await api('GET',`/repos/${REPO}/commits/${tag}`)).sha;
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid tag commit identity');
  let manifestVersion=null;
  // 404/invalid JSON is an observation. Network, auth and rate-limit errors stop the run.
  try {
    const entry=await api('GET',`/repos/${REPO}/contents/versions.json?ref=${commit}`);
    if(entry.encoding==='base64'&&entry.size<=65536) {
      try{manifestVersion=JSON.parse(Buffer.from(entry.content,'base64').toString('utf8')).momm;}catch{}
    }
  } catch(error) {if(error.status!==404)throw error;}
  const text=summary({tag,commit,checker,manifestVersion,assets:release.assets?.length||0});
  return publish(api,tag,text);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.env.GITHUB_REPOSITORY!==REPO)throw Error('Observer is restricted to the MOMM repository');
  if(!process.env.GH_TOKEN?.trim())throw Error('GH_TOKEN is required; use the workflow-provided GitHub token');
  const releaseId=process.env.MOMM_RELEASE_ID||'';
  if(releaseId&&!/^\d+$/.test(releaseId))throw Error('Invalid release ID');
  const api=async(method,endpoint,data)=>{
    const response=await fetch('https://api.github.com'+endpoint,{method,headers:{
      Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',...(data?{'Content-Type':'application/json'}:{})
    },...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30000)});
    if(!response.ok){const error=Error(`GitHub metadata request failed (${response.status}); no response body logged`);error.status=response.status;throw error;}
    return response.json();
  };
  console.log(await observe(api,{releaseId,checker:process.env.MOMM_CHECKER_SHA}));
}
