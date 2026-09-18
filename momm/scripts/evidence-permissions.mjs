// Permission inspection never repairs ACLs or claims protection
// against the owner, administrators, malware, or a later permission change.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import { spawnSync } from 'node:child_process';

const WINDOWS_AUDIT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  # A PowerShell 7 parent can pass its module search path to Windows PowerShell.
  # Load the security module belonging to this system executable explicitly.
  Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
  $target = ([Console]::In.ReadToEnd() | ConvertFrom-Json).path
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowed = @($me, 'S-1-5-18', 'S-1-5-32-544')
  $queue = New-Object 'System.Collections.Generic.Queue[string]'
  $queue.Enqueue($target)
  $count = 0
  $reason = $null
  while ($queue.Count -gt 0 -and -not $reason) {
    $stage = 'read_entry'
    $item = Get-Item -LiteralPath $queue.Dequeue() -Force
    $count++
    if ($count -gt 50000) { $reason = 'inspection_limit'; break }
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $reason = 'linked_entry'; break }
    $stage = 'read_acl'
    $acl = Get-Acl -LiteralPath $item.FullName
    $stage = 'read_owner'
    if ($allowed -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { $reason = 'different_owner'; break }
    $stage = 'read_rules'
    $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    if ($rules.Count -eq 0) { $reason = 'no_access_rules'; break }
    foreach ($rule in $rules) {
      if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value) { $reason = 'additional_principal'; break }
    }
    if ($item.PSIsContainer -and -not $reason) {
      $stage = 'list_entries'
      foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { $queue.Enqueue($child.FullName) }
    }
  }
  @{ verified = (-not $reason); reason = $reason; inspected = $count } | ConvertTo-Json -Compress
} catch { @{ verified = $false; reason = 'inspection_unavailable'; inspected = $count; failure_kind = $_.CategoryInfo.Category.ToString(); failure_stage = $stage } | ConvertTo-Json -Compress }
`;

export function inspectEvidencePermissions(directory, { platform = process.platform, fsx = fs, run = spawnSync, uid = process.getuid?.(), systemRoot = process.env.SystemRoot } = {}) {
  const target = path.resolve(directory);
  try {
    const root = fsx.lstatSync(target);
    if (root.isSymbolicLink() || !root.isDirectory()) return { verified: false, reason: 'invalid_root' };
    if (platform === 'win32') {
      if (!systemRoot || !path.isAbsolute(systemRoot)) return { verified: false, reason: 'inspection_unavailable' };
      const exe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const result = run(exe, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_AUDIT], { input: JSON.stringify({ path: target }), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16384 });
      if (result.status !== 0 || result.error) return { verified: false, reason: 'inspection_unavailable' };
      const value = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
      if (value.verified === true && Number.isInteger(value.inspected) && value.inspected > 0) return { verified: true, basis: 'windows_dacl', inspected: value.inspected, scope: 'current user plus SYSTEM and local administrators at inspection time' };
      const reasons = new Set(['inspection_limit', 'linked_entry', 'different_owner', 'additional_principal', 'no_access_rules', 'inspection_unavailable']);
      const failureKinds = new Set(['PermissionDenied', 'ObjectNotFound', 'InvalidArgument', 'InvalidOperation', 'ResourceUnavailable', 'NotSpecified']);
      const stages = new Set(['read_entry', 'read_acl', 'read_owner', 'read_rules', 'list_entries']);
      return { verified: false, reason: reasons.has(value.reason) ? value.reason : 'inspection_unavailable', ...(failureKinds.has(value.failure_kind) ? { failure_kind: value.failure_kind } : {}), ...(stages.has(value.failure_stage) ? { failure_stage: value.failure_stage } : {}), ...(Number.isInteger(value.inspected) ? { inspected: value.inspected } : {}) };
    }
    if (!Number.isInteger(uid)) return { verified: false, reason: 'inspection_unavailable' };
    const pending = [target]; let inspected = 0;
    while (pending.length) {
      const file = pending.pop(), stat = fsx.lstatSync(file);
      if (++inspected > 50000) return { verified: false, reason: 'inspection_limit' };
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink > 1)) return { verified: false, reason: 'linked_or_special_entry' };
      if (stat.uid !== uid || (stat.mode & 0o077) !== 0) return { verified: false, reason: 'permissions_not_private' };
      if (stat.isDirectory()) for (const entry of fsx.readdirSync(file)) pending.push(path.join(file, entry));
    }
    return { verified: true, basis: 'posix_mode', inspected, scope: 'owner mode bits at inspection time; privileged access and ACL extensions not certified' };
  } catch { return { verified: false, reason: 'inspection_unavailable' }; }
}

const REASON_WORDS = {
  additional_principal: 'other accounts or groups can access it (on Windows this is usual for folders that inherit their permissions, for example on a second drive)',
  different_owner: 'it is owned by another account',
  no_access_rules: 'it has no access rules MOMM can read',
  linked_entry: 'it contains a link or junction',
  linked_or_special_entry: 'it contains a link, a hard-linked file or a special file',
  permissions_not_private: 'its mode allows group or other access',
  inspection_limit: 'it holds more entries than MOMM will inspect',
  invalid_root: 'it is not a plain directory',
  inspection_unavailable: 'its permissions could not be inspected',
};
// What the owner can do about a refusal. MOMM never changes permissions on its own; the protect
// action below runs only when the owner types it.
export function evidenceRemediation(directory, platform = process.platform) {
  const target = path.resolve(directory);
  const action = 'node "<installed-momm>/scripts/multi-review.mjs" evidence --protect';
  return platform === 'win32'
    ? `Run ${action} from the project (it restricts ${target} to your account and makes everything inside inherit that), or move the project's evidence to a location only you can access.`
    : `Run ${action} from the project (equivalent to: chmod -R go-rwx "${target}"), or move the project's evidence to a location only you can access.`;
}
export function requirePrivateEvidence(directory, options) {
  const result = inspectEvidencePermissions(directory, options);
  if (!result.verified) {
    const why = REASON_WORDS[result.reason] ?? 'its permissions could not be verified';
    const error = new Error(`MOMM cannot verify private evidence-folder permissions (${result.reason}): ${why}. No permission changes were made and no review input was read or sent. ${evidenceRemediation(directory, options?.platform)}`);
    error.code = 'MOMM_EVIDENCE_PERMISSIONS';
    error.reason = result.reason;
    throw error;
  }
  return result;
}

// POSIX owner-only directory traversal protects its descendants even when a
// CLI writes mode-0644 files inside it. Windows bypass-traverse semantics need
// the full DACL walk, including explicit grants on descendants. Neither check
// is isolation from hostile processes running as the owner or administrators.
export function requirePrivateScratch(directory) {
  if (process.platform === 'win32') return requirePrivateEvidence(directory);
  try {
    const st = fs.lstatSync(directory);
    if (!st.isSymbolicLink() && st.isDirectory() && st.uid === process.getuid?.() && (st.mode & 0o077) === 0) return {verified:true,basis:'posix_private_ancestor'};
  } catch {}
  const error = new Error('Private scratch permissions could not be verified.');
  error.code = 'MOMM_EVIDENCE_PERMISSIONS'; throw error;
}

export function preparePrivateEvidence(directory, options = {}) {
  const fsx = options.fsx ?? fs, platform = options.platform ?? process.platform;
  const refuse = () => {
    const error = new Error('MOMM cannot prepare its evidence directory. No review input has been read or sent. Choose an accessible private project location.');
    error.code = 'MOMM_EVIDENCE_PERMISSIONS'; return error;
  };
  if (platform === 'win32') {
    // mkdir would inherit the parent's access rules, which on most Windows volumes include other
    // accounts, and MOMM never repairs permissions afterwards. So a folder MOMM creates itself is
    // created with its private DACL in the same call; a folder that already exists is left alone.
    const target = path.resolve(directory);
    let exists = true;
    try { const st = fsx.lstatSync(target); if (st.isSymbolicLink() || !st.isDirectory()) throw refuse(); }
    catch (e) { if (e?.code === 'ENOENT') exists = false; else throw e?.code === 'MOMM_EVIDENCE_PERMISSIONS' ? e : refuse(); }
    if (!exists) {
      try { fsx.mkdirSync(path.dirname(target), { recursive: true }); } catch { throw refuse(); }
      let created = false;
      try { created = (options.createPrivate ?? createPrivateDirectory)(target, options) === true; } catch { created = false; }
      if (!created) {
        // Another MOMM process may have created it in the meantime; only then fall through to inspection.
        let now = false; try { now = fsx.lstatSync(target).isDirectory(); } catch {}
        if (!now) throw refuse();
      }
    }
    return requirePrivateEvidence(target, options);
  }
  try { fsx.mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  catch { throw refuse(); }
  // mode 0700 alone is not verification.
  return requirePrivateEvidence(directory, options);
}

// CreateDirectoryW applies the DACL at creation, and refuses an existing path.
// No Set-Acl repair, inherited broad-access window, or caller-owned directory.
const WINDOWS_CREATE_SCRATCH = String.raw`
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$target=([Console]::In.ReadToEnd() | ConvertFrom-Json).path
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MommPrivateScratch {
  [StructLayout(LayoutKind.Sequential)] public struct Attributes {
    public int nLength;
    public IntPtr lpSecurityDescriptor;
    [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool CreateDirectoryW(string path, ref Attributes attributes);
}
'@
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($owner,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
[byte[]]$descriptor=$acl.GetSecurityDescriptorBinaryForm()
$handle=[Runtime.InteropServices.GCHandle]::Alloc($descriptor,[Runtime.InteropServices.GCHandleType]::Pinned)
try {
  $attributes=New-Object MommPrivateScratch+Attributes
  $attributes.nLength=[Runtime.InteropServices.Marshal]::SizeOf($attributes)
  $attributes.lpSecurityDescriptor=$handle.AddrOfPinnedObject()
  $attributes.bInheritHandle=$false
  if(-not [MommPrivateScratch]::CreateDirectoryW($target,[ref]$attributes)) { throw 'Private scratch creation refused' }
  '{"created":true}'
} finally { $handle.Free() }
`;

// One private directory, DACL applied at creation; refuses an existing path. Windows only.
export function createPrivateDirectory(target, { run = spawnSync, systemRoot = process.env.SystemRoot } = {}) {
  if (!systemRoot || !path.isAbsolute(systemRoot)) return false;
  const exe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = run(exe, ['-NoProfile','-NonInteractive','-Command',WINDOWS_CREATE_SCRATCH], {input:JSON.stringify({path:path.resolve(target)}),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16384});
  try { return result.status === 0 && !result.error && JSON.parse(result.stdout.replace(/^\uFEFF/, '')).created === true; } catch { return false; }
}

// Explicit, owner-invoked protection of an EXISTING evidence folder ("evidence --protect").
// Never called by a review. Only ever touches a directory named .ensemble_reviews: the root gets
// a protected DACL for the current account alone, every entry inside is reset to inherit from it.
const WINDOWS_PROTECT = String.raw`
$ErrorActionPreference='Stop'
$target=([Console]::In.ReadToEnd() | ConvertFrom-Json).path
$root=Get-Item -LiteralPath $target -Force
if(-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Evidence root is not a plain directory' }
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
# Only the Access section is read and written: no owner change, no audit rules, so no
# SeSecurityPrivilege or SeRestorePrivilege is needed. A folder owned by another account is
# reported by the inspector afterwards rather than seized here.
$sections=[Security.AccessControl.AccessControlSections]::Access
function Clear-ExplicitRules($acl) {
  foreach($rule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleSpecific($rule) }
}
$dir=New-Object IO.DirectoryInfo($root.FullName)
$acl=$dir.GetAccessControl($sections)
$acl.SetAccessRuleProtection($true,$false)
Clear-ExplicitRules $acl
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($owner,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
$dir.SetAccessControl($acl)
$count=1
$queue=New-Object 'System.Collections.Generic.Queue[string]'
foreach($child in Get-ChildItem -LiteralPath $root.FullName -Force) { $queue.Enqueue($child.FullName) }
while($queue.Count -gt 0) {
  $item=Get-Item -LiteralPath $queue.Dequeue() -Force
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Evidence contains a link or junction; remove it first' }
  $count++
  if($count -gt 50000) { throw 'Evidence holds more entries than MOMM will change' }
  if($item.PSIsContainer) { $info=New-Object IO.DirectoryInfo($item.FullName) } else { $info=New-Object IO.FileInfo($item.FullName) }
  $inner=$info.GetAccessControl($sections)
  $inner.SetAccessRuleProtection($false,$false)
  Clear-ExplicitRules $inner
  $info.SetAccessControl($inner)
  if($item.PSIsContainer) { foreach($child in Get-ChildItem -LiteralPath $item.FullName -Force) { $queue.Enqueue($child.FullName) } }
}
@{ protected=$true; entries=$count } | ConvertTo-Json -Compress
`;
export function protectEvidence(directory, { platform = process.platform, run = spawnSync, systemRoot = process.env.SystemRoot, fsx = fs } = {}) {
  const target = path.resolve(directory);
  const fail = (message) => { const error = new Error(message); error.code = 'MOMM_EVIDENCE_PERMISSIONS'; return error; };
  if (path.basename(target) !== '.ensemble_reviews') throw fail('evidence --protect only ever changes a directory named .ensemble_reviews; nothing was changed.');
  let st; try { st = fsx.lstatSync(target); } catch { throw fail('There is no evidence folder here yet; MOMM creates it privately on the first review. Nothing was changed.'); }
  if (st.isSymbolicLink() || !st.isDirectory()) throw fail('The evidence path is not a plain directory; nothing was changed.');
  const before = inspectEvidencePermissions(target, { platform, run, systemRoot, fsx });
  if (before.verified) return { changed: false, before, after: before };
  if (platform === 'win32') {
    if (!systemRoot || !path.isAbsolute(systemRoot)) throw fail('Windows system directory is unavailable; nothing was changed.');
    const exe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = run(exe, ['-NoProfile','-NonInteractive','-Command',WINDOWS_PROTECT], {input:JSON.stringify({path:target}),encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16384});
    let ok = false; try { ok = result.status === 0 && !result.error && JSON.parse(result.stdout.replace(/^\uFEFF/, '')).protected === true; } catch {}
    if (!ok) throw fail('The evidence folder could not be protected (it may be owned by another account or in use). Some entries may have been changed; run evidence --status to see the current state.');
  } else {
    const pending = [target];
    while (pending.length) {
      const entry = pending.pop(), stat = fsx.lstatSync(entry);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw fail('Evidence contains a link or special file; remove it first. Earlier entries may already have been changed.');
      fsx.chmodSync(entry, stat.isDirectory() ? 0o700 : 0o600);
      if (stat.isDirectory()) for (const name of fsx.readdirSync(entry)) pending.push(path.join(entry, name));
    }
  }
  const after = inspectEvidencePermissions(target, { platform, run, systemRoot, fsx });
  if (!after.verified) throw fail(`Protection was applied but verification still fails (${after.reason}).`);
  return { changed: true, before, after };
}

// Durable evidence and provider scratch have independent permission trees.
// Allocate a fresh, privately protected temp directory before writing input;
// never use an unverified fallback or change any existing directory's ACL.
export function createEvidenceWorkspace(prefix, directory = path.resolve('.ensemble_reviews')) {
  if (!/^momm-[a-z]+-$/.test(prefix)) throw new Error('Invalid review workspace prefix');
  requirePrivateEvidence(directory);
  let parent, evidence;
  try { parent = fs.realpathSync(os.tmpdir()); evidence = fs.realpathSync(directory); }
  catch {
    const error = new Error('Could not resolve a separate private scratch location. No input was staged.');
    error.code = 'MOMM_EVIDENCE_PERMISSIONS'; throw error;
  }
  const relative = path.relative(evidence, parent);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    const error = new Error('Provider scratch must be outside durable evidence; choose a separate temporary directory.');
    error.code = 'MOMM_EVIDENCE_PERMISSIONS'; throw error;
  }
  let created;
  if (process.platform === 'win32') {
    if (!process.env.SystemRoot || !path.isAbsolute(process.env.SystemRoot)) {
      const error = new Error('Windows system directory is unavailable; private scratch creation refused. No input was staged.');
      error.code = 'MOMM_EVIDENCE_PERMISSIONS'; throw error;
    }
    const candidate = path.join(parent, prefix + randomUUID());
    const confirmed = createPrivateDirectory(candidate, { run: spawnSync, systemRoot: process.env.SystemRoot });
    if (!confirmed) {
      const error = new Error('Could not confirm creation of a private scratch directory. No input was staged and no existing permissions were changed; an empty allocation may remain.');
      error.code = 'MOMM_EVIDENCE_PERMISSIONS'; throw error;
    }
    created = candidate;
  } else {
    try { created = fs.mkdtempSync(path.join(parent, prefix)); }
    catch { const error = new Error('Could not create private scratch storage. No input was staged.'); error.code = 'MOMM_EVIDENCE_PERMISSIONS'; throw error; }
  }
  try { requirePrivateEvidence(created); return created; }
  catch (error) {
    try { fs.rmSync(created, { recursive: true, force: true }); }
    catch { const cleanup = new Error('Private scratch verification and cleanup failed; an unused allocation may remain. No input was staged.'); cleanup.code = 'MOMM_EVIDENCE_PERMISSIONS'; throw cleanup; }
    throw error;
  }
}
