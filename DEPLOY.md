# IronCoach - Deployment & Auth Setup

## Problem
Das Login funktioniert nicht, weil:
1. **Google OAuth** ist nicht konfiguriert (fehlende Env-Variablen)
2. **Lokale Anmeldung** sollte eigentlich funktionieren, aber es könnte CORS/Session-Probleme geben

## Lösung für normales Login (Email/Passwort)

Das sollte jetzt funktionieren. Falls nicht, prüfe:

1. **Render Dashboard** → Dein Service → **Logs**
   - Schau nach Fehlermeldungen beim Login-Versuch

2. **Env-Variablen prüfen** in Render:
   - `JWT_SECRET` - sollte vorhanden sein
   - `SESSION_SECRET` - sollte vorhanden sein
   - `NODE_ENV` = `production`

## Google OAuth einrichten (optional)

Falls du Google-Login willst:

### 1. Google Cloud Console
- Gehe zu https://console.cloud.google.com/
- Erstelle ein neues Projekt
- **APIs & Services** → **Credentials**
- **Create OAuth 2.0 Client ID**
- Autorisierte Redirect-URI: `https://deine-app.onrender.com/auth/google/callback`

### 2. In Render Dashboard
Füge diese Environment Variables hinzu:

```
GOOGLE_CLIENT_ID=deine-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=dein-secret
GOOGLE_CALLBACK_URL=https://deine-app-name.onrender.com/auth/google/callback
```

**Wichtig:** Ersetze `deine-app-name` mit deinem tatsächlichen Render-App-Namen!

### 3. Deploy neu
- Im Render Dashboard: **Manual Deploy** → **Deploy latest commit**

## App-URL finden
Deine App läuft auf:
```
https://ironcoach-tracker-XXXX.onrender.com
```
(Steht im Render Dashboard unter deinem Service)

## Fehlerbehebung

### "Failed to fetch" beim Login
- Prüfe, ob die App-URL korrekt ist
- Browser DevTools → Network Tab → schau auf den Response
- Render Logs prüfen

### "Email bereits registriert"
- Einfach mit dem existierenden Account einloggen

### Datenbank-Probleme
Die SQLite-Datenbank wird bei jedem Deploy auf Render zurückgesetzt (Ephemeral Filesystem). Für echte Nutzung brauchst du einen externen DB-Service wie:
- Render PostgreSQL (kostenpflichtig)
- Supabase (kostenlos)
- Railway PostgreSQL (kostenlos)

---

**Status:** Code ist gefixt. Jetzt musst du in Render die Env-Variablen setzen und neu deployen.
