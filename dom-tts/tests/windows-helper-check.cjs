const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {helperInfo,signature}=require('../scripts/providers/windows-helper');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dom-helper-'));
try{
 assert.equal(helperInfo({root}).state,'absent');
 const dir=path.join(root,'scripts','providers','windows');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'test'}));
 const file=path.join(dir,'NativeSpeech.exe');fs.writeFileSync(file,'synthetic, never executable');
 const release={schema:'dom-tts-windows-helper/1',version:'test',protocol:1,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),signerThumbprint:'A'.repeat(40)};
 fs.writeFileSync(path.join(dir,'release.json'),JSON.stringify(release));
 assert.equal(helperInfo({root,verifySignature:()=>({status:'Valid',thumbprint:release.signerThumbprint})}).state,'verified');
 for(const status of ['NotSigned','NotTrusted','UnknownError'])assert.equal(helperInfo({root,verifySignature:()=>({status,thumbprint:release.signerThumbprint})}).code,'helper-signature-refused');
 assert.equal(helperInfo({root,verifySignature:()=>({status:'Valid',thumbprint:'B'.repeat(40)})}).state,'blocked');
 fs.appendFileSync(file,'tamper');let called=false;assert.equal(helperInfo({root,verifySignature:()=>{called=true;return {status:'Valid'};}}).code,'helper-integrity-refused');assert.equal(called,false);
 assert.equal(signature('public fixture',{run:()=>({status:0,stdout:JSON.stringify({status:'Valid',thumbprint:'a'.repeat(40)})})}).thumbprint,'A'.repeat(40));
 assert.deepEqual(signature('public fixture',{run:()=>({status:1,stderr:'PRIVATE_PATH'})}),{status:'UnknownError',thumbprint:''});
 assert.equal(helperInfo({root,component:'tray'}).state,'absent');
 const trayDir=path.join(dir,'tray');fs.mkdirSync(trayDir);const trayFile=path.join(trayDir,'TrayCompanion.exe');fs.writeFileSync(trayFile,'synthetic tray, never executable');
 const trayRelease={...release,schema:'dom-tts-windows-tray/1',sha256:crypto.createHash('sha256').update(fs.readFileSync(trayFile)).digest('hex')};
 const trayMetadata=path.join(trayDir,'release.json');fs.writeFileSync(trayMetadata,JSON.stringify(trayRelease));
 assert.equal(helperInfo({root,component:'tray',verifySignature:()=>({status:'Valid',thumbprint:release.signerThumbprint})}).state,'verified');
 assert.equal(helperInfo({root,component:'tray',verifySignature:()=>({status:'NotSigned',thumbprint:''})}).code,'helper-signature-refused');
 fs.writeFileSync(trayMetadata,JSON.stringify({...trayRelease,schema:release.schema}));
 assert.equal(helperInfo({root,component:'tray',verifySignature:()=>{throw Error('must not reach trust check');}}).code,'helper-integrity-refused');
 fs.writeFileSync(trayMetadata,JSON.stringify(trayRelease));fs.appendFileSync(trayFile,'tamper');
 assert.equal(helperInfo({root,component:'tray',verifySignature:()=>{throw Error('must not reach trust check');}}).code,'helper-integrity-refused');
 console.log('PASS: speech/tray publisher/hash/schema gates, unsigned/untrusted/tampered refusal and sanitized signature checks; synthetic files, no executable launched');
}finally{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('dom-helper-'));fs.rmSync(resolved,{recursive:true,force:true});}
