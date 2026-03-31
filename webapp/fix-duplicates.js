const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'training.db');
const db = new sqlite3.Database(DB_PATH);

console.log('🔧 Entferne doppelte Übungen...\n');

// Finde alle doppelten Übungen (gleicher Name, gleicher User)
db.all(`
    SELECT user_id, name, COUNT(*) as count, MIN(id) as keep_id, GROUP_CONCAT(id) as all_ids
    FROM exercises 
    GROUP BY user_id, name 
    HAVING count > 1
`, [], (err, rows) => {
    if (err) {
        console.error('❌ Fehler:', err.message);
        db.close();
        return;
    }

    if (rows.length === 0) {
        console.log('✅ Keine doppelten Übungen gefunden!');
        addUniqueConstraint();
        return;
    }

    console.log(`⚠️  ${rows.length} Übungen mit Duplikaten gefunden\n`);
    
    let deletedCount = 0;
    let processed = 0;

    rows.forEach((row, index) => {
        const ids = row.all_ids.split(',').map(Number);
        const keepId = row.keep_id;
        const deleteIds = ids.filter(id => id !== keepId);
        
        console.log(`${index + 1}. "${row.name}" (User ${row.user_id}): ${ids.length} Einträge`);
        console.log(`   Behalte ID: ${keepId}, Lösche IDs: [${deleteIds.join(', ')}]`);

        // Lösche die Duplikate
        const placeholders = deleteIds.map(() => '?').join(',');
        db.run(`DELETE FROM exercises WHERE id IN (${placeholders})`, deleteIds, function(err) {
            if (err) {
                console.error(`   ❌ Fehler beim Löschen:`, err.message);
            } else {
                deletedCount += this.changes;
                console.log(`   ✅ ${this.changes} Duplikate gelöscht`);
            }
            
            processed++;
            if (processed === rows.length) {
                console.log(`\n📊 Ergebnis: ${deletedCount} Duplikate entfernt`);
                addUniqueConstraint();
            }
        });
    });
});

function addUniqueConstraint() {
    console.log('\n🔒 Füge UNIQUE Constraint hinzu...');
    
    // SQLite unterstützt ADD CONSTRAINT nicht direkt
    // Workaround: Neue Tabelle mit Constraint erstellen, Daten kopieren, alte Tabelle ersetzen
    
    db.run(`BEGIN TRANSACTION`, [], (err) => {
        if (err) {
            console.error('❌ Fehler:', err.message);
            db.close();
            return;
        }

        // Temp-Tabelle mit UNIQUE constraint erstellen
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
            if (err) {
                console.error('❌ Fehler beim Erstellen der neuen Tabelle:', err.message);
                db.run(`ROLLBACK`, () => db.close());
                return;
            }

            // Daten kopieren
            db.run(`
                INSERT INTO exercises_new (id, user_id, name, muscle_group, exercise_type, created_at)
                SELECT id, user_id, name, muscle_group, 
                       COALESCE(exercise_type, 'strength') as exercise_type, 
                       created_at 
                FROM exercises
            `, [], function(err) {
                if (err) {
                    console.error('❌ Fehler beim Kopieren:', err.message);
                    db.run(`ROLLBACK`, () => db.close());
                    return;
                }

                console.log(`   ✅ ${this.changes} Übungen in neue Tabelle kopiert`);

                // Alte Tabelle löschen
                db.run(`DROP TABLE exercises`, [], (err) => {
                    if (err) {
                        console.error('❌ Fehler beim Löschen:', err.message);
                        db.run(`ROLLBACK`, () => db.close());
                        return;
                    }

                    // Neue Tabelle umbenennen
                    db.run(`ALTER TABLE exercises_new RENAME TO exercises`, [], (err) => {
                        if (err) {
                            console.error('❌ Fehler beim Umbenennen:', err.message);
                            db.run(`ROLLBACK`, () => db.close());
                            return;
                        }

                        db.run(`COMMIT`, [], (err) => {
                            if (err) {
                                console.error('❌ Fehler beim Commit:', err.message);
                                db.run(`ROLLBACK`, () => db.close());
                                return;
                            }

                            console.log('✅ UNIQUE Constraint erfolgreich hinzugefügt!');
                            console.log('\n🎉 Fertig! Jede Übung jetzt nur noch einmal pro User.');
                            db.close();
                        });
                    });
                });
            });
        });
    });
}
