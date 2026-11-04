// Executes the production initializer into synthetic DOM sinks. No actual browser/login.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
delete process.env.MOMM_EVIDENCE_HOME;
const source=fs.readFileSync(new URL('../assets/setup-ui/bumblers.js',import.meta.url),'utf8'),dialogs=[],nodes=new Map();let networkCalls=0;
const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',disabled:false,open:false,setAttribute(){},addEventListener(){},querySelector(){return node('submit');},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
const document={querySelector:()=>node('root'),getElementById:node,createElement:()=>{const d=node('dialog-'+dialogs.length);dialogs.push(d);return d;},body:{append(){}}};
node('bee-form').elements={kind:{value:'bumbler'},auth_mode:{value:'oauth'}};
vm.runInNewContext(source,{document,window:{mommSetupSession:{subscribe(){}}},fetch:async()=>{networkCalls++;throw Error('No request permitted');},Promise,JSON,encodeURIComponent,setTimeout,clearTimeout},{timeout:2000});
const form=dialogs.find(d=>d.innerHTML.includes('id="bee-form"'));assert(form,'production reviewer editor must be initialized');
assert(!/<input\b[^>]*type\s*=\s*["']?password/i.test(form.innerHTML),'unfinished protected credential setup must not offer a plaintext/password control');
assert(form.innerHTML.includes('OAuth')&&!/API key|api_key/i.test(form.innerHTML),'editor offers OAuth only');
assert(form.innerHTML.includes('still being built'),'do not imply a working login or qualified node');
assert.equal(networkCalls,0,'opening the editor cannot contact an issuer or node');
assert.equal(node('bee-add').disabled,true,'private dashboard session still required');
// Drive the real save handler while its private session is lost or replaced.
const flush=async()=>{for(let n=0;n<8;n++)await new Promise(r=>setImmediate(r));};
async function sessionDuringSave(next){
  const nodes=new Map(),dialogs=[];let publish,resolveWrite,posts=0;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',disabled:false,open:false,setAttribute(){},addEventListener(){},querySelector(){return node('submit');},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const values={label:'Synthetic reviewer',kind:'bumbler',auth_mode:'oauth',connector_id:'',base_url:'',model_id:'',route:'codex',task_type:'source-check',pod_id:'',certificate:''};
  const form=node('bee-form');form.elements=Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value,innerHTML:''}]));form.reset=()=>{for(const[k,v]of Object.entries(values))form.elements[k].value=v;};node('bee-filter').value='visible';
  const snapshot={revision:1,total:0,profiles:[],connectors:[],baseline_excluded:[],counts:{registered:0,enabled:0,active_jobs:0}};
  const fetch=async(_url,options)=>options.method==='POST'?(posts++,new Promise(resolve=>{resolveWrite=resolve;})):{ok:true,json:async()=>snapshot};
  vm.runInNewContext(source,{document:{querySelector:()=>node('root'),getElementById:node,createElement:()=>{const d=node('dialog-'+dialogs.length);dialogs.push(d);return d;},body:{append(){}}},window:{mommSetupSession:{subscribe:fn=>{publish=fn;}}},fetch,Promise,JSON,encodeURIComponent});
  publish('synthetic-session');await flush();node('bee-add').onclick();
  const pending=form.onsubmit({preventDefault(){},currentTarget:form});await flush();assert.equal(posts,1);
  publish(next);await flush();
  assert.equal(node('bee-write-warning').hidden,false,'a session change warns immediately while the write is still pending');
  assert.equal(node('bee-write-ack').disabled,true,'a pending write cannot be acknowledged as reconciled');
  assert.equal(typeof node('bee-write-ack').onclick,'function');node('bee-write-ack').onclick();assert.equal(node('bee-write-warning').hidden,false);
  resolveWrite({ok:true,json:async()=>({revision:2})});await pending;await flush();
  const warning=()=>node('bee-write-warning').hidden===false?node('bee-write-warning-copy').textContent:node('bee-status').textContent;
  assert.match(warning(),/may have committed/,'uncertain save warning remains visible outside the closed dialog');
  if(next){assert.equal(node('bee-write-ack').disabled,true,'a snapshot read before settlement cannot reconcile the write');node('bee-write-ack').onclick();assert.match(warning(),/may have committed/);await node('bee-refresh').onclick();assert.match(warning(),/may have committed/,'refresh cannot silently erase unresolved save uncertainty');assert.equal(node('bee-write-ack').disabled,false,'post-settlement refreshed state permits explicit acknowledgement');}
  assert.equal(typeof node('bee-write-ack').onclick,'function','reconciliation must have an explicit acknowledgement path');
  node('bee-write-ack').onclick();
  if(next){assert.equal(node('bee-write-warning').hidden,true,'a validated refreshed view plus explicit acknowledgement clears the warning');}
  else assert.match(warning(),/may have committed/,'no acknowledgement without a current private session');
  assert.equal(posts,1,'session changes never retry a write');assert.equal(dialogs.some(d=>d.open),false);
}
async function sameSessionFailure(mode){
  const nodes=new Map();let publish,posts=0,refreshes=0,healed=false;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',disabled:false,open:false,setAttribute(){},addEventListener(){},querySelector(){return node('submit');},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const values={label:'Synthetic reviewer',kind:'bumbler',auth_mode:'oauth',connector_id:'',base_url:'',model_id:'',route:'codex',task_type:'source-check',pod_id:'',certificate:''};
  const form=node('bee-form');form.elements=Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value,innerHTML:''}]));form.reset=()=>{for(const[k,v]of Object.entries(values))form.elements[k].value=v;};
  const snapshot=()=>({revision:posts?2:1,total:0,profiles:[],connectors:[],baseline_excluded:[],counts:{registered:0,enabled:0,active_jobs:0}});
  const fetch=async(_url,options)=>{if(options.method==='POST'){posts++;if(mode==='transport'||mode==='malformed')throw Error('SYNTHETIC_PRIVATE_TRANSPORT_DIAGNOSTIC');if(mode==='refusal')return{ok:false,status:400,json:async()=>({error:'Synthetic request refused',code:'invalid_request'})};if(mode==='server-text')return{ok:false,status:500,json:async()=>{throw Error('Synthetic non-JSON body');}};if(mode==='server-json')return{ok:false,status:502,json:async()=>({error:'SYNTHETIC_UPSTREAM_DETAIL'})};return{ok:true,json:async()=>({revision:2})};}refreshes++;if(mode==='refresh'&&posts&&refreshes===2)throw Error('Synthetic refresh unavailable');return{ok:true,json:async()=>mode==='malformed'&&posts&&!healed?{revision:1}:snapshot()};};
  vm.runInNewContext(source,{document:{querySelector:()=>node('root'),getElementById:node,createElement:()=>node('dialog-'+nodes.size),body:{append(){}}},window:{mommSetupSession:{subscribe:fn=>{publish=fn;}}},fetch,Promise,JSON,encodeURIComponent});
  publish('synthetic-session');await flush();node('bee-add').onclick();await form.onsubmit({preventDefault(){},currentTarget:form});await flush();
  if(mode==='refusal'){assert.equal(node('bee-write-warning').hidden,true,'a definitive structured refusal is not an ambiguous write');return;}
  assert.equal(node('bee-write-warning').hidden,false,'same-session uncertain write needs a persistent warning');assert.equal(node('bee-write-ack').disabled,true);
  assert.doesNotMatch(node('bee-editor-error').textContent,/SYNTHETIC_PRIVATE_TRANSPORT_DIAGNOSTIC/);
  if(mode.startsWith('server-')){assert.match(node('bee-editor-error').textContent,/outcome is unknown/,'a server failure cannot be reported as a refusal');assert.doesNotMatch(node('bee-editor-error').textContent,/SYNTHETIC_UPSTREAM_DETAIL|refused/);}
  await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(posts,1,'another save is blocked until uncertainty is reconciled');
  if(mode==='malformed'){await node('bee-refresh').onclick();assert.equal(node('bee-write-ack').disabled,true,'an unusable refreshed view must not enable acknowledgement');assert.match(node('bee-status').textContent,/Settings response is invalid/);node('bee-write-ack').onclick();assert.equal(node('bee-write-warning').hidden,false);healed=true;}
  await node('bee-refresh').onclick();assert.equal(node('bee-write-ack').disabled,false);node('bee-write-ack').onclick();assert.equal(node('bee-write-warning').hidden,true);assert.equal(posts,1);
}
async function reviewPool(){
  const nodes=new Map();let publish;const calls=[];let saved=[{name:'bab',model:'m',base_url:'http://100.64.0.1:1/v1',max_tokens:1024,timeout_seconds:180}];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',disabled:false,open:false,setAttribute(){},addEventListener(){},querySelector(){return node('submit');},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const values={label:'Synthetic reviewer',kind:'bumbler',auth_mode:'oauth',connector_id:'',base_url:'',model_id:'',route:'codex',task_type:'source-check',pod_id:'',certificate:''};
  const form=node('bee-form');form.elements=Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value,innerHTML:''}]));form.reset=()=>{};
  const snapshot={revision:1,total:0,profiles:[],connectors:[],baseline_excluded:[],counts:{registered:0,enabled:0,active_jobs:0}};
  const fetch=async(url,options)=>{if(!String(url).startsWith('/api/bumblers'))return{ok:true,json:async()=>snapshot};calls.push(options.method==='POST'?JSON.parse(options.body):'GET');if(options.method==='POST'&&JSON.parse(options.body).name==='bad')return{ok:false,status:400,json:async()=>({error:'Bumbler bad: invalid or reserved name'})};if(options.method==='POST')saved=[];return{ok:true,json:async()=>({bumblers:saved})};};
  vm.runInNewContext(source,{document:{querySelector:()=>node('root'),getElementById:node,createElement:()=>node('dialog-'+nodes.size),body:{append(){}}},window:{mommSetupSession:{subscribe:fn=>{publish=fn;}}},fetch,Promise,JSON,encodeURIComponent,Number});
  publish('synthetic-session');await flush();assert.equal(calls.length,0,'closed panel makes no request');
  node('bump-panel').open=true;node('bump-panel').ontoggle();await flush();assert.match(node('bump-list').innerHTML,/bab/);assert.match(node('bump-list').innerHTML,/data-bump="bab"/);
  const f={name:{value:'bad'},base_url:{value:'x'},model:{value:'m'},max_tokens:{value:'1'},timeout_seconds:{value:'1'},guidance:{value:''}};let resets=0;
  await node('bump-form').onsubmit({preventDefault(){},currentTarget:{elements:f,reset(){resets++;}}});assert.match(node('bump-status').textContent,/invalid or reserved/);assert.equal(resets,0,'a refused save keeps what was typed');
  f.name.value='good';await node('bump-form').onsubmit({preventDefault(){},currentTarget:{elements:f,reset(){resets++;}}});assert.equal(node('bump-status').textContent,'Saved.');assert.equal(resets,1);assert.match(node('bump-list').innerHTML,/No Bumblers saved/);
  assert(!Object.hasOwn(calls.at(-1).entry,'enabled'),'a Bumbler saved without the switch stays on by default');
  // Unticking "joins default reviews" saves the Bumbler switched off.
  f.name.value='quiet';f.enabled={checked:false};await node('bump-form').onsubmit({preventDefault(){},currentTarget:{elements:f,reset(){}}});assert.equal(calls.at(-1).entry.enabled,false,'the switch is saved as off');
  f.name.value='loud';f.enabled={checked:true};await node('bump-form').onsubmit({preventDefault(){},currentTarget:{elements:f,reset(){}}});assert(!Object.hasOwn(calls.at(-1).entry,'enabled'),'ticked means the default, on');
}
async function reviewPoolOrder(){
  const nodes=new Map();let publish,release;const pending=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',disabled:false,open:false,setAttribute(){},addEventListener(){},querySelector(){return node('submit');},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const values={label:'Synthetic reviewer',kind:'bumbler',auth_mode:'oauth',connector_id:'',base_url:'',model_id:'',route:'codex',task_type:'source-check',pod_id:'',certificate:''};
  const form=node('bee-form');form.elements=Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value,innerHTML:''}]));form.reset=()=>{};
  const snapshot={revision:1,total:0,profiles:[],connectors:[],baseline_excluded:[],counts:{registered:0,enabled:0,active_jobs:0}};
  const fetch=async(url,options)=>{if(!String(url).startsWith('/api/bumblers'))return{ok:true,json:async()=>snapshot};if(options.method==='GET')return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({bumblers:[{name:'old',model:'m',base_url:'u',max_tokens:1,timeout_seconds:1}]})});});return{ok:true,json:async()=>({bumblers:[{name:'new',model:'m',base_url:'u',max_tokens:1,timeout_seconds:1}]})};};
  vm.runInNewContext(source,{document:{querySelector:()=>node('root'),getElementById:node,createElement:()=>node('dialog-'+nodes.size),body:{append(){}}},window:{mommSetupSession:{subscribe:fn=>{publish=fn;}}},fetch,Promise,JSON,encodeURIComponent,Number});
  publish('synthetic-session');await flush();node('bump-panel').open=true;node('bump-panel').ontoggle();await flush();
  const f={name:{value:'new'},base_url:{value:'u'},model:{value:'m'},max_tokens:{value:'1'},timeout_seconds:{value:'1'},guidance:{value:''}};await node('bump-form').onsubmit({preventDefault(){},currentTarget:{elements:f,reset(){}}});await flush();
  release();await flush();assert.match(node('bump-list').innerHTML,/new/,'a slow older read cannot replace a newer result');assert.doesNotMatch(node('bump-list').innerHTML,/old/);
}
async function reviewPoolEdit(){
  const nodes=new Map();let publish,release;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',disabled:false,open:false,setAttribute(){},addEventListener(){},querySelector(){return node('submit');},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const values={label:'Synthetic reviewer',kind:'bumbler',auth_mode:'oauth',connector_id:'',base_url:'',model_id:'',route:'codex',task_type:'source-check',pod_id:'',certificate:''};
  const form=node('bee-form');form.elements=Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value,innerHTML:''}]));form.reset=()=>{};
  const snapshot={revision:1,total:0,profiles:[],connectors:[],baseline_excluded:[],counts:{registered:0,enabled:0,active_jobs:0}};
  const fetch=async(url,options)=>{if(!String(url).startsWith('/api/bumblers'))return{ok:true,json:async()=>snapshot};return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({bumblers:[]})});});};
  vm.runInNewContext(source,{document:{querySelector:()=>node('root'),getElementById:node,createElement:()=>node('dialog-'+nodes.size),body:{append(){}}},window:{mommSetupSession:{subscribe:fn=>{publish=fn;}}},fetch,Promise,JSON,encodeURIComponent,Number});
  publish('synthetic-session');await flush();
  const f={name:{value:'one'},base_url:{value:'u'},model:{value:'m'},max_tokens:{value:'1'},timeout_seconds:{value:'1'},guidance:{value:''}};let resets=0;
  const pending=node('bump-form').onsubmit({preventDefault(){},currentTarget:{elements:f,reset(){resets++;}}});await flush();f.name.value='two';release();await pending;await flush();assert.equal(resets,0,'newer typing survives a slow save');
  const again=node('bump-form').onsubmit({preventDefault(){},currentTarget:{elements:f,reset(){resets++;}}});await flush();release();await again;assert.equal(resets,1,'an unchanged form still resets');
}
const cases={pool:reviewPool,poolEdit:reviewPoolEdit,poolOrder:reviewPoolOrder,lost:()=>sessionDuringSave(null),rotated:()=>sessionDuringSave('synthetic-replacement'),transport:()=>sameSessionFailure('transport'),refresh:()=>sameSessionFailure('refresh'),refusal:()=>sameSessionFailure('refusal'),malformed:()=>sameSessionFailure('malformed'),serverText:()=>sameSessionFailure('server-text'),serverJson:()=>sameSessionFailure('server-json')};
const selected=process.argv[2];if(selected){assert(cases[selected]);await cases[selected]();}else for(const run of Object.values(cases))await run();
console.log(JSON.stringify({passed:true,network_calls:0,credentials_read:false,scope:'actual initializer generates an OAuth-only editor without credential input or implicit login; not a browser auth test'}));
