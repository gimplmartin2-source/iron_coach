# IronCoach - Google OAuth auf Render einrichten

Diese Anleitung gilt für das Render-Deployment unter:

**`https://iron-coach-90eu.onrender.com`**

## Problem

Google blockiert den Login mit `redirect_uri_mismatch`, wenn die Render-Domain nicht als gültige OAuth-Redirect-URI hinterlegt ist.

## Lösung

### 1. Render-Umgebungsvariablen setzen

Im [Render Dashboard](https://dashboard.render.com/) für den IronCoach-Service folgende Variablen setzen:

| Variable | Wert |
|----------|------|
| `NODE_ENV` | `production` |
| `GOOGLE_CALLBACK_URL` | `https://iron-coach-90eu.onrender.com/auth/google/callback` |
| `GOOGLE_CLIENT_ID` | *(aus Google Cloud Console)* |
| `GOOGLE_CLIENT_SECRET` | *(aus Google Cloud Console)* |
| `JWT_SECRET` | *(mindestens 32 Zeichen, zufällig generieren)* |
| `SESSION_SECRET` | *(mindestens 32 Zeichen, zufällig generieren)* |

> **Wichtig:** `.env` wird wegen `.gitignore` nicht mit gepusht. Die Werte müssen im Render Dashboard eingetragen werden.

### 2. Google Cloud Console – Redirect-URI hinterlegen

1. Öffne https://console.cloud.google.com/apis/credentials
2. Wähle deinen OAuth 2.0 Client für IronCoach
3. Füge unter **„Autorisierte Weiterleitungs-URIs“** hinzu:
   - `https://iron-coach-90eu.onrender.com/auth/google/callback`
4. Für lokale Tests kannst du zusätzlich belassen:
   - `http://localhost:3000/auth/google/callback`
   - `http://127.0.0.1:3000/auth/google/callback`
5. **Speichern** – Google braucht oft 1–5 Minuten, bis die Änderung aktiv ist.

### 3. Render-Service neu starten

Im Render Dashboard:
- **Manual Deploy → Deploy latest commit** oder **Restart service** anklicken.

Danach sollte der Google-Login auf `https://iron-coach-90eu.onrender.com` funktionieren.

## Fallback: Code prüfen

Falls es weiterhin nicht geht, prüfe im Server-Log, welche Callback-URL tatsächlich verwendet wird. `server.js` liest bevorzugt `process.env.GOOGLE_CALLBACK_URL`:

```js
const callbackURL = process.env.GOOGLE_CALLBACK_URL || `${getBaseUrl()}/auth/google/callback`;
console.log('Google OAuth Callback URL:', callbackURL);
```

Im Render-Log muss also stehen:

```
Google OAuth Callback URL: https://iron-coach-90eu.onrender.com/auth/google/callback
```

Wenn dort `localhost` steht, ist die Umgebungsvariable im Render Dashboard noch nicht korrekt gesetzt.
