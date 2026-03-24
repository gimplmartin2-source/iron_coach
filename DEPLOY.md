# IronCoach Web App - Railway Deployment Guide

> **Ziel:** Deploye deine IronCoach Trainings-Tracker App auf Railway in wenigen Minuten.

---

## 🚀 Schnellstart (One-Click Links)

| Schritt | Link |
|---------|------|
| **1. Railway Account** | https://railway.app |
| **2. GitHub Repo erstellen** | https://github.com/new |
| **3. Railway Dashboard** | https://railway.app/dashboard |

---

## 📋 Voraussetzungen

- [ ] Git installiert (`git --version` sollte funktionieren)
- [ ] GitHub Account
- [ ] Railway Account (kostenlos via GitHub Login)

---

## Schritt 1: Code auf GitHub pushen

### 1.1 GitHub Repository erstellen

🔗 **Link:** https://github.com/new

**Einstellungen:**
- Repository name: `ironcoach-webapp`
- Description: `IronCoach Trainings-Tracker Web App`
- **Public** auswählen (oder Private wenn du willst)
- ✅ "Add a README file" **NICHT** ankreuzen
- ✅ "Add .gitignore" **NICHT** ankreuzen (ist bereits vorhanden)

**Screenshot:**
```
┌─────────────────────────────────────────────┐
│  Create a new repository                    │
│                                             │
│  Repository name: [ironcoach-webapp  ]     │
│  ○ Public  ○ Private                        │
│                                             │
│  ☑ Add a README file   (NICHT anhaken!)     │
│  ☑ Add .gitignore      (NICHT anhaken!)     │
│                                             │
│           [Create repository] ← Klicken     │
└─────────────────────────────────────────────┘
```

### 1.2 Lokalen Code pushen

Öffne **PowerShell** im `webapp` Ordner:

```powershell
# In den webapp Ordner wechseln (anpassen wenn nötig)
cd C:\Users\maxgi\.openclaw\workspace\agents\ironcoach\webapp

# Git initialisieren
git init

# Alle Dateien hinzufügen
git add .

# Commit erstellen
git commit -m "Initial commit - IronCoach Web App"

# Remote hinzufügen (DEIN_USERNAME durch deinen GitHub Username ersetzen!)
git remote add origin https://github.com/DEIN_USERNAME/ironcoach-webapp.git

# Auf GitHub pushen
git branch -M main
git push -u origin main
```

**✅ Erfolgscheck:**
- Gehe zu `https://github.com/DEIN_USERNAME/ironcoach-webapp`
- Du solltest alle Dateien sehen (server.js, railway.toml, public/, etc.)

---

## Schritt 2: Railway Project erstellen

### 2.1 Railway Login

🔗 **Link:** https://railway.app

**Klicke:** "Login" → "Continue with GitHub"

### 2.2 Neues Projekt erstellen

**Screenshot - Railway Dashboard:**
```
┌─────────────────────────────────────────────┐
│  Railway Dashboard                          │
│                                             │
│     [+ New Project]  ← Klicken              │
│                                             │
│  Wähle: "Deploy from GitHub repo"           │
└─────────────────────────────────────────────┘
```

**Klicke:**
1. `+ New Project`
2. `Deploy from GitHub repo`
3. Wähle dein `ironcoach-webapp` Repository
4. Checkbox "Add variables" später auswählen

### 2.3 Environment Variables setzen

**Wichtig:** Die App braucht diese Variablen:

| Variable | Wert | Beschreibung |
|----------|------|--------------|
| `JWT_SECRET` | *(generieren, siehe unten)* | Für Token-Signatur |
| `SESSION_SECRET` | *(generieren, siehe unten)* | Für Session-Cookies |
| `NODE_ENV` | `production` | Produktionsmodus |
| `PORT` | `3000` | Port (wird von Railway überschrieben) |

#### 🔐 Secrets generieren (in PowerShell):

```powershell
# JWT Secret (32+ Zeichen)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 } | ForEach-Object { [byte]$_ }))

# Session Secret (32+ Zeichen)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 } | ForEach-Object { [byte]$_ }))
```

Oder einfach diese kopieren (sicher genug):

```
JWT_SECRET:     mYq3t6w9z$C&F)H@McQfTjWnZr4u7x!AmYq3t6w9z$C&F)H@M
SESSION_SECRET: G+KbPeShVmYq3t6w9z$C&F)H@McQfTjWnZr4u7x!A%D*G-KaP
```

**Screenshot - Railway Variables:**
```
┌─────────────────────────────────────────────┐
│  Variables Tab                              │
│                                             │
│  [+ New Variable]                           │
│                                             │
│  Name:  [JWT_SECRET    ] [Value...] [+]     │
│  Name:  [SESSION_SECRET] [Value...] [+]     │
│  Name:  [NODE_ENV      ] [production] [+]   │
│                                             │
│  [Deploy] ← Automatisch nach Eingabe        │
└─────────────────────────────────────────────┘
```

**Klicke:** `Variables` Tab → `+ New Variable` → Name und Value eintragen

---

## Schritt 3: Deploy

### 3.1 Automatisches Deploy

Railway deployed automatisch bei:
- ✅ Push auf GitHub
- ✅ Änderung der Environment Variables

**Screenshot - Deploy Status:**
```
┌─────────────────────────────────────────────┐
│  Deployments Tab                            │
│                                             │
│  ✓ ironcoach-webapp                         │
│    Status: [Success]   ← Grün bedeutet OK    │
│    URL: https://...railway.app               │
│                                             │
│    [View Logs] [Settings]                   │
└─────────────────────────────────────────────┘
```

### 3.2 Domain/URL finden

**Klicke:** `Settings` Tab → `Domains`

**Oder:** Suche die URL im Dashboard - sieht so aus:
```
https://ironcoach-webapp-production-xxx.up.railway.app
```

---

## ✅ Checkliste

- [ ] Code auf GitHub gepusht
- [ ] Railway mit GitHub verbunden
- [ ] Projekt erstellt
- [ ] Environment Variables gesetzt
- [ ] Deploy Status = Success (grün)
- [ ] App im Browser getestet

---

## 🔧 Troubleshooting

### Problem: "Build failed"

**Lösung:**
```powershell
# Prüfe ob railway.toml existiert
cat railway.toml

# Sollte enthalten:
[build]
cmd = "npm install"

[deploy]
startCommand = "npm start"
```

### Problem: "Cannot find module"

**Lösung:**
- `package.json` muss auf GitHub sein
- `node_modules` sollte **NICHT** auf GitHub sein (ist in .gitignore)

### Problem: "JWT/Session Fehler"

**Lösung:**
- Secrets müssen **mindestens 32 Zeichen** haben
- Keine Leerzeichen am Anfang/Ende
- In Railway unter Variables überprüfen

### Problem: "Database error"

**Lösung:**
- SQLite ist file-basiert und sollte funktionieren
- Railway Dateisystem ist ephemeral (wird bei Neustart zurückgesetzt)

**⚠️ Wichtig:** Daten gehen bei jedem Deploy verloren!

**Für persistente Daten:** Füge Railway Postgres hinzu:
1. `+ New` → `Database` → `Add PostgreSQL`
2. Verbinde in deinem Code mit der DB_URL

### Problem: "Port already in use"

**Lösung:**
- Railway setzt automatisch `PORT` Environment Variable
- Code muss `process.env.PORT` verwenden (ist bereits in server.js)

### Problem: Logs anzeigen

**Klicke:** `Deployments` → `View Logs`

---

## 📚 Nützliche Links

| Beschreibung | URL |
|--------------|-----|
| Railway Docs | https://docs.railway.app |
| Railway Pricing | https://railway.app/pricing |
| GitHub Repo Settings | https://github.com/DEIN_USERNAME/ironcoach-webapp/settings |

---

## 🎉 Fertig!

Deine App läuft auf: `https://XXXX.up.railway.app`

**Nächste Schritte:**
1. Teste die App im Browser
2. Erstelle einen Account
3. Füge dein erstes Training hinzu

Bei Problemen: Railway Logs checken (`Deployments` → `View Logs`)
