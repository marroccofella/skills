import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
const source = fs.readFileSync(new URL('./setup-ui.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function parseVersion('), end = source.indexOf('// Returns true only if a terminal');
assert(start >= 0 && end > start);
const passed = [], failures = [];
async function test(name, fn) { try { await fn(); passed.push(name); } catch (e) { failures.push({name,error:e.message}); } }
async function report(grok = {code:0,stdout:'{}'}) {
  const calls = [];
  const context = vm.createContext({
    Date, process, maintenanceCache:null, localVersionsFile:'versions.json', publishedVersionsUrl:'manifest', skillsRoot:'.',
    fs:{readFileSync:()=>'{"momm":"1.15.0"}',existsSync:()=>true}, path:{join:(...p)=>p.join('/')},
    os:{platform:()=>process.platform,release:()=>'',arch:()=>''},
    providers:Object.fromEntries(['codex','claude','gemini','antigravity','copilot','grok'].map(a=>[a,{}])),
    safeDetail:s=>String(s || ''),
    readiness:async governor => { calls.push(governor); return {routes:['codex','claude','gemini','antigravity','copilot','grok'].map(agent=>agent===governor?{agent,role:'governor'}:{agent,version:'1.0.0',installed:true,ready:false})}; },
    runCommand:async(cmd,args)=>cmd==='grok'?grok:{code:0,stdout:args.includes('status')?'':'1.0.0'},
    detectInstallation:()=>({kind:'native',path:null}),
    actionCommand:()=>null,
  });
  vm.runInContext(source.slice(start,end)+'\nfetchJson=async()=>({version:"1.0.0"}); this.core={maintenanceReport,compareVersions};',context);
  return {value:await context.core.maintenanceReport('codex'),calls,compare:context.core.compareVersions};
}
await test('inventory includes the controller version without self review',async()=>{const r=await report();assert.equal(r.value.cli_updates.length,6);assert.equal(r.value.cli_updates.find(x=>x.agent==='codex').current,'1.0.0');assert(r.calls.includes('other'));});
for (const [name,result] of Object.entries({empty:{code:0,stdout:'{}'},exit_failure:{code:1,stdout:'{"latestVersion":"1.0.0","updateAvailable":false}'},malformed:{code:0,stdout:'not json'},missing_boolean:{code:0,stdout:'{"latestVersion":"1.0.0"}'},timeout:{code:null,timedOut:true,stdout:'{}'}})) {
  await test(`Grok ${name} never reports current`,async()=>{const r=await report(result);assert.equal(r.value.cli_updates.find(x=>x.agent==='grok').status,'unknown');});
}
await test('Antigravity latest is unknown, not assumed managed',async()=>{const r=await report();assert.equal(r.value.cli_updates.find(x=>x.agent==='antigravity').status,'unknown');});
await test('prerelease sorts before stable',async()=>{const r=await report();assert.equal(r.compare('1.0.0-beta.1','1.0.0'),-1);assert.equal(r.compare('1.0.0-beta.2','1.0.0-beta.10'),-1);});
await test('valid native latest result is current',async()=>{const r=await report({code:0,stdout:'{"latestVersion":"1.0.0","updateAvailable":false}'});assert.equal(r.value.cli_updates.find(x=>x.agent==='grok').status,'current');});
await test('explicit native update availability survives equal semantic versions',async()=>{const r=await report({code:0,stdout:'{"latestVersion":"1.0.0","updateAvailable":true}'});assert.equal(r.value.cli_updates.find(x=>x.agent==='grok').status,'update_available');});
await test('installation discovery preserves npm and refuses unknown shims',()=>{
  const begin=source.indexOf('const npmPackages ='), finish=source.indexOf('function actionNote(');
  assert(begin>=0 && finish>begin);
  const context=vm.createContext({fs,path,process,Buffer,platformKey:()=> 'win32',providers:{codex:{update:{win32:'unused'}},gemini:{update:{win32:'unused'}}}});
  vm.runInContext(source.slice(begin,finish)+'\nthis.detect=detectInstallation;this.action=actionCommand;',context);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'momm-update-origin-'));
  try {
    fs.writeFileSync(path.join(temp,'codex.cmd'),'@echo NOT_EXECUTED');
    assert.equal(context.detect('codex',{Path:temp},'win32').kind,'unknown');
    const pkg=path.join(temp,'node_modules/@openai/codex');fs.mkdirSync(pkg,{recursive:true});
    fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'@openai/codex'}));
    assert.equal(context.detect('codex',{Path:temp},'win32').kind,'npm');
    context.process={platform:'win32',env:{Path:temp}};
    assert.equal(context.action('codex','update'),`npm install -g --prefix '${temp}' @openai/codex@latest`);
    fs.writeFileSync(path.join(temp,'gemini.exe'),'not executable; discovery fixture');
    assert.equal(context.action('gemini','update'),null,'unknown native Gemini must not create shadow npm installation');
    assert.equal(context.action('codex;bad','update'),null);
    const local=path.join(temp,'node_modules/.bin');fs.mkdirSync(local,{recursive:true});fs.writeFileSync(path.join(local,'codex.cmd'),'@echo fixture');
    context.process={platform:'win32',env:{Path:local}};
    assert.equal(context.action('codex','update'),null,'project local wrapper must not select global npm');
    fs.writeFileSync(path.join(temp,'grok.exe'),Buffer.from('MZfixture'));
    context.process={platform:'win32',env:{Path:temp}};
    context.providers.grok={};
    assert.equal(context.action('grok','update'),`& '${path.join(temp,'grok.exe')}' update --stable`);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
const client=fs.readFileSync(new URL('../assets/setup-ui/app.js',import.meta.url),'utf8');
await test('POSIX discovery excludes Homebrew casks and skips non-executable PATH entries',()=>{
  const begin=source.indexOf('const npmPackages ='),finish=source.indexOf('function actionCommand(');
  const seen=[];
  const fakeFs={...fs,statSync:()=>({isFile:()=>true}),accessSync:file=>{seen.push(file);if(file.startsWith('/blocked/'))throw Error('not executable');},
    realpathSync:()=>'/opt/homebrew/Caskroom/grok/1.0.30/grok'};
  const c=vm.createContext({fs:fakeFs,path:path.posix,process,Buffer});
  vm.runInContext(source.slice(begin,finish)+'\nthis.detect=detectInstallation;',c);
  const result=c.detect('grok',{PATH:'/blocked:/opt/homebrew/bin'},'darwin');
  assert.equal(result.kind,'homebrew');assert.equal(result.path,'/opt/homebrew/bin/grok');assert.equal(seen.length,2);
});
await test('known package-manager native shims are not self-updating installations',()=>{
  const begin=source.indexOf('const npmPackages ='),finish=source.indexOf('function actionCommand(');
  for(const resolved of ['/fixture/.volta/bin/volta-shim','/fixture/scoop/shims/codex.exe','/fixture/chocolatey/bin/codex.exe']){
    const fakeFs={...fs,statSync:()=>({isFile:()=>true}),accessSync(){},realpathSync:()=>resolved,readFileSync(){throw Error('no npm metadata');},openSync:()=>7,readSync:(_fd,b)=>{Buffer.from('MZxx').copy(b);return 4;},closeSync(){}};
    const c=vm.createContext({fs:fakeFs,path:path.posix,process,Buffer});vm.runInContext(source.slice(begin,finish)+';this.detect=detectInstallation;',c);
    assert.notEqual(c.detect('codex',{PATH:'/fixture/bin'},'linux').kind,'native',resolved);
  }
});
function handler(body,token=true) {
  const a=source.indexOf('function createServer('),b=source.indexOf('// The dispatcher',a);assert(a>=0&&b>a);
  let launched=0;
  const context=vm.createContext({URL,process,governors:new Set(['codex']),http:{createServer:fn=>fn},isLoopback:()=>true,isAllowedHost:()=>true,authorized:()=>token,
    sendJson:(_,status,value)=>({status,value}),readBody:async()=>body,actionCommand:()=> 'codex update',launchTerminal:()=>{launched++;return true;},
    actionNote:()=>'',readiness:async()=>({routes:[]}),safeDetail:s=>s,
    // 1.16: module-level singletons the server reads; absent under test so the routes must degrade, not throw.
    ledgerWatcher:{status:()=>({watching:true,last_regenerated_at:'2026-09-13T00:00:00.000Z'})},updateClock:null,
    guidanceSnapshot:()=>({project:null}),usageReport:()=>({rows:[]}),clockSnapshot:()=>({}),saveGuidance:()=>({status:200,value:{}}),handleUpdateClock:async()=>({status:503,value:{error:'no clock'}}),GUIDANCE_BODY_LIMIT:65536});
  const serve=vm.runInContext(source.slice(a,b)+';createServer()',context);
  return {serve,launches:()=>launched};
}
await test('update endpoint requires the exact confirmed command',async()=>{
  const h=handler({provider:'codex',action:'update'});
  const r=await h.serve({method:'POST',url:'/api/action',socket:{}},{});assert.equal(r.status,409);assert.equal(h.launches(),0);
});
await test('matching action confirmation launches and supplied mismatches never launch',async()=>{
  for(const action of ['update','install','login']){const h=handler({provider:'codex',action,expected_command:'codex update'});const r=await h.serve({method:'POST',url:'/api/action',socket:{}},{});assert.equal(r.status,202);assert.equal(h.launches(),1);}
  for(const provider of ['codex','skills']){const h=handler({provider,action:provider==='skills'?'update':'login',expected_command:'different command'});const r=await h.serve({method:'POST',url:'/api/action',socket:{}},{});assert.equal(r.status,409);assert.equal(h.launches(),0);}
});
await test('readiness endpoint requires local session before spawning probes',async()=>{
  const h=handler({},false);const r=await h.serve({method:'GET',url:'/api/status?governor=codex',socket:{}},{});assert.equal(r.status,403);
});
await test('status carries the ledger regeneration time; new GET routes need the session token too',async()=>{
  const h=handler({});const r=await h.serve({method:'GET',url:'/api/status?governor=codex',socket:{}},{});
  assert.equal(r.status,200);assert.equal(r.value.ledger.last_regenerated_at,'2026-09-13T00:00:00.000Z');assert.deepEqual(r.value.routes,[]);
  for(const route of ['/api/guidance','/api/usage','/api/update-clock']){const denied=await handler({},false).serve({method:'GET',url:route,socket:{}},{});assert.equal(denied.status,403,route);}
  const noClock=await h.serve({method:'GET',url:'/api/update-clock',socket:{}},{});assert.equal(noClock.status,503,'no clock under --self-test degrades to 503, never a crash');
  const post=await handler({op:'set',patch:{}}).serve({method:'POST',url:'/api/update-clock',socket:{}},{});assert.equal(post.status,503);
});
await test('request body decodes split UTF-8 once and closes oversize streams',async()=>{
  const a=source.indexOf('function readBody('),b=source.indexOf('function authorized(',a);assert(a>=0&&b>a);
  const read=vm.runInNewContext(source.slice(a,b)+';readBody',{Buffer});
  const request=new EventEmitter();const promise=read(request);const bytes=Buffer.from('{"text":"😀"}');
  for(const byte of bytes) request.emit('data',Buffer.from([byte]));request.emit('end');assert.equal((await promise).text,'😀');
  const oversized=new EventEmitter();let destroyed=false;oversized.destroy=()=>{destroyed=true;};const pending=read(oversized);
  oversized.emit('data',Buffer.alloc(5000));await assert.rejects(pending);assert.equal(destroyed,true);
});
function ui() {
  // Minimal DOM double: every selector resolves to a node that accepts the
  // properties and listeners the page touches (theme toggle included). Timers
  // are inert so a declined update's background poll cannot outlive the test.
  const nodes=new Map();
  const node=()=>({value:'codex',textContent:'',innerHTML:'',title:'',hidden:false,disabled:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]});
  const document={querySelector:s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);}};
  const inert=()=>({unref(){}});
  const context=vm.createContext({document,Map,Number,console,setTimeout:inert,clearTimeout(){},setInterval:inert,clearInterval(){},localStorage:{getItem:()=>null,setItem(){}},window:{confirm:()=>false},fetch:()=>{throw Error('Unexpected network');}});
  const end=client.indexOf('grid.addEventListener(');assert(end>0);
  vm.runInContext(client.slice(0,end)+`\nthis.core={cliRow,launchAction,routeCopy,modelFact,renderMaintenance,loadMaintenance,render,providerCard,routeState,renderUsage,renderUpdateClock,renderGuidance,draftGuidance,routeTotal};this.init=(s,m)=>{session=s;maintenance=m};this.fail=(a,r)=>liveResults.set(a,{status:'failed',result:r});this.setReport=r=>report=r;this.setApi=f=>api=f;this.getMaintenance=()=>maintenance;this.setUsage=u=>usage=u;this.setClock=c=>clockState=c;this.setGuidance=g=>guidance=g;this.node=s=>document.querySelector(s);showToast=()=>{};`,context);
  return context;
}
await test('six CLI rows include controller, unknown latest and explicit native update',()=>{
  const c=ui();const names=['codex','claude','gemini','antigravity','copilot','grok'];
  c.init({platform:'win32',providers:Object.fromEntries(names.map(n=>[n,{label:n,docs:'https://example.invalid'}]))},null);
  const html=names.map(agent=>c.core.cliRow({agent,current:'1.0.0',latest:null,source:'unavailable',status:'unknown',installed:true,update_command:'native update',installation:{kind:'native'}})).join('');
  assert.equal((html.match(/<tr>/g)||[]).length,6);assert.match(html,/Controller \(not a reviewer\)/);assert.match(html,/Check \/ update/);assert(!html.includes('null'));assert(!html.includes('undefined'));
});
await test('batch checkbox appears only for rows with a verified update command',()=>{
  const c=ui();c.init({platform:'win32',providers:{codex:{label:'Codex',docs:'x'},grok:{label:'Grok',docs:'x'},gemini:{label:'Gemini',docs:'x'}}},null);
  const ok=c.core.cliRow({agent:'codex',current:'1.0.0',latest:'1.1.0',source:'npm',status:'update_available',installed:true,update_command:'npm install -g --prefix p @openai/codex@latest',installation:{kind:'npm'}});
  const managed=c.core.cliRow({agent:'grok',current:'1.0.0',latest:null,source:'x',status:'unknown',installed:true,update_command:null,installation:{kind:'unknown'}});
  const missing=c.core.cliRow({agent:'gemini',current:null,latest:'1.0.0',source:'npm',status:'missing',installed:false,update_command:'npm install -g @google/gemini-cli@latest',installation:{kind:'unknown'}});
  assert.match(ok,/data-batch="codex"/);assert(!managed.includes('data-batch'),'package-manager-owned rows are not batchable');assert(!missing.includes('data-batch'),'missing CLIs are not batchable');
  assert.equal((ok+managed+missing).match(/<tr>/g).length,3);
});
await test('usage table says "0 of n reported", never a zero, for routes without CLI usage',()=>{
  const c=ui();c.init({platform:'win32',providers:{antigravity:{label:'Antigravity'},grok:{label:'Grok'}}},null);
  c.setUsage({rows:[{agent:'antigravity',reviews:3,tokens_reported:0,cost_reported:0,coverage:{tokens:'0 of 3',cost:'0 of 3'},median_total_tokens:null,total_cost_usd:null,cost_per_accepted_finding:null},
    {agent:'grok',reviews:2,tokens_reported:2,cost_reported:2,coverage:{tokens:'2 of 2',cost:'2 of 2'},median_total_tokens:12000,total_cost_usd:0.03,cost_per_accepted_finding:'no accepted findings'}],coverage:{reviews:5,reports_scanned:4,reports_available:4,reports_with_usage:2,limit:200},note:null});
  c.core.renderUsage();const html=c.node('#usage-table').innerHTML;
  assert.match(html,/not reported<\/span><small>0 of 3 reported/);assert.match(html,/12,000<small>2 of 2 reported/);assert.match(html,/no accepted findings/);assert.match(html,/as reported/);
  assert(!/<td>0<\/td>/.test(html),'absent data must never render as a zero');assert(!html.includes('null'));assert(!html.includes('NaN'));
  c.setUsage({rows:[],coverage:{},note:'No report carries CLI-reported usage yet.'});c.core.renderUsage();assert.match(c.node('#usage-table').innerHTML,/No report carries/);
});
await test('automatic updates card renders off by default with the exact timer command and no apply button',()=>{
  const c=ui();c.init({platform:'win32',providers:{codex:{label:'Codex'}}},null);
  c.setClock({auto_update:{enabled:false,skill:true,clis:true,models:true,accept_protocol:false},clock:{},sources:[{name:'skill',kind:'skill',installed:'1.16.0',latest:'1.16.0',update_available:false,interval_ms:3600000,last_checked_at:null,next_due_at:null,last_error:null},{name:'cli:codex',kind:'cli',installed:'1.0.0',latest:'1.1.0',update_available:true,interval_ms:1800000,last_error:'HTTP 503'}],overhead_estimate_per_day:6,timer:{platform:'win32',install:'schtasks /Create /SC HOURLY /MO 6 /TN MOMM-UpdateClock /TR "x"',remove:'schtasks /Delete /TN MOMM-UpdateClock /F'},activity:{running:false}});
  c.core.renderUpdateClock();const html=c.node('#update-clock-card').innerHTML;
  assert.match(html,/data-clock-setting="enabled"(?! checked)/);assert(!html.includes('data-clock-action="apply"'),'apply is offered only when enabled');
  assert.match(html,/data-clock-setting="skill" checked disabled/,'sub-toggles are inert while the master is off');
  assert(html.includes('schtasks /Create /SC HOURLY /MO 6 /TN MOMM-UpdateClock /TR &quot;x&quot;'),'exact timer command shown, escaped');
  assert.match(html,/Estimated 6 conditional requests per day/);assert.match(html,/HTTP 503/);assert.match(html,/Codex CLI/);assert(!html.includes('undefined'));
});
await test('guidance editor omits empty blocks and totals a route against user-level layers',()=>{
  const c=ui();c.init({platform:'win32',providers:{codex:{label:'Codex'}}},null);
  c.setGuidance({routes:['codex'],effective:{codex:{layers:[{name:'persona',chars:999},{name:'user:*',chars:100},{name:'project:.reviewrules',chars:50},{name:'project:*',chars:7000}]}}});
  assert.equal(c.core.routeTotal('codex',{'*':'abcd',codex:'   '}),100+50+4+2*2,'persona and stale project blocks excluded; blank draft blocks skipped');
  const editor=c.node('#guidance-editor');editor.querySelectorAll=()=>[{dataset:{guidance:'governor'},value:'  '},{dataset:{guidance:'*'},value:'keep spacing  '},{dataset:{guidance:'codex'},value:''}];
  assert.equal(JSON.stringify(c.core.draftGuidance()),JSON.stringify({reviewers:{'*':'keep spacing  '}}));
});
await test('declining update never calls mutation API',async()=>{
  const c=ui();let calls=0;c.setApi(async()=>{calls++;return {};});
  c.init({platform:'win32',providers:{codex:{}}},{cli_updates:[{agent:'codex',update_command:'codex update'}]});await c.core.launchAction('codex','update');assert.equal(calls,0);
  c.window.confirm=()=>true;await c.core.launchAction('codex','update');assert.equal(calls,1,'positive control must reach the same instrumented API');
});
await test('quota failure is not turned into authentication advice',()=>{
  const c=ui();c.fail('copilot',{route_status:'error',detail:'Monthly quota exceeded'});
  assert.equal(c.core.routeCopy({agent:'copilot'},'failed'),'Monthly quota exceeded');
  assert.equal(c.core.modelFact({agent:'copilot'},'failed',{}),'Check failed');
});
await test('malformed maintenance never replaces last good state',async()=>{
  const good={cli_updates:[],models:[],skills:{versions:[],repository_dirty:false},environment:{},runtime:{node_ready:true,node:'22',git:'2',powershell:'7',platform:'win32'},checked_at:new Date().toISOString()};
  for(const bad of [{},{...good,models:undefined},{...good,cli_updates:''},{...good,environment:{api_key_names_present:null}},{...good,runtime:{platform:null}}]) {
    const c=ui();c.init({platform:'win32',providers:{codex:{label:'Codex'}}},good);c.setReport({routes:[{agent:'codex',installed:true,ready:true}]});c.setApi(async()=>bad);
    await c.core.loadMaintenance();assert.equal(c.getMaintenance(),good,'invalid payload poisoned cached display');assert.doesNotThrow(()=>c.core.render());
  }
});
await test('failed login can be verified again without erasing the failed check',()=>{
  const c=ui();c.init({platform:'win32',providers:{codex:{label:'Codex'},copilot:{label:'Copilot'}}},null);
  const route={agent:'codex',installed:true,ready:true};c.fail('codex',{route_status:'authentication_required',detail:'Expired login'});
  const html=c.core.providerCard(route);assert.match(html,/data-action="login"/);assert.match(html,/data-test="codex"/);assert.equal(c.core.routeState(route),'failed');
  c.fail('copilot',{route_status:'error',detail:'Monthly quota exceeded'});const quota=c.core.providerCard({...route,agent:'copilot'});assert.match(quota,/data-test="copilot"/);assert(!quota.includes('data-action="login"'));
});
console.log(JSON.stringify({passed:passed.length,checks:passed,failures},null,2));
if(failures.length) process.exitCode=1;
