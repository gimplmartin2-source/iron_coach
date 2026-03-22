# IronCoach - SQLite Version (funktioniert sofort)

## Setup

### 1. Code pushen
```bash
git add .
git commit -m "Revert to SQLite - stable working version"
git push
```

### 2. Render deployen
- Dashboard → **Manual Deploy** → **Deploy latest commit**

### 3. Testen
- https://trainings-tracker.onrender.com/login.html
- Registrieren mit Email/Passwort
- Übungen und Workouts speichern

## Wichtig

- SQLite ist **flüchtig** auf Render (bei Neustart/neuem Deploy → Daten weg)
- Für Produktion bräuchtest du PostgreSQL oder ähnliches
- Export-Funktion (CSV/JSON) ist eine Option für Backups

## Features

✅ Login mit Email/Passwort (sofort funktioniert)
✅ Login mit Google OAuth (wenn in Google Cloud Console konfiguriert)
✅ Übungen speichern/löschen
✅ Workouts speichern/löschen
✅ Statistiken anzeigen
✅ Charts für Fortschritt

## Google OAuth (optional)

Wenn du willst, dann erst später:
1. Google Cloud Console: App veröffentlichen
2. Dann funktioniert Google Login

Aber lokales Login funktioniert JETZT sofort!
