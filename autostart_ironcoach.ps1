#Requires -Version 5.1
<#
.SYNOPSIS
    Autostart-Wrapper fuer IronCoach (Startup-Ordner).
.DESCRIPTION
    Wartet auf Tailscale, prueft per Health-Check ob IronCoach schon laeuft
    (Doppelstart-Guard) und startet sonst start_ironcoach_tailscale.ps1.
    Loggt nach autostart_ironcoach.log.
#>

$projectDir = "C:\Users\maxgi\OneDrive\000_CODEX_WORK\03_ironcoach"
$logFile = "$projectDir\autostart_ironcoach.log"
$nodePort = 3001

function Write-Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content -Encoding utf8 $logFile
}

Write-Log "Autostart gestartet."

# 1. Doppelstart-Guard: laeuft IronCoach schon?
try {
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$nodePort/api/health" -TimeoutSec 3
    if ($resp.version) {
        Write-Log "IronCoach laeuft bereits (Version $($resp.version)) - kein Neustart."
        exit 0
    }
} catch {
    # Laeuft noch nicht -> weiter
}

# 2. Auf Tailscale warten (bis 120s), das Start-Skript braucht 'tailscale status --json'
$tsReady = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $ts = tailscale status --json 2>$null | ConvertFrom-Json
        if ($ts.Self.DNSName) { $tsReady = $true; break }
    } catch {
        # noch nicht bereit
    }
    Start-Sleep -Seconds 2
}
if (-not $tsReady) {
    Write-Log "WARNUNG: Tailscale war nach 120s nicht bereit - Start wird trotzdem versucht."
}

# 3. Starten
try {
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$projectDir\start_ironcoach_tailscale.ps1" 2>&1
    Write-Log ($out -join " | ")
    Write-Log "Autostart fertig."
} catch {
    Write-Log "FEHLER beim Start: $($_.Exception.Message)"
    exit 1
}
