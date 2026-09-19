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
  await test('Windows tree kill is launched by absolute System32 path, never a bare name',()=>{
    // Gate-4 [1]: a direct spawn of a bare name tries the working directory BEFORE PATH
    // (unless the calling process already carries NoDefaultCurrentDirectoryInExePath), so a
    // taskkill.exe planted in a reviewed project would run on any timeout.
    const SYSTEM=/^[A-Za-z]:\\[^"]*\\System32\\taskkill\.exe$/;
    const f=fixture('win32');f.proc.env={SystemRoot:'D:\\WinRoot'};const launched=[];
    const scope=scopeModule.createProcessScope({process:f.proc,spawn:(command,args,options)=>{launched.push(command);return f.spawn(command,args,options);},spawnSync:(command,args,options)=>{launched.push(command);return {status:0};},...f.clock});
    const a=scope.spawn('fixture',[],{});scope.terminate(a);const b=scope.spawn('fixture',[],{});scope.force();
    const killers=launched.filter(c=>/taskkill/i.test(c));assert(killers.length>=2,JSON.stringify(launched));
    for(const command of killers){assert.match(command,SYSTEM);assert.equal(command,'D:\\WinRoot\\System32\\taskkill.exe');}
    const bare=fixture('win32'),seen=[];// no SystemRoot in the environment: still absolute
    const fallback=scopeModule.createProcessScope({process:bare.proc,spawn:bare.spawn,spawnSync:(command)=>{seen.push(command);return {status:0};},...bare.clock});
    fallback.spawn('fixture',[],{});fallback.force();assert.match(seen[0],SYSTEM);
  });
  await test('Windows final cleanup waits for tree kill before direct fallback or exit',()=>{
    const f=fixture('win32'),c=f.scope.spawn('fixture',[],{});f.scope.force();
    assert.match(String(f.events[0]?.sync),/\\System32\\taskkill\.exe$/,'final cleanup must not race tree enumeration with a direct leader kill');
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
    const create=vm.runInNewContext(source.slice(source.indexOf('export function createProcessScope')).replace('export function','function')+'\ncreateProcessScope',
      {Date:{now:()=>now},setTimeout:f.clock.setTimeout,clearTimeout:f.clock.clearTimeout,windowsTool:scopeModule.windowsTool,nodeFs:fs});
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
// Windows tool resolution (release halt, 19 September 2026): Node 18 and Node 20 ignore
// NoDefaultCurrentDirectoryInExePath, so on those runtimes a bare command name handed to spawn is looked
// up in the child's working directory first and a git.exe planted in the reviewed project was started
// (CI run 35459186774, windows-latest, Node 20.20.2). MOMM therefore never hands a bare name to spawn on
// Windows: it resolves the name itself against absolute PATH entries outside the working directory.
if(scopeModule) {
  const W=(files)=>({statSync:p=>{if(files.includes(String(p).toLowerCase()))return{isFile:()=>true};throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});},realpathSync:{native:p=>p}});
  const env={Path:'C:\\proj;.;relative\\bin;;"C:\\Program Files\\Git\\cmd";C:\\tools',SystemRoot:'C:\\Windows'};
  const opts=(files,extra={})=>({env,cwd:'C:\\proj',platform:'win32',fs:W(files),...extra});
  await test('windows tool: a name planted in the working directory is never chosen, PATH outside it is',()=>{
    const files=['c:\\proj\\git.exe','c:\\program files\\git\\cmd\\git.exe'];
    assert.equal(scopeModule.windowsTool('git',opts(files)),'C:\\Program Files\\Git\\cmd\\git.exe');
    assert.equal(scopeModule.windowsTool('git.exe',opts(files)),'C:\\Program Files\\Git\\cmd\\git.exe');
  });
  await test('windows tool: only a copy inside the working directory means not found, as an absolute path that cannot exist',()=>{
    const missing=scopeModule.windowsTool('git',opts(['c:\\proj\\git.exe']));
    assert.equal(missing,'C:\\Windows\\System32\\momm-tool-not-found\\git.exe');
    assert.equal(scopeModule.windowsTool('codex',opts([])),'C:\\Windows\\System32\\momm-tool-not-found\\codex.exe');
  });
  await test('windows tool: a PATH entry below the working directory is skipped too',()=>{
    const e={Path:'C:\\proj\\node_modules\\.bin;C:\\tools',SystemRoot:'C:\\Windows'};
    assert.equal(scopeModule.windowsTool('grok',{env:e,cwd:'C:\\proj',platform:'win32',fs:W(['c:\\proj\\node_modules\\.bin\\grok.exe','c:\\tools\\grok.exe'])}),'C:\\tools\\grok.exe');
  });
  await test('windows tool: system tools come from System32 whatever PATH says',()=>{
    const files=['c:\\tools\\cmd.exe','c:\\tools\\powershell.exe'];
    assert.equal(scopeModule.windowsTool('cmd.exe',opts(files)),'C:\\Windows\\System32\\cmd.exe');
    assert.equal(scopeModule.windowsTool('cmd',opts(files)),'C:\\Windows\\System32\\cmd.exe');
    assert.equal(scopeModule.windowsTool('taskkill.exe',opts(files)),'C:\\Windows\\System32\\taskkill.exe');
    assert.equal(scopeModule.windowsTool('powershell.exe',opts(files)),'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });
  await test('windows tool: a command that already names a location, and every POSIX command, is left alone',()=>{
    assert.equal(scopeModule.windowsTool('C:\\x\\y.exe',opts([])),'C:\\x\\y.exe');
    assert.equal(scopeModule.windowsTool('.\\local.exe',opts([])),'.\\local.exe');
    assert.equal(scopeModule.windowsTool('git',{env:{PATH:'/usr/bin'},cwd:'/proj',platform:'linux',fs:W([])}),'git');
  });
  await test('windows scope.spawn resolves the name, guards the child environment and names cmd.exe absolutely',()=>{
    const f=fixture('win32');f.proc.env={Path:'C:\\tools',SystemRoot:'C:\\Windows'};f.proc.cwd=()=>'C:\\proj';
    const seen=[];const scope=scopeModule.createProcessScope({process:f.proc,spawn:(c,a,o)=>{seen.push({c,o});return f.spawn(c,a,o);},spawnSync:()=>({status:0}),fs:W(['c:\\tools\\git.exe','c:\\proj\\git.exe']),...f.clock});
    scope.spawn('git.exe',['diff'],{cwd:'C:\\proj',env:{Path:'C:\\tools',SystemRoot:'C:\\Windows'}});
    assert.equal(seen[0].c,'C:\\tools\\git.exe');
    assert.equal(seen[0].o.env.NoDefaultCurrentDirectoryInExePath,'1','cmd.exe and newer runtimes honour this; it rides along');
    scope.spawn('npm',['view','x'],{cwd:'C:\\proj',shell:true,env:{Path:'C:\\tools',SystemRoot:'C:\\Windows'}});
    assert.equal(seen[1].c,'npm','with a shell the command line is cmd.exe\'s to parse');
    assert.equal(seen[1].o.shell,'C:\\Windows\\System32\\cmd.exe');
    assert.equal(seen[1].o.env.NoDefaultCurrentDirectoryInExePath,'1');
  });
  await test('POSIX scope.spawn passes the command and options through untouched',()=>{
    const f=fixture('linux');const seen=[];const scope=scopeModule.createProcessScope({process:f.proc,spawn:(c,a,o)=>{seen.push({c,o});return f.spawn(c,a,o);},spawnSync:()=>({status:0}),...f.clock});
    const env={PATH:'/usr/bin'};scope.spawn('git',['diff'],{env});
    assert.equal(seen[0].c,'git');assert.equal(seen[0].o.env,env);assert.equal('NoDefaultCurrentDirectoryInExePath' in seen[0].o.env,false);
  });
}
console.log(JSON.stringify({passed:results.length,checks:results,failures,posix_integration:process.platform==='win32'?'not run on Windows':'executed'},null,2));
if(failures.length)process.exitCode=1;
