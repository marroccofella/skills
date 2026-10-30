// Production module under a synthetic DOM/transport. No credentials or live requests.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
delete process.env.MOMM_EVIDENCE_HOME;
const source=fs.readFileSync(new URL('../assets/setup-ui/bumblers.js',import.meta.url),'utf8');
const flush=async()=>{for(let n=0;n<8;n++)await new Promise(r=>setImmediate(r));};
const profile={id:'fixture-id',label:'Bab',kind:'bumbler',state:'draft',model_id:null,connector_id:null,route:null,task_type:'source-check',wording:'',overlay_hash:'fixture-hash',overlay_approved:false};
const snapshot=(revision=1)=>({revision,total:1,profiles:[{...profile}],connectors:[],baseline_excluded:[],counts:{registered:1,enabled:0,active_jobs:0},remote_policy:{active:false}});
function fixture(fetch){
  const nodes=new Map(),listeners={};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,open:false,addEventListener(name,fn){listeners[id+':'+name]=fn;},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},querySelector(){return node('submit');}});return nodes.get(id);};
  node('bee-filter').value='visible';
  const defaults={label:'Bab',kind:'bumbler',model_id:'',connector_id:'',route:'codex',task_type:'source-check',auth_mode:'oauth',base_url:'',pod_id:'',certificate:''};
  const elements=Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,{value,innerHTML:''}]));
  node('bee-form').elements=elements;node('bee-form').reset=()=>{for(const [key,value]of Object.entries(defaults))elements[key].value=value;};
  const context=vm.createContext({document:{querySelector:()=>node('root'),getElementById:node,createElement:()=>node('dialog-'+nodes.size),body:{append(){}}},window:{addEventListener:(name,fn)=>{listeners[name]=fn;},mommSetupSession:{subscribe:fn=>{listeners['momm-reviewer-session']=event=>fn(event.detail.token);}}},sessionStorage:{getItem:()=>null},fetch,console,Promise,JSON,encodeURIComponent,setTimeout,clearTimeout});
  const at=source.lastIndexOf('})();');assert(at>0);
  vm.runInContext(source.slice(0,at)+';this.fixtureApi={refresh,mutate,api,edit,snapshot:()=>snapshot};'+source.slice(at),context);
  listeners['momm-reviewer-session']({detail:{token:'a'.repeat(48)}});
  return {context,core:context.fixtureApi,node,elements,listeners};
}
const response=(value,status=200)=>({ok:status<400,status,json:async()=>value});
const cases={
  async authChoice(){const posts=[],f=fixture(async(_url,options)=>{if(options.method==='POST'){posts.push(JSON.parse(options.body));return response({});}return response(snapshot());});await flush();f.core.edit(profile);assert.equal(f.elements.auth_mode.value,'oauth');f.elements.auth_mode.value='api_key';await f.node('bee-form').onsubmit({preventDefault(){},currentTarget:{elements:f.elements}});assert.equal(posts[0].profile.auth_mode,'api_key');assert(!Object.hasOwn(posts[0].profile,'api_key'));f.elements.kind.value='cli';f.elements.kind.onchange();assert.equal(f.elements.auth_mode.value,'oauth');assert.equal(f.elements.auth_mode.disabled,true);},
  async lostSession(){const f=fixture(async()=>response(snapshot()));await flush();f.core.edit(profile);f.listeners['momm-reviewer-session']({detail:{token:null}});assert.equal(f.node('bee-cards').innerHTML,'');assert.equal(f.node('bee-clis').innerHTML,'');assert(f.node('bee-add').disabled);assert(f.node('bee-prev').disabled);assert(f.node('bee-next').disabled);assert(![...Object.keys(f.context)].includes('token'));},
  async missingEdit(){const f=fixture(async()=>response(snapshot()));await flush();await f.listeners['root:click']({target:{closest:()=>({dataset:{bee:'edit',id:'missing'}})}});assert.match(f.node('bee-status').textContent,/no longer|refresh/i);assert.equal(f.node('bee-editor-title').textContent,'');},
  async ambiguousConnector(){let posts=0;const f=fixture(async(url,o)=>{if(o.method==='POST'){posts++;return response({});}return response(snapshot());});await flush();f.core.edit(profile);f.elements.connector_id.value='saved';f.elements.base_url.value='https://example.test/v1';await f.node('bee-form').onsubmit({preventDefault(){},currentTarget:{elements:f.elements}});assert.equal(posts,0);assert.match(f.node('bee-editor-error').textContent,/either|saved connection/i);},
  async stale(){let revision=1,posts=0;const f=fixture(async(url,options)=>{if(options.method==='POST'){posts++;if(posts===1){revision=2;return response({code:'stale_revision',error:'Stale revision'},409);}assert.equal(JSON.parse(options.body).revision,2);return response({});}return response(snapshot(revision));});await flush();await assert.rejects(f.core.mutate('wording',{id:profile.id,wording:'keep'}));await f.core.mutate('wording',{id:profile.id,wording:'keep'});},
  async payload(){const posts=[];const f=fixture(async(url,options)=>{if(options.method==='POST'){posts.push(JSON.parse(options.body));return response({});}return response(snapshot());});await flush();f.core.edit(profile);await f.node('bee-form').onsubmit({preventDefault(){},currentTarget:{elements:f.elements}});assert(!Object.hasOwn(posts[0].profile,'route'),'remote profile payload must omit a CLI route');},
  async errorjson(){const f=fixture(async()=>({ok:false,status:502,json:async()=>{throw Error('PRIVATE_HTML_PARSER');}}));await flush();assert(!f.node('bee-status').textContent.includes('PRIVATE_HTML_PARSER'));assert.equal(f.node('bee-status').textContent,'Settings request refused.');},
  async session(){let calls=0;const f=fixture(async()=>{calls++;return response(snapshot());});await flush();f.listeners['momm-reviewer-session']({detail:{token:'a'.repeat(48)}});await flush();assert.equal(calls,2,'a validated same-token session event must permit recovery');},
  async baseline(){const f=fixture(async()=>response(snapshot()));await flush();assert(f.node('bee-cards').innerHTML.includes('Bab'));assert(f.node('bee-cards').innerHTML.includes('Not qualified'));assert(f.node('bee-clis').innerHTML.includes('Restore')===false);}
};
const focus=process.argv[2];if(focus){assert(cases[focus]);await cases[focus]();}else for(const fn of Object.values(cases))await fn();
console.log(JSON.stringify({passed:true,focus:focus||'all',scope:'synthetic production-client behavior; no live requests'}));
