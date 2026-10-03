const fs=require('node:fs'),path=require('node:path');
const {stateDir,readObject,parseCli,alive,ensurePrivate}=require('./runtime');
const {inspectLock,recoverStale,removeOrphans,resetStatus}=require('./lock');
function status(dir=stateDir){const lock=readObject(path.join(dir,'playback.lock'));return {...readObject(path.join(dir,'status.json'),{state:'idle'}),watcher:readObject(path.join(dir,'watcher-status.json'),{state:'idle'}),locked:fs.existsSync(path.join(dir,'playback.lock')),ownerAlive:alive(lock.pid),stopRequested:fs.existsSync(path.join(dir,'stop.flag'))};}
function recover(dir=stateDir,{privacy=ensurePrivate}={}){privacy(dir);const seen=inspectLock(dir);if(seen.state==='live')throw new Error('Playback owner is alive; stop it instead of recovering');if(seen.state==='writing')throw new Error('Playback lock is being written; retry in a moment');if(seen.state==='malformed')throw new Error('Malformed lock needs manual inspection');if(seen.state==='stale')recoverStale(dir);else{removeOrphans(dir);resetStatus(dir);}return status(dir);}
if(require.main===module){try{const args=parseCli(process.argv.slice(2),{},['recover']);console.log(JSON.stringify(args.recover?recover():status(),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={status,recover};

