# IronCoach - Google Sheets Version

## Was ist neu?
- Daten werden jetzt in **Google Sheets** gespeichert (statt SQLite)
- Jeder Nutzer bekommt ein eigenes Google Sheet bei der Anmeldung
- Zugriff über: https://docs.google.com/spreadsheets/d/[ID]/edit

## Setup

### 1. Google Cloud Console (bereits gemacht ✅)
- [x] Scopes eingetragen:
  - `https://www.googleapis.com/auth/spreadsheets`
  - `https://www.googleapis.com/auth/drive.file`

### 2. Code deployen
```bash
git add .
git commit -m "Migrate to Google Sheets storage"
git push
```

Dann in Render: **Manual Deploy**

### 3. Testen
- Mit Google anmelden
- Automatisch wird ein Sheet erstellt: "IronCoach - Trainingsdaten"
- Daten erscheinen in deinem Google Drive

## Wichtige Änderungen

| Feature | Vorher | Jetzt |
|---------|--------|-------|
| Speicher | SQLite (lokal) | Google Sheets (Drive) |
| Zugriff | Nur App | App + Google Sheets Web |
| Backup | Keiner | Automatisch via Google |
| Teilen | Nicht möglich | Per Google Share möglich |

## Hinweise
- **Lokale Anmeldung** (Email/Passwort) funktioniert für Login, aber Daten speichern geht nur mit Google OAuth
- Das Sheet hat 2 Tabs: "Exercises" und "Workouts"
- Du kannst das Sheet direkt in Google Sheets öffnen und bearbeiten

## Fehlerbehebung

### "Fehler beim Speichern"
- Prüfe ob Google OAuth Scopes korrekt sind
- Eventuell Token erneuern: Abmelden und neu anmelden

### Kein Spreadsheet erstellt
- Siehe Render Logs für Fehlermeldungen
- Re-Login versuchen

---
Letzte Änderung: Migration zu Google Sheets
