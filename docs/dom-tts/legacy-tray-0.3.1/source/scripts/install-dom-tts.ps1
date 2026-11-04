param(
  [ValidateSet("Recommended", "Advanced", "Repair", "CleanRemove")]
  [string]$InstallMode = "Recommended",
  [string]$TargetSkill = "$env:USERPROFILE\.codex\skills\read-aloud",
  [string]$Workspace = $(Join-Path $env:USERPROFILE "DomTTS"),
  [switch]$IncludeDuplex,
  [switch]$NoStartup,
  [switch]$Probe,
  [switch]$SkipNativeRegistration,
  [switch]$RemoveAllData
)

$ErrorActionPreference = "Stop"

$Source = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Package = Get-Content -Raw (Join-Path $Source "package.json") | ConvertFrom-Json
$Version = $Package.version
$CodexHome = Join-Path $env:USERPROFILE ".codex"
$RuntimeHome = Join-Path $env:LOCALAPPDATA "42uk\DomTTS"
$RuntimeVersion = Join-Path $RuntimeHome "versions\$Version"
$RuntimeSkill = Join-Path $RuntimeVersion "read-aloud"
$DomPluginRoot = Join-Path $CodexHome "plugins\dom-tts"
$DomPluginSkill = Join-Path $DomPluginRoot "skills\read-aloud"
$InstallerSkill = Join-Path $DomPluginRoot "skills\dom-tts-installer"
$CompatPluginRoot = Join-Path $CodexHome "plugins\read-aloud"
$CompatPluginSkill = Join-Path $CompatPluginRoot "skills\read-aloud"
$MarketplacePath = Join-Path $CodexHome ".agents\plugins\marketplace.json"
$ConfigPath = Join-Path $CodexHome "config.toml"
$InstallManifest = Join-Path $RuntimeHome "install-manifest.json"
$CurrentJson = Join-Path $RuntimeHome "current.json"
$BackupRoot = Join-Path $RuntimeHome "backups\install-$(Get-Date -Format yyyyMMdd-HHmmss)"
$RegistrationStatus = "not-attempted"
$FallbackUsed = $false

function Write-Utf8NoBom($Path, $Text) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Copy-Clean($From, $To, [string[]]$Exclude = @("state")) {
  if (Test-Path -LiteralPath $To) { Remove-Item -LiteralPath $To -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  Get-ChildItem -LiteralPath $From -Force |
    Where-Object { $_.Name -notin $Exclude } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $To -Recurse -Force }
}

function Backup-IfExists($Path, $Name) {
  if (Test-Path -LiteralPath $Path) {
    $dest = Join-Path $BackupRoot $Name
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    Copy-Item -LiteralPath $Path -Destination $dest -Recurse -Force
  }
}

function Restore-IfExists($BackupName, $Target) {
  $backup = Join-Path $BackupRoot $BackupName
  if (Test-Path -LiteralPath $backup) {
    if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
    Copy-Item -LiteralPath $backup -Destination $Target -Recurse -Force
  }
}

function Write-Cmd($Path, $Command) {
  Write-Utf8NoBom $Path "@echo off`r`n$Command`r`n"
}

function New-Shortcut($Path, $Target, $Description) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $Target
  $shortcut.WorkingDirectory = $Workspace
  $shortcut.Description = $Description
  $icon = Join-Path $TargetSkill "assets\read-aloud-icon.ico"
  if (Test-Path -LiteralPath $icon) { $shortcut.IconLocation = $icon }
  $shortcut.Save()
}

function Get-NodeCommand {
  $runtimeNode = Join-Path $RuntimeVersion "node\node.exe"
  if (Test-Path -LiteralPath $runtimeNode) { return $runtimeNode }
  $systemNode = (Get-Command node.exe -ErrorAction SilentlyContinue)
  if ($systemNode) { return $systemNode.Source }
  throw "No usable Node runtime was found. Public builds must bundle Node; developer installs may use system Node."
}

function Write-PluginJson($Root, $Name, $DisplayName, $ShortDescription) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Root ".codex-plugin"), (Join-Path $Root "assets") | Out-Null
  $pluginJson = @{
    name = $Name
    version = $Version
    description = "Dom TTS by Prof Dom Marrocco / 42.uk: Codex-native Standard read-aloud plus isolated optional Duplex voice shell."
    author = @{ name = "Prof Dom Marrocco"; url = "https://42.uk" }
    homepage = "https://42.uk"
    repository = "https://42.uk/dom-tts"
    license = "Proprietary"
    keywords = @("accessibility", "tts", "voice", "read-aloud", "codex", "windows")
    skills = "./skills/"
    interface = @{
      displayName = $DisplayName
      shortDescription = $ShortDescription
      longDescription = "Dom TTS by Prof Dom Marrocco / 42.uk is a Windows-first local voice runtime for Codex. Standard Mode speaks Codex responses through Edge neural TTS with SAPI fallback. Duplex Mode is optional and experimental."
      developerName = "Prof Dom Marrocco / 42.uk"
      category = "Productivity"
      capabilities = @("Interactive", "Read")
      websiteURL = "https://42.uk"
      privacyPolicyURL = "https://42.uk/privacy"
      termsOfServiceURL = "https://42.uk/terms"
      defaultPrompt = @("Run Dom TTS Doctor", "Start all-chat read-aloud", "Repair Dom TTS installation")
      brandColor = "#49D17D"
      composerIcon = "./assets/composer-icon.png"
      logo = "./assets/logo.png"
      screenshots = @()
    }
  }
  Write-Utf8NoBom (Join-Path $Root ".codex-plugin\plugin.json") ($pluginJson | ConvertTo-Json -Depth 8)
  Copy-Item -LiteralPath (Join-Path $Source "assets\read-aloud-icon.png") -Destination (Join-Path $Root "assets\composer-icon.png") -Force
  Copy-Item -LiteralPath (Join-Path $Source "assets\read-aloud-icon.png") -Destination (Join-Path $Root "assets\logo.png") -Force
}

function Write-InstallerSkill($Root) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Root "agents"), (Join-Path $Root "scripts"), (Join-Path $Root "references") | Out-Null
  Write-Utf8NoBom (Join-Path $Root "SKILL.md") @"
---
name: dom-tts-installer
description: Operate Dom TTS by Prof Dom Marrocco / 42.uk from Codex. Use for @Dom TTS install Standard Mode, run Doctor, repair installation, start all-chat read-aloud, open Bob/Bab avatar, stop speaking, collect support bundle, install Duplex Mode experimental, uninstall, first run setup, troubleshooting, and Codex-native Dom TTS registration.
---

# Dom TTS Installer

Use this operator skill when the user asks Codex to configure, repair, verify, start, stop, diagnose, package, or uninstall Dom TTS.

## Golden Path

Run commands from this skill or from the installed runtime. Standard Mode is always the default and never requires microphone, Whisper.cpp, Ollama, SSH, or Bob/Bab worker tooling.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\first-run.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\doctor.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-standard.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-standard.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-avatar.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-avatar.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\repair.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\collect-support-bundle.ps1
```

## Rules

- Preserve internal skill id `read-aloud`.
- Prefer Standard Mode unless the user explicitly asks for Duplex.
- Treat Duplex dependencies as OFF or WARN, never Standard Mode blockers.
- Do not expose Codex transcripts, spoken text, microphone audio, API keys, tokens, or private code in support bundles.
- Remind the user to restart Codex after marketplace or plugin metadata changes.

Read `references\install-with-codex.md`, `references\troubleshooting.md`, and `references\security.md` only when needed.
"@
  Write-Utf8NoBom (Join-Path $Root "agents\openai.yaml") @"
interface:
  display_name: "Dom TTS"
  short_description: "Install, repair, and operate Dom TTS"
  icon_small: "../read-aloud/assets/read-aloud-icon.png"
  icon_large: "../read-aloud/assets/read-aloud-icon.svg"
  brand_color: "#49D17D"
  default_prompt: "Use `$dom-tts-installer to run Dom TTS first-run setup, Doctor, repair, or start all-chat read-aloud."

policy:
  allow_implicit_invocation: true
"@
  $scripts = @{
    "first-run.ps1" = 'node "$env:USERPROFILE\.codex\skills\read-aloud\scripts\doctor.js"'
    "doctor.ps1" = 'node "$env:USERPROFILE\.codex\skills\read-aloud\scripts\doctor.js"'
    "start-standard.ps1" = 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\read-aloud\scripts\start-global-watcher.ps1"'
    "stop-standard.ps1" = 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\read-aloud\scripts\stop-watcher.ps1"; node "$env:USERPROFILE\.codex\skills\read-aloud\scripts\stop.js"'
    "start-avatar.ps1" = 'node "$env:USERPROFILE\.codex\skills\read-aloud\scripts\avatar-server.js"'
    "start-avatar-sb2.ps1" = 'node "$env:USERPROFILE\.codex\skills\read-aloud\scripts\avatar-server.js" --device sb2'
    "start-avatar-sb3.ps1" = 'node "$env:USERPROFILE\.codex\skills\read-aloud\scripts\avatar-server.js" --device sb3'
    "start-avatar-auto-sb2.ps1" = 'node "$env:USERPROFILE\.codex\skills\read-aloud\scripts\avatar-screen-switcher.js" --device sb2'
    "start-avatar-auto-sb3.ps1" = 'node "$env:USERPROFILE\.codex\skills\read-aloud\scripts\avatar-screen-switcher.js" --device sb3'
    "stop-avatar-auto.ps1" = 'node "$env:USERPROFILE\.codex\skills\read-aloud\scripts\stop-avatar-screen-switcher.js"'
    "stop-avatar.ps1" = 'node "$env:USERPROFILE\.codex\skills\read-aloud\scripts\stop-avatar-server.js"'
    "repair.ps1" = 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\read-aloud\scripts\install-dom-tts.ps1" -InstallMode Repair'
    "collect-support-bundle.ps1" = 'node "$env:USERPROFILE\.codex\skills\read-aloud\scripts\support-bundle.js"'
    "install-standard.ps1" = 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\read-aloud\scripts\install-dom-tts.ps1" -InstallMode Recommended'
    "install-duplex.ps1" = 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\read-aloud\scripts\install-dom-tts.ps1" -InstallMode Advanced -IncludeDuplex'
    "uninstall.ps1" = 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\read-aloud\scripts\install-dom-tts.ps1" -InstallMode CleanRemove'
  }
  foreach ($entry in $scripts.GetEnumerator()) {
    Write-Utf8NoBom (Join-Path $Root "scripts\$($entry.Key)") $entry.Value
  }
  Write-Utf8NoBom (Join-Path $Root "references\install-with-codex.md") "# Install with Codex`r`n`r`nAsk Codex: @Dom TTS run first-run setup, then @Dom TTS run Doctor. Restart Codex after plugin registration changes."
  Write-Utf8NoBom (Join-Path $Root "references\security.md") "# Security`r`n`r`nStandard Mode never uses microphone and does not upload transcripts or audio. Duplex Mode is opt-in and uses microphone only while the shell is running."
  Write-Utf8NoBom (Join-Path $Root "references\troubleshooting.md") "# Troubleshooting`r`n`r`nRun Doctor, repair installation, restart Codex, then collect a support bundle if speech still fails."
  Write-Utf8NoBom (Join-Path $Root "references\known-limitations.md") "# Known Limitations`r`n`r`nCodex toolbar placement is controlled by Codex Desktop; Dom TTS registers as a skill/plugin capability rather than a forced native toolbar icon."
}

function Write-Marketplace {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $MarketplacePath) | Out-Null
  $marketplace = @{
    name = "dom-tts-local"
    interface = @{ displayName = "Dom TTS Local" }
    plugins = @(
      @{
        name = "dom-tts"
        source = @{ source = "local"; path = "./plugins/dom-tts" }
        policy = @{ installation = "INSTALLED_BY_DEFAULT"; authentication = "ON_USE" }
        category = "Productivity"
      },
      @{
        name = "read-aloud"
        source = @{ source = "local"; path = "./plugins/read-aloud" }
        policy = @{ installation = "AVAILABLE"; authentication = "ON_USE" }
        category = "Productivity"
      }
    )
  }
  Write-Utf8NoBom $MarketplacePath ($marketplace | ConvertTo-Json -Depth 8)
}

function Upsert-ConfigBlock($Text, $Header, $Body) {
  $escaped = [regex]::Escape($Header)
  if ($Text -match $escaped) { return $Text }
  return ($Text.TrimEnd() + "`r`n`r`n$Header`r`n$Body`r`n")
}

function Write-CodexConfig {
  $config = if (Test-Path -LiteralPath $ConfigPath) { Get-Content -LiteralPath $ConfigPath -Raw } else { "" }
  $stamp = (Get-Date).ToUniversalTime().ToString("s") + "Z"
  $root = "\\?\$CodexHome"
  $config = Upsert-ConfigBlock $config "[marketplaces.dom-tts-local]" "last_updated = `"$stamp`"`r`nsource_type = `"local`"`r`nsource = '$root'"
  $config = Upsert-ConfigBlock $config "[plugins.`"dom-tts@dom-tts-local`"]" "enabled = true"
  Write-Utf8NoBom $ConfigPath $config
}

function Try-NativeRegistration {
  if ($SkipNativeRegistration) { return "skipped" }
  $cmd = Get-Command codex.exe -ErrorAction SilentlyContinue
  if (-not $cmd) { return "codex-cli-not-found" }
  $process = Start-Process -FilePath $cmd.Source -ArgumentList @("plugin", "marketplace", "add", $CodexHome) -NoNewWindow -Wait -PassThru
  if ($process.ExitCode -eq 0) { return "native-cli" }
  return "native-cli-failed"
}

function Write-Launchers {
  New-Item -ItemType Directory -Force -Path $Workspace | Out-Null
  Write-Cmd (Join-Path $Workspace "start-dom-tts-global.cmd") 'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.codex\skills\read-aloud\scripts\start-global-watcher.ps1"'
  Write-Cmd (Join-Path $Workspace "stream-dom-tts-global.cmd") 'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.codex\skills\read-aloud\scripts\start-global-watcher.ps1" -StreamMessages'
  Write-Cmd (Join-Path $Workspace "stop-dom-tts.cmd") 'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.codex\skills\read-aloud\scripts\stop-watcher.ps1" && node "%USERPROFILE%\.codex\skills\read-aloud\scripts\stop.js"'
  Write-Cmd (Join-Path $Workspace "dom-tts-settings.cmd") 'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.codex\skills\read-aloud\scripts\settings.ps1"'
  Write-Cmd (Join-Path $Workspace "dom-tts-control.cmd") 'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.codex\skills\read-aloud\scripts\control-panel.ps1"'
  Write-Cmd (Join-Path $Workspace "dom-tts-tray.cmd") 'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.codex\skills\read-aloud\scripts\tray-app.ps1"'
  Write-Cmd (Join-Path $Workspace "dom-tts-avatar.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\avatar-server.js"'
  Write-Cmd (Join-Path $Workspace "dom-tts-avatar-sb2.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\avatar-server.js" --device sb2'
  Write-Cmd (Join-Path $Workspace "dom-tts-avatar-sb3.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\avatar-server.js" --device sb3'
  Write-Cmd (Join-Path $Workspace "dom-tts-avatar-auto-sb2.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\avatar-screen-switcher.js" --device sb2'
  Write-Cmd (Join-Path $Workspace "dom-tts-avatar-auto-sb3.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\avatar-screen-switcher.js" --device sb3'
  Write-Cmd (Join-Path $Workspace "dom-tts-avatar-auto-stop.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\stop-avatar-screen-switcher.js"'
  Write-Cmd (Join-Path $Workspace "dom-tts-avatar-stop.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\stop-avatar-server.js"'
  Write-Cmd (Join-Path $Workspace "dom-tts-doctor.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\doctor.js"'
  Write-Cmd (Join-Path $Workspace "dom-tts-support-bundle.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\support-bundle.js"'
  Write-Cmd (Join-Path $Workspace "install-dom-tts.cmd") 'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.codex\skills\read-aloud\scripts\install-dom-tts.ps1"'
  if ($IncludeDuplex -or $InstallMode -eq "Advanced") {
    Write-Cmd (Join-Path $Workspace "dom-tts-shell.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\duplex-shell.js"'
    Write-Cmd (Join-Path $Workspace "dom-tts-shell-stop.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\stop-duplex-shell.js"'
    Write-Cmd (Join-Path $Workspace "dom-tts-voice-doctor.cmd") 'node "%USERPROFILE%\.codex\skills\read-aloud\scripts\voice-doctor.js"'
  }
}

function Write-Shortcuts {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $programs = [Environment]::GetFolderPath("Programs")
  $startup = [Environment]::GetFolderPath("Startup")
  $folder = Join-Path $programs "Dom TTS"
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  New-Shortcut (Join-Path $desktop "Dom TTS Control.lnk") (Join-Path $Workspace "dom-tts-control.cmd") "Open Dom TTS Control."
  New-Shortcut (Join-Path $folder "Dom TTS Control.lnk") (Join-Path $Workspace "dom-tts-control.cmd") "Open Dom TTS Control."
  New-Shortcut (Join-Path $folder "Dom TTS Settings.lnk") (Join-Path $Workspace "dom-tts-settings.cmd") "Open Dom TTS Settings."
  New-Shortcut (Join-Path $folder "Dom TTS Avatar.lnk") (Join-Path $Workspace "dom-tts-avatar.cmd") "Open Dom TTS Bob and Bab Avatar."
  New-Shortcut (Join-Path $folder "Dom TTS Avatar SB2 Bab.lnk") (Join-Path $Workspace "dom-tts-avatar-sb2.cmd") "Open Dom TTS Bab avatar for SB2."
  New-Shortcut (Join-Path $folder "Dom TTS Avatar SB3 Bob.lnk") (Join-Path $Workspace "dom-tts-avatar-sb3.cmd") "Open Dom TTS Bob avatar for SB3."
  New-Shortcut (Join-Path $folder "Dom TTS Auto Avatar SB2 Bab.lnk") (Join-Path $Workspace "dom-tts-avatar-auto-sb2.cmd") "Auto-show Bab avatar on SB2 only while Bab is active."
  New-Shortcut (Join-Path $folder "Dom TTS Auto Avatar SB3 Bob.lnk") (Join-Path $Workspace "dom-tts-avatar-auto-sb3.cmd") "Auto-show Bob avatar on SB3 only while Bob is active."
  New-Shortcut (Join-Path $folder "Dom TTS Doctor.lnk") (Join-Path $Workspace "dom-tts-doctor.cmd") "Run Dom TTS Doctor."
  New-Shortcut (Join-Path $folder "Dom TTS Support Bundle.lnk") (Join-Path $Workspace "dom-tts-support-bundle.cmd") "Collect a redacted Dom TTS support bundle."
  if (-not $NoStartup) {
    New-Shortcut (Join-Path $startup "Dom TTS Read-Aloud Global.lnk") (Join-Path $Workspace "start-dom-tts-global.cmd") "Start Dom TTS Read-Aloud at sign-in."
    New-Shortcut (Join-Path $startup "Dom TTS Tray.lnk") (Join-Path $Workspace "dom-tts-tray.cmd") "Start Dom TTS tray at sign-in."
  }
}

function Write-Manifests($NodeCommand) {
  $nodeMode = if ($NodeCommand -like "$RuntimeVersion*") { "bundled" } else { "system-fallback" }
  $manifest = @{
    product = "Dom TTS"
    publisher = "42.uk"
    author = "Prof Dom Marrocco"
    version = $Version
    installId = [guid]::NewGuid().ToString()
    installedAt = (Get-Date).ToUniversalTime().ToString("o")
    installMode = $InstallMode
    standardMode = $true
    duplexMode = [bool]($IncludeDuplex -or $InstallMode -eq "Advanced")
    codexMarketplaceRegistration = $RegistrationStatus
    fallbackUsed = $FallbackUsed
    runtimePath = $RuntimeVersion
    nodeMode = $nodeMode
    signedInstaller = $false
  }
  Write-Utf8NoBom $InstallManifest ($manifest | ConvertTo-Json -Depth 8)
  Write-Utf8NoBom $CurrentJson (@{
    version = $Version
    runtimePath = $RuntimeVersion
    skillPath = $TargetSkill
    pluginPath = $DomPluginRoot
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Depth 5)
}

function Clean-Remove {
  if (Test-Path -LiteralPath $DomPluginRoot) { Remove-Item -LiteralPath $DomPluginRoot -Recurse -Force }
  if ($RemoveAllData -and (Test-Path -LiteralPath $RuntimeHome)) { Remove-Item -LiteralPath $RuntimeHome -Recurse -Force }
  Write-Host "Dom TTS Clean Remove complete. Compatibility read-aloud skill/plugin was left in place unless RemoveAllData is paired with manual removal."
}

try {
  if ($InstallMode -eq "CleanRemove") {
    Clean-Remove
    exit 0
  }

  New-Item -ItemType Directory -Force -Path $RuntimeHome, (Join-Path $RuntimeHome "state"), (Join-Path $RuntimeHome "logs"), (Join-Path $RuntimeHome "support-bundles"), $BackupRoot | Out-Null
  Backup-IfExists $RuntimeVersion "runtime-version"
  Backup-IfExists $DomPluginRoot "plugin-dom-tts"
  Backup-IfExists $CompatPluginRoot "plugin-read-aloud"
  Backup-IfExists $TargetSkill "skill-read-aloud"
  Backup-IfExists $MarketplacePath "marketplace.json"
  Backup-IfExists $ConfigPath "config.toml"

  Copy-Clean $Source $RuntimeSkill @("state")
  $sourceResolved = (Resolve-Path -LiteralPath $Source).Path
  $targetResolved = if (Test-Path -LiteralPath $TargetSkill) { (Resolve-Path -LiteralPath $TargetSkill).Path } else { "" }
  if ($sourceResolved -ne $targetResolved) {
    Copy-Clean $Source $TargetSkill @("state")
  }
  Push-Location $TargetSkill
  try {
    if (-not (Test-Path -LiteralPath (Join-Path $TargetSkill "node_modules\node-edge-tts"))) {
      npm.cmd install
    }
  } finally {
    Pop-Location
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $DomPluginRoot "skills"), (Join-Path $CompatPluginRoot "skills") | Out-Null
  Copy-Clean $TargetSkill $DomPluginSkill @("state")
  Copy-Clean $TargetSkill $CompatPluginSkill @("state")
  Write-InstallerSkill $InstallerSkill
  Write-PluginJson $DomPluginRoot "dom-tts" "Dom TTS" "Codex-native voice setup and read-aloud"
  Write-PluginJson $CompatPluginRoot "read-aloud" "Dom TTS Read-Aloud" "Compatibility Codex read-aloud plugin"

  Write-Marketplace
  $RegistrationStatus = Try-NativeRegistration
  if ($RegistrationStatus -ne "native-cli") { $FallbackUsed = $true }
  Write-CodexConfig
  Write-Launchers
  Write-Shortcuts
  $nodeCommand = Get-NodeCommand
  Write-Manifests $nodeCommand

  & $nodeCommand (Join-Path $TargetSkill "scripts\check-codex-transcript-schema.js") | Out-Host
  & $nodeCommand (Join-Path $TargetSkill "scripts\doctor.js") | Out-Host
  if ($Probe) { & $nodeCommand (Join-Path $TargetSkill "scripts\doctor.js") --probe | Out-Host }

  Write-Host ""
  Write-Host "Dom TTS v$Version installation complete."
  Write-Host "Registration: $RegistrationStatus"
  Write-Host "Fallback registration used: $FallbackUsed"
  Write-Host "Restart Codex Desktop so plugin and skill metadata refresh."
} catch {
  Write-Error "Dom TTS install failed: $($_.Exception.Message)"
  Restore-IfExists "runtime-version" $RuntimeVersion
  Restore-IfExists "plugin-dom-tts" $DomPluginRoot
  Restore-IfExists "plugin-read-aloud" $CompatPluginRoot
  Restore-IfExists "skill-read-aloud" $TargetSkill
  Restore-IfExists "marketplace.json" $MarketplacePath
  Restore-IfExists "config.toml" $ConfigPath
  throw
}
