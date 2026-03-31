// Automatisches Backup zu Google Drive nach Datenänderungen
const backupQueue = new Set();
let backupTimeout = null;

// Backup nach Änderung verzögern (Debouncing)
function scheduleBackup(userId) {
  if (backupTimeout) {
    clearTimeout(backupTimeout);
  }
  
  backupQueue.add(userId);
  
  backupTimeout = setTimeout(async () => {
    const usersToBackup = Array.from(backupQueue);
    backupQueue.clear();
    
    for (const uid of usersToBackup) {
      try {
        await performBackupToDrive(uid);
      } catch (err) {
        console.error('❌ Auto-Backup fehlgeschlagen für User', uid, ':', err.message);
      }
    }
  }, 5000); // 5 Sekunden nach letzter Änderung
}

// Automatisches Restore beim Server-Start
async function autoRestoreOnStartup() {
  console.log('🔄 Prüfe automatisches Restore beim Start...');
  
  // Alle User mit Google Token finden
  return new Promise((resolve) => {
    db.all(`SELECT id, email, google_access_token FROM users WHERE google_access_token IS NOT NULL`, [], async (err, users) => {
      if (err || !users || users.length === 0) {
        console.log('ℹ️ Keine User mit Google Token für Auto-Restore gefunden');
        resolve();
        return;
      }
      
      console.log(`🔄 Auto-Restore für ${users.length} User...`);
      
      for (const user of users) {
        try {
          const hasData = await new Promise((resolve) => {
            db.get(`SELECT COUNT(*) as count FROM exercises WHERE user_id = ?`, [user.id], (err, row) => {
              resolve(row && row.count > 0);
            });
          });
          
          if (!hasData) {
            console.log(`📥 User ${user.id} hat keine Übungen - versuche Restore...`);
            await performRestoreFromDrive(user.id, user.google_access_token);
          }
        } catch (err) {
          console.error('❌ Auto-Restore fehlgeschlagen für User', user.id, ':', err.message);
        }
      }
      
      resolve();
    });
  });
}

// Backup durchführen
async function performBackupToDrive(userId) {
  return new Promise(async (resolve, reject) => {
    try {
      const user = await new Promise((resolve, reject) => {
        db.get('SELECT google_access_token FROM users WHERE id = ?', [userId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (!user || !user.google_access_token) {
        reject(new Error('Kein Google Access Token'));
        return;
      }
      
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: user.google_access_token });
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      
      // DB Datei lesen
      const dbBuffer = fs.readFileSync(DB_PATH);
      
      // Backup hochladen
      const backupMetadata = {
        name: `ironcoach_backup_user${userId}_${Date.now()}.db`,
        parents: ['root'],
        mimeType: 'application/x-sqlite3'
      };
      
      await drive.files.create({
        requestBody: backupMetadata,
        media: { body: dbBuffer }
      });
      
      console.log(`✅ Auto-Backup erfolgreich für User ${userId}`);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

// Restore durchführen
async function performRestoreFromDrive(userId, accessToken) {
  return new Promise(async (resolve, reject) => {
    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      
      // Neuestes Backup finden
      const response = await drive.files.list({
        q: `name contains 'ironcoach_backup_user${userId}_'`,
        orderBy: 'createdTime desc',
        pageSize: 1
      });
      
      if (!response.data.files || response.data.files.length === 0) {
        console.log(`ℹ️ Kein Backup für User ${userId} gefunden`);
        resolve(false);
        return;
      }
      
      const backupId = response.data.files[0].id;
      console.log(`📥 Lade Backup ${backupId}...`);
      
      // Backup herunterladen
      const backupResponse = await drive.files.get({
        fileId: backupId,
        alt: 'media'
      }, { responseType: 'arraybuffer' });
      
      // Temporäre Datei erstellen
      const backupPath = path.join(__dirname, `backup_restore_${userId}.db`);
      fs.writeFileSync(backupPath, Buffer.from(backupResponse.data));
      
      // Daten aus Backup extrahieren und in aktuelle DB importieren
      const backupDb = new sqlite3.Database(backupPath, sqlite3.OPEN_READONLY);
      
      await new Promise((resolveImport, rejectImport) => {
        backupDb.all('SELECT * FROM exercises WHERE user_id = ?', [userId], (err, exercises) => {
          if (err) {
            rejectImport(err);
            return;
          }
          
          let imported = 0;
          exercises.forEach(exercise => {
            db.run('INSERT OR IGNORE INTO exercises (user_id, name, muscle_group, exercise_type) VALUES (?, ?, ?, ?)',
              [exercise.user_id, exercise.name, exercise.muscle_group, exercise.exercise_type || 'strength'],
              (err) => {
                if (!err) imported++;
              }
            );
          });
          
          backupDb.close(() => {
            fs.unlinkSync(backupPath);
            console.log(`✅ Auto-Restore: ${imported} Übungen importiert`);
            resolveImport(imported > 0);
          });
        });
      });
      
      resolve(true);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { scheduleBackup, autoRestoreOnStartup };
