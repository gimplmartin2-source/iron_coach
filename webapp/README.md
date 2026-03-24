# IronCoach - Trainings-Tracker 🔒

Sichere Web App für Training-Tracking mit User-Authentifizierung.

## Features

- ✅ **Google OAuth** - Einloggen mit Google
- ✅ **User/Passwort** - Klassische Registrierung
- ✅ **JWT Auth** - Sichere Token-basierte Sessions
- ✅ **Rate Limiting** - Schutz gegen Brute-Force
- ✅ **Helmet Security** - Security Headers
- ✅ **User-isolierte Daten** - Jeder User sieht nur seine Daten

## Schnellstart (Lokal)

```bash
# 1. Dependencies installieren
npm install

# 2. .env Datei erstellen
cp .env.example .env
# JWT_SECRET und SESSION_SECRET anpassen!

# 3. Server starten
npm start

# 4. Im Browser öffnen
http://localhost:3000
```

## Google OAuth Setup (optional)

1. Gehe zu [Google Cloud Console](https://console.cloud.google.com/)
2. Erstelle ein Projekt
3. Aktiviere "Google+ API"
4. Erstelle OAuth 2.0 Credentials
5. Füge `http://localhost:3000/auth/google/callback` als Redirect URI hinzu
6. Kopiere Client ID und Secret in `.env`

## Deployment-Optionen

### Option 1: VPS (Hetzner, DigitalOcean, etc.)

**Vorteile:** Volle Kontrolle, günstig (~5€/Monat)

```bash
# Auf dem Server:
git clone [dein-repo]
cd webapp
npm install

# .env erstellen mit Production-Werten
# Domain + SSL einrichten (Let's Encrypt)
# PM2 für Process Management
npm install -g pm2
pm2 start server.js --name ironcoach
```

**Nginx Config:**
```nginx
server {
    listen 443 ssl;
    server_name deine-domain.com;
    
    ssl_certificate /etc/letsencrypt/live/deine-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/deine-domain.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Option 2: Railway / Render / Fly.io

**Vorteile:** Einfach, automatisches SSL, gratis Tier verfügbar

1. Repo auf GitHub pushen
2. Bei Railway/Render/Fly.io verbinden
3. Environment Variables setzen
4. Deploy

### Option 3: Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## Sicherheit

- Passwörter werden mit bcrypt gehasht
- JWT Tokens laufen nach 24h ab
- Rate Limiting auf Auth-Routen
- Helmet.js für Security Headers
- SQL Injection Schutz durch Parameterized Queries

## Backup

Die SQLite Datenbank (`training.db`) regelmäßig sichern:

```bash
# Backup erstellen
cp training.db training.db.backup.$(date +%Y%m%d)

# Oder automatisch mit Cron
0 2 * * * cp /pfad/zu/training.db /pfad/zu/backups/training.db.$(date +\%Y\%m\%d)
```