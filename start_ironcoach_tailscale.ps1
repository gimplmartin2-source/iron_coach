#Requires -Version 5.1
<#
.SYNOPSIS
    Startet IronCoach lokal und macht es ueber Tailscale erreichbar.
.DESCRIPTION
    Laedt .env, ueberschreibt Werte fuer Tailscale, startet Node.js auf Port 3001
    und richtet Tailscale HTTPS auf Port 8443 ein.
#>

$ErrorActionPreference = "Stop"

$projectDir = "C:\Users\maxgi\OneDrive\000_CODEX_WORK\03_ironcoach"
$nodePort = 3001
$tailscalePort = 8443
$pidFile = "$projectDir\ironcoach_tailscale.pid"

Set-Location $projectDir

# 1. Lokale .env laden (wenn vorhanden) – ohne bestehende Prozessvariablen zu ueberschreiben
$envFile = "$projectDir\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            if ($line -match "^(.*?)=(.*)$") {
                $key = $matches[1].Trim()
                $val = $matches[2].Trim()
                if ($val.StartsWith('"') -and $val.EndsWith('"')) {
                    $val = $val.Substring(1, $val.Length - 2)
                }
                if (-not (Test-Path "Env:$key")) {
                    [Environment]::SetEnvironmentVariable($key, $val, "Process")
                }
            }
        }
    }
}

# 2. Tailscale-Hostname ermitteln und Overrides setzen
$tsStatus = tailscale status --json | ConvertFrom-Json
$tailnetName = $tsStatus.Self.DNSName.TrimEnd('.')

$env:NODE_ENV = "production"
$env:PORT = "$nodePort"
$env:HOST = $tailnetName
$env:GOOGLE_CALLBACK_URL = "https://${tailnetName}:$tailscalePort/auth/google/callback"

# No-Auth-Modus: Login ueberspringen, alle Anfragen laufen als Martins Account.
# Server bindet dann NUR an 127.0.0.1 -> erreichbar ausschliesslich am PC
# selbst und ueber Tailscale serve (HTTPS). Render bleibt unberuehrt.
# WICHTIG: User 21 = Martins Google-Account (in der DB gibt es aeltere Test-User).
$env:AUTH_DISABLED = "1"
$env:AUTH_DISABLED_USER_ID = "21"

Write-Host "`nIronCoach wird gestartet..."
Write-Host "Lokaler Node-Port : $nodePort"
Write-Host "Tailscale Hostname: $tailnetName"
Write-Host "Oeffentliche URL  : https://${tailnetName}:$tailscalePort"
Write-Host "Login            : deaktiviert (No-Auth-Modus, nur 127.0.0.1 + Tailscale)"

# 3. Node.js im Hintergrund starten
$nodeProc = Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js" -PassThru -RedirectStandardOutput "ironcoach.out.log" -RedirectStandardError "ironcoach.err.log"
$nodeProc.Id | Set-Content $pidFile

# 4. Warten, bis der lokale Health-Check antwortet
$maxWait = 30
$started = $false
$version = $null
for ($i = 0; $i -lt $maxWait; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$nodePort/api/health" -Method GET -TimeoutSec 2
        if ($resp.version) {
            $started = $true
            $version = $resp.version
            break
        }
    } catch {
        # Noch nicht bereit
    }
    Start-Sleep -Seconds 1
}

if (-not $started) {
    Write-Error "IronCoach ist nicht auf http://127.0.0.1:$nodePort/api/health erreichbar. Siehe ironcoach.err.log"
    exit 1
}

Write-Host "Lokaler Health-Check OK (Version: $version)"

# 5. Tailscale HTTPS auf Port 8443 einrichten
Write-Host "Tailscale HTTPS-Weiterleitung wird eingerichtet..."
tailscale serve --bg --yes --https=$tailscalePort "http://127.0.0.1:$nodePort" | Out-Null

# Kurz warten und pruefen
Start-Sleep -Seconds 2
$tsStatusAfter = tailscale serve status --json | ConvertFrom-Json
$handler = $tsStatusAfter.Web.PSObject.Properties | Where-Object { $_.Name -like "*:$tailscalePort" }
if ($handler) {
    Write-Host "Tailscale-Handler aktiv: $($handler.Name)"
} else {
    Write-Warning "Tailscale-Handler konnte nicht verifiziert werden. Status manuell pruefen: tailscale serve status"
}

Write-Host ""
Write-Host "IronCoach laeuft jetzt lokal und ist ueber Tailscale erreichbar:"
Write-Host "  https://${tailnetName}:$tailscalePort"
Write-Host ""
Write-Host "WICHTIG fuer Google-Login:"
Write-Host "  In der Google Cloud Console muss diese Redirect-URI hinterlegt sein:"
Write-Host "  https://${tailnetName}:$tailscalePort/auth/google/callback"
Write-Host ""
Write-Host "Stoppen geht mit: .\stop_ironcoach_tailscale.ps1"
