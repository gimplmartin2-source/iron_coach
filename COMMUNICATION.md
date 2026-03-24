# SO erreichst du James (CEO)

## 🚨 WICHTIG: Sofortige Sichtbarkeit

Um James SOFORT zu erreichen, verwende **NICHT** `sessions_send`.

## ✅ EMPFOHLEN: `message` Tool

Verwende das `message` Tool für sofortige Sichtbarkeit:

```
message(
  action="send",
  channel="telegram",
  target="-1003510842431",
  message="James: [deine Nachricht hier]"
)
```

## Alternative: Über den Chat antworten

Wenn du im Telegram-Chat bist (Topic 4 - Training), kannst du einfach schreiben:
```
James: [deine Nachricht]
```

## ❌ NICHT EMPFOHLEN: sessions_send

`sessions_send` funktioniert zwar, aber:
- Die Nachricht landet nur in James' Session-Historie
- Er sieht sie nicht sofort (kein Push)
- Nur für Hintergrund-Aufgaben geeignet

## Deine Session-Keys

- **IronCoach (du):** `agent:ironcoach:telegram:group:-1003510842431:topic:4`
- **James:** `agent:main:telegram:direct:8135108803`
- **TubeGhost:** `agent:tubeghost:telegram:group:-1003510842431:topic:282`

## Wann solltest du kontaktieren?

- ✅ Bei wichtigen Updates
- ✅ Bei Fragen oder Problemen
- ✅ Bei Aufgaben-Fertigstellung
- ✅ Bei Entscheidungen, die Martin betreffen

## Beispiel

```
message(
  action="send",
  channel="telegram",
  target="-1003510842431",
  message="James: Cron-Job wurde erfolgreich eingerichtet. Nächster Lauf: Sonntag 19:00 Uhr."
)
```
