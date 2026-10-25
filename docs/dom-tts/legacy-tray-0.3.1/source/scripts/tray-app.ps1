$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class DomTtsHotkeyWindow : NativeWindow {
  public event Action<int> HotkeyPressed;
  private const int WM_HOTKEY = 0x0312;
  public DomTtsHotkeyWindow() {
    CreateHandle(new CreateParams());
  }
  protected override void WndProc(ref Message m) {
    if (m.Msg == WM_HOTKEY && HotkeyPressed != null) {
      HotkeyPressed(m.WParam.ToInt32());
    }
    base.WndProc(ref m);
  }
}

public static class DomTtsNativeHotkey {
  [DllImport("user32.dll")]
  public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")]
  public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
"@

$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SettingsPath = Join-Path $SkillRoot "assets\settings.json"
$WatcherStatusPath = Join-Path $SkillRoot "state\watcher-status.json"
$IconPath = Join-Path $SkillRoot "assets\read-aloud-icon.ico"
$HotkeyReadLast = 4201
$HotkeyStop = 4202
$HotkeyMode = 4203
$HotkeyShell = 4204
$MOD_ALT = 0x0001
$MOD_CONTROL = 0x0002

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

function Read-Json($Path, $Fallback) {
  if (-not (Test-Path -LiteralPath $Path)) { return $Fallback }
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $Fallback }
}

function Save-Settings($Settings) {
  $Settings | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $SettingsPath -Encoding UTF8
}

function Set-Mode($Mode) {
  $settings = Read-Json $SettingsPath ([pscustomobject]@{})
  $settings.mode = $Mode
  Save-Settings $settings
  $notify.BalloonTipTitle = "Dom TTS Read-Aloud"
  $notify.BalloonTipText = "Mode set to $Mode"
  $notify.ShowBalloonTip(1200)
}

function Cycle-Mode {
  $settings = Read-Json $SettingsPath ([pscustomobject]@{ mode = "informative" })
  $modes = @("informative", "summary", "full")
  $index = [Array]::IndexOf($modes, [string]$settings.mode)
  if ($index -lt 0) { $index = 0 }
  $next = $modes[($index + 1) % $modes.Count]
  Set-Mode $next
}

function Start-AllChats {
  Run-Hidden "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-global-watcher.ps1"))
}

function Start-AllChatsStream {
  Run-Hidden "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\start-global-watcher.ps1"), "-StreamMessages")
}

function Stop-DomTts {
  Run-Hidden "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\stop-watcher.ps1"))
}

function Start-DuplexShell {
  Run-Visible "cmd.exe" @("/k", "node", (Join-Path $SkillRoot "scripts\duplex-shell.js"))
}

function Stop-DuplexShell {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\stop-duplex-shell.js"))
}

function Start-Avatar {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\avatar-server.js"))
}

function Start-AvatarDevice($DeviceId) {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\avatar-server.js"), "--device", $DeviceId)
}

function Start-AvatarAutoDevice($DeviceId) {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\avatar-screen-switcher.js"), "--device", $DeviceId)
}

function Stop-Avatar {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\stop-avatar-server.js"))
}

function Stop-AvatarAuto {
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\stop-avatar-screen-switcher.js"))
}

function Show-WakeStatus {
  $configPath = Join-Path $SkillRoot "assets\voice-runtime.json"
  $config = Read-Json $configPath ([pscustomobject]@{})
  $phrase = if ($config.wake.defaultPhrase) { $config.wake.defaultPhrase } else { "Hey Dom" }
  $mode = if ($config.wake.mode) { $config.wake.mode } else { "hybrid" }
  [System.Windows.Forms.MessageBox]::Show("Wake mode: $mode`nDefault phrase: $phrase`nHotkey: Ctrl+Alt+Space", "Dom TTS Duplex Mode") | Out-Null
}

function Read-Last {
  $status = Read-Json $WatcherStatusPath ([pscustomobject]@{})
  $text = [string]$status.lastText
  if ([string]::IsNullOrWhiteSpace($text)) {
    $text = "No recent Dom TTS answer is available yet."
  }
  Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\speak.js"), "--mode", "informative", "--profile", "conversational", "--text", $text)
}

function Open-Logs {
  $state = Join-Path $SkillRoot "state"
  if (Test-Path -LiteralPath $state) {
    Start-Process explorer.exe $state
  }
}

function Add-MenuItem($Menu, $Text, $Handler) {
  $item = New-Object System.Windows.Forms.MenuItem
  $item.Text = $Text
  $item.Add_Click($Handler)
  [void]$Menu.MenuItems.Add($item)
  return $item
}

$notify = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path -LiteralPath $IconPath) {
  $notify.Icon = New-Object System.Drawing.Icon($IconPath)
} else {
  $notify.Icon = [System.Drawing.SystemIcons]::Application
}
$notify.Text = "Dom TTS Read-Aloud"
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenu
Add-MenuItem $menu "Start all chats" { Start-AllChats }
Add-MenuItem $menu "Stream all chats" { Start-AllChatsStream }
Add-MenuItem $menu "Read last answer   Ctrl+Alt+R" { Read-Last }
Add-MenuItem $menu "Stop speaking      Ctrl+Alt+S" { Stop-DomTts }
[void]$menu.MenuItems.Add("-")
Add-MenuItem $menu "Mode: informative" { Set-Mode "informative" }
Add-MenuItem $menu "Mode: summary" { Set-Mode "summary" }
Add-MenuItem $menu "Mode: full" { Set-Mode "full" }
Add-MenuItem $menu "Cycle mode         Ctrl+Alt+M" { Cycle-Mode }
[void]$menu.MenuItems.Add("-")
Add-MenuItem $menu "Settings" { Run-Visible "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\settings.ps1")) }
Add-MenuItem $menu "Control panel" { Run-Visible "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $SkillRoot "scripts\control-panel.ps1")) }
Add-MenuItem $menu "Avatar" { Start-Avatar }
Add-MenuItem $menu "Avatar SB2 Bab" { Start-AvatarDevice "sb2" }
Add-MenuItem $menu "Avatar SB3 Bob" { Start-AvatarDevice "sb3" }
Add-MenuItem $menu "Auto Avatar SB2 Bab" { Start-AvatarAutoDevice "sb2" }
Add-MenuItem $menu "Auto Avatar SB3 Bob" { Start-AvatarAutoDevice "sb3" }
Add-MenuItem $menu "Stop Auto Avatar" { Stop-AvatarAuto }
Add-MenuItem $menu "Stop Avatar" { Stop-Avatar }
Add-MenuItem $menu "Doctor report" { Run-Visible "cmd.exe" @("/k", "node", (Join-Path $SkillRoot "scripts\doctor.js")) }
Add-MenuItem $menu "Open logs" { Open-Logs }
Add-MenuItem $menu "Test voice" { Run-Hidden "node.exe" @((Join-Path $SkillRoot "scripts\speak.js"), "--mode", "full", "--text", "Dom TTS Read-Aloud tray test.") }
[void]$menu.MenuItems.Add("-")
Add-MenuItem $menu "Start Duplex Shell   Ctrl+Alt+Space" { Start-DuplexShell }
Add-MenuItem $menu "Stop Duplex Shell" { Stop-DuplexShell }
Add-MenuItem $menu "Voice Doctor" { Run-Visible "cmd.exe" @("/k", "node", (Join-Path $SkillRoot "scripts\voice-doctor.js")) }
Add-MenuItem $menu "Wake Phrase Status" { Show-WakeStatus }
[void]$menu.MenuItems.Add("-")
Add-MenuItem $menu "Exit tray app" {
  [System.Windows.Forms.Application]::Exit()
}
$notify.ContextMenu = $menu
$notify.Add_DoubleClick({ Start-AllChats })

$hotkeys = New-Object DomTtsHotkeyWindow
$hotkeys.add_HotkeyPressed({
  param($id)
  if ($id -eq $HotkeyReadLast) { Read-Last }
  elseif ($id -eq $HotkeyStop) { Stop-DomTts }
  elseif ($id -eq $HotkeyMode) { Cycle-Mode }
  elseif ($id -eq $HotkeyShell) { Start-DuplexShell }
})

[void][DomTtsNativeHotkey]::RegisterHotKey($hotkeys.Handle, $HotkeyReadLast, ($MOD_ALT -bor $MOD_CONTROL), [int][System.Windows.Forms.Keys]::R)
[void][DomTtsNativeHotkey]::RegisterHotKey($hotkeys.Handle, $HotkeyStop, ($MOD_ALT -bor $MOD_CONTROL), [int][System.Windows.Forms.Keys]::S)
[void][DomTtsNativeHotkey]::RegisterHotKey($hotkeys.Handle, $HotkeyMode, ($MOD_ALT -bor $MOD_CONTROL), [int][System.Windows.Forms.Keys]::M)
[void][DomTtsNativeHotkey]::RegisterHotKey($hotkeys.Handle, $HotkeyShell, ($MOD_ALT -bor $MOD_CONTROL), [int][System.Windows.Forms.Keys]::Space)

$notify.BalloonTipTitle = "Dom TTS Read-Aloud"
$notify.BalloonTipText = "Tray controls are running. Right-click the icon for options."
$notify.ShowBalloonTip(1500)

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  [void][DomTtsNativeHotkey]::UnregisterHotKey($hotkeys.Handle, $HotkeyReadLast)
  [void][DomTtsNativeHotkey]::UnregisterHotKey($hotkeys.Handle, $HotkeyStop)
  [void][DomTtsNativeHotkey]::UnregisterHotKey($hotkeys.Handle, $HotkeyMode)
  [void][DomTtsNativeHotkey]::UnregisterHotKey($hotkeys.Handle, $HotkeyShell)
  $notify.Visible = $false
  $notify.Dispose()
  $hotkeys.DestroyHandle()
}
