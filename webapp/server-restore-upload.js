const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();

const upload = multer({ dest: 'uploads/' });

// Upload-Endpunkt für Backup-Dateien
app.post('/api/restore-upload', authenticateJWT, upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    }
    
    const backupPath = req.file.path;
    const dbPath = path.join(__dirname, 'data', 'trainings.db');
    
    // Backup einspielen
    fs.copyFileSync(backupPath, dbPath);
    fs.unlinkSync(backupPath); // Temp-Datei löschen
    
    // DB neu verbinden
    db.close();
    db = new sqlite3.Database(dbPath);
    
    res.json({ success: true, message: 'Backup erfolgreich wiederhergestellt!' });
    
  } catch (err) {
    console.error('Restore Fehler:', err);
    res.status(500).json({ error: err.message });
  }
});

// Backup herunterladen
app.get('/api/backup-download', authenticateJWT, (req, res) => {
  const dbPath = path.join(__dirname, 'data', 'trainings.db');
  res.download(dbPath, `ironcoach_backup_user${req.user.userId}.db`);
});
