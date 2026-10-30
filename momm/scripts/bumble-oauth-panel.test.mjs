// Executes the production initializer into synthetic DOM sinks. No actual browser/login.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
delete process.env.MOMM_EVIDENCE_HOME;
const source=fs.readFileSync(new URL('../assets/setup-ui/bumblers.js',import.meta.url),'utf8'),dialogs=[],nodes=new Map();let networkCalls=0;
const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',disabled:false,open:false,setAttribute(){},addEventListener(){},querySelector(){return node('submit');},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
const document={querySelector:()=>node('root'),getElementById:node,createElement:()=>{const d=node('dialog-'+dialogs.length);dialogs.push(d);return d;},body:{append(){}}};
node('bee-form').elements={kind:{value:'bumbler'},auth_mode:{value:'oauth'}};
vm.runInNewContext(source,{document,window:{mommSetupSession:{subscribe(){}}},fetch:async()=>{networkCalls++;throw Error('No request permitted');},Promise,JSON,encodeURIComponent,setTimeout,clearTimeout},{timeout:2000});
const form=dialogs.find(d=>d.innerHTML.includes('id="bee-form"'));assert(form,'production reviewer editor must be initialized');
assert(!/<input\b[^>]*type="password"/i.test(form.innerHTML),'unfinished protected credential setup must not offer a plaintext/password control');
assert(form.innerHTML.includes('OAuth · default')&&form.innerHTML.includes('API key · optional protected setup'),'show the owner-directed default and explicit option');
assert(form.innerHTML.includes('still being built'),'do not imply a working login or qualified node');
assert.equal(networkCalls,0,'opening the editor cannot contact an issuer or node');
assert.equal(node('bee-add').disabled,true,'private dashboard session still required');
console.log(JSON.stringify({passed:true,network_calls:0,credentials_read:false,scope:'actual initializer generates OAuth-default/optional-key choice without credential input or implicit login; not a browser auth test'}));
