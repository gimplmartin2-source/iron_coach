// Migration: video_src Feld zu exercises hinzufügen
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || './training.db';
const db = new sqlite3.Database(DB_PATH);

// Prüfe ob video_src existiert
db.all(`PRAGMA table_info(exercises)`, [], (err, cols) => {
  if (err) {
    console.error('Fehler:', err);
    process.exit(1);
  }
  
  const hasVideoSrc = cols.some(c => c.name === 'video_src');
  
  if (!hasVideoSrc) {
    console.log('🔧 Füge video_src Spalte zu exercises hinzu...');
    db.run(`ALTER TABLE exercises ADD COLUMN video_src TEXT`, [], (err) => {
      if (err) {
        console.error('❌ Fehler:', err.message);
        process.exit(1);
      }
      console.log('✅ video_src Spalte hinzugefügt');
      db.close();
    });
  } else {
    console.log('✅ video_src Spalte existiert bereits');
    db.close();
  }
});
