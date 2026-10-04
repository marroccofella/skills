const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {ROOT,parseCli,ensurePrivate,readObject,writeObject}=require('./runtime');
const {verify}=require('./package');
function destination(args){if(args.dir){if(!path.isAbsolute(args.dir))throw new Error('--dir must be an absolute skill-parent directory');return path.join(args.dir,'dom-tts');}const parents={codex:path.join(os.homedir(),'.agents','skills'),claude:path.join(os.homedir(),'.claude','skills')};if(!parents[args.target])throw new Error('Choose --target codex, --target claude or --dir <documented skill parent>');return path.join(parents[args.target],'dom-tts');}
function managed(dir){const stat=fs.lstatSync(dir);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Existing install is not a managed directory');const marker=readObject(path.join(dir,'.dom-tts-install.json'));if(marker.schema!=='dom-tts-install/1')throw new Error('Existing directory is not a managed Dom TTS install');return marker;}
function install(args){
 const dest=destination(args),action=args.action||'install';if(!['install','uninstall','rollback'].includes(action))throw new Error('Unknown install action');
 const exists=fs.existsSync(dest);if(exists)managed(dest);if((action==='uninstall'||action==='rollback')&&!exists)throw new Error('No managed install at destination');
 const source=action==='install'?verify(ROOT):null;const plan={action,destination:dest,version:source?.version,preserve:'Runtime state and unrelated skills are never removed'};
 if(args.dryRun)return plan;
 fs.mkdirSync(path.dirname(dest),{recursive:true});const backups=path.join(path.dirname(dest),'.dom-tts-backups');ensurePrivate(backups);
 const backup=path.join(backups,'dom-tts-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex'));
 if(action==='uninstall'){fs.renameSync(dest,backup);return {...plan,backup};}
 if(action==='rollback'){
  const prior=managed(dest).backup;if(!prior||path.dirname(prior)!==backups||!fs.existsSync(prior))throw new Error('No retained upgrade snapshot');managed(prior);
  fs.renameSync(dest,backup);try{fs.renameSync(prior,dest);writeObject(path.join(dest,'.dom-tts-install.json'),{schema:'dom-tts-install/1',version:require(path.join(dest,'package.json')).version,backup});}catch(e){if(!fs.existsSync(dest))fs.renameSync(backup,dest);throw e;}return {...plan,backup};
 }
 const stage=path.join(path.dirname(dest),'.dom-tts-stage-'+crypto.randomBytes(12).toString('hex'));ensurePrivate(stage);
 try{
  for(const item of source.files){const target=path.join(stage,item.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(ROOT,item.path),target);}
  fs.copyFileSync(path.join(ROOT,'manifest.json'),path.join(stage,'manifest.json'));verify(stage);
  if(exists&&fs.existsSync(path.join(dest,'assets','settings.json'))){const settings=readObject(path.join(dest,'assets','settings.json'),null);if(settings===null)throw new Error('Existing settings need inspection before upgrade');writeObject(path.join(stage,'assets','settings.json'),settings);}
  writeObject(path.join(stage,'.dom-tts-install.json'),{schema:'dom-tts-install/1',version:source.version,backup:exists?backup:null});
  if(exists)fs.renameSync(dest,backup);try{fs.renameSync(stage,dest);}catch(e){if(exists)fs.renameSync(backup,dest);throw e;}
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
 return {...plan,backup:exists?backup:undefined};
}
if(require.main===module){try{const args=parseCli(process.argv.slice(2),{},['target','dir','action','dryRun']);console.log(JSON.stringify(install(args),null,2));}catch(error){console.error(['EPERM','EACCES','EBUSY'].includes(error.code)?'Install destination is unavailable ('+error.code+'). Close processes using the skill and check the destination permissions; no fallback install was attempted.':error.message);process.exitCode=1;}}
module.exports={destination,install};
