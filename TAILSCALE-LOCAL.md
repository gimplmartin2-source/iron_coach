# IronCoach lokal + Tailscale

Das Projekt laeuft jetzt auch lokal auf Martins PC und ist ueber Tailscale erreichbar.

## Starten

PowerShell im Projektordner oeffnen:

```powershell
.\start_ironcoach_tailscale.ps1
```

Das Skript macht automatisch:
- Laedt die lokale `.env`
- Startet IronCoach auf `http://127.0.0.1:3001`
- Richtet Tailscale HTTPS ein: `https://martins-pc-1.tail9b3a7c.ts.net:8443`

## Aufrufen

- Lokal: http://127.0.0.1:3001
- Tailscale (privat, nur im Tailnet): https://martins-pc-1.tail9b3a7c.ts.net:8443

## Stoppen

```powershell
.\stop_ironcoach_tailscale.ps1
```

Stoppt nur IronCoach; Polsia auf `/command-center` bleibt unberuehrt.

## Google-Login

Falls Google-Login auch ueber Tailscale funktionieren soll, muss in der Google Cloud Console fuer die Client-ID `534050491746-...` diese Redirect-URI hinterlegt sein:

```
https://martins-pc-1.tail9b3a7c.ts.net:8443/auth/google/callback
```

Lokaler Login funktioniert sofort ohne Zusatzkonfiguration.

## Daten

Die SQLite-Datenbank ist weiterhin `training.db` im Projektordner. Sie bleibt lokal auf dem PC. Ein Backup wurde vor dem ersten Start unter `backups/training.db.backup-20260826` abgelegt.
