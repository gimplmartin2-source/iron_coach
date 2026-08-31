#Requires -Version 5.1
<#
.SYNOPSIS
    Stoppt die lokale IronCoach-Instanz und entfernt die Tailscale-Weiterleitung.
#>

$ErrorActionPreference = "Stop"

$projectDir = "C:\Users\maxgi\OneDrive\000_CODEX_WORK\03_ironcoach"
$nodePort = 3001
$tailscalePort = 8443
$pidFile = "$projectDir\ironcoach_tailscale.pid"

Set-Location $projectDir

# 1. Node.js-Prozess stoppen
$stopped = $false
if (Test-Path $pidFile) {
    $pidValue = Get-Content $pidFile
    try {
        Stop-Process -Id $pidValue -Force -ErrorAction Stop
        Write-Host "IronCoach (PID $pidValue) wurde gestoppt."
        $stopped = $true
    } catch {
        Write-Host "Gespeicherte PID war nicht mehr aktiv."
    }
    Remove-Item $pidFile -Force
}

if (-not $stopped) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $nodePort -ErrorAction Stop | Select-Object -First 1
        if ($conn -and $conn.OwningProcess) {
            Stop-Process -Id $conn.OwningProcess -Force
            Write-Host "IronCoach (Port $nodePort, PID $($conn.OwningProcess)) wurde gestoppt."
            $stopped = $true
        }
    } catch {
        Write-Host "Kein Prozess auf Port $nodePort gefunden."
    }
}

# 2. Tailscale HTTPS-Weiterleitung fuer diesen Port entfernen (Polsia bleibt erhalten)
Write-Host "Entferne Tailscale HTTPS-Weiterleitung auf Port $tailscalePort ..."
$offOutput = tailscale serve --https=$tailscalePort off 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Tailscale-Weiterleitung auf Port $tailscalePort entfernt."
} elseif ($offOutput -match "handler does not exist") {
    Write-Host "Tailscale-Weiterleitung auf Port $tailscalePort war bereits entfernt."
} else {
    Write-Warning "Tailscale-Weiterleitung konnte nicht automatisch entfernt werden: $offOutput"
}

Write-Host ""
Write-Host "IronCoach ist jetzt gestoppt. Polsia auf /command-center laeuft weiter."
