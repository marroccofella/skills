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
async function test(name, fn) { try { await fn(); passed.push(name); } catch (e) { failures.push({name,error:e.message,stack:String(e.stack||'').split('\n').slice(1,4).map(l=>l.trim())}); } }
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
    ledgerWatcher:{status:()=>({watching:true,last_regenerated_at:'2026-09-13T00:00:00.000Z'})},updateClock:null,setupPointer:null,
    // 1.16 cross-links: the static allowlist and the ledger route are stubbed so the dispatch itself is what is under test.
    STATIC_ASSETS:{'/':['index.html','text/html; charset=utf-8'],'/momm-theme.css':['momm-theme.css','text/css; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8']},
    serveAsset:(_,file,contentType)=>({status:200,asset:file,contentType}),serveLedger:async()=>({status:200,ledger:true}),ledgerFileUrl:()=>'file:///C:/proj/.ensemble_reviews/ledger.html',Object,
    guidanceSnapshot:()=>({project:null}),usageReport:()=>({rows:[]}),clockSnapshot:()=>({}),saveGuidance:()=>({status:200,value:{}}),handleUpdateClock:async()=>({status:503,value:{error:'no clock'}}),GUIDANCE_BODY_LIMIT:65536,
    // 1.16 E7: the Modalities routes hand the handler's status through untouched.
    capabilitiesSnapshot:async()=>({status:200,value:{routes:{codex:{}},blockers:[]}}),handleCapabilities:async(body)=>({status:body?.op==='probe'&&body.generate&&body.consent!==true?409:200,value:{op:body?.op}}),
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
await test('status carries the ledger regeneration time and ledger_url; new GET routes need the session token too',async()=>{
  const h=handler({});const r=await h.serve({method:'GET',url:'/api/status?governor=codex',socket:{}},{});
  assert.equal(r.status,200);assert.equal(r.value.ledger.last_regenerated_at,'2026-09-13T00:00:00.000Z');assert.deepEqual(r.value.routes,[]);
  assert.equal(r.value.ledger_url,'file:///C:/proj/.ensemble_reviews/ledger.html','ledger_url is the file URL the server computed, or null');
  const none=await handler({},true,{ledgerFileUrl:()=>null}).serve({method:'GET',url:'/api/status?governor=codex',socket:{}},{});assert.equal(none.value.ledger_url,null);
  for(const route of ['/api/guidance','/api/usage','/api/update-clock']){const denied=await handler({},false).serve({method:'GET',url:route,socket:{}},{});assert.equal(denied.status,403,route);}
  const noClock=await h.serve({method:'GET',url:'/api/update-clock',socket:{}},{});assert.equal(noClock.status,503,'no clock under --self-test degrades to 503, never a crash');
  const post=await handler({op:'set',patch:{}}).serve({method:'POST',url:'/api/update-clock',socket:{}},{});assert.equal(post.status,503);
});
await test('the shared theme is served as CSS before styles.css, and /ledger dispatches to the ledger route without a session token',async()=>{
  const h=handler({},false);
  const theme=await h.serve({method:'GET',url:'/momm-theme.css',socket:{}},{});assert.equal(theme.asset,'momm-theme.css');assert.equal(theme.contentType,'text/css; charset=utf-8');
  const styles=await h.serve({method:'GET',url:'/styles.css',socket:{}},{});assert.equal(styles.contentType,'text/css; charset=utf-8');
  const page=await h.serve({method:'GET',url:'/',socket:{}},{});assert.equal(page.asset,'index.html');
  const ledger=await h.serve({method:'GET',url:'/ledger',socket:{}},{});assert.equal(ledger.ledger,true,'the ledger is a page, not an API call: same-origin navigation carries no token');
  for(const url of ['/constructor','/__proto__','/hasOwnProperty','/ledger.html','/momm-theme.css.map']){const r=await h.serve({method:'GET',url,socket:{}},{});assert.equal(r.status,404,url);}
  const html=fs.readFileSync(new URL('../assets/setup-ui/index.html',import.meta.url),'utf8');
  assert(html.indexOf('href="/momm-theme.css"')>=0&&html.indexOf('href="/momm-theme.css"')<html.indexOf('href="/styles.css"'),'theme linked before the page styles');
  assert.match(html,/<nav class="momm-nav"[^>]*><a id="ledger-link" href="\/ledger"/,'topbar nav pill to the private ledger');
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
  const a=source.indexOf('let clockInflight = null;'),b=source.indexOf('function clockTimer(',a);assert(a>=0&&b>a,'the re-entry guard must sit between clockActivity and clockTimer');
  const activity={};
  const c=vm.createContext({clockActivity:activity,safeDetail:s=>String(s),Promise,Date});
  vm.runInContext(source.slice(a,b)+';this.trigger=triggerClock;',c);
  let result;
  assert.doesNotThrow(()=>{result=c.trigger({trigger(){throw new Error('sync boom');}},'setup.open');},'a synchronous throw inside clock.trigger must not escape into the listen callback');
  assert.equal(await result,null);assert.equal(activity.last_error,'sync boom');assert.equal(activity.running,false);
  assert.equal(await c.trigger({trigger:()=>Promise.reject(new Error('async boom'))},'setup.open'),null);assert.equal(activity.last_error,'async boom');
  const ok=await c.trigger({trigger:async()=>({ran:true}),settings:()=>({auto_update:{enabled:false}})},'setup.check');
  assert.equal(ok.ran,true);assert.equal(ok.apply.skipped_reason,'auto_update_disabled','a disabled clock reports the check without applying');assert.equal(activity.last_error,null,'positive control clears the error');
});
// clock-activity-reentrant: trigger, apply and timer run under one guard. A second
// trigger while one is in flight is a 409 (never a restart), apply and timer are
// 409 too, and activity.running stays true until the live run finishes.
await test('update-clock operations share one re-entry guard and never overlap',async()=>{
  const a=source.indexOf('const clockActivity ='),b=source.indexOf('// --- Ledger auto-regeneration',a);assert(a>=0&&b>a);
  let timerExecs=0;
  const c=vm.createContext({process,Promise,Date,safeDetail:s=>String(s),writeSettings(){},applyUpdates:async()=>{throw new Error('apply must not run while disabled or busy');},installTimer:async()=>({done:true}),removeTimer:async({exec})=>{await exec();return {done:true};},timerCommand:()=>({platform:'test',install:'install-cmd',remove:'remove-cmd'}),platformKey:()=>'test',updateClockScript:'clock.mjs',maintenanceCache:null,processScope:{},supervise(){},runNode(){},updaterScript:'',runCommand(){},detectInstallation:()=>({kind:'npm'}),createUpdateClock(){},localSkillVersion:()=>'1.16.0'});
  vm.runInContext(source.slice(a,b)+';this.handle=handleUpdateClock;this.trigger=triggerClock;this.activity=clockActivity;',c);
  // Every trigger's resolver is kept, and every busy call is raced against a
  // tick: a handler that joins or restarts the in-flight run would otherwise
  // hang this test instead of failing it.
  let calls=0;const releases=[];const releaseAll=(value)=>{for(const r of releases.splice(0)) r(value);};
  const clock={trigger(){calls++;return new Promise(r=>{releases.push(r);});},status:()=>({}),settings:()=>({auto_update:{enabled:false}})};
  const tick=()=>new Promise(r=>setImmediate(r));
  const settled=(p)=>Promise.race([p,tick().then(()=>'unsettled')]);
  const inFlight=c.handle({op:'trigger',event:'manual'},clock,{});await tick();
  assert.equal(c.activity.running,true);assert.equal(calls,1);
  for(const body of [{op:'trigger',event:'manual'},{op:'apply'},{op:'timer',action:'remove',confirm:true,expected_command:'remove-cmd'}]){
    const r=await settled(c.handle(body,clock,{exec:async()=>{timerExecs++;}}));
    assert.notEqual(r,'unsettled',`${JSON.stringify(body)} must be refused at once, not joined to the in-flight run`);
    assert.equal(r.status,409,JSON.stringify(body));assert.match(r.value.error,/busy/);
  }
  assert.equal(await settled(c.trigger(clock,'setup.open')),null,'fire-and-forget joins nothing and restarts nothing');
  assert.equal(calls,1,'the in-flight check was never restarted');assert.equal(timerExecs,0);assert.equal(c.activity.running,true);
  releaseAll({checked:true});const done=await inFlight;
  assert.equal(done.status,200);assert.equal(done.value.result.checked,true);assert.equal(c.activity.running,false);
  let runningDuringTimer=null;
  const timer=await c.handle({op:'timer',action:'remove',confirm:true,expected_command:'remove-cmd'},clock,{exec:async()=>{runningDuringTimer=c.activity.running;timerExecs++;}});
  assert.equal(timer.status,200);assert.equal(runningDuringTimer,true,'timer actions run under the same guard');assert.equal(c.activity.last_event,'timer.remove');assert.equal(c.activity.running,false);
  const again=c.handle({op:'trigger',event:'manual'},clock,{});await tick();releaseAll({second:true});
  assert.equal((await again).status,200);assert.equal(calls,2,'control: an idle clock triggers again');
});
// Shared fixture for the clock slice: the production handler, triggerClock and
// clockActivity with every child-process seam stubbed. `applyUpdates` is the
// module fake; it records the dependency object the handler hands it.
function clockSlice(overrides={}) {
  const a=source.indexOf('const clockActivity ='),b=source.indexOf('// --- Ledger auto-regeneration',a);assert(a>=0&&b>a);
  const seen={applyDeps:[],probes:[],recorded:[],runningDuringApply:[]};
  const c=vm.createContext({process,Promise,Date,JSON,String,Object,Array,Set,Boolean,safeDetail:s=>String(s),writeSettings(){},
    applyUpdates:async(_clock,deps)=>{seen.applyDeps.push(deps);seen.runningDuringApply.push(c.activity.running);return overrides.applyResult?overrides.applyResult():{applied:[],skipped:[],failed:[],notices:[],skipped_reason:null};},
    runProbes:async(cli,opts)=>{seen.probes.push({cli,opts});return {schema:'momm-probe/1',cli,cli_version:'1.1.0',verdict:overrides.verdict||'fail',containment:{status:'unavailable'},one_line_review:{status:'ok'}};},
    recordProbe:(root,result)=>{seen.recorded.push({root,result});return 'probes.jsonl';},
    windowsLauncher:(command,args)=>({command,args}),
    os:{tmpdir:()=>os.tmpdir()},installTimer:async()=>({done:true}),removeTimer:async()=>({done:true}),timerCommand:()=>({platform:'test',install:'install-cmd',remove:'remove-cmd'}),platformKey:()=>'test',updateClockScript:'clock.mjs',maintenanceCache:null,processScope:{},supervise(){},runNode(){},updaterScript:'',runCommand(){},detectInstallation:()=>({kind:'npm'}),createUpdateClock(){},localSkillVersion:()=>'1.16.0'});
  vm.runInContext(source.slice(a,b)+';this.handle=handleUpdateClock;this.trigger=triggerClock;this.activity=clockActivity;',c);
  return {c,seen};
}
const fakeClock=(enabled,trigger=async()=>({ran:true,skipped_reason:null,results:[]}))=>({trigger,status:()=>({}),settings:()=>({auto_update:{enabled}})});
// dashboard-apply-skips-probe (audit finding 5): the real handler must hand the
// module a post-update probe built from probes.mjs — runProbes with a processScope
// exec and the OS tmpdir, recorded into this project's probes ledger — and report
// each applied CLI's re-read version and verdict; a failed probe is never "ready".
await test('the dashboard apply path wires the production containment probe and reports its verdict per CLI',async()=>{
  const {c,seen}=clockSlice({applyResult:()=>({applied:[{name:'cli:codex',command:'npm install -g @openai/codex@latest',from:'1.0.0',to:'1.1.0',probe:{status:'fail',containment:'unavailable',one_line_review:'ok',cli_version:'1.1.0'}},{name:'skill',from:'1.15.1',to:'1.16.0'}],skipped:[],failed:[],notices:['codex updated']})});
  const r=await c.handle({op:'apply'},fakeClock(true),{runUpdater:async()=>({code:0,output:''}),exec:async()=>({code:0}),versionOf:async()=>'1.1.0',isManaged:()=>false});
  assert.equal(r.status,200);assert.equal(seen.applyDeps.length,1,'applyUpdates runs once');
  const deps=seen.applyDeps[0];
  assert.equal(typeof deps.postUpdateProbe,'function','the handler must supply postUpdateProbe; the module defaults it to null and records the update as applied without any probe');
  const probe=await deps.postUpdateProbe('codex');
  assert.equal(seen.probes.length,1);assert.equal(seen.probes[0].cli,'codex');
  assert.equal(typeof seen.probes[0].opts.exec,'function','runProbes must get the server-owned exec, never its synchronous default');
  assert.equal(seen.probes[0].opts.tmpdir,os.tmpdir());
  assert.equal(seen.recorded.length,1);assert.equal(seen.recorded[0].root,process.cwd(),'the probe is recorded into this project');
  assert.equal(seen.recorded[0].result.verdict,'fail');assert.equal(probe.status,'fail','the module reads probe.status');assert.equal(probe.cli_version,'1.1.0');
  const codex=r.value.applied.find(x=>x.name==='cli:codex');
  assert.equal(codex.version,'1.1.0','the re-read version is surfaced');assert.equal(codex.probe_verdict,'fail');assert.equal(codex.ready,false);
  assert.equal(codex.verification,'updated, containment not verified');
  const skill=r.value.applied.find(x=>x.name==='skill');assert.equal(skill.ready,null,'the skill row has no probe and no readiness claim');
  assert.equal(r.value.activity.last_apply.event,'apply');assert.equal(r.value.activity.last_apply.applied,2);
  assert.equal(r.value.activity.last_apply.rows.find(x=>x.name==='cli:codex').verification,'updated, containment not verified');
  // A thrown probe reaches the row as status "error": still not verified, still not ready.
  const {c:c2}=clockSlice({applyResult:()=>({applied:[{name:'cli:grok',from:'1.0.0',to:null,probe:{status:'error',error:'boom'}}],skipped:[],failed:[],notices:[]})});
  const r2=await c2.handle({op:'apply'},fakeClock(true),{runUpdater:async()=>({code:0,output:''}),exec:async()=>({code:0})});
  assert.equal(r2.value.applied[0].probe_verdict,'unavailable');assert.equal(r2.value.applied[0].ready,false);assert.equal(r2.value.applied[0].verification,'updated, containment not verified');
  // Positive control: a passing probe is verified and ready.
  const {c:c3}=clockSlice({applyResult:()=>({applied:[{name:'cli:claude',from:'1.0.0',to:'2.0.0',probe:{status:'pass'}}],skipped:[],failed:[],notices:[]})});
  const r3=await c3.handle({op:'apply'},fakeClock(true),{runUpdater:async()=>({code:0,output:''}),exec:async()=>({code:0})});
  assert.equal(r3.value.applied[0].probe_verdict,'pass');assert.equal(r3.value.applied[0].ready,true);assert.match(r3.value.applied[0].verification,/verified/);
});
// events-never-apply (audit finding 7): with auto_update.enabled, setup.open and
// setup.check run the apply path after the check, under the same guard, and record
// the outcome in clockActivity; while disabled nothing is applied and the card says so.
await test('setup.open and setup.check apply updates after the check when enabled, under the shared guard, and record nothing applied when disabled',async()=>{
  const {c,seen}=clockSlice({applyResult:()=>({applied:[{name:'cli:codex',from:'1.0.0',to:'1.1.0',probe:{status:'pass'}}],skipped:[{name:'skill',reason:'needs_protocol_acceptance'}],failed:[],notices:[]})});
  let checks=0;const enabled=fakeClock(true,async()=>{checks++;return {ran:true,skipped_reason:null,results:[{name:'cli:codex',outcome:'changed'}]};});
  const opened=await c.trigger(enabled,'setup.open');
  assert.equal(checks,1);assert.equal(seen.applyDeps.length,1,'setup.open must apply after its check');assert.equal(seen.runningDuringApply[0],true,'apply runs inside the guarded activity');
  assert.equal(opened.ran,true);assert.equal(opened.apply.applied.length,1);assert.equal(typeof seen.applyDeps[0].postUpdateProbe,'function','the event path uses the same probe wiring');
  assert.deepEqual({event:c.activity.last_apply.event,enabled:c.activity.last_apply.enabled,applied:c.activity.last_apply.applied,skipped:c.activity.last_apply.skipped,failed:c.activity.last_apply.failed},{event:'setup.open',enabled:true,applied:1,skipped:1,failed:0});
  assert.equal(c.activity.last_apply.rows[0].probe_verdict,'pass');assert.equal(c.activity.running,false);
  const checked=await c.handle({op:'trigger',event:'setup.check'},enabled,{});
  assert.equal(checked.status,200);assert.equal(checks,2);assert.equal(seen.applyDeps.length,2,'setup.check from the page applies too');
  assert.equal(checked.value.result.apply.applied.length,1);assert.equal(checked.value.activity.last_apply.event,'setup.check');
  const disabled=fakeClock(false,async()=>{checks++;return {ran:true,skipped_reason:null,results:[]};});
  const off=await c.trigger(disabled,'setup.open');
  assert.equal(checks,3,'the check still runs while disabled');assert.equal(seen.applyDeps.length,2,'nothing is applied while disabled');
  assert.equal(off.apply.applied.length,0);assert.equal(off.apply.skipped_reason,'auto_update_disabled');
  assert.equal(c.activity.last_apply.enabled,false);assert.equal(c.activity.last_apply.applied,0);assert.match(c.activity.last_apply.note,/off/i);
  // A failed check never reaches apply.
  const broken=fakeClock(true,async()=>{throw new Error('registry down');});
  assert.equal(await c.trigger(broken,'setup.check'),null);assert.equal(seen.applyDeps.length,2);assert.equal(c.activity.last_error,'registry down');
});
// guidance-body-limit-unenforced: saveGuidance answers 413 for a file over the cap,
// and the route hands that status to the page untouched.
await test('the guidance route passes a 413 from saveGuidance through untouched',async()=>{
  const h=handler({expected_sha256:null,guidance:{}},true,{saveGuidance:()=>({status:413,value:{error:'The guidance file would be 80774 bytes; the cap is 65536.'}})});
  const r=await h.serve({method:'POST',url:'/api/guidance',socket:{}},{});
  assert.equal(r.status,413);assert.match(r.value.error,/cap is 65536/);
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
  const pointerEvents=[];const pointer={write(url){pointerEvents.push(`write ${url}`);return true;},remove(){pointerEvents.push('remove');return true;}};
  {const handlers={};const server={on(name,fn){handlers[name]=fn;},listen(_p,_h,cb){cb();},address:()=>({port:4321})};
    const c=vm.createContext({process:{stdout:{write(){}},stderr:{write(){}},exitCode:0},openBrowser(){},triggerClock:()=>Promise.resolve(null),safeDetail:s=>String(s),Promise});
    vm.runInContext(source.slice(a,b)+';this.start=startSetupCenter;',c);
    c.start({server,watcher:fakeWatcher(),clock:{},port:0,browser:false,pointer});
    assert.deepEqual(pointerEvents,['write http://127.0.0.1:4321/'],'setup-center.json is written with the bound URL once listening');
    handlers.close();assert.deepEqual(pointerEvents,['write http://127.0.0.1:4321/','remove'],'and removed when the server closes');}
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
// Drains host microtasks so promise chains inside the vm context settle.
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
// Controllable timers: every setTimeout/setInterval is queued; tick() fires
// what is due (intervals stay armed) and then drains microtasks.
function fakeTimers(){
  const queue=[];let id=0;
  const add=(fn,ms,repeat)=>{const t={id:++id,fn,ms,repeat,cleared:false};queue.push(t);return t;};
  return {setTimeout:(fn,ms)=>add(fn,ms,false),setInterval:(fn,ms)=>add(fn,ms,true),clearTimeout:t=>{if(t&&typeof t==='object')t.cleared=true;},clearInterval:t=>{if(t&&typeof t==='object')t.cleared=true;},
    pending:()=>queue.filter(t=>!t.cleared),flush,
    async tick(){for(const t of queue.filter(t=>!t.cleared)){if(!t.repeat)t.cleared=true;t.fn();}await flush();}};
}
// An api() double whose every call is a held promise the test settles by hand.
function deferredApi(){
  const calls=[];
  const stub=(path,options={})=>{const call={path,method:options.method||'GET',body:options.body?JSON.parse(options.body):null,settled:false};call.promise=new Promise((res,rej)=>{call.resolve=v=>{call.settled=true;res(v);};call.reject=e=>{call.settled=true;rej(e);};});calls.push(call);return call.promise;};
  return {stub,calls,find:(pattern,method)=>calls.filter(c=>c.path.includes(pattern)&&(!method||c.method===method))};
}
function ui(extra={}) {
  // Minimal DOM double: every selector resolves to a node that accepts the
  // properties and listeners the page touches (theme toggle included), and
  // records its listeners so a test can drive the same handler the page wires.
  // Timers are inert by default so a declined update's background poll cannot
  // outlive the test; pass fakeTimers() in `extra` to drive them.
  const nodes=new Map();
  const node=()=>({value:'codex',textContent:'',innerHTML:'',title:'',hidden:false,disabled:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},querySelector:()=>null,querySelectorAll:()=>[]});
  const document={body:node(),querySelector:s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);}};
  const inert=()=>({unref(){}});
  const context=vm.createContext({document,Map,Number,console,setTimeout:inert,clearTimeout(){},setInterval:inert,clearInterval(){},localStorage:{getItem:()=>null,setItem(){}},window:{confirm:()=>false},fetch:()=>{throw Error('Unexpected network');},...extra});
  // Everything but the boot IIFE: the listener registrations stay in, so the
  // governor and Close handlers are reachable through node(...).listeners.
  const end=client.lastIndexOf('(async () => {');assert(end>0);
  const optional=name=>`${name}:typeof ${name}==='function'?${name}:null`;
  vm.runInContext(client.slice(0,end)+`\nthis.core={api,cliRow,miniStatus,launchAction,routeCopy,modelFact,renderMaintenance,loadMaintenance,render,providerCard,routeState,renderUsage,renderUpdateClock,renderGuidance,renderGuidancePreview,draftGuidance,routeTotal,selectedBatch,refresh,runTest,runQuickSetup,saveGuidanceDraft,${['toggleBatch','changeGovernor','closeSetupCenter','renderCapabilities','renderPlan','probeRoute','runPlan','pipelinesText','loadCapabilities'].map(optional).join(',')}};this.init=(s,m)=>{session=s;maintenance=m};this.setSession=s=>session=s;this.fail=(a,r)=>liveResults.set(a,{status:'failed',result:r});this.pass=a=>liveResults.set(a,{status:'success'});this.getLive=()=>new Map(liveResults);this.setReport=r=>report=r;this.getReport=()=>report;this.setApi=f=>api=f;this.getMaintenance=()=>maintenance;this.setUsage=u=>usage=u;this.setClock=c=>clockState=c;this.setGuidance=g=>guidance=g;this.getGuidance=()=>guidance;this.setCapabilities=c=>capabilities=c;this.node=s=>document.querySelector(s);showToast=()=>{};`,context);
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
// The card shows the last event's apply outcome — applied / skipped / failed —
// with each updated CLI's re-read version and probe verdict; a failed or
// unavailable probe reads "updated, containment not verified", never ready. It
// also discloses the synthetic probe traffic that enabling the switch causes.
await test('automatic updates card shows the last apply outcome per CLI, never presents an unverified route as ready, and discloses the probe traffic',()=>{
  const c=ui();c.init({platform:'win32',providers:{codex:{label:'Codex'},grok:{label:'Grok'},claude:{label:'Claude Code'}}},null);
  const base={auto_update:{enabled:true,skill:true,clis:true,models:true,accept_protocol:false},clock:{},sources:[],overhead_estimate_per_day:6,timer:{platform:'win32',install:'x',remove:'y'}};
  c.setClock({...base,activity:{running:false,last_event:'setup.open',last_finished_at:'2026-09-13T10:00:00.000Z',last_apply:{at:'2026-09-13T10:00:01.000Z',event:'setup.open',enabled:true,applied:2,skipped:1,failed:1,skipped_reason:null,
    rows:[{name:'cli:codex',cli:'codex',from:'1.0.0',to:'1.1.0',version:'1.1.0',probe_verdict:'fail',ready:false,verification:'updated, containment not verified'},{name:'cli:claude',cli:'claude',from:'1.0.0',to:'2.0.0',version:'2.0.0',probe_verdict:'pass',ready:true,verification:'verified: 2.0.0 passed the containment probe'}],
    failures:[{name:'cli:grok',reason:'exit 1'}],note:null}}});
  c.core.renderUpdateClock();const html=c.node('#update-clock-card').innerHTML;
  assert.match(html,/applied 2 \/ skipped 1 \/ failed 1/,'the last event outcome is counted on the card');assert.match(html,/setup\.open/);
  assert.match(html,/Codex CLI[^<]*<\/[^>]+>[^]*?1\.0\.0 → 1\.1\.0/,'the re-read version is shown for the applied CLI');
  assert.match(html,/updated, containment not verified/);assert.match(html,/probe fail/i);
  const codexRow=html.slice(html.indexOf('cli:codex'),html.indexOf('cli:claude'));assert(!/\bready\b/i.test(codexRow),'a failed probe must not be presented as ready: '+codexRow);
  const claudeRow=html.slice(html.indexOf('cli:claude'));assert.match(claudeRow,/probe pass/i);assert.match(claudeRow,/ready/i,'positive control: a passing probe reads as ready');
  assert.match(html,/Grok CLI[^]*?exit 1/,'a failed update is listed with its reason');
  assert.match(html,/one synthetic sentence and one synthetic 20-line diff per updated CLI to that CLI's provider/,'the probe traffic is disclosed on the card');
  c.setClock({...base,auto_update:{...base.auto_update,enabled:false},activity:{running:false,last_event:'setup.check',last_finished_at:'2026-09-13T10:00:00.000Z',last_apply:{at:'2026-09-13T10:00:01.000Z',event:'setup.check',enabled:false,applied:0,skipped:0,failed:0,skipped_reason:'auto_update_disabled',rows:[],failures:[],note:'automatic updates are off: checked only, nothing applied'}}});
  c.core.renderUpdateClock();const off=c.node('#update-clock-card').innerHTML;
  assert.match(off,/automatic updates are off: checked only, nothing applied/,'while disabled the card says nothing was applied');assert(!/applied 0 \/ skipped 0/.test(off),'no misleading zero tally while disabled');
  c.setClock({...base,activity:{running:false}});c.core.renderUpdateClock();
  assert.match(c.node('#update-clock-card').innerHTML,/No update has been applied from this Setup Center yet/,'no event yet reads as such, not as a zero tally');
});
// effective-prompt-preview-overclaims: the preview is built with a contract stub
// and no persona, so the page and API call it a guidance preview and say what is missing.
await test('the guidance preview is labelled as such and notes that the built-in contract and persona are not rendered',()=>{
  const html=fs.readFileSync(new URL('../assets/setup-ui/index.html',import.meta.url),'utf8');
  assert(!/Effective prompt preview/i.test(html),'the old label overclaims');assert.match(html,/Guidance preview/);assert.match(html,/id="guidance-preview-note"/);
  assert.match(html,/shows the resolved guidance layers in position; the built-in contract and persona text are not rendered here/);
  const c=ui();c.init({platform:'win32',providers:{codex:{label:'Codex'}}},null);
  c.setGuidance({routes:['codex'],guidance_preview:{codex:'[guidance preview stub]\nGUIDANCE FOR codex'},guidance_preview_note:'shows the resolved guidance layers in position; the built-in contract and persona text are not rendered here',effective:{},resolve_error:null});
  c.core.renderGuidancePreview();
  assert.equal(c.node('#guidance-preview').textContent,'[guidance preview stub]\nGUIDANCE FOR codex','the page reads the renamed API field');
  assert.match(c.node('#guidance-preview-note').textContent,/built-in contract and persona text are not rendered here/);
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
// --- 1.16.0 gate findings (runs rev_20260913144450_tkrr) -------------------------------
// expired-verification-resurrected: once readiness falls, the cached success is
// gone for good; the session that returns must be verified again.
await test('an expired session drops the cached verification; a returning session reads Session found, not Verified',async()=>{
  const c=ui();c.init({platform:'win32',providers:{codex:{label:'Codex',docs:'x'}}},null);
  const status=ready=>({routes:[{agent:'codex',role:'reviewer',installed:true,ready}]});
  c.setApi(async()=>status(true));await c.core.refresh();c.pass('codex');
  assert.equal(c.core.routeState(c.getReport().routes[0]),'ready','control: a fresh success on a ready route is Verified');
  c.setApi(async()=>status(false));await c.core.refresh();assert.equal(c.core.routeState(c.getReport().routes[0]),'login');
  c.setApi(async()=>status(true));await c.core.refresh();
  assert.equal(c.core.routeState(c.getReport().routes[0]),'detected','the old session\'s verification must not resurrect as Verified');
});
// governor-transition-retains-old-work: the previous governor's in-flight
// status poll and verification job are discarded; the new governor gets its
// own status request.
await test('changing governor discards in-flight status polls and verification jobs from the previous governor',async()=>{
  const timers=fakeTimers();const c=ui({...timers});
  c.init({platform:'win32',providers:{codex:{label:'Codex',docs:'x'},claude:{label:'Claude',docs:'x'},grok:{label:'Grok',docs:'x'}}},null);
  const d=deferredApi();c.setApi(d.stub);
  const governor=c.node('#governor');governor.value='codex';
  c.core.refresh();c.core.runTest('grok');await flush();
  assert.equal(d.find('/api/status').length,1);assert.equal(d.find('/api/test','POST').length,1);
  governor.value='claude';governor.listeners.change();await flush();
  d.find('/api/status')[0].resolve({routes:[{agent:'claude',role:'reviewer',installed:true,ready:true},{agent:'codex',role:'governor'}]});
  d.find('/api/test','POST')[0].resolve({id:'job-a'});await flush();await timers.tick();
  for(const call of d.find('/api/job/job-a'))call.resolve({status:'success',result:{route_status:'success'}});await flush();
  const forB=d.find('/api/status').filter(call=>call.path.includes('governor=claude'));
  assert.equal(forB.length,1,'a status request for the new governor must be issued: '+d.calls.map(x=>x.path).join(', '));
  assert.notEqual(c.getReport()?.routes?.[0]?.agent,'claude','the old governor\'s late routes must not become the report');
  assert.equal(c.getLive().has('grok'),false,'the old governor\'s verification must not repopulate live results');
  forB[0].resolve({routes:[{agent:'codex',role:'reviewer',installed:true,ready:true},{agent:'claude',role:'governor'}]});await flush();
  assert.equal(c.getReport().routes[1].agent,'claude','control: the new governor\'s answer is applied');
});
// quick-setup-duplicates-running-tests: one verification per provider at a time.
await test('Quick Setup and repeated clicks never start a second verification for a provider already being verified',async()=>{
  const timers=fakeTimers();const c=ui({...timers});
  c.init({platform:'win32',providers:{codex:{label:'Codex',docs:'x'},grok:{label:'Grok',docs:'x'}}},null);
  const d=deferredApi();c.setApi(d.stub);
  c.core.runTest('codex');c.core.runTest('codex');await flush();
  const posts=()=>d.find('/api/test','POST').map(t=>t.body.provider);
  same(posts(),['codex'],'a second manual click must reuse the running job');
  c.core.runQuickSetup();await flush();
  d.find('/api/status')[0].resolve({routes:[{agent:'codex',installed:true,ready:true},{agent:'grok',installed:true,ready:true}]});await flush();
  d.find('/api/maintenance','POST')[0].reject(new Error('offline'));await flush();
  same(posts(),['codex','grok'],'Quick Setup skips the provider whose check is still running');
});
// late-poll-error-overwrites-success / run-test-unbounded-async-interval: polls
// are sequential (never overlapping) and stop for good once the job settles.
await test('verification polls never overlap, and a settled job is never touched by a later poll',async()=>{
  const timers=fakeTimers();const c=ui({...timers});
  c.init({platform:'win32',providers:{codex:{label:'Codex',docs:'x'}}},null);c.setReport({routes:[{agent:'codex',installed:true,ready:true}]});
  const d=deferredApi();c.setApi(d.stub);
  const run=c.core.runTest('codex');await flush();
  d.find('/api/test','POST')[0].resolve({id:'j1'});await flush();
  await timers.tick();await timers.tick();await timers.tick();
  assert.equal(d.find('/api/job/j1').length,1,'no poll may be issued while the previous one is unanswered');
  d.find('/api/job/j1')[0].resolve({status:'success',result:{route_status:'success'}});await flush();
  assert.equal((await run).status,'success');
  await timers.tick();await timers.tick();
  assert.equal(d.find('/api/job/j1').length,1,'no poll after the job settled');
  assert.equal(c.getLive().get('codex').status,'success','a settled success is never overwritten');
  assert.equal(c.core.routeState({agent:'codex',installed:true,ready:true}),'ready');
});
await test('a verification that never settles ends in a visible timeout state instead of polling forever',async()=>{
  let now=1_000_000;class FakeDate extends Date{static now(){return now;}}
  const timers=fakeTimers();const c=ui({...timers,Date:FakeDate});
  c.init({platform:'win32',providers:{codex:{label:'Codex',docs:'x'}}},null);c.setReport({routes:[{agent:'codex',installed:true,ready:true}]});
  const d=deferredApi();c.setApi(d.stub);
  const run=c.core.runTest('codex');await flush();
  d.find('/api/test','POST')[0].resolve({id:'j2'});await flush();
  for(let i=0;i<400&&c.getLive().get('codex').status==='running';i++){await timers.tick();for(const call of d.find('/api/job/j2').filter(x=>!x.settled))call.resolve({status:'running'});now+=1800;await flush();}
  const live=c.getLive().get('codex');
  assert.equal(live.status,'failed','after 12 minutes of "running" the card must show a failure, not spin forever');
  assert.equal(live.result?.route_status,'timeout');
  assert.equal(c.core.routeState({agent:'codex',installed:true,ready:true}),'failed');
  assert.match(c.core.routeCopy({agent:'codex'},'failed'),/time|minute/i);
  assert.equal(timers.pending().length,0,'no timer keeps polling after the timeout');
  assert.equal((await run).status,'failed');
});
// save-response-discards-new-edits: text typed while the POST is in flight
// stays in the editor; the response refreshes sha/trust only.
await test('edits typed while a guidance save is in flight survive the save response',async()=>{
  const c=ui();c.init({platform:'win32',providers:{codex:{label:'Codex'}}},null);
  const editor=c.node('#guidance-editor');let areas=[];
  const unescape=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  Object.defineProperty(editor,'innerHTML',{set(html){areas=[...html.matchAll(/<textarea data-guidance="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)].map(m=>({dataset:{guidance:unescape(m[1])},value:unescape(m[2])}));},get(){return areas.map(a=>`${a.dataset.guidance}=${a.value}`).join('|');}});
  editor.querySelectorAll=sel=>sel==='[data-guidance]'?areas:[];
  const snapshot=governor=>({file:'.momm/guidance.json',user_file:'u',routes:['codex'],project:{governor},project_sha256:'a'.repeat(64),trusted:true,user:null,effective:{},guidance_preview:{},notices:[]});
  c.setGuidance(snapshot('first'));c.core.renderGuidance();
  const area=()=>areas.find(a=>a.dataset.guidance==='governor');
  area().value='first edited';
  const d=deferredApi();c.setApi(d.stub);c.window.confirm=()=>true;
  const saving=c.core.saveGuidanceDraft();await flush();
  assert.equal(d.find('/api/guidance','POST')[0].body.guidance.governor,'first edited');
  area().value='first edited, then more';
  d.find('/api/guidance','POST')[0].resolve(snapshot('first edited'));await saving;
  assert.equal(area().value,'first edited, then more','typing during the save must not be discarded');
  assert.equal(c.getGuidance().project.governor,'first edited','the response still refreshes the loaded state');
  const again=c.core.saveGuidanceDraft();await flush();d.find('/api/guidance','POST')[1].resolve(snapshot('first edited, then more'));await again;
  assert.equal(area().value,'first edited, then more','control: an untouched editor shows the saved text');
});
// maintenance-validation-commits-invalid-state: rows that cannot be rendered are
// refused before the last good state is replaced.
await test('maintenance rows that cannot be rendered are refused before replacing the last good state',async()=>{
  const good={cli_updates:[{agent:'codex',current:'1.0.0',latest:'1.1.0',source:'npm',status:'update_available',installed:true,update_command:'npm i',installation:{kind:'npm'}}],models:[],skills:{versions:[],repository_dirty:false},environment:{},runtime:{node_ready:true,node:'22',git:'2',powershell:'7',platform:'win32'},checked_at:new Date().toISOString()};
  for(const bad of [{cli_updates:[{}],models:[],skills:{versions:[]},environment:{},runtime:{platform:'linux'}},{...good,cli_updates:[{agent:'nobody'}]}]){
    const c=ui();c.init({platform:'win32',providers:{codex:{label:'Codex',docs:'x'}}},good);c.setReport({routes:[{agent:'codex',installed:true,ready:true}]});c.core.renderMaintenance();
    c.setApi(async()=>bad);await c.core.loadMaintenance();
    assert.equal(c.getMaintenance(),good,'an unrenderable payload replaced the last good state: '+JSON.stringify(bad.cli_updates));
    assert.doesNotThrow(()=>{c.core.renderMaintenance();c.core.render();});
    assert.match(c.node('#maintenance-grid').innerHTML,/data-maint-provider="codex"/,'the existing update control still renders from the retained state');
  }
});
// shutdown-failure-reported-as-closed: a failed shutdown keeps the page usable.
await test('a failed shutdown request keeps the page usable instead of announcing the server closed',async()=>{
  const c=ui();c.init({platform:'win32',providers:{}},null);
  c.setApi(async()=>{throw new Error('HTTP 500');});
  c.document.body.innerHTML='<main id="page">live</main>';
  const close=c.node('#close-server').listeners.click;assert.equal(typeof close,'function');
  await assert.doesNotReject(Promise.resolve(close({})),'the click handler must not leave an unhandled rejection');await flush();
  assert.equal(c.document.body.innerHTML,'<main id="page">live</main>','the server is still running; the page must not claim otherwise');
  assert.equal(c.node('#close-server').disabled,false,'the Close control stays available for a retry');
  c.setApi(async()=>({closing:true}));await close({});await flush();
  assert.match(c.document.body.innerHTML,/Setup Center closed/,'control: a successful shutdown shows the closed page');
});
// api-post-null-session-deref: a POST before the session exists rejects with a
// plain error the callers already handle, not a TypeError from inside api().
await test('a POST before the session is ready rejects with a plain error, never a TypeError, and never reaches fetch',async()=>{
  const c=ui();let fetched=0;c.fetch=()=>{fetched++;throw new Error('Unexpected network');};c.setSession(null);
  await assert.rejects(c.core.api('/api/shutdown',{method:'POST',body:'{}'}),e=>e.constructor.name!=='TypeError'&&/session/i.test(e.message));
  assert.equal(fetched,0,'nothing may be sent without the session token');
  c.setSession({token:'t'});await assert.rejects(c.core.api('/api/shutdown',{method:'POST',body:'{}'}),/Unexpected network/);assert.equal(fetched,1,'control: with a session the request reaches fetch');
});
// dark-theme-white-contrast / toast-ink-contrast / guidance-user-not-grid: the
// toast and the light primary button take their pair from tokens that both
// palettes define with WCAG AA contrast; .guidance-user is a grid on its own.
const css=fs.readFileSync(new URL('../assets/setup-ui/styles.css',import.meta.url),'utf8');
const theme=fs.readFileSync(new URL('../assets/setup-ui/momm-theme.css',import.meta.url),'utf8');
function luminance(hex){const m=/^#([0-9a-f]{6})$/i.exec(hex.trim());assert(m,`not a 6-digit hex colour: ${hex}`);const [r,g,b]=[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);return 0.2126*r+0.7152*g+0.0722*b;}
function contrast(a,b){const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (hi+0.05)/(lo+0.05);}
function block(selector,source=css){const i=source.indexOf(selector);assert(i>=0,`missing rule ${selector}`);const open=source.indexOf('{',i),close=source.indexOf('}',open);return source.slice(open+1,close);}
function token(body,name){const m=new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body);assert(m,`token ${name} not declared in this palette`);return m[1].trim();}
await test('WCAG helper sanity',()=>{assert(Math.abs(contrast('#ffffff','#000000')-21)<0.01);assert(contrast('#ffffff','#e6ffe6')<1.1,'the reported white-on-dark-ink toast really was unreadable');assert(contrast('#00c27a','#ffffff')<3,'the reported dark --green on a white button really failed AA');});
for(const [palette,selector] of [['light',':root {'],['dark toggle',':root[data-theme="dark"]'],['dark system',':root:not([data-theme="light"])']]){
  await test(`${palette} palette declares toast and light-button pairs with contrast >= 4.5:1`,()=>{
    const body=block(selector,theme);
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
// single-source-tokens: the theme declares every shared token in all three palettes and styles.css declares none of them;
// both pages read the same chip and table rules from the theme.
await test('momm-theme.css is the single source of tokens; styles.css keeps layout only',()=>{
  const tokens=['--ink','--muted','--paper','--card','--line','--green','--green-bright','--mint','--amber','--amber-soft','--red','--red-soft','--shadow','--glass','--pill','--hairline','--toast-bg','--toast-ink','--light-button-bg','--light-button-ink','--on-green'];
  for(const selector of [':root {',':root[data-theme="dark"]',':root:not([data-theme="light"])']){const body=block(selector,theme);for(const name of tokens)token(body,name);}
  for(const name of [...tokens,'--font-display','--font-sans','--font-mono','--ease','--dur','--dur-fast'])assert(!new RegExp(`${name}\\s*:`).test(css),`${name} must not be redefined in styles.css`);
  assert(!/^:root\s*\{/m.test(css),'styles.css has no :root palette block');
  for(const rule of ['.theme-toggle {','.orbit {','.momm-topbar {','.momm-brand-mark {','.momm-nav a,','.chip {','.chip-good,','.chip-bad,','.momm-table {','@keyframes rise','@keyframes toast-in','html.theme-switching'])assert(theme.includes(rule),`theme carries ${rule}`);
  for(const rule of ['@keyframes rise','.theme-toggle {','.orbit {','.chip {','.momm-table {'])assert(!css.includes(rule),`styles.css no longer carries ${rule}`);
});
await test('the dashboard emits the shared chip classes and tables compose .momm-table',()=>{
  const c=ui();const names=['codex','claude','gemini','antigravity','copilot','grok'];
  c.init({platform:'win32',providers:Object.fromEntries(names.map(n=>[n,{label:n,docs:'https://example.invalid'}]))},{cli_updates:[{agent:'grok',current:'1.0.0',latest:'1.1.0',status:'update_available',update_command:'grok update'}],models:[]});
  const detected=c.core.providerCard({agent:'codex',installed:true,ready:true,version:'1.0.0'}),missing=c.core.providerCard({agent:'grok',installed:false,ready:false});
  assert.match(detected,/class="chip status chip-warn"/,'a detected-but-unverified route is an amber chip');assert.match(missing,/class="chip status chip-warn"/);
  c.pass('codex');assert.match(c.core.providerCard({agent:'codex',installed:true,ready:true,version:'1.0.0'}),/class="chip status chip-good"/,'a verified route is a green chip');
  c.fail('codex',{route_status:'error'});assert.match(c.core.providerCard({agent:'codex',installed:true,ready:true,version:'1.0.0'}),/class="chip status chip-bad"/);
  for(const html of [detected,missing])assert(!/class="status (ready|login|install|failed)"/.test(html),'no legacy colour classes remain');
  assert.match(c.core.miniStatus('current'),/^<span class="chip chip-good mini-status">/);assert.match(c.core.miniStatus('missing'),/chip chip-bad/);assert.match(c.core.miniStatus('unknown'),/chip chip-neutral/);
  assert.equal((client.match(/<table class="momm-table cli-table/g)||[]).length,4,'every dashboard table composes the shared table rules (CLI versions, update clock, usage, modalities)');
});
// --- Modalities panel (1.16 E7) ---------------------------------------------------------------
// Routes: GET needs the session token and serves the snapshot; POST hands the handler's
// status through, so a generation probe without consent is the 409 the handler returns.
await test('the capabilities routes need the session token and pass the handler status through',async()=>{
  const denied=await handler({},false).serve({method:'GET',url:'/api/capabilities',socket:{}},{});assert.equal(denied.status,403);
  const served=await handler({}).serve({method:'GET',url:'/api/capabilities',socket:{}},{});assert.equal(served.status,200);assert.deepEqual(Object.keys(served.value.routes),['codex']);
  const refused=await handler({op:'probe',cli:'codex',generate:true}).serve({method:'POST',url:'/api/capabilities',socket:{}},{});assert.equal(refused.status,409,'probe generation without consent is refused at the handler and the route keeps the 409');
  const planned=await handler({op:'plan',need:{input:['text'],output:['image']}}).serve({method:'POST',url:'/api/capabilities',socket:{}},{});assert.equal(planned.status,200);assert.equal(planned.value.op,'plan');
  const gone=await handler({},true,{capabilitiesSnapshot:async()=>({status:503,value:{error:'registry unavailable'}})}).serve({method:'GET',url:'/api/capabilities',socket:{}},{});assert.equal(gone.status,503,'no registry degrades to 503, never a crash');
  const noToken=await handler({op:'plan',need:{}},false).serve({method:'POST',url:'/api/capabilities',socket:{}},{});assert.equal(noToken.status,403);
});
// The production handler with a fake registry module: consent gate, exact disclosure echo,
// blocked generative cells skipped without a request, input probes through the injected exec,
// plan passed through, busy guard.
import {runModalityProbes,generativeCells,routeDisclosure,latestModalityProbes} from './probes.mjs';
function capabilitiesSlice({matrix,planResult={possible:true,steps:[],routes_used:['codex'],blocked_by:[]},maxJobs=12,cliVersion=async()=>'9.9.9'}={}) {
  const a=source.indexOf('// --- Modalities panel (1.16 E7)'),b=source.indexOf('// --- Ledger auto-regeneration',a);assert(a>=0&&b>a);
  const written=[];
  const module={effective:({installedVersions})=>JSON.parse(JSON.stringify({...matrix,installed:installedVersions})),clearingAction:(blocker,route)=>`clear ${blocker} on ${route}`,levelAction:()=>null,writeOverlayEntry:(home,entry)=>{written.push({home,entry});},routable:c=>!!c&&['verified','documented'].includes(c.level)&&!c.blocker};
  const registry={module,plan:(m,need,extra)=>({...planResult,need,...extra}),error:null};
  const c=vm.createContext({providers:Object.fromEntries(['codex','claude','gemini','antigravity','copilot','grok'].map(a=>[a,{label:a,modalities:a==='grok'?['text']:['text','image','pdf']}])),jobs:new Map(),maxJobs,crypto,safeDetail:s=>String(s),os,process,Promise,Date,JSON,Object,Array,String,Number,Boolean,Set,Map,parseVersion:s=>String(s||'').match(/\d+\.\d+\.\d+/)?.[0]||null,cliVersion,probeExec:async()=>{throw new Error('the server exec must not be used when a test exec is injected');},recordProbe:()=>{},runModalityProbes,generativeCells,routeDisclosure,latestModalityProbes:()=>({})});
  vm.runInContext(source.slice(a,b)+';capabilitiesRegistry=this.registry;this.snapshot=capabilitiesSnapshot;this.handle=handleCapabilities;this.jobs=jobs;',Object.assign(c,{registry}));
  return {c,written,registry};
}
import crypto from 'node:crypto';
const capMatrix={schema:'momm-capabilities-effective/1',machine_id:'m',captured_at:'2026-09-13',overlay:{applied:1,reprobe:0,invalidated:[],stale:[]},routes:{
  codex:{installed_version:'9.9.9',input:{text:{level:'verified'},image:{level:'verified',how:'-i {file}',evidence:{help_capture:'references/cli/help/codex-exec.txt:37'}},pdf:{level:'no'}},output:{image_gen:{level:'documented',how:'image_gen tool',harvest:'~/.codex/generated_images/**/*.png',mime:'image/png'}}},
  claude:{installed_version:null,input:{text:{level:'verified'},image:{level:'documented'},pdf:{level:'documented'}},output:{image_gen:{level:'no'}}},
  gemini:{input:{text:{level:'verified'},image:{level:'documented',blocker:'auth_tier',source:'overlay',reason:'IneligibleTierError',overlay:{at:'2026-09-13T00:00:00.000Z',expires_at:'2026-09-20T00:00:00.000Z'}}},output:{}},
  antigravity:{input:{text:{level:'verified'},image:{level:'documented',requires:['--new-project']}},output:{image_gen:{level:'documented',harvest:'~/.gemini/antigravity-cli/brain/**/*.jpg',mime:'image/jpeg'},code_exec:{level:'documented',blocker:'allowlist'}}},
  copilot:{input:{text:{level:'verified'},image:{level:'verified',blocker:'reprobe',source:'overlay',reason:'quota recorded 2026-09-01 is expired; probe before routing'}},output:{}},
  grok:{input:{text:{level:'verified'},image:{level:'documented'},speech:{level:'model-only'}},output:{image_gen:{level:'documented',harvest:'~/.grok/sessions/**/images/*.jpg',mime:'image/jpeg'},video_gen:{level:'documented',blocker:'zdr',source:'overlay',harvest:'~/.grok/sessions/**/*.mp4',mime:'video/mp4'}}}}};
// syntheticPng (probes.mjs) writes a stored (uncompressed) IDAT: 8-byte signature, IHDR chunk
// (25 bytes), IDAT header (8 bytes), zlib header (2 bytes), stored-block header (5 bytes) and
// the first scanline's filter byte at offset 48, so bytes 49-51 are the first pixel's RGB.
const colourOf=file=>{const b=fs.readFileSync(file);const [r,g,bl]=[b[49],b[50],b[51]];return r>200&&g>200?'yellow':r>200?'red':g>150?'green':bl>150?'blue':'unknown';};
// Waits for a job to leave "running"; a job still running after five seconds is a failure in its own right.
const settle=async job=>{for(let i=0;i<500&&job.status==='running';i++)await new Promise(r=>setTimeout(r,10));if(job.status==='running')throw new Error(`job ${job.id} for ${job.provider} still running after 5 s`);return job;};
await test('the capabilities snapshot carries blockers with clearing actions, per-route disclosures and derived pipelines',async()=>{
  const {c}=capabilitiesSlice({matrix:capMatrix});
  const snap=await c.snapshot({home:os.tmpdir(),installedVersions:{codex:'9.9.9'}});
  assert.equal(snap.status,200);const v=snap.value;
  assert.equal(v.routes.gemini.input.image.blocker,'auth_tier');
  same(v.blockers.map(b=>`${b.route}.${b.direction}.${b.modality}=${b.blocker}`),['gemini.input.image=auth_tier','antigravity.output.code_exec=allowlist','copilot.input.image=reprobe','grok.output.video_gen=zdr']);
  assert.equal(v.blockers.find(b=>b.blocker==='reprobe').clearing_action,'clear reprobe on copilot');assert.equal(v.blockers.find(b=>b.blocker==='auth_tier').expires_at,'2026-09-20T00:00:00.000Z');
  assert.equal(v.generation.grok.open,1);assert.equal(v.generation.grok.cells.find(x=>x.cell==='video_gen').blocked,true);assert.equal(v.generation.grok.cells.find(x=>x.cell==='video_gen').clearing_action,'clear zdr on grok');
  assert.match(v.generation.grok.disclosure,/image_gen/);assert(!v.generation.grok.disclosure.includes('video_gen'),'a blocked cell is not in the disclosure');assert.match(v.generation.codex.disclosure,/quota is spent/);assert.equal(v.generation.claude.disclosure,null);
  same(v.pipelines.image_critique.routes,['codex','claude','antigravity'],'grok binds no media on the card, gemini and copilot are blocked');
  same(v.pipelines.image_critique.blocked,[{route:'gemini',blocker:'auth_tier'},{route:'copilot',blocker:'reprobe'}]);
  same(v.pipelines.image_generation.routes,['codex','antigravity','grok']);same(v.pipelines.video_generation.routes,[]);same(v.pipelines.video_generation.blocked,[{route:'grok',blocker:'zdr'}]);
  assert(!JSON.stringify(v).includes('all five'));
});
await test('probe generation needs consent and the exact disclosure, skips blocked cells without a request, and input probes run through the injected exec',async()=>{
  const {c,written}=capabilitiesSlice({matrix:capMatrix});
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'momm-cap-home-'));
  const calls=[];
  const exec=async(command,args,options)=>{calls.push(args);if(args[0]==='--version')return {code:0,stdout:'9.9.9',stderr:''};const blob=[...args,options.input].filter(v=>typeof v==='string').join('\n');const png=/This is a capability probe/.test(blob)?blob.match(/(\S*probe\.png)\b/)?.[1]:null;if(png)return {code:0,stdout:JSON.stringify({text:colourOf(png)}),stderr:''};if(/capability probe/.test(blob))return {code:0,stdout:JSON.stringify({text:'a page'}),stderr:''};const dir=path.join(home,'.grok','sessions','s','images');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'1.jpg'),'jpg');return {code:0,stdout:JSON.stringify({text:'written'}),stderr:''};};
  const deps={home,installedVersions:{grok:'9.9.9'},exec};
  try{
    const snap=await c.snapshot(deps);const disclosure=snap.value.generation.grok.disclosure;
    const noConsent=await c.handle({op:'probe',cli:'grok',generate:true},deps);assert.equal(noConsent.status,409);assert.equal(noConsent.value.disclosure,disclosure);assert.match(noConsent.value.error,/consent/i);
    assert.equal((await c.handle({op:'probe',cli:'grok',generate:true,consent:true,disclosure:'other text'},deps)).status,409,'a stale disclosure is refused');
    assert.equal((await c.handle({op:'probe',cli:'grok',generate:true,consent:'yes',disclosure},deps)).status,409,'consent must be the literal true');
    assert.equal((await c.handle({op:'probe',cli:'claude',generate:true,consent:true,disclosure:''},deps)).status,409,'no generative cell: nothing to consent to');
    assert.equal((await c.handle({op:'probe',cli:'grok'},deps)).status,400);assert.equal((await c.handle({op:'probe',cli:'zork',inputs:true},deps)).status,400);assert.equal((await c.handle({op:'zap'},deps)).status,400);
    assert.equal(calls.length,0,'no request leaves the machine on a refusal');
    const job=await c.handle({op:'probe',cli:'grok',generate:true,consent:true,disclosure},deps);
    assert.equal(job.status,202);assert.equal((await c.handle({op:'probe',cli:'grok',inputs:true},deps)).status,409,'one probe per route at a time');
    await settle(job.value);
    assert.equal(job.value.status,'success',JSON.stringify(job.value.result));
    same(job.value.disclosed.filter(t=>!/skipped/.test(t)),[disclosure],'the exact disclosure is what was shown before sending');assert(job.value.disclosed.some(t=>/skipped, blocker zdr/.test(t)));
    const video=job.value.result.cells.find(x=>x.modality==='video_gen');assert.equal(video.status,'skipped');assert.equal(video.blocker,'zdr');assert.equal(video.clearing_action,'clear zdr on grok');
    const sent=calls.filter(a=>a[0]!=='--version');assert.equal(sent.length,1,'exactly one generation request');assert(sent[0].join(' ').includes('image_gen tool'));assert(!sent.some(a=>a.join(' ').includes('image_to_video')));
    assert.equal(job.value.result.cells.find(x=>x.modality==='image').status,'skipped','inputs were not requested by the generation button');
    assert.equal(written.length,1);assert.equal(written[0].entry.route,'grok');assert.equal(written[0].entry.modality,'image_gen');assert.equal(written[0].entry.level,'verified');
    calls.length=0;
    const inputs=await c.handle({op:'probe',cli:'grok',inputs:true},deps);assert.equal(inputs.status,202);await settle(inputs.value);
    const image=inputs.value.result.cells.find(x=>x.modality==='image');assert.equal(image.status,'verified',image.reason);assert.equal(calls.filter(a=>a[0]!=='--version').length,1,'image only: grok pdf is absent in this fixture');
    assert.equal(inputs.value.result.cells.find(x=>x.modality==='image_gen').status,'skipped');assert.match(inputs.value.result.cells.find(x=>x.modality==='image_gen').reason,/consent_required/);
    const planned=await c.handle({op:'plan',need:{input:['text'],output:['image']}},deps);assert.equal(planned.status,200);assert.equal(planned.value.plan.possible,true);same(planned.value.plan.need,{input:['text'],output:['image']});
    assert.equal((await c.handle({op:'plan'},deps)).status,400);assert.equal((await c.handle({op:'plan',need:[]},deps)).status,400);
    const gone={module:null,plan:null,error:'gone'};assert.equal((await c.snapshot({registry:gone})).status,503);assert.equal((await c.handle({op:'plan',need:{}},{registry:gone})).status,503);
  } finally {fs.rmSync(home,{recursive:true,force:true});}
});
// The page: chips at the four levels with the invocation in the title, blocker badges
// (reprobe included) carrying the clearing action, per-route probe buttons, the generation
// confirm showing the disclosure, and a planner that renders the chain and its blockers.
const capSnapshot={...capMatrix,levels:['verified','documented','model-only','no'],input_modalities:['image','pdf','audio','video','speech'],output_modalities:['image_gen','video_gen','speech','code_exec','web'],
  blockers:[{route:'gemini',direction:'input',modality:'image',blocker:'auth_tier',reason:'IneligibleTierError',clearing_action:'Use a Standard or Enterprise Code Assist licence'},{route:'copilot',direction:'input',modality:'image',blocker:'reprobe',reason:'expired',clearing_action:'Probe before routing: run node momm/scripts/probes.mjs copilot --modalities'},{route:'grok',direction:'output',modality:'video_gen',blocker:'zdr',clearing_action:'Inside grok run /privacy'},{route:'antigravity',direction:'output',modality:'code_exec',blocker:'allowlist',clearing_action:'Add command(<target>)'}],
  generation:{codex:{open:1,disclosure:'MOMM generative probe, codex / image_gen: one request ... quota is spent ...',cells:[{cell:'image_gen',blocked:false,blocker:null}]},grok:{open:1,disclosure:'MOMM generative probe, grok / image_gen: ... quota is spent ...',cells:[{cell:'image_gen',blocked:false},{cell:'video_gen',blocked:true,blocker:'zdr',clearing_action:'Inside grok run /privacy'}]},claude:{open:0,disclosure:null,cells:[]},gemini:{open:0,disclosure:null,cells:[]},antigravity:{open:1,disclosure:'x',cells:[{cell:'image_gen',blocked:false}]},copilot:{open:0,disclosure:null,cells:[]}},
  pipelines:{image_critique:{routes:['codex','claude','antigravity'],blocked:[{route:'gemini',blocker:'auth_tier'},{route:'copilot',blocker:'reprobe'}]},pdf_critique:{routes:['claude','antigravity'],blocked:[]},audio_critique:{routes:[],blocked:[]},video_critique:{routes:[],blocked:[]},image_generation:{routes:['codex','antigravity','grok'],blocked:[]},video_generation:{routes:[],blocked:[{route:'grok',blocker:'zdr'}]}},
  probes:{running:[],last:{codex:{at:'2026-09-13T10:00:00.000Z',verdict:'pass',summary:{verified:1,failed:0,blocked:0,skipped:4}}}},level_actions:{'model-only':'No headless path','no':'No path found'}};
const capProviders={codex:{label:'Codex'},claude:{label:'Claude Code'},gemini:{label:'Gemini'},antigravity:{label:'Antigravity'},copilot:{label:'GitHub Copilot'},grok:{label:'Grok'}};
await test('the Modalities panel renders level chips, blocker badges with clearing actions, probe buttons and derived pipelines',()=>{
  const c=ui();c.init({platform:'win32',providers:capProviders},null);c.setCapabilities(capSnapshot);
  assert.equal(typeof c.core.renderCapabilities,'function');c.core.renderCapabilities();
  const html=c.node('#capabilities-grid').innerHTML;
  assert.match(html,/<table class="momm-table cli-table cap-table"/);
  for(const level of ['verified','documented','model-only','no'])assert.match(html,new RegExp(`class="chip cap-chip cap-${level}`),`a ${level} chip renders`);
  assert.match(html,/cap-chip cap-verified[^"]*" title="Invocation: -i \{file\}[^"]*Evidence: help capture references\/cli\/help\/codex-exec\.txt:37/,'the invocation and evidence sit in the chip title');
  assert.match(html,/cap-documented cap-probed" title="[^"]*Set by this machine&#39;s probe/,'an overlay cell is marked as probed here');
  assert.match(html,/<span class="cap-blocker cap-blocker-auth_tier" title="IneligibleTierError\nTo clear: Use a Standard or Enterprise Code Assist licence">auth_tier<\/span>/);
  assert.match(html,/cap-blocker cap-blocker-reprobe" title="[^"]*probes\.mjs copilot --modalities">reprobe<\/span>/,'a reprobe badge names the clearing action');
  assert.match(html,/cap-blocker-zdr[^>]*>zdr</);assert.match(html,/cap-blocker-allowlist[^>]*>allowlist</);
  assert.equal((html.match(/data-cap-probe="inputs"/g)||[]).length,6);assert.equal((html.match(/data-cap-probe="generation"/g)||[]).length,6);
  assert.match(html,/data-cap-probe="generation" data-route="claude" disabled title="No generative cell/);
  assert.match(html,/data-cap-probe="generation" data-route="grok"  title="Sends 1 generation request after your consent; skips video_gen \(zdr\)"/);
  assert.match(html,/Last probe [^<]*pass \(1 verified, 0 failed, 0 blocked\)/);assert.match(html,/Not probed on this machine yet/);
  assert.match(c.node('#capabilities-summary').textContent,/6 routes · 4 blockers on this machine/);
  const pipelines=c.node('#capabilities-pipelines').textContent;
  assert.match(pipelines,/Image critique: Codex, Claude Code, Antigravity \(Gemini blocked by auth_tier, GitHub Copilot blocked by reprobe\)/);assert.match(pipelines,/Video generation: none \(Grok blocked by zdr\)/);
  assert(!/all five/i.test(pipelines+html),'no hard-coded claim about which routes critique media');
  assert(!html.includes('undefined')&&!html.includes('null'));
});
await test('Probe generation confirms with the exact disclosure and never posts without it; the planner renders chain and blockers',async()=>{
  const c=ui();c.init({platform:'win32',providers:capProviders},null);c.setCapabilities(capSnapshot);
  const posts=[];c.setApi(async(p,o)=>{posts.push({path:p,body:o?.body?JSON.parse(o.body):null});return {id:'job-x',status:'running'};});
  let shown=null;c.window.confirm=text=>{shown=text;return false;};
  assert.equal(await c.core.probeRoute('grok','generation'),null);
  assert.match(shown,/spends the provider's quota/);assert(shown.includes(capSnapshot.generation.grok.disclosure),'the confirm shows the exact disclosure');assert.match(shown,/Skipped \(blocked, never sent\):\nvideo_gen: blocked by zdr — Inside grok run \/privacy/);
  assert.equal(posts.length,0,'declining sends nothing');
  assert.equal(await c.core.probeRoute('claude','generation'),null);assert.equal(posts.length,0,'nothing to generate: no request');
  c.window.confirm=()=>true;
  c.core.probeRoute('grok','generation');await flush();
  assert.equal(posts.length,1);same(posts[0].body,{op:'probe',cli:'grok',generate:true,consent:true,disclosure:capSnapshot.generation.grok.disclosure});
  c.core.probeRoute('codex','inputs');await flush();
  same(posts[1].body,{op:'probe',cli:'codex',inputs:true},'input probes carry no consent field');
  const plan={schema:'momm-plan/1',possible:false,routes_used:['codex'],chain:[{from:['text'],to:['image_gen']},{from:['image'],to:['video_gen']}],steps:[
    {from:['text'],to:['image_gen'],chosen:'codex',candidates:[{route:'codex',routable:true,level:'documented',blocker:null,how:{'output.image_gen':'image_gen tool'}},{route:'claude',routable:false,level:'no',blocker:null}]},
    {from:['image'],to:['video_gen'],chosen:null,candidates:[{route:'grok',routable:false,level:'documented',blocker:'zdr',clearing_action:'Inside grok run /privacy'}]}],
    blocked_by:[{step:1,route:'grok',level:'documented',blocker:'zdr',clearing_action:'Inside grok run /privacy',reason:'blocked by zdr'}]};
  c.core.renderPlan(plan);const html=c.node('#plan-result').innerHTML;
  assert.match(html,/Not possible on this machine right now/);assert.match(html,/Step 1<\/strong> text → image_gen: <span class="chip chip-good">Codex<\/span> <small>documented · image_gen tool<\/small>/);
  assert.match(html,/Step 2<\/strong> image → video_gen: <span class="chip chip-bad">no route<\/span>/);
  assert.match(html,/<span class="cap-blocker cap-blocker-zdr">zdr<\/span> step 2 · Grok: blocked by zdr — <em>Inside grok run \/privacy<\/em>/);
  c.core.renderPlan({...plan,possible:true,blocked_by:[]});assert.match(c.node('#plan-result').innerHTML,/Possible: Codex\. Nothing was executed/);
  c.node('#plan-in').value='text, Image';c.node('#plan-out').value='video';await c.core.runPlan({preventDefault(){}});
  same(posts.at(-1).body,{op:'plan',need:{input:['text','image'],output:['video']}});
});
// Review rev_20260913213315_o8c2, setup-ui.mjs: active-probe-evicted / modality-job-fifo-evicts-running.
// The job map is bounded, but eviction may only drop FINISHED jobs: a running probe is the
// route's mutex and its poll id. When every job is still running the insert is refused.
await test('job eviction never removes a running modality probe, and a map full of running jobs refuses the new one',async()=>{
  const {c}=capabilitiesSlice({matrix:capMatrix,maxJobs:2});
  let release=null;const held=new Promise(r=>{release=r;});let holding=true,heldCalls=0;
  const exec=async(command,args)=>{if(args[0]==='--version')return {code:0,stdout:'9.9.9',stderr:''};if(holding){heldCalls++;await held;}return {code:0,stdout:JSON.stringify({text:'a page'}),stderr:''};};
  const deps={home:os.tmpdir(),installedVersions:{grok:'9.9.9',codex:'9.9.9',antigravity:'9.9.9',claude:'9.9.9'},exec};
  const waitHeld=async n=>{for(let i=0;i<500&&heldCalls<n;i++)await new Promise(r=>setTimeout(r,10));assert.equal(heldCalls,n,'the held probe reached exec');};
  const grok=await c.handle({op:'probe',cli:'grok',inputs:true},deps);assert.equal(grok.status,202);await waitHeld(1);
  holding=false;
  const first=await c.handle({op:'probe',cli:'codex',inputs:true},deps);assert.equal(first.status,202);await settle(first.value);assert.notEqual(first.value.status,'running');
  assert.equal(c.jobs.size,2);
  const second=await c.handle({op:'probe',cli:'codex',inputs:true},deps);assert.equal(second.status,202,'room is made by dropping the finished job');await settle(second.value);
  assert(c.jobs.has(grok.value.id),'the running grok job stays pollable');assert(!c.jobs.has(first.value.id),'the finished codex job is what was evicted');
  assert.equal(grok.value.status,'running');
  assert.equal((await c.handle({op:'probe',cli:'grok',inputs:true},deps)).status,409,'the grok mutex still holds');
  holding=true;
  const anti=await c.handle({op:'probe',cli:'antigravity',inputs:true},deps);assert.equal(anti.status,202);await waitHeld(2);
  assert.equal(c.jobs.size,2);assert(!c.jobs.has(second.value.id));
  const refused=await c.handle({op:'probe',cli:'claude',inputs:true},deps);
  assert.equal(refused.status,429,'every job is running: nothing may be evicted, so the probe is refused');assert.match(refused.value.error,/running/i);
  assert.equal(c.jobs.size,2);assert(c.jobs.has(grok.value.id)&&c.jobs.has(anti.value.id),'both running jobs survive the refused insert');
  release();await settle(grok.value);await settle(anti.value);assert.notEqual(grok.value.status,'running');assert.notEqual(anti.value.status,'running');
});
// inherited-route-accepted: `providers[cli]` is truthy for inherited names; the declared route set is Object.hasOwn.
await test('route validation uses the declared provider set, never inherited object properties',async()=>{
  const {c}=capabilitiesSlice({matrix:capMatrix});
  const deps={home:os.tmpdir(),installedVersions:{},exec:async()=>{throw new Error('no probe may run for an unknown route');}};
  for(const cli of ['constructor','__proto__']){const r=await c.handle({op:'probe',cli,inputs:true},deps);assert.equal(r.status,400,cli);assert.equal(c.jobs.size,0,cli);}
  let started=0;
  const h=handler({provider:'constructor',governor:'codex'},true,{providers:{codex:{},grok:{}},startConnectivityJob:()=>{started++;return {id:'j'};}});
  const r=await h.serve({method:'POST',url:'/api/test',socket:{}},{});assert.equal(r.status,400,'/api/test validates the same way');assert.equal(started,0);
  const ok=await handler({provider:'grok',governor:'codex'},true,{providers:{codex:{},grok:{}},startConnectivityJob:()=>{started++;return {id:'j'};}}).serve({method:'POST',url:'/api/test',socket:{}},{});
  assert.equal(ok.status,202);assert.equal(started,1);
});
// app.js: poll-failure-locks-route + unhandled-api-error-in-poll-capability-job. The poll's
// failure must be reported, the route released (only if it still owns the job) and the matrix
// re-read so the buttons follow the server's probes.running, not a stale local map.
const probeApi=(calls,{job='job-1',poll,snapshot})=>async(p,o)=>{calls.push({path:p,method:o?.method||'GET'});if(o?.method==='POST')return {id:job,status:'running'};if(p.startsWith('/api/job/'))return poll();return snapshot();};
await test('a rejected job poll reports the error, releases the route and re-reads the matrix instead of locking the buttons',async()=>{
  const timers=fakeTimers();const c=ui(timers);c.init({platform:'win32',providers:capProviders},null);c.setCapabilities(capSnapshot);
  const toasts=[];c.showToast=m=>toasts.push(String(m));
  const calls=[];c.setApi(probeApi(calls,{poll:()=>{throw new Error('job status unavailable');},snapshot:()=>({...capSnapshot,probes:{running:[],last:{}}})}));
  const outcome=c.core.probeRoute('codex','inputs').then(()=>'settled',e=>`rejected: ${e.message}`);
  await flush();
  assert.match(c.node('#capabilities-grid').innerHTML,/data-cap-probe="inputs" data-route="codex" disabled/,'the route locks while the job runs');
  await timers.tick();await flush();
  assert.equal(await outcome,'settled','the poll failure must not escape probeRoute');
  assert(toasts.some(t=>/job status unavailable/.test(t)),`the error is reported: ${JSON.stringify(toasts)}`);
  const firstPoll=calls.findIndex(x=>x.path.startsWith('/api/job/'));
  assert(calls.some((x,i)=>i>firstPoll&&x.path==='/api/capabilities'&&x.method==='GET'),'the matrix is re-read after the failure');
  assert(!/data-route="codex" disabled/.test(c.node('#capabilities-grid').innerHTML),'buttons recover when the server reports no running probe');
  assert.equal(timers.pending().length,0,'no poll keeps running');
});
// timeout-reenables-inflight-probe: the 15-minute deadline drops the page's own handle on
// the job but the server may still be running it, so the matrix is re-read before any
// Probe button can be enabled; a route the server reports as running stays locked.
await test('a probe past its deadline re-reads the matrix before enabling buttons, so an in-flight server job stays locked',async()=>{
  const timers=fakeTimers();const c=ui(timers);c.init({platform:'win32',providers:capProviders},null);c.setCapabilities(capSnapshot);
  c.showToast=()=>{};
  let now=Date.now();vm.runInContext('Date',c).now=()=>now;
  const calls=[];c.setApi(probeApi(calls,{job:'job-2',poll:()=>({id:'job-2',status:'running'}),snapshot:()=>({...capSnapshot,probes:{running:['codex'],last:{}}})}));
  const outcome=c.core.probeRoute('codex','inputs');await flush();
  await timers.tick();await flush();
  assert.match(c.node('#capabilities-grid').innerHTML,/data-route="codex" disabled/,'still running after the first poll');
  assert.equal(calls.filter(x=>x.path==='/api/capabilities'&&x.method==='GET').length,0);
  now+=16*60_000;
  await timers.tick();await flush();await outcome;
  assert.equal(calls.filter(x=>x.path==='/api/capabilities'&&x.method==='GET').length,1,'the matrix is re-read at the deadline');
  assert.match(c.node('#capabilities-grid').innerHTML,/data-cap-probe="inputs" data-route="codex" disabled/,'the server still reports the probe running: the route stays locked');
  assert.equal(timers.pending().length,0,'polling stops at the deadline');
});
// gen-cells-unguarded: a generation entry with open+disclosure but no cells list must not reject the click.
await test('Probe generation tolerates a generation entry without cells: the confirm still appears and nothing rejects',async()=>{
  const c=ui();c.init({platform:'win32',providers:capProviders},null);
  c.setCapabilities({...capSnapshot,generation:{...capSnapshot.generation,claude:{open:1,disclosure:'MOMM generative probe, claude / image_gen'}}});
  let shown=null;c.window.confirm=t=>{shown=t;return false;};
  c.setApi(async()=>{throw new Error('declined: nothing may be posted');});
  await assert.doesNotReject(()=>c.core.probeRoute('claude','generation'));
  assert.match(String(shown),/MOMM generative probe, claude \/ image_gen/);
});
// unescaped-html-placeholder-in-plan + plan-command-placeholder-parsed-as-html: `<file>` must reach the reader.
await test('the planner command placeholder <file> is escaped, not swallowed as an element',()=>{
  const c=ui();c.init({platform:'win32',providers:capProviders},null);
  c.core.renderPlan({possible:true,steps:[],routes_used:['codex'],blocked_by:[]});
  const html=c.node('#plan-result').innerHTML;
  assert(html.includes('--plan &lt;file&gt; --consent'),`placeholder is escaped: ${html}`);assert(!html.includes('<file>'),'a raw <file> is parsed as a tag');
});
// plan-candidate-how-string-splitting: `how` may be a string (one cell) or an object (per cell).
await test('a string invocation in a plan candidate renders whole, not split per character',()=>{
  const c=ui();c.init({platform:'win32',providers:capProviders},null);
  c.core.renderPlan({possible:true,routes_used:['codex'],blocked_by:[],steps:[{from:['text'],to:['image_gen'],chosen:'codex',candidates:[{route:'codex',routable:true,level:'documented',blocker:null,how:'image_gen tool'}]}]});
  const html=c.node('#plan-result').innerHTML;
  assert.match(html,/documented · image_gen tool</);assert(!html.includes('i; m; a'),'Object.values on a string splits it');
});
// Suggestions applied from the same review (setup-ui.mjs): a cold installed-version scan is
// shared by concurrent requests; a finished probe refreshes that route's cached version so its
// overlay entry cannot read as `reprobe` against a stale number; a matrix without routes is served.
await test('concurrent snapshots share one installed-version scan, and a probe refreshes the cached version for its route',async()=>{
  let versionCalls=0,reported='9.9.9';
  const {c}=capabilitiesSlice({matrix:capMatrix,cliVersion:async()=>{versionCalls++;await new Promise(r=>setTimeout(r,5));return reported;}});
  const home=os.tmpdir();
  const [a,b]=await Promise.all([c.snapshot({home}),c.snapshot({home})]);
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(versionCalls,6,'six routes, one scan for both requests');
  assert.equal(a.value.installed.codex,'9.9.9');
  await c.snapshot({home});assert.equal(versionCalls,6,'the cache serves the third read');
  const exec=async(command,args)=>args[0]==='--version'?{code:0,stdout:'10.0.0',stderr:''}:{code:0,stdout:'a page',stderr:''};
  const job=await c.handle({op:'probe',cli:'codex',inputs:true},{home,exec});assert.equal(job.status,202);await settle(job.value);
  assert.equal(job.value.result.cli_version,'10.0.0');
  const after=await c.snapshot({home});assert.equal(after.value.installed.codex,'10.0.0','the probe version replaces the cached one');assert.equal(after.value.installed.grok,'9.9.9');assert.equal(versionCalls,6,'no rescan was needed');
});
await test('a matrix without routes is served as an empty panel, not a crash',async()=>{
  const {c}=capabilitiesSlice({matrix:{schema:'momm-capabilities-effective/1',overlay:{}}});
  const snap=await c.snapshot({home:os.tmpdir(),installedVersions:{}});
  assert.equal(snap.status,200);same(snap.value.blockers,[]);same(snap.value.generation,{});same(snap.value.pipelines.image_critique,{routes:[],blocked:[]});
});
// Suggestion applied (app.js): the route is owned synchronously on click, so a double click
// sends one POST; a failed POST hands the buttons back.
await test('a second click before the probe POST answers sends nothing, and a failed POST re-enables the buttons',async()=>{
  const c=ui();c.init({platform:'win32',providers:capProviders},null);c.setCapabilities(capSnapshot);
  const toasts=[];c.showToast=m=>toasts.push(String(m));
  const d=deferredApi();c.setApi(d.stub);
  const first=c.core.probeRoute('codex','inputs');const second=c.core.probeRoute('codex','inputs');
  assert.match(c.node('#capabilities-grid').innerHTML,/data-cap-probe="inputs" data-route="codex" disabled/,'the route locks before the POST answers');
  await flush();assert.equal(d.find('/api/capabilities','POST').length,1,'one POST for two clicks');assert.equal(await second,null);
  d.calls[0].reject(new Error('A modality probe for Codex is already running.'));
  assert.equal(await first,null);
  assert(toasts.some(t=>/already running/.test(t)));
  assert(!/data-route="codex" disabled/.test(c.node('#capabilities-grid').innerHTML),'a failed POST releases the route');
});
// load-error-leaves-pipelines: a failed refresh must not leave the previous capability sentence under an empty grid.
await test('a failed matrix refresh clears the pipelines sentence along with the grid',async()=>{
  const c=ui();c.init({platform:'win32',providers:capProviders},null);c.setCapabilities(capSnapshot);c.core.renderCapabilities();
  assert.match(c.node('#capabilities-pipelines').textContent,/Potential pipelines \(adapter capability, not a readiness check\)/);
  c.setApi(async()=>{throw new Error('registry unavailable');});
  assert.equal(typeof c.core.loadCapabilities,'function');await c.core.loadCapabilities();
  assert.match(c.node('#capabilities-summary').textContent,/registry unavailable/);assert.equal(c.node('#capabilities-grid').innerHTML,'');assert.equal(c.node('#capabilities-pipelines').textContent,'');
});
console.log(JSON.stringify({passed:passed.length,checks:passed,failures},null,2));
if(failures.length) process.exitCode=1;
