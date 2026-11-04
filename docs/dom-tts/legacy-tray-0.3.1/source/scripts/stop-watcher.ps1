$existing = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and ($_.CommandLine -like "*watch-codex.js*" -or $_.CommandLine -like "*watch-all-codex.js*") }

foreach ($process in $existing) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$StopScript = Join-Path $SkillRoot "scripts\stop.js"
if (Test-Path $StopScript) {
  node $StopScript | Out-Null
}

$WatcherStatus = Join-Path $SkillRoot "state\watcher-status.json"
@{
  state = "stopped"
  stoppedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $WatcherStatus -Encoding UTF8

Write-Host "Dom TTS Read-Aloud watcher stopped."
