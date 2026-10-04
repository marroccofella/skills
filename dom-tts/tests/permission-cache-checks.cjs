// Regression checks for the Windows permission check: no marker file or in-process memory may stand in
// for a current ACL check. Uses an injected PowerShell result so it runs offline on every platform; the
// native ACL change on a real folder is covered by tests/windows-privacy.cjs on Windows.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {ensurePrivate}=require('../scripts/runtime');
const win={platform:'win32'};
function helper(status){const calls={n:0};return {calls,run:()=>{calls.n++;return status===0?{status:0}:{status:3,stderr:'DOM_TTS_NOT_PRIVATE'};}};}
// The marker format written by 0.4.0-dev.2 and 0.5.0-dev.1: public folder metadata anyone with write access can compute.
function forgeMarker(dir){const stat=fs.lstatSync(dir);fs.writeFileSync(path.join(dir,'.private-verified'),JSON.stringify({schema:'dom-tts-private/1',ino:String(stat.ino),birthtimeMs:Math.trunc(stat.birthtimeMs)}));}

module.exports=function(check){
 const fixture=fs.realpathSync(fs.mkdtempSync(path.join(process.platform==='win32'?os.tmpdir():'/tmp','dtp-')));
 try{
  // 1. Same folder, same process: permissions change after a successful check; the marker is untouched.
  const same=path.join(fixture,'same');fs.mkdirSync(same);
  const allow=helper(0),deny=helper(3);
  ensurePrivate(same,{...win,run:allow.run});
  check(()=>assert.throws(()=>ensurePrivate(same,{...win,run:deny.run}),/grants access to other accounts/,'same-process ACL change was not rechecked'));
  check(()=>assert.equal(deny.calls.n,1,'same-process ACL change: permission helper was skipped'));
  // 2. Replacement at an already-checked path, with a marker matching the replacement folder.
  const replaced=path.join(fixture,'replaced');fs.mkdirSync(replaced);
  const first=helper(0),second=helper(3);
  ensurePrivate(replaced,{...win,run:first.run});
  fs.rmSync(replaced,{recursive:true,force:true});fs.mkdirSync(replaced);forgeMarker(replaced);
  check(()=>assert.throws(()=>ensurePrivate(replaced,{...win,run:second.run}),/grants access to other accounts/,'replaced folder at a checked path was not rechecked'));
  check(()=>assert.equal(second.calls.n,1,'replaced folder: permission helper was skipped'));
  // 3. Forged marker, fresh process.
  const forged=path.join(fixture,'forged');fs.mkdirSync(forged);forgeMarker(forged);
  const probe="const r=require("+JSON.stringify(path.join(__dirname,'..','scripts','runtime'))+");let n=0;let threw=false;try{r.ensurePrivate("+JSON.stringify(forged)+",{platform:'win32',run:()=>{n++;return {status:3,stderr:'DOM_TTS_NOT_PRIVATE'};}});}catch(e){threw=/grants access/.test(e.message);}console.log(JSON.stringify({threw,calls:n}));";
  const child=spawnSync(process.execPath,['-e',probe],{encoding:'utf8',timeout:20000});
  check(()=>assert.equal(child.status,0,child.stderr));
  check(()=>assert.deepEqual(JSON.parse(child.stdout),{threw:true,calls:1},'forged marker in a fresh process skipped the check'));
  // Every call runs the check: three calls on one folder, three helper calls.
  const every=path.join(fixture,'every');fs.mkdirSync(every);const counted=helper(0);
  for(let i=0;i<3;i++)ensurePrivate(every,{...win,run:counted.run});
  check(()=>assert.equal(counted.calls.n,3,'repeat calls skipped the permission helper'));
 }finally{fs.rmSync(fixture,{recursive:true,force:true});}
};
