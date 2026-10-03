// Playback lock inspection and dead-owner recovery shared by speak.js and status.js.
// A lock is removed only when it is well formed and its recorded owner is no longer running.
// A live owner, or a lock still being written, is never removed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readObject,writeObject,alive}=require('./runtime');
const WRITE_GRACE_MS=2000;
function lockFile(dir){return path.join(dir,'playback.lock');}
function inspectLock(dir,{now=Date.now(),isAlive=alive}={}){
 const file=lockFile(dir);let stat;try{stat=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return {state:'free'};throw e;}
 if(!stat.isFile())return {state:'malformed'};
 const lock=readObject(file);
 if(!Number.isSafeInteger(lock.pid)||lock.pid<1||!/^[a-f0-9]{32}$/.test(String(lock.token)))return {state:now-stat.mtimeMs<WRITE_GRACE_MS?'writing':'malformed'};
 return {state:isAlive(lock.pid)?'live':'stale',pid:lock.pid,token:lock.token};
}
function removeOrphans(dir){for(const name of fs.readdirSync(dir))if(/^speech-[a-f0-9]{24}\.json$/.test(name))try{fs.unlinkSync(path.join(dir,name));}catch{}}
function resetStatus(dir){const file=path.join(dir,'status.json'),status=readObject(file,null);if(status&&['queued','speaking'].includes(status.state))writeObject(file,{...status,state:'idle',chunkIndex:undefined,recovered:true,updatedAt:new Date().toISOString()});}
// Returns true when a dead owner's lock was removed. The lock is first moved aside and re-read,
// so a fresh lock taken by another process in the meantime is put back rather than deleted.
function recoverStale(dir,options={}){
 const seen=inspectLock(dir,options);if(seen.state!=='stale')return false;
 const file=lockFile(dir),aside=file+'.'+crypto.randomBytes(8).toString('hex')+'.stale';
 try{fs.renameSync(file,aside);}catch(e){if(e.code==='ENOENT')return false;throw e;}
 const moved=readObject(aside);
 if(moved.token!==seen.token){try{fs.linkSync(aside,file);}catch{}try{fs.unlinkSync(aside);}catch{}return false;}
 fs.unlinkSync(aside);if(inspectLock(dir,options).state==='free'){removeOrphans(dir);resetStatus(dir);}return true;
}
module.exports={inspectLock,recoverStale,removeOrphans,resetStatus,WRITE_GRACE_MS};
