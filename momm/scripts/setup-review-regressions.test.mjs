// Governor-authored review probes. Production functions; synthetic requests only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
delete process.env.MOMM_EVIDENCE_HOME; // each suite owns its fixture evidence location
const suite = fs.readFileSync(new URL('./setup-maintenance.test.mjs', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../assets/setup-ui/app.js', import.meta.url), 'utf8');
const flush = async () => { for (let i=0;i<12;i++) await new Promise(resolve=>setImmediate(resolve)); };
const same = (a,b,message) => assert.equal(JSON.stringify(a),JSON.stringify(b),message);
const session = {token:'fixture-session',platform:'win32',providers:{codex:{label:'Codex',docs:'x'},copilot:{label:'Copilot',docs:'x'},grok:{label:'Grok',docs:'x'}}};
const maintenance = () => ({cli_updates:[
  {agent:'codex',current:'1.0.0',latest:'1.1.0',status:'update_available',installed:true,update_command:'synthetic codex'},
  {agent:'copilot',current:'1.0.0',latest:'1.1.0',status:'update_available',installed:true,update_command:'synthetic copilot'},
  {agent:'grok',current:'1.0.0',latest:null,status:'unknown',installed:true,update_command:'synthetic grok'}
],models:[],skills:{versions:[],repository_dirty:false},environment:{},runtime:{node_ready:true,node:'22',git:'2',powershell:'7',platform:'win32'},checked_at:'2026-10-09T00:00:00Z'});

function fixture(variant=client) {
  const begin=suite.indexOf('function fakeTimers('),end=suite.indexOf("await test('six CLI rows",begin);
  assert(begin>=0&&end>begin,'fixture extraction must be exact');
  const host=vm.createContext({vm,client:variant,assert,flush,same});
  vm.runInContext(suite.slice(begin,end)+';this.make=ui;this.timers=fakeTimers;',host);
  return host;
}
function ui(variant=client,extra={}) {
  const c=fixture(variant).make(extra);c.init(session,maintenance());c.window.confirm=()=>true;return c;
}
function callback(label, makeUi=()=>ui()) {
  const begin=suite.indexOf(`await test('${label}'`);assert(begin>=0,`test exists: ${label}`);
  const end=suite.indexOf('\nawait test(',begin+1);
  const part=suite.slice(begin,end<0?suite.indexOf('\nconsole.log(',begin):end);
  const expression=part.slice(part.indexOf('async()=>'),part.lastIndexOf(');'));
  let visibleText;
  const h=suite.indexOf('function visibleText(');
  if(h>=0){const tail=suite.indexOf('\n}',h)+2;visibleText=vm.runInNewContext('('+suite.slice(h,tail)+')');}
  return vm.runInNewContext('('+expression+')',{ui:makeUi,assert,flush,same,dashboardSession:session,dashboardMaintenance:maintenance,visibleText});
}
async function mustDetect(label, makeUi, marker) {
  const mutated = callback(label,makeUi);
  await callback(label,()=>ui())();
  let rejection;
  try { await mutated(); } catch(error) { rejection=error; }
  assert.equal(rejection?.name,'AssertionError','the original test must detect the seeded regression');
  if(marker)assert.match(rejection.message,marker);
}

const cases = {
  async F1() {
    const c=ui();c.setReport({routes:[{agent:'copilot',role:'reviewer',installed:true,ready:true}]});c.pass('copilot');
    vm.runInContext("waitForVersionChange=async()=> '1.1.0';",c);c.setApi(async()=>({launched:true}));
    await c.core.runBatchUpdate(['copilot']);assert.equal(c.getLive().has('copilot'),false);assert.equal(c.node('#setup-percent').textContent,'0%');
  },
  async F2() {
    assert(suite.includes('in-page Update all confirmation cancels without dispatch'));
    await callback('in-page Update all confirmation cancels without dispatch, then admits only its listed commands')();
    await callback('a batch launch refusal preserves live evidence and never says the updater opened')();
    assert(suite.includes('a stalled batch launch has a bounded observation deadline'));
  },
  async F3() {
    await mustDetect('a batch transport error is fixed-field uncertainty and never echoes private diagnostics',()=>{
      const c=ui();Object.defineProperty(c.node('#operation-status'),'textContent',{get:()=> 'PRIVATE_OAUTH_MARKER',set(){}});return c;
    },/PRIVATE_OAUTH_MARKER/);
  },
  async F4() {
    const variant=client.replace(/\s*if \(runningTests\.has\(provider\)\) \{[^}]+\}/g,'');
    assert.notEqual(variant,client,'the in-flight guard must actually be removed');
    await mustDetect('a terminal update cannot start while the same provider has a live check in flight',()=>ui(variant));
  },
  async F5() {
    const c=ui();let reject;
    c.setApi(()=>new Promise((resolve,r)=>{reject=r;}));const pending=c.core.launchAction('codex','update');await flush();
    c.core.renderMaintenance();assert.match(c.node('#maintenance-grid').innerHTML,/Launching terminal/);
    const error=Object.assign(Error('synthetic'),{status:500,action_receipt:{provider:'codex',action:'update',status:'launch_failed'}});reject(error);await pending;
    assert.doesNotMatch(c.node('#maintenance-grid').innerHTML,/data-maint-provider="codex"[^>]*disabled/);
    assert.match(c.node('#maintenance-grid').innerHTML,/Terminal was not launched/);
  },
  async F6() {
    const c=ui();c.core.toggleBatch('grok',true);c.setApi(async()=>({launched:false}));await c.core.runAllUpdates();same(c.core.selectedBatch(),['grok']);
  },
  async F7() {
    const label='an empty reviewer pool is unavailable rather than 100 percent complete';
    // This callback is synchronous, so extract it separately from async fixtures.
    const begin=suite.indexOf(`await test('${label}'`),end=suite.indexOf('\nawait test(',begin+1),part=suite.slice(begin,end);
    const expression=part.slice(part.indexOf('()=>'),part.lastIndexOf(');'));
    const make=()=>{const c=ui(),render=c.core.render;c.core.render=()=>{render();c.node('#setup-percent').textContent='NaN%';};return c;};
    let rejected;try{vm.runInNewContext('('+expression+')',{ui:make,assert,dashboardSession:session})();}catch(e){rejected=e;}
    assert.equal(rejected?.name,'AssertionError','NaN must be detected');
  },
  async F8() {
    const begin=suite.indexOf('async function test('),end=suite.indexOf('// vm-context values',begin);
    const failures=[],host=vm.createContext({passed:[],failures,Promise,String,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,30)),clearTimeout});
    vm.runInContext(suite.slice(begin,end)+';this.run=test;',host);
    const completed=await Promise.race([host.run('seeded never-settling test',()=>new Promise(()=>{})).then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),120))]);
    assert.equal(completed,true,'a stuck test must become one recorded failure');assert.equal(failures.length,1);assert.equal(failures[0].name,'seeded never-settling test');
  },
  async F9() {
    const c=ui();c.setApi(()=>new Promise(()=>{}));c.core.refresh();assert.match(c.node('#operation-status').textContent,/Checking reviewer discovery/);await flush();assert.match(c.node('#operation-status').textContent,/Checking reviewer discovery/);
  },
  async F10() {
    const label='Update all is prominent and selects only known available updates with verified commands';
    const begin=suite.indexOf(`await test('${label}'`),end=suite.indexOf('\nawait test(',begin+1),part=suite.slice(begin,end);
    const expression=part.slice(part.indexOf('()=>'),part.lastIndexOf(');'));
    const make=()=>{const c=ui();vm.runInContext('isBatchable=item=>Boolean(item && item.installed);',c);return c;};
    let rejected;try{vm.runInNewContext('('+expression+')',{ui:make,assert,dashboardSession:session,dashboardMaintenance:maintenance})();}catch(e){rejected=e;}
    assert.equal(rejected?.name,'AssertionError','the command-eligibility mutation must be detected');
  },
  async S3() { await cases.F5(); },
  async S4() {
    const f=fixture(),timers=f.timers(),c=ui(client,timers);vm.runInContext('this.wait=waitForVersionChange;',c);
    c.setApi(async()=>maintenance());c.wait('codex','1.0.0');await flush();assert(timers.pending().some(t=>t.ms>=5000),'forced maintenance must not run every two seconds');
  },
  async S6() { await cases.F6(); },
  async S7() {
    assert.match(client,/id="batch-progress"[^>]*aria-live="off"/,'duplicate batch announcements must be disabled');
  },
  async S9() { const c=ui();c.setReport({routes:[]});c.core.render();assert.match(c.node('#summary').textContent,/No reviewer/); },
  async S10() {
    const c=ui();c.setApi(async()=>({launched:true}));await c.core.launchAction('codex','update');c.core.renderMaintenance();assert.match(c.node('#maintenance-grid').innerHTML,/excluded from Update all/);
  },
  async S17() {
    assert(suite.includes('dialog Escape cancels without dispatch'),'Escape must have a named regression');
    await callback('dialog Escape cancels without dispatch')();
  },
  async R1() {
    await mustDetect('a batch launch refusal preserves live evidence and never says the updater opened',()=>{
      const c=ui();vm.runInContext('renderMaintenance=()=>{maintenanceGrid.innerHTML="";};',c);return c;
    });
  },
  async C0() {
    for(const label of ['dialog Escape cancels without dispatch','a batch stops after unobserved version evidence','a changed batch command is blocked before any terminal request']) {
      assert(suite.includes(`await test('${label}'`),`named regression: ${label}`);await callback(label)();
    }
  },
  async C1() {
    const c=ui();let renders=0;vm.runInContext('this.replaceRender=f=>{render=f;};',c);c.replaceRender(()=>{if(++renders===2)throw Error('synthetic render failure');});c.setApi(async()=>({launched:true}));
    vm.runInContext("waitForVersionChange=async()=> '1.1.0';",c);await c.core.runBatchUpdate(['codex']);assert.match(c.node('#batch-progress').textContent,/Stopped.*tracking|Stopped.*unavailable/i);
  }
};
export async function runReviewProbes(selected=null) {
  if(selected&&!Object.hasOwn(cases,selected))throw Error('Unknown governor probe');
  const results=[];
  for(const name of selected?[selected]:Object.keys(cases)) {
    try {await cases[name]();results.push({name,passed:true});}
    catch(error){results.push({name,passed:false,error:error.message});}
  }
  return {passed:results.every(r=>r.passed),results};
}
const entry=process.argv[1]&&fs.existsSync(process.argv[1])?fs.realpathSync(process.argv[1]):null;
const modulePath=fs.realpathSync(fileURLToPath(import.meta.url));
const normalizeEntry=value=>process.platform==='win32'?value.toLowerCase():value;
if(entry&&normalizeEntry(entry)===normalizeEntry(modulePath)) {
  const caseIndex=process.argv.indexOf('--case');
  if(caseIndex>=0&&(!process.argv[caseIndex+1]||process.argv[caseIndex+1].startsWith('--')))throw Error('--case needs a known probe name');
  const selected=caseIndex>=0?process.argv[caseIndex+1]:null;
  const result=await runReviewProbes(selected);console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
