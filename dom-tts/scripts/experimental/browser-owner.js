// Serialize stale companion takeover; never remove a live owner's lock or kill a PID.
const fs=require('node:fs'),path=require('node:path');
const {readObject,alive}=require('../runtime');
function acquireOwner({dir,token,pid=process.pid,isAlive=alive,onBeforeClaim=()=>{}}={}){
 if(!path.isAbsolute(dir||'')||!Number.isSafeInteger(pid)||pid<1||!/^[a-f0-9]{64}$/.test(token||''))throw Error('invalid-companion-owner');
 const lock=path.join(dir,'browser-session.lock'),recovery=path.join(dir,'browser-session.recovery.lock');
 const read=()=>{if(fs.existsSync(lock)&&(!fs.lstatSync(lock).isFile()||fs.lstatSync(lock).isSymbolicLink()))throw Error('companion-lock-inspection-required');return readObject(lock,null);};
 let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}catch(error){
  if(error.code!=='EEXIST')throw error;
  let guard;try{guard=fs.openSync(recovery,'wx',0o600);}catch{throw Error('companion-recovery-busy-or-inspection-required');}
  try{
   const old=read();if(!old||!Number.isSafeInteger(old.pid)||old.pid<1||!/^[a-f0-9]{64}$/.test(old.token||'')||isAlive(old.pid))throw Error('companion-owner-live-or-inspection-required');
   onBeforeClaim(); // Fixture-only competing starter; no production callback supplied.
   const current=read();if(!current||current.pid!==old.pid||current.token!==old.token||isAlive(current.pid))throw Error('companion-owner-changed');
   fs.unlinkSync(lock);fd=fs.openSync(lock,'wx',0o600);
  }finally{fs.closeSync(guard);fs.unlinkSync(recovery);}
 }
 try{fs.writeFileSync(fd,JSON.stringify({pid,token}));}finally{fs.closeSync(fd);}
 return {release(){const current=read();if(current?.pid===pid&&current.token===token)fs.unlinkSync(lock);}};
}
module.exports={acquireOwner};
