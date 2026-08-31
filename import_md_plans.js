// Importiert die beiden Trainingsplan-MD-Dateien als App-Pläne für Martins lokalen Account (User 21).
// Format entspricht training_plans.plan_data wie im Frontend-Editor verwendet.
// Nutzung: node import_md_plans.js  (idempotent - existierende Pläne mit gleichem Namen werden aktualisiert)

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'training.db');
const USER_ID = 21; // Martins lokaler Account

// Gemeinsames Aufwärm-Protokoll (Gleitwirbel-freundlich)
const WARMUP_CORE = [
  { name: 'Cat-Cow (Katze-Kuh)', sets: 1, reps: 10, muscle: 'Rücken' },
  { name: 'Pelvic Tilts (Beckenpendeln)', sets: 1, reps: 10, muscle: 'Core' },
  { name: 'ADIM Core Activation', sets: 1, duration: '20-30 Sek', muscle: 'Core' },
  { name: 'Dead Bug (warm-up)', sets: 1, reps: '5 pro Seite', muscle: 'Core' },
  { name: 'Hip Circles', sets: 1, reps: '10 pro Richtung', muscle: 'Beine' },
  { name: 'Arm Circles', sets: 1, reps: '15 vorwärts + 15 rückwärts', muscle: 'Schultern' }
];

// ================= Plan 1: Gleitwirbel Core-Stabilisation =================
const planGleitwirbel = {
  name: 'Gleitwirbel Core-Stabilisation (MD-Import)',
  description: 'Gleitwirbel-kompatible Core-Stabilisation aus trainingsplan_gleitwirbel.md - Fokus tiefer Rumpf (Transversus abdominis), keine Crunches/Sit-ups.',
  days: [
    {
      day: 'Montag', focus: 'Judo-Training', intensity: 'Hoch', duration: '90 Min',
      warmup: WARMUP_CORE,
      exercises: [
        { name: 'ADIM', sets: 3, duration: '30 Sek', muscle: 'Core' },
        { name: 'Judo-Training (Technik + Randori)', sets: 1, duration: '90 Min', muscle: 'Judo' }
      ],
      cooldown: [
        { name: 'Kindhaltung (Child\'s Pose)', sets: 1, duration: '60 Sek', muscle: 'Dehnen' },
        { name: 'Hüftbeuger-Dehnung', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' }
      ]
    },
    {
      day: 'Dienstag', focus: 'Core-Stabilisation + Dehnen', intensity: 'Mittel', duration: '45 Min',
      warmup: WARMUP_CORE,
      exercises: [
        { name: 'ADIM', sets: 3, duration: '30 Sek', muscle: 'Core' },
        { name: 'Dead Bug', sets: 3, reps: '8-10 pro Seite', muscle: 'Core' },
        { name: 'Bird Dog', sets: 3, reps: '8-10 pro Seite', muscle: 'Core' },
        { name: 'Glute Bridge', sets: 3, reps: '12-15', muscle: 'Beine' },
        { name: 'Side Plank (modifiziert, Knie unten)', sets: 3, duration: '20-30 Sek', muscle: 'Core' },
        { name: 'Pallof Press (Kabel)', sets: 3, reps: 10, muscle: 'Core' },
        { name: 'Kniestand Hüftbeuger-Dehnung', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' },
        { name: '90/90 Hip Stretch', sets: 1, duration: '90 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Schmetterling (Adduktoren)', sets: 1, duration: '90 Sek', muscle: 'Dehnen' }
      ],
      cooldown: [
        { name: 'Katze-Kuh', sets: 1, reps: 10, muscle: 'Dehnen' },
        { name: 'Kindhaltung', sets: 1, duration: '60 Sek', muscle: 'Dehnen' }
      ]
    },
    {
      day: 'Mittwoch', focus: 'Tiefer Core + Rücken', intensity: 'Mittel', duration: '40 Min',
      warmup: WARMUP_CORE,
      exercises: [
        { name: 'ADIM', sets: 3, duration: '30 Sek', muscle: 'Core' },
        { name: 'Dead Bug', sets: 3, reps: '8-10 pro Seite', muscle: 'Core' },
        { name: 'Bird Dog', sets: 3, reps: '8-10 pro Seite', muscle: 'Core' },
        { name: 'Pallof Press (Kabel)', sets: 3, reps: 10, muscle: 'Core' },
        { name: 'Piriformis-Dehnung', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Brust-Dehnung an Tür', sets: 1, duration: '60 Sek', muscle: 'Dehnen' }
      ],
      cooldown: [
        { name: 'Kindhaltung', sets: 1, duration: '60 Sek', muscle: 'Dehnen' }
      ]
    },
    {
      day: 'Donnerstag', focus: 'Dehnen + Beweglichkeit', intensity: 'Niedrig', duration: '30 Min',
      warmup: WARMUP_CORE,
      exercises: [
        { name: 'ADIM', sets: 3, duration: '30 Sek', muscle: 'Core' },
        { name: 'Kniestand Hüftbeuger-Dehnung', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' },
        { name: '90/90 Hip Stretch', sets: 1, duration: '90 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Piriformis-Dehnung', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Schmetterling (Adduktoren)', sets: 1, duration: '90 Sek', muscle: 'Dehnen' },
        { name: 'Katze-Kuh', sets: 1, reps: 10, muscle: 'Dehnen' },
        { name: 'Kindhaltung', sets: 1, duration: '60 Sek', muscle: 'Dehnen' },
        { name: 'LWS-Rotation (supine, ohne Gewicht)', sets: 1, duration: '30 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Brust-Dehnung an Tür', sets: 1, duration: '60 Sek', muscle: 'Dehnen' },
        { name: 'Lat-Dehnung (Kindhaltung seitlich)', sets: 1, duration: '45 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Trapezius-Nacken-Dehnung', sets: 1, duration: '30 Sek pro Seite', muscle: 'Dehnen' }
      ],
      cooldown: [
        { name: 'Tiefe Atmung im Liegen', sets: 1, duration: '60 Sek', muscle: 'Dehnen' }
      ]
    },
    {
      day: 'Freitag', focus: 'Judo-Training', intensity: 'Hoch', duration: '120 Min',
      warmup: WARMUP_CORE,
      exercises: [
        { name: 'ADIM', sets: 3, duration: '30 Sek', muscle: 'Core' },
        { name: 'Judo-Training (Technik + Randori)', sets: 1, duration: '120 Min', muscle: 'Judo' }
      ],
      cooldown: [
        { name: 'Kindhaltung', sets: 1, duration: '60 Sek', muscle: 'Dehnen' },
        { name: 'Hüftbeuger-Dehnung', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Tiefe Atmung im Liegen', sets: 1, duration: '60 Sek', muscle: 'Dehnen' }
      ]
    },
    {
      day: 'Samstag', focus: 'Core-Ausdauer + Hüfte', intensity: 'Mittel', duration: '40 Min',
      warmup: WARMUP_CORE,
      exercises: [
        { name: 'ADIM', sets: 3, duration: '30 Sek', muscle: 'Core' },
        { name: 'Front Plank (modifiziert, Knie unten)', sets: 3, duration: '30-45 Sek', muscle: 'Core' },
        { name: 'Dead Bug Variationen', sets: 3, duration: '45 Sek', muscle: 'Core' },
        { name: 'Glute March (Brücke)', sets: 3, reps: '10 pro Seite', muscle: 'Beine' },
        { name: 'Copenhagen Plank (leicht)', sets: 2, duration: '15 Sek pro Seite', muscle: 'Core' }
      ],
      cooldown: [
        { name: 'Hüftbeuger-Dehnung', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' }
      ]
    },
    {
      day: 'Sonntag', focus: 'Aktive Erholung / leichtes Dehnen', intensity: 'Niedrig', duration: '20 Min',
      warmup: [],
      exercises: [
        { name: 'Leichter Spaziergang', sets: 1, duration: '15-20 Min', muscle: 'Ganzkörper' },
        { name: 'ADIM + Atemübung', sets: 1, duration: '10 Min', muscle: 'Core' },
        { name: 'Full Body Dehnung', sets: 1, duration: '15 Min', muscle: 'Dehnen' }
      ],
      cooldown: []
    }
  ]
};

// ================= Plan 2: Vollständiger 7-Tage-Split =================
const planVollstaendig = {
  name: 'Vollständiger 7-Tage-Plan (MD-Import)',
  description: 'Alle Muskelgruppen + Gleitwirbel-sicher aus trainingsplan_vollstaendig.md - Judo + Beine + Push/Pull + Core, alle 13 Muskelgruppen abgedeckt.',
  days: [
    {
      day: 'Montag', focus: 'Judo + Beine + Hüfte', intensity: 'Hoch', duration: '90 Min',
      warmup: [
        { name: 'ADIM Core Activation', sets: 2, duration: '30 Sek', muscle: 'Core' },
        { name: 'Goblet Squats (leicht)', sets: 2, reps: 10, muscle: 'Beine' },
        { name: 'Hip Circles', sets: 2, reps: '10 pro Richtung', muscle: 'Beine' },
        { name: 'Cossack Squats', sets: 2, reps: '8 pro Seite', muscle: 'Beine' }
      ],
      exercises: [
        { name: 'Judo-Training (Technik + Randori)', sets: 1, duration: '90 Min', muscle: 'Judo' }
      ],
      cooldown: [
        { name: 'Child\'s Pose', sets: 1, duration: '60 Sek', muscle: 'Dehnen' },
        { name: 'Hip Flexor Stretch', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' }
      ]
    },
    {
      day: 'Dienstag', focus: 'Rücken + Hinterer Core', intensity: 'Mittel', duration: '50 Min',
      warmup: WARMUP_CORE,
      exercises: [
        { name: 'McGill Pull-Up', sets: 3, reps: '5-6', muscle: 'Rücken', info: '1 Sek ziehen, 5 Sek halten, kontrolliert ablassen - KEIN Schwung!' },
        { name: 'TRX/Suspension Row', sets: 3, reps: 10, muscle: 'Rücken', info: 'Brust raus, LWS neutral' },
        { name: 'Face Pulls (Kabel/Band)', sets: 3, reps: 15, muscle: 'Schultern', info: 'Oberarme 45 Grad, Daumen nach hinten' },
        { name: 'Back Extension (Rückenstrecker)', sets: 2, reps: 12, muscle: 'Rücken', info: 'Nur 45 Grad Anhebung, LWS nicht überstrecken' },
        { name: 'Bird Dog', sets: 3, reps: '8 pro Seite', muscle: 'Core', info: '5 Sek halten, Becken stabil' },
        { name: 'Dead Bug', sets: 3, reps: '10 pro Seite', muscle: 'Core', info: 'Rücken fest am Boden' },
        { name: 'Side Plank (Knie unten)', sets: 3, duration: '30 Sek', muscle: 'Core', info: 'Hüfte hoch, stabilisiert' }
      ],
      cooldown: [
        { name: 'Katze-Kuh', sets: 1, reps: 10, muscle: 'Dehnen' },
        { name: 'Kniestand Hüftbeuger', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' }
      ]
    },
    {
      day: 'Mittwoch', focus: 'Brust + Schultern', intensity: 'Mittel', duration: '45 Min',
      warmup: [
        { name: 'Schulterkreisen rückwärts', sets: 1, reps: 20, muscle: 'Schultern' },
        { name: 'Arm Circles', sets: 1, reps: '15 pro Richtung', muscle: 'Schultern' }
      ],
      exercises: [
        { name: 'Schrägbankdrücken', sets: 3, reps: 10, muscle: 'Brust', info: 'LWS stabil, keine übermäßige Rückenbeugung' },
        { name: 'Liegestütze (modifiziert)', sets: 3, reps: '8-12', muscle: 'Brust', info: 'Knie am Boden für weniger LWS-Druck' },
        { name: 'Dumbbell Floor Press', sets: 2, reps: 12, muscle: 'Brust', info: 'LWS liegt flach auf Boden' },
        { name: 'Seitheben (leicht)', sets: 3, reps: 15, muscle: 'Schultern', info: 'Ellbogen leicht gebeugt, nicht über Schultern heben' },
        { name: 'Frontheben (Kurzhantel)', sets: 3, reps: 10, muscle: 'Schultern', info: 'Alternierend, kontrolliert' },
        { name: 'External Rotation (Band)', sets: 3, reps: 15, muscle: 'Schultern', info: 'Stabilität für Judo' },
        { name: 'Pallof Press', sets: 3, reps: 10, muscle: 'Core', info: 'Anti-Rotation, Rumpf stabil' }
      ],
      cooldown: []
    },
    {
      day: 'Donnerstag', focus: 'Core + Mobilität + Dehnen', intensity: 'Niedrig', duration: '40 Min',
      warmup: WARMUP_CORE,
      exercises: [
        { name: 'ADIM', sets: 3, duration: '30 Sek', muscle: 'Core' },
        { name: '90/90 Hip Switch', sets: 2, reps: '10 pro Seite', muscle: 'Beine' },
        { name: 'Copenhagen Plank (light)', sets: 2, duration: '20 Sek', muscle: 'Core' },
        { name: 'Thread the Needle', sets: 2, duration: '30 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Piriformis Stretch', sets: 2, duration: '30 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Knie-zu-Brust (einseitig)', sets: 2, duration: '30 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Brust-Dehnung an Tür', sets: 2, duration: '30 Sek', muscle: 'Dehnen' }
      ],
      cooldown: [
        { name: 'Foam Rolling (Oberschenkel, oberer Rücken - nicht LWS)', sets: 1, duration: '5 Min', muscle: 'Ganzkörper' }
      ]
    },
    {
      day: 'Freitag', focus: 'Judo + Arme + Griffkraft', intensity: 'Hoch', duration: '120 Min',
      warmup: [
        { name: 'Arm Circles vorwärts/rückwärts', sets: 2, reps: 15, muscle: 'Schultern' },
        { name: 'Grip Hang (Klimmzugstange)', sets: 2, duration: '20 Sek', muscle: 'Arme' },
        { name: 'Kurzhantel Curls (leicht)', sets: 2, reps: 12, muscle: 'Arme' }
      ],
      exercises: [
        { name: 'Judo-Training', sets: 1, duration: '90 Min', muscle: 'Judo' },
        { name: 'Hammer Curls', sets: 3, reps: 10, muscle: 'Arme' },
        { name: 'Overhead Tricep Extension', sets: 3, reps: 12, muscle: 'Arme', info: 'Seitlich, nicht hinter Kopf (LWS-Schutz)' },
        { name: 'Wrist Curls', sets: 2, reps: 15, muscle: 'Arme', info: 'Für Griffkraft' },
        { name: 'Reverse Wrist Curls', sets: 2, reps: 15, muscle: 'Arme', info: 'Balance für Judo' },
        { name: 'Grip Walk (mit Hanteln)', sets: 2, duration: '20 m', muscle: 'Arme', info: 'Schwere Kurzhanteln tragen' }
      ],
      cooldown: [
        { name: 'Hüftbeuger-Dehnung', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' }
      ]
    },
    {
      day: 'Samstag', focus: 'Beine + Gesäß (Kraft-Fokus)', intensity: 'Mittel', duration: '50 Min',
      warmup: WARMUP_CORE,
      exercises: [
        { name: 'Goblet Squats', sets: 4, reps: 10, muscle: 'Beine', info: 'Oberkörper aufrecht, LWS nicht überstrecken' },
        { name: 'Romanian Deadlift (RDL)', sets: 3, reps: 10, muscle: 'Beine', info: 'Knie leicht gebogen, Rücken gerade, nicht zu tief' },
        { name: 'Bulgarian Split Squats', sets: 3, reps: '8 pro Seite', muscle: 'Beine', info: 'Brust aufrecht, LWS neutral' },
        { name: 'Hip Thrusts', sets: 3, reps: 12, muscle: 'Beine', info: 'Schultern auf Bank, nur Hüfte heben' },
        { name: 'Single Leg Glute Bridge', sets: 3, reps: '12 pro Seite', muscle: 'Beine' },
        { name: 'Calf Raises', sets: 3, reps: 15, muscle: 'Beine', info: 'Vollständige Streckung' },
        { name: 'Side Plank mit Clamshell', sets: 2, reps: '10 pro Seite', muscle: 'Core' }
      ],
      cooldown: [
        { name: 'Quad-Dehnung (stehend)', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Gesäß-Dehnung (Pigeon)', sets: 1, duration: '60 Sek pro Seite', muscle: 'Dehnen' },
        { name: 'Wade-Dehnung', sets: 1, duration: '30 Sek pro Seite', muscle: 'Dehnen' }
      ]
    },
    {
      day: 'Sonntag', focus: 'Aktive Erholung', intensity: 'Niedrig', duration: '20-30 Min',
      warmup: [],
      exercises: [
        { name: 'Leichter Spaziergang', sets: 1, duration: '15-20 Min', muscle: 'Ganzkörper' },
        { name: 'ADIM + Atemübung', sets: 1, duration: '10 Min', muscle: 'Core' },
        { name: 'Full Body Dehnung', sets: 1, duration: '15 Min', muscle: 'Dehnen' },
        { name: 'Meditation/Entspannung', sets: 1, duration: '10 Min', muscle: 'Ganzkörper' }
      ],
      cooldown: []
    }
  ]
};

// ================= In DB schreiben (idempotent) =================
const db = new sqlite3.Database(DB_PATH);
const plans = [planGleitwirbel, planVollstaendig];
let pending = plans.length;

plans.forEach(plan => {
  const planData = JSON.stringify(plan);
  db.get('SELECT id FROM training_plans WHERE user_id = ? AND name = ?', [USER_ID, plan.name], (err, row) => {
    if (err) { console.error('Fehler bei', plan.name, err.message); if (--pending === 0) db.close(); return; }
    if (row) {
      db.run('UPDATE training_plans SET description = ?, plan_data = ?, updated_at = datetime("now") WHERE id = ?',
        [plan.description, planData, row.id], (e2) => {
          if (e2) console.error('UPDATE-Fehler:', e2.message);
          else console.log('Aktualisiert:', plan.name, '(id', row.id + ')');
          if (--pending === 0) finish();
        });
    } else {
      db.run('INSERT INTO training_plans (user_id, name, description, plan_data, is_active) VALUES (?, ?, ?, ?, 0)',
        [USER_ID, plan.name, plan.description, planData], function (e3) {
          if (e3) console.error('INSERT-Fehler:', e3.message);
          else console.log('Angelegt:', plan.name, '(id', this.lastID + ', inaktiv)');
          if (--pending === 0) finish();
        });
    }
  });
});

function finish() {
  db.all('SELECT id, name, is_active, length(plan_data) len FROM training_plans WHERE user_id = ?', [USER_ID], (e, rows) => {
    if (e) console.error(e.message);
    else {
      console.log('\nPläne für User', USER_ID + ':');
      rows.forEach(r => console.log('  id', r.id, '|', r.name, '| active:', r.is_active, '| len:', r.len));
    }
    db.close();
  });
}