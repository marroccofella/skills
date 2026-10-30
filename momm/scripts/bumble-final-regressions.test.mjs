// Governor-authored full-review probes; no real credentials, provider or worker calls.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import os from 'node:os';import path from 'node:path';
import {ReviewerRegistry} from './reviewer-registry.mjs';
import {applyReviewerSettings} from './reviewer-selection.mjs';
import {spawnSync} from 'node:child_process';
import {resolveGit} from './governor.mjs';
import {fileURLToPath} from 'node:url';
import {newer} from './update.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const flush=async()=>{for(let n=0;n<8;n++)await new Promise(r=>setImmediate(r));};
const cases={
  async archives(){const parent=fs.mkdtempSync(path.join(os.tmpdir(),'momm-final-probe-'));try{const r=new ReviewerRegistry({root:path.join(parent,'private')});const cmd=b=>r.command({...b,revision:r.read().revision}),id=cmd({op:'save',profile:{label:'One'}}).result.id;r.mutate(r.read().revision,s=>{for(let n=0;n<499;n++)s.events.push({id:`e${n}`,at:'2026-10-10T00:00:00.000Z',action:'wording',profile_id:id});});for(let n=0;n<3;n++)cmd({op:'wording',id,wording:'text-'+n});assert(r.read().event_archives.length<=1,'normal individual edits must produce full batches, not one archive each');assert(r.read().events.length<=500);}finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-final-probe-'));fs.rmSync(parent,{recursive:true,force:true});}},
  async legacyManifest(){
    const manifest=JSON.parse(fs.readFileSync(new URL('../../versions.json',import.meta.url),'utf8'));
    const root=fileURLToPath(new URL('../../',import.meta.url)),git=resolveGit(root);assert(git&&path.isAbsolute(git),'trusted Git must resolve outside the checkout');
    const original=spawnSync(git,['show','HEAD:momm/scripts/update.mjs'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(original.status,0);
    const a=original.stdout.indexOf('export async function dailyCheck('),b=original.stdout.indexOf('export function provenance(',a);assert(a>=0&&b>a);
    const legacy=vm.runInNewContext(original.stdout.slice(a,b).replace('export async function','async function')+';dailyCheck',{updateCheckDisabled:()=>false,stateDir:()=>'/synthetic-cache',directory(){},readLock:()=>null,regular:()=>false,fs:{openSync:()=>1,writeFileSync(){},closeSync(){},unlinkSync(){}},os:{homedir:()=>'/synthetic-home'},path,process,Date,writeJSON(){},manifest:async()=>manifest,newer});
    assert.equal(await legacy('1.17.3',{root:'/synthetic',env:{},fetcher:async()=>{throw Error('No network expected');},now:1}),null,'a released legacy client must not advertise unpublished1.18');
    assert.equal(manifest.momm,manifest.momm_development.stable,'published manifest key remains compatible with older clients');
  },
  siteStable(){
    const read=f=>fs.readFileSync(new URL('../../'+f,import.meta.url),'utf8'),m=JSON.parse(read('versions.json')),stable=m.momm_development.stable;
    assert.equal(read('docs/index.html').match(/data-momm-version>([^<]+)/)?.[1],stable,'front door displays installable stable, not local development');
    assert(!read('docs/momm/updates.html').includes('--apply --version '+m.momm_development.version),'pin example must not target unpublished development');
    for(const name of ['overview','setup','trailer'])assert(read('docs/momm/watch/'+name+'.html').includes('Current version: '+stable),'watch pages name the stable version');
    const ld=read('docs/momm/index.html').match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];assert.equal(JSON.parse(ld)['@graph'].find(n=>n['@type']==='SoftwareSourceCode').version,stable);
  },
  async firstSave(){
    const source=fs.readFileSync(new URL('../assets/setup-ui/bumblers.js',import.meta.url),'utf8'),nodes=new Map();let publish;
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,open:false,setAttribute(){},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},querySelector(){return node('submit');}});return nodes.get(id);};
    const defaults={label:'Bab',kind:'bumbler',auth_mode:'oauth',connector_id:'',base_url:'',model_id:'',route:'codex',task_type:'source-check',pod_id:'',certificate:''};
    const form=node('bee-form');form.elements=Object.fromEntries(Object.entries(defaults).map(([k,value])=>[k,{value,innerHTML:''}]));form.reset=()=>{for(const [k,v]of Object.entries(defaults))form.elements[k].value=v;};node('bee-filter').value='visible';
    vm.runInNewContext(source,{document:{querySelector:()=>node('root'),getElementById:node,createElement:()=>node('dialog-'+nodes.size),body:{append(){}}},window:{mommSetupSession:{subscribe:fn=>{publish=fn;}}},fetch:async()=>({ok:true,json:async()=>({revision:1,total:0,profiles:[],connectors:[],baseline_excluded:[],counts:{registered:0,enabled:0,active_jobs:0}})}),Promise,JSON,encodeURIComponent});
    publish('synthetic-session');await flush();assert.equal(node('bee-add').disabled,false);
    node('bee-add').onclick();assert.equal(node('submit').disabled,false,'first-use Save must be usable after a validated session');
    publish(null);assert.equal(node('submit').disabled,true);publish('replacement-session');await flush();node('bee-add').onclick();assert.equal(node('submit').disabled,false,'new session must restore a usable Save button');
  },
  async registryQuorum(){
    const parent=fs.mkdtempSync(path.join(os.tmpdir(),'momm-final-probe-'));
    try{const root=path.join(parent,'private'),registry=new ReviewerRegistry({root});registry.command({op:'save',profile:{label:'Bab'},revision:0});const options={governor:'codex',reviewers:['codex']};assert.doesNotThrow(()=>applyReviewerSettings(options,{root}),'saving a draft must not change governor-only diagnostic semantics');assert.deepEqual(options.reviewers,['codex']);}
    finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-final-probe-'));fs.rmSync(parent,{recursive:true,force:true});}
  }
};
const selected=process.argv[2];if(selected){assert(cases[selected]);await cases[selected]();}else for(const test of Object.values(cases))await test();
console.log(JSON.stringify({passed:true,case:selected||'all',network_calls:0,scope:'full-review governor-authored behavioral probes'}));
