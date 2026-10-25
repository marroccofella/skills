$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SettingsPath = Join-Path $SkillRoot "assets\settings.json"
$VoicesPath = Join-Path $SkillRoot "assets\voices.json"

function Read-Json($Path, $Fallback) {
  if (Test-Path $Path) {
    return Get-Content -Raw $Path | ConvertFrom-Json
  }
  return $Fallback
}

function Save-Settings {
  $settings = [ordered]@{
    provider = $providerBox.SelectedItem.ToString()
    voice = $voiceBox.SelectedItem.ToString()
    speed = [math]::Round(($speedTrack.Value / 100.0), 2)
    mode = $modeBox.SelectedItem.ToString()
    profile = $profileBox.SelectedItem.ToString()
    phase = if ($streamCheck.Checked) { "all" } else { "final_answer" }
    streamMessages = [bool]$streamCheck.Checked
    includeCodeBlocks = [bool]$codeCheck.Checked
    includeCommandBlocks = [bool]$commandCheck.Checked
    speakStartup = [bool]$startupCheck.Checked
    dedupe = [bool]$dedupeCheck.Checked
    maxChunkChars = [int]$chunkBox.Value
    pollMs = [int]$pollBox.Value
  }
  $settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $SettingsPath -Encoding UTF8
}

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

$settings = Read-Json $SettingsPath ([pscustomobject]@{})
$voices = Read-Json $VoicesPath ([pscustomobject]@{})

$form = New-Object System.Windows.Forms.Form
$form.Text = "Dom TTS Read-Aloud Settings"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(540, 560)
$form.MinimumSize = New-Object System.Drawing.Size(540, 560)
$form.BackColor = [System.Drawing.Color]::FromArgb(32, 32, 32)
$form.ForeColor = [System.Drawing.Color]::Gainsboro
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$y = 22
function Add-Label($Text, $X, $Y) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.Location = New-Object System.Drawing.Point($X, $Y)
  $label.Size = New-Object System.Drawing.Size(170, 26)
  $label.ForeColor = [System.Drawing.Color]::Gainsboro
  $form.Controls.Add($label)
}

function Add-Combo($Items, $Value, $X, $Y) {
  $combo = New-Object System.Windows.Forms.ComboBox
  $combo.DropDownStyle = "DropDownList"
  $combo.Location = New-Object System.Drawing.Point($X, $Y)
  $combo.Size = New-Object System.Drawing.Size(280, 28)
  [void]$combo.Items.AddRange($Items)
  if ($Value -and $combo.Items.Contains($Value)) { $combo.SelectedItem = $Value } else { $combo.SelectedIndex = 0 }
  $form.Controls.Add($combo)
  return $combo
}

Add-Label "Provider" 24 $y
$providerBox = Add-Combo @("auto", "edge", "sapi") ($(if ($settings.provider) { $settings.provider } else { "auto" })) 210 $y
$y += 42

Add-Label "Voice" 24 $y
$voiceItems = @()
if ($voices.voiceChoices) {
  $voiceItems = @($voices.voiceChoices | ForEach-Object { $_.value })
}
if ($voiceItems.Count -eq 0) {
  $voiceItems = @("en-US-AriaNeural", "en-US-JennyNeural", "en-US-GuyNeural", "en-GB-SoniaNeural", "en-GB-RyanNeural")
}
$voiceBox = Add-Combo $voiceItems ($(if ($settings.voice) { $settings.voice } else { "en-US-AriaNeural" })) 210 $y
$y += 42

Add-Label "Narration Mode" 24 $y
$modeBox = Add-Combo @("informative", "full", "summary", "action-items", "errors-only", "warnings-only", "terminal-summary", "diff-summary") ($(if ($settings.mode) { $settings.mode } else { "informative" })) 210 $y
$y += 42

Add-Label "Profile" 24 $y
$profileBox = Add-Combo @("conversational", "concise", "engineering") ($(if ($settings.profile) { $settings.profile } else { "conversational" })) 210 $y
$y += 48

Add-Label "Speed" 24 $y
$speedTrack = New-Object System.Windows.Forms.TrackBar
$speedTrack.Location = New-Object System.Drawing.Point(205, ($y - 6))
$speedTrack.Size = New-Object System.Drawing.Size(220, 40)
$speedTrack.Minimum = 70
$speedTrack.Maximum = 150
$speedTrack.TickFrequency = 10
$speedTrack.Value = [int]([double]($(if ($settings.speed) { $settings.speed } else { 1.0 })) * 100)
$speedLabel = New-Object System.Windows.Forms.Label
$speedLabel.Location = New-Object System.Drawing.Point(435, $y)
$speedLabel.Size = New-Object System.Drawing.Size(70, 26)
$speedLabel.ForeColor = [System.Drawing.Color]::Gainsboro
$speedLabel.Text = "$([math]::Round($speedTrack.Value / 100.0, 2))x"
$speedTrack.Add_ValueChanged({ $speedLabel.Text = "$([math]::Round($speedTrack.Value / 100.0, 2))x" })
$form.Controls.Add($speedTrack)
$form.Controls.Add($speedLabel)
$y += 52

Add-Label "Chunk Size" 24 $y
$chunkBox = New-Object System.Windows.Forms.NumericUpDown
$chunkBox.Location = New-Object System.Drawing.Point(210, $y)
$chunkBox.Size = New-Object System.Drawing.Size(120, 28)
$chunkBox.Minimum = 180
$chunkBox.Maximum = 1600
$chunkBox.Increment = 20
$chunkBox.Value = [decimal]($(if ($settings.maxChunkChars) { $settings.maxChunkChars } else { 420 }))
$form.Controls.Add($chunkBox)
$y += 42

Add-Label "Poll Interval" 24 $y
$pollBox = New-Object System.Windows.Forms.NumericUpDown
$pollBox.Location = New-Object System.Drawing.Point(210, $y)
$pollBox.Size = New-Object System.Drawing.Size(120, 28)
$pollBox.Minimum = 250
$pollBox.Maximum = 5000
$pollBox.Increment = 250
$pollBox.Value = [decimal]($(if ($settings.pollMs) { $settings.pollMs } else { 750 }))
$form.Controls.Add($pollBox)
$y += 48

$streamCheck = New-Object System.Windows.Forms.CheckBox
$streamCheck.Text = "Stream progress messages, not only final answers"
$streamCheck.Location = New-Object System.Drawing.Point(24, $y)
$streamCheck.Size = New-Object System.Drawing.Size(460, 28)
$streamCheck.Checked = [bool]$settings.streamMessages
$form.Controls.Add($streamCheck)
$y += 34

$codeCheck = New-Object System.Windows.Forms.CheckBox
$codeCheck.Text = "Include code blocks when narration mode is informative"
$codeCheck.Location = New-Object System.Drawing.Point(24, $y)
$codeCheck.Size = New-Object System.Drawing.Size(460, 28)
$codeCheck.Checked = [bool]$settings.includeCodeBlocks
$form.Controls.Add($codeCheck)
$y += 34

$commandCheck = New-Object System.Windows.Forms.CheckBox
$commandCheck.Text = "Include command lines such as npm, node, git, python"
$commandCheck.Location = New-Object System.Drawing.Point(24, $y)
$commandCheck.Size = New-Object System.Drawing.Size(460, 28)
$commandCheck.Checked = [bool]$settings.includeCommandBlocks
$form.Controls.Add($commandCheck)
$y += 34

$startupCheck = New-Object System.Windows.Forms.CheckBox
$startupCheck.Text = "Speak a startup confirmation"
$startupCheck.Location = New-Object System.Drawing.Point(24, $y)
$startupCheck.Size = New-Object System.Drawing.Size(460, 28)
$startupCheck.Checked = if ($null -eq $settings.speakStartup) { $true } else { [bool]$settings.speakStartup }
$form.Controls.Add($startupCheck)
$y += 34

$dedupeCheck = New-Object System.Windows.Forms.CheckBox
$dedupeCheck.Text = "Avoid duplicate narration records"
$dedupeCheck.Location = New-Object System.Drawing.Point(24, $y)
$dedupeCheck.Size = New-Object System.Drawing.Size(460, 28)
$dedupeCheck.Checked = if ($null -eq $settings.dedupe) { $true } else { [bool]$settings.dedupe }
$form.Controls.Add($dedupeCheck)
$y += 48

$buttonY = $y
$saveButton = New-Object System.Windows.Forms.Button
$saveButton.Text = "Save"
$saveButton.Location = New-Object System.Drawing.Point(24, $buttonY)
$saveButton.Size = New-Object System.Drawing.Size(95, 36)
$saveButton.Add_Click({ Save-Settings; [System.Windows.Forms.MessageBox]::Show("Settings saved.", "Dom TTS Read-Aloud") | Out-Null })
$form.Controls.Add($saveButton)

$restartButton = New-Object System.Windows.Forms.Button
$restartButton.Text = "Save + Restart"
$restartButton.Location = New-Object System.Drawing.Point(130, $buttonY)
$restartButton.Size = New-Object System.Drawing.Size(125, 36)
$restartButton.Add_Click({
  Save-Settings
  Run-Hidden "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\stop-watcher.ps1"))
  Start-Sleep -Milliseconds 500
  Run-Hidden "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-global-watcher.ps1"))
  [System.Windows.Forms.MessageBox]::Show("Settings saved and watcher restarted.", "Dom TTS Read-Aloud") | Out-Null
})
$form.Controls.Add($restartButton)

$testButton = New-Object System.Windows.Forms.Button
$testButton.Text = "Test Voice"
$testButton.Location = New-Object System.Drawing.Point(266, $buttonY)
$testButton.Size = New-Object System.Drawing.Size(105, 36)
$testButton.Add_Click({
  Save-Settings
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\speak.js"), "--mode", "full", "--text", "Dom TTS Read-Aloud settings test.")
})
$form.Controls.Add($testButton)

$doctorButton = New-Object System.Windows.Forms.Button
$doctorButton.Text = "Doctor"
$doctorButton.Location = New-Object System.Drawing.Point(382, $buttonY)
$doctorButton.Size = New-Object System.Drawing.Size(95, 36)
$doctorButton.Add_Click({ Run-Visible "cmd.exe" @("/k", "node", (Join-Path $SkillRoot "scripts\doctor.js")) })
$form.Controls.Add($doctorButton)

[void]$form.ShowDialog()
