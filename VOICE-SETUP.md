# Sprach-Eintrag (🎤) – Setup auf Martins PC

Ganz oben im Workout-Tab („Neues Workout“) gibt es eine Leiste **Aufnehmen**.
Ablauf:

1. Handy/Browser nimmt auf → rechnet lokal auf 16 kHz Mono-WAV um (klein, kein ffmpeg nötig).
2. Upload an IronCoach auf dem PC (`POST /api/voice/transcribe`, über Tailscale-HTTPS).
3. IronCoach schickt das Audio an den **lokalen whisper.cpp-Server** (`127.0.0.1:8178`).
   Als Vokabel-Hinweis gehen die eigenen Übungsnamen mit → bessere Erkennung von „Face Pulls“, „Uchi-Komi“ usw.
4. Der **regelbasierte Parser** (`voice/parser.js`) ordnet den Text **nur vorhandenen Übungen** zu
   und liest Sätze, Wiederholungen, Kilo, Dauer, Pause, Gefühl aus.
5. Vorschau: ✅ eindeutig / ❌ unbekannt, mehrdeutig oder unvollständig (Übung per Dropdown wählen,
   Werte korrigieren oder Eintrag entfernen). „Eintragen“ speichert über das normale `POST /api/workouts`.
   Unbekannte Übungen werden **nie** angelegt oder geraten – sie blockieren das Speichern, bis sie aufgelöst sind.
   Optional: Häkchen „Direkt eintragen, wenn alles eindeutig“ → speichert ohne Klick.

Beispiele, die funktionieren:
- „Ich habe Liegestütz gemacht mit 25 Wiederholungen, einen Satz“
- „Kniebeugen 3x10 mit 80 Kilo, dann Plank 2 mal 1 Minute“
- „Bankdrücken mit der Langhantel, vier Sätze zu je acht mit zweiundsechzig komma fünf Kilo“
- „Wadenheben und Beinpresse je 3 Sätze à 15“
- „Kreuzheben 5 Sätze à 5 mit 120 Kilo, Pause 3 Minuten, Gefühl 8“

## Warum kein Wispr Flow?
Wispr Flow ist eine Diktier-App (Tastatur-Ersatz, Cloud-Verarbeitung) und bietet keine lokale
Schnittstelle, an die ein Server Audiodateien schicken kann. Deshalb läuft die Transkription über
**whisper.cpp** direkt auf dem PC – gleiche Whisper-Modellfamilie, komplett offline, kostenlos.

## Installation (einmalig, ~10 Minuten)

1. **whisper.cpp herunterladen**: https://github.com/ggml-org/whisper.cpp/releases (neueste Version)
   - NVIDIA-Grafikkarte vorhanden → `whisper-cublas-…-bin-x64.zip`
   - sonst → `whisper-bin-x64.zip` (CPU)
   - Entpacken nach `C:\tools\whisper\` (enthält `whisper-server.exe`).
2. **Modell herunterladen** nach `C:\tools\whisper\models\` von
   https://huggingface.co/ggerganov/whisper.cpp/tree/main

   | Hardware | Modell | Größe | Hinweis |
   |---|---|---|---|
   | NVIDIA-GPU (≥ 4 GB VRAM) | `ggml-large-v3-turbo-q5_0.bin` | ~550 MB | beste Genauigkeit, < 1 s |
   | Gute CPU (≥ 8 Kerne) | `ggml-large-v3-turbo-q5_0.bin` oder `ggml-small.bin` | 550 / 470 MB | ca. 2–6 s pro 10 s Audio |
   | Schwache CPU / Laptop | `ggml-base.bin` | 140 MB | schnell, mehr Erkennungsfehler |

   Empfehlung: mit `large-v3-turbo-q5_0` starten; wenn eine Aufnahme > 5 s Wartezeit braucht → `small`.
3. **`.env` ergänzen** (siehe `.env.example`):
   ```
   WHISPER_SERVER_EXE=C:\tools\whisper\whisper-server.exe
   WHISPER_MODEL_PATH=C:\tools\whisper\models\ggml-large-v3-turbo-q5_0.bin
   ```
4. IronCoach wie gewohnt mit `.\start_ironcoach_tailscale.ps1` starten – der Whisper-Server wird
   automatisch mitgestartet (nur an `127.0.0.1`, nicht im Netz erreichbar). Einzeln: `.\start_whisper.ps1`.
   `.\stop_ironcoach_tailscale.ps1` stoppt beide.
5. Prüfen: `http://127.0.0.1:3001/api/voice/status` → `"whisper": {"reachable": true}`.

**Mikrofon braucht HTTPS**: Am Handy die Tailscale-Adresse `https://martins-pc-1.tail9b3a7c.ts.net:8443`
verwenden (nicht `http://<IP>`), am PC geht auch `http://127.0.0.1:3001`.

## Optional: lokales LLM als Fallback (Ollama)

Nicht nötig für normale Ansagen. Hilft nur bei sehr freien Formulierungen.
Der regelbasierte Parser läuft immer zuerst; das LLM wird nur gefragt, wenn danach noch Fehler offen sind.

1. https://ollama.com installieren, dann `ollama pull qwen2.5:3b` (~2 GB, läuft auf CPU in wenigen Sekunden).
2. `.env`: `VOICE_LLM_MODEL=qwen2.5:3b`
3. Schutz vor Halluzinationen: Das LLM bekommt ein JSON-Schema, dessen Übungsfeld nur die eigenen
   Übungsnamen erlaubt; jede Zuordnung wird gegen den Regel-Matcher geprüft, Abweichungen werden
   als „bitte prüfen“ markiert und nie automatisch gespeichert.

## Andere Whisper-Server
Jeder OpenAI-kompatible Server funktioniert ebenfalls (z.B. speaches/faster-whisper-server):
`WHISPER_URL=http://127.0.0.1:8000/v1/audio/transcriptions` und `WHISPER_MODEL=<modellname>`.

## Dateien
- `voice/parser.js` – Übungs-Matching (Fuzzy, Plural, Duplikate) + Zahlen/Einheiten (inkl. Zahlwörter)
- `voice/whisper.js` – Anbindung whisper.cpp / OpenAI-kompatibel
- `voice/llm.js` – optionaler Ollama-Fallback
- `server.js` – Endpunkte `GET /api/voice/status`, `POST /api/voice/parse`, `POST /api/voice/transcribe`
- `public/voice-log.js`, `public/style.css`, `public/index.html` – Leiste, Aufnahme, Vorschau
- `test/voice-parser.test.js` – `npm test`
