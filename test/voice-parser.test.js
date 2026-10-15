'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWorkoutText, buildWhisperPrompt, _internal } = require('../voice/parser');

// Realistische Übungsliste (Auszug der Standardübungen inkl. echter Duplikate aus der DB)
const NAMES = [
  ['Liegestütz', 'strength'], ['Breite Liegestütz', 'strength'], ['Enge Liegestütz', 'strength'],
  ['Diamant Liegestütz', 'strength'], ['Negative Liegestütz', 'strength'],
  ['Bankdrücken Kurzhantel', 'strength'], ['Bankdrücken Kurzhanteln', 'strength'], ['Bankdrücken Langhantel', 'strength'],
  ['Schrägbank drücken', 'strength'], ['Schrägbankdrücken', 'strength'],
  ['Klimmzüge', 'strength'], ['Klimmzüge Obergriff', 'strength'], ['Klimmzüge Untergriff', 'strength'], ['Klimmzug hold', 'time'],
  ['Kniebeugen', 'strength'], ['Kreuzheben', 'strength'], ['Klassisches Kreuzheben', 'strength'],
  ['Plank', 'time'], ['Side Plank Extreme', 'time'], ['Side Plank Rotation', 'time'],
  ['Kurzhantel Seitheben', 'strength'], ['Seitheben Kurzhanteln', 'strength'],
  ['Hammer Curl', 'strength'], ['Hammercurl Kurzhantel', 'strength'], ['Bizepscurls Kurzhantel', 'strength'],
  ['Dips', 'strength'], ['Face Pulls Kabelzug', 'strength'], ['T Bar Rudern', 'strength'],
  ['Kata', 'time'], ['Kata (Formen)', 'time'], ['Randori (Freikampf)', 'time'], ['Uchi-Komi', 'strength'],
  ['Russian Twist', 'strength'], ['Butterfly', 'strength'], ['Wadenheben', 'strength'], ['Beinpresse', 'strength']
];
const EX = NAMES.map(([name, exercise_type], i) => ({ id: i + 1, name, exercise_type }));
const id = name => EX.find(e => e.name === name).id;

function one(text, opts) {
  const r = parseWorkoutText(text, EX, opts);
  assert.equal(r.entries.length, 1, `genau 1 Eintrag erwartet für "${text}": ${JSON.stringify(r.entries, null, 1)}`);
  return r.entries[0];
}

test('Zahlwörter', () => {
  const p = _internal.parseNumberWord;
  assert.equal(p('funfundzwanzig'), 25);
  assert.equal(p('zwolf'), 12);
  assert.equal(p('hundertzwanzig'), 120);
  assert.equal(p('zweihundertfunfzig'), 250);
  assert.equal(p('zweieinhalb'), 2.5);
  assert.equal(p('eineinhalb'), 1.5);
  assert.equal(p('dreissig'), 30);
  assert.equal(p('liegestutz'), null);
});

test('Beispiel aus der Anforderung: Liegestütz, 25 Wiederholungen, ein Satz', () => {
  const e = one('Ich habe Liegestütz gemacht mit 25 Wiederholungen, einen Satz.');
  assert.equal(e.status, 'ok');
  assert.equal(e.exercise.id, id('Liegestütz'));
  assert.equal(e.sets, 1);
  assert.equal(e.reps, 25);
  assert.equal(e.weight, 0);
});

test('Zahlwörter ausgeschrieben + Plural', () => {
  const e = one('Liegestütze, fünfundzwanzig Wiederholungen, ein Satz');
  assert.equal(e.exercise.id, id('Liegestütz'));
  assert.equal(e.reps, 25);
  assert.equal(e.sets, 1);
});

test('Spezifischere Variante gewinnt (Enge Liegestütz)', () => {
  const e = one('3 Sätze enge Liegestütze à 15');
  assert.equal(e.exercise.id, id('Enge Liegestütz'));
  assert.equal(e.sets, 3);
  assert.equal(e.reps, 15);
});

test('3x10 mit Gewicht', () => {
  const e = one('Kniebeugen 3x10 mit 80 kg');
  assert.equal(e.exercise.id, id('Kniebeugen'));
  assert.deepEqual([e.sets, e.reps, e.weight], [3, 10, 80]);
});

test('"drei mal zehn" und Komma-Gewicht', () => {
  const e = one('Bankdrücken Langhantel drei mal zehn mit 62,5 Kilo');
  assert.equal(e.exercise.id, id('Bankdrücken Langhantel'));
  assert.deepEqual([e.sets, e.reps, e.weight], [3, 10, 62.5]);
});

test('"zweiundsechzig komma fünf Kilo"', () => {
  const e = one('Bankdrücken mit der Langhantel, vier Sätze zu je acht Wiederholungen mit zweiundsechzig komma fünf Kilo');
  assert.equal(e.exercise.id, id('Bankdrücken Langhantel'));
  assert.deepEqual([e.sets, e.reps, e.weight], [4, 8, 62.5]);
});

test('Mehrdeutig: "Bankdrücken" ohne Variante -> Fehler mit Auswahl', () => {
  const e = one('Bankdrücken 3 Sätze 10 Wiederholungen');
  assert.equal(e.status, 'ambiguous');
  const names = e.candidates.map(c => c.name);
  assert.ok(names.includes('Bankdrücken Langhantel'));
  assert.ok(names.some(n => n.startsWith('Bankdrücken Kurzhantel')));
  assert.equal(e.reps, 10);
});

test('Duplikate in der DB werden über Nutzung aufgelöst', () => {
  const usage = { [id('Bankdrücken Kurzhanteln')]: 12, [id('Bankdrücken Kurzhantel')]: 2 };
  const e = one('Bankdrücken mit Kurzhanteln 3 mal 12 mit 24 Kilo', { usage });
  assert.equal(e.status, 'ok');
  assert.equal(e.exercise.id, id('Bankdrücken Kurzhanteln'));
});

test('Zusammengeschrieben vs. getrennt (Schrägbankdrücken)', () => {
  const e = one('Schrägbankdrücken 3 Sätze 10 Wiederholungen 50 Kilo');
  assert.equal(e.status, 'ok');
  assert.ok(['Schrägbankdrücken', 'Schrägbank drücken'].includes(e.exercise.name));
});

test('Reihenfolge egal (Seitheben mit Kurzhanteln)', () => {
  const e = one('Seitheben mit Kurzhanteln 3 Sätze à 12 mit 8 kg');
  assert.equal(e.status, 'ok');
  assert.ok(['Kurzhantel Seitheben', 'Seitheben Kurzhanteln'].includes(e.exercise.name));
  assert.deepEqual([e.sets, e.reps, e.weight], [3, 12, 8]);
});

test('Klimmzüge Obergriff vs Klimmzüge', () => {
  assert.equal(one('Klimmzüge im Obergriff 3 Sätze 8 Wiederholungen').exercise.id, id('Klimmzüge Obergriff'));
  assert.equal(one('Klimmzüge 3 Sätze 8 Wiederholungen').exercise.id, id('Klimmzüge'));
});

test('Zeit-Übung: Plank 2 Sätze à 1 Minute 30', () => {
  const e = one('Plank 2 Sätze à 1 Minute 30');
  assert.equal(e.exercise.id, id('Plank'));
  assert.equal(e.sets, 2);
  assert.equal(e.duration_seconds, 90);
  assert.equal(e.reps, 0);
});

test('Zeit-Übung: nackte Zahl = Sekunden, 1:30-Format', () => {
  assert.equal(one('Plank 60 Sekunden').duration_seconds, 60);
  assert.equal(one('Plank 1:30').duration_seconds, 90);
  assert.equal(one('Kata eine halbe Stunde').duration_seconds, 1800);
  assert.equal(one('Randori eineinhalb Stunden').duration_seconds, 5400);
});

test('Pause und Gefühl', () => {
  const e = one('Dips 3 Sätze 12 Wiederholungen, Pause 90 Sekunden, Gefühl 7');
  assert.deepEqual([e.sets, e.reps, e.rest_seconds, e.feeling], [3, 12, 90, 7]);
});

test('Mehrere Übungen in einem Satz (Übung zuerst)', () => {
  const r = parseWorkoutText('Liegestütz 2 Sätze à 20 und dann Kniebeugen 3x15 mit 40 Kilo. Danach Plank 60 Sekunden', EX);
  assert.equal(r.entries.length, 3);
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries.map(e => e.exercise.name), ['Liegestütz', 'Kniebeugen', 'Plank']);
  assert.deepEqual([r.entries[0].sets, r.entries[0].reps], [2, 20]);
  assert.deepEqual([r.entries[1].sets, r.entries[1].reps, r.entries[1].weight], [3, 15, 40]);
  assert.equal(r.entries[2].duration_seconds, 60);
});

test('Mehrere Übungen mit "und", Zahl zuerst', () => {
  const r = parseWorkoutText('Ich habe 3 Sätze Butterfly und 2 Sätze Dips mit je 12 Wiederholungen gemacht', EX);
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[0].exercise.name, 'Butterfly');
  assert.equal(r.entries[0].sets, 3);
  assert.equal(r.entries[1].exercise.name, 'Dips');
  assert.deepEqual([r.entries[1].sets, r.entries[1].reps], [2, 12]);
});

test('"je" gilt für beide Übungen', () => {
  const r = parseWorkoutText('Wadenheben und Beinpresse je 3 Sätze à 15', EX);
  assert.equal(r.entries.length, 2);
  for (const e of r.entries) assert.deepEqual([e.status, e.sets, e.reps], ['ok', 3, 15]);
});

test('Nachgeschobene Zahlen gehören zur vorherigen Übung', () => {
  const e = one('Liegestütz mit 25 Wiederholungen. Einen Satz.');
  assert.deepEqual([e.sets, e.reps], [1, 25]);
});

test('Unbekannte Übung -> Fehler, nichts erfunden', () => {
  const r = parseWorkoutText('Ich habe Burpees gemacht, 3 Sätze à 10', EX);
  assert.equal(r.ok, false);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].status, 'unknown');
  assert.equal(r.entries[0].exercise, null);
});

test('Unbekannte und bekannte Übung gemischt', () => {
  const r = parseWorkoutText('Burpees 3 mal 10, dann Dips 3 mal 12', EX);
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[0].status, 'unknown');
  assert.equal(r.entries[1].status, 'ok');
  assert.equal(r.entries[1].exercise.name, 'Dips');
});

test('Fehlende Wiederholungen -> incomplete', () => {
  const e = one('Kniebeugen drei Sätze mit 80 Kilo');
  assert.equal(e.status, 'incomplete');
  assert.equal(e.sets, 3);
});

test('Whisper-Tippfehler werden toleriert', () => {
  assert.equal(one('Face Pull am Kabelzug 3x15').exercise.id, id('Face Pulls Kabelzug'));
  assert.equal(one('T-Bar-Rudern 4 mal 10 mit 30 kg').exercise.id, id('T Bar Rudern'));
  assert.equal(one('Russian Twists 3 Sätze 20 Wiederholungen').exercise.id, id('Russian Twist'));
  assert.equal(one('Uchikomi 3 Sätze 20 Wiederholungen').exercise.id, id('Uchi-Komi'));
});

test('"zehnmal" / "einmal"', () => {
  const e = one('Klimmzüge dreimal zehn');
  assert.deepEqual([e.sets, e.reps], [3, 10]);
  const f = one('Dips zwanzigmal');
  assert.deepEqual([f.sets, f.reps], [1, 20]);
});

test('Whisper-Prompt enthält Übungsnamen und bleibt kurz', () => {
  const p = buildWhisperPrompt(EX);
  assert.ok(p.includes('Liegestütz'));
  assert.ok(p.length <= 700);
});

test('Leerer Text', () => {
  const r = parseWorkoutText('', EX);
  assert.equal(r.ok, false);
  assert.equal(r.entries.length, 0);
});
