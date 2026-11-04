const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ensurePrivate, powershell, psQuote, safeEnv } = require('../scripts/runtime');
if (process.platform !== 'win32') { console.log('SKIP: native Windows ACL checks'); process.exit(0); }
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-acl-'));
function ps(command) {
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; $env:PSModulePath=Join-Path $PSHOME 'Modules'; " + command], { encoding: 'utf8', env: safeEnv(), timeout: 60000, windowsHide: true });
  const failureClass = result.error?.code || result.stderr?.match(/FullyQualifiedErrorId\s*:\s*([^\r\n]+)/)?.[1] || result.status;
  assert(!result.error && result.status === 0, 'Native ACL fixture setup/check failed (' + failureClass + ')');
  return result.stdout.trim();
}
try {
  ps('$dir=' + psQuote(fixture) + "; $acl=[IO.Directory]::GetAccessControl($dir,[System.Security.AccessControl.AccessControlSections]::Access); $sid=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545'); $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'))); [IO.Directory]::SetAccessControl($dir,$acl)");
  const fresh = path.join(fixture, 'fresh'); ensurePrivate(fresh);
  const extra = ps('$acl=Get-Acl -LiteralPath ' + psQuote(fresh) + "; $owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; @($acl.Access|Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @($owner,'S-1-5-18','S-1-5-32-544')}).Count");
  assert.equal(extra, '0');
  const broad = path.join(fixture, 'broad'); fs.mkdirSync(broad);
  assert.throws(() => ensurePrivate(broad), /grants access/);
  assert.deepEqual(fs.readdirSync(broad), []);
  const link = path.join(fixture, 'junction'); fs.symlinkSync(fresh, link, 'junction');
  assert.throws(() => ensurePrivate(link), /must not contain links/);
  fs.unlinkSync(link);
  // Alter a previously verified ACL; the same process must see the change on its next check.
  ps('$dir=' + psQuote(fresh) + "; $acl=[IO.Directory]::GetAccessControl($dir,[System.Security.AccessControl.AccessControlSections]::Access); $sid=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545'); $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'))); [IO.Directory]::SetAccessControl($dir,$acl)");
  assert.throws(() => ensurePrivate(fresh), /grants access/);
  // Installer under a backups folder whose private ACL has no inheritable entries (PR #41 review
  // reproduction): the installed destination must still pass the permission check.
  const installParent = path.join(fixture, 'installer'); const backups = path.join(installParent, '.dom-tts-backups');
  fs.mkdirSync(backups, { recursive: true });
  ps('$dir=' + psQuote(backups) + "; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); foreach($sid in @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')) { $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier($sid)),'FullControl','None','None','Allow'))) }; [IO.Directory]::SetAccessControl($dir,$acl)");
  ensurePrivate(backups);
  const installed = require('../scripts/install').install({ dir: installParent });
  assert.doesNotThrow(() => ensurePrivate(installed.destination), 'installed destination under a non-inheriting private backups folder is not private');
  console.log('PASS: broad-parent new state, broad-existing refusal, junction refusal, same-process ACL revalidation and private install destination under a non-inheriting backups folder');
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
