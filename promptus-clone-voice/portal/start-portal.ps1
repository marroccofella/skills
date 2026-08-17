$ErrorActionPreference = "Stop"
$installRoot = $env:PROMPTUS_INSTALL_ROOT
if (-not $installRoot) {
    $installRecord = Join-Path $env:APPDATA "promptusai\install.json"
    if (Test-Path -LiteralPath $installRecord) {
        try {
            $installRoot = (Get-Content -Raw -LiteralPath $installRecord | ConvertFrom-Json).installRoot
        } catch {
            throw "Promptus install discovery is unreadable: $installRecord"
        }
    }
}
if (-not $installRoot) {
    $installRoot = Join-Path $env:LOCALAPPDATA "PromptusAI"
}
$portal = Join-Path $PSScriptRoot "app.py"
$python = Join-Path $installRoot "cosy\venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "Promptus Python was not found under the discovered install root: $installRoot"
}
& $python -c "import flask, numpy, soundfile" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "The Promptus Cosy environment is missing Flask, numpy, or soundfile. Repair it before starting the portal."
}
$openBrowser = Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process "http://127.0.0.1:8765"
}
try {
    & $python $portal
} finally {
    Remove-Job -Job $openBrowser -Force -ErrorAction SilentlyContinue
}
