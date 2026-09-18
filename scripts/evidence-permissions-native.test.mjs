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
import {inspectEvidencePermissions,createEvidenceWorkspace,requirePrivateScratch,preparePrivateEvidence,protectEvidence} from '../momm/scripts/evidence-permissions.mjs';
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
    fs.mkdirSync(path.join(evidence,'reports'));fs.writeFileSync(path.join(evidence,'reports','synthetic.json'),'{}');
    assert.equal(inspectEvidencePermissions(evidence).verified,true,'entries created inside inherit the private rules');
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
