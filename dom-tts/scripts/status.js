const fs=require('node:fs'),path=require('node:path');
const {stateDir,readObject,parseCli,alive,ensurePrivate}=require('./runtime');
function status(dir=stateDir){const lock=readObject(path.join(dir,'playback.lock'));return {...readObject(path.join(dir,'status.json'),{state:'idle'}),watcher:readObject(path.join(dir,'watcher-status.json'),{state:'idle'}),locked:fs.existsSync(path.join(dir,'playback.lock')),ownerAlive:alive(lock.pid),stopRequested:fs.existsSync(path.join(dir,'stop.flag'))};}
function recover(dir=stateDir){ensurePrivate(dir);const file=path.join(dir,'playback.lock'),lock=readObject(file);if(alive(lock.pid))throw new Error('Playback owner is alive; stop it instead of recovering');if(fs.existsSync(file)){if(!Number.isSafeInteger(lock.pid)||typeof lock.token!=='string')throw new Error('Malformed lock needs manual inspection');fs.unlinkSync(file);}for(const name of fs.readdirSync(dir))if(/^speech-[a-f0-9]{24}\.json$/.test(name))fs.unlinkSync(path.join(dir,name));return status(dir);}
if(require.main===module){try{const args=parseCli(process.argv.slice(2),{},['recover']);console.log(JSON.stringify(args.recover?recover():status(),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={status,recover};

