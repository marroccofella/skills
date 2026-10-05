// Synthetic browser-event model; no network, credentials, or provider calls.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives
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
// Gate rev_20260919000938_1nkh: every value the usage panel places in markup is escaped, counts
// included; the server computes them as numbers, the page must not depend on that.
await test('usage cells escape their counts as well as their value',()=>{
 const a=client.indexOf('function reportedCell('),b=client.indexOf('\nfunction renderUsage(',a);
 assert(a>=0&&b>a,'reportedCell not found');
 const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
 const reportedCell=vm.runInNewContext(client.slice(a,b)+';reportedCell',{escapeHtml});
 const hostile='"><img src=x onerror=alert(1)>';
 for(const html of [reportedCell(0,hostile,'x'),reportedCell(1,hostile,'x'),reportedCell(hostile,2,'x')]){
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
 }
 assert.equal(reportedCell(2,3,'1,024'),'1,024<small>2 of 3 reported</small>');
 assert.equal(reportedCell(0,3,'x'),'<span class="not-reported">not reported</span><small>0 of 3 reported</small>');
});
// Gate-3 (1.17.0 self-review, grep-empty-success and suggestions): scripts/run-ci-suites.mjs, run in a sandbox
// with a synthetic workflow. A --grep that names nothing or matches nothing fails; a failing suite's stdout tail is shown.
await test('run-ci-suites: an empty or unmatched --grep is an error, and a failure shows its stdout',async()=>{
 const {spawnSync}=await import('node:child_process');const os=await import('node:os');const path=await import('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'momm-ci-suites-'));
 try{
  const put=(rel,text)=>{fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});fs.writeFileSync(path.join(root,rel),text);};
  put('scripts/run-ci-suites.mjs',fs.readFileSync(new URL('./run-ci-suites.mjs',import.meta.url)));
  put('.github/workflows/self-test.yml','jobs:\n  t:\n    steps:\n      - run: node scripts/synthetic-ok.mjs\n      - run: node scripts/synthetic-bad.mjs\n');
  put('scripts/synthetic-ok.mjs','process.exitCode = 0;\n');put('scripts/synthetic-bad.mjs',"console.log('SYNTHETIC-ASSERTION-ON-STDOUT'); process.exitCode = 1;\n");
  const ci=(...a)=>spawnSync(process.execPath,[path.join(root,'scripts/run-ci-suites.mjs'),...a],{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true});
  const none=ci('--grep','no-such-suite');assert.equal(none.status,1);assert.doesNotMatch(none.stdout,/0 of 0 suites passed/);assert.match(none.stderr,/nothing was run/);
  const bare=ci('--grep');assert.equal(bare.status,2);assert.doesNotMatch(bare.stdout,/PASS|FAIL/);
  const bad=ci('--grep','synthetic-bad');assert.equal(bad.status,1);assert.match(bad.stdout,/SYNTHETIC-ASSERTION-ON-STDOUT/);assert.match(bad.stdout,/0 of 1 suites passed/);
  const ok=ci('--grep','synthetic-ok');assert.equal(ok.status,0);assert.match(ok.stdout,/1 of 1 suites passed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
// Final review of 1.17.0 (rev_20260930034635_c08cfb6df42f): a suite the runner itself stopped (its timer, the output
// buffer, a failed spawn) read only "signal SIGTERM"; the spawn error now says which. The copy's timer is shortened.
await test('run-ci-suites: a suite stopped by the runner shows the spawn error',async()=>{
 const {spawnSync}=await import('node:child_process');const os=await import('node:os');const path=await import('node:path');
 const source=fs.readFileSync(new URL('./run-ci-suites.mjs',import.meta.url),'utf8');
 assert(source.includes('timeout: 15 * 60_000'),'the suite timer this test shortens');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'momm-ci-suites-'));
 try{
  const put=(rel,text)=>{fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});fs.writeFileSync(path.join(root,rel),text);};
  put('scripts/run-ci-suites.mjs',source.replace('timeout: 15 * 60_000','timeout: 1500'));
  put('.github/workflows/self-test.yml','jobs:\n  t:\n    steps:\n      - run: node scripts/synthetic-slow.mjs\n');put('scripts/synthetic-slow.mjs','setTimeout(() => {}, 20000);\n');
  const slow=spawnSync(process.execPath,[path.join(root,'scripts/run-ci-suites.mjs')],{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(slow.status,1);assert.match(slow.stdout,/FAIL/);assert.match(slow.stdout,/spawn error: ETIMEDOUT/);assert.match(slow.stdout,/0 of 1 suites passed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
console.log(JSON.stringify({checks,browser_verified:false},null,2));
process.exitCode=checks.every(c=>c.passed)?0:1;
