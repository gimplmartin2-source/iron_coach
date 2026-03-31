const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Pfad zur heruntergeladenen Backup-DB
const BACKUP_PATH = process.argv[2] || './training_backup.db';
const OUTPUT_PATH = process.argv[3] || './training_cleaned.db';

if (!fs.existsSync(BACKUP_PATH)) {
    console.error(`❌ Datei nicht gefunden: ${BACKUP_PATH}`);
    console.log('Verwendung: node clean-backup.js <backup.db> [output.db]');
    process.exit(1);
}

// Kopie erstellen um Original nicht zu verändern
fs.copyFileSync(BACKUP_PATH, OUTPUT_PATH);
console.log(`📁 Backup kopiert nach: ${OUTPUT_PATH}`);

const db = new sqlite3.Database(OUTPUT_PATH);

async function cleanDuplicates() {
    console.log('\n🔍 Suche nach doppelten Übungen...\n');
    
    // Alle User finden
    const users = await new Promise((resolve, reject) => {
        db.all(`SELECT DISTINCT user_id FROM exercises`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => r.user_id));
        });
    });
    
    console.log(`👤 ${users.length} User gefunden: [${users.join(', ')}]\n`);
    
    let totalDeleted = 0;
    let usersWithDuplicates = 0;
    
    for (const userId of users) {
        // Duplikate für diesen User finden
        const duplicates = await new Promise((resolve, reject) => {
            db.all(`
                SELECT name, COUNT(*) as count, MIN(id) as keep_id, 
                       GROUP_CONCAT(id) as all_ids,
                       GROUP_CONCAT(COALESCE(exercise_type, 'strength')) as types
                FROM exercises 
                WHERE user_id = ?
                GROUP BY name 
                HAVING count > 1
            `, [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        if (duplicates.length === 0) {
            console.log(`✅ User ${userId}: Keine Duplikate`);
            continue;
        }
        
        usersWithDuplicates++;
        console.log(`\n⚠️  User ${userId}: ${duplicates.length} Übungen mit Duplikaten:`);
        
        for (const dup of duplicates) {
            const ids = dup.all_ids.split(',').map(Number);
            const keepId = dup.keep_id;
            const deleteIds = ids.filter(id => id !== keepId);
            
            console.log(`   "${dup.name}": ${ids.length} Einträge (behalte ID ${keepId}, lösche [${deleteIds.join(', ')}])`);
            
            // Lösche die Duplikate
            await new Promise((resolve, reject) => {
                const placeholders = deleteIds.map(() => '?').join(',');
                db.run(`DELETE FROM exercises WHERE id IN (${placeholders})`, deleteIds, function(err) {
                    if (err) {
                        console.error(`      ❌ Fehler: ${err.message}`);
                        reject(err);
                    } else {
                        console.log(`      ✅ ${this.changes} gelöscht`);
                        totalDeleted += this.changes;
                        resolve();
                    }
                });
            });
        }
    }
    
    console.log(`\n📊 Zusammenfassung:`);
    console.log(`   - ${usersWithDuplicates} User hatten Duplikate`);
    console.log(`   - ${totalDeleted} doppelte Übungen gelöscht`);
    
    // UNIQUE Constraint hinzufügen
    console.log('\n🔒 Füge UNIQUE Constraint hinzu...');
    
    await new Promise((resolve, reject) => {
        db.run(`BEGIN TRANSACTION`, [], (err) => {
            if (err) { reject(err); return; }
            
            db.run(`
                CREATE TABLE exercises_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    muscle_group TEXT NOT NULL,
                    exercise_type TEXT DEFAULT 'strength',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    UNIQUE(user_id, name)
                )
            `, [], (err) => {
                if (err) { db.run(`ROLLBACK`); reject(err); return; }
                
                db.run(`
                    INSERT INTO exercises_new (id, user_id, name, muscle_group, exercise_type, created_at)
                    SELECT id, user_id, name, muscle_group, 
                           COALESCE(exercise_type, 'strength'), created_at
                    FROM exercises
                `, [], function(err) {
                    if (err) { db.run(`ROLLBACK`); reject(err); return; }
                    
                    console.log(`   ✅ ${this.changes} Übungen in neue Tabelle kopiert`);
                    
                    db.run(`DROP TABLE exercises`, [], (err) => {
                        if (err) { db.run(`ROLLBACK`); reject(err); return; }
                        
                        db.run(`ALTER TABLE exercises_new RENAME TO exercises`, [], (err) => {
                            if (err) { db.run(`ROLLBACK`); reject(err); return; }
                            
                            db.run(`COMMIT`, [], (err) => {
                                if (err) { db.run(`ROLLBACK`); reject(err); return; }
                                resolve();
                            });
                        });
                    });
                });
            });
        });
    });
    
    console.log('✅ UNIQUE Constraint hinzugefügt');
}

// Prüfe vorher
async function showStats() {
    const stats = await new Promise((resolve, reject) => {
        db.get(`
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT user_id) as users,
                COUNT(DISTINCT name) as unique_names
            FROM exercises
        `, [], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
    
    const duplicates = await new Promise((resolve, reject) => {
        db.get(`
            SELECT COUNT(*) as count FROM (
                SELECT user_id, name, COUNT(*) as cnt
                FROM exercises
                GROUP BY user_id, name
                HAVING cnt > 1
            )
        `, [], (err, row) => {
            if (err) reject(err);
            else resolve(row.count);
        });
    });
    
    console.log('\n📈 Statistik:');
    console.log(`   Gesamt Übungen: ${stats.total}`);
    console.log(`   User: ${stats.users}`);
    console.log(`   Eindeutige Namen: ${stats.unique_names}`);
    console.log(`   Duplikat-Gruppen: ${duplicates}`);
}

async function main() {
    try {
        console.log('🔧 Backup-Bereinigung\n');
        console.log(`📁 Eingabe:  ${BACKUP_PATH}`);
        console.log(`📁 Ausgabe:  ${OUTPUT_PATH}`);
        
        await showStats();
        await cleanDuplicates();
        await showStats();
        
        console.log('\n✅ Bereinigung abgeschlossen!');
        console.log(`\nNächste Schritte:`);
        console.log(`1. Die Datei ${OUTPUT_PATH} enthält das bereinigte Backup`);
        console.log(`2. Lade sie in Google Drive hoch (ersetzt das alte Backup)`);
        console.log(`3. Oder ersetze die lokale training.db mit dieser Datei`);
        
        db.close();
    } catch (err) {
        console.error('\n❌ Fehler:', err);
        db.close();
        process.exit(1);
    }
}

main();
