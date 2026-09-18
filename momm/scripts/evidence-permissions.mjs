// Permission inspection never repairs ACLs or claims protection
// against the owner, administrators, malware, or a later permission change.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Windows PowerShell decodes redirected stdin with the console's input code page, which is an OEM
// page unless the machine uses the UTF-8 system locale. Payloads are therefore pure ASCII: every
// other UTF-16 unit becomes a JSON \u escape, which ConvertFrom-Json restores exactly.
const asciiJson = (value) => JSON.stringify(value).replace(/[^\x20-\x7e]/g, (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`);

const WINDOWS_AUDIT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  # A PowerShell 7 parent can pass its module search path to Windows PowerShell.
  # Load the security module belonging to this system executable explicitly.
  Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $target = $request.path
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowed = @($me, 'S-1-5-18', 'S-1-5-32-544')
  # Optional, provider scratch only: account names (never part of this script text) whose Allow
  # rules are tolerated when they grant nothing beyond reading and traversing.
  $readOnlyNames = @($request.allow_read_only | Where-Object { $_ -is [string] -and $_.Length -gt 0 })
  $readOnlyMask = [int]([Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Synchronize)
  $leafBySid = @{}
  $tolerated = New-Object 'System.Collections.Generic.List[string]'
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
      if ($rule.AccessControlType -ne 'Allow' -or $allowed -contains $rule.IdentityReference.Value) { continue }
      $match = $null
      if ($readOnlyNames.Count -gt 0 -and (([int]$rule.FileSystemRights) -band (-bnot $readOnlyMask)) -eq 0) {
        $sid = $rule.IdentityReference.Value
        if (-not $leafBySid.ContainsKey($sid)) {
          $leaf = ''
          try { $account = $rule.IdentityReference.Translate([Security.Principal.NTAccount]).Value; $leaf = $account.Substring($account.LastIndexOf('\') + 1) } catch { $leaf = '' }
          $leafBySid[$sid] = $leaf
        }
        if ($leafBySid[$sid]) { foreach ($name in $readOnlyNames) { if ($name -ieq $leafBySid[$sid]) { $match = $name; break } } }
      }
      if (-not $match) { $reason = 'additional_principal'; break }
      if (-not $tolerated.Contains($match)) { $tolerated.Add($match) }
    }
    if ($item.PSIsContainer -and -not $reason) {
      $stage = 'list_entries'
      foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { $queue.Enqueue($child.FullName) }
    }
  }
  @{ verified = (-not $reason); reason = $reason; inspected = $count; tolerated = @($tolerated) } | ConvertTo-Json -Compress
} catch { @{ verified = $false; reason = 'inspection_unavailable'; inspected = $count; failure_kind = $_.CategoryInfo.Category.ToString(); failure_stage = $stage } | ConvertTo-Json -Compress }
`;

// allowReadOnlyPrincipals: optional, off by default, for provider scratch only and never for
// durable evidence. A sandboxing CLI (Codex on Windows) grants its own sandbox group read access
// to the directory it runs in; naming that group here tolerates an Allow rule for it only while
// the rule grants nothing beyond reading and traversing. Whatever was tolerated is returned.
function readOnlyPrincipals(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 4 || !value.every((name) => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9 _-]{0,63}$/.test(name))) {
    const error = new Error('allowReadOnlyPrincipals must be at most four plain account names (letters, digits, space, underscore, hyphen). Nothing was inspected.');
    error.code = 'MOMM_EVIDENCE_PERMISSIONS'; throw error;
  }
  return [...value];
}

export function inspectEvidencePermissions(directory, { platform = process.platform, fsx = fs, run = spawnSync, uid = process.getuid?.(), systemRoot = process.env.SystemRoot, allowReadOnlyPrincipals } = {}) {
  const target = path.resolve(directory);
  const readOnly = readOnlyPrincipals(allowReadOnlyPrincipals);
  try {
    const root = fsx.lstatSync(target);
    if (root.isSymbolicLink() || !root.isDirectory()) return { verified: false, reason: 'invalid_root' };
    if (platform === 'win32') {
      if (!systemRoot || !path.isAbsolute(systemRoot)) return { verified: false, reason: 'inspection_unavailable' };
      const exe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const result = run(exe, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_AUDIT], { input: asciiJson({ path: target, ...(readOnly.length ? { allow_read_only: readOnly } : {}) }), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16384 });
      if (result.status !== 0 || result.error) return { verified: false, reason: 'inspection_unavailable' };
      const value = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
      if (value.verified === true && Number.isInteger(value.inspected) && value.inspected > 0) {
        // Only a requested name may come back as tolerated; anything else is not a trusted answer.
        const names = value.tolerated ?? [];
        if (!Array.isArray(names)) return { verified: false, reason: 'inspection_unavailable' };
        const tolerated = [];
        for (const name of names) {
          const requested = typeof name === 'string' ? readOnly.find((allowed) => allowed.toLowerCase() === name.toLowerCase()) : undefined;
          if (!requested) return { verified: false, reason: 'inspection_unavailable' };
          if (!tolerated.some((entry) => entry.principal === requested)) tolerated.push({ principal: requested, rights: 'read_execute' });
        }
        return { verified: true, basis: 'windows_dacl', inspected: value.inspected, scope: `current user plus SYSTEM and local administrators at inspection time${tolerated.length ? '; named read-only principals tolerated' : ''}`, ...(tolerated.length ? { tolerated } : {}) };
      }
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
// options.allowReadOnlyPrincipals (see inspectEvidencePermissions) applies on Windows only; on
// POSIX it is validated and otherwise ignored.
export function requirePrivateScratch(directory, options = {}) {
  if (process.platform === 'win32') return requirePrivateEvidence(directory, options ?? undefined);
  readOnlyPrincipals(options?.allowReadOnlyPrincipals);
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
  const result = run(exe, ['-NoProfile','-NonInteractive','-Command',WINDOWS_CREATE_SCRATCH], {input:asciiJson({path:path.resolve(target)}),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16384});
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
# First pass changes nothing: the whole tree is listed and any link or junction refuses the run.
$entries=New-Object 'System.Collections.Generic.List[string]'
$queue=New-Object 'System.Collections.Generic.Queue[string]'
foreach($child in Get-ChildItem -LiteralPath $root.FullName -Force) { $queue.Enqueue($child.FullName) }
while($queue.Count -gt 0) {
  $item=Get-Item -LiteralPath $queue.Dequeue() -Force
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Evidence contains a link or junction; remove it first' }
  $entries.Add($item.FullName)
  if($entries.Count -ge 50000) { throw 'Evidence holds more entries than MOMM will change' }
  if($item.PSIsContainer) { foreach($child in Get-ChildItem -LiteralPath $item.FullName -Force) { $queue.Enqueue($child.FullName) } }
}
$dir=New-Object IO.DirectoryInfo($root.FullName)
if($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Evidence root changed while it was being protected' }
$acl=$dir.GetAccessControl($sections)
$acl.SetAccessRuleProtection($true,$false)
Clear-ExplicitRules $acl
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($owner,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
$dir.SetAccessControl($acl)
$count=1
# Second pass: each entry is read again immediately before its change, so an entry replaced by a
# link or junction since the first pass stops the run instead of being followed.
foreach($entry in $entries) {
  $item=Get-Item -LiteralPath $entry -Force
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Evidence changed while it was being protected' }
  $count++
  if($item.PSIsContainer) { $info=New-Object IO.DirectoryInfo($item.FullName) } else { $info=New-Object IO.FileInfo($item.FullName) }
  $inner=$info.GetAccessControl($sections)
  $inner.SetAccessRuleProtection($false,$false)
  Clear-ExplicitRules $inner
  $info.Refresh()
  if($info.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Evidence changed while it was being protected' }
  $info.SetAccessControl($inner)
}
@{ protected=$true; entries=$count } | ConvertTo-Json -Compress
`;
// Everything evidence --protect would change, surveyed before anything is changed. A hard-linked
// file shares its mode (POSIX) or security descriptor (NTFS) with every other name of that file,
// so changing it would reach outside the evidence folder; a link or junction leads outside it.
// Both are refused here, on every platform, while the tree is still untouched.
function surveyProtectTarget(target, fsx, fail) {
  const entries = [], pending = [target];
  const named = (entry) => path.relative(target, entry) || '.';
  while (pending.length) {
    const entry = pending.pop();
    let stat, names = [];
    try { stat = fsx.lstatSync(entry); if (stat.isDirectory() && !stat.isSymbolicLink()) names = fsx.readdirSync(entry); }
    catch { throw fail(`An evidence entry could not be read (${named(entry)}). Nothing was changed.`); }
    if (entries.length >= 50000) throw fail('Evidence holds more entries than MOMM will change. Nothing was changed.');
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw fail(`Evidence contains a link, junction or special file (${named(entry)}); remove it first. Nothing was changed.`);
    if (stat.isFile() && stat.nlink > 1) throw fail(`Evidence contains a hard-linked file (${named(entry)}): its permissions are shared with a name outside the evidence folder. Remove that entry first. Nothing was changed.`);
    entries.push({ entry, directory: stat.isDirectory(), dev: stat.dev, ino: stat.ino });
    for (const name of names) pending.push(path.join(entry, name));
  }
  return entries;
}
export function protectEvidence(directory, { platform = process.platform, run = spawnSync, systemRoot = process.env.SystemRoot, fsx = fs, uid = process.getuid?.() } = {}) {
  const target = path.resolve(directory);
  const fail = (message) => { const error = new Error(message); error.code = 'MOMM_EVIDENCE_PERMISSIONS'; return error; };
  if (path.basename(target) !== '.ensemble_reviews') throw fail('evidence --protect only ever changes a directory named .ensemble_reviews; nothing was changed.');
  let st; try { st = fsx.lstatSync(target); } catch { throw fail('There is no evidence folder here yet; MOMM creates it privately on the first review. Nothing was changed.'); }
  if (st.isSymbolicLink() || !st.isDirectory()) throw fail('The evidence path is not a plain directory; nothing was changed.');
  const before = inspectEvidencePermissions(target, { platform, run, systemRoot, fsx, uid });
  if (before.verified) return { changed: false, before, after: before };
  const entries = surveyProtectTarget(target, fsx, fail);
  if (platform === 'win32') {
    if (!systemRoot || !path.isAbsolute(systemRoot)) throw fail('Windows system directory is unavailable; nothing was changed.');
    const exe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = run(exe, ['-NoProfile','-NonInteractive','-Command',WINDOWS_PROTECT], {input:asciiJson({path:target}),encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16384});
    let ok = false; try { ok = result.status === 0 && !result.error && JSON.parse(result.stdout.replace(/^\uFEFF/, '')).protected === true; } catch {}
    if (!ok) throw fail('The evidence folder could not be protected (it may be owned by another account or in use). Some entries may have been changed; run evidence --status to see the current state.');
  } else {
    // Never chmod by pathname: between the survey and the change another process could replace an
    // entry (or one of its parents) with a link, and chmod would follow it. Each entry is opened
    // without following links, the descriptor is compared with the surveyed inode and link count,
    // and only that descriptor is changed. The root comes first, which also shuts other accounts out.
    const c = fs.constants;
    const flags = (c.O_RDONLY ?? 0) | (c.O_NOFOLLOW ?? 0) | (c.O_NONBLOCK ?? 0);
    const moved = () => fail('Evidence changed while it was being protected (an entry was replaced, linked or removed); the run stopped without touching that entry. Earlier entries may already have been changed; run evidence --status to see the current state.');
    for (const item of entries) {
      let fd;
      try {
        try { fd = fsx.openSync(item.entry, flags | (item.directory ? (c.O_DIRECTORY ?? 0) : 0)); }
        catch (error) {
          if (error?.code === 'EACCES' || error?.code === 'EPERM') throw fail(`An evidence entry could not be opened (${path.relative(target, item.entry) || '.'}); it may lack owner read permission or be owned by another account. Earlier entries may already have been changed; run evidence --status to see the current state.`);
          throw moved();
        }
        const now = fsx.fstatSync(fd);
        if (now.dev !== item.dev || now.ino !== item.ino || now.isDirectory() !== item.directory || (!item.directory && (!now.isFile() || now.nlink > 1))) throw moved();
        try { fsx.fchmodSync(fd, item.directory ? 0o700 : 0o600); }
        catch { throw fail('An evidence entry could not be changed (it may be owned by another account). Earlier entries may already have been changed; run evidence --status to see the current state.'); }
      } finally { if (fd !== undefined) { try { fsx.closeSync(fd); } catch {} } }
    }
  }
  const after = inspectEvidencePermissions(target, { platform, run, systemRoot, fsx, uid });
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
