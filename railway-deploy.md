# 🚂 Railway Deployment Anleitung

## Voraussetzungen
- GitHub Account
- Railway Account (https://railway.app - gratis mit GitHub Login)

---

## Schritt 1: GitHub Repo erstellen

```bash
# Im webapp Ordner:
git init
git add .
git commit -m "IronCoach Trainings-Tracker"
git branch -M main
git remote add origin https://github.com/DEIN_USERNAME/ironcoach-tracker.git
git push -u origin main
```

---

## Schritt 2: Railway Projekt erstellen

1. Gehe zu https://railway.app
2. Klicke "New Project"
3. Wähle "Deploy from GitHub repo"
4. Verbinde dein GitHub und wähle das Repo

---

## Schritt 3: Environment Variables setzen

In Railway Dashboard → dein Projekt → Variables:

```
JWT_SECRET=irgendein-super-langer-zufälliger-text-mindestens-32-zeichen
SESSION_SECRET=noch-ein-super-langer-zufälliger-text-mindestens-32-zeichen
NODE_ENV=production
```

**Wichtig:** Ersetze die Secrets mit echten zufälligen Zeichenfolgen!

---

## Schritt 4: Deploy

Railway deployed automatisch! Warte ~2 Minuten.

Dann: Settings → Domains → "Generate Domain"

Deine App ist live unter: `https://deinprojekt.up.railway.app`

---

## Schritt 5: Google OAuth (optional)

Wenn du Google Login willst:

1. Google Cloud Console → Credentials
2. Füge hinzu als Authorized redirect URI:
   ```
   https://deinprojekt.up.railway.app/auth/google/callback
   ```
3. Kopiere Client ID + Secret in Railway Variables:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_CALLBACK_URL=https://deinprojekt.up-railway.app/auth/google/callback
   ```

---

## Kosten

- **Gratis:** $5 Credit/Monat
- Das reicht für deinen Tracker (~5€/Monat ≈ unbegrenzt bei geringem Traffic)
- Nur bezahlen wenn Traffic explodiert

---

## Backup

Railway hat **kein persistentes Filesystem** (SQLite verschwindet bei Neustart).

**Option A:** Railway Postgres Addon hinzufügen (~$1/Monat)
**Option B:** Regelmäßig Daten exportieren (manuell oder später automatisieren)

Für MVP: Option B reicht, später auf Postgres umstellen.

---

## Updates deployen

```bash
git add .
git commit -m "Neues Feature"
git push
```

Railway deployed automatisch die neue Version!