// Isolated real Git fixtures for receipt ownership and explicit rollback policy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {git, recordInstall, readLock, stateDir, treeHash, update} from './update.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'momm-receipt-regression-')),results=[];
const write=(file,value)=>{const p=path.join(temp,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);};
const commit=message=>{git(temp,'add','.');git(temp,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m',message);return git(temp,'rev-parse','HEAD');};
async function test(name,fn){try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
try {
  git(temp,'init');
  write('versions.json',JSON.stringify({momm:'1.0.0'}));
  for(const f of ['momm/SKILL.md','momm/scripts/multi-review.mjs','momm/scripts/update.mjs'])write(f,'fixture only\n');
  const old=commit('old');
  const firstDir=path.join(temp,'first-harness'),laterDir=path.join(temp,'later-harness');
  const rows=dest=>[{target:'custom',status:'linked',destination:path.join(dest,'momm')}];
  recordInstall(temp,'momm/scripts/install.mjs',rows(firstDir));
  const before=readLock(temp);before.current.tree_sha256=treeHash(temp,old);
  write('versions.json',JSON.stringify({momm:'1.1.0'}));const latest=commit('new');
  recordInstall(temp,'momm/scripts/install.mjs',rows(firstDir));
  const lockPath=path.join(stateDir(temp),'momm.lock');
  const current=readLock(temp);current.previous=before;fs.writeFileSync(lockPath,JSON.stringify(current));
  recordInstall(temp,'momm/scripts/install.mjs',rows(laterDir));
  await test('receipt writer cannot bypass an active update claim',()=>{
    const bytes=fs.readFileSync(lockPath),claim=path.join(stateDir(temp),'update.active');fs.writeFileSync(claim,'fixture-owned claim');
    try { assert.throws(()=>recordInstall(temp,'momm/scripts/install.mjs',rows(path.join(temp,'racing-harness'))),/update.*active|update.*claim|Another update/i);assert.deepEqual(fs.readFileSync(lockPath),bytes); }
    finally { fs.unlinkSync(claim);fs.writeFileSync(lockPath,bytes); }
  });
  await test('implicit stable downgrade is refused before fetching code',async()=>{
    await assert.rejects(update(['--repo',temp,'--dry-run'],{log(){},manifest:async()=>({momm:'1.0.0',momm_releases:[]})}),/explicit.*--version/i);
    assert.equal(git(temp,'rev-parse','HEAD'),latest);
  });
  await test('rollback retains explicitly added harness scopes',async()=>{
    let replay;
    await update(['--repo',temp,'--rollback','--yes'],{log(){},reinstall(root,receipt){replay=receipt;}});
    assert.equal(git(temp,'rev-parse','HEAD'),old);
    assert(readLock(temp).custom_dirs.includes(laterDir),'later harness missing from recovered receipt');
    assert(replay.installations.some(s=>s.custom_dir===laterDir),'later harness not replayed');
  });
  console.log(JSON.stringify({passed:results.every(r=>r.passed),receipt_regressions:results},null,2));
  assert(results.every(r=>r.passed),'receipt regression failed');
} finally {
  assert.equal(fs.realpathSync(path.dirname(temp)),fs.realpathSync(os.tmpdir()));
  assert(path.basename(temp).startsWith('momm-receipt-regression-'));
  fs.rmSync(temp,{recursive:true,force:true});
}
