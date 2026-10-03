const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,stateDir,ensurePrivate,writeObject}=require('./runtime');
const {collectDiagnostics}=require('./support-safety');
function buildArchive(root=ROOT,{base=stateDir,privacy=ensurePrivate,dir=stateDir}={}){
 if(!base||!path.isAbsolute(base))throw new Error('An absolute private support directory is required');
 privacy(base);const folder=path.join(base,'support-'+crypto.randomBytes(12).toString('hex'));privacy(folder);
 const file=path.join(folder,'diagnostics.json');writeObject(file,collectDiagnostics(root,dir));return file;
}
if(require.main===module){try{console.log('Sanitized diagnostics created. Review before sharing.');console.log(buildArchive());}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={buildArchive};

