param(
  [switch]$LaunchSafeActions
)

$ErrorActionPreference = "Stop"
$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Normalize-ArgumentList($ArgumentValues) {
  @($ArgumentValues) |
    Where-Object { $null -ne $_ -and -not [string]::IsNullOrWhiteSpace([string]$_) } |
    ForEach-Object { [string]$_ }
}

function Assert-CommandShape($Name, $File, $ArgumentValues = @()) {
  if ([string]::IsNullOrWhiteSpace($File)) {
    throw "$Name has an empty FilePath."
  }
  $cleanArgs = @(Normalize-ArgumentList $ArgumentValues)
  if (@($ArgumentValues).Count -ne $cleanArgs.Count) {
    throw "$Name has null or empty ArgumentList values."
  }
  foreach ($arg in $cleanArgs) {
    if ($arg -like "$SkillRoot*" -and -not (Test-Path -LiteralPath $arg)) {
      throw "$Name points at missing path: $arg"
    }
  }
  [pscustomobject]@{
    Name = $Name
    File = $File
    Args = ($cleanArgs -join " ")
    Result = "OK"
  }
}

$commands = @(
  @{ Name = "Control Start Final Answers"; File = "powershell.exe"; Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-watcher.ps1")) },
  @{ Name = "Control Stream Messages"; File = "powershell.exe"; Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-watcher.ps1"), "-StreamMessages") },
  @{ Name = "Control All Chats"; File = "powershell.exe"; Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-global-watcher.ps1")) },
  @{ Name = "Control All Chats Stream"; File = "powershell.exe"; Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-global-watcher.ps1"), "-StreamMessages") },
  @{ Name = "Control Stop"; File = "powershell.exe"; Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\stop-watcher.ps1")) },
  @{ Name = "Control Settings"; File = "powershell.exe"; Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\settings.ps1")) },
  @{ Name = "Control Test Voice"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\speak.js"), "--dry-run", "--mode", "full", "--text", "Dom TTS smoke test.") },
  @{ Name = "Control Doctor"; File = "cmd.exe"; Args = @("/c", "node", (Join-Path $SkillRoot "scripts\doctor.js")) },
  @{ Name = "Control Tray App"; File = "powershell.exe"; Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\tray-app.ps1")) },
  @{ Name = "Control Acceptance Test"; File = "cmd.exe"; Args = @("/c", "node", (Join-Path $SkillRoot "scripts\acceptance-test.js")) },
  @{ Name = "Avatar Screen Switch Acceptance"; File = "cmd.exe"; Args = @("/c", "node", (Join-Path $SkillRoot "scripts\avatar-screen-switcher-acceptance-test.js")) },
  @{ Name = "Control Avatar"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\avatar-server.js"), "--no-open") },
  @{ Name = "Control Avatar SB2"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\avatar-server.js"), "--device", "sb2", "--no-open") },
  @{ Name = "Control Avatar SB3"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\avatar-server.js"), "--device", "sb3", "--no-open") },
  @{ Name = "Control Auto Avatar SB2"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\avatar-screen-switcher.js"), "--device", "sb2", "--once", "--no-launch", "--no-start-server") },
  @{ Name = "Control Auto Avatar SB3"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\avatar-screen-switcher.js"), "--device", "sb3", "--once", "--no-launch", "--no-start-server") },
  @{ Name = "Control Stop Auto Avatar"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\stop-avatar-screen-switcher.js")) },
  @{ Name = "Control Stop Avatar"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\stop-avatar-server.js")) },
  @{ Name = "Tray Read Last"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\speak.js"), "--dry-run", "--mode", "informative", "--profile", "conversational", "--text", "No recent Dom TTS answer is available yet.") },
  @{ Name = "Tray Open Settings"; File = "powershell.exe"; Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\settings.ps1")) },
  @{ Name = "Tray Open Control Panel"; File = "powershell.exe"; Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\control-panel.ps1")) },
  @{ Name = "Tray Avatar"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\avatar-server.js"), "--no-open") },
  @{ Name = "Tray Avatar SB2"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\avatar-server.js"), "--device", "sb2", "--no-open") },
  @{ Name = "Tray Avatar SB3"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\avatar-server.js"), "--device", "sb3", "--no-open") },
  @{ Name = "Tray Auto Avatar SB2"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\avatar-screen-switcher.js"), "--device", "sb2", "--once", "--no-launch", "--no-start-server") },
  @{ Name = "Tray Auto Avatar SB3"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\avatar-screen-switcher.js"), "--device", "sb3", "--once", "--no-launch", "--no-start-server") },
  @{ Name = "Tray Stop Auto Avatar"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\stop-avatar-screen-switcher.js")) },
  @{ Name = "Tray Stop Avatar"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\stop-avatar-server.js")) },
  @{ Name = "Tray Doctor Report"; File = "cmd.exe"; Args = @("/c", "node", (Join-Path $SkillRoot "scripts\doctor.js")) },
  @{ Name = "Tray Start Duplex Shell"; File = "cmd.exe"; Args = @("/c", "node", (Join-Path $SkillRoot "scripts\duplex-shell.js"), "--help") },
  @{ Name = "Tray Stop Duplex Shell"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\stop-duplex-shell.js")) },
  @{ Name = "Tray Voice Doctor"; File = "cmd.exe"; Args = @("/c", "node", (Join-Path $SkillRoot "scripts\voice-doctor.js")) },
  @{ Name = "Duplex Record Audio"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\record-audio.js"), "--help") },
  @{ Name = "Duplex Transcribe Audio"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\transcribe-audio.js"), "--help") },
  @{ Name = "Settings Save Restart"; File = "powershell.exe"; Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-global-watcher.ps1")) },
  @{ Name = "Settings Test Voice"; File = "node.exe"; Args = @((Join-Path $SkillRoot "scripts\speak.js"), "--dry-run", "--mode", "full", "--text", "Dom TTS Read-Aloud settings test.") },
  @{ Name = "Settings Doctor"; File = "cmd.exe"; Args = @("/c", "node", (Join-Path $SkillRoot "scripts\doctor.js")) }
)

$results = foreach ($command in $commands) {
  Assert-CommandShape $command.Name $command.File $command.Args
}

$results | Format-Table -AutoSize

if ($LaunchSafeActions) {
  node (Join-Path $SkillRoot "scripts\speak.js") --dry-run --mode full --text "Dom TTS launch smoke test." | Out-Null
  node (Join-Path $SkillRoot "scripts\doctor.js") | Out-Null
}

Write-Host "Dom TTS UI smoke test passed for $($results.Count) command surfaces."
