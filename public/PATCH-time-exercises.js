// PATCH: Zeitbasierte Übungen für IronCoach
// Diese Funktionen müssen zu app.js hinzugefügt/ersetzt werden

// 1. Ersetze selectExerciseForWorkout:
function selectExerciseForWorkout(exerciseId, exerciseName) {
    const exercise = exercises.find(e => e.id === exerciseId);
    
    document.getElementById('workout-exercise').value = exerciseId;
    document.getElementById('selected-exercise-display').textContent = exerciseName;
    document.getElementById('selected-exercise-display').style.color = '#00d4ff';
    
    // Formular-Felder je nach Übungstyp anpassen
    const isTimeBased = exercise && exercise.exercise_type === 'time';
    toggleWorkoutFields(isTimeBased);
    
    closeExerciseSelector();
}

// 2. Füge hinzu: Toggle zwischen Kraft- und Zeit-basierten Workout-Feldern
function toggleWorkoutFields(isTimeBased) {
    const strengthFields = document.getElementById('strength-fields');
    const timeFields = document.getElementById('time-fields');
    const weightInput = document.getElementById('workout-weight');
    const setsInput = document.getElementById('workout-sets');
    const repsInput = document.getElementById('workout-reps');
    const durationInput = document.getElementById('workout-duration');
    
    if (!strengthFields || !timeFields) return;
    
    if (isTimeBased) {
        strengthFields.style.display = 'none';
        timeFields.style.display = 'flex';
        if (weightInput) weightInput.removeAttribute('required');
        if (setsInput) setsInput.removeAttribute('required');
        if (repsInput) repsInput.removeAttribute('required');
        if (durationInput) durationInput.setAttribute('required', 'true');
    } else {
        strengthFields.style.display = 'flex';
        timeFields.style.display = 'none';
        if (weightInput) weightInput.setAttribute('required', 'true');
        if (setsInput) setsInput.setAttribute('required', 'true');
        if (repsInput) repsInput.setAttribute('required', 'true');
        if (durationInput) durationInput.removeAttribute('required');
    }
}

// 3. Füge hinzu: Parse duration string (e.g., "1:30" or "90") to seconds
function parseDuration(str) {
    if (!str) return null;
    str = str.trim();
    
    // Format: "1:30" -> 90 seconds
    if (str.includes(':')) {
        const parts = str.split(':');
        const minutes = parseInt(parts[0]) || 0;
        const seconds = parseInt(parts[1]) || 0;
        return minutes * 60 + seconds;
    }
    
    // Plain number -> assume seconds
    const seconds = parseInt(str);
    return isNaN(seconds) ? null : seconds;
}

// 4. In addWorkout(), ersetze den data-Block durch:
/*
    const exercise = exercises.find(e => e.id === parseInt(exerciseId));
    const isTimeBased = exercise && exercise.exercise_type === 'time';
    
    const data = {
        exercise_id: parseInt(exerciseId),
        rest_seconds: parseInt(document.getElementById('workout-rest').value) || 60,
        feeling: parseInt(document.getElementById('workout-feeling').value) || 5,
        date: document.getElementById('workout-date').value
    };
    
    // Je nach Übungstyp unterschiedliche Felder verwenden
    if (isTimeBased) {
        const durationStr = document.getElementById('workout-duration').value;
        const durationSeconds = parseDuration(durationStr);
        if (!durationSeconds) {
            alert('Bitte eine gültige Dauer eingeben (z.B. 1:30 oder 90)');
            return;
        }
        data.duration_seconds = durationSeconds;
        data.weight = null;
        data.sets = null;
        data.reps = null;
    } else {
        data.weight = parseFloat(document.getElementById('workout-weight').value);
        data.sets = parseInt(document.getElementById('workout-sets').value);
        data.reps = parseInt(document.getElementById('workout-reps').value);
        data.duration_seconds = null;
    }
*/

// 5. In editWorkout(), füge nach const workout = ... hinzu:
/*
    const exercise = exercises.find(e => e.id === workout.exercise_id);
    const isTimeBased = exercise?.exercise_type === 'time' || workout.duration_seconds;
    
    // Formular-Typ umschalten
    toggleWorkoutFields(isTimeBased);
    
    // Für Zeit-Übungen:
    if (isTimeBased) {
        const durationSec = workout.duration_seconds || 0;
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;
        const durationStr = mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}`;
        document.getElementById('workout-duration').value = durationStr;
    }
*/

// 6. In renderWorkoutsList(), ersetze den dateWorkouts.forEach Block durch:
/*
        dateWorkouts.forEach(w => {
            const isTimeBased = w.exercise_type === 'time' || (w.duration_seconds && !w.weight);
            
            let detailsText;
            let statsValue;
            let feelingEmoji = w.feeling >= 8 ? '🔥' : w.feeling >= 5 ? '👍' : '😤';
            
            if (isTimeBased) {
                // Zeit-basierte Übung
                const mins = Math.floor((w.duration_seconds || 0) / 60);
                const secs = (w.duration_seconds || 0) % 60;
                const durationStr = mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')} min` : `${secs} Sek`;
                detailsText = `${durationStr} | Ruhe: ${w.rest_seconds || '-'}s | Gefühl: ${w.feeling || '-'}/10`;
                statsValue = durationStr;
            } else {
                // Kraft-Übung
                const vol = (w.weight || 0) * (w.sets || 0) * (w.reps || 0);
                const volume = vol ? vol.toLocaleString() : '0';
                detailsText = `${w.weight || 0}kg × ${w.sets || 0} × ${w.reps || 0} | Ruhe: ${w.rest_seconds || '-'}s | Gefühl: ${w.feeling || '-'}/10 ${feelingEmoji}`;
                statsValue = `${volume} kg`;
            }
            
            html += `
            <div class="list-item workout-item" data-workout-id="${w.id}">
                <div class="list-item-info">
                    <h4>${w.exercise_name} <span style="color: #888; font-size: 0.85rem;">(${w.muscle_group})</span></h4>
                    <p>${detailsText}</p>
                </div>
                <div class="list-item-stats">
                    <div class="volume">${statsValue}</div>
                    <div class="workout-actions">
                        <button class="btn-edit" onclick="editWorkout(${w.id})" title="Bearbeiten">✏️</button>
                        <button class="btn-delete" onclick="deleteWorkout(${w.id})" title="Löschen">🗑️</button>
                    </div>
                </div>
            </div>`;
        });
*/
