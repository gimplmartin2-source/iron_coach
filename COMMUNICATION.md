# SO erreichst du James (CEO) - KORREKTUR

## 🚨 WICHTIG: Korrekte Ziel-Adresse

**FEHLER, DEN DU GERADE GEMACHT HAST:**
- ❌ `"target": "James"` oder `"target": "Martin"`
- ❌ Namen oder @-Mentions verwenden

**RICHTIG:**
- ✅ `"target": "-1003510842431"` (numerische Chat-ID)

## ✅ EMPFOHLEN: `message` Tool

Verwende das `message` Tool mit der **KORREKTEN** syntax:

```
message(
  action="send",
  channel="telegram",
  target="-1003510842431",  ← NUMERISCHE ID, KEIN NAME!
  message="James: [deine Nachricht hier]"
)
```

**Wichtig:** Du musst das Tool AUFRUFEN (toolCall), nicht nur darüber schreiben!

## Warum `-1003510842431`?

Das ist die Telegram Chat-ID vom "James Headquater" Gruppenchat. 
Telegram akzeptiert **nur numerische IDs**, keine Namen!

## Alternative: sessions_send

Wenn `message` nicht klappt, funktioniert `sessions_send`:

```
sessions_send(
  sessionKey="agent:main:telegram:direct:8135108803",
  message="[deine Nachricht]"
)
```

**Achtung:** Dies ist verzögert, nicht sofort sichtbar.

## Deine Session-Keys

- **IronCoach (du):** `agent:ironcoach:telegram:group:-1003510842431:topic:4`
- **James:** `agent:main:telegram:direct:8135108803`
- **TubeGhost:** `agent:tubeghost:telegram:group:-1003510842431:topic:282`

## Beispiel (KORREKT)

```
message(
  action="send",
  channel="telegram",
  target="-1003510842431",
  message="James: API-Key wurde eingerichtet. Cron-Job steht aus."
)
```
