# MEMORY.md - IronCoach

## Tägliche Memory-Archiv

Memory wird jetzt in täglichen Dateien im [memory/](memory/) Ordner gespeichert.

### Heute
- [memory/2026-03-24.md](memory/2026-03-24.md)

### Archiv (nach Monat gruppiert)
*Neue Dateien werden automatisch hinzugefügt*

---

## Quick-Reference Übersicht

### Aktive Projekte
- Trainings Tracker Web App (in Planung)
- **Aktiver Trainingsplan**: [trainingsplan_gleitwirbel.md](trainingsplan_gleitwirbel.md) - 7-Tage Plan mit ADIM-Core, Judo-Integration, Dehnen

### User-Präferenzen
- Name: Martin
- Timezone: Europe/Vienna
- Sprache: Deutsch
- Kommunikation: Direkt und präzise, keine Filler
- **Sport**: Judoka (Montag + Freitag Training)
- **Medizinisch**: Gleitwirbel (Spondylolisthesis) - Core-Training muss tiefen Rumpf (Transversus abdominis) fokussieren, KEINE Crunches/Sit-ups

### Wichtige System-Änderungen
- **2026-03-21**: Umstellung auf tägliche Memory-Dateien
- **2026-07-20**: Dauerhafter Login implementiert (Session 1 Jahr + JWT Refresh-Token)
- **2026-07-20**: Statistik korrigiert – Datum wird als lokales Datum interpretiert, mehrfache Übungen pro Tag werden zusammengerechnet (Gewicht = Max, Wiederholungen = Sätze × Reps summiert)
- **2026-07-20**: Cache-Buster auf `app.js?v=15` erhöht
- **2026-07-20**: Google-Login Fix: `RENDER_EXTERNAL_URL` hat Priorität für Callback-URI, `prompt=select_account` entfernt für automatischen Account-Weiterleitung, Fehlermeldungen bei `redirect_uri_mismatch` werden angezeigt
- **2026-07-20**: Google-Login auf Render blockiert durch `redirect_uri_mismatch`; zu hinterlegende URI: `https://iron-coach-90eu.onrender.com/auth/google/callback`. Render braucht Umgebungsvariablen: `GOOGLE_CALLBACK_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NODE_ENV=production`, `JWT_SECRET`, `SESSION_SECRET`
- **2026-07-21**: Übungs-Info-Leiste hinzugefügt – `info` Spalte in `exercises`, Info-Textarea beim Erstellen/Bearbeiten, aufklappbare Info-Leiste in gespeicherten Workouts. Cache-Buster `app.js?v=16`
- **2026-07-21**: Bugfix nach Info-Leiste: Auto-Heal für fehlende `info` Spalte in `/api/exercises` und `/api/workouts`, bessere Empty-State Meldung (Login-Hinweis/Neu-laden), HTML-Fix in Übungsliste, Cache-Buster `app.js?v=17`
- **2026-07-23**: Workout-Info-Leiste – `info` Spalte in `workouts`, Info-Textarea im Workout-Formular, aufklappbare Info-Leiste zeigt Übungs-Info + Workout-Notiz getrennt; Auto-Heal für fehlende Spalte; Cache-Buster `app.js?v=18`
- **2026-08-02**: v1.3.0+ – Render-Deployment vorbereitet, `GOOGLE_CALLBACK_URL` konsistent, Drive-Refresh-Token dauerhaft gespeichert, JWT-Refresh-Token bei Google-Login erhalten
- **2026-08-26**: Lokaler Tailscale-Betrieb eingerichtet. IronCoach läuft lokal auf Port 3001 und ist über Tailscale erreichbar: `https://martins-pc-1.tail9b3a7c.ts.net:8443`. Start/Stop-Scripts: `start_ironcoach_tailscale.ps1` / `stop_ironcoach_tailscale.ps1`. Daten bleiben in `training.db` lokal. Google-Login erfordert Redirect-URI `https://martins-pc-1.tail9b3a7c.ts.net:8443/auth/google/callback`.
- **2026-08-31**: v1.3.4 – Ursache "fehlende Workouts auf Render" gefunden: Render Free hat eine **ephemere Disk**, die SQLite-DB wird bei jedem Neustart/Deploy geleert und der Server vergibt danach neue User-IDs → das alte per-User-Drive-Restore (`ironcoach_backup_user<ID>.db`) fand das Backup nie. Fix: neuer Endpoint `POST /api/restore/drive/merge` lädt das neueste `ironcoach_backup_user*.db` aus Drive und merged es ins **aktuelle** Konto (Übungen per Name-Matching, Workouts remapped, Pläne importiert); Frontend macht das beim App-Start automatisch, wenn 0 Workouts vorhanden sind (onlyIfEmpty = Duplikat-Schutz), plus manueller Button im Backup-Modal. Auto-Drive-Backup nach jedem Speichern existierte bereits. Cache-Buster `app.js?v=36`. Google-OAuth auf Render verifiziert: Client-ID/Secret gesetzt, Redirect-URI registriert, Callback-URL korrekt.

---
Last updated: 2026-08-26
Source: memory/MEMORY.md
