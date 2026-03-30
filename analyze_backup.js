const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.env.USERPROFILE, '.openclaw', 'workspace', 'agents', 'ironcoach', 'martin_backup.db');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Fehler beim Öffnen:', err.message);
        return;
    }
    console.log('✅ Datenbank geöffnet:', dbPath);
});

// Workouts abrufen
db.all(`
    SELECT w.*, e.name as exercise_name, e.muscle_group, e.exercise_type
    FROM workouts w
    LEFT JOIN exercises e ON w.exercise_id = e.id
    ORDER BY w.date DESC, w.created_at DESC
`, [], (err, rows) => {
    if (err) {
        console.error('Fehler:', err);
        return;
    }
    
    console.log('\n📊 WORKOUTS ANALYSE');
    console.log('==================\n');
    
    // Zusammenfassung
    const totalWorkouts = rows.length;
    const timeBasedWorkouts = rows.filter(w => w.duration_seconds > 0 && (!w.weight || w.weight == 0)).length;
    const strengthWorkouts = rows.filter(w => w.weight && w.weight > 0).length;
    
    console.log(`Gesamt Workouts: ${totalWorkouts}`);
    console.log(`Zeit-Übungen: ${timeBasedWorkouts}`);
    console.log(`Kraft-Übungen: ${strengthWorkouts}`);
    console.log('');
    
    // Nach Muskelgruppen gruppieren
    const muscleGroups = {};
    rows.forEach(w => {
        const mg = w.muscle_group || 'Unbekannt';
        if (!muscleGroups[mg]) muscleGroups[mg] = [];
        muscleGroups[mg].push(w);
    });
    
    console.log('📋 Nach Muskelgruppen:');
    Object.entries(muscleGroups).forEach(([mg, workouts]) => {
        console.log(`  ${mg}: ${workouts.length} Workouts`);
    });
    console.log('');
    
    // Letzte 7 Tage
    console.log('📅 Letzte Workouts:');
    rows.slice(0, 10).forEach(w => {
        const isTime = w.duration_seconds > 0 && (!w.weight || w.weight == 0);
        const display = isTime 
            ? `${Math.floor(w.duration_seconds/60)}:${(w.duration_seconds%60).toString().padStart(2,'0')} min`
            : `${w.weight}kg × ${w.sets} × ${w.reps}`;
        console.log(`  ${w.date} - ${w.exercise_name}: ${display}`);
    });
    console.log('');
    
    // Statistiken
    console.log('📈 Statistiken:');
    const totalVolume = rows.reduce((sum, w) => {
        if (w.weight && w.sets && w.reps) {
            return sum + (w.weight * w.sets * w.reps);
        }
        return sum;
    }, 0);
    console.log(`  Gesamtvolumen: ${totalVolume.toLocaleString()} kg`);
    console.log(`  Ø Gewicht pro Workout: ${(totalVolume / strengthWorkouts || 0).toFixed(1)} kg`);
    
    db.close();
});
