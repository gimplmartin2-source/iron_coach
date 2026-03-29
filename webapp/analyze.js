const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../martin_backup.db', sqlite3.OPEN_READONLY);

db.all(`
    SELECT w.*, e.name as exercise_name, e.muscle_group
    FROM workouts w
    LEFT JOIN exercises e ON w.exercise_id = e.id
    ORDER BY w.date DESC
`, [], (err, rows) => {
    if (err) { 
        console.error('Fehler:', err); 
        return; 
    }
    
    console.log('\\n📊 TRAININGSANALYSE');
    console.log('====================\\n');
    console.log('Anzahl Workouts: ' + rows.length);
    
    // Nach Typ filtern
    const timeBased = rows.filter(w => w.duration_seconds > 0 && (!w.weight || w.weight == 0));
    const strength = rows.filter(w => w.weight && w.weight > 0);
    
    console.log('Zeit-Uebungen: ' + timeBased.length);
    console.log('Kraft-Uebungen: ' + strength.length);
    
    // Nach Muskelgruppen
    const muscleGroups = {};
    rows.forEach(w => {
        const mg = w.muscle_group || 'Unbekannt';
        if (!muscleGroups[mg]) muscleGroups[mg] = [];
        muscleGroups[mg].push(w);
    });
    
    console.log('\\n📋 Nach Muskelgruppen:');
    Object.entries(muscleGroups).forEach(([mg, list]) => {
        console.log('\t' + mg + ': ' + list.length);
    });
    
    console.log('\\n📅 Letzte Workouts:');
    rows.slice(0,10).forEach(w => {
        const isTime = w.duration_seconds > 0 && (!w.weight || w.weight == 0);
        const display = isTime 
            ? Math.floor(w.duration_seconds/60) + ':' + (w.duration_seconds%60).toString().padStart(2,'0') + ' min'
            : w.weight + 'kg x ' + w.sets + ' x ' + w.reps;
        console.log('\t' + w.date + ' | ' + (w.exercise_name || 'Unbekannt') + ': ' + display);
    });
    
    // Volumen
    const volume = rows.reduce((sum, w) => {
        if (w.weight && w.sets && w.reps) {
            return sum + (w.weight * w.sets * w.reps);
        }
        return sum;
    }, 0);
    console.log('\\n💪 Gesamtvolumen: ' + volume.toLocaleString() + ' kg');
});

db.close();
