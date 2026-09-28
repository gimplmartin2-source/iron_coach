// Lokales Backup der IronCoach-DB (ohne Google Drive nötig).
// Ablauf: WAL-Checkpoint -> DB-Datei mit Zeitstempel nach backups/ kopieren
//        -> Backup validieren -> -wal/-shm Nebendateien aufräumen
//        -> alte Backups auf KEEP begrenzen.
// Warum: Die lokale Instanz läuft ohne Google-OAuth; das Backup landet im
// OneDrive-Ordner und ist damit automatisch in der Cloud gesichert.

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const DB_PATH = path.join(__dirname, process.env.DATABASE_PATH || 'training.db');
const BACKUP_DIR = path.join(__dirname, 'backups');
const KEEP = 20; // Anzahl aufzubewahrender Backups

function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const db = new sqlite3.Database(DB_PATH);
db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
  if (err) { console.error('Checkpoint fehlgeschlagen:', err.message); process.exit(1); }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `ironcoach_local_${stamp(new Date())}.db`);
  fs.copyFileSync(DB_PATH, dest);

  // Backup validieren: DB muss sich öffnen lassen und Tabellen enthalten
  const check = new sqlite3.Database(dest, sqlite3.OPEN_READONLY);
  check.get("SELECT (SELECT COUNT(*) FROM workouts) w, (SELECT COUNT(*) FROM exercises) e", (e2, row) => {
    if (e2) { console.error('Backup ungültig:', e2.message); process.exit(1); }
    check.close(() => {
      // Nur-Lese-Validierung kann -wal/-shm Nebendateien anlegen — weg damit
      for (const ext of ['-wal', '-shm']) {
        const side = dest + ext;
        if (fs.existsSync(side)) fs.unlinkSync(side);
      }
      console.log(`Backup OK: ${dest} (${row.w} Workouts, ${row.e} Übungen)`);

      // Aufräumen: nur die neuesten KEEP behalten
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('ironcoach_local_') && f.endsWith('.db'))
        .sort()
        .reverse();
      for (const f of files.slice(KEEP)) fs.unlinkSync(path.join(BACKUP_DIR, f));
      db.close();
    });
  });
});