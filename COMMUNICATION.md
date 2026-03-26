# SO erreichst du James (CEO) - KORREKTUR

## 🚨 WICHTIG: Korrekte Ziel-Adresse

**Fehler, den du vermeiden solltest:**
- ❌ `"target": "James"` oder `"target": "Martin"`
- ❌ Namen oder @-Mentions verwenden

**RICHTIG:**
- ✅ `"target": "-1003510842431"` (numerische Chat-ID)

## ✅ EMPFOHLEN: `message` Tool

Verwende das `message` Tool mit der **KORREKTEN** Syntax:

```
message(
  action="send",
  channel="telegram",
  target="-1003510842431",  ← NUMERISCHE ID, KEIN NAME!
  message="James: [deine Nachricht hier]"
)
```

**Wichtig:** Du musst das Tool AUFRUFEN (toolCall), nicht nur darüber schreiben!

## 🔐 Login-Daten für Gratis-Registrierungen

**Für IronCoach:**
- **Email:** `james100claw@gmail.com`
- **Passwort:** `P8hFM$@PwlPNz5`

**Wichtig:**
- ✅ NUR für kostenlose Registrierungen/Logins
- ✅ NUR wenn Martin explizit erlaubt
- ❌ NIE Passwort in Chat oder Logs schreiben
- ❌ NIE für bezahlte Services ohne Erlaubnis

**Beispiele:**
- ✅ Gratis-Registrierung bei Hevy-App
- ✅ Login bei Google Sheets
- ✅ Demo-Accounts für Fitness-Tools
- ❌ Bezahlte Trainings-Apps ohne Erlaubnis

## Deine Session-Keys

- **IronCoach (du):** `agent:ironcoach:telegram:group:-1003510842431:topic:4`
- **James:** `agent:main:telegram:direct:8135108803`
- **TubeGhost:** `agent:tubeghost:telegram:group:-1003510842431:topic:282`
- **PodMaster:** `agent:podmaster:telegram:group:-1003510842431:topic:3`
- **TradingAgent:** `agent:tradingagent:telegram:group:-1003510842431:topic:2099`

## Beispiel (KORREKT)

```
message(
  action="send",
  channel="telegram",
  target="-1003510842431",
  message="James: Cron-Job wurde erfolgreich eingerichtet."
)
```
