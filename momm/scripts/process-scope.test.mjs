// No model calls. Fake-platform policy drills plus real POSIX descendant tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
const moduleUrl = new URL('./process-scope.mjs', import.meta.url);
const scopeModule = fs.existsSync(moduleUrl) ? await import(moduleUrl.href) : null;
const results = [], failures = [];
async function test(name, fn) { try { await fn(); results.push(name); } catch(e) { failures.push({name,error:e.message}); } }
function fixture(platform) {
  const events=[], timers=new Set(), children=[];
  const proc=Object.assign(new EventEmitter(), {platform,pid:1234,execPath:'/node',env:{},cwd:()=>'/fixture',
    kill:(pid,signal)=>events.push({pid,signal}),exit:code=>events.push({exit:code})});
  function spawn(command,args,options) {
    const c=new EventEmitter(); c.pid=4321+children.length; c.options=options;
    c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();
    for(const s of[c.stdout,c.stderr,c.stdin])s.destroy=()=>{s.destroyed=true;};
    c.stdin.end=()=>{};c.kill=signal=>events.push({direct:c.pid,signal});c.unref=()=>{};
    children.push(c);return c;
  }
  const clock={setTimeout:(fn,ms)=>{const t={fn,ms,unref(){}};timers.add(t);return t;},clearTimeout:t=>timers.delete(t)};
  const spawnSync=(command,args,options)=>{events.push({sync:command,args,timeout:options.timeout});return {status:0};};
  const scope=scopeModule?.createProcessScope({process:proc,spawn,spawnSync,...clock});
  return {proc,spawn,events,timers,children,clock,scope};
}
for(const [file,start,end,call] of [
  ['multi-review.mjs','function runProcess(','function clipped(','runProcess("fixture",[],{timeoutMs:100})'],
  ['setup-ui.mjs','function killProcessTree(','async function readiness(','runNode("fixture",[],{timeoutMs:100})'],
]) await test(`${file}: POSIX timeout owns a process group`,async()=>{
  const f=fixture('darwin'),s=fs.readFileSync(new URL(file,import.meta.url),'utf8');
  let a=s.indexOf(start);if(a<0&&file==='setup-ui.mjs')a=s.indexOf('function supervise(');
  assert(a>=0);const code=s.slice(a,s.indexOf(end,a));
  vm.runInNewContext(code+'\n'+call,{process:f.proc,spawn:f.spawn,Buffer,...f.clock,setInterval:()=>({}),clearInterval:()=>{},
    processScope:f.scope,platformCommand:(command,args)=>({command,args}),cleanOauthEnv:()=>({}),DEFAULT_TIMEOUT_MS:100,MAX_OUTPUT_BYTES:4000});
  assert.equal(f.children[0].options.detached,true,'POSIX child must own a group');
  [...f.timers].find(t=>t.ms===100).fn();
  assert(f.events.some(e=>e.pid===-4321),'timeout must signal the owned group');
});
if(scopeModule) {
  await test('normal leader exit cleans ignored-stdio descendants; no stale delayed kill',()=>{
    const f=fixture('linux'),c=f.scope.spawn('fixture',[],{});
    f.scope.terminate(c,{graceful:true});c.emit('exit',0);
    assert(f.events.some(e=>e.pid===-c.pid&&e.signal==='SIGKILL'));
    assert.equal(f.timers.size,0);const n=f.events.length;f.scope.release(c);assert.equal(f.events.length,n);
  });
  await test('missing PID never targets parent, zero or another group',()=>{
    const f=fixture('linux'),c=f.scope.spawn('fixture',[],{});c.pid=undefined;c.emit('error',Error('missing'));
    f.scope.terminate(c);f.scope.release(c);assert.equal(f.events.length,0);
  });
  await test('Windows retains taskkill tree policy without POSIX groups',()=>{
    const f=fixture('win32'),c=f.scope.spawn('fixture',[],{});f.scope.terminate(c);
    assert.equal(c.options.detached,false);assert.equal(f.children.length,2);assert(!f.events.some(e=>e.pid<0));
  });
  await test('Windows final cleanup waits for tree kill before direct fallback or exit',()=>{
    const f=fixture('win32'),c=f.scope.spawn('fixture',[],{});f.scope.force();
    assert.equal(f.events[0]?.sync,'taskkill','final cleanup must not race tree enumeration with a direct leader kill');
    assert.deepEqual(f.events[0].args,['/pid',String(c.pid),'/T','/F']);
    assert(f.events[0].timeout>0&&f.events[0].timeout<=2000);
  });
  await test('Windows failed or timed-out tree kill retains direct-child fallback',()=>{
    for(const result of [{status:1},{status:null,error:Error('timeout')}]) {
      const f=fixture('win32');
      const scope=scopeModule.createProcessScope({process:f.proc,spawn:f.spawn,spawnSync:()=>result,...f.clock});
      const child=scope.spawn('fixture',[]);scope.force();
      assert(f.events.some(e=>e.direct===child.pid&&e.signal==='SIGKILL'));
    }
  });
  await test('Windows final cleanup shares a fresh two-second budget across children',()=>{
    const f=fixture('win32'),budgets=[];let now=9000;
    const source=fs.readFileSync(moduleUrl,'utf8');
    const create=vm.runInNewContext(source.slice(source.indexOf('export function')).replace('export function','function')+'\ncreateProcessScope',
      {Date:{now:()=>now},setTimeout:f.clock.setTimeout,clearTimeout:f.clock.clearTimeout});
    const scope=create({process:f.proc,spawn:f.spawn,spawnSync:(_c,_a,options)=>{budgets.push(options.timeout);now+=1500;return {status:0};}});
    scope.spawn('one',[]);scope.spawn('two',[]);const third=scope.spawn('three',[]);
    now=50000;scope.force();assert.deepEqual(budgets,[2000,500]);
    assert(f.events.some(e=>e.direct===third.pid),'exhausted budget must still use the direct backstop');
  });
  await test('an error on a live child retains ownership for shutdown retry',()=>{
    const f=fixture('darwin'),c=f.scope.spawn('fixture',[],{});c.emit('error',Error('kill failed'));
    assert.doesNotThrow(()=>c.emit('error',Error('kill failed again')));
    const n=f.events.length;f.scope.stop();assert(f.events.length>n,'error is not a terminal child event');
  });
  await test('shutdown is idempotent, rejects retries, and exit cleanup is synchronous',()=>{
    const f=fixture('darwin'),c=f.scope.spawn('fixture',[],{});
    f.scope.installSignalHandlers();f.proc.emit('SIGTERM');f.proc.emit('SIGTERM');
    assert.throws(()=>f.scope.spawn('retry',[],{}),/stopping/);
    f.proc.emit('exit');assert(f.events.some(e=>e.pid===-c.pid&&e.signal==='SIGKILL'));
  });
  if(process.platform!=='win32') {
    function live(pid) {
      const r=spawnSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8',timeout:3000});
      if(r.error)throw r.error;
      return r.status===0 && r.stdout.trim() && !r.stdout.trim().startsWith('Z');
    }
    async function gone(pids) {
      const deadline=Date.now()+6000;
      while(Date.now()<deadline) { if(pids.every(p=>!live(p)))return;await new Promise(r=>setTimeout(r,50)); }
      assert.fail('owned descendants remained live after bounded cleanup');
    }
    async function ready(child) {
      return new Promise((resolve,reject)=>{
        let text='';const timer=setTimeout(()=>reject(Error('fixture did not become ready')),5000);
        child.stdout.on('data',b=>{text+=b;const line=text.split('\n').find(s=>s.startsWith('READY '));if(line){clearTimeout(timer);resolve(JSON.parse(line.slice(6)));}});
        child.on('error',e=>{clearTimeout(timer);reject(e);});
      });
    }
    await test('real POSIX: ordinary leader exit kills ignored-stdio helper',async()=>{
      const scope=scopeModule.createProcessScope();let child,pids=[];
      try {
        child=scope.spawn(process.execPath,['-e',`const {spawn}=require('child_process');const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});c.on('message',()=>{console.log('READY '+JSON.stringify([c.pid]));process.exit(0)});`],{stdio:['ignore','pipe','pipe']});
        pids=await ready(child);await gone(pids);
      } finally {scope.force();for(const p of pids)try{process.kill(p,'SIGKILL')}catch{}}
    });
    await test('real POSIX: wrapper cancellation reaches nested reviewer groups',async()=>{
      const scope=scopeModule.createProcessScope();let child,pids=[];
      try {
        const nested=`import {createProcessScope} from ${JSON.stringify(moduleUrl.href)};const s=createProcessScope();s.installSignalHandlers();const c=s.spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});c.on('message',()=>console.log('READY '+JSON.stringify([process.pid,c.pid])));setInterval(()=>{},1000);`;
        child=scope.spawn(process.execPath,['--input-type=module','-e',nested],{stdio:['ignore','pipe','pipe']});
        pids=await ready(child);scope.terminate(child,{graceful:true});await gone(pids);
      } finally {scope.force();for(const p of pids)try{process.kill(p,'SIGKILL')}catch{}}
    });
  }
}
console.log(JSON.stringify({passed:results.length,checks:results,failures,posix_integration:process.platform==='win32'?'not run on Windows':'executed'},null,2));
if(failures.length)process.exitCode=1;
