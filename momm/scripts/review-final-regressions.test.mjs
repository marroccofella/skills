// Governor-authored controls for the second candidate review. No provider calls.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const mode=process.argv[2]??'all';
if(mode==='all'||mode==='deadline') {
  const file=path.join(root,'momm/scripts/review-workflow.test.mjs');
  const code=fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('./review-workflow.test.mjs',import.meta.url).href));
  const execute=limit=>vm.runInNewContext(code,{path,assert,fileURLToPath,console:{log(){}},fs:{...fs,readFileSync(name,...args){
    const value=fs.readFileSync(name,...args);
    return String(name).endsWith('self-test.yml')?value.replace(/timeout-minutes: 2[ \t]*\r?$/gm,`timeout-minutes: ${limit}`):value;
  }}});
  assert.doesNotThrow(()=>execute(2));
  for(const limit of [20,25,200])assert.throws(()=>execute(limit),/short per-step limit/,'longer deadlines must not pass the two-minute assertion');
  console.log('PASS: CI deadline assertions distinguish 2 from 20, 25 and 200');
}
if(mode==='all'||mode==='checks-cli') {
  const cli=path.join(root,'momm/scripts/checks.mjs');
  for(const args of [['--unknown'],['--unknown','value']]){
    const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',windowsHide:true,timeout:10000});
    assert.equal(result.status,1);assert.match(result.stderr,/unknown option --unknown/);
  }
  const missing=spawnSync(process.execPath,[cli,'--run'],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(missing.status,1);assert.match(missing.stderr,/missing value for --run/);
  console.log('PASS: unknown options and missing known-option values are distinct');
}
