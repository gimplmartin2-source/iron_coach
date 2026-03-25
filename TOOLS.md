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

### `browser` ⭐ WICHTIG
- **Nutzen:** Fitness-Apps, Tracking-Plattformen
- **Profil verwenden:** `profile="openclaw"` (NICHT "user"!)

#### Browser-Befehle:

**1. URL öffnen:**
```
browser(
  action="open",
  url="https://www.myfitnesspal.com",
  profile="openclaw",
  timeoutMs=20000
)
```

**2. Screenshot machen:**
```
browser(
  action="screenshot",
  profile="openclaw",
  fullPage=true
)
```

**3. Seiten-Struktur sehen (Snapshot):**
```
browser(
  action="snapshot",
  profile="openclaw"
)
```
- Zeigt alle klickbaren Elemente mit Nummern (ref)

**4. Auf Element klicken:**
```
browser(
  action="click",
  ref="5",  ← Nummer aus dem Snapshot
  profile="openclaw"
)
```

**5. Text eingeben:**
```
browser(
  action="type",
  ref="3",
  text="Benutzername",
  profile="openclaw"
)
```

**6. Warten:**
```
browser(action="wait", timeMs=3000, profile="openclaw")
```

#### Beispiel-Workflow (Fitness-App Recherche):

```
# Schritt 1: App öffnen
browser(action="open", url="https://www.hevy.com", profile="openclaw")

# Schritt 2: Snapshot machen um Elemente zu sehen
browser(action="snapshot", profile="openclaw")

# Schritt 3: Menü klicken (ref Nummer aus Snapshot)
browser(action="click", ref="3", profile="openclaw")

# Schritt 4: Warten auf Ladung
browser(action="wait", timeMs=2000, profile="openclaw")

# Schritt 5: Screenshot für Analyse
browser(action="screenshot", profile="openclaw", fullPage=true)
```

#### WICHTIGE REGELN:

- ✅ IMMER `profile="openclaw"` verwenden
- ❌ NIE `profile="user"` oder `profile="chrome-relay"` verwenden
- ⏱️ Timeout auf 15000-30000ms setzen
- 📸 Screenshots bei wichtigen Ergebnissen machen
- 🔗 Quellen immer notieren

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
- **Nutzen:** Direkt an James

## 🗂️ Tracking-System

### Dateien in `fitness_data/`
- `workouts.json` - Alle Trainingseinträge
- `uebungen.json` - Übungs-Datenbank
- `ziele.json` - Fitness-Ziele
- `stats.json` - Berechnete Statistiken

## 🔗 Externe Tools (im Browser nutzen)

### Fitness-Apps
- **Hevy** (Styrke-Training App)
  - `browser(action="open", url="https://www.hevy.com", profile="openclaw")`
- **Strong** (Alternative)
  - `browser(action="open", url="https://www.strong.app", profile="openclaw")`

### Ressourcen
- **ExRx.net** - Übungs-Datenbank
  - `browser(action="open", url="https://exrx.net", profile="openclaw")`
- **PubMed** - Wissenschaftliche Studien
  - `browser(action="open", url="https://pubmed.ncbi.nlm.nih.gov", profile="openclaw")`

## ⚠️ Sicherheit

- **Gesundheitsdaten:** Privat behandeln, niemals teilen
- **Browser-Nutzung:** Bei Login-Screens immer Bestätigung einholen
- **API-Keys:** Für Fitness-Apps nicht in Chat erwähnen
- **Ärztlicher Rat:** Bei Verletzungen oder Unklarheiten → Arzt konsultieren

## 🎯 Schnell-Referenz: Browser-Schritte

| Aufgabe | Befehl |
|---------|--------|
| Seite öffnen | `browser(action="open", url="...", profile="openclaw")` |
| Struktur sehen | `browser(action="snapshot", profile="openclaw")` |
| Klicken | `browser(action="click", ref="X", profile="openclaw")` |
| Tippen | `browser(action="type", ref="X", text="...", profile="openclaw")` |
| Warten | `browser(action="wait", timeMs=3000, profile="openclaw")` |
| Screenshot | `browser(action="screenshot", profile="openclaw", fullPage=true)` |

**Merke:** `profile="openclaw"` ist bei JEDEM Browser-Befehl Pflicht!
