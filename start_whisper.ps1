#Requires -Version 5.1
<#
.SYNOPSIS
    Startet den lokalen whisper.cpp-Server fuer den IronCoach Sprach-Eintrag.
.DESCRIPTION
    Liest WHISPER_SERVER_EXE und WHISPER_MODEL_PATH aus der .env (oder Umgebung)
    und startet whisper-server.exe auf 127.0.0.1:8178 (nur lokal erreichbar).
    Laeuft der Server bereits, passiert nichts. Setup siehe VOICE-SETUP.md.
#>
$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8178

$envFile = Join-Path $projectDir ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line -match "^(.*?)=(.*)$") {
            $key = $matches[1].Trim(); $val = $matches[2].Trim().Trim('"')
            if (-not (Test-Path "Env:$key")) { [Environment]::SetEnvironmentVariable($key, $val, "Process") }
        }
    }
}

if (-not $env:WHISPER_SERVER_EXE -or -not (Test-Path $env:WHISPER_SERVER_EXE)) {
    Write-Warning "WHISPER_SERVER_EXE nicht gesetzt oder Datei fehlt -> Sprach-Eintrag deaktiviert (siehe VOICE-SETUP.md)"
    exit 0
}
if (-not $env:WHISPER_MODEL_PATH -or -not (Test-Path $env:WHISPER_MODEL_PATH)) {
    Write-Warning "WHISPER_MODEL_PATH nicht gesetzt oder Modell fehlt (siehe VOICE-SETUP.md)"
    exit 0
}

$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    Write-Host "Whisper-Server laeuft bereits auf Port $port"
    exit 0
}

$threads = if ($env:WHISPER_THREADS) { $env:WHISPER_THREADS } else { [Math]::Max(4, [Environment]::ProcessorCount - 2) }
$whisperArgs = @("-m", "`"$env:WHISPER_MODEL_PATH`"", "--host", "127.0.0.1", "--port", "$port", "-l", "de", "-t", "$threads")
$proc = Start-Process -WindowStyle Hidden -FilePath $env:WHISPER_SERVER_EXE -ArgumentList $whisperArgs -PassThru `
    -RedirectStandardOutput (Join-Path $projectDir "whisper.out.log") -RedirectStandardError (Join-Path $projectDir "whisper.err.log")
$proc.Id | Set-Content (Join-Path $projectDir "whisper.pid")
Write-Host "Whisper-Server gestartet (PID $($proc.Id), Port $port, Modell $(Split-Path -Leaf $env:WHISPER_MODEL_PATH), $threads Threads)"
