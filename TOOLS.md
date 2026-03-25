# IronCoach - Verfügbare Tools

## 💪 Fitness-Tracking

### `read`, `write`, `edit`
- **Nutzen:** Trainingsdaten lesen/schreiben (JSON/Excel)
- **Beispiele:**
  - `read path="fitness_data/workouts.json"`
  - `write path="fitness_data/stats.json" content="..."`

### `exec`
- **Nutzen:** Berechnungen, Daten-Verarbeitung
- **Beispiel:** `exec command="python calculate_1rm.py"`

## 🔍 Recherche

### `web_search` (Brave API)
- **Nutzen:** Trainingsmethoden, Ernährung, Supplemente
- **Beispiel:** `web_search query="optimal protein intake muscle building"`

### `web_fetch`
- **Nutzen:** Wissenschaftliche Studien, Fitness-Artikel
- **Beispiel:** `web_fetch url="https://pubmed.ncbi.nlm.nih.gov/..."`

### `browser`
- **Nutzen:** Tracking-Apps, Fitness-Plattformen
- **Beispiel:** `browser action=open url="https://www.myfitnesspal.com"`

## 📊 Analyse & Reports

### Formeln (im Code)
- **1RM-Schätzung:** Gewicht × (1 + Wdh/30)
- **Volumen:** Sätze × Wiederholungen × Gewicht
- **Progress:** Vergleich Woche zu Woche

### `pdf`
- **Nutzen:** Trainingspläne als PDF analysieren
- **Beispiel:** `pdf pdf="plan.pdf" prompt="Extrahiere Übungen"`

## 💬 Kommunikation

### `message` (empfohlen)
- **Nutzen:** Updates zu James über Trainingsfortschritt
- **Beispiel:**
```
message(
  action="send",
  channel="telegram",
  target="-1003510842431",
  message="James: Trainingsanalyse fertig. Neue PRs: Bench +5kg"
)
```

### `sessions_send`
- **Nutzen:** Direkt an James' Session

## 🗂️ Tracking-System

### Dateien in `fitness_data/`
- `workouts.json` - Alle Trainingseinträge
- `uebungen.json` - Übungs-Datenbank
- `ziele.json` - Fitness-Ziele
- `stats.json` - Berechnete Statistiken

## 🔗 Externe Tools

### Fitness-Apps (Browser)
- **Hevy** (Styrke-Training App)
- **Strong** (Alternative)
- **Google Sheets** (Backup/Export)

### Ressourcen
- **ExRx.net** - Übungs-Datenbank
- **PubMed** - Wissenschaftliche Studien

## ⚠️ Sicherheit

- **Gesundheitsdaten:** Privat behandeln, niemals teilen
- **API-Keys:** Für Fitness-Apps nicht in Chat erwähnen
- **Ärztlicher Rat:** Bei Verletzungen oder Unklarheiten → Arzt konsultieren
- **Progress:** Niemals übermäßig pushen (Verletzungsgefahr)
