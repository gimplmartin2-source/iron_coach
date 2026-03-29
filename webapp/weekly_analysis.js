const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./training.db', sqlite3.OPEN_READONLY);

const today = '2026-03-29';
const lastWeek = '2026-03-22';

console.log('📊 WÖCHENTLICHE TRAININGSANALYSE');
console.log('Zeitraum: ' + lastWeek + ' bis ' + today);
console.log('=================================\n');

db.all(`
    SELECT w.*, e.name as exercise_name, e.muscle_group, e.exercise_type
    FROM workouts w
    LEFT JOIN exercises e ON w.exercise_id = e.id
    WHERE w.date >= ? AND w.date <= ?
    ORDER BY w.date DESC, w.created_at DESC
`, [lastWeek, today], (err, rows) => {
    if (err) { 
        console.error('Fehler:', err); 
        db.close();
        return; 
    }
    
    console.log('📈 Anzahl Workouts: ' + rows.length);
    
    if (rows.length === 0) {
        console.log('\n⚠️ Keine Trainingsdaten für die letzte Woche gefunden.\n');
        console.log('📝 EMPFEHLUNGEN (basierend auf Ziele):');
        console.log('─'.repeat(50));
        console.log('Ziele aus ziele.json:');
        console.log('• Trainingsfrequenz: 4x pro Woche');
        console.log('• Bankdrücken: 80kg 5x5 (aktuell: 60kg)');
        console.log('• Kniebeugen: 100kg 5x5');
        console.log('• Körperfett: 15%');
        console.log('\n✅ Nächste Woche: Starte mit 4 Trainingseinheiten');
        console.log('   Tag 1: Brust + Trizeps');
        console.log('   Tag 2: Rücken + Bizeps');
        console.log('   Tag 3: Beine + Schultern');
        console.log('   Tag 4: Full Body (Kreuzheben, Bankdrücken)');
        db.close();
        return;
    }
    
    let totalVolume = 0;
    let strengthCount = 0;
    let cardioCount = 0;
    let muscleGroups = {};
    let dailyStats = {};
    let exerciseProgression = {};
    
    rows.forEach(w => {
        const isCardio = w.duration_seconds > 0 && (!w.weight || w.weight == 0);
        
        if (w.weight && w.sets && w.reps && !isCardio) {
            const vol = w.weight * w.sets * w.reps;
            totalVolume += vol;
            strengthCount++;
            
            if (!exerciseProgression[w.exercise_name]) {
                exerciseProgression[w.exercise_name] = [];
            }
            exerciseProgression[w.exercise_name].push({
                date: w.date, weight: w.weight, sets: w.sets, reps: w.reps, volume: vol
            });
        } else if (isCardio) {
            cardioCount++;
        }
        
        const mg = w.muscle_group || 'Unbekannt';
        if (!muscleGroups[mg]) muscleGroups[mg] = { count: 0, volume: 0 };
        muscleGroups[mg].count++;
        if (w.weight && w.sets && w.reps && !isCardio) {
            muscleGroups[mg].volume += (w.weight * w.sets * w.reps);
        }
        
        if (!dailyStats[w.date]) {
            dailyStats[w.date] = { count: 0, volume: 0, exercises: [] };
        }
        dailyStats[w.date].count++;
        if (w.weight && w.sets && w.reps && !isCardio) {
            dailyStats[w.date].volume += (w.weight * w.sets * w.reps);
        }
        dailyStats[w.date].exercises.push(w.exercise_name || 'Unbekannt');
    });
    
    console.log('💪 Kraft-Übungen: ' + strengthCount);
    console.log('⏱️  Cardio/Time-Übungen: ' + cardioCount);
    console.log('💪 Gesamtvolumen: ' + totalVolume.toLocaleString() + ' kg');
    
    console.log('\n📅 Tägliche Übersicht:');
    console.log('─'.repeat(50));
    Object.entries(dailyStats).sort().forEach(([date, stats]) => {
        console.log(date + ': ' + stats.count + ' Übungen, ' + stats.volume.toLocaleString() + ' kg');
    });
    
    console.log('\n🎯 Muskelgruppen-Analyse:');
    console.log('─'.repeat(50));
    Object.entries(muscleGroups).forEach(([mg, data]) => {
        console.log('  ' + mg + ': ' + data.count + ' Workouts, ' + data.volume.toLocaleString() + ' kg');
    });
    
    console.log('\n📈 Progression:');
    console.log('─'.repeat(50));
    const sortedExercises = Object.entries(exerciseProgression)
        .sort((a, b) => b[1].length - a[1].length);
    
    sortedExercises.forEach(([exercise, sessions]) => {
        if (sessions.length >= 2) {
            const first = sessions[sessions.length - 1];
            const last = sessions[0];
            const change = last.weight - first.weight;
            const sign = change >= 0 ? '+' : '';
            console.log(exercise + ': ' + sessions.length + 'x, ' + 
                first.weight + 'kg → ' + last.weight + 'kg (' + sign + change + 'kg)');
        } else {
            const avg = Math.round(sessions.reduce((s, w) => s + w.weight, 0) / sessions.length);
            console.log(exercise + ': ' + sessions.length + 'x, Ø ' + avg + 'kg');
        }
    });
    
    console.log('\n⚠️  Plateau-Analyse:');
    console.log('─'.repeat(50));
    let plateaus = [];
    Object.entries(exerciseProgression).forEach(([exercise, sessions]) => {
        if (sessions.length >= 2) {
            const recent = sessions.slice(0, 2);
            if (recent[0].weight === recent[1].weight) {
                plateaus.push({ exercise, weight: recent[0].weight, since: recent[1].date });
            }
        }
    });
    
    if (plateaus.length > 0) {
        plateaus.forEach(p => {
            console.log('🚨 ' + p.exercise + ': ' + p.weight + 'kg seit ' + p.since);
        });
    } else {
        console.log('✅ Keine Plateaus erkannt');
    }
    
    console.log('\n📝 EMPFEHLUNGEN FÜR NÄCHSTE WOCHE:');
    console.log('─'.repeat(50));
    
    const allMg = ['Brust', 'Ruecken', 'Beine', 'Schultern', 'Arme', 'Bauch'];
    const trainedMg = Object.keys(muscleGroups).filter(mg => muscleGroups[mg].count > 0);
    const missed = allMg.filter(mg => !trainedMg.includes(mg));
    
    if (missed.length > 0) {
        console.log('🎯 Fokus auf: ' + missed.join(', '));
    }
    
    if (plateaus.length > 0) {
        console.log('🔄 Plateau-Breaker für: ' + plateaus.map(p => p.exercise).join(', '));
        console.log('   → Deload oder Reps erhöhen vor Gewicht');
    }
    
    if (totalVolume > 0) {
        const target = Math.round(totalVolume * 1.05);
        console.log('💪 Volumen-Ziel: ' + target.toLocaleString() + ' kg (+5%)');
    }
    
    console.log('✅ Beibehalten: 4x Training/Woche');
    console.log('✅ Progressive Überlastung bei Grundübungen');
    
    db.close();
});
