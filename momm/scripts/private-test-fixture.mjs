// TEST SUPPORT ONLY. Creates an empty disposable directory before applying
// permissions. No caller-supplied existing path can be modified.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Windows launch guard (see launch-guard.mjs): a bare command launched without a shell is looked up in
// THIS process's current directory before PATH unless this process carries the variable. Kept inline so
// a script copied on its own still runs.
if (process.platform === "win32" && !process.env.NoDefaultCurrentDirectoryInExePath) process.env.NoDefaultCurrentDirectoryInExePath = "1";
export function privateTestFixture(prefix='momm-test-',{run=spawnSync}={}) {
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
      // Windows PowerShell decodes stdin with the console's OEM code page unless the machine uses
      // the UTF-8 system locale, so the payload is pure ASCII (JSON escapes restore the exact path).
      const payload=JSON.stringify({path:root}).replace(/[^\x20-\x7e]/g,unit=>'\\u'+unit.charCodeAt(0).toString(16).padStart(4,'0'));
      const result=run(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{input:payload,encoding:'utf8',windowsHide:true,timeout:30000});
      // Status and error code only: stderr can name private paths.
      if(result.status!==0||result.error)throw Error(`Could not protect disposable synthetic test directory (status ${result.status??'none'}${result.error?.code?`, ${result.error.code}`:''})`);
    } else fs.chmodSync(root,0o700);
    // An entry that appeared before the access list or mode was applied keeps its own access.
    if(fs.readdirSync(root).length)throw Error('Disposable synthetic test directory is not empty after protection; refused');
    return root;
  } catch(error) {
    // Exact freshly allocated target only, never a caller's existing directory.
    fs.rmSync(root,{recursive:true,force:true});throw error;
  }
}
// argv[1] need not be a path (node -e ... -- argument); an unresolvable one is simply not this file.
const isEntrypoint=()=>{try{return !!process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url));}catch{return false;}};
if(isEntrypoint()) {
  process.stdout.write(privateTestFixture(process.argv[2])+'\n');
}
