import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'momm-entrypoint-'));
const alias=path.join(temp,'checkout-alias');
const failures=[],passed=[];
let aliasCreated=false;
const run=args=>spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,NO_UPDATE_CHECK:'1'}});
try {
  fs.symlinkSync(root,alias,process.platform==='win32'?'junction':'dir');
  aliasCreated=true;
  for(const [file,args,status] of [['momm/scripts/update.mjs',['--help'],0],['momm/scripts/governor.mjs',['--help'],4],['scripts/render-momm-site.mjs',['--check'],0]]) {
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
console.log(JSON.stringify({passed,failures},null,2));if(failures.length)process.exitCode=1;
