'use strict';
// Optionaler Fallback: lokales LLM über Ollama (http://127.0.0.1:11434).
// Wird nur benutzt, wenn VOICE_LLM_MODEL gesetzt ist UND der regelbasierte Parser
// nicht alles eindeutig zuordnen konnte (z.B. sehr freie Formulierungen).
//
// Sicherheitsnetz gegen Halluzinationen:
//  - Structured Output (JSON-Schema) mit enum = exakt die Übungsnamen aus der DB
//    -> das Modell KANN keine neue Übung ausgeben.
//  - "UNBEKANNT" ist erlaubt und wird als Fehler gemeldet.
//  - Jede LLM-Zuordnung wird gegen den regelbasierten Matcher geprüft; widerspricht
//    sie ihm, gewinnt der Matcher. Zuordnungen, die nur das LLM sieht, werden als
//    "bitte prüfen" markiert und nie automatisch gespeichert.

const { _internal } = require('./parser');

const UNKNOWN = 'UNBEKANNT';

function config() {
  return {
    url: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: process.env.VOICE_LLM_MODEL || '',
    timeoutMs: parseInt(process.env.VOICE_LLM_TIMEOUT_MS, 10) || 60000
  };
}

function enabled() {
  return !!config().model;
}

function schemaFor(names) {
  const num = { type: ['number', 'null'] };
  const int = { type: ['integer', 'null'] };
  return {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            spoken: { type: 'string' },
            exercise: { type: 'string', enum: [...names, UNKNOWN] },
            sets: int,
            reps: int,
            weight_kg: num,
            duration_seconds: int,
            rest_seconds: int,
            feeling: int
          },
          required: ['spoken', 'exercise', 'sets', 'reps', 'weight_kg', 'duration_seconds']
        }
      }
    },
    required: ['entries']
  };
}

const SYSTEM = `Du extrahierst Trainingseinträge aus einem deutschen, per Sprache diktierten Text.
Regeln:
- Ein Eintrag pro genannter Übung. "spoken" = die Übung wörtlich wie im Text genannt.
- "exercise" MUSS exakt einer der erlaubten Namen sein. Passt keiner sicher, nimm "${UNKNOWN}". Rate nie.
- sets = Anzahl Sätze (nicht genannt: 1). reps = Wiederholungen pro Satz. "3x10" / "3 mal 10" = 3 Sätze, 10 Wiederholungen.
- weight_kg = Gewicht in Kilo (Körpergewicht/nicht genannt: 0).
- duration_seconds nur bei Zeitübungen (Minuten in Sekunden umrechnen), sonst null.
- rest_seconds = Pause, feeling = Gefühl 1-10, sonst null.
- Zahlen nie erfinden: was nicht gesagt wurde, ist null.`;

async function parseWithLLM(text, exercises, opts = {}) {
  const cfg = config();
  if (!cfg.model) throw new Error('VOICE_LLM_MODEL nicht gesetzt');
  const byName = new Map(exercises.map(e => [e.name, e]));
  const names = [...byName.keys()];
  const index = _internal.buildIndex(exercises, opts.usage || {});

  const res = await fetch(`${cfg.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(cfg.timeoutMs),
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      format: schemaFor(names),
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Erlaubte Übungen:\n${names.join('\n')}\n\nText:\n${text}` }
      ]
    })
  });
  if (!res.ok) throw new Error(`Ollama Fehler ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const parsed = JSON.parse(data.message && data.message.content ? data.message.content : '{}');
  const raw = Array.isArray(parsed.entries) ? parsed.entries : [];

  const entries = raw.map(r => {
    const entry = {
      source: text,
      spoken: r.spoken || null,
      exercise: null,
      candidates: [],
      sets: Number.isInteger(r.sets) && r.sets > 0 ? r.sets : 1,
      reps: null,
      weight: typeof r.weight_kg === 'number' && r.weight_kg >= 0 ? r.weight_kg : 0,
      duration_seconds: null,
      rest_seconds: Number.isInteger(r.rest_seconds) ? r.rest_seconds : null,
      feeling: Number.isInteger(r.feeling) && r.feeling >= 1 && r.feeling <= 10 ? r.feeling : null,
      status: 'ok',
      error: null,
      warnings: ['Vom lokalen LLM ausgewertet'],
      review: false
    };

    // Übung gegen den regelbasierten Matcher prüfen
    const spokenTokens = _internal.tokenize(_internal.fold(r.spoken || ''));
    const { mentions } = _internal.findMentions(spokenTokens, index);
    const ruleOptions = mentions.length ? mentions[0].options : [];
    let ex = byName.get(r.exercise) || null;

    if (ruleOptions.length === 1 && (!ex || ex.id !== ruleOptions[0].id)) {
      ex = ruleOptions[0];
    } else if (ruleOptions.length > 1 && !(ex && ruleOptions.some(o => o.id === ex.id))) {
      entry.status = 'ambiguous';
      entry.candidates = ruleOptions.map(o => ({ id: o.id, name: o.name, exercise_type: o.exercise_type || 'strength' }));
      entry.error = `"${r.spoken}" ist mehrdeutig: ${entry.candidates.map(c => c.name).join(', ')}`;
      ex = null;
    } else if (ex && !ruleOptions.length) {
      entry.review = true;
      entry.warnings.push(`"${r.spoken}" wurde nur vom LLM als "${ex.name}" erkannt – bitte prüfen`);
    }

    if (!ex && entry.status === 'ok') {
      entry.status = 'unknown';
      entry.error = `Übung "${r.spoken || '?'}" ist nicht in deiner Übungsliste`;
      entry.candidates = _internal.suggest(r.spoken || '', index).map(o => ({ id: o.id, name: o.name, exercise_type: o.exercise_type || 'strength' }));
      return entry;
    }
    if (!ex) return entry;

    entry.exercise = { id: ex.id, name: ex.name, exercise_type: ex.exercise_type || 'strength' };
    if (entry.exercise.exercise_type === 'time') {
      entry.reps = 0;
      entry.weight = 0;
      entry.duration_seconds = Number.isInteger(r.duration_seconds) && r.duration_seconds > 0 ? r.duration_seconds : null;
      if (!entry.duration_seconds) { entry.status = 'incomplete'; entry.error = `Dauer für "${ex.name}" fehlt`; }
    } else {
      entry.reps = Number.isInteger(r.reps) && r.reps > 0 && r.reps <= 1000 ? r.reps : null;
      if (!entry.reps) { entry.status = 'incomplete'; entry.error = `Wiederholungen für "${ex.name}" fehlen`; }
    }
    if (entry.sets > 50 || entry.weight > 500) { entry.status = 'incomplete'; entry.error = 'Unplausible Werte'; }
    return entry;
  });

  return {
    text,
    entries,
    ok: entries.length > 0 && entries.every(e => e.status === 'ok'),
    error: entries.length ? null : 'Keine Übung im Text erkannt'
  };
}

async function status() {
  const cfg = config();
  if (!cfg.model) return { enabled: false };
  try {
    const res = await fetch(`${cfg.url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    const installed = (data.models || []).some(m => m.name === cfg.model || m.name === `${cfg.model}:latest` || m.model === cfg.model);
    return { enabled: true, reachable: true, model: cfg.model, installed };
  } catch (err) {
    return { enabled: true, reachable: false, model: cfg.model, error: err.message };
  }
}

module.exports = { parseWithLLM, enabled, status };
