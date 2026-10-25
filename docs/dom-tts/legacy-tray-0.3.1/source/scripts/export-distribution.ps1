param(
  [string]$Destination = (Join-Path $env:USERPROFILE "DomTTS-dist"),
  [switch]$SkipInstallerBuild
)

$ErrorActionPreference = "Stop"
$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Package = Get-Content -Raw (Join-Path $SkillRoot "package.json") | ConvertFrom-Json
$Version = $Package.version
$CodexHome = Join-Path $env:USERPROFILE ".codex"
$DomPlugin = Join-Path $CodexHome "plugins\dom-tts"
$Dist = $Destination
$Temp = Join-Path $env:TEMP "dom-tts-dist-$Version"

function Write-Utf8NoBom($Path, $Text) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Copy-Clean($From, $To) {
  if (Test-Path -LiteralPath $To) { Remove-Item -LiteralPath $To -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  Get-ChildItem -LiteralPath $From -Force |
    Where-Object { $_.Name -notin @("state") } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $To -Recurse -Force }
}

function Zip-Folder($Folder, $Zip) {
  if (Test-Path -LiteralPath $Zip) { Remove-Item -LiteralPath $Zip -Force }
  Compress-Archive -Path (Join-Path $Folder "*") -DestinationPath $Zip -Force
}

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
if (Test-Path -LiteralPath $Temp) { Remove-Item -LiteralPath $Temp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Temp | Out-Null

if (-not (Test-Path -LiteralPath $DomPlugin)) {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $SkillRoot "scripts\install-dom-tts.ps1") -InstallMode Repair -SkipNativeRegistration | Out-Host
}

$marketStage = Join-Path $Temp "marketplace"
New-Item -ItemType Directory -Force -Path (Join-Path $marketStage ".agents\plugins"), (Join-Path $marketStage "plugins") | Out-Null
Copy-Clean $DomPlugin (Join-Path $marketStage "plugins\dom-tts")
Write-Utf8NoBom (Join-Path $marketStage ".agents\plugins\marketplace.json") (@{
  name = "dom-tts-local"
  interface = @{ displayName = "Dom TTS Local" }
  plugins = @(@{
    name = "dom-tts"
    source = @{ source = "local"; path = "./plugins/dom-tts" }
    policy = @{ installation = "INSTALLED_BY_DEFAULT"; authentication = "ON_USE" }
    category = "Productivity"
  })
} | ConvertTo-Json -Depth 8)
Zip-Folder $marketStage (Join-Path $Dist "dom-tts-codex-marketplace-v$Version.zip")

$portableStage = Join-Path $Temp "portable\DomTTS-v$Version-portable"
New-Item -ItemType Directory -Force -Path $portableStage | Out-Null
Copy-Clean $SkillRoot (Join-Path $portableStage "read-aloud")
Copy-Item -LiteralPath (Join-Path $DomPlugin "skills\dom-tts-installer") -Destination (Join-Path $portableStage "dom-tts-installer") -Recurse -Force
Write-Utf8NoBom (Join-Path $portableStage "install-standard.cmd") '@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0read-aloud\scripts\install-dom-tts.ps1" -InstallMode Recommended
'
Write-Utf8NoBom (Join-Path $portableStage "README-FIRST.txt") "Dom TTS v$Version portable package. Run install-standard.cmd, restart Codex, then ask @Dom TTS run Doctor."
Zip-Folder (Join-Path $Temp "portable") (Join-Path $Dist "DomTTS-v$Version-portable.zip")

Write-Utf8NoBom (Join-Path $Dist "INSTALL-WITH-CODEX.md") @"
# Install Dom TTS with Codex

1. Extract `dom-tts-codex-marketplace-v$Version.zip` to `%USERPROFILE%\.codex`.
2. Run `codex plugin marketplace add "%USERPROFILE%\.codex"` when Codex CLI is available.
3. Restart Codex Desktop.
4. Ask: `@Dom TTS run Doctor`.
5. Ask: `@Dom TTS start all-chat read-aloud`.
"@

Write-Utf8NoBom (Join-Path $Dist "INSTALL-WITH-WINDOWS-INSTALLER.md") @"
# Install Dom TTS with the Windows Installer

Use `DomTTS-v$Version-Setup.exe` when available. The signed public installer installs Standard Mode by default and keeps Duplex Mode optional/experimental.

If the setup EXE is missing, this machine does not currently have Inno Setup available. Use the portable ZIP or run `scripts\install-dom-tts.ps1`.
"@

Write-Utf8NoBom (Join-Path $Dist "TROUBLESHOOTING.md") @"
# Dom TTS Troubleshooting

Run `dom-tts-doctor.cmd`.

If Codex does not show Dom TTS, restart Codex Desktop and run `codex plugin marketplace add "%USERPROFILE%\.codex"`.

If speech does not play, run `node %USERPROFILE%\.codex\skills\read-aloud\scripts\doctor.js --probe`.

To collect a redacted support bundle, run `dom-tts-support-bundle.cmd`.
"@

Write-Utf8NoBom (Join-Path $Dist "RELEASE_NOTES-v$Version.md") @"
# Dom TTS v$Version Release Notes

- Adds Codex-native `dom-tts` plugin packaging.
- Adds `dom-tts-installer` operator skill.
- Adds versioned runtime manifest under `%LOCALAPPDATA%\42uk\DomTTS`.
- Adds transcript compatibility check and redacted support bundles.
- Adds Bob/Bab Matrix avatar window launched from tray, control panel, or `dom-tts-avatar.cmd`.
- Adds SB2/Bab and SB3/Bob full-screen avatar device modes with invisible face push-to-talk.
- Adds automatic SB2/SB3 screen cut-in launchers that show the relevant full-screen avatar only while Bob or Bab is active, then close their own browser window.
- Keeps Standard Mode default and release-blocking.
- Keeps Duplex Mode optional and isolated.
- Keeps internal skill id `read-aloud` for compatibility.
"@

$installerDir = Join-Path $Dist "installer"
New-Item -ItemType Directory -Force -Path $installerDir | Out-Null
$installerPayload = Join-Path $installerDir "payload"
Copy-Clean $portableStage $installerPayload
$iss = Join-Path $installerDir "DomTTS-v$Version.iss"
Write-Utf8NoBom $iss @"
#define MyAppVersion "$Version"
[Setup]
AppName=Dom TTS
AppVersion={#MyAppVersion}
AppPublisher=42.uk
AppPublisherURL=https://42.uk
DefaultDirName={localappdata}\42uk\DomTTS\installer-payload
DefaultGroupName=Dom TTS
OutputDir=$Dist
OutputBaseFilename=DomTTS-v$Version-Setup-UNSIGNED-INTERNAL-ALPHA
Compression=lzma
SolidCompression=yes
PrivilegesRequired=lowest

[Files]
Source: "$($installerPayload)\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

[Run]
Filename: "{app}\install-standard.cmd"; Description: "Install Standard Mode and run Doctor"; Flags: postinstall nowait
"@

if (-not $SkipInstallerBuild) {
  $iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($iscc) {
    & $iscc.Source $iss | Out-Host
  } else {
    Write-Utf8NoBom (Join-Path $Dist "SETUP-EXE-NOT-BUILT.txt") "Inno Setup compiler ISCC.exe was not found on this machine. The public signed setup EXE was not built. Use the portable ZIP or install Inno Setup, then run scripts\export-distribution.ps1 again."
  }
}

$hashes = Get-ChildItem -LiteralPath $Dist -File |
  Where-Object { $_.Name -ne "SHA256SUMS.txt" } |
  ForEach-Object {
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName
    "$($hash.Hash)  $($_.Name)"
  }
Write-Utf8NoBom (Join-Path $Dist "SHA256SUMS.txt") ($hashes -join "`r`n")
Write-Host "Dom TTS distribution exported to $Dist"
