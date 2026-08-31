// Taeglicher Render-Sync: zieht den aktuellen IronCoach-Datenstand von
// Render (API /api/sync/pull) und fuehrt ihn lokal in das aktive Konto
// zusammen (POST /api/import/merge-backup). Duplikat-sicher: identische
// Workouts werden übersprungen, deshalb darf das beliebig oft laufen.
require('dotenv').config();

const LOG_PREFIX = '[render-sync]';
const PULL_URL = process.env.SYNC_PULL_URL || 'https://iron-coach-90eu.onrender.com/api/sync/pull';
const LOCAL_URL = process.env.SYNC_LOCAL_URL || 'http://127.0.0.1:3001';

async function main() {
  const token = process.env.GOOGLE_CLIENT_SECRET;
  if (!token) throw new Error('GOOGLE_CLIENT_SECRET fehlt in .env');

  const started = Date.now();

  // Render kann im Free-Plan schlafen -> großzügiger Timeout (120 s)
  const pullRes = await fetch(PULL_URL, {
    headers: { 'x-sync-token': token },
    signal: AbortSignal.timeout(120000)
  });
  if (!pullRes.ok) {
    const body = (await pullRes.text()).slice(0, 300);
    throw new Error(`Pull fehlgeschlagen: HTTP ${pullRes.status} – ${body}`);
  }

  const buffer = Buffer.from(await pullRes.arrayBuffer());
  if (buffer.subarray(0, 15).toString() !== 'SQLite format 3') {
    throw new Error('Antwort ist kein SQLite-Snapshot. Anfang: ' + buffer.subarray(0, 100).toString());
  }
  const source = pullRes.headers.get('x-sync-source') || 'unbekannt';
  console.log(`${LOG_PREFIX} Snapshot geholt (${(buffer.length / 1024).toFixed(0)} KB, Quelle: ${source})`);

  // Lokal in das aktive Konto zusammenfuehren (No-Auth-Modus => Default-User)
  const mergeRes = await fetch(`${LOCAL_URL}/api/import/merge-backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupBase64: buffer.toString('base64') })
  });
  const mergeText = await mergeRes.text();
  if (!mergeRes.ok) {
    throw new Error(`Lokaler Merge fehlgeschlagen: HTTP ${mergeRes.status} – ${mergeText.slice(0, 300)}`);
  }

  const stats = JSON.parse(mergeText);
  console.log(`${LOG_PREFIX} Merge OK: +${stats.importedWorkouts} Workouts, +${stats.createdExercises} Übungen, ` +
    `${stats.skippedWorkouts} übersprungen (Duplikat-Schutz/ohne Zuordnung), +${stats.importedPlans} Pläne`);
  console.log(`${LOG_PREFIX} Fertig in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch(err => {
  console.error(`${LOG_PREFIX} FEHLER: ${err.message}`);
  process.exit(1);
});