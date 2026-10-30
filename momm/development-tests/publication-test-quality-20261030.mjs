// Governor-authored checks for the synthetic regression harness, never a live call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
delete process.env.MOMM_EVIDENCE_HOME;
const target=fileURLToPath(new URL('../scripts/bumble-oauth-pilot-regressions.test.mjs',import.meta.url));
const mode=process.argv[2];
if(mode==='default'){
 const r=spawnSync(process.execPath,[target],{encoding:'utf8',timeout:30000,windowsHide:true});
 assert.equal(r.status,0,r.stderr);
 const rows=r.stdout.trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(rows.reduce((n,row)=>n+row.passed,0),5,'default all mode must execute three connection and two broker controls');
 console.log('PASS: default all mode executes all five controls');
}else if(mode==='missing-name'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'momm-publication-controls-'));
 try{
  let source=fs.readFileSync(target,'utf8');
  const marker='segment=source.slice(begin,end);assert(begin>=0&&end>begin);';
  assert.equal(source.split(marker).length-1,1,'identify only the clock-control slice');
  source=source.replace(marker,"segment='missingDependency();'+source.slice(begin,end);assert(begin>=0&&end>begin);");
  const test=path.join(root,path.basename(target));fs.writeFileSync(test,source);
  fs.copyFileSync(new URL('../scripts/bumble-oauth-pilot.mjs',import.meta.url),path.join(root,'bumble-oauth-pilot.mjs'));
  const r=spawnSync(process.execPath,[test,'--clock'],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.notEqual(r.status,0,'an unrelated missing identifier must fail, not satisfy the budget guard assertion');
  assert.match(r.stderr,/missingDependency|ReferenceError/);
  console.log('PASS: injected missing identifier cannot pass the budget control');
 }finally{
  const absolute=path.resolve(root),prefix=path.resolve(os.tmpdir())+path.sep+'momm-publication-controls-';
  assert(absolute.startsWith(prefix));fs.rmSync(absolute,{recursive:true,force:true});
 }
}else throw Error('Choose default or missing-name');
