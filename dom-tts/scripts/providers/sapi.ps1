param([Parameter(Mandatory=$true)][string]$InputFile)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
Add-Type -AssemblyName System.Speech
$payload = Get-Content -LiteralPath $InputFile -Raw -Encoding UTF8 | ConvertFrom-Json
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    if ($payload.voice) { $speaker.SelectVoice([string]$payload.voice) }
    $speaker.Rate = [int]$payload.rate
    for ($i = 0; $i -lt $payload.chunks.Count; $i++) {
        [Console]::WriteLine("CHUNK $i")
        $speaker.Speak([string]$payload.chunks[$i])
    }
} finally { $speaker.Dispose() }
