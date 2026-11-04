const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {ROOT,parseCli,ensurePrivate,readObject,writeObject,alive}=require('./runtime');
const {verify}=require('./package');
function destination(args){if(args.dir){if(!path.isAbsolute(args.dir))throw Error('--dir must be an absolute skill-parent directory');return path.join(args.dir,'dom-tts');}const parents={codex:path.join(os.homedir(),'.agents','skills'),claude:path.join(os.homedir(),'.claude','skills')};if(!parents[args.target])throw Error('Choose --target codex, --target claude or --dir <documented skill parent>');return path.join(parents[args.target],'dom-tts');}
function noLinks(file){for(let part=path.resolve(file);;part=path.dirname(part)){if(fs.existsSync(part)&&fs.lstatSync(part).isSymbolicLink())throw Error('Install paths must not contain links');if(path.dirname(part)===part)break;}}
function managed(dir){noLinks(dir);const stat=fs.lstatSync(dir);if(!stat.isDirectory())throw Error('Existing install is not a managed directory');const marker=readObject(path.join(dir,'.dom-tts-install.json'));if(marker.schema!=='dom-tts-install/1')throw Error('Existing directory is not a managed Dom TTS install');return marker;}
function layout(dest){const parent=path.dirname(dest);noLinks(parent);const backups=path.join(parent,'.dom-tts-backups');return {parent,backups,lock:path.join(backups,'install.lock'),journal:path.join(backups,'install-journal.json'),recoveryLock:path.join(backups,'recovery.lock')};}
// Flush the transaction before moving directories. Directory fsync is not
// portable on Windows; recovery checks actual directories rather than phase alone.
function durable(file,value){writeObject(file,value);const fd=fs.openSync(file,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function safeStage(stage,parent){noLinks(stage);if(path.dirname(path.resolve(stage))!==path.resolve(parent)||!/^\.dom-tts-stage-[a-f0-9]{32}$/.test(path.basename(stage)))throw Error('Unexpected stage path');}
function cleanStage(stage,parent){if(!fs.existsSync(stage))return;safeStage(stage,parent);fs.rmSync(stage,{recursive:true,force:true});}
function pathsInJournal(journal,dest,areas,token){if(journal.schema!=='dom-tts-install-journal/1'||journal.token!==token||journal.destination!==dest||!['install','rollback','uninstall'].includes(journal.action)||typeof journal.backup!=='string'||path.dirname(journal.backup)!==areas.backups||path.basename(journal.backup)!=='dom-tts-'+token)throw Error('Interrupted installation journal needs manual inspection');noLinks(journal.backup);if(journal.stage!==null){safeStage(journal.stage,areas.parent);if(path.basename(journal.stage)!=='.dom-tts-stage-'+token)throw Error('Interrupted staging journal needs inspection');}}
function recoveryPlan(dest,areas,lock){const journal=readObject(areas.journal,null);if(!journal){if(fs.existsSync(areas.journal))throw Error('Interrupted journal needs manual inspection');return {state:'abandoned-lock',lock,journal:null};}pathsInJournal(journal,dest,areas,lock.token);const exists=fs.existsSync(dest),backupExists=fs.existsSync(journal.backup);let state;
 if(exists){const marker=managed(dest);if(marker.transaction===lock.token){verify(dest);state='committed';}else if(!backupExists)state='unchanged';else throw Error('Both destination and interrupted backup need inspection; nothing was replaced');}
 else if(backupExists){managed(journal.backup);state=journal.action==='uninstall'&&journal.phase==='committed'?'committed':'restore-backup';}
 else if(journal.action==='install'&&!journal.hadDestination)state='unchanged';
 else throw Error('Interrupted installation directories need inspection; nothing was replaced');
 return {state,lock,journal};}
function recover(args){const dest=destination(args),areas=layout(dest);if(!fs.existsSync(areas.backups))return {action:'recover',state:'nothing-to-recover',destination:dest};if(!args.dryRun)ensurePrivate(areas.backups);const lock=readObject(areas.lock,null);if(!lock){if(fs.existsSync(areas.lock)||fs.existsSync(areas.journal))throw Error('Interrupted lock or journal needs manual inspection');return {action:'recover',state:'nothing-to-recover',destination:dest};}if(lock.schema!=='dom-tts-install-lock/1'||!Number.isSafeInteger(lock.pid)||lock.pid<1||!/^[a-f0-9]{32}$/.test(lock.token||''))throw Error('Interrupted lock needs manual inspection');if(alive(lock.pid))throw Error('Installer owner is still alive; recovery will not terminate or alter it');
 const plan=recoveryPlan(dest,areas,lock);if(args.dryRun)return {action:'recover',state:plan.state,destination:dest,preview:true};const guard=crypto.randomBytes(16).toString('hex');let fd;try{fd=fs.openSync(areas.recoveryLock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Another recovery or interrupted recovery needs inspection');throw e;}
 try{fs.writeFileSync(fd,JSON.stringify({token:guard,pid:process.pid}));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  const current=readObject(areas.lock,null);if(!current||current.token!==lock.token||alive(current.pid))throw Error('Installer ownership changed; recovery refused');const latest=recoveryPlan(dest,areas,current),journal=latest.journal;
  if(latest.state==='restore-backup')fs.renameSync(journal.backup,dest);
  // Retain an interrupted stage privately for inspection; do not silently delete it.
  let retainedStage;if(journal?.stage&&fs.existsSync(journal.stage)){safeStage(journal.stage,areas.parent);retainedStage=path.join(areas.backups,'interrupted-stage-'+lock.token);if(fs.existsSync(retainedStage))throw Error('Retained staging snapshot already exists');fs.renameSync(journal.stage,retainedStage);}
  if(journal)fs.unlinkSync(areas.journal);if(readObject(areas.lock,{}).token!==lock.token)throw Error('Installer ownership changed');fs.unlinkSync(areas.lock);
  return {action:'recover',state:latest.state==='restore-backup'?'restored-backup':latest.state,destination:dest,retainedStage,preserve:'No PID was terminated; runtime state and unrelated skills are unchanged'};
 }finally{if(fd!==undefined)fs.closeSync(fd);if(readObject(areas.recoveryLock,{}).token===guard)fs.unlinkSync(areas.recoveryLock);}}
function performInstall(args,{sourceRoot=ROOT,token,areas}={}){
 const dest=destination(args),action=args.action||'install';if(!['install','uninstall','rollback'].includes(action))throw Error('Unknown install action');noLinks(dest);const exists=fs.existsSync(dest),marker=exists?managed(dest):null;if((action==='uninstall'||action==='rollback')&&!exists)throw Error('No managed install at destination');
 let sourceDir=sourceRoot;if(action==='rollback'){const prior=marker.backup;if(!prior||path.dirname(prior)!==layout(dest).backups||!fs.existsSync(prior))throw Error('No retained upgrade snapshot');managed(prior);sourceDir=prior;}
 const source=action==='uninstall'?null:verify(sourceDir),plan={action,destination:dest,version:source?.version,preserve:'Runtime state and unrelated skills are never removed'};if(args.dryRun)return plan;
 const backup=path.join(areas.backups,'dom-tts-'+token),stage=action==='uninstall'?null:path.join(areas.parent,'.dom-tts-stage-'+token);if(fs.existsSync(backup)||stage&&fs.existsSync(stage))throw Error('Transaction path already exists');
 const journal={schema:'dom-tts-install-journal/1',token,action,destination:dest,backup,stage,hadDestination:exists,phase:'preparing'};durable(areas.journal,journal);
 try{
  if(stage){ensurePrivate(stage);for(const item of source.files){const target=path.join(stage,item.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(sourceDir,item.path),target);}fs.copyFileSync(path.join(sourceDir,'manifest.json'),path.join(stage,'manifest.json'));verify(stage);
   // A rollback keeps its snapshot settings; an upgrade preserves current settings.
   const settingsSource=action==='rollback'?sourceDir:dest;if(fs.existsSync(path.join(settingsSource,'assets','settings.json'))){const settings=readObject(path.join(settingsSource,'assets','settings.json'),null);if(settings===null)throw Error('Existing settings need inspection before upgrade');writeObject(path.join(stage,'assets','settings.json'),settings);}
   writeObject(path.join(stage,'.dom-tts-install.json'),{schema:'dom-tts-install/1',version:source.version,backup:exists?backup:null,transaction:token});
  }
  journal.phase='ready';durable(areas.journal,journal);if(exists)fs.renameSync(dest,backup);if(stage)fs.renameSync(stage,dest);journal.phase='committed';durable(areas.journal,journal);fs.unlinkSync(areas.journal);
  return {...plan,backup:exists?backup:undefined};
 }catch(error){
  // If compensation also fails, retain both journal and lock for explicit recovery.
  if(!fs.existsSync(dest)&&fs.existsSync(backup))fs.renameSync(backup,dest);
  const stable=!exists?!fs.existsSync(dest):fs.existsSync(dest)&&managed(dest).transaction!==token;
  if(stable){if(stage)cleanStage(stage,areas.parent);fs.unlinkSync(areas.journal);}throw error;
 }
}
function install(args,options={}){if(args.action==='recover')return recover(args);if(args.dryRun)return performInstall(args,options);const dest=destination(args);noLinks(dest);if(fs.existsSync(dest))managed(dest);const areas=layout(dest);fs.mkdirSync(areas.parent,{recursive:true});ensurePrivate(areas.backups);if(fs.existsSync(areas.journal))throw Error('Installation is busy or an interrupted operation needs inspection; run --action recover after its owner exits');const token=crypto.randomBytes(16).toString('hex');let fd;
 try{fd=fs.openSync(areas.lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Installation is busy or an interrupted operation needs inspection; no files were replaced.');throw e;}
 try{fs.writeFileSync(fd,JSON.stringify({schema:'dom-tts-install-lock/1',pid:process.pid,token}));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;return performInstall(args,{...options,token,areas});}
 finally{if(fd!==undefined)fs.closeSync(fd);if(!fs.existsSync(areas.journal)&&readObject(areas.lock,{}).token===token)fs.unlinkSync(areas.lock);}}
if(require.main===module){try{console.log(JSON.stringify(install(parseCli(process.argv.slice(2),{},['target','dir','action','dryRun'])),null,2));}catch(error){console.error(['EPERM','EACCES','EBUSY'].includes(error.code)?'Install destination is unavailable ('+error.code+'). Close processes using the skill and check destination permissions; inspect any retained journal with --action recover. No fallback install was attempted.':error.message);process.exitCode=1;}}
module.exports={destination,install,recover};
