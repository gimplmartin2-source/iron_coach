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

---
Last updated: 2026-07-21
Source: memory/MEMORY.md
