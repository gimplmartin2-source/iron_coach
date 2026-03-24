# Render.com Deployment - Kostenlos & Einfach

> ✅ **Kostenlos:** Keine Kreditkarte nötig
> ⚠️ **Einschränkung:** Server schläft nach 15 Min. Inaktivität ein (30s Aufwachzeit)

---

## Schritt 1: GitHub Repo vorbereiten

Stelle sicher, dass dein Code auf GitHub ist:
- Repository: `ironcoach-webapp`
- Enthält: `server.js`, `package.json`, `public/` Ordner

---

## Schritt 2: Render Account erstellen

🔗 **Link:** https://dashboard.render.com/register

**Optionen:**
- Mit **GitHub** anmelden (empfohlen)
- Oder Email + Passwort

---

## Schritt 3: Neue Web Service erstellen

1. Im Dashboard: **"New +"** → **"Web Service"**

2. **Connect GitHub repository**
   - Klicke: **"Connect account"**
   - Wähle: **"ironcoach-webapp"**
   - Klicke: **"Connect"**

3. **Einstellungen:**

| Feld | Wert |
|------|------|
| Name | `ironcoach-tracker` (oder dein Wunschname) |
| Region | Frankfurt (EU) |
| Branch | `main` |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Plan | **Free** (kostenlos) |

4. **Environment Variables** hinzufügen:

Klicke: **"Advanced"** → **"Add Environment Variable"**

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `mYq3t6w9z$C&F)H@McQfTjWnZr4u7x!AmYq3t6w9z$C&F)H@M` |
| `SESSION_SECRET` | `G+KbPeShVmYq3t6w9z$C&F)H@McQfTjWnZr4u7x!A%D*G-KaP` |

5. **Create Web Service** klicken

---

## Schritt 4: Warten auf Deploy

**⏳ Dauer:** ~3-5 Minuten

**Status:**
- 🟡 **Build in progress** → Dependencies werden installiert
- 🟢 **Live** → App ist online!

**Deine URL:** `https://ironcoach-tracker-xxx.onrender.com`

---

## Schritt 5: Testen

1. Öffne die URL im Browser
2. Du solltest die Login-Seite sehen
3. Erstelle einen Account
4. Füge eine Übung hinzu

---

## Wichtige Hinweise

### ⚠️ Server schläft ein
- Nach **15 Minuten** ohne Aufruf: Server geht in "Sleep"
- Beim nächsten Aufruf: **30 Sekunden** Wartezeit
- Das ist normal bei Free Tier!

### 💾 Daten gehen verloren?
- **Ja!** SQLite wird bei jedem Neustart zurückgesetzt
- Das passiert bei:
  - Server geht schlafen
  - Neues Deploy
  - Render startet Server neu

### 🔧 Lösung für persistente Daten:
Später kannst du auf **Render PostgreSQL** umsteigen ($7/Monat) oder die Daten regelmäßig exportieren.

**Für den Anfang:** Das ist OK – deine Trainingsdaten bleiben solange der Server läuft.

---

## Updates deployen

Wenn du Code änderst:

```bash
# Lokal ändern, dann:
git add .
git commit -m "Neues Feature"
git push origin main
```

Render deployed **automatisch** neu!

---

## Custom Domain (optional)

1. In Render Dashboard: **Settings** → **Custom Domain**
2. Deine Domain eingeben: `trainieren.deinname.com`
3. DNS CNAME auf Render URL zeigen lassen
4. SSL wird automatisch erstellt

---

## Troubleshooting

### "Build failed"
→ Prüfe ob `package.json` auf GitHub ist

### "Cannot find module"
→ `node_modules` sollte nicht auf GitHub sein (ist in `.gitignore`)

### App startet nicht
→ Logs checken: In Render Dashboard → **Logs** Tab

### "Port already in use"
→ Render setzt automatisch `PORT` Environment Variable
→ Code verwendet `process.env.PORT` (ist bereits in server.js)

---

## Fertig! 🎉

Deine App läuft auf:
```
https://ironcoach-tracker-xxx.onrender.com
```

**Nächste Schritte:**
1. Teste die App
2. Erstelle deinen Account
3. Füge dein erstes Training hinzu
4. Teile die URL mit Freunden (oder behalte sie privat)

Bei Problemen: Render Dashboard → **Logs** ansehen