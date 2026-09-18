import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
// Entries under scripts/ belong to the repository checkout. The skill is also installed by linking or
// copying momm/ alone, where they do not exist: there they are skipped by name, never silently.
const repoCheckout=fs.existsSync(path.join(root,'versions.json'))&&fs.existsSync(path.join(root,'scripts'));
const repoOnly=file=>file.startsWith('scripts/');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'momm-entrypoint-'));
const alias=path.join(temp,'checkout-alias');
const failures=[],passed=[];
let aliasCreated=false;
const run=args=>spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,NO_UPDATE_CHECK:'1'}});
try {
  fs.symlinkSync(root,alias,process.platform==='win32'?'junction':'dir');
  aliasCreated=true;
  for(const [file,args,status] of [['momm/scripts/update.mjs',['--help'],0],['momm/scripts/governor.mjs',['--help'],4],['scripts/render-momm-site.mjs',['--check'],0]]) {
    if(repoOnly(file)&&!repoCheckout){passed.push(file+' skipped: not a repository checkout');continue;}
    try {
      const a=run([path.join(root,file),...args]),b=run([path.join(alias,file),...args]);
      assert.equal(a.status,status,a.stderr);assert((a.stdout+a.stderr).trim());
      assert.equal(b.status,a.status);assert.equal(b.stdout,a.stdout);assert.equal(b.stderr,a.stderr);
      const imported=run(['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(path.join(alias,file)).href)});`,'--','nonexistent-entrypoint-fixture']);
      assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'');
      passed.push(file);
    }catch(e){failures.push({file,error:e.message});}
  }
}finally {try {if(aliasCreated)fs.unlinkSync(alias);}finally {fs.rmdirSync(temp);}}
// Alias setup failure regression.
try {
  const raw=fs.readFileSync(fileURLToPath(import.meta.url),'utf8');
  for(const source of [raw.replaceAll('\r\n','\n'),raw.replace(/\r?\n/g,'\r\n')]) {
  const cleanup=[],original=Object.assign(Error('symlink setup refused'),{code:'EPERM'});
  const fakeFs={mkdtempSync:()=>'/fixture',symlinkSync:()=>{throw original;},
    unlinkSync:()=>{cleanup.push('unlink');throw Object.assign(Error('alias absent'),{code:'ENOENT'});},
    rmdirSync:()=>cleanup.push('rmdir')};
  assert.throws(()=>vm.runInNewContext(source.slice(source.indexOf('const temp='),source.indexOf('// Alias setup failure regression.')),
    {fs:fakeFs,os:{tmpdir:()=>'/tmp'},path,root,process,spawnSync,assert,pathToFileURL}),error=>error===original);
  assert.deepEqual(cleanup,['rmdir']);
  }
  passed.push('failed alias setup preserves error and cleans directory with LF and CRLF');
}catch(e){failures.push({file:'alias cleanup',error:e.message});}
// Importing the test fixture must never act as its command line, whatever argv[1] holds.
for(const file of ['momm/scripts/private-test-fixture.mjs','scripts/private-test-fixture.mjs']) {
  if(repoOnly(file)&&!repoCheckout){passed.push(file+' skipped: not a repository checkout');continue;}
  try {
    const imported=run(['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(path.join(root,file)).href)});`,'--','nonexistent-entrypoint-fixture']);
    assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'');
    passed.push(file+' imports without running');
  }catch(e){failures.push({file,error:e.message.split('\n')[0]});}
}
// The skill is installed by linking or copying momm/ alone; nothing beside it exists there.
try {
  const skill=path.join(root,'momm'),escaping=[];
  const scriptsDir=path.join(skill,'scripts');
  for(const name of fs.readdirSync(scriptsDir).filter(n=>n.endsWith('.mjs'))) {
    const text=fs.readFileSync(path.join(scriptsDir,name),'utf8');
    for(const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g)) {
      const resolved=path.resolve(scriptsDir,m[2]);
      if(!resolved.startsWith(skill+path.sep))escaping.push(name+' -> '+m[2]);
    }
  }
  assert.deepEqual(escaping,[],'momm/scripts modules must not import from outside the installed skill directory');
  passed.push('skill scripts import nothing outside momm/');
}catch(e){failures.push({file:'skill self-containment',error:e.message});}
console.log(JSON.stringify({passed,failures},null,2));if(failures.length)process.exitCode=1;
