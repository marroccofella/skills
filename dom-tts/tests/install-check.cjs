const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {ROOT}=require('../scripts/runtime'),{install}=require('../scripts/install'),{verify}=require('../scripts/package');
const parent=path.join(ROOT,'.local-test','install-'+Date.now());fs.mkdirSync(parent,{recursive:true});
try{
 const unrelated=path.join(parent,'unrelated-skill');fs.mkdirSync(unrelated);fs.writeFileSync(path.join(unrelated,'keep'),'preserve');
 const args={dir:parent};const preview=install({...args,dryRun:true});assert(!fs.existsSync(preview.destination));
 const first=install(args);verify(first.destination);fs.writeFileSync(path.join(first.destination,'assets/settings.json'),'{}');
 const upgrade=install(args);assert(upgrade.backup);assert(fs.existsSync(path.join(first.destination,'assets/settings.json')));
 const rollback=install({...args,action:'rollback'});verify(rollback.destination);
 const removed=install({...args,action:'uninstall'});assert(!fs.existsSync(removed.destination));assert(fs.existsSync(removed.backup));assert.equal(fs.readFileSync(path.join(unrelated,'keep'),'utf8'),'preserve');
 fs.mkdirSync(removed.destination);assert.throws(()=>install(args),/not a managed/);
 console.log('PASS: preview, fresh install, repeat/upgrade, preserved settings, rollback, uninstall, unmanaged refusal and unrelated-skill preservation.');
}finally{fs.rmSync(parent,{recursive:true,force:true});}
