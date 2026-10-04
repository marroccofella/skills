param(
  [string]$Provider = "",
  [string]$Profile = "",
  [string]$Mode = "",
  [string]$Phase = "",
  [string]$File = "",
  [string]$Workspace = "",
  [switch]$StreamMessages
)

$ErrorActionPreference = "Stop"
$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Script = Join-Path $SkillRoot "scripts\watch-codex.js"
$OutLog = Join-Path $SkillRoot "state\watcher.out.log"
$ErrLog = Join-Path $SkillRoot "state\watcher.err.log"
$SettingsPath = Join-Path $SkillRoot "assets\settings.json"
$Settings = @{}
if (Test-Path $SettingsPath) {
  $Settings = Get-Content -Raw $SettingsPath | ConvertFrom-Json
}

New-Item -ItemType Directory -Force -Path (Join-Path $SkillRoot "state") | Out-Null

$existing = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*watch-codex.js*" }

foreach ($process in $existing) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

if ([string]::IsNullOrWhiteSpace($Workspace)) {
  $Workspace = (Get-Location).Path
}

if ([string]::IsNullOrWhiteSpace($Provider)) { $Provider = if ($Settings.provider) { $Settings.provider } else { "auto" } }
if ([string]::IsNullOrWhiteSpace($Profile)) { $Profile = if ($Settings.profile) { $Settings.profile } else { "conversational" } }
if ([string]::IsNullOrWhiteSpace($Mode)) { $Mode = if ($Settings.mode) { $Settings.mode } else { "informative" } }
if ([string]::IsNullOrWhiteSpace($Phase)) { $Phase = if ($Settings.phase) { $Settings.phase } else { "final_answer" } }
if ($StreamMessages) {
  $Phase = "all"
}

if ([string]::IsNullOrWhiteSpace($File)) {
  $StateDb = Join-Path $env:USERPROFILE ".codex\state_5.sqlite"
  if ((Test-Path $StateDb) -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $query = @'
import os, sqlite3, sys
def clean(value):
    return (value or "").replace("\\\\?\\", "")
db, workspace = sys.argv[1], os.path.normcase(os.path.abspath(clean(sys.argv[2])))
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select rollout_path, cwd, updated_at_ms from threads where archived=0 order by updated_at_ms desc limit 100").fetchall()
for rollout, cwd, _ in rows:
    if os.path.normcase(os.path.abspath(clean(cwd))) == workspace:
        print(clean(rollout))
        break
con.close()
'@
    $File = $query | python - $StateDb $Workspace
    $File = ($File | Select-Object -First 1).Trim()
  }
}

$args = @(
  $Script,
  "--provider", $Provider,
  "--profile", $Profile,
  "--mode", $Mode,
  "--phase", $Phase,
  "--includeEventMessages", "false",
  "--dedupe", "$(if ($Settings.dedupe -eq $false) { 'false' } else { 'true' })",
  "--speakStartup", "$(if ($Settings.speakStartup -eq $false) { 'false' } else { 'true' })",
  "--voice", "$(if ($Settings.voice) { $Settings.voice } else { 'en-US-AriaNeural' })",
  "--speed", "$(if ($Settings.speed) { $Settings.speed } else { '1' })",
  "--includeCodeBlocks", "$(if ($Settings.includeCodeBlocks) { 'true' } else { 'false' })",
  "--includeCommandBlocks", "$(if ($Settings.includeCommandBlocks) { 'true' } else { 'false' })",
  "--maxChunkChars", "$(if ($Settings.maxChunkChars) { $Settings.maxChunkChars } else { '420' })",
  "--pollMs", "$(if ($Settings.pollMs) { $Settings.pollMs } else { '750' })"
)

if (-not [string]::IsNullOrWhiteSpace($File)) {
  $args += @("--file", $File)
} else {
  $args += @("--thread", "latest")
}

Start-Process -FilePath "node.exe" -ArgumentList $args -WorkingDirectory $SkillRoot -WindowStyle Hidden -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog
Write-Host "Dom TTS Read-Aloud watcher started. New Codex responses will be spoken aloud."
if (-not [string]::IsNullOrWhiteSpace($File)) {
  Write-Host "Pinned transcript: $File"
} else {
  Write-Host "Warning: could not pin transcript, using latest thread fallback."
}
