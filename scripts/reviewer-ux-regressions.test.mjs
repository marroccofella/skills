// Synthetic browser-event model; no network, credentials, or provider calls.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const client=fs.readFileSync(new URL('../momm/assets/setup-ui/app.js',import.meta.url),'utf8');
const ledger=fs.readFileSync(new URL('../momm/scripts/ledger.mjs',import.meta.url),'utf8');
const checks=[];
async function test(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}}
await test('attachment child failure retains safe timing and termination diagnostics',()=>{
 const s=fs.readFileSync(new URL('../momm/scripts/attachment-cleanup.test.mjs',import.meta.url),'utf8');
 const a=s.indexOf('function actual('),b=s.indexOf('\nfunction stageContext',a);
 const c=vm.createContext({spawnSync:()=>({status:null,signal:'SIGTERM',error:{code:'ETIMEDOUT'},stdout:'PRIVATE OUTPUT',stderr:'PRIVATE PATH'}),process:{execPath:'node',env:{}},dispatcher:'synthetic',Date,path:{join:(...p)=>p.join('/')},Buffer});
 vm.runInContext(s.slice(a,b)+';this.actual=actual;',c);
 assert.throws(()=>c.actual({cwd:'synthetic',temporary:'synthetic/tmp'},[]),e=>{
   assert.match(e.message,/ETIMEDOUT/);assert.match(e.message,/SIGTERM/);assert.match(e.message,/elapsed_ms/);assert.match(e.message,/30000/);
   assert.doesNotMatch(e.message,/PRIVATE OUTPUT|PRIVATE PATH/);return true;
 });
});
await test('same-document private launch link restarts authenticated bootstrap without leaking authority',async()=>{
 const listeners=new Map(),stored=new Map();let reloads=0,calls=0;
 const location={hash:'',pathname:'/',search:'',reload(){reloads++;}};
 const c=vm.createContext({URLSearchParams,location,session:null,summary:{},showToast(){},
  sessionStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},history:{replaceState(){location.hash='';}},
  window:{addEventListener:(name,fn)=>listeners.set(name,fn)},
  api:async()=>{calls++;throw Error('Synthetic denied session');},refresh:async()=>{},loadMaintenance(){},loadGuidance(){},loadUsage(){},loadUpdateClock(){},loadCapabilities(){}});
 vm.runInContext(client.slice(client.indexOf('function launchToken() {')),c);
 await new Promise(r=>setImmediate(r));
 assert.equal(calls,0,'bare shell must not call authenticated API');
 assert.equal(typeof listeners.get('hashchange'),'function','same-document navigation must be handled');
 for(const hash of ['#section','#momm-token=invalid','']){location.hash=hash;listeners.get('hashchange')();assert.equal(reloads,0);}
 location.hash='#momm-token='+'a'.repeat(48);listeners.get('hashchange')();
 assert.equal(reloads,1);assert.equal(stored.size,0,'listener must not bypass normal bootstrap');
 assert.match(location.hash,/momm-token=/,'reload must preserve fragment for the normal validated bootstrap');
});
await test('ledger tables retain readable column minima within keyboard-scroll wrappers',()=>{
 assert.match(ledger,/\.table-scroll \.momm-table\s*\{[^}]*min-width:\s*48rem/);
 assert.match(ledger,/\.table-scroll \.momm-table\s*\{[^}]*overflow-wrap:\s*normal/);
 assert.match(ledger,/\.table-scroll \.momm-table td:not\(\.prose\)\s*\{[^}]*white-space:\s*nowrap/);
 assert.match(ledger,/\.table-scroll \.momm-table \.prose\s*\{[^}]*white-space:\s*normal/);
 assert.match(ledger,/class="table-scroll" role="region" tabindex="0"/);
});
console.log(JSON.stringify({checks,browser_verified:false},null,2));
process.exitCode=checks.every(c=>c.passed)?0:1;
