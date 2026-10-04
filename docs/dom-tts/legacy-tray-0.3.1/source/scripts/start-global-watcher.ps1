param(
  [switch]$StreamMessages
)

$ErrorActionPreference = "Stop"
$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Script = Join-Path $SkillRoot "scripts\watch-all-codex.js"
$OutLog = Join-Path $SkillRoot "state\watcher-global.out.log"
$ErrLog = Join-Path $SkillRoot "state\watcher-global.err.log"

New-Item -ItemType Directory -Force -Path (Join-Path $SkillRoot "state") | Out-Null

$existing = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and ($_.CommandLine -like "*watch-codex.js*" -or $_.CommandLine -like "*watch-all-codex.js*") }

foreach ($process in $existing) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

$args = @($Script)
if ($StreamMessages) {
  $args += @("--phase", "all")
}

Start-Process -FilePath "node.exe" -ArgumentList $args -WorkingDirectory $SkillRoot -WindowStyle Hidden -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog
Write-Host "Global Dom TTS Read-Aloud watcher started. New Codex answers from all chats and projects will be spoken aloud."
