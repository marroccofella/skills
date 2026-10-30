// Development primitive: complete bytes before exclusive publication. Trusted
// governor calls only; this is not a sandbox or a permission/remote-release grant.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {requirePrivateEvidence} from './evidence-permissions.mjs';
const MAX_BYTES=4_000_000;
const regular=stat=>stat.isFile()&&!stat.isSymbolicLink();
// Win32 dev can vary across aliases; a meaningful positive file index is still
// required. A zero/unusable index never proves ownership, even with equal bytes.
const same=(a,b)=>a.ino>0n&&b.ino>0n&&a.ino===b.ino&&(process.platform==='win32'||a.dev===b.dev);
function unresolved(cause,published,publicationAttempted,temporaryRetained,closeUncertain=false){
 const error=Error('Immutable publication outcome requires reconciliation; do not resend or replace original evidence.',{cause});
 error.code='MOMM_IMMUTABLE_RECONCILIATION';
 error.publication_state=published?'published_unsettled':publicationAttempted?'outcome_unknown':'not_published';
 error.published=published?true:publicationAttempted?null:false;
 error.temporary_retained=temporaryRetained;error.resend_authorized=false;error.completion=false;
 error.descriptor_close_uncertain=closeUncertain;
 // Fixed metadata only: no private path or raw cause in public status fields.
 return error;
}
function owned(file,identity,links){
 const stat=fs.lstatSync(file,{bigint:true});
 if(!regular(stat)||!same(stat,identity)||stat.nlink!==BigInt(links))throw Error('Immutable publication identity changed; quarantine the original operation.');
 return stat;
}
export function publishImmutableBytes(root,file,bytes){
 if(typeof root!=='string'||typeof file!=='string'||!path.isAbsolute(root)||!path.isAbsolute(file)||path.dirname(file)!==root||!Buffer.isBuffer(bytes)||bytes.length>MAX_BYTES||!/^[A-Za-z0-9_.-]{1,180}$/.test(path.basename(file))||/\.tmp$/i.test(path.basename(file)))throw Error('Invalid bounded immutable publication.');
 // No ACL repair. An existing ambiguous linked store remains refused.
 requirePrivateEvidence(root);
 if(fs.realpathSync.native(root)!==root)throw Error('Immutable root must use its real private path.');
 // The Windows DACL audit does not count file links. Inspect this flat store
 // explicitly on every platform and refuse any unresolved temporary; do not
 // delete a prior operation's alias or assume it could not have published.
 const names=fs.readdirSync(root);if(names.length>10000)throw Error('Immutable store inspection budget exceeded.');
 for(const name of names){const stat=fs.lstatSync(path.join(root,name),{bigint:true});if(!regular(stat)||stat.nlink!==1n||/\.tmp$/i.test(name))throw Error('Immutable store has unresolved temporary or linked evidence; quarantine retained.');}
 // Refuse an already observed final name before attempting publication. This
 // does not narrow an EEXIST thrown by link: a raced or post-commit link fault
 // stays unknown. Neither outcome authorizes resend or replacing evidence.
 let existing=false;try{fs.lstatSync(file,{bigint:true});existing=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(existing)throw unresolved(Error('Original immutable final name already exists.'),false,false,false);
 const captured=Buffer.from(bytes),temporary=file+'.'+crypto.randomUUID()+'.tmp';
 let fd=null,identity=null,published=false,publicationAttempted=false,closeUncertain=false;
 // A close can throw after closing the descriptor. Never close that number a
 // second time; it might have been reused. Preserve the temporary and report
 // uncertainty rather than claiming cleanup or deleting a possibly open file.
 const closeFile=()=>{const closing=fd;fd=null;try{fs.closeSync(closing);}catch(error){closeUncertain=true;throw error;}};
 try{
  fd=fs.openSync(temporary,'wx',0o600);identity=fs.fstatSync(fd,{bigint:true});
  if(!regular(identity)||identity.nlink!==1n||identity.ino<=0n)throw Error('Immutable temporary identity refused.');
  fs.writeFileSync(fd,captured);
  const written=fs.fstatSync(fd,{bigint:true});
  if(!same(written,identity)||written.nlink!==1n||written.size!==BigInt(captured.length))throw Error('Immutable temporary write is incomplete.');
  fs.fsyncSync(fd);closeFile();
  owned(temporary,identity,1);
  if(!fs.readFileSync(temporary).equals(captured))throw Error('Immutable temporary bytes changed.');
  owned(temporary,identity,1);
  // A same-directory hard link is an exclusive, complete-name publication:
  // EEXIST never replaces prior evidence. No partial final-name copying.
  publicationAttempted=true;fs.linkSync(temporary,file);published=true;
  owned(file,identity,2);owned(temporary,identity,2);
  fs.unlinkSync(temporary);
  owned(file,identity,1);
  // POSIX directory fsync is required before reporting success there. Windows
  // has no qualified directory-flush primitive here: success means complete
  // exclusive visibility plus file fsync, NOT a power-loss durability guarantee.
  if(process.platform!=='win32'){
   const directory=fs.openSync(root,'r');
   try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  }
  return {published:true,exclusive:true,bytes:captured.length,directory_durability:process.platform==='win32'?'unqualified':'directory_fsync_completed',completion:false};
 }catch(error){
  // Never delete a published final name. A failed alias cleanup or post-link
  // identity check leaves the original names for explicit bounded quarantine.
  // Before publication, remove only this operation's identity-checked temporary.
  if(fd!==null){try{closeFile();}catch{/* Primary fault remains the private cause; close uncertainty stays explicit. */}}
  if(!published&&!closeUncertain&&identity&&fs.existsSync(temporary)){
   try{owned(temporary,identity,1);fs.unlinkSync(temporary);}catch{throw unresolved(error,published,publicationAttempted,true,closeUncertain);}
  }
  throw unresolved(error,published,publicationAttempted,fs.existsSync(temporary),closeUncertain);
 }
}
