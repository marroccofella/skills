param(
  [string]$Target = "$env:USERPROFILE\.codex\skills\read-aloud"
)

$ErrorActionPreference = "Stop"
$Source = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
if ((Resolve-Path $Source).Path -ne (Resolve-Path (Split-Path -Parent $Target) -ErrorAction SilentlyContinue).Path) {
  Copy-Item -LiteralPath $Source -Destination (Split-Path -Parent $Target) -Recurse -Force
}

Push-Location $Target
try {
  if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    npm.cmd install
  } else {
    Write-Warning "npm.cmd was not found. Install Node.js, then run npm.cmd install in $Target."
  }
  node scripts\speak.js --provider sapi --mode full --profile conversational --text "Dom TTS Read-Aloud installed."
  node scripts\status.js
} finally {
  Pop-Location
}
