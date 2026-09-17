// Deterministic schedules against actual lock functions; no real user locks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const cases=[
 ['capabilities.mjs','function withOverlayLock(','\n// Records one probe result.','withOverlayLock','overlay'],
 ['guidance.mjs','function withTrustLock(','\nconst fileHash','withTrustLock','trust'],
 ['setup-ui.mjs','function acquireGuidanceLock(','\n// `beforeCommit`','acquireGuidanceLock','editor'],
 ['modality.mjs','async function acquireHarvestLock(','\nasync function acquireHarvestLocks','acquireHarvestLock','harvest'],
];
const results=[];
for(const [file,start,end,name,kind] of cases)for(const record of ['111\n','','malformed\n',null,'disappearing']){
 const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');
 const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);
 let text=record,deleted=0,entered=false,clock=100000,reads=0;
 const fake={mkdirSync(){},writeFileSync(_p,v){if(text!==null){const e=Error('exists');e.code='EEXIST';throw e;}text=v;},readFileSync(){
   if(record==='disappearing'){clock+=100;if(++reads>40)throw Error('UNBOUNDED_RETRY');const e=Error('vanished');e.code='ENOENT';throw e;}return text;
 },statSync(){return{ino:1,mtimeMs:0};},unlinkSync(){// A new owner can replace the old record after the last observation.
   text='222\n';deleted++;text=null;
 }};
 const context=vm.createContext({fs:fake,path,crypto,randomBytes:crypto.randomBytes,process:{pid:333,platform:process.platform,env:{}},Number,Promise,Map,Date:{now:()=>clock+=100},
  TRANSIENT:new Set(['EEXIST']),pidAlive:()=>false,sleepMs(){},sleep:async()=>{},LOCK_STALE_MS:1,GUIDANCE_LOCK_STALE_MS:1,
  trustStorePath:()=> 'synthetic-trust',sha256:()=> 'a'.repeat(64),inProcessTurns:new Map(),fail:(m,c)=>Object.assign(Error(m),{code:c})});
 vm.runInContext(source.slice(a,b)+`;this.invoke=${name};`,context);
 try {
  if(kind==='editor'){const release=context.invoke('synthetic');if(release){entered=true;release();}}
  else if(kind==='harvest'){const release=await context.invoke('synthetic','pattern',2000);entered=true;release();}
  else context.invoke('synthetic',2000,()=>{entered=true;});
 }catch(error){assert.match(error.message,/lock|busy|held|recovery/i);}
 const passed=(record===null ? entered&&deleted===1&&text===null : !entered&&deleted===0&&text===record)&&reads<=40;
 results.push({kind,record:record===null?'free':record.trim()||'unpublished',passed,entered,deleted});
}
console.log(JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
process.exitCode=results.every(r=>r.passed)?0:1;
