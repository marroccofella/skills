// Permission-check failure, stale-lock recovery, live-owner preservation, table and reply-corpus checks.
// Called by scripts/self-test.js with its assertion counter; runs offline on every platform.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process');
const runtime=require('../scripts/runtime'),{ensurePrivate,verifiedDirs,writeObject}=runtime;
const {inspectLock,recoverStale}=require('../scripts/lock'),{playback}=require('../scripts/speak'),{recover}=require('../scripts/status');
const {applyMode,MODES}=require('../scripts/summarize');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function deadPid(){const result=spawnSync(process.execPath,['-e',''],{stdio:'ignore'});return result.pid;}
function liveOwner(){return spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});}
const token=()=>require('node:crypto').randomBytes(16).toString('hex');
const options={chunks:['Synthetic test text.'],mode:'informative',profile:'conversational',provider:'sapi',waitMs:0};
const quickPlay=async()=>{};

async function permissionChecks(check,fixture){
 const win={platform:'win32'};
 const reset=()=>verifiedDirs.clear();
 // Each failure kind gives a typed reason and never echoes the folder path or PowerShell output.
 const failures=[
  [{error:Object.assign(new Error('x'),{code:'ETIMEDOUT'}),status:null},/timed out after 60 s/],
  [{error:Object.assign(new Error('x'),{code:'ENOENT'}),status:null},/could not start \(ENOENT\)/],
  [{status:3,stderr:'DOM_TTS_NOT_PRIVATE\r\n'},/grants access to other accounts/],
  [{status:1,stderr:'Set-Acl : secret detail C:\\Users\\private'},/exited with code 1/],
 ];
 for(const [result,pattern] of failures){
  const dir=path.join(fixture,'perm-'+Math.random().toString(16).slice(2));fs.mkdirSync(dir);reset();
  let message='';try{ensurePrivate(dir,{...win,run:()=>result});}catch(e){message=e.message;}
  check(()=>assert.match(message,pattern));check(()=>assert(!message.includes(dir)&&!message.includes('secret detail')));
  check(()=>assert(!fs.existsSync(path.join(dir,'.private-verified'))));
 }
 // The configured timeout reaches the PowerShell call.
 let seenTimeout;reset();const timed=path.join(fixture,'perm-timeout');fs.mkdirSync(timed);
 try{ensurePrivate(timed,{...win,timeoutMs:1234,run:(file,args,opts)=>{seenTimeout=opts.timeout;return {status:0};}});}catch{}
 check(()=>assert.equal(seenTimeout,1234));
 // A failed check stops playback before any lock or status is written.
 const blocked=path.join(fixture,'perm-blocked');fs.mkdirSync(blocked);reset();
 await assert.rejects(playback(options,{dir:blocked,play:quickPlay,privacy:dir=>ensurePrivate(dir,{...win,run:()=>({status:3,stderr:'DOM_TTS_NOT_PRIVATE'})})}),/grants access/);
 check(()=>assert.deepEqual(fs.readdirSync(blocked),[]));
 // Success writes a marker bound to the folder; later calls skip PowerShell until the marker no longer matches.
 const good=path.join(fixture,'perm-good');fs.mkdirSync(good);reset();let calls=0;const ok=()=>{calls++;return {status:0};};
 ensurePrivate(good,{...win,run:ok});check(()=>assert.equal(calls,1));check(()=>assert(fs.existsSync(path.join(good,'.private-verified'))));
 ensurePrivate(good,{...win,run:ok});check(()=>assert.equal(calls,1));
 reset();ensurePrivate(good,{...win,run:ok});check(()=>assert.equal(calls,1));
 fs.writeFileSync(path.join(good,'.private-verified'),'{"schema":"dom-tts-private/1","ino":"0","birthtimeMs":0}');reset();ensurePrivate(good,{...win,run:ok});check(()=>assert.equal(calls,2));
 const copied=path.join(fixture,'perm-copied');fs.mkdirSync(copied);fs.copyFileSync(path.join(good,'.private-verified'),path.join(copied,'.private-verified'));reset();ensurePrivate(copied,{...win,run:ok});check(()=>assert.equal(calls,3));
 // A new folder is created by the check itself; a "success" that leaves no folder is refused.
 const fresh=path.join(fixture,'perm-fresh');reset();ensurePrivate(fresh,{...win,run:()=>{fs.mkdirSync(fresh);return {status:0};}});check(()=>assert(fs.existsSync(path.join(fresh,'.private-verified'))));
 const missing=path.join(fixture,'perm-missing');reset();check(()=>assert.throws(()=>ensurePrivate(missing,{...win,run:()=>({status:0})}),/folder missing/));
 if(process.platform!=='win32'){
  const link=path.join(fixture,'perm-link');fs.symlinkSync(good,link);reset();let ran=false;
  check(()=>assert.throws(()=>ensurePrivate(path.join(link,'state'),{...win,run:()=>{ran=true;return {status:0};}}),/must not contain links/));check(()=>assert.equal(ran,false));
  const open=path.join(fixture,'perm-open');fs.mkdirSync(open,{mode:0o755});fs.chmodSync(open,0o755);reset();check(()=>assert.throws(()=>ensurePrivate(open),/owner-only/));
  const made=path.join(fixture,'perm-made');reset();ensurePrivate(made);check(()=>assert.equal(fs.statSync(made).mode&0o777,0o700));
 }
 reset();
}

async function lockChecks(check,fixture){
 const fresh=name=>{const dir=path.join(fixture,name);fs.mkdirSync(dir,{recursive:true});return dir;};
 const lockPath=dir=>path.join(dir,'playback.lock');
 // Dead owner: the next playback removes the lock, orphaned speech file and stale "speaking" status itself.
 const stale=fresh('lock-stale');const dead=deadPid();
 fs.writeFileSync(lockPath(stale),JSON.stringify({pid:dead,token:token()}));fs.writeFileSync(path.join(stale,'speech-'+'a'.repeat(24)+'.json'),'{}');
 writeObject(path.join(stale,'status.json'),{state:'speaking',chunkIndex:2});
 check(()=>assert.equal(inspectLock(stale).state,'stale'));
 let played=0;await playback(options,{dir:stale,privacy:()=>{},play:async()=>{played++;}});
 check(()=>assert.equal(played,1));check(()=>assert(!fs.existsSync(lockPath(stale))));check(()=>assert(!fs.existsSync(path.join(stale,'speech-'+'a'.repeat(24)+'.json'))));
 check(()=>assert.equal(JSON.parse(fs.readFileSync(path.join(stale,'status.json'),'utf8')).state,'idle'));
 // Live owner in another process: playback refuses, recovery refuses, and the lock is byte-for-byte unchanged.
 const owner=liveOwner();try{
  const live=fresh('lock-live'),content=JSON.stringify({pid:owner.pid,token:token()});fs.writeFileSync(lockPath(live),content);
  fs.writeFileSync(path.join(live,'speech-'+'b'.repeat(24)+'.json'),'{}');
  check(()=>assert.equal(inspectLock(live).state,'live'));
  await assert.rejects(playback(options,{dir:live,privacy:()=>{},play:quickPlay}),/Another playback owns the lock/);
  check(()=>assert.equal(fs.readFileSync(lockPath(live),'utf8'),content));
  check(()=>assert.equal(recoverStale(live),false));check(()=>assert.equal(fs.readFileSync(lockPath(live),'utf8'),content));
  check(()=>assert.throws(()=>recover(live,{privacy:()=>{}}),/owner is alive/));check(()=>assert.equal(fs.readFileSync(lockPath(live),'utf8'),content));
  check(()=>assert(fs.existsSync(path.join(live,'speech-'+'b'.repeat(24)+'.json'))));
  // A waiting request takes over only after the live owner exits.
  const waiting=playback({...options,waitMs:20000},{dir:live,privacy:()=>{},play:quickPlay});await sleep(300);
  check(()=>assert.equal(fs.readFileSync(lockPath(live),'utf8'),content));
  owner.kill();await waiting;check(()=>assert(!fs.existsSync(lockPath(live))));
 }finally{owner.kill();}
 // A lock still being written (empty, just created) is never treated as stale; an old malformed lock needs inspection.
 const writing=fresh('lock-writing');fs.writeFileSync(lockPath(writing),'');
 check(()=>assert.equal(inspectLock(writing).state,'writing'));
 await assert.rejects(playback(options,{dir:writing,privacy:()=>{},play:quickPlay}),/Another playback owns the lock/);check(()=>assert(fs.existsSync(lockPath(writing))));
 const old=new Date(Date.now()-60000);fs.utimesSync(lockPath(writing),old,old);
 check(()=>assert.equal(inspectLock(writing).state,'malformed'));
 await assert.rejects(playback(options,{dir:writing,privacy:()=>{},play:quickPlay}),/manual inspection/);check(()=>assert(fs.existsSync(lockPath(writing))));
 check(()=>assert.throws(()=>recover(writing,{privacy:()=>{}}),/manual inspection/));check(()=>assert(fs.existsSync(lockPath(writing))));
 // Explicit recovery of a dead owner, and a fresh lock taken during recovery is put back, not deleted.
 const manual=fresh('lock-manual');fs.writeFileSync(lockPath(manual),JSON.stringify({pid:dead,token:token()}));writeObject(path.join(manual,'status.json'),{state:'queued'});
 const after=recover(manual,{privacy:()=>{}});check(()=>assert.equal(after.locked,false));check(()=>assert.equal(after.state,'idle'));check(()=>assert.equal(after.recovered,true));
 const raced=fresh('lock-raced'),freshToken=token();fs.writeFileSync(lockPath(raced),JSON.stringify({pid:dead,token:token()}));
 let first=true;const swap=pid=>{if(first){first=false;fs.writeFileSync(lockPath(raced),JSON.stringify({pid:process.pid,token:freshToken}));return false;}return pid===process.pid;};
 check(()=>assert.equal(recoverStale(raced,{isAlive:swap}),false));check(()=>assert.equal(JSON.parse(fs.readFileSync(lockPath(raced),'utf8')).token,freshToken));
 // Two requests racing for one stale lock: exactly one plays, the other is refused, and no lock is left.
 const race=fresh('lock-race');fs.writeFileSync(lockPath(race),JSON.stringify({pid:dead,token:token()}));
 let release;const hold=()=>new Promise(r=>{release=r;});
 const results=await Promise.allSettled([playback(options,{dir:race,privacy:()=>{},play:hold}),(async()=>{await sleep(50);try{return await playback(options,{dir:race,privacy:()=>{},play:quickPlay});}finally{release&&release();}})()]);
 check(()=>assert.equal(results.filter(r=>r.status==='fulfilled').length,1));check(()=>assert.match(String(results.find(r=>r.status==='rejected')?.reason?.message),/Another playback owns the lock/));
 check(()=>assert(!fs.existsSync(lockPath(race))));
}

function tableChecks(check){
 const cases=[
  ['| Name | Value |\n|---|---|\n| speed | 1.0 |\n| **voice** | `Hazel` |','Name: speed, Value: 1.0.\nName: voice, Value: Hazel.'],
  ['Opt | Cost\n:--|--:\nA | $5\nB | |','Opt: A, Cost: $5.\nOpt: B.'],
  ['| Only header | Two |\n|---|---|','Only header, Two.'],
  ['| Cmd | Meaning |\n|---|---|\n| a \\| b | pipe |','Cmd: a | b, Meaning: pipe.'],
  ['Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n---\nAfter rule','Intro\n\na: 1, b: 2.\nAfter rule'],
  ['a | b | c without separator','a | b | c without separator'],
 ];
 for(const [input,expected] of cases)check(()=>assert.equal(applyMode(input),expected,input));
 check(()=>assert(applyMode('```\n| x | y |\n|---|---|\n```','full').includes('|---|')));
 check(()=>assert.equal(applyMode('> Quoted advice.\n> Second line.'),'Quoted advice.\nSecond line.'));
}

function replyChecks(check){
 const replies=JSON.parse(fs.readFileSync(path.join(__dirname,'corpus','replies.json'),'utf8'));check(()=>assert(replies.length>=30));
 for(const reply of replies){
  for(const mode of MODES)check(()=>assert.equal(applyMode(reply.input,mode),reply.expected[mode],reply.name+' / '+mode));
  const spoken=applyMode(reply.input);
  for(const text of reply.mustInclude)check(()=>assert(spoken.includes(text),reply.name+' must include: '+text));
  for(const text of reply.mustExclude)check(()=>assert(!spoken.includes(text),reply.name+' must exclude: '+text));
  for(const [mode,list] of Object.entries(reply.modeInclude||{}))for(const text of list)check(()=>assert(applyMode(reply.input,mode).includes(text),reply.name+' / '+mode+' must include: '+text));
  // Markup that should never be voiced in the default mode.
  check(()=>assert(!/^\s*\|.*\|\s*$|```|~~~|\*\*|\]\(|^#{1,6} |^diff --git|^@@ /m.test(spoken),reply.name+' voices markup'));
 }
 return replies.length;
}

module.exports=async function(check){
 // realpath: macOS temp folders sit under /var, a link to /private/var, which state paths refuse.
 const fixture=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'dom-tts-recovery-')));
 try{await permissionChecks(check,fixture);await lockChecks(check,fixture);tableChecks(check);return {replies:replyChecks(check)};}
 finally{fs.rmSync(fixture,{recursive:true,force:true});}
};
