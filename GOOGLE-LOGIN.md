# IronCoach - Google Login Anleitung

## Login-Daten (Bereits in AGENTS.md)
- **Email:** `james100claw@gmail.com`
- **Passwort:** `P8hFM$@PwlPNz5`

---

## Google Login - Schritt für Schritt

### WICHTIGE HINWEISE VORHER:

⚠️ **Google hat strenge Sicherheitsmaßnahmen:**
- Manchmal zusätzliche Verifizierung erforderlich
- "Dieses Gerät wird nicht erkannt" möglich
- 2FA/Verifizierungscode möglich

**Wenn Martin sagt "Melde dich bei Google an":**

---

## Schritt 1: Google Login-Seite öffnen

```python
browser(
  action="open",
  url="https://accounts.google.com/signin",
  profile="openclaw",
  timeoutMs=20000
)
```

---

## Schritt 2: Email eingeben

```python
# Snapshot machen um Email-Feld zu finden
browser(action="snapshot", profile="openclaw")

# Klicke auf Email-Feld (meist ref "1" oder "2")
browser(action="click", ref="1", profile="openclaw")

# Warten
browser(action="wait", timeMs=1000, profile="openclaw")

# Email eingeben
browser(
  action="type",
  ref="1",
  text="james100claw@gmail.com",
  profile="openclaw"
)

# Enter oder "Weiter" klicken
browser(action="type", ref="1", text="", profile="openclaw", submit=true)
# ODER: browser(action="click", ref="3", profile="openclaw")  # Weiter-Button
```

---

## Schritt 3: Passwort eingeben

```python
# Warten auf Passwort-Seite
browser(action="wait", timeMs=3000, profile="openclaw")

# Snapshot für Passwort-Feld
browser(action="snapshot", profile="openclaw")

# Klicke Passwort-Feld
browser(action="click", ref="1", profile="openclaw")

# Passwort eingeben
browser(
  action="type",
  ref="1",
  text="P8hFM$@PwlPNz5",
  profile="openclaw"
)

# Enter drücken
browser(action="type", ref="1", text="", profile="openclaw", submit=true)
```

---

## Schritt 4: Mögliche Verifizierung

### Fall A: "Dieses Gerät wird nicht erkannt"

**WAS PASSIERT:**
Google fragt nach Verifizierung weil neues Gerät/Standort.

**DANN:**
1. **ABBRUCH** - Keine 2FA-App oder SMS verfügbar
2. Melde dich bei Martin/James: "Google verlangt Geräte-Verifizierung. Ich habe keinen Zugriff auf 2FA."
3. Warte auf Anweisung was zu tun ist

```python
message(
  action="send",
  channel="telegram",
  target="-1003510842431",
  message="James: Google-Login verlangt Verifizierung für neues Gerät. Ich habe keinen Zugriff auf 2FA/SMS. Was soll ich tun?"
)
```

### Fall B: Einfach eingeloggt

**WAS PASSIERT:**
Login erfolgreich, Google Dashboard oder Startseite wird angezeigt.

**DANN:**
- ✅ Erfolg dokumentieren
- ✅ Screenshot machen
- ✅ Weiter mit Aufgabe

```python
browser(action="wait", timeMs=3000, profile="openclaw")
browser(action="screenshot", profile="openclaw", fullPage=false)

write(
  path="memory/YYYY-MM-DD.md",
  content="Google-Login erfolgreich für [Aufgabe]"
)
```

---

## Schritt 5: Zu Google Service navigieren

Nach erfolgreichem Login, zu benötigtem Service:

```python
# Beispiel: Google Sheets
browser(action="open", url="https://sheets.google.com", profile="openclaw")

# ODER: Google Drive
browser(action="open", url="https://drive.google.com", profile="openclaw")

# ODER: Google Docs
browser(action="open", url="https://docs.google.com", profile="openclaw")
```

---

## ⚠️ WICHTIGE REGELN

### Sicherheit:
1. **Login-Daten niemals in Chat oder Screenshots zeigen!**
   - Wenn Screenshot: Stelle sicher dass Passwort-Feld nicht zu sehen
   - Oder: Screenshot NACH dem Login machen (Dashboard)

2. **NUR wenn Martin explizit sagt "Melde dich bei Google an"**
   - Nicht selbstständig ausprobieren
   - Nicht "nur mal testen"

3. **Bei Verifizierungs-Problemen IMMER fragen**
   - Keine Raterei
   - Keine Workarounds versuchen

### Nach dem Login:
- [ ] Screenshot (ohne private Daten)
- [ ] In Memory dokumentieren
- [ ] Sofort mit Aufgabe weitermachen
- [ ] Bei Erledigung: Ausloggen wenn möglich (security)

---

## 🎯 Komplettes Beispiel

```python
# Martin sagt: "Lade die Daten auf Google Drive hoch"

# 1. Google Drive öffnen
browser(action="open", url="https://drive.google.com", profile="openclaw")

# 2. Prüfen ob eingeloggt (Snapshot)
browser(action="wait", timeMs=3000, profile="openclaw")
browser(action="snapshot", profile="openclaw")

# 3. Wenn Login-Feld sichtbar:
#    - Email eingeben
#    - Weiter klicken
#    - Passwort eingeben
#    - Enter drücken
#    - Bei Verifizierung ABBRECHEN und fragen

# 4. Wenn eingeloggt:
#    - Upload durchführen
#    - Erfolg dokumentieren
#    - Screenshot machen

# 5. In Memory speichern
write(path="memory/YYYY-MM-DD.md", content="Google Drive Upload: [Datei] hochgeladen ✅")
```

---

## 🔐 Login-Daten nochmal (Zur Erinnerung)

| Service | Email | Passwort | Nutzung |
|---------|-------|----------|---------|
| Google | james100claw@gmail.com | P8hFM$@PwlPNz5 | NUR wenn Martin es sagt! |

---

*Erstellt: 2026-03-29*
*Verwendung: Bei Martin's Anweisung*
