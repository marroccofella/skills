// A governor-authored gate-removal control, never a production-source mutation.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL,fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
delete process.env.MOMM_EVIDENCE_HOME;
const root=path.dirname(fileURLToPath(import.meta.url)),parent=fs.mkdtempSync(path.join(os.tmpdir(),'momm-capacity-sensitivity-'));
try{
  const source=fs.readFileSync(path.join(root,'bumble-capacity.mjs'),'utf8'),guard='state.retired_groups.includes(group.id)||';
  assert.equal(source.split(guard).length,2,'exactly one intended physical-retirement admission guard');
  let mutant=source.replace(guard,'');
  for(const dependency of ['evidence-permissions.mjs','bumble-release-receipt.mjs']){
    const specifier="'./"+dependency+"'";assert.equal(mutant.split(specifier).length,2,'one reviewed dependency import');
    mutant=mutant.replace(specifier,JSON.stringify(pathToFileURL(path.join(root,dependency)).href));
  }
  const modulePath=path.join(parent,'mutant.mjs');fs.writeFileSync(modulePath,mutant,{flag:'wx',mode:0o600});
  const original=fs.readFileSync(path.join(root,'bumble-capacity.test.mjs'),'utf8');
  const test=original.replace("'./bumble-capacity.mjs'",JSON.stringify(pathToFileURL(modulePath).href));assert.notEqual(test,original);
  const testPath=path.join(parent,'control.test.mjs');fs.writeFileSync(testPath,test,{flag:'wx',mode:0o600});
  const result=spawnSync(process.execPath,[testPath],{cwd:path.resolve(root,'../..'),encoding:'utf8',timeout:120000,maxBuffer:1_000_000,windowsHide:true});
  assert.notEqual(result.status,null,'mutation execution must actually settle; unavailable execution is not sensitivity evidence');
  assert.notEqual(result.status,0,'the canonical capacity test must detect removal of the retirement guard');
  assert.match(result.stderr,/AssertionError/,'the intended assertion must fail, not an import/permission/runtime error');
  assert.match(result.stderr,/unoccupied retired physical group/,'failure must be the unmasked retirement control');
  console.log(JSON.stringify({passed:true,mutant_exit_code:result.status,network_calls:0,scope:'one private-copy gate removal detected by the canonical test, not universal mutation coverage'}));
}finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-capacity-sensitivity-'));fs.rmSync(parent,{recursive:true,force:true});}
