// TEST SUPPORT ONLY. Creates an empty disposable directory before applying
// permissions. No caller-supplied existing path can be modified.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function privateTestFixture(prefix='momm-test-') {
  if(!/^momm-[a-z0-9-]+-$/.test(prefix))throw Error('Invalid synthetic fixture prefix');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));
  try {
    if(process.platform==='win32') {
      const script=String.raw`
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$directory=([Console]::In.ReadToEnd() | ConvertFrom-Json).path
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($owner,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
Set-Acl -LiteralPath $directory -AclObject $acl
`;
      const result=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{input:JSON.stringify({path:root}),encoding:'utf8',windowsHide:true,timeout:30000});
      if(result.status!==0||result.error)throw Error('Could not protect disposable synthetic test directory');
    } else fs.chmodSync(root,0o700);
    return root;
  } catch(error) {
    // Exact freshly allocated target only, never a caller's existing directory.
    fs.rmSync(root,{recursive:true,force:true});throw error;
  }
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.stdout.write(privateTestFixture(process.argv[2])+'\n');
}
