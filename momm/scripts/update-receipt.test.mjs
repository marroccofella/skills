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
  // 1.16.1 lifecycle gate (run 36354776934): rollback to 1.16.0 or 1.15.1 restored the checkout, then failed
  // with "Installation inventory unavailable", because the inventory helper exists only from 1.16.1 and was
  // never retained beside the recovery copy of the updater. The receipt must retain it.
  await test('the install receipt retains the inventory helper beside the recovery updater', () => {
    const retained = path.join(stateDir(temp), 'installations.mjs');
    assert(fs.existsSync(retained), 'installations.mjs is retained in the state folder');
    assert.deepEqual(fs.readFileSync(retained), fs.readFileSync(new URL('./installations.mjs', import.meta.url)), 'byte-identical to the installed helper');
    assert(fs.existsSync(path.join(stateDir(temp), 'update.mjs')), 'the recovery updater is still retained');
  });
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
    await update(['--repo',temp,'--rollback','--yes'],{log(){},inventory(){},reinstall(root,receipt){replay=receipt;}});
    assert.equal(git(temp,'rev-parse','HEAD'),old);
    assert(readLock(temp).custom_dirs.includes(laterDir),'later harness missing from recovered receipt');
    assert(replay.installations.some(s=>s.custom_dir===laterDir),'later harness not replayed');
  });
  // 1.16.1 lifecycle gate, second run (36358518929): retaining the helper at install time was not enough. The
  // upgrade from 1.16.0 or 1.15.1 is written by the OLD updater (no helper retained), and the rollback's
  // checkout of the old commit deletes the helper from the working tree before the completion inventory.
  // The rollback must secure the helper first. Real inventory lookup here: no injected inventory.
  await test('rollback to a release without the inventory helper still finds it', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-receipt-rollback-helper-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-receipt-rollback-home-'));
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    try {
      const put = (file, value) => { const p = path.join(repo, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); };
      const save = (message) => { git(repo, 'add', '.'); git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', message); return git(repo, 'rev-parse', 'HEAD'); };
      git(repo, 'init');
      put('versions.json', JSON.stringify({ momm: '1.0.0' }));
      for (const f of ['momm/SKILL.md', 'momm/scripts/update.mjs']) put(f, 'fixture only\n');
      put('momm/scripts/multi-review.mjs', 'const MOMM_VERSION = "1.0.0";\n');
      const older = save('older release without the helper');
      // A real harness link to the clone, as an install makes, so the inventory reads what it actually loads.
      const target = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-receipt-rollback-harness-'));
      fs.symlinkSync(path.join(repo, 'momm'), path.join(target, 'momm'), process.platform === 'win32' ? 'junction' : 'dir');
      const scope = [{ target: 'custom', status: 'linked', destination: path.join(target, 'momm') }];
      recordInstall(repo, 'momm/scripts/install.mjs', scope);
      const previous = readLock(repo); previous.current.tree_sha256 = treeHash(repo, older);
      put('versions.json', JSON.stringify({ momm: '1.1.0' }));
      put('momm/scripts/multi-review.mjs', 'const MOMM_VERSION = "1.1.0";\n');
      put('momm/scripts/installations.mjs', fs.readFileSync(new URL('./installations.mjs', import.meta.url)));
      save('newer release with the helper');
      recordInstall(repo, 'momm/scripts/install.mjs', scope);
      // A receipt written by an older updater: nothing retained beside it.
      fs.rmSync(path.join(stateDir(repo), 'installations.mjs'), { force: true });
      const lockFile = path.join(stateDir(repo), 'momm.lock'), now = readLock(repo); now.previous = previous; fs.writeFileSync(lockFile, JSON.stringify(now));
      process.env.HOME = home; process.env.USERPROFILE = home;
      let refused = null;
      try { await update(['--repo', repo, '--rollback', '--yes'], { log() {}, reinstall() {} }); } catch (e) { refused = e.message; }
      assert.equal(git(repo, 'rev-parse', 'HEAD'), older, 'the checkout is rolled back');
      assert.equal(refused, null, 'the rollback, including its completion inventory, must succeed: ' + refused);
      assert(fs.existsSync(path.join(stateDir(repo), 'installations.mjs')), 'the helper was secured beside the recovery updater');
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
  console.log(JSON.stringify({passed:results.every(r=>r.passed),receipt_regressions:results},null,2));
  assert(results.every(r=>r.passed),'receipt regression failed');
} finally {
  assert.equal(fs.realpathSync(path.dirname(temp)),fs.realpathSync(os.tmpdir()));
  assert(path.basename(temp).startsWith('momm-receipt-regression-'));
  fs.rmSync(temp,{recursive:true,force:true});
}
