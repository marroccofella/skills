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
// vm-context values carry foreign prototypes, so structural checks compare JSON.
const same=(actual,expected,message)=>assert.equal(JSON.stringify(actual),JSON.stringify(expected),message);
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
function handler(body,token=true,extra={}) {
  const a=source.indexOf('function createServer('),b=source.indexOf('// The dispatcher',a);assert(a>=0&&b>a);
  let launched=0;
  const context=vm.createContext({...{URL,process,governors:new Set(['codex']),http:{createServer:fn=>fn},isLoopback:()=>true,isAllowedHost:()=>true,authorized:()=>token,
    sendJson:(_,status,value)=>({status,value}),readBody:async()=>body,actionCommand:()=> 'codex update',launchTerminal:()=>{launched++;return true;},
    actionNote:()=>'',readiness:async()=>({routes:[]}),safeDetail:s=>s,
    // 1.16: module-level singletons the server reads; absent under test so the routes must degrade, not throw.
    ledgerWatcher:{status:()=>({watching:true,last_regenerated_at:'2026-09-13T00:00:00.000Z'})},updateClock:null,
    guidanceSnapshot:()=>({project:null}),usageReport:()=>({rows:[]}),clockSnapshot:()=>({}),saveGuidance:()=>({status:200,value:{}}),handleUpdateClock:async()=>({status:503,value:{error:'no clock'}}),GUIDANCE_BODY_LIMIT:65536,
    maintenanceReport:async()=>({cli_updates:[]}),triggerClock:()=>Promise.resolve(null),maintenanceCache:null},...extra});
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
// post-update-clock-null: the POST route must answer 503 itself when no clock runs,
// exactly as GET does, instead of trusting the handler to notice a null clock.
await test('POST /api/update-clock without a clock is a 503 at the route, never a handler call',async()=>{
  let handlerCalls=0;
  const h=handler({op:'set',patch:{}},true,{updateClock:null,handleUpdateClock:async(_body,clock)=>{handlerCalls++;if(!clock)throw new Error('handler reached with a null clock');return {status:200,value:{}};}});
  const r=await h.serve({method:'POST',url:'/api/update-clock',socket:{}},{});
  assert.equal(r.status,503,JSON.stringify(r));assert.match(r.value.error,/update clock is not running/);assert.equal(handlerCalls,0,'route must short-circuit before the handler');
});
// maintenance-cli-updates-uniterable: a report without an iterable cli_updates
// still answers 200; the clock side-effect is skipped, not crashed into a 500.
await test('maintenance report with non-array cli_updates still returns 200 when the clock runs',async()=>{
  for(const cli_updates of [undefined,null,'',{agent:'codex'},42]){
    const installed=[];
    const h=handler({governor:'codex'},true,{updateClock:{setInstalled:(a,v)=>installed.push([a,v])},maintenanceReport:async()=>({cli_updates,models:[]})});
    const r=await h.serve({method:'POST',url:'/api/maintenance',socket:{}},{});
    assert.equal(r.status,200,`cli_updates=${JSON.stringify(cli_updates)} -> ${JSON.stringify(r)}`);assert.deepEqual(installed,[]);
  }
  const installed=[];
  const h=handler({governor:'codex'},true,{updateClock:{setInstalled:(a,v)=>installed.push([a,v])},maintenanceReport:async()=>({cli_updates:[{agent:'codex',current:'1.0.0'},null,{agent:'grok',current:null}]})});
  assert.equal((await h.serve({method:'POST',url:'/api/maintenance',socket:{}},{})).status,200);assert.deepEqual(installed,[['codex','1.0.0']],'positive control: array rows still feed the clock, null rows are skipped');
});
// clock-unhandled-rejection: triggerClock must never let a trigger failure escape,
// whether the clock throws synchronously or returns a rejected promise.
await test('triggerClock records every trigger failure as last_error and never throws or rejects',async()=>{
  const a=source.indexOf('function triggerClock('),b=source.indexOf('function clockTimer(',a);assert(a>=0&&b>a);
  const activity={};
  const c=vm.createContext({clockActivity:activity,safeDetail:s=>String(s),Promise,Date});
  vm.runInContext(source.slice(a,b)+';this.trigger=triggerClock;',c);
  let result;
  assert.doesNotThrow(()=>{result=c.trigger({trigger(){throw new Error('sync boom');}},'setup.open');},'a synchronous throw inside clock.trigger must not escape into the listen callback');
  assert.equal(await result,null);assert.equal(activity.last_error,'sync boom');assert.equal(activity.running,false);
  assert.equal(await c.trigger({trigger:()=>Promise.reject(new Error('async boom'))},'setup.open'),null);assert.equal(activity.last_error,'async boom');
  assert.deepEqual(await c.trigger({trigger:async()=>({ran:true})},'setup.check'),{ran:true});assert.equal(activity.last_error,null,'positive control clears the error');
});
// throw-flag-reads-as-did-not-throw: a crashed regression suite must read as a
// failure that says it threw, and the pass summary must treat that flag as failing.
await test('a regression-suite crash reads as dashboard_regression_threw:true and fails the summary',()=>{
  const a=source.indexOf('function recordRegressionThrow('),b=source.indexOf('async function dashboardRegression(',a);assert(a>=0&&b>a,'helpers must sit before dashboardRegression');
  const c=vm.createContext({process:{stderr:{write(){}}}});
  vm.runInContext(source.slice(a,b)+';this.record=recordRegressionThrow;this.summarize=summarizeChecks;',c);
  const checks=c.record({guidance_ok:true},new Error('boom'));
  assert.equal(checks.dashboard_regression_threw,true,'a throw must never be reported as threw:false');
  const summary=c.summarize(checks);
  assert.equal(summary.passed,false);same(summary.failing,['dashboard_regression_threw']);
  same(c.summarize({a:true,dashboard_regression_threw:false}),{passed:true,failing:[]});
  same(c.summarize({a:true,b:false}),{passed:false,failing:['b']});
});
// watcher-start-before-bind: the ledger watcher starts only once the socket is
// bound; a failed bind never leaves a watcher running behind a dead server.
await test('ledger watcher starts after listen succeeds and is stopped when listen fails',async()=>{
  const a=source.indexOf('function startSetupCenter('),b=source.indexOf('let options;',a);assert(a>=0&&b>a);
  const events=[];
  const fakeServer=(fail)=>{const handlers={};return {on(name,fn){handlers[name]=fn;},listen(port,host,cb){events.push(`listen ${host}:${port}`);if(fail)handlers.error(new Error('EADDRINUSE'));else cb();},address:()=>({port:4321})};};
  const fakeWatcher=()=>({start(){events.push('watcher.start');},stop(){events.push('watcher.stop');}});
  const run=(fail)=>{events.length=0;const c=vm.createContext({process:{stdout:{write:t=>events.push(`out ${t.trim().split('\n')[0]}`)},stderr:{write:t=>events.push(`err ${t.trim()}`)},exitCode:0},openBrowser:()=>events.push('browser'),triggerClock:()=>{events.push('clock');return Promise.resolve(null);},safeDetail:s=>String(s),Promise});
    vm.runInContext(source.slice(a,b)+';this.start=startSetupCenter;',c);
    c.start({server:fakeServer(fail),watcher:fakeWatcher(),clock:{},port:0,browser:true});return c;};
  run(false);
  assert(events.includes('watcher.start'),'a successful bind starts the watcher: '+events.join(' | '));
  assert(events.indexOf('watcher.start')>events.indexOf('listen 127.0.0.1:0'),'watcher must not start before bind: '+events.join(' | '));
  assert(events.includes('out MOMM Setup Center: http://127.0.0.1:4321/'));assert(events.includes('browser'));assert(events.includes('clock'));
  const c=run(true);
  assert(!events.includes('watcher.start'),'a failed bind must never start the watcher: '+events.join(' | '));
  assert(events.includes('watcher.stop'),'a failed bind stops any watcher: '+events.join(' | '));
  assert(events.some(e=>/^err .*EADDRINUSE/.test(e)),events.join(' | '));assert.equal(c.process.exitCode,1);
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
  vm.runInContext(client.slice(0,end)+`\nthis.core={cliRow,launchAction,routeCopy,modelFact,renderMaintenance,loadMaintenance,render,providerCard,routeState,renderUsage,renderUpdateClock,renderGuidance,draftGuidance,routeTotal,selectedBatch,toggleBatch:typeof toggleBatch==='function'?toggleBatch:null};this.init=(s,m)=>{session=s;maintenance=m};this.fail=(a,r)=>liveResults.set(a,{status:'failed',result:r});this.setReport=r=>report=r;this.setApi=f=>api=f;this.getMaintenance=()=>maintenance;this.setUsage=u=>usage=u;this.setClock=c=>clockState=c;this.setGuidance=g=>guidance=g;this.node=s=>document.querySelector(s);showToast=()=>{};`,context);
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
// batch-selection-lost-on-rerender: ticks live in a Set that survives
// renderMaintenance, and the re-rendered checkbox is restored as checked.
await test('batch selection survives a maintenance re-render and drops rows that stop being batchable',()=>{
  const c=ui();
  const row=(agent,extra={})=>({agent,current:'1.0.0',latest:'1.1.0',source:'npm',status:'update_available',installed:true,update_command:`npm install -g @x/${agent}@latest`,installation:{kind:'npm'},...extra});
  const good={cli_updates:[row('codex'),row('gemini'),row('grok',{update_command:null,installed:true})],models:[],skills:{versions:[],repository_dirty:false},environment:{},runtime:{node_ready:true,node:'22',git:'2',powershell:'7',platform:'win32'},checked_at:new Date().toISOString()};
  c.init({platform:'win32',providers:{codex:{label:'Codex',docs:'x'},gemini:{label:'Gemini',docs:'x'},grok:{label:'Grok',docs:'x'}}},good);
  assert.equal(typeof c.core.toggleBatch,'function','the page must own the selection, not the DOM');
  c.core.toggleBatch('codex',true);c.core.toggleBatch('grok',true);
  same(c.core.selectedBatch(),['codex'],'unbatchable rows are never selected');
  c.core.renderMaintenance();
  const html=c.node('#maintenance-grid').innerHTML;
  assert.match(html,/data-batch="codex"[^>]*\schecked\b/,'re-rendered checkbox restores the tick');
  assert(!/data-batch="gemini"[^>]*\schecked\b/.test(html),'unselected rows stay unticked');
  same(c.core.selectedBatch(),['codex'],'selection survives the re-render');
  assert.match(c.node('#batch-update').textContent,/Update 1 selected/);
  c.core.toggleBatch('codex',false);same(c.core.selectedBatch(),[]);
  c.core.toggleBatch('gemini',true);same(c.core.selectedBatch(),['gemini']);good.cli_updates[1]=row('gemini',{installed:false});c.core.renderMaintenance();
  same(c.core.selectedBatch(),[],'a row that lost its verified command is pruned on re-render');
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
// dark-theme-white-contrast / toast-ink-contrast / guidance-user-not-grid: the
// toast and the light primary button take their pair from tokens that both
// palettes define with WCAG AA contrast; .guidance-user is a grid on its own.
const css=fs.readFileSync(new URL('../assets/setup-ui/styles.css',import.meta.url),'utf8');
function luminance(hex){const m=/^#([0-9a-f]{6})$/i.exec(hex.trim());assert(m,`not a 6-digit hex colour: ${hex}`);const [r,g,b]=[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);return 0.2126*r+0.7152*g+0.0722*b;}
function contrast(a,b){const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (hi+0.05)/(lo+0.05);}
function block(selector){const i=css.indexOf(selector);assert(i>=0,`missing rule ${selector}`);const open=css.indexOf('{',i),close=css.indexOf('}',open);return css.slice(open+1,close);}
function token(body,name){const m=new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body);assert(m,`token ${name} not declared in this palette`);return m[1].trim();}
await test('WCAG helper sanity',()=>{assert(Math.abs(contrast('#ffffff','#000000')-21)<0.01);assert(contrast('#ffffff','#e6ffe6')<1.1,'the reported white-on-dark-ink toast really was unreadable');assert(contrast('#00c27a','#ffffff')<3,'the reported dark --green on a white button really failed AA');});
for(const [palette,selector] of [['light',':root {'],['dark toggle',':root[data-theme="dark"]'],['dark system',':root:not([data-theme="light"])']]){
  await test(`${palette} palette declares toast and light-button pairs with contrast >= 4.5:1`,()=>{
    const body=block(selector);
    for(const [bg,ink] of [['--toast-bg','--toast-ink'],['--light-button-bg','--light-button-ink']]){
      const ratio=contrast(token(body,bg),token(body,ink));assert(ratio>=4.5,`${palette} ${ink} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });
}
await test('toast and light primary button read their colours from the tokens, never a hard-coded white',()=>{
  const toast=block('.toast {');assert.match(toast,/color:\s*var\(--toast-ink\)/);assert.match(toast,/background:\s*var\(--toast-bg\)/);assert(!/color:\s*white/.test(toast));assert(!/var\(--ink\)/.test(toast));
  const button=block('.button.primary.light {');assert.match(button,/color:\s*var\(--light-button-ink\)/);assert.match(button,/background:\s*var\(--light-button-bg\)/);assert(!/\bwhite\b/.test(button));
});
await test('.guidance-user establishes its own grid',()=>{assert.match(block('.guidance-user {'),/display:\s*grid/);});
console.log(JSON.stringify({passed:passed.length,checks:passed,failures},null,2));
if(failures.length) process.exitCode=1;
