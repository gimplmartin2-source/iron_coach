const fs = require('fs');
const { google } = require('googleapis');
const path = require('path');
const readline = require('readline');

// Konfiguration
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const TOKEN_PATH = '.google_token.json';

// Google OAuth2 Setup
const oauth2Client = new google.auth.OAuth2(
  'DEIN_CLIENT_ID',
  'DEIN_CLIENT_SECRET',
  'http://localhost:3000/oauth2callback'
);

async function downloadBackup() {
  console.log('🔄 Starte Backup-Wiederherstellung...\\n');
  
  // Suche nach Backup-Datei
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  
  try {
    const res = await drive.files.list({
      q: "name='ironcoach_backup_user1.db'",
      fields: 'files(id, name, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 1
    });
    
    if (res.data.files.length === 0) {
      console.error('❌ Kein Backup gefunden');
      return;
    }
    
    const file = res.data.files[0];
    console.log(`✅ Backup gefunden: ${file.name}`);
    console.log(`📅 Zuletzt geändert: ${file.modifiedTime}\\n`);
    
    // Download
    const dest = fs.createWriteStream('backup_restore.db');
    const response = await drive.files.get(
      { fileId: file.id, alt: 'media' },
      { responseType: 'stream' }
    );
    
    response.data.pipe(dest);
    
    await new Promise((resolve, reject) => {
      dest.on('finish', resolve);
      dest.on('error', reject);
    });
    
    console.log('✅ Backup heruntergeladen: backup_restore.db');
    console.log('\\n📋 Nächste Schritte:');
    console.log('1. Gehe zu https://trainings-tracker.onrender.com');
    console.log('2. Melde dich ab und neu an');
    console.log('3. Das Backup sollte automatisch geladen werden');
    
  } catch (err) {
    console.error('❌ Fehler:', err.message);
    if (err.message.includes('invalid_grant')) {
      console.log('\\n🔑 Token abgelaufen. Bitte neu authorisieren:');
      console.log('1. Gehe zu https://developers.google.com/oauthplayground');
      console.log('2. Wähle Scope: https://www.googleapis.com/auth/drive');
      console.log('3. Tausche Authorization Code gegen Token ein');
      console.log('4. Kopiere Access Token und füge es unten ein\\n');
    }
  }
}

// Führe aus
downloadBackup();
