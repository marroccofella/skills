import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { migrate,rollback,parse } from './migrate-legacy.mjs';
import { execute,verifyCheckout } from './bootstrap.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'momm-migration-tests-')),results={};
const skipped={};
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
// Inputs retain their caller spelling, including symlink/short-name temp roots.
// Expected paths and race hooks use the OS-resolved parent of each entry.
const physicalEntry=p=>path.join((process.platform==='win32'?fs.realpathSync.native:fs.realpathSync)(path.dirname(p)),path.basename(p));
// Progress goes to STDERR only (one line per test: outcome, name, elapsed ms)
// so a slow run can be told from a hung one; the STDOUT JSON shape is unchanged.
async function test(n,f){
  const started=Date.now();let outcome='ok';
  try{const result=await f();if(result?.skip){skipped[n]=result.skip;outcome='skip';}results[n]=true;}catch(e){results[n]={failure:e.message};process.exitCode=1;outcome='FAIL';}
  process.stderr.write(`[migrate-legacy.test] ${outcome} ${n} ${Date.now()-started}ms\n`);
}
async function applyFixture(f,dep=f.dep){const preview=await migrate(f.options,dep);assert.equal(preview.status,'migration_preview');return migrate({...f.options,apply:true,acceptProtocol:true,planSha256:preview.plan_sha256},dep);}
function fixture(name,link=false){
  const base=path.join(root,name),repo=path.join(base,'prepared'),skill=path.join(base,'harness','skills','momm'),backup=path.join(base,'backups','old-momm');
  fs.mkdirSync(repo,{recursive:true});fs.mkdirSync(path.dirname(backup),{recursive:true});
  for(const file of ['momm/scripts/install.mjs','momm/scripts/update.mjs','momm/scripts/bootstrap.mjs'])write(path.join(repo,file),fs.readFileSync(path.join(source,file)));
  write(path.join(repo,'momm/scripts/multi-review.mjs'),'// fixture dispatcher\n');write(path.join(repo,'momm/SKILL.md'),'# New protocol\n');write(path.join(repo,'versions.json'),'{"momm":"1.15.1"}');
  const git=(...args)=>execute('git',args,repo).trim();git('-c','init.templateDir=','init','.');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture');
  const commit=git('rev-parse','HEAD'),original=link?path.join(base,'original-clone','momm'):skill;
  write(path.join(original,'SKILL.md'),'# Old protocol\n');write(path.join(original,'.ensemble_reviews/ledger.html'),'PRIVATE fixture evidence');
  if(link){fs.mkdirSync(path.dirname(skill),{recursive:true});fs.symlinkSync(original,skill,process.platform==='win32'?'junction':'dir');}
  return {options:{prepared:repo,version:'1.15.1',skillPath:skill,backup},original:physicalEntry(original),repo:physicalEntry(repo),skill:physicalEntry(skill),backup:physicalEntry(backup),dep:{check:()=>({status:'ready_to_verify'}),releaseRecord:async()=>({tag_name:'momm-1.15.1',draft:false,prerelease:false}),verify:()=>({commit,hash:'fixture-only'}),checkout:verifyCheckout}};
}
try{
  await test('preview_has_exact_paths_protocol_and_no_moves_or_receipt',async()=>{
    const f=fixture('preview'),r=await migrate(f.options,f.dep);
    assert.equal(r.status,'migration_preview');assert.equal(r.installed,false);assert(r.protocol_changed);assert.match(r.old_protocol,/Old protocol/);assert.match(r.new_protocol,/New protocol/);
    assert(!fs.existsSync(f.backup));assert(!fs.existsSync(r.paths.journal));assert(!fs.existsSync(path.join(f.repo,'.git/momm/momm.lock')));assert.equal(fs.readFileSync(path.join(f.skill,'.ensemble_reviews/ledger.html'),'utf8'),'PRIVATE fixture evidence');
    await assert.rejects(migrate({...f.options,apply:true},f.dep),{code:'protocol_acceptance_required'});assert(fs.existsSync(f.skill));
  });
  for(const link of [false,true])await test(`${link?'link':'directory'}_migration_and_rollback_preserve_original_and_ledgers`,async()=>{
    const f=fixture(link?'link':'directory',link),r=await applyFixture(f);
    assert.equal(r.status,'migration_installed');assert.equal(fs.realpathSync(f.skill),fs.realpathSync(path.join(f.repo,'momm')));assert.equal(path.dirname(r.paths.backup),path.join(path.dirname(f.repo),'backups'));
    assert.equal(fs.readFileSync(path.join(link?f.original:f.backup,'.ensemble_reviews/ledger.html'),'utf8'),'PRIVATE fixture evidence');
    assert(!fs.existsSync(path.join(f.repo,'momm/.ensemble_reviews')));assert.equal(rollback(r.paths.journal).status,'rolled_back');
    assert.equal(fs.readFileSync(path.join(f.skill,'SKILL.md'),'utf8'),'# Old protocol\n');assert.equal(fs.readFileSync(path.join(f.skill,'.ensemble_reviews/ledger.html'),'utf8'),'PRIVATE fixture evidence');
  });
  await test('aliased_input_paths_share_one_plan_and_support_journal_rollback',async()=>{
    const f=fixture('aliased-input'),alias=path.join(root,'input-alias');fs.symlinkSync(path.dirname(f.repo),alias,process.platform==='win32'?'junction':'dir');
    const aliased={...f,options:{...f.options,prepared:path.join(alias,'prepared'),skillPath:path.join(alias,'harness/skills/momm'),backup:path.join(alias,'backups/old-momm')}};
    const direct=await migrate(f.options,f.dep),viaAlias=await migrate(aliased.options,f.dep);
    assert.deepEqual(viaAlias.paths,direct.paths);assert.equal(viaAlias.plan_sha256,direct.plan_sha256);
    const r=await applyFixture(aliased);assert.equal(r.status,'migration_installed');
    assert.equal(rollback(path.join(alias,'backups/old-momm.momm-migration.json')).status,'rolled_back');
    assert.equal(fs.readFileSync(path.join(f.skill,'.ensemble_reviews/ledger.html'),'utf8'),'PRIVATE fixture evidence');
  });
  await test('windows_short_name_input_preserves_plan_receipt_and_rollback',async()=>{
    if(process.platform!=='win32')return {skip:'Windows 8.3 names only'};
    const f=fixture('explicit-short-name'),parent=path.dirname(f.repo);
    // cmd's built-in path modifier queries an existing synthetic directory.
    // No installer, remote script or mutable system setting is involved.
    if(/[&|<>\r\n"^%!]/.test(parent))return {skip:'Synthetic path contains shell-control characters; no command executed'};
    const cmd=path.join(process.env.SystemRoot||'C:\\Windows','System32','cmd.exe');
    const query=spawnSync(cmd,['/d','/q','/c',`for %M in ("${parent}") do @echo %~sM`],{encoding:'utf8',timeout:10000,windowsHide:true,windowsVerbatimArguments:true});
    assert.equal(query.status,0,'Windows short-name query must complete');
    const shortParent=query.stdout.trim();assert(path.isAbsolute(shortParent));assert.equal(fs.realpathSync.native(shortParent),fs.realpathSync.native(parent));
    if(shortParent===fs.realpathSync.native(parent))return {skip:'This volume does not provide a distinct 8.3 name'};
    const viaShort={...f,options:{...f.options,prepared:path.join(shortParent,'prepared'),skillPath:path.join(shortParent,'harness/skills/momm'),backup:path.join(shortParent,'backups/old-momm')}};
    const direct=await migrate(f.options,f.dep),short=await migrate(viaShort.options,f.dep);assert.deepEqual(short.paths,direct.paths);assert.equal(short.plan_sha256,direct.plan_sha256);
    const r=await applyFixture(viaShort);assert.equal(r.status,'migration_installed');assert.equal(rollback(r.paths.journal).status,'rolled_back');
    assert.equal(fs.readFileSync(path.join(f.skill,'.ensemble_reviews/ledger.html'),'utf8'),'PRIVATE fixture evidence');
  });
  await test('backup_inside_discovery_and_existing_backups_are_refused',async()=>{
    const f=fixture('backup-conflicts');await assert.rejects(migrate({...f.options,backup:path.join(path.dirname(f.skill),'momm.bak')},f.dep),{code:'unsafe_backup'});
    write(f.backup,'keep');await assert.rejects(migrate(f.options,f.dep),{code:'migration_conflict'});assert.equal(fs.readFileSync(f.backup,'utf8'),'keep');
  });
  await test('prepared_clone_overlapping_the_live_link_target_is_refused',async()=>{
    // Gate-3 [65]: only the link path was compared, never the installation it resolves to.
    const f=fixture('overlap-target'),type=process.platform==='win32'?'junction':'dir';
    fs.rmSync(f.skill,{recursive:true});fs.symlinkSync(f.repo,f.skill,type); // old discovery link -> the "prepared" clone itself
    await assert.rejects(migrate(f.options,f.dep),{code:'unsafe_backup'});
    fs.unlinkSync(f.skill);write(path.join(f.repo,'vendored/momm/SKILL.md'),'# Old protocol\n');fs.symlinkSync(path.join(f.repo,'vendored','momm'),f.skill,type); // link -> inside the clone
    await assert.rejects(migrate(f.options,f.dep),{code:'unsafe_backup'});assert(!fs.existsSync(f.backup));assert(fs.lstatSync(f.skill).isSymbolicLink());
  });
  await test('failed_partial_installer_restores_original_without_deleting_new_clone',async()=>{
    const f=fixture('partial');let failure;
    try{await applyFixture(f,{...f.dep,run:(cmd,args,cwd,opts)=>{const result=execute(cmd,args,cwd,opts);if(cmd===process.execPath)throw Error('simulated receipt reporting failure');return result;}});}catch(e){failure=e;}
    assert.equal(failure?.recovery?.status,'rolled_back');assert.equal(fs.readFileSync(path.join(f.skill,'SKILL.md'),'utf8'),'# Old protocol\n');assert(fs.existsSync(f.repo));
  });
  await test('wrong_signature_or_changed_candidate_stops_before_moving_old_entry',async()=>{
    const f=fixture('bad-proof');await assert.rejects(migrate({...f.options,apply:true,acceptProtocol:true},{...f.dep,verify:()=>{throw Error('wrong identity');}}));assert(fs.existsSync(f.skill));assert(!fs.existsSync(f.backup));
    write(path.join(f.repo,'momm/SKILL.md'),'tampered');await assert.rejects(migrate({...f.options,apply:true,acceptProtocol:true},f.dep),{code:'checkout_changed'});assert(fs.existsSync(f.skill));
  });
  await test('rollback_refuses_user_replacement_instead_of_overwriting_it',async()=>{
    const f=fixture('changed-link'),r=await applyFixture(f);
    fs.unlinkSync(f.skill);write(path.join(f.skill,'new-user-file'),'keep');assert.throws(()=>rollback(r.paths.journal),{code:'discovery_changed'});
    assert.equal(fs.readFileSync(path.join(f.skill,'new-user-file'),'utf8'),'keep');assert(fs.existsSync(f.backup));
  });
  await test('rollback_removes_a_real_directory_junction_or_symlink_without_touching_its_target',async()=>{
    // Gate-3 [1]: claim that unlink of a directory junction throws EPERM on Windows.
    const f=fixture('junction-unlink'),r=await applyFixture(f),target=path.join(f.repo,'momm');
    const before=fs.lstatSync(f.skill);assert(before.isSymbolicLink(),'installer must have produced a link or junction');
    if(process.platform==='win32')assert.equal(fs.realpathSync.native(f.skill),fs.realpathSync.native(target));
    assert.equal(rollback(r.paths.journal).status,'rolled_back');
    assert(!fs.lstatSync(f.skill).isSymbolicLink());assert.equal(fs.readFileSync(path.join(f.skill,'SKILL.md'),'utf8'),'# Old protocol\n');
    assert.equal(fs.readFileSync(path.join(target,'SKILL.md'),'utf8'),'# New protocol\n','link target must survive removal of the link');
  });
  await test('rollback_accepts_the_new_link_when_its_target_is_a_respelling_of_the_prepared_clone',async()=>{
    // Gate-3 [2]: the link text may spell the clone differently (alias, 8.3 name,
    // /var vs /private/var) from the physical path stored in the journal.
    const f=fixture('respelled-link'),r=await applyFixture(f),alias=path.join(root,'respelled-alias'),type=process.platform==='win32'?'junction':'dir';
    fs.symlinkSync(path.dirname(f.repo),alias,type);
    fs.unlinkSync(f.skill);fs.symlinkSync(path.join(alias,'prepared','momm'),f.skill,type);
    assert.notEqual(path.resolve(path.dirname(f.skill),fs.readlinkSync(f.skill)),path.join(f.repo,'momm'),'fixture must really be respelled');
    assert.equal(fs.realpathSync(f.skill),fs.realpathSync(path.join(f.repo,'momm')));
    assert.equal(rollback(r.paths.journal).status,'rolled_back');
    assert.equal(fs.readFileSync(path.join(f.skill,'SKILL.md'),'utf8'),'# Old protocol\n');assert(fs.existsSync(path.join(f.repo,'momm/SKILL.md')));
  });
  await test('rollback_still_refuses_a_link_that_resolves_outside_the_prepared_clone',async()=>{
    const f=fixture('foreign-link'),r=await applyFixture(f),foreign=path.join(path.dirname(f.repo),'foreign','momm');write(path.join(foreign,'SKILL.md'),'# Foreign\n');
    fs.unlinkSync(f.skill);fs.symlinkSync(foreign,f.skill,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>rollback(r.paths.journal),{code:'discovery_changed'});assert(fs.lstatSync(f.skill).isSymbolicLink());assert(fs.existsSync(f.backup));
  });
  await test('force_and_mixed_rollback_flags_are_not_supported',()=>{assert.throws(()=>parse(['--force']));assert.throws(()=>parse(['--rollback','/fixture/journal','--apply']));});
  await test('apply_requires_the_exact_approved_preview_digest',async()=>{
    const f=fixture('plan-pin');await assert.rejects(migrate({...f.options,apply:true,acceptProtocol:true,planSha256:'0'.repeat(64)},f.dep),{code:'preview_changed'});assert(!fs.existsSync(f.backup));
  });
  await test('rollback_identity_is_stable_when_birthtime_uses_mutable_ctime',async()=>{
    const f=fixture('ctime-fallback'),originalStat=fs.lstatSync;
    // Node documents ctime as a possible birthtime fallback. Model the rename
    // change explicitly so this regression also runs on Windows/macOS CI.
    fs.lstatSync=(file,...args)=>{const stat=originalStat(file,...args);stat.birthtimeMs=String(file)===f.backup?2:1;return stat;};
    try{const r=await applyFixture(f);assert.equal(rollback(r.paths.journal).status,'rolled_back');}
    finally{fs.lstatSync=originalStat;}
  });
  await test('leftover_journal_temp_does_not_block_rollback',async()=>{
    const f=fixture('stale-temp'),r=await applyFixture(f);
    write(r.paths.journal+'.tmp','retain interrupted diagnostic');assert.equal(rollback(r.paths.journal).status,'rolled_back');
    assert.equal(fs.readFileSync(r.paths.journal+'.tmp','utf8'),'retain interrupted diagnostic');
  });
  await test('live_or_ambiguous_lock_owner_is_never_stolen',async()=>{
    const f=fixture('live-lock'),r=await applyFixture(f);write(r.paths.lock,JSON.stringify({journal:r.paths.journal,pid:process.ppid}));
    assert.throws(()=>rollback(r.paths.journal),{code:'migration_active',message:/may still be running/});assert(fs.existsSync(r.paths.lock));assert(fs.existsSync(f.backup));
  });
  await test('dead_owner_allows_explicit_rollback',async()=>{
    const f=fixture('dead-lock'),r=await applyFixture(f),kill=process.kill;write(r.paths.lock,JSON.stringify({journal:r.paths.journal,pid:424242}));
    process.kill=(pid,signal)=>{if(pid===424242)throw Object.assign(Error('fixture dead owner'),{code:'ESRCH'});return kill(pid,signal);};
    try{assert.equal(rollback(r.paths.journal).status,'rolled_back');}finally{process.kill=kill;}
  });
  await test('changed_local_git_config_is_rejected_before_verification_or_installation',async()=>{
    const f=fixture('hostile-config');fs.appendFileSync(path.join(f.repo,'.git/config'),'\n[core]\nhooksPath = unapproved-hooks\n');
    await assert.rejects(migrate(f.options,f.dep),{code:'unsafe_repository'});assert(!fs.existsSync(f.backup));
  });
  await test('deleted_tracked_file_is_checkout_changed_not_raw_filesystem_error',async()=>{
    const f=fixture('deleted-source');fs.unlinkSync(path.join(f.repo,'momm/SKILL.md'));
    await assert.rejects(migrate(f.options,f.dep),{code:'checkout_changed'});assert(!fs.existsSync(f.backup));
  });
  await test('object_bytes_must_hash_to_their_git_object_name',async()=>{
    const f=fixture('corrupt-object'),oid=execute('git',['rev-parse','HEAD:momm/SKILL.md'],f.repo).trim(),blob=path.join(f.repo,'.git/objects',oid.slice(0,2),oid.slice(2));
    const payload=Buffer.from('# Substituted protocol\n');fs.chmodSync(blob,0o600);fs.writeFileSync(blob,deflateSync(Buffer.concat([Buffer.from(`blob ${payload.length}\0`),payload])));
    write(path.join(f.repo,'momm/SKILL.md'),payload);
    await assert.rejects(migrate(f.options,f.dep),{code:'unsafe_repository'});assert(!fs.existsSync(f.backup));
  });
  await test('rollback_serializes_even_when_original_owner_is_dead',async()=>{
    const f=fixture('recovery-race'),r=await applyFixture(f),kill=process.kill,rename=fs.renameSync;let attempted=false;
    write(r.paths.lock,JSON.stringify({journal:r.paths.journal,pid:424242}));
    process.kill=(pid,signal)=>{if(pid===424242)throw Object.assign(Error('dead fixture'),{code:'ESRCH'});return kill(pid,signal);};
    fs.renameSync=(from,to)=>{if(from===f.backup&&!attempted){attempted=true;assert.throws(()=>rollback(r.paths.journal),{code:'recovery_conflict'});}return rename(from,to);};
    try{assert.equal(rollback(r.paths.journal).status,'rolled_back');assert(attempted);}finally{process.kill=kill;fs.renameSync=rename;}
  });
  await test('missing_prerequisite_is_reported_before_repository_inspection',async()=>{
    const f=fixture('missing-git');let inspected=false;
    await assert.rejects(migrate(f.options,{...f.dep,check:()=>({status:'prerequisites_missing'}),run:()=>{inspected=true;throw Object.assign(Error('missing tool'),{code:'ENOENT'});}}),{code:'prerequisites_missing'});assert(!inspected);
  });
  await test('orphan_lock_without_journal_gets_inspection_not_impossible_rollback',async()=>{
    const f=fixture('orphan-lock');write(path.join(path.dirname(f.skill),'.momm-migration.lock'),JSON.stringify({pid:424242,journal:f.backup+'.momm-migration.json'}));
    await assert.rejects(migrate(f.options,f.dep),{code:'orphan_lock_no_journal'});assert(fs.existsSync(f.skill));
  });
  await test('fsck_timeout_is_environment_unavailable_not_tampering',async()=>{
    const f=fixture('fsck-timeout');await assert.rejects(migrate(f.options,{...f.dep,run:(c,a,r,o)=>{if(a[0]==='fsck')throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});return execute(c,a,r,o);}}),{code:'repository_check_unavailable',cause_code:'ETIMEDOUT'});
  });
  await test('untracked_files_do_not_go_live_under_the_new_discovery_link',async()=>{
    const f=fixture('untracked-file');write(path.join(f.repo,'momm/unapproved.js'),'// unapproved fixture');
    await assert.rejects(migrate(f.options,f.dep),{code:'checkout_changed'});assert(!fs.existsSync(f.backup));
  });
  await test('missing_old_protocol_is_an_actionable_scope_error',async()=>{
    const f=fixture('missing-old-protocol');fs.unlinkSync(path.join(f.skill,'SKILL.md'));await assert.rejects(migrate(f.options,f.dep),{code:'unsupported_scope'});assert(!fs.existsSync(f.backup));
  });
  console.log(JSON.stringify({passed:Object.values(results).every(v=>v===true),tests:Object.keys(results).length,results,skipped,note:'Signature service stubbed; real installers, receipts, Git files and discovery links exercised only in temporary synthetic projects. Platform or filesystem skips are reported explicitly.'},null,2));
}finally{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert(path.basename(resolved).startsWith('momm-migration-tests-'));fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3});}
