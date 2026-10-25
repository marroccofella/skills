$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Normalize-ArgumentList($ArgumentValues) {
  @($ArgumentValues) |
    Where-Object { $null -ne $_ -and -not [string]::IsNullOrWhiteSpace([string]$_) } |
    ForEach-Object { [string]$_ }
}

function Run-Hidden($File, $ArgumentValues = @()) {
  $cleanArgs = @(Normalize-ArgumentList $ArgumentValues)
  $parameters = @{
    FilePath = $File
    WorkingDirectory = $SkillRoot
    WindowStyle = "Hidden"
  }
  if ($cleanArgs.Count -gt 0) { $parameters.ArgumentList = $cleanArgs }
  Start-Process @parameters
}

function Run-Visible($File, $ArgumentValues = @()) {
  $cleanArgs = @(Normalize-ArgumentList $ArgumentValues)
  $parameters = @{
    FilePath = $File
    WorkingDirectory = $SkillRoot
  }
  if ($cleanArgs.Count -gt 0) { $parameters.ArgumentList = $cleanArgs }
  Start-Process @parameters
}

function Button($Text, $X, $Y, $Handler) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Location = New-Object System.Drawing.Point($X, $Y)
  $button.Size = New-Object System.Drawing.Size(180, 42)
  $button.Add_Click($Handler)
  $form.Controls.Add($button)
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Dom TTS Read-Aloud Control"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(440, 680)
$form.MinimumSize = New-Object System.Drawing.Size(440, 680)
$form.BackColor = [System.Drawing.Color]::FromArgb(32, 32, 32)
$form.ForeColor = [System.Drawing.Color]::Gainsboro
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Dom TTS Read-Aloud"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(24, 18)
$title.Size = New-Object System.Drawing.Size(360, 34)
$title.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Prof Dom Marrocco / 42.uk"
$subtitle.Location = New-Object System.Drawing.Point(26, 56)
$subtitle.Size = New-Object System.Drawing.Size(370, 26)
$subtitle.ForeColor = [System.Drawing.Color]::Gainsboro
$form.Controls.Add($subtitle)

Button "Start Final Answers" 26 96 {
  Run-Hidden "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-watcher.ps1"))
  [System.Windows.Forms.MessageBox]::Show("Dom TTS is watching final answers.", "Dom TTS Read-Aloud") | Out-Null
}

Button "Stream Messages" 224 96 {
  Run-Hidden "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-watcher.ps1"), "-StreamMessages")
  [System.Windows.Forms.MessageBox]::Show("Dom TTS is streaming assistant messages.", "Dom TTS Read-Aloud") | Out-Null
}

Button "All Chats" 26 150 {
  Run-Hidden "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-global-watcher.ps1"))
  [System.Windows.Forms.MessageBox]::Show("Dom TTS is watching all Codex chats and projects.", "Dom TTS Read-Aloud") | Out-Null
}

Button "All Chats Stream" 224 150 {
  Run-Hidden "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-global-watcher.ps1"), "-StreamMessages")
  [System.Windows.Forms.MessageBox]::Show("Dom TTS is streaming all Codex chats and projects.", "Dom TTS Read-Aloud") | Out-Null
}

Button "Stop" 26 204 {
  Run-Hidden "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\stop-watcher.ps1"))
  [System.Windows.Forms.MessageBox]::Show("Dom TTS stopped.", "Dom TTS Read-Aloud") | Out-Null
}

Button "Settings" 224 204 {
  Run-Visible "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\settings.ps1"))
}

Button "Test Voice" 26 258 {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\speak.js"), "--mode", "full", "--text", "Dom TTS Read-Aloud test.")
}

Button "Doctor" 224 258 {
  Run-Visible "cmd.exe" @("/k", "node", (Join-Path $SkillRoot "scripts\doctor.js"))
}

Button "Tray App" 26 312 {
  Run-Hidden "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\tray-app.ps1"))
}

Button "Accept Test" 224 312 {
  Run-Visible "cmd.exe" @("/k", "node", (Join-Path $SkillRoot "scripts\acceptance-test.js"))
}

Button "Avatar" 26 366 {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\avatar-server.js"))
}

Button "SB2 Bab Avatar" 224 366 {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\avatar-server.js"), "--device", "sb2")
}

Button "SB3 Bob Avatar" 26 420 {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\avatar-server.js"), "--device", "sb3")
}

Button "Auto SB2 Bab" 224 420 {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\avatar-screen-switcher.js"), "--device", "sb2")
}

Button "Auto SB3 Bob" 26 474 {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\avatar-screen-switcher.js"), "--device", "sb3")
}

Button "Stop Auto Avatar" 224 474 {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\stop-avatar-screen-switcher.js"))
}

Button "Stop Avatar" 26 528 {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\stop-avatar-server.js"))
}

[void]$form.ShowDialog()
