// Governor-authored reproductions; no provider traffic or GitHub writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mediaBody,normalizeNavigation} from './momm-site-community.mjs';
import {observe,publish,managedBody,summary,intact} from './momm-release-observer.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const tour=JSON.parse(read('docs/momm/tour.json'));
const tag='momm-1.16.0', checker='b'.repeat(40), commit='a'.repeat(40);
const cases={
  'nav-shape':()=>{
    assert.throws(()=>normalizeNavigation({'docs/momm/test.html':'<header>No navigation</header>'}),/navigation/);
    assert.throws(()=>normalizeNavigation({'docs/momm/test.html':'<nav aria-label="Main navigation"></nav><nav aria-label="Main navigation"></nav>'}),/navigation/);
  },
  'gallery-id':()=>assert.throws(()=>mediaBody(tour,[{...tour,id:'new-film',video_sha256:'f'.repeat(64)}],'1.16.0'),/film/),
  'gallery-hash':()=>assert.throws(()=>mediaBody({...tour,video_sha256:undefined},[],'1.16.0'),/hash/),
  'closed-wording':async()=>{
    const text=summary({tag,commit,checker,manifestVersion:'1.16.0',assets:0});
    const result=await publish(async method=>{assert.equal(method,'GET');return [{number:2,state:'closed',user:{login:'github-actions[bot]',type:'Bot'},body:managedBody(tag,text)}];},tag,text+'changed');
    assert.equal(result,'closed: skipped (no issue update)');
  },
  'commit-boundary':async()=>{
    let contentRequests=0;
    await assert.rejects(observe(async(_method,url)=>{
      if(url.includes('/releases?'))return [{tag_name:tag,assets:[]}];
      if(url.includes('/commits/'))return {sha:'invalid&ref=untrusted'};
      if(url.includes('/contents/')){contentRequests++;return {};}
      throw Error('Unexpected API call');
    },{checker}),/identity|commit/i);
    assert.equal(contentRequests,0,'invalid SHA must be refused before constructing content request');
  },
  'missing-token':()=>{
    const observer=new URL('./momm-release-observer.mjs',import.meta.url);
    const program=`process.argv[1]=${JSON.stringify(fileURLToPath(observer))};delete process.env.GH_TOKEN;process.env.GITHUB_REPOSITORY='marroccofella/skills';globalThis.fetch=()=>{throw Error('NETWORK_WAS_ATTEMPTED')};await import(${JSON.stringify(observer.href)});`;
    const r=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',windowsHide:true});
    assert.notEqual(r.status,0);assert.match(r.stderr,/GH_TOKEN is required/);assert(!r.stderr.includes('NETWORK_WAS_ATTEMPTED'));
  },
  'direct-release':async()=>{
    for(const flags of [{},{draft:true},{prerelease:true}]){
      let writes=0;
      const result=await observe(async(method,url)=>{
        if(method==='POST'){writes++;return {};}
        if(url.endsWith('/releases/99'))return {tag_name:tag,assets:[],...flags};
        if(url.includes('/commits/'))return {sha:commit};
        if(url.includes('/contents/'))return {encoding:'base64',size:20,content:Buffer.from('{"momm":"1.16.0"}').toString('base64')};
        if(url.includes('/issues?'))return [];
        throw Error('Unexpected request');
      },{releaseId:'99',checker});
      assert.equal(writes,flags.draft||flags.prerelease?0:1);
      assert.equal(result,flags.draft||flags.prerelease?'no stable MOMM release in bounded catalogue':'created');
    }
  },
  'direct-release-coverage':()=>assert(read('scripts/check-momm-site.mjs').includes('momm-improvement-regressions.test.mjs'),'site CI must run direct-release regression coverage'),
  'publisher-main':()=>{
    const workflow=read('.github/workflows/momm-release.yml');
    assert(workflow.includes('workflow_dispatch:'));
    assert(!/^\s+(?:push|release):/m.test(workflow.split(/\r?\njobs:/)[0]));
    assert(workflow.includes('refs/heads/main'));
  },
  'human-edit-refusal':async()=>{
    const text=summary({tag,commit,checker,manifestVersion:'1.16.0',assets:0}),body=managedBody(tag,text);
    assert(!intact(body.replaceAll('\n','\r\n')),'exact byte integrity intentionally rejects normalization');
    await assert.rejects(publish(async method=>{assert.equal(method,'GET');return [{number:2,state:'open',user:{login:'github-actions[bot]',type:'Bot'},body:body+'human note'}];},tag,text),/refusing to overwrite/);
  },
  'current-copy':()=>{
    for(const page of ['index','install','updates','reference','start','media','improvement'])assert(!/never automatic|No automatic updates|never ask again/.test(read('docs/momm/'+page+'.html')),page);
  },
  'test-log':()=>assert(read('scripts/momm-site-home.test.mjs').includes('one architecture overview')),
  'pinned-ideas':()=>assert(read('scripts/momm-site-community.mjs').includes('blob/1fc113fe7e8d62c2770fa0dd06afa238bc504f6d/momm/references/ideas-register.md')),
};
export async function run(choice) {
  if(choice&&!cases[choice])throw Error('Unknown regression case');
  let failed=0;
  for(const [name,test] of Object.entries(cases)){if(choice&&choice!==name)continue;try{await test();console.log('PASS '+name);}catch(error){failed++;console.log('FAIL '+name+': '+error.message);}}
  if(failed)throw Error(`${failed} MOMM improvement regression(s) failed`);
}
const isMain=process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url;
await run(isMain?process.argv[2]:undefined);
