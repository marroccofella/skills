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
import {inspectEvidencePermissions,createEvidenceWorkspace} from '../momm/scripts/evidence-permissions.mjs';
import {recordCompletion} from '../momm/scripts/governor.mjs';
import {plan,run} from '../momm/scripts/modality.mjs';
import {loadBaseline,effective} from '../momm/scripts/capabilities.mjs';

const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'momm-native-evidence-'));
const dispatcher=fileURLToPath(new URL('../momm/scripts/multi-review.mjs',import.meta.url));
const results=[];
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
        createEvidenceWorkspace:prefix=>createEvidenceWorkspace(prefix,evidence)});
      vm.runInContext(source.slice(start,end)+';this.stage=stageAttachments;this.clean=cleanupAttachments;',context);
      const staged=context.stage([input]);
      assert.equal(path.dirname(staged.directory),path.join(evidence,'staging'));
      assert.equal(inspectEvidencePermissions(staged.directory).verified,true);
      assert.equal(fs.readFileSync(staged.attachments[0].staged_path,'utf8'),'SYNTHETIC ATTACHMENT ONLY');
      context.clean(staged);
      assert.deepEqual(fs.readdirSync(path.join(evidence,'staging')),[]);
      results.push({kind,case:'actual attachment staging stays protected and cleans up',passed:true});
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
  console.log(JSON.stringify({passed:true,scope:'native disposable storage controls; self-excluded route; no provider calls',results}));
} finally {
  assert.equal(path.dirname(fixture),path.resolve(os.tmpdir()));
  assert(path.basename(fixture).startsWith('momm-native-evidence-'));
  fs.rmSync(fixture,{recursive:true,force:true});
}
