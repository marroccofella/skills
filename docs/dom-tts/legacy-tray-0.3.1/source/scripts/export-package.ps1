param(
  [string]$Destination = ""
)

$ErrorActionPreference = "Stop"
$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Version = (Get-Content -Raw (Join-Path $SkillRoot "package.json") | ConvertFrom-Json).version

if ([string]::IsNullOrWhiteSpace($Destination)) {
  $Destination = Join-Path (Get-Location).Path "dom-tts-read-aloud-skill-v$Version.zip"
}

$TempRoot = Join-Path $env:TEMP "dom-tts-read-aloud-skill-export"
$Stage = Join-Path $TempRoot "read-aloud"
if (Test-Path $TempRoot) {
  Remove-Item -LiteralPath $TempRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

Get-ChildItem -LiteralPath $SkillRoot -Force |
  Where-Object { $_.Name -notin @("node_modules", "state") } |
  ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Stage -Recurse -Force }

if (Test-Path $Destination) {
  Remove-Item -LiteralPath $Destination -Force
}

Compress-Archive -LiteralPath $Stage -DestinationPath $Destination -Force
Write-Host "Exported $Destination"
