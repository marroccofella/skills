// Native, zero-provider test. Access changes target only freshly created
// disposable synthetic directories; never a user's evidence or home.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {inspectEvidencePermissions,createEvidenceWorkspace,createPrivateDirectory,requirePrivateScratch,preparePrivateEvidence,protectEvidence} from '../momm/scripts/evidence-permissions.mjs';
import {recordCompletion} from '../momm/scripts/governor.mjs';
import {plan,run} from '../momm/scripts/modality.mjs';
import {loadBaseline,effective} from '../momm/scripts/capabilities.mjs';

const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'momm-native-evidence-'));
const dispatcher=fileURLToPath(new URL('../momm/scripts/multi-review.mjs',import.meta.url));
const results=[];
const scratchToClean=[];
try {
  for(const kind of ['protected','broad']) {
    const project=path.join(fixture,kind), evidence=path.join(project,'.ensemble_reviews');
    fs.mkdirSync(evidence,{recursive:true,mode:0o700});
    if(process.platform==='win32') {
      const script=String.raw`
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$inputData=[Console]::In.ReadToEnd() | ConvertFrom-Json
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($owner,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
if($inputData.broad) {
  $users=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($users,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')))
}
Set-Acl -LiteralPath $inputData.path -AclObject $acl
`;
      const setup=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{input:JSON.stringify({path:evidence,broad:kind==='broad'}),encoding:'utf8',windowsHide:true,timeout:30000});
      assert.equal(setup.status,0,'Disposable ACL fixture preparation failed');
    } else fs.chmodSync(evidence,kind==='broad'?0o755:0o700);
    assert.equal(inspectEvidencePermissions(evidence).verified,kind==='protected');
    if(kind==='protected') {
      const input=path.join(project,'synthetic.gif');
      fs.writeFileSync(input,'SYNTHETIC ATTACHMENT ONLY');
      const source=fs.readFileSync(dispatcher,'utf8');
      const start=source.indexOf('function stageAttachments('),end=source.indexOf('\nfunction attachmentContractSection(',start);
      assert(start>=0&&end>start);
      const context=vm.createContext({fs,path,os,Buffer,createHash,MODALITY_MAX_BYTES:{image:1000},MODALITY_BY_EXTENSION:{gif:'image'},modalityOfFile:()=> 'image',
        requirePrivateScratch,createEvidenceWorkspace:prefix=>createEvidenceWorkspace(prefix,evidence)});
      vm.runInContext(source.slice(start,end)+';this.stage=stageAttachments;this.clean=cleanupAttachments;',context);
      const staged=context.stage([input]);
      assert(!path.resolve(staged.directory).startsWith(path.resolve(evidence)+path.sep),'Provider scratch must be outside durable evidence');
      assert.equal(inspectEvidencePermissions(staged.directory).verified,true);
      assert.equal(fs.readFileSync(staged.attachments[0].staged_path,'utf8'),'SYNTHETIC ATTACHMENT ONLY');
      const scratchDirectory=staged.directory;
      context.clean(staged);
      assert.equal(fs.existsSync(scratchDirectory),false);
      assert.deepEqual(fs.readdirSync(evidence),[],'Allocating scratch must not create provider-owned descendants in durable evidence');
      results.push({kind,case:'actual attachment staging stays protected and cleans up',passed:true});
      const changed=createEvidenceWorkspace('momm-review-',evidence);
      scratchToClean.push(changed);
      fs.writeFileSync(path.join(changed,'synthetic.txt'),'SYNTHETIC ONLY',{mode:0o600});
      if(process.platform==='win32') {
        // Modify DACL access only; Set-Acl can request SACL privileges that
        // an ordinary owner does not have. This is a fresh synthetic path.
        const p=spawnSync(path.join(process.env.SystemRoot,'System32/icacls.exe'),[changed,'/grant','*S-1-5-32-545:(OI)(CI)RX'],{encoding:'utf8',windowsHide:true,timeout:30000});
        assert.equal(p.status,0,'Synthetic scratch permission mutation failed: '+String(p.stderr).replaceAll(changed,'<synthetic scratch>'));
      } else fs.chmodSync(changed,0o755);
      assert.equal(inspectEvidencePermissions(changed).verified,false);
      assert.equal(inspectEvidencePermissions(evidence).verified,true,'Scratch mutation must not change durable evidence privacy');
      assert.throws(()=>context.clean({directory:changed}),/permissions could not be verified/);
      assert.equal(fs.existsSync(changed),false,'Unsafe scratch still must be removed');
      assert.equal(inspectEvidencePermissions(evidence).verified,true);
      results.push({kind,case:'changed scratch permissions refuse use and clean up without poisoning durable evidence',passed:true});
      const realpath=fs.realpathSync;
      try {
        fs.realpathSync=()=>{throw new Error('PRIVATE_PATH_SENTINEL');};
        assert.throws(()=>createEvidenceWorkspace('momm-review-',evidence),error=>error.code==='MOMM_EVIDENCE_PERMISSIONS'&&!error.message.includes('PRIVATE_PATH_SENTINEL'));
      } finally {fs.realpathSync=realpath;}
      results.push({kind,case:'injected path-resolution failure is reported without private diagnostics',passed:true});
    } else {
      assert.throws(()=>createEvidenceWorkspace('momm-attach-',evidence),{code:'MOMM_EVIDENCE_PERMISSIONS'});
      assert.deepEqual(fs.readdirSync(evidence),[]);
      const ledger=spawnSync(process.execPath,[fileURLToPath(new URL('../momm/scripts/ledger.mjs',import.meta.url))],{cwd:project,encoding:'utf8',windowsHide:true,timeout:30000});
      assert.notEqual(ledger.status,0,'Standalone ledger must refuse broadly readable evidence');
      assert.match(ledger.stderr,/cannot verify private evidence-folder permissions/);
      assert.deepEqual(fs.readdirSync(evidence),[],'Ledger refusal must not write or remove files');
      results.push({kind,case:'standalone ledger refuses unsafe evidence without mutation',passed:true});
      let governorRefused=false;
      try { recordCompletion(project,'rev_synthetic_missing'); }
      catch(error) { governorRefused=error.code==='MOMM_EVIDENCE_PERMISSIONS'; }
      const matrix=effective({baseline:loadBaseline(),machine:'synthetic',overlay:{entries:[],invalidated:[],stale:[]}});
      const planned=plan(matrix,{input:['text'],output:['text']},{prompt:'Synthetic permission control only'});
      let calls=0,mediaRefused=false;
      try { await run(planned,{consent:true,cwd:project,home:project,effective:matrix,exec:async()=>{calls++;return {code:0,stdout:'Synthetic answer',stderr:''};}}); }
      catch(error) { mediaRefused=error.code==='MOMM_EVIDENCE_PERMISSIONS'; }
      assert.deepEqual({governorRefused,mediaRefused,calls},{governorRefused:true,mediaRefused:true,calls:0},'Completion and media writers must refuse before private reads or provider calls');
      results.push({kind,case:'completion and media refuse unsafe storage before work',passed:true});
    }
    const repeats=kind==='protected'?2:1;
    for(let attempt=0;attempt<repeats;attempt++) {
      const args=[dispatcher,'--governor','codex','--reviewers','codex','--no-ui'];
      if(kind==='broad')args.push('--input','missing-synthetic-input.txt');
      const result=spawnSync(process.execPath,args,{cwd:project,input:'Synthetic review input only.\n',encoding:'utf8',timeout:90000,windowsHide:true,env:{...process.env,NO_UPDATE_CHECK:'1',MOMM_NO_UPDATE_CHECK:'1',DO_NOT_TRACK:'1'}});
      assert(!result.error,`Native dispatcher ${kind} fixture did not finish`);
      if(kind==='protected') {
        assert.equal(result.status,0,`Protected dispatcher failed: ${result.stderr}`);
        const report=JSON.parse(result.stdout);
        assert.equal(report.evidence.persisted,true);
        assert.equal(report.evidence.permissions.verified,true);
        assert(report.reviewers.every(r=>r.status==='self_excluded'));
        assert.equal(inspectEvidencePermissions(evidence).verified,true,'New evidence must retain its verified protection');
      } else {
        assert.equal(result.status,1);
        assert.match(result.stderr,/cannot verify private evidence-folder permissions/);
        assert.doesNotMatch(result.stderr,/ENOENT|missing-synthetic-input/);
        assert.equal(result.stdout.trim(),'');
        assert.deepEqual(fs.readdirSync(evidence),[],'Refusal must not create evidence');
      }
      results.push({kind,attempt:attempt+1,passed:true});
    }
  }
  // Release test 2026-09-18: a project whose folder is readable by other accounts (the normal
  // state of a Windows data drive, or a group-readable POSIX directory) must still get a private
  // evidence folder when MOMM creates it, verified by the REAL inspector, never a fake.
  {
    const project=path.join(fixture,'fresh-project');
    fs.mkdirSync(project,{recursive:true,mode:0o755});
    if(process.platform!=='win32') fs.chmodSync(project,0o755);
    const evidence=path.join(project,'.ensemble_reviews');
    const prepared=preparePrivateEvidence(evidence);
    assert.equal(prepared.verified,true,'MOMM-created evidence must verify as private');
    fs.mkdirSync(path.join(evidence,'reports'),{mode:0o700});fs.writeFileSync(path.join(evidence,'reports','synthetic.json'),'{}',{mode:0o600});
    assert.equal(inspectEvidencePermissions(evidence).verified,true,'owner-only entries inside stay verified (Windows: they inherit the private access list)');
    const args=[dispatcher,'--governor','codex','--reviewers','codex','--no-ui'];
    const dispatchProject=path.join(fixture,'fresh-dispatch');fs.mkdirSync(dispatchProject,{recursive:true,mode:0o755});
    const live=spawnSync(process.execPath,args,{cwd:dispatchProject,input:'Synthetic review input only.\n',encoding:'utf8',timeout:90000,windowsHide:true,env:{...process.env,NO_UPDATE_CHECK:'1',MOMM_NO_UPDATE_CHECK:'1',DO_NOT_TRACK:'1'}});
    assert.equal(live.status,0,'A first review in a project with no evidence folder must run: '+live.stderr);
    assert.equal(JSON.parse(live.stdout).evidence.permissions.verified,true);
    assert.equal(inspectEvidencePermissions(path.join(dispatchProject,'.ensemble_reviews')).verified,true);
    results.push({kind:'fresh',case:'MOMM-created evidence is private at creation and a first review runs',passed:true});
  }
  // The owner-invoked protect action repairs an existing broad folder (root protected, contents
  // inheriting), is idempotent, and is reachable through the dispatcher's evidence subcommand.
  {
    const evidence=path.join(fixture,'broad','.ensemble_reviews');
    fs.mkdirSync(path.join(evidence,'reports'),{recursive:true});fs.writeFileSync(path.join(evidence,'reports','synthetic.json'),'{}');
    if(process.platform!=='win32'){fs.chmodSync(evidence,0o755);fs.chmodSync(path.join(evidence,'reports'),0o755);fs.chmodSync(path.join(evidence,'reports','synthetic.json'),0o644);}
    assert.equal(inspectEvidencePermissions(evidence).verified,false,'fixture must start broad');
    const status=spawnSync(process.execPath,[dispatcher,'evidence','--status'],{cwd:path.join(fixture,'broad'),encoding:'utf8',timeout:60000,windowsHide:true});
    assert.equal(status.status,1);assert.match(JSON.parse(status.stdout).remediation,/evidence --protect/);
    const protectedRun=spawnSync(process.execPath,[dispatcher,'evidence','--protect'],{cwd:path.join(fixture,'broad'),encoding:'utf8',timeout:120000,windowsHide:true});
    assert.equal(protectedRun.status,0,'evidence --protect failed: '+protectedRun.stderr);
    assert.equal(JSON.parse(protectedRun.stdout).changed,true);
    assert.equal(inspectEvidencePermissions(evidence).verified,true,'the whole tree verifies after protect');
    assert.equal(protectEvidence(evidence).changed,false,'a second protect changes nothing');
    assert.throws(()=>protectEvidence(path.join(fixture,'broad')),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS','never a general permission tool');
    results.push({kind:'broad',case:'owner-invoked evidence --protect repairs and verifies',passed:true});
  }
  // Gate rev_20260918172020_ehti: a hard-linked file shares its mode/ACL with a name outside the
  // evidence folder, and a link or junction leads outside it. evidence --protect must refuse both
  // before changing anything. Every path here is inside this test's own disposable fixture.
  {
    const project=path.join(fixture,'linked'),evidence=path.join(project,'.ensemble_reviews');
    const report=path.join(evidence,'reports','synthetic.json'),outside=path.join(project,'outside.txt'),outsideDir=path.join(project,'outside-dir');
    fs.mkdirSync(path.join(evidence,'reports'),{recursive:true});fs.mkdirSync(outsideDir);
    fs.writeFileSync(report,'{}');fs.writeFileSync(outside,'harmless control');fs.writeFileSync(path.join(outsideDir,'synthetic.txt'),'harmless control');
    const inside=path.join(evidence,'zz-linked.txt');
    fs.linkSync(outside,inside);
    if(process.platform==='win32') {
      const grant=spawnSync(path.join(process.env.SystemRoot,'System32/icacls.exe'),[evidence,'/grant','*S-1-5-32-545:(OI)(CI)RX'],{encoding:'utf8',windowsHide:true,timeout:30000});
      assert.equal(grant.status,0,'Disposable broad fixture preparation failed');
    } else for(const [entry,mode] of [[evidence,0o755],[path.join(evidence,'reports'),0o755],[report,0o644],[outside,0o644],[outsideDir,0o755]])fs.chmodSync(entry,mode);
    // The access state of one fixture entry: the security descriptor on Windows, the mode elsewhere.
    const access=entry=>{
      if(process.platform!=='win32')return (fs.lstatSync(entry).mode&0o7777).toString(8);
      const script="$ErrorActionPreference='Stop'\nImport-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop\n(Get-Acl -LiteralPath ([Console]::In.ReadToEnd() | ConvertFrom-Json).path).Sddl";
      const read=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{input:JSON.stringify({path:entry}),encoding:'utf8',windowsHide:true,timeout:30000});
      assert.equal(read.status,0,'Could not read fixture access state');return read.stdout.trim();
    };
    const watched=[evidence,path.join(evidence,'reports'),report,outside,outsideDir];
    const snapshot=()=>watched.map(access);
    const before=snapshot();
    assert.equal(fs.lstatSync(inside).nlink,2,'fixture must hold a real hard link');
    assert.equal(inspectEvidencePermissions(evidence).verified,false,'fixture must start broad');
    assert.throws(()=>protectEvidence(evidence),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/hard-linked/.test(e.message)&&/[Nn]othing was changed/.test(e.message));
    assert.deepEqual(snapshot(),before,'a refused hard link must leave the outside name and the whole tree unchanged');
    const cli=spawnSync(process.execPath,[dispatcher,'evidence','--protect'],{cwd:project,encoding:'utf8',timeout:120000,windowsHide:true});
    assert.notEqual(cli.status,0,'evidence --protect must fail on a hard-linked file');
    assert.deepEqual(snapshot(),before);
    results.push({kind:'linked',case:'hard-linked file refused before any change; outside name untouched',passed:true});
    fs.unlinkSync(inside);
    // A junction (Windows) or symlink deep in the tree: refused before anything is changed.
    const link=path.join(evidence,'reports','zz-external');
    fs.symlinkSync(outsideDir,link,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>protectEvidence(evidence),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&/link/.test(e.message)&&/[Nn]othing was changed/.test(e.message));
    assert.deepEqual(snapshot(),before,'a refused link must leave the tree and its target unchanged');
    if(process.platform==='win32') {
      // The protect script repeats the link check itself, again before changing anything, so it
      // does not depend on the Node survey. Hide the junction from the survey to reach it.
      const blind={...fs,lstatSync:entry=>path.resolve(entry)===link?fs.statSync(entry):fs.lstatSync(entry)};
      assert.throws(()=>protectEvidence(evidence,{fsx:blind}),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS');
      assert.deepEqual(snapshot(),before,'the protect script must refuse a junction before changing the root');
    }
    results.push({kind:'linked',case:'link or junction refused before any change',passed:true});
    fs.unlinkSync(link);
    assert.equal(fs.existsSync(path.join(outsideDir,'synthetic.txt')),true,'removing the link must not remove its target');
    assert.equal(protectEvidence(evidence).changed,true,'a plain tree is still protected');
    assert.equal(inspectEvidencePermissions(evidence).verified,true);
    assert.deepEqual([access(outside),access(outsideDir)],[before[3],before[4]],'protection never reaches outside the evidence folder');
    results.push({kind:'linked',case:'plain tree protected after links removed',passed:true});
  }
  // Gate rev_20260918172020_ehti: the path travels to Windows PowerShell as JSON on stdin, and
  // [Console]::In decodes stdin with the console's OEM code page unless the machine runs the UTF-8
  // system locale. A non-ASCII folder name (a user profile, a project) must survive that. The OEM
  // condition is forced here so the result does not depend on this machine's locale settings.
  if(process.platform==='win32') {
    const oem=(exe,args,options)=>spawnSync(exe,[...args.slice(0,-1),'[Console]::InputEncoding=[Text.Encoding]::GetEncoding(850)\n'+args.at(-1)],options);
    const project=path.join(fixture,'pro\u00f8j\u00e9ct-\u65e5\u672c');fs.mkdirSync(project);
    const evidence=path.join(project,'.ensemble_reviews');
    assert.equal(preparePrivateEvidence(evidence,{run:oem}).verified,true,'a non-ASCII project path must be created privately and verified under an OEM console code page');
    assert.equal(inspectEvidencePermissions(evidence,{run:oem}).verified,true);
    assert.equal(protectEvidence(evidence,{run:oem}).changed,false);
    const temp=path.join(fixture,'t\u00eamp-\u00f8');fs.mkdirSync(temp);
    const child=`const {privateTestFixture}=await import(${JSON.stringify(new URL('../momm/scripts/private-test-fixture.mjs',import.meta.url).href)});
const {spawnSync}=await import('node:child_process');const fs=await import('node:fs');
const oem=(exe,args,options)=>spawnSync(exe,[...args.slice(0,-1),'[Console]::InputEncoding=[Text.Encoding]::GetEncoding(850)\\n'+args.at(-1)],options);
const made=privateTestFixture('momm-oem-fixture-',{run:oem});process.stdout.write(JSON.stringify({exists:fs.existsSync(made)}));fs.rmSync(made,{recursive:true,force:true});`;
    const made=spawnSync(process.execPath,['--input-type=module','-e',child],{encoding:'utf8',timeout:60000,windowsHide:true,env:{...process.env,TEMP:temp,TMP:temp}});
    assert.equal(made.status,0,'privateTestFixture must work under a non-ASCII temp directory and an OEM console code page');
    assert.deepEqual(JSON.parse(made.stdout),{exists:true});
    results.push({kind:'non-ascii',case:'non-ASCII paths survive an OEM console code page (inspector, private creation, test fixture)',passed:true});
  }
  // Provider scratch allowance (Windows): a sandboxing CLI grants its sandbox group read access to
  // the directory it runs in. Opt-in by account name, read-only rights only, reported when used,
  // never the default. The built-in Users group stands in for the sandbox group; its (possibly
  // localized) account name is resolved at run time.
  if(process.platform==='win32') {
    const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),icacls=path.join(process.env.SystemRoot,'System32/icacls.exe');
    const named=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',"$n=(New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')).Translate([Security.Principal.NTAccount]).Value; $n.Substring($n.LastIndexOf('\\')+1)"],{encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(named.status,0,'Could not resolve the built-in Users group name');
    const leaf=named.stdout.trim();
    if(!/^[A-Za-z][A-Za-z0-9 _-]{0,63}$/.test(leaf)) results.push({kind:'allowance',case:'skipped: the localized Users group name is outside the accepted plain-name form',passed:true,skipped:true});
    else {
      const scratch=path.join(fixture,'allowance-scratch');
      assert.equal(createPrivateDirectory(scratch),true);
      fs.mkdirSync(path.join(scratch,'inner'));fs.writeFileSync(path.join(scratch,'inner','synthetic.txt'),'SYNTHETIC ONLY');
      assert.equal(inspectEvidencePermissions(scratch).verified,true,'fixture must start private');
      const grant=rights=>{const p=spawnSync(icacls,[scratch,'/grant','*S-1-5-32-545:(OI)(CI)'+rights],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(p.status,0,'Synthetic scratch grant failed');};
      grant('RX');
      const allow={allowReadOnlyPrincipals:[leaf.toUpperCase()]};
      assert.deepEqual(inspectEvidencePermissions(scratch),{verified:false,reason:'additional_principal',inspected:1},'never tolerated by default');
      assert.throws(()=>requirePrivateScratch(scratch),{code:'MOMM_EVIDENCE_PERMISSIONS'});
      const tolerated=inspectEvidencePermissions(scratch,allow);
      assert.equal(tolerated.verified,true,'a named read-only rule is tolerated: '+JSON.stringify(tolerated));
      assert.equal(tolerated.inspected,3,'the whole tree is still inspected, inherited rules included');
      assert.deepEqual(tolerated.tolerated,[{principal:leaf.toUpperCase(),rights:'read_execute'}]);
      assert.deepEqual(requirePrivateScratch(scratch,allow).tolerated,tolerated.tolerated);
      assert.equal(inspectEvidencePermissions(scratch,{allowReadOnlyPrincipals:['SomeOtherGroup']}).reason,'additional_principal','only the named principal is tolerated');
      grant('M');
      assert.deepEqual(inspectEvidencePermissions(scratch,allow),{verified:false,reason:'additional_principal',inspected:1},'a write-capable rule for the same principal stays refused');
      assert.throws(()=>requirePrivateScratch(scratch,allow),e=>e.code==='MOMM_EVIDENCE_PERMISSIONS'&&e.reason==='additional_principal');
      results.push({kind:'allowance',case:'named read-only principal tolerated only on request; write-capable rule refused',passed:true});
    }
  }
  console.log(JSON.stringify({passed:true,scope:'native disposable storage controls; self-excluded route; no provider calls',results}));
} finally {
  for(const scratch of scratchToClean) {
    assert.equal(path.dirname(scratch),fs.realpathSync(os.tmpdir()));
    assert(path.basename(scratch).startsWith('momm-review-'));
    fs.rmSync(scratch,{recursive:true,force:true});
  }
  assert.equal(path.dirname(fixture),path.resolve(os.tmpdir()));
  assert(path.basename(fixture).startsWith('momm-native-evidence-'));
  fs.rmSync(fixture,{recursive:true,force:true});
}
