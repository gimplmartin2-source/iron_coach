# IronCoach Web App - Deployment

## Quick Deploy (Render)

```bash
git add .
git commit -m "Update: Trainingsplan-Integration"
git push origin main
```

Dann auf Render: **Manual Deploy** → **Deploy latest commit**

---

## Lokale Entwicklung

```bash
cd webapp
npm install
npm start
# Öffne: http://localhost:3000
```

---

## What's New (2026-03-24)

- ✅ Trainingsplan-Anzeige mit Toggle
- ✅ 7-Tage Wochenübersicht
- ✅ Gleitwirbel-kompatibel (ADIM-Core)
- ✅ Judo-spezifische Vorbereitung

---

## Features

- 🔐 Login mit Email/Passwort
- 🔐 Login mit Google OAuth (optional)
- 🏋️ Übungen & Workouts tracken
- 📊 Statistiken & Charts
- 📋 Trainingsplan einblendbar

---

## Tech Stack

- Backend: Node.js + Express + SQLite
- Frontend: Vanilla JS + Chart.js
- Auth: JWT + Passport
