#!/usr/bin/env node
// Use only from a separately trusted copy, together with bootstrap.mjs.
// No candidate module imports. Release installer executes only after verification.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execute, readiness, publishedRelease, verifyObjects, verifyCheckout, assertPreparedRepository, GUIDE } from './bootstrap.mjs';
const fail = (code, message) => Object.assign(Error(message), { code });
const inside = (file, root) => { const rel=path.relative(root,file);return !rel || (!rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel)); };
function entry(file) { try { const s=fs.lstatSync(file);return { type:s.isSymbolicLink()?'link':s.isDirectory()?'directory':'other', dev:s.dev, ino:s.ino, link:s.isSymbolicLink()?fs.readlinkSync(file):null }; } catch(e){if(e.code==='ENOENT')return null;throw e;} }
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
// Node's JS resolver can retain Windows 8.3 spellings while Git expands them.
// Compare one physical spelling without changing the identity of the entry.
const physicalPath = file => (process.platform==='win32'?fs.realpathSync.native:fs.realpathSync)(file);
function canonicalEntry(file) { if(!file || !path.isAbsolute(file))throw fail('absolute_path_required','Use explicit absolute paths');return path.join(physicalPath(path.dirname(file)),path.basename(file)); }
function paths(options) {
  if(['prepared','skillPath','backup'].some(k=>typeof options[k]!=='string'||!path.isAbsolute(options[k])))throw fail('arguments_required','Specify --prepared, --skill-path and --backup as explicit absolute paths');
  const skill=canonicalEntry(options.skillPath),backup=canonicalEntry(options.backup),repo=physicalPath(options.prepared);
  if(path.basename(skill)!=='momm' || path.dirname(skill)===skill)throw fail('unsupported_scope','Specify the exact existing momm discovery entry; aliases require inspection');
  if(inside(backup,path.dirname(skill)) || inside(backup,repo) || inside(repo,skill) || inside(skill,repo))throw fail('unsafe_backup','Backup must be outside the discovery directory and both installations');
  if(!entry(skill))throw fail('unsupported_scope','Existing MOMM discovery entry is missing; no path was guessed');
  let oldRoot;try{oldRoot=physicalPath(skill);}catch{throw fail('unsupported_scope','Existing MOMM link is broken or inaccessible; inspect it before migrating');}
  if(inside(backup,oldRoot)||oldRoot===path.join(repo,'momm'))throw fail('unsafe_backup','Do not back up into the old installation or migrate an already linked release');
  return {skill,backup,repo,journal:backup+'.momm-migration.json',lock:path.join(path.dirname(skill),'.momm-migration.lock')};
}
function readRegular(file) {
  const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink>1||s.size>1024*1024)throw fail('unsafe_state','State must be a bounded regular file');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function save(file,value,first=false) {
  const bytes=JSON.stringify(value,null,2)+'\n';
  if(first){fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});return;}
  readRegular(file);const temp=file+'.'+randomUUID()+'.tmp';
  fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});
  try{fs.renameSync(temp,file);}finally{if(entry(temp))fs.unlinkSync(temp);}
}
function releaseLock(p) {
  if(entry(p.lock) && readRegular(p.lock).journal===p.journal)fs.unlinkSync(p.lock);
}
export function rollback(journalPath) {
  const journal=canonicalEntry(journalPath),state=readRegular(journal);
  if(state.schema!=='momm-migration/1'||!state.paths||!state.old)throw fail('invalid_journal','Unknown migration journal');
  const p=state.paths;
  if(journal!==p.journal || canonicalEntry(p.skill)!==p.skill || canonicalEntry(p.backup)!==p.backup || p.journal!==p.backup+'.momm-migration.json' || p.lock!==path.join(path.dirname(p.skill),'.momm-migration.lock') || path.basename(p.skill)!=='momm' || inside(p.backup,path.dirname(p.skill)))throw fail('invalid_journal','Unsafe migration paths');
  const recovery={...p,lock:p.lock+'.recovery'};let ownClaim=false;
  try {save(recovery.lock,{journal,pid:process.pid},true);}catch{throw fail('recovery_conflict','Another recovery claim exists; preserve it and inspect its owner before retrying');}
  try {
  if(entry(p.lock)) {
    const claim=readRegular(p.lock);
    if(claim.journal!==journal)throw fail('migration_conflict','Another migration owns the discovery entry');
    if(claim.pid!==process.pid){let alive=true;try{process.kill(claim.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw fail('migration_active','Could not establish that the lock owner is dead. Recovery stopped without removing its lock; inspect the owner first.');}if(alive)throw fail('migration_active','Lock owner may still be running. Inspect the owner before recovery; do not delete the lock to force progress.');}
  } else save(p.lock,{journal,pid:process.pid},true);
  ownClaim=true;
  if(!entry(p.backup) && same(entry(p.skill),state.old)) { releaseLock(p);return {status:'original_preserved',installed:false}; }
  if(!same(entry(p.backup),state.old))throw fail('backup_changed','Backup changed or is missing; nothing was overwritten');
  const current=entry(p.skill);
  if(current) {
    if(current.type!=='link'||path.resolve(path.dirname(p.skill),current.link)!==path.join(p.repo,'momm'))throw fail('discovery_changed','Discovery entry is no longer the new link; preserve it and inspect manually');
    fs.unlinkSync(p.skill); // Known new symlink/junction only, never its target.
  }
  fs.renameSync(p.backup,p.skill);state.phase='rolled_back';save(journal,state);releaseLock(p);
  return {status:'rolled_back',restored:p.skill,installed:false,new_clone_retained:p.repo,
    note:'Old discovery restored. The prepared clone and any newly written receipt are retained for diagnosis, not claimed active.'};
  } finally { if(ownClaim)releaseLock(p);releaseLock(recovery); }
}
export async function migrate(options,{run=execute,check=readiness,releaseRecord=publishedRelease,verify=verifyObjects,checkout=verifyCheckout}={}) {
  const p=paths(options),old=entry(p.skill);
  if(!old||!['link','directory'].includes(old.type))throw fail('unsupported_scope','Existing MOMM must be a directory or discovery link');
  let oldProtocol;
  try{const file=path.join(p.skill,'SKILL.md'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('unsafe protocol');oldProtocol=fs.readFileSync(file,'utf8');}
  catch{throw fail('unsupported_scope','Existing MOMM protocol is missing, unreadable or not a bounded regular file; inspect the old installation before migrating');}
  if(check({run,cwd:p.repo,inspected:p.repo}).status!=='ready_to_verify')throw fail('prerequisites_missing','Install the required verifier only with approval, then retry');
  assertPreparedRepository(p.repo,run);
  if(entry(p.lock)) {const claim=readRegular(p.lock);if(claim.journal===p.journal&&!entry(p.journal))throw fail('orphan_lock_no_journal','A migration claim exists without a journal. Nothing is assumed restored: preserve the claim and inspect its owner and discovery entry; a rollback command cannot recover an absent journal.');}
  if(entry(p.backup)||entry(p.journal)||entry(p.lock))throw fail('migration_conflict','A backup, journal or migration lock already exists. Inspect it; use its rollback command rather than overwrite it');
  if(!/^\d+\.\d+\.\d+$/.test(options.version||''))throw fail('invalid_version','Specify the exact published release version');
  const published=await releaseRecord(options.version);
  if(published.tag_name!==`momm-${options.version}`||published.draft!==false||published.prerelease!==false)throw fail('release_not_stable','Only a published stable release is eligible');
  const proof=verify(p.repo,options.version,run);checkout(p.repo,proof.commit,run);
  // This command is for a newly prepared clone, not an alternate updater.
  const admin=run('git',['rev-parse','--git-path','momm'],p.repo).trim();
  if(entry(path.resolve(p.repo,admin,'momm.lock')))throw fail('receipt_exists','Prepared clone already has an installation receipt; use its normal updater or inspect before migration');
  const newProtocol=fs.readFileSync(path.join(p.repo,'momm/SKILL.md'),'utf8');
  const plan={status:'migration_preview',version:options.version,paths:p,proof,old_entry:old,protocol_changed:oldProtocol!==newProtocol,
    old_protocol:oldProtocol,new_protocol:newProtocol,installed:false,
    private_ledgers:'No ledger copying or merging. Project ledgers remain where they are; anything inside the old directory moves intact with its backup. A symlink target is never moved.',
    rollback_command:`node <trusted-migrate-legacy.mjs> --rollback "${p.journal}"`,guide:GUIDE};
  plan.plan_sha256=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  if(!options.apply)return plan;
  if(plan.protocol_changed&&!options.acceptProtocol)throw fail('protocol_acceptance_required','Read the complete old/new protocol and explicitly pass --accept-protocol after approval');
  if(options.planSha256!==plan.plan_sha256)throw fail('preview_changed','Supply --plan-sha256 from the approved preview. The source, protocol, scope or original entry may have changed; preview and approve again.');
  save(p.lock,{journal:p.journal,pid:process.pid},true);
  let journalWritten=false;
  try {
    if(!same(entry(p.skill),old)||entry(p.backup))throw fail('discovery_changed','Discovery entry changed since preview');
    const state={schema:'momm-migration/1',phase:'prepared',paths:p,old,proof,version:options.version};
    save(p.journal,state,true);journalWritten=true;
    fs.renameSync(p.skill,p.backup); // Same-volume atomic move; EXDEV fails, never copies/deletes.
    state.phase='backed_up';save(p.journal,state);
    checkout(p.repo,proof.commit,run); // Recheck signed bytes immediately before execution.
    const output=JSON.parse(run(process.execPath,[path.join(p.repo,'momm/scripts/install.mjs'),'--custom-dir',path.dirname(p.skill)],p.repo,{timeout:120000}));
    const linked=entry(p.skill);
    const lockPath=path.resolve(p.repo,admin,'momm.lock');
    if(linked?.type!=='link'||physicalPath(p.skill)!==physicalPath(path.join(p.repo,'momm'))||output.installation?.lock!==lockPath)throw fail('installation_incomplete','Link or installation receipt did not verify');
    const receipt=readRegular(lockPath);
    if(receipt.schema!=='momm-lock/1'||receipt.current?.commit!==proof.commit||receipt.current?.version!==options.version||!receipt.installations?.some(i=>i.target==='custom'&&i.custom_dir===path.dirname(p.skill)&&i.skills?.length===1&&i.skills[0]==='momm'))throw fail('installation_incomplete','Saved installation scope differs from the approved MOMM-only destination');
    state.phase='installed';save(p.journal,state);releaseLock(p);
    return {...plan,status:'migration_installed',installed:true,receipt:output.installation,old_protocol:undefined,new_protocol:undefined};
  } catch(error) {
    if(journalWritten){try{error.recovery=rollback(p.journal);}catch(recovery){error.recovery={status:'manual_recovery_required',journal:p.journal,error:recovery.message};}}
    else releaseLock(p);
    throw error;
  }
}
export function parse(args) {
  const o={};for(let i=0;i<args.length;i++){
    const a=args[i];if(a==='--apply')o.apply=true;else if(a==='--accept-protocol')o.acceptProtocol=true;else if(a==='--help')o.help=true;
    else if(['--prepared','--skill-path','--backup','--version','--rollback','--plan-sha256'].includes(a)){const v=args[++i];if(!v||v.startsWith('--'))throw fail('invalid_arguments','Missing '+a);o[{'--skill-path':'skillPath','--plan-sha256':'planSha256'}[a]||a.slice(2)]=v;}
    else throw fail('invalid_arguments','Unknown option; no force, automatic update or deletion flag exists');
  }
  if(o.rollback&&Object.keys(o).some(k=>k!=='rollback'))throw fail('invalid_arguments','Rollback is a separate explicit action');
  return o;
}
function entrypoint(){try{return process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url));}catch{return false;}}
if(entrypoint()){
  try{
    const o=parse(process.argv.slice(2));
    if(o.help)console.log('Separately trust this helper AND bootstrap.mjs. Default: verified preview only.\n--prepared <verified-clone> --version x.y.z --skill-path <absolute-existing-momm> --backup <absolute-new-path-outside-discovery> [--apply --plan-sha256 <approved-preview-hash> --accept-protocol]\nRecovery: --rollback <absolute-journal>. Preview/apply contact GitHub and Sigstore; no model calls. Project ledgers are never copied.');
    else {if(!o.rollback)console.error('Network: GitHub release metadata and Sigstore verification. No installation changes unless --apply is explicitly supplied.');console.log(JSON.stringify(o.rollback?rollback(o.rollback):await migrate(o),null,2));}
  }catch(error){console.error(JSON.stringify({status:error.code||'migration_failed',cause_code:error.cause_code,error:String(error.message).slice(0,1500),recovery:error.recovery,installed:false}));process.exitCode=1;}
}
