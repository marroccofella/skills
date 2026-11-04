// A single user-selected legacy settings file, never a legacy installation scan.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,parseCli,ensurePrivate,readObject,writeObject}=require('./runtime');
const fields=['profile','mode','provider','speed','voice','maxChunkChars','includeCodeBlocks','includeCommandBlocks'];
function planNativeMigration(legacy){
 if(!legacy||typeof legacy!=='object'||Array.isArray(legacy))throw Error('legacy-settings-object-required');
 const settings={};for(const key of fields)if(Object.hasOwn(legacy,key))settings[key]=legacy[key];
 if(!Object.hasOwn(settings,'speed')&&Object.hasOwn(legacy,'rate'))settings.speed=legacy.rate;
 if(Object.hasOwn(settings,'voice')&&(typeof settings.voice!=='string'||settings.voice.length>128||/[\u0000-\u001f\u007f]/.test(settings.voice)))throw Error('legacy-voice-refused');
 if(!Object.keys(settings).length)throw Error('no-recognized-legacy-settings');
 // Prepare validates modes, profiles, provider, chunk size, speed and booleans without audio.
 require('./speak').prepare({text:'Settings validation'},{settings});
 return {state:'preview',settings,ignoredSettingCount:Object.keys(legacy).filter(k=>!fields.includes(k)&&k!=='rate').length,legacyUnchanged:true,activation:'next-explicit-native-playback',voiceAcceptance:'unverified-until-doctor-and-listening-test'};
}
function noLinks(file){for(let part=path.resolve(file);;part=path.dirname(part)){if(fs.existsSync(part)&&fs.lstatSync(part).isSymbolicLink())throw Error('migration-linked-path-refused');if(path.dirname(part)===part)break;}}
function migrateNative(args,{root=ROOT}={}){if(!args.file||!path.isAbsolute(args.file))throw Error('Choose one explicit absolute --file');if(args.apply!==undefined&&!['true','false'].includes(args.apply))throw Error('--apply requires true or false');noLinks(args.file);const stat=fs.lstatSync(args.file);if(!stat.isFile()||stat.size>65536)throw Error('legacy-settings-file-refused');let legacy;try{legacy=JSON.parse(fs.readFileSync(args.file,'utf8').replace(/^\uFEFF/,''));}catch{throw Error('legacy-settings-json-refused');}const plan=planNativeMigration(legacy);
 if(args.apply==='true'){const target=args.dir||root;if(!path.isAbsolute(target))throw Error('--dir must be an explicit absolute installed skill directory');noLinks(target);const marker=readObject(path.join(target,'.dom-tts-install.json'));if(marker.schema!=='dom-tts-install/1')throw Error('migration-requires-managed-install');ensurePrivate(target);const assets=path.join(target,'assets');ensurePrivate(assets);const file=path.join(assets,'settings.json');noLinks(file);const existing=fs.existsSync(file)?readObject(file,null):{};if(existing===null)throw Error('existing-settings-need-inspection');const merged={...existing,...plan.settings};planNativeMigration(merged);const backupDir=path.join(target,'.dom-tts-migration-backups');ensurePrivate(backupDir);if(fs.existsSync(file)){const backup=path.join(backupDir,'settings-'+crypto.randomBytes(16).toString('hex')+'.json');fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);plan.backup=backup;}writeObject(file,merged);plan.preservedExistingSettingCount=Object.keys(existing).filter(key=>!Object.hasOwn(plan.settings,key)).length;plan.state='saved-for-next-explicit-native-playback';}
 return plan;
}
if(require.main===module){try{console.log(JSON.stringify(migrateNative(parseCli(process.argv.slice(2),{},['file','dir','apply'])),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={planNativeMigration,migrateNative};
