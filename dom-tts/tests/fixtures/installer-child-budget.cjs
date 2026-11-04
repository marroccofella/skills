const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,ensurePrivate}=require('../../scripts/runtime');

// Observe the production default deadline through its existing injected-runner
// test seam. Only this empty throwaway probe uses an injected runner. Every
// directory check in the installer and crash/recovery children remains real.
const parent=path.join(ROOT,'.local-test');fs.mkdirSync(parent,{recursive:true});
const probe=path.join(parent,'install-budget-'+crypto.randomBytes(12).toString('hex'));fs.mkdirSync(probe,{mode:0o700});
let permissionTimeoutMs;
try{
 ensurePrivate(probe,{platform:'win32',run:(file,args,options)=>{assert.equal(permissionTimeoutMs,undefined,'one permission query per call');permissionTimeoutMs=options.timeout;return {status:0,stdout:'',stderr:''};}});
 assert(Number.isSafeInteger(permissionTimeoutMs)&&permissionTimeoutMs>0,'permission runner must have a bounded positive deadline');
}finally{
 const resolved=fs.realpathSync(probe),allowed=fs.realpathSync(parent);
 if(path.dirname(resolved)!==allowed||!/^install-budget-[a-f0-9]{24}$/.test(path.basename(resolved))||fs.lstatSync(probe).isSymbolicLink())throw Error('Unexpected installer budget probe cleanup path');
 fs.rmdirSync(resolved);
}

function installerChildOptions(privateChecks,{posixTimeoutMs=30000}={}){
 assert([1,2].includes(privateChecks),'declare the exact number of uncached privacy checks before the child exit');
 assert(Number.isSafeInteger(posixTimeoutMs)&&posixTimeoutMs>0);
 // New/upgrade install: backups + stage. Uninstall/recovery/refusal: backups.
 // Each Windows check may consume its full production deadline; process startup,
 // manifest verification and copying get a separate bounded ten-second allowance.
 const timeout=process.platform==='win32'?privateChecks*permissionTimeoutMs+10000:posixTimeoutMs;
 return {encoding:'utf8',timeout,windowsHide:true};
}
function assertInstallerExit(child,expected,label){
 assert.equal(child.error?.code,undefined,label+': child launcher failed ('+(child.error?.code||'unknown')+'); signal='+(child.signal||'none'));
 assert.equal(child.status,expected,label+': expected controlled installer exit; signal='+(child.signal||'none')+'; stderr='+String(child.stderr||''));
}
module.exports={installerChildOptions,assertInstallerExit};
