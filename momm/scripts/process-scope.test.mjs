// No model calls. Fake-platform policy drills plus real POSIX descendant tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
const moduleUrl = new URL('./process-scope.mjs', import.meta.url);
const scopeModule = fs.existsSync(moduleUrl) ? await import(moduleUrl.href) : null;
const results = [], failures = [];
async function test(name, fn) { try { await fn(); results.push(name); } catch(e) { failures.push({name,error:e.message}); } }
// A POSIX filesystem double (1.17 A1): files maps a path to its mode, or to 'dir'; links maps a path
// prefix to where it really points. Only what is listed exists, so a resolver cannot "find" a file the
// test did not plant.
function posixFs(files,links={}) {
  const real=p=>{let s=String(p);for(const [from,to] of Object.entries(links))if(s===from||s.startsWith(from+'/'))s=to+s.slice(from.length);return s;};
  return {statSync:p=>{const m=files[real(p)];if(m===undefined)throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});return {isFile:()=>m!=='dir',mode:m==='dir'?0o40755:m};},
    realpathSync:Object.assign(real,{native:real})};
}
// The fake POSIX scope resolves bare names since 1.17 A1, so the POSIX fixture carries a PATH and a
// filesystem where the names these drills launch are ordinary executables outside the project.
const FIXTURE_TOOLS=posixFs({'/usr/bin':'dir','/fixture':'dir',...Object.fromEntries(['fixture','one','two','three','retry','git'].map(n=>['/usr/bin/'+n,0o100755]))});
function fixture(platform) {
  const events=[], timers=new Set(), children=[];
  const proc=Object.assign(new EventEmitter(), {platform,pid:1234,execPath:'/node',env:platform==='win32'?{}:{PATH:'/usr/bin'},cwd:()=>'/fixture',
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
  const scope=scopeModule?.createProcessScope({process:proc,spawn,spawnSync,...clock,...(platform==='win32'?{}:{fs:FIXTURE_TOOLS})});
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
    processScope:f.scope,platformCommand:(command,args)=>({command,args}),cleanOauthEnv:()=>({PATH:'/usr/bin'}),DEFAULT_TIMEOUT_MS:100,MAX_OUTPUT_BYTES:4000});
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
      {Date:{now:()=>now},setTimeout:f.clock.setTimeout,clearTimeout:f.clock.clearTimeout,windowsTool:scopeModule.windowsTool,windowsChildEnv:scopeModule.windowsChildEnv,nodeFs:fs,
      posixTool:scopeModule.posixTool,posixChildEnv:scopeModule.posixChildEnv,relativeCommand:scopeModule.relativeCommand,notInstalled:scopeModule.notInstalled});
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
  await test('windows tool: a command that already names a location is left alone; off Windows the name is resolved, never returned bare',()=>{
    assert.equal(scopeModule.windowsTool('C:\\x\\y.exe',opts([])),'C:\\x\\y.exe');
    assert.equal(scopeModule.windowsTool('.\\local.exe',opts([])),'.\\local.exe');
    // Until 1.17 this asserted that a POSIX name came back bare ('git'), leaving the choice to the child's
    // PATH, where an entry inside the reviewed project could supply it (plan-1.17.md A1). Off Windows the
    // same rule now applies as on Windows: an executable outside the project, or a not-installed failure.
    assert.equal(scopeModule.windowsTool('git',{env:{PATH:'/usr/bin'},cwd:'/proj',platform:'linux',fs:posixFs({'/proj':'dir','/usr/bin':'dir','/usr/bin/git':0o100755})}),'/usr/bin/git');
    assert.throws(()=>scopeModule.windowsTool('git',{env:{PATH:'/usr/bin'},cwd:'/proj',platform:'linux',fs:W([])}),e=>e.code==='ENOENT'&&/git: not installed/.test(e.message));
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
  // Delta review rev_20260919182102_p7hw shell-relative-path-bypass (Codex and Grok): the guard variable
  // only stops cmd.exe's IMPLICIT working-directory search. A PATH entry of ".", any relative entry, or an
  // absolute entry inside the project would still let cmd.exe (or a grandchild) pick a planted file.
  await test('windows scope.spawn gives every child a PATH without relative or in-project entries',()=>{
    const f=fixture('win32');f.proc.env={};f.proc.cwd=()=>'C:\\proj';
    const seen=[];const scope=scopeModule.createProcessScope({process:f.proc,spawn:(c,a,o)=>{seen.push({c,o});return f.spawn(c,a,o);},spawnSync:()=>({status:0}),fs:W(['c:\\tools\\git.exe']),...f.clock});
    const dirty={PATH:'.;C:\\proj;C:\\proj\\node_modules\\.bin;relative\\bin;;"C:\\Program Files\\Git\\cmd";C:\\tools',SystemRoot:'C:\\Windows'};
    scope.spawn('npm',['view','x'],{cwd:'C:\\proj',shell:true,env:dirty});
    scope.spawn('git',['diff'],{cwd:'C:\\proj',env:dirty});
    for(const s of seen){assert.equal(s.o.env.PATH,'"C:\\Program Files\\Git\\cmd";C:\\tools','kept entries keep their original spelling, quotes included');assert.equal(Object.keys(s.o.env).filter(k=>k.toLowerCase()==='path').length,1,'one PATH key, original spelling kept');}
    assert.equal(dirty.PATH.startsWith('.;'),true,'the caller\'s object is never mutated');
  });
  await test('windows tool: system tools are recognised with or without the extension',()=>{
    for(const n of ['taskkill','tasklist','schtasks','where','icacls']) assert.equal(scopeModule.windowsTool(n,opts([])),'C:\\Windows\\System32\\'+n+'.exe');
  });
  // The POSIX scope used to pass the command and the caller's options through untouched (1.16.1 owner
  // decision 3). That left a bare name to the child's PATH; 1.17 A1 replaces the assertion with the
  // resolved launch and a scrubbed PATH, below.
}
// POSIX launch resolution (1.17 A1, 29 September 2026). On macOS and Linux a bare `codex`, `claude`,
// `grok`, `agy`, `copilot`, `gemini` or `git` went straight to spawn, so a PATH entry inside the reviewed
// project (a direnv or virtual-environment bin, a node_modules/.bin, ".") could supply it. One rule now
// holds on every platform: a bare name comes only from an absolute PATH entry outside the project, by
// literal and real path, as a regular executable file whose real path is outside the project too.
if(scopeModule) {
  const proj='/proj';
  const W=(files)=>({statSync:p=>{if(files.includes(String(p).toLowerCase()))return{isFile:()=>true};throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});},realpathSync:{native:p=>p}});
  const tool=(files,links)=>posixFs({'/proj':'dir','/proj/bin':'dir','/usr/bin':'dir','/opt/evil':'dir',...files},links);
  const resolve=(name,PATH,files,links,extra={})=>scopeModule.posixTool(name,{env:{PATH},cwd:proj,fs:tool(files,links),...extra});
  const notInstalled=(re)=>e=>e.code==='ENOENT'&&re.test(e.message);
  await test('posix tool: a PATH entry inside the project with a planted codex is refused; the outside codex is taken',()=>{
    const files={'/proj/bin/codex':0o100755,'/usr/bin/codex':0o100755};
    assert.equal(resolve('codex','/proj/bin:/usr/bin',files),'/usr/bin/codex');
    assert.equal(resolve('codex','/proj/node_modules/.bin:/usr/bin',{...files,'/proj/node_modules/.bin/codex':0o100755}),'/usr/bin/codex');
  });
  await test('posix tool: a codex only inside the project is not installed, and says so; nowhere at all says not found',()=>{
    assert.throws(()=>resolve('codex','/proj/bin',{'/proj/bin/codex':0o100755}),notInstalled(/^codex: not installed \(only found inside the reviewed project\)/));
    assert.throws(()=>resolve('codex','/usr/bin',{}),notInstalled(/^codex: not installed \(not found/));
  });
  await test('posix tool: a link outside the project that points inside it is refused by real path',()=>{
    // A directory alias outside the project that lands inside it, and an outside file linked to a file inside.
    const files={'/proj/bin/codex':0o100755,'/proj/planted':0o100755,'/usr/bin/codex':0o100755};
    assert.equal(resolve('codex','/alias:/usr/bin',files,{'/alias':'/proj/bin'}),'/usr/bin/codex');
    assert.equal(resolve('codex','/outside:/usr/bin',{...files,'/outside':'dir'},{'/outside/codex':'/proj/planted'}),'/usr/bin/codex');
    assert.throws(()=>resolve('codex','/outside',{...files,'/outside':'dir'},{'/outside/codex':'/proj/planted'}),notInstalled(/only found inside the reviewed project/));
    // A link inside the project pointing OUT is refused too: the project would still choose the binary.
    assert.throws(()=>resolve('codex','/proj/linkdir',{...files,'/opt/evil/codex':0o100755},{'/proj/linkdir':'/opt/evil'}),notInstalled(/not installed/));
  });
  await test('posix tool: relative, empty and "." PATH entries are skipped',()=>{
    const files={'/proj/codex':0o100755,'/proj/bin/codex':0o100755,'/usr/bin/codex':0o100755};
    assert.equal(resolve('codex','::.:bin:./bin:/usr/bin',files),'/usr/bin/codex');
    assert.throws(()=>resolve('codex','::.:bin:./bin',files),notInstalled(/not installed/));
  });
  await test('posix tool: a file that is not executable, or not a regular file, is skipped',()=>{
    assert.equal(resolve('codex','/opt/a:/opt/b:/usr/bin',{'/opt/a':'dir','/opt/a/codex':0o100644,'/opt/b':'dir','/opt/b/codex':'dir','/usr/bin/codex':0o100755}),'/usr/bin/codex');
    assert.throws(()=>resolve('codex','/opt/a',{'/opt/a':'dir','/opt/a/codex':0o100644}),notInstalled(/not found/));
  });
  await test('posix tool: a relative path containing a separator is refused; an absolute path MOMM resolved is kept',()=>{
    for(const name of ['./codex','bin/codex','node_modules/.bin/codex','../x/codex']) assert.throws(()=>resolve(name,'/usr/bin',{}),e=>e.code==='ENOENT'&&/relative path/.test(e.message),name);
    const userGrok = ['', 'home', 'u', '.grok', 'bin', 'grok'].join('/'); // assembled: no machine-path literal in source
    assert.equal(resolve(userGrok,'/usr/bin',{}),userGrok);
  });
  // Gate-3 review of 1.17.0: an absolute path went to spawn unchecked, and probes.mjs names ~/.grok/bin/grok
  // without checking it, so a link there into the project would have been started.
  await test('posix tool: an absolute path is launched by its real path, and one that really lies inside the project is refused',()=>{
    const userGrok=['','home','u','.grok','bin','grok'].join('/');
    assert.equal(resolve(userGrok,'/usr/bin',{'/opt/tools':'dir','/opt/tools/grok':0o100755},{[userGrok]:'/opt/tools/grok'}),'/opt/tools/grok','the checked real path, not the link');
    assert.throws(()=>resolve(userGrok,'/usr/bin',{'/proj/planted':0o100755},{[userGrok]:'/proj/planted'}),notInstalled(/only found inside the reviewed project/));
    assert.throws(()=>resolve('/proj/bin/codex','/usr/bin',{'/proj/bin/codex':0o100755}),notInstalled(/only found inside the reviewed project/));
    const f=fixture('linux');f.proc.cwd=()=>proj;const seen=[];
    const scope=scopeModule.createProcessScope({process:f.proc,spawn:(c,a,o)=>{seen.push(c);return f.spawn(c,a,o);},spawnSync:()=>({status:0}),fs:tool({'/proj/planted':0o100755,'/tmp/work':'dir'},{[userGrok]:'/proj/planted'}),...f.clock});
    assert.throws(()=>scope.spawn(userGrok,['models'],{cwd:'/tmp/work',env:{PATH:'/usr/bin'}}),notInstalled(/only found inside the reviewed project/));
    assert.deepEqual(seen,[]);
  });
  await test('windows tool: an absolute path whose real path lies inside the project gets the not-found path',()=>{
    const userGrokExe = ['C:', 'Users', 'u', '.grok', 'bin', 'grok.exe'].join('\\'); // assembled: no machine-path literal in source
    const linked={statSync:()=>({isFile:()=>true}),realpathSync:{native:p=>String(p).toLowerCase()===userGrokExe.toLowerCase()?'C:\\proj\\planted.exe':String(p)}};
    assert.equal(scopeModule.windowsTool(userGrokExe,{env:{SystemRoot:'C:\\Windows'},cwd:'C:\\proj',platform:'win32',fs:linked}),'C:\\Windows\\System32\\momm-tool-not-found\\grok.exe');
    assert.equal(scopeModule.windowsTool('C:\\proj\\bin\\codex.exe',{env:{SystemRoot:'C:\\Windows'},cwd:'C:\\proj',platform:'win32',fs:linked}),'C:\\Windows\\System32\\momm-tool-not-found\\codex.exe');
    assert.equal(scopeModule.windowsTool('C:\\tools\\grok.exe',{env:{SystemRoot:'C:\\Windows'},cwd:'C:\\proj',platform:'win32',fs:linked}),'C:\\tools\\grok.exe');
  });
  // Gate-3 review of 1.17.0: with no PATH the child searches the system directories, so the resolver does too.
  await test('posix tool: with no PATH at all, /usr/bin and then /bin are searched under the same rule; an empty PATH is still the working directory',()=>{
    const files={'/bin':'dir','/usr/bin/git':0o100755,'/bin/sh':0o100755,'/proj/git':0o100755};
    assert.equal(scopeModule.posixTool('git',{env:{HOME:'/h'},cwd:proj,fs:tool(files)}),'/usr/bin/git');
    assert.equal(scopeModule.posixTool('sh',{env:{},cwd:proj,fs:tool(files)}),'/bin/sh');
    assert.throws(()=>scopeModule.posixTool('git',{env:{},cwd:proj,fs:tool(files,{'/usr/bin/git':'/proj/git'})}),notInstalled(/only found inside the reviewed project/));
    assert.throws(()=>scopeModule.posixTool('git',{env:{PATH:''},cwd:proj,fs:tool(files)}),notInstalled(/only found inside the reviewed project/));
    const f=fixture('linux');const seen=[];
    const scope=scopeModule.createProcessScope({process:f.proc,spawn:(c,a,o)=>{seen.push({c,o});return f.spawn(c,a,o);},spawnSync:()=>({status:0}),fs:tool({...files,'/proj/bin/git':0o100755,'/fixture':'dir'}),...f.clock});
    scope.spawn('git',['status'],{cwd:proj,env:{PATH:'/proj/bin'}});
    assert.equal(seen[0].c,'/usr/bin/git','the child PATH was removed, so the system directories decide');assert.equal('PATH' in seen[0].o.env,false);
  });
  // CI run 36667179658 (Ubuntu): with every PATH entry inside the project the scrubbed PATH is removed, so the
  // system directories are searched and the reason read "not found". The caller's PATH now says why.
  await test('POSIX scope.spawn still says "only found inside the reviewed project" when scrubbing removed every entry',()=>{
    const f=fixture('linux');const seen=[];
    const scope=scopeModule.createProcessScope({process:f.proc,spawn:(c,a,o)=>{seen.push(c);return f.spawn(c,a,o);},spawnSync:()=>({status:0}),fs:tool({'/bin':'dir','/proj/bin/codex':0o100755,'/fixture':'dir'}),...f.clock});
    assert.throws(()=>scope.spawn('codex',[],{cwd:proj,env:{PATH:'/proj/bin'}}),notInstalled(/^codex: not installed \(only found inside the reviewed project\)/));
    assert.throws(()=>scope.spawn('claude',[],{cwd:proj,env:{PATH:'/proj/bin'}}),notInstalled(/^claude: not installed \(not found/),'absent everywhere still reads not found');
    assert.deepEqual(seen,[],'nothing was launched');
  });
  await test('posix child PATH: relative, empty, "." and in-project entries are removed; the caller\'s object is not mutated',()=>{
    const env={PATH:'.:/proj/bin::bin:/alias:/usr/bin:/opt/tools',HOME:'/h'};
    const out=scopeModule.posixChildEnv(env,{cwd:proj,fs:tool({'/opt/tools':'dir'},{'/alias':'/proj/bin'})});
    assert.equal(out.PATH,'/usr/bin:/opt/tools');assert.equal(out.HOME,'/h');assert.equal('NoDefaultCurrentDirectoryInExePath' in out,false);
    assert.equal(env.PATH.startsWith('.:'),true);
    // Nothing left: PATH is removed rather than set empty, since an empty PATH means the working directory to execvp.
    assert.equal('PATH' in scopeModule.posixChildEnv({PATH:'.:/proj/bin'},{cwd:proj,fs:tool({})}),false);
  });
  await test('POSIX scope.spawn launches the resolved absolute path with a scrubbed PATH, never the bare name',()=>{
    const f=fixture('linux');const seen=[];
    const scope=scopeModule.createProcessScope({process:f.proc,spawn:(c,a,o)=>{seen.push({c,o});return f.spawn(c,a,o);},spawnSync:()=>({status:0}),fs:tool({'/proj/bin/git':0o100755,'/usr/bin/git':0o100755,'/fixture':'dir'}),...f.clock});
    const env={PATH:'.:/proj/bin::/usr/bin'};scope.spawn('git',['diff'],{cwd:proj,env});
    assert.equal(seen[0].c,'/usr/bin/git');assert.equal(seen[0].o.env.PATH,'/usr/bin');
    assert.equal('NoDefaultCurrentDirectoryInExePath' in seen[0].o.env,false);assert.equal(env.PATH,'.:/proj/bin::/usr/bin');
    scope.spawn('npm view x',[],{cwd:proj,shell:true,env});
    assert.equal(seen[1].c,'npm view x','with a shell the command line is the shell\'s to parse, against the scrubbed PATH');assert.equal(seen[1].o.env.PATH,'/usr/bin');
  });
  await test('POSIX scope.spawn never launches a command found only inside the project',()=>{
    const f=fixture('linux');const seen=[];
    const scope=scopeModule.createProcessScope({process:f.proc,spawn:(c,a,o)=>{seen.push(c);return f.spawn(c,a,o);},spawnSync:()=>({status:0}),fs:tool({'/proj/bin/codex':0o100755,'/fixture':'dir'}),...f.clock});
    for(const name of ['codex','claude','grok','agy','copilot','gemini','git'])
      assert.throws(()=>scope.spawn(name,['--version'],{cwd:proj,env:{PATH:'/proj/bin:/usr/bin'}}),notInstalled(new RegExp('^'+name+': not installed')));
    assert.deepEqual(seen,[]);
  });
  await test('scope.spawn refuses a relative path containing a separator on every platform',()=>{
    for(const [platform,name] of [['linux','./node_modules/.bin/codex'],['darwin','bin/codex'],['win32','.\\node_modules\\.bin\\codex.exe'],['win32','bin/codex.exe']]) {
      const f=fixture(platform);const seen=[];
      const scope=scopeModule.createProcessScope({process:f.proc,spawn:(c,a,o)=>{seen.push(c);return f.spawn(c,a,o);},spawnSync:()=>({status:0}),fs:tool({}),...f.clock});
      assert.throws(()=>scope.spawn(name,[],{cwd:'/proj'}),e=>e.code==='ENOENT'&&/relative path/.test(e.message),platform+' '+name);
      assert.deepEqual(seen,[]);
    }
  });
  await test('scope.spawn also keeps MOMM\'s own working directory (the reviewed project) out when the child runs elsewhere',()=>{
    // Grok's model listing runs in a private temporary directory; the project is still MOMM's working directory.
    const f=fixture('linux');f.proc.cwd=()=>proj;const seen=[];
    const scope=scopeModule.createProcessScope({process:f.proc,spawn:(c,a,o)=>{seen.push({c,o});return f.spawn(c,a,o);},spawnSync:()=>({status:0}),fs:tool({'/tmp/work':'dir','/proj/bin/grok':0o100755,'/usr/bin/grok':0o100755}),...f.clock});
    scope.spawn('grok',['models'],{cwd:'/tmp/work',env:{PATH:'/proj/bin:/usr/bin'}});
    assert.equal(seen[0].c,'/usr/bin/grok');assert.equal(seen[0].o.env.PATH,'/usr/bin');
    const w=fixture('win32');w.proc.cwd=()=>'C:\\proj';const wseen=[];
    const wscope=scopeModule.createProcessScope({process:w.proc,spawn:(c,a,o)=>{wseen.push({c,o});return w.spawn(c,a,o);},spawnSync:()=>({status:0}),fs:W(['c:\\proj\\bin\\grok.exe','c:\\tools\\grok.exe']),...w.clock});
    wscope.spawn('grok',['models'],{cwd:'C:\\work',env:{Path:'C:\\proj\\bin;C:\\tools',SystemRoot:'C:\\Windows'}});
    assert.equal(wseen[0].c,'C:\\tools\\grok.exe');assert.equal(wseen[0].o.env.Path,'C:\\tools');
  });
  await test('multi-review.mjs runProcess on POSIX launches git (collectArtifact) by its resolved path outside the project',async()=>{
    const f=fixture('linux');f.proc.cwd=()=>proj;const seen=[];
    const scope=scopeModule.createProcessScope({process:f.proc,spawn:(c,a,o)=>{seen.push(c);return f.spawn(c,a,o);},spawnSync:()=>({status:0}),fs:tool({'/proj/bin/git':0o100755,'/usr/bin/git':0o100755}),...f.clock});
    const s=fs.readFileSync(new URL('multi-review.mjs',import.meta.url),'utf8'),a=s.indexOf('function platformCommand('),b=s.indexOf('function clipped(');
    const run=vm.runInNewContext(s.slice(a,b)+'\nrunProcess',{process:f.proc,path:path.posix,fs,os,Buffer,...f.clock,setInterval:()=>({}),clearInterval:()=>{},
      processScope:scope,cleanOauthEnv:()=>({PATH:'/proj/bin:/usr/bin'}),executableOutside:scopeModule.executableOutside,DEFAULT_TIMEOUT_MS:100,MAX_OUTPUT_BYTES:4000});
    run('git',['diff','--no-color','HEAD'],{timeoutMs:100,cwd:proj});
    assert.deepEqual(seen,['/usr/bin/git']);
    const refused=await run('codex',[],{timeoutMs:100,cwd:proj,env:{PATH:'/proj/bin'}});
    assert.equal(refused.error?.code,'ENOENT','not installed keeps the ordinary missing classification');assert.deepEqual(seen,['/usr/bin/git']);
  });
  if(process.platform!=='win32') {
    const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'momm-posix-resolution-')));
    const project=path.join(base,'project'),trustedDir=path.join(base,'trusted'),outside=path.join(base,'outside'),sentinel=path.join(base,'SENTINEL-planted-ran');
    for(const d of [path.join(project,'bin'),trustedDir,outside,path.join(base,'nonexec')])fs.mkdirSync(d,{recursive:true});
    const exe=(file,body,mode=0o755)=>{fs.writeFileSync(file,'#!/bin/sh\n'+body+'\n');fs.chmodSync(file,mode);return file;};
    const planted='echo planted; echo ran > '+JSON.stringify(sentinel);
    for(const f of [path.join(project,'bin','codex'),path.join(project,'codex'),path.join(project,'planted')])exe(f,planted);
    const trustedCodex=exe(path.join(trustedDir,'codex'),'echo trusted');
    exe(path.join(base,'nonexec','codex'),'echo nonexec',0o644);
    const collect=child=>new Promise((res,rej)=>{let out='';child.stdout.on('data',b=>out+=b);child.on('error',rej);child.on('close',()=>res(out));});
    try {
      await test('real POSIX: a codex planted on an in-project PATH entry never runs; the outside codex does',async()=>{
        const scope=scopeModule.createProcessScope();
        try {
          const out=await collect(scope.spawn('codex',[],{cwd:project,env:{PATH:path.join(project,'bin')+':'+trustedDir},stdio:['ignore','pipe','pipe']}));
          assert.equal(out.trim(),'trusted');assert.equal(fs.existsSync(sentinel),false,'the planted codex ran');
          assert.throws(()=>scope.spawn('codex',[],{cwd:project,env:{PATH:path.join(project,'bin')},stdio:'ignore'}),e=>e.code==='ENOENT'&&/only found inside the reviewed project/.test(e.message));
        } finally {scope.force();}
      });
      await test('real POSIX: a symlink outside the project that points into it is refused by real path',()=>{
        fs.symlinkSync(path.join(project,'bin'),path.join(base,'alias'),'dir');
        fs.symlinkSync(path.join(project,'planted'),path.join(outside,'codex'));
        for(const entry of [path.join(base,'alias'),outside]) {
          assert.equal(scopeModule.posixTool('codex',{cwd:project,env:{PATH:entry+':'+trustedDir}}),trustedCodex,entry);
          assert.throws(()=>scopeModule.posixTool('codex',{cwd:project,env:{PATH:entry}}),e=>/only found inside the reviewed project/.test(e.message),entry);
        }
      });
      await test('real POSIX: relative, empty and "." entries and non-executable files are skipped; relative paths are refused',()=>{
        const prev=process.cwd();process.chdir(project);
        try {
          assert.equal(scopeModule.posixTool('codex',{cwd:project,env:{PATH:'.::bin:./bin:'+path.join(base,'nonexec')+':'+trustedDir}}),trustedCodex);
          assert.throws(()=>scopeModule.posixTool('codex',{cwd:project,env:{PATH:'.::bin:'+path.join(base,'nonexec')}}),e=>e.code==='ENOENT');
          assert.throws(()=>scopeModule.posixTool('./codex',{cwd:project,env:{PATH:trustedDir}}),e=>/relative path/.test(e.message));
        } finally {process.chdir(prev);}
      });
      await test('real POSIX: the child PATH has no project, relative or empty entries',async()=>{
        const scope=scopeModule.createProcessScope();
        try {
          const out=await collect(scope.spawn(process.execPath,['-e','process.stdout.write(String(process.env.PATH))'],{cwd:project,env:{PATH:path.join(project,'bin')+':.::bin:'+trustedDir},stdio:['ignore','pipe','pipe']}));
          assert.equal(out,trustedDir);assert.equal(fs.existsSync(sentinel),false);
        } finally {scope.force();}
      });
    } finally {fs.rmSync(base,{recursive:true,force:true});}
  }
}
// 1.17 A1 follow-up (29 September 2026): the Setup Center opened a terminal or a browser with a bare
// osascript, open, x-terminal-emulator or xdg-open, outside processScope, so the first match on PATH ran,
// including an entry inside the project the Setup Center was started from. desktopTool prefers the
// system directories (/usr/bin, then /bin) and otherwise applies the launch rule; a copy found only
// inside the project is refused.
if(scopeModule) {
  const files={'/proj':'dir','/proj/bin':'dir','/usr/bin':'dir','/bin':'dir','/opt/tools':'dir','/proj/bin/xdg-open':0o100755,'/proj/bin/osascript':0o100755,'/usr/bin/osascript':0o100755,'/bin/xdg-open':0o100755,'/opt/tools/x-terminal-emulator':0o100755,'/usr/bin/open':0o100755};
  const where=(PATH,extra={},links)=>({platform:'linux',env:{PATH},cwd:'/proj',fs:posixFs({...files,...extra},links)});
  await test('desktop tool: /usr/bin and /bin come first, whatever PATH puts before them',()=>{
    assert.equal(scopeModule.desktopTool('osascript',where('/proj/bin:/usr/bin')),'/usr/bin/osascript');
    assert.equal(scopeModule.desktopTool('xdg-open',where('/proj/bin:/usr/bin')),'/bin/xdg-open');
  });
  await test('desktop tool: elsewhere only an absolute PATH entry outside the project; a project-only copy is refused',()=>{
    assert.equal(scopeModule.desktopTool('x-terminal-emulator',where('/proj/bin:/opt/tools')),'/opt/tools/x-terminal-emulator');
    assert.throws(()=>scopeModule.desktopTool('xdg-open',where('/proj/bin:.',{'/bin/xdg-open':undefined})),e=>e.code==='ENOENT'&&/only found inside the reviewed project/.test(e.message));
    // A system-directory entry that is a link into the project is refused by its real path.
    assert.throws(()=>scopeModule.desktopTool('osascript',where('/proj/bin',{'/usr/bin/osascript':undefined},{'/usr/bin/osascript':'/proj/bin/osascript'})),e=>e.code==='ENOENT');
    assert.throws(()=>scopeModule.desktopTool('bin/xdg-open',where('/usr/bin')),e=>/relative path/.test(e.message));
  });
  await test('desktop tool: Windows keeps its own resolver',()=>{
    assert.equal(scopeModule.desktopTool('cmd.exe',{platform:'win32',env:{SystemRoot:'C:\\Windows'},cwd:'C:\\proj'}),'C:\\Windows\\System32\\cmd.exe');
  });
  const ui=fs.readFileSync(new URL('setup-ui.mjs',import.meta.url),'utf8');
  const launchers=ui.slice(ui.indexOf('function launchTerminal('),ui.indexOf('function safeDetail('));
  const drive=(platform,PATH,extra={})=>{
    const spawned=[];const child={on(){},unref(){},pid:77};
    const ctx={process:{platform,env:{PATH},cwd:()=>'/proj'},fs:posixFs({...files,...extra}),windowsTool:scopeModule.windowsTool,desktopTool:scopeModule.desktopTool,
      spawn:(c,a)=>{spawned.push([c,a]);return child;}};
    const api=vm.runInNewContext(launchers+'\n;({launchTerminal,openBrowser})',ctx);
    return {api,spawned};
  };
  await test('setup-ui launchTerminal and openBrowser spawn the resolved system tool, never a bare name',()=>{
    const mac=drive('darwin','/proj/bin:/usr/bin');
    assert.equal(mac.api.launchTerminal('codex login'),true);mac.api.openBrowser('http://127.0.0.1:1/');
    assert.deepEqual(mac.spawned.map(s=>s[0]),['/usr/bin/osascript','/usr/bin/open']);
    const linux=drive('linux','/proj/bin:/opt/tools');
    assert.equal(linux.api.launchTerminal('codex login'),true);linux.api.openBrowser('http://127.0.0.1:1/');
    assert.deepEqual(linux.spawned.map(s=>s[0]),['/opt/tools/x-terminal-emulator','/bin/xdg-open']);
  });
  await test('setup-ui launchers refuse a tool found only inside the project and launch nothing',()=>{
    const only=drive('darwin','/proj/bin',{'/usr/bin/osascript':undefined,'/usr/bin/open':undefined,'/proj/bin/open':0o100755});
    assert.equal(only.api.launchTerminal('codex login'),false);
    assert.doesNotThrow(()=>only.api.openBrowser('http://127.0.0.1:1/'),'a browser that cannot be opened is not a crash');
    assert.deepEqual(only.spawned,[]);
  });
}
console.log(JSON.stringify({passed:results.length,checks:results,failures,posix_integration:process.platform==='win32'?'not run on Windows':'executed'},null,2));
if(failures.length)process.exitCode=1;
