// Read-only permission inspection. Never repairs ACLs or claims protection
// against the owner, administrators, malware, or a later permission change.
import fs from 'node:fs';
import path from 'node:path';
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

export function requirePrivateEvidence(directory, options) {
  const result = inspectEvidencePermissions(directory, options);
  if (!result.verified) {
    const error = new Error(`MOMM cannot verify private evidence-folder permissions (${result.reason}). No permission changes were made. Ask the folder owner to inspect its access rules, or use a private project location; do not share private input until protection is established.`);
    error.code = 'MOMM_EVIDENCE_PERMISSIONS';
    throw error;
  }
  return result;
}

export function preparePrivateEvidence(directory, options = {}) {
  const fsx = options.fsx ?? fs;
  try { fsx.mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  catch {
    const error = new Error('MOMM cannot prepare its evidence directory. No review input has been read or sent. Choose an accessible private project location.');
    error.code = 'MOMM_EVIDENCE_PERMISSIONS'; throw error;
  }
  // Creation inherits Windows ACLs; mode 0700 alone is not verification.
  return requirePrivateEvidence(directory, options);
}

// Review prompts/media must not fall back to a broadly readable system temp
// directory. Allocate inside the already verified project evidence boundary.
// This does not change existing ACLs or expose a configurable bypass.
export function createEvidenceWorkspace(prefix, directory = path.resolve('.ensemble_reviews')) {
  if (!/^momm-[a-z]+-$/.test(prefix)) throw new Error('Invalid review workspace prefix');
  requirePrivateEvidence(directory);
  const staging = path.join(directory, 'staging');
  fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
  requirePrivateEvidence(staging);
  const created = fs.mkdtempSync(path.join(staging, prefix));
  try { requirePrivateEvidence(created); return created; }
  catch (error) {
    try { fs.rmSync(created, { recursive: true, force: true }); } catch {}
    throw error;
  }
}
