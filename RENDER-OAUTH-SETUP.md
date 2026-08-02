# IronCoach - Google OAuth auf Render einrichten (v1.2.7)

Diese Anleitung gilt für das Render-Deployment unter:

**`https://iron-coach-90eu.onrender.com`**

## Das Problem

Google blockiert den Login mit `redirect_uri_mismatch`, wenn die Redirect-URI in der Google Cloud Console nicht **exakt** mit der URL übereinstimmt, die IronCoach an Google sendet.

## Dauerhafte Lösung

### 1. Render-Umgebungsvariablen setzen

Im [Render Dashboard](https://dashboard.render.com/) für den IronCoach-Service folgende Variablen setzen:

| Variable | Wert | Hinweis |
|----------|------|---------|
| `NODE_ENV` | `production` | Muss auf Render production sein |
| `GOOGLE_CLIENT_ID` | *(aus Google Cloud Console)* | Gleiche ID wie lokal |
| `GOOGLE_CLIENT_SECRET` | *(aus Google Cloud Console)* | Gleiches Secret wie lokal |
| `JWT_SECRET` | *(mindestens 32 Zeichen, zufällig)* | Nicht das lokale Secret wiederverwenden |
| `SESSION_SECRET` | *(mindestens 32 Zeichen, zufällig)* | Nicht das lokale Secret wiederverwenden |
| `GOOGLE_DRIVE_ENABLED` | `true` | Damit Google-Login + automatisches Backup wieder zusammen funktionieren (wie vorher). Nur `false`, wenn du Backup nicht willst. |

> **Wichtig:** `.env` wird wegen `.gitignore` nicht mit gepusht. Die Werte müssen im Render Dashboard eingetragen werden.

> **Neu ab v1.2.7:** `GOOGLE_DRIVE_ENABLED` ist wieder standardmäßig `true`. Nach dem Deploy musst du dich **ab- und neu mit Google einloggen**, damit Google den `drive.file`-Scope neu genehmigt.

> **Neu ab v1.2.3:** `GOOGLE_CALLBACK_URL` ist nicht mehr zwingend nötig, weil Render automatisch `RENDER_EXTERNAL_URL` setzt. IronCoach nutzt diese Variable bevorzugt. Du kannst `GOOGLE_CALLBACK_URL` trotzdem als Fallback setzen.

### 2. Google Cloud Console – Redirect-URI hinterlegen

1. Öffne https://console.cloud.google.com/apis/credentials
2. Wähle deinen OAuth 2.0 Client für IronCoach
3. Füge unter **„Autorisierte Weiterleitungs-URIs“** **exakt** hinzu:
   - `https://iron-coach-90eu.onrender.com/auth/google/callback`
4. Für lokale Tests füge zusätzlich hinzu (nur im **Test-Modus** der App erlaubt):
   - `http://localhost:3000/auth/google/callback`
   - `http://127.0.0.1:3000/auth/google/callback`
5. **Speichern** – Google braucht oft 1–5 Minuten, bis die Änderung aktiv ist.

### 3. App-Veröffentlichungsstatus prüfen

- **Test-Modus:** Google-Login funktioniert nur für als **Testnutzer** hinzugefügte Accounts. Füge deine E-Mail als Testnutzer hinzu.
- **Produktions-Modus:** App muss verifiziert sein. Dann funktioniert der Login für alle Nutzer.

> **Hinweis:** Ab v1.2.7 ist `GOOGLE_DRIVE_ENABLED` wieder standardmäßig `true`. Der `drive.file`-Scope wird beim Google-Login angefordert, damit automatisches Backup/Restore funktioniert. Im Test-Modus muss Martin als Testnutzer hinzugefügt sein. Soll nur der reine Login ohne Drive funktionieren, setze `GOOGLE_DRIVE_ENABLED=false`.

### 4. Render-Service neu starten

Im Render Dashboard:
- **Manual Deploy → Deploy latest commit** anklicken.

Danach sollte der Google-Login auf `https://iron-coach-90eu.onrender.com` funktionieren.

## Diagnose

Falls es weiterhin nicht geht, öffne im Browser:

```
https://iron-coach-90eu.onrender.com/api/auth/status
```

Dort siehst du die aktuelle Callback-URL. Diese muss exakt in der Google Cloud Console hinterlegt sein.

### Wichtige URL-Regel

- Render: `https://iron-coach-90eu.onrender.com/auth/google/callback`
- Lokal: `http://localhost:3000/auth/google/callback`

Ein einziges fehlendes oder falsches Zeichen (z. B. `http` statt `https`, fehlender `/callback`, Slash am Ende) führt zu `redirect_uri_mismatch`.

## Sicherheit

- `.env` niemals committen.
- `JWT_SECRET` und `SESSION_SECRET` müssen mindestens 32 Zeichen lang sein.
- Für Render sollten eigene, zufällige Secrets verwendet werden, nicht die lokalen.
- Login-Daten oder Passwörter nie in Markdown-Dateien oder Git speichern.
