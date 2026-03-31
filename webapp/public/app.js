const API_URL = '';

// Token aus URL lesen (nach Google OAuth Redirect)
const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get('token');
if (urlToken) {
    localStorage.setItem('token', urlToken);
    // URL bereinigen (token entfernen)
    window.history.replaceState({}, document.title, window.location.pathname);
}

// Auth Check
const token = localStorage.getItem('token');
if (!token && !window.location.pathname.includes('login')) {
    window.location.href = '/login.html';
}

// API Helper mit Auth Header
async function apiFetch(url, options = {}) {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}${url}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : '',
                ...options.headers
            }
        });
        
        // Bei 401 oder 403 ausloggen (ungültiger Token)
        if (res.status === 401 || res.status === 403) {
            console.log('🔒 Token ungültig, melde ab...');
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login.html';
            return;
        }
        
        return res;
    } catch (err) {
        console.error('❌ API Fehler:', err);
        throw err;
    }
}

// Init
let exercises = [];
let workouts = [];
let currentUser = null;
let progressChart = null;
let volumeChart = null;

// Hilfsfunktion: Finde passendes GIF für Übung (jetzt in gif-mappings.js definiert)
// getExerciseGif() ist in gif-mappings.js verfügbar

document.addEventListener('DOMContentLoaded', async () => {
    // User Info laden
    const userStr = localStorage.getItem('user');
    if (userStr) {
        currentUser = JSON.parse(userStr);
        showUserInfo();
    }
    
    // Verify Token
    try {
        const res = await apiFetch('/api/auth/verify');
        if (!res || !res.ok) throw new Error('Auth failed');
    } catch (err) {
        window.location.href = '/login.html';
        return;
    }
    
    // WICHTIG: Reihenfolge!
    // 1. Zuerst Restore (bringt bereinigte DB mit UNIQUE Constraint)
    // 2. DANN Sync (nur wenn Restore fehlgeschlagen UND keine Übungen da)
    
    // Restore VOR dem Laden der Daten (nur einmal pro Session)
    const restoreAttempted = sessionStorage.getItem('restoreAttempted');
    let restoreSuccessful = false;
    
    if (!restoreAttempted) {
        sessionStorage.setItem('restoreAttempted', 'true');
        const restoreResult = await restoreFromDrive();
        if (restoreResult) {
            console.log('✅ Restore erfolgreich - Sync wird übersprungen');
            restoreSuccessful = true;
            // Restore erfolgreich, Seite wird neu geladen
            return;
        }
    }
    
    // Nur Sync wenn kein Restore stattgefunden hat
    const isGoogleLogin = urlToken !== null;
    if (isGoogleLogin && !restoreSuccessful) {
        console.log('🔑 Google Login ohne Restore - synchronisiere Standard-Übungen...');
        try {
            const syncRes = await apiFetch('/api/exercises/sync', { method: 'POST' });
            if (syncRes.ok) {
                const syncData = await syncRes.json();
                console.log(`✅ Sync Ergebnis: ${syncData.message}`);
            }
        } catch (syncErr) {
            console.log('⚠️ Sync Fehler (nicht kritisch):', syncErr.message);
        }
    }
    
    // Normale Initialisierung
    await loadExercises();
    
    // Wenn keine Übungen vorhanden (z.B. komplett neuer User), Standardübungen erstellen
    if (exercises.length === 0) {
        console.log('📝 Keine Übungen gefunden, erstelle Standardübungen...');
        await apiFetch('/api/exercises/sync', { method: 'POST' });
        await new Promise(r => setTimeout(r, 500));
        await loadExercises();
    }
    
    loadWorkouts();
    loadStats();
    
    // Set today's date
    document.getElementById('workout-date').valueAsDate = new Date();
    
    // Form handlers
    document.getElementById('exercise-form').addEventListener('submit', addExercise);
    document.getElementById('workout-form').addEventListener('submit', addWorkout);
    
    // Plan-Checkboxes initialisieren
    initPlanCheckboxes();
    
    // Übungsbilder initialisieren
    initExerciseImages();
    
    // Thumbnails automatisch hinzufügen wo nötig
    autoAddExerciseThumbnails();
    
    // Logout Button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
    
    // GIFs vorladen für bessere Mobile-Performance
    console.log('📱 Preloading GIFs für Mobile...');
    preloadExerciseGifs();
});

function showUserInfo() {
    const userInfoDiv = document.getElementById('user-info');
    const userNameSpan = document.getElementById('user-name');
    if (currentUser && userInfoDiv) {
        userNameSpan.textContent = `👤 ${currentUser.displayName || currentUser.email}`;
        userInfoDiv.style.display = 'flex';
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('restoreAttempted'); // Reset für nächsten Login
    window.location.href = '/login.html';
}

// Tab switching
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(tabName + '-tab').classList.add('active');
    event.target.classList.add('active');
    
    if (tabName === 'stats') {
        loadProgressChart();
        loadVolumeChart();
    }
}

// Restore von Google Drive
async function restoreFromDrive() {
    const token = localStorage.getItem('token');
    if (!token) return false;
    
    console.log('🔍 Versuche Restore...');
    
    // Versuche automatisches Restore
    try {
        const res = await apiFetch('/api/restore', { 
            method: 'POST',
            body: JSON.stringify({})
        });
        
        if (res.ok) {
            const data = await res.json();
            if (data.success) {
                console.log('✅ Restore erfolgreich');
                window.location.reload();
                return true;
            }
        }
    } catch (err) {
        console.log('⚠️ Automatisches Restore fehlgeschlagen:', err.message);
    }
    
    // Frage nach manuellem Token
    console.log('🔑 Bitte Google Token eingeben...');
    const manualToken = prompt('Google Access Token eingeben (aus der Console/App):\\n\\nHinweis: Token bekommst du von:\\n1. Google OAuth Playground\\n2. Oder neu einloggen');
    
    if (!manualToken) {
        console.log('ℹ️ Kein Token eingegeben, überspringe Restore');
        return false;
    }
    
    // Versuche Restore mit manuellem Token
    try {
        const res = await apiFetch('/api/restore', { 
            method: 'POST',
            body: JSON.stringify({ googleToken: manualToken })
        });
        
        if (res.ok) {
            const data = await res.json();
            if (data.success) {
                console.log('✅ Restore mit manuellem Token erfolgreich');
                window.location.reload();
                return true;
            }
        }
    } catch (err) {
        console.error('❌ Restore mit manuellem Token fehlgeschlagen:', err);
        alert('Restore fehlgeschlagen: ' + err.message);
    }
    
    return false;
}

// Load exercises
async function loadExercises() {
    try {
        const res = await apiFetch('/api/exercises');
        if (!res) return;
        exercises = await res.json();
        updateExerciseSelects();
        renderExercisesList();
    } catch (err) {
        console.error('Fehler beim Laden der Übungen:', err);
    }
}

// Übungs-Selector Modal öffnen
let selectedExerciseForWorkout = null;

function openExerciseSelector() {
    const modal = document.createElement('div');
    modal.id = 'exercise-selector-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3000;
        animation: fadeIn 0.2s ease-out;
    `;
    
    // Nach Kategorie gruppieren
    const grouped = {};
    const judoKeywords = ['uchi', 'nage', 'randori', 'kata', 'judo', 'ne-waza', 'grip', 'turn-uchi', 'sprungs', 'wurf'];
    
    exercises.forEach(e => {
        const nameLower = e.name.toLowerCase();
        const isJudo = judoKeywords.some(keyword => nameLower.includes(keyword));
        
        let category = e.muscle_group;
        if (isJudo) category = '🥋 Judo';
        else if (e.muscle_group === 'Dehnen') category = '🧘 Dehnen';
        else if (e.muscle_group === 'Bauch' || e.muscle_group === 'Core' || 
                 nameLower.includes('plank') || nameLower.includes('bug') || 
                 nameLower.includes('bird') || nameLower.includes('bridge')) {
            category = '💪 Core';
        }
        
        if (!grouped[category]) {
            grouped[category] = [];
        }
        grouped[category].push(e);
    });
    
    // Sortiere Kategorien
    const categoryOrder = ['🥋 Judo', '💪 Core', '🧘 Dehnen', 'Brust', 'Rücken', 'Schultern', 'Beine', 'Arme', 'Bauch', 'Ganzkörper'];
    const sortedCategories = Object.keys(grouped).sort((a, b) => {
        const idxA = categoryOrder.indexOf(a);
        const idxB = categoryOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });
    
    // Sortiere Übungen innerhalb Kategorien
    sortedCategories.forEach(cat => {
        grouped[cat].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    });
    
    // Erstelle HTML für Kategorien und Übungen
    let categoriesHtml = '';
    let exercisesHtml = '';
    
    sortedCategories.forEach((cat, index) => {
        const isFirst = index === 0;
        categoriesHtml += `<button type="button" class="category-btn ${isFirst ? 'active' : ''}" data-category="${cat}" onclick="selectCategory('${cat}')" style="padding: 10px 20px; margin: 5px; background: ${isFirst ? 'linear-gradient(45deg, #00d4ff, #7b2cbf)' : 'rgba(255,255,255,0.1)'}; border: none; border-radius: 8px; color: #fff; cursor: pointer; transition: all 0.2s;">${cat}</button>`;
        
        const display = isFirst ? 'grid' : 'none';
        exercisesHtml += `<div class="exercise-grid" id="exercises-${cat}" style="display: ${display}; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 15px;">`;
        
        grouped[cat].forEach(e => {
            const gifPath = getExerciseGif(e.name);
            const gifHtml = gifPath ? `<img src="${gifPath}" alt="${e.name}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 6px; margin-bottom: 8px;" onerror="this.style.display='none'">` : '';
            exercisesHtml += `
                <button type="button" class="exercise-option" onclick="selectExerciseForWorkout(${e.id}, '${e.name.replace(/'/g, "\\'")}')" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff; cursor: pointer; transition: all 0.2s; text-align: left;"
                onmouseover="this.style.background='rgba(0,212,255,0.2)'; this.style.borderColor='#00d4ff';" 
                onmouseout="this.style.background='rgba(255,255,255,0.1)'; this.style.borderColor='rgba(255,255,255,0.2)';">
                    ${gifHtml}
                    <div style="font-weight: bold; margin-bottom: 5px; font-size: 0.9rem;">${e.name}</div>
                    <div style="font-size: 0.75rem; color: #888;">${e.muscle_group}</div>
                </button>`;
        });
        
        exercisesHtml += '</div>';
    });
    
    modal.innerHTML = `
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border: 1px solid rgba(0,212,255,0.3); border-radius: 16px; padding: 30px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="color: #00d4ff; margin: 0;">💪 Übung auswählen</h3>
                <button type="button" onclick="closeExerciseSelector()" style="background: rgba(255,100,100,0.2); border: 1px solid rgba(255,100,100,0.5); color: #f66; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1.2rem;">✕</button>
            </div>
            
            <div style="margin-bottom: 15px;">
                <span style="color: #888; font-size: 0.9rem;">Schritt 1: Kategorie wählen</span>
                <div style="margin-top: 10px; display: flex; flex-wrap: wrap;">
                    ${categoriesHtml}
                </div>
            </div>
            
            <div>
                <span style="color: #888; font-size: 0.9rem;">Schritt 2: Übung wählen</span>
                ${exercisesHtml}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function selectCategory(category) {
    // Update button styles
    document.querySelectorAll('.category-btn').forEach(btn => {
        if (btn.dataset.category === category) {
            btn.style.background = 'linear-gradient(45deg, #00d4ff, #7b2cbf)';
            btn.classList.add('active');
        } else {
            btn.style.background = 'rgba(255,255,255,0.1)';
            btn.classList.remove('active');
        }
    });
    
    // Show selected category exercises, hide others
    document.querySelectorAll('.exercise-grid').forEach(grid => {
        grid.style.display = 'none';
    });
    const selectedGrid = document.getElementById(`exercises-${category}`);
    if (selectedGrid) {
        selectedGrid.style.display = 'grid';
    }
}

function selectExerciseForWorkout(exerciseId, exerciseName) {
    console.log('🎯 Übung ausgewählt:', exerciseId, exerciseName);
    
    const exercise = exercises.find(e => e.id === parseInt(exerciseId));
    console.log('📋 Exercise Objekt:', exercise);
    console.log('⏱️ exercise_type:', exercise?.exercise_type);
    
    document.getElementById('workout-exercise').value = exerciseId;
    document.getElementById('selected-exercise-display').textContent = exerciseName;
    document.getElementById('selected-exercise-display').style.color = '#00d4ff';
    
    // Felder umschalten je nach Übungstyp
    // WICHTIG: Prüfe auch auf undefined/null - wenn kein Typ, prüfe den Namen
    let isTimeBased = false;
    if (exercise) {
        if (exercise.exercise_type === 'time') {
            isTimeBased = true;
            console.log('✅ exercise_type ist "time"');
        } else if (!exercise.exercise_type || exercise.exercise_type === 'strength') {
            // Kein Typ oder Kraft - prüfe Name auf Zeit-Keywords
            const timeKeywords = ['plank', 'haltung', 'atmung', 'dehn', 'stretch', 'hold', 'vacuum', 'kindhaltung', 'katze', 'knie', 'kreuz', 'hüft', 'kind', 'pose', 'stretch'];
            const nameLower = exercise.name.toLowerCase();
            isTimeBased = timeKeywords.some(kw => nameLower.includes(kw));
            if (isTimeBased) {
                console.log('🔍 Zeit-Übung erkannt per Keyword:', exercise.name);
            }
        }
    }
    
    console.log('🔄 isTimeBased:', isTimeBased);
    toggleWorkoutFields(isTimeBased);
    
    // Übungs-Vorschau mit GIF anzeigen
    showExercisePreview(exercise);
    
    closeExerciseSelector();
}

// Zeigt die �bungs-Vorschau mit Video an (zuverl�ssiger auf Mobile)
function showExercisePreview(exercise) {
    if (!exercise) return;
    
    const previewContainer = document.getElementById('exercise-preview');
    const videoEl = document.getElementById('preview-video');
    const imgFallback = document.getElementById('preview-gif-fallback');
    
    if (!previewContainer || !videoEl) return;
    
    const gifPath = getExerciseGif(exercise.name);
    if (!gifPath) {
        previewContainer.style.display = 'none';
        videoEl.style.display = 'none';
        if (imgFallback) imgFallback.style.display = 'none';
        return;
    }
    
    const freshPath = gifPath + '&t=' + Date.now();
    
    videoEl.src = freshPath;
    videoEl.style.display = 'block';
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.loop = true;
    videoEl.preload = 'auto';
    
    if (imgFallback) imgFallback.style.display = 'none';
    
    const playVideo = () => {
        videoEl.play().catch(err => {
            videoEl.style.display = 'none';
            if (imgFallback) {
                imgFallback.src = freshPath;
                imgFallback.style.display = 'block';
            }
        });
    };
    
    videoEl.onloadeddata = playVideo;
    videoEl.onerror = () => {
        videoEl.style.display = 'none';
        if (imgFallback) {
            imgFallback.src = freshPath;
            imgFallback.style.display = 'block';
        }
    };
    
    previewContainer.style.display = 'block';
}

function reloadGif() {
    const videoEl = document.getElementById('preview-video');
    if (videoEl && videoEl.src) {
        videoEl.currentTime = 0;
        videoEl.play();
    }
}
function closeExerciseSelector() {
    const modal = document.getElementById('exercise-selector-modal');
    if (modal) modal.remove();
}

// Update select dropdowns nach Kategorie gruppiert (Judo + Muskelgruppen)
function updateExerciseSelects() {
    const workoutSelect = document.getElementById('workout-exercise');
    const statsSelect = document.getElementById('stats-exercise');
    const singleSelect = document.getElementById('single-exercise-select');
    
    // Judo-Übungen erkennen (nach Namen)
    const judoKeywords = ['uchi', 'nage', 'randori', 'kata', 'judo', 'ne-waza', 'grip', 'turn-uchi', 'sprungs', 'wurf'];
    const judoExercises = [];
    const otherExercises = [];
    
    exercises.forEach(e => {
        const nameLower = e.name.toLowerCase();
        const isJudo = judoKeywords.some(keyword => nameLower.includes(keyword));
        if (isJudo) {
            judoExercises.push(e);
        } else {
            otherExercises.push(e);
        }
    });
    
    // Nach Muskelgruppe gruppieren (nur nicht-Judo)
    const grouped = {};
    otherExercises.forEach(e => {
        if (!grouped[e.muscle_group]) {
            grouped[e.muscle_group] = [];
        }
        grouped[e.muscle_group].push(e);
    });
    
    // Sortierreihenfolge der Muskelgruppen
    const muscleOrder = ['Brust', 'Rücken', 'Schultern', 'Beine', 'Arme', 'Bauch', 'Ganzkörper'];
    const sortedMuscles = Object.keys(grouped).sort((a, b) => {
        const idxA = muscleOrder.indexOf(a);
        const idxB = muscleOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });
    
    // Innerhalb jeder Gruppe nach Name sortieren
    sortedMuscles.forEach(muscle => {
        grouped[muscle].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    });
    judoExercises.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    
    // Optgroups erstellen - zuerst Judo, dann Muskelgruppen
    let options = '';
    
    // Judo-Kategorie zuerst
    if (judoExercises.length > 0) {
        options += `<optgroup label="🥋 Judo">`;
        judoExercises.forEach(e => {
            options += `<option value="${e.id}">${e.name}</option>`;
        });
        options += '</optgroup>';
    }
    
    // Dann Muskelgruppen
    sortedMuscles.forEach(muscle => {
        options += `<optgroup label="${muscle}">`;
        grouped[muscle].forEach(e => {
            options += `<option value="${e.id}">${e.name}</option>`;
        });
        options += '</optgroup>';
    });
    
    if (workoutSelect) {
        workoutSelect.innerHTML = '<option value="">-- Wähle Übung --</option>' + options;
    }
    if (statsSelect) {
        statsSelect.innerHTML = '<option value="">-- Wähle Übung --</option>' + options;
    }
    if (singleSelect) {
        singleSelect.innerHTML = '<option value="">-- Optional: Einzelne Übung --</option>' + options;
    }
}

// Add exercise
async function addExercise(e) {
    e.preventDefault();
    
    const name = document.getElementById('exercise-name').value;
    const muscle = document.getElementById('exercise-muscle').value;
    const type = document.getElementById('exercise-type')?.value || 'strength';
    
    if (!name || !muscle) {
        alert('Bitte Name und Muskelgruppe auswählen');
        return;
    }
    
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = '⏳ Speichern...';
    btn.disabled = true;
    
    try {
        const res = await apiFetch('/api/exercises', {
            method: 'POST',
            body: JSON.stringify({ name, muscle_group: muscle, exercise_type: type })
        });
        
        if (res && res.ok) {
            document.getElementById('exercise-form').reset();
            loadExercises();
            loadStats();
            autoBackup(); // HINZUGEFÜGT: Backup nach Speichern
        } else {
            const data = await res.json().catch(() => ({}));
            alert('Fehler: ' + (data.error || 'Konnte Übung nicht speichern'));
        }
    } catch (err) {
        console.error('❌ Fehler:', err);
        alert('Fehler: ' + err.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// Auto-Backup nach Änderungen
async function autoBackup() {
    // Prüfe ob Google-User (hat Google Access Token im JWT)
    const token = localStorage.getItem('token');
    if (!token) return;
    
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (!payload.googleAccessToken) return; // Nur für Google-User
        
        // Silent backup
        await apiFetch('/api/backup/drive', { method: 'POST' });
        console.log('☁️ Auto-Backup erledigt');
    } catch (err) {
        console.log('ℹ️ Auto-Backup übersprungen:', err.message);
    }
}
async function deleteExercise(id) {
    if (!confirm('Übung wirklich löschen?')) return;
    
    try {
        await apiFetch(`/api/exercises/${id}`, { method: 'DELETE' });
        loadExercises();
        loadWorkouts();
        loadStats();
        autoBackup(); // Auto-Backup
    } catch (err) {
        console.error('Fehler beim Löschen:', err);
    }
}

// Übung bearbeiten - Öffnet Modal
let editingExerciseId = null;

function editExerciseForm(exerciseId) {
    const exercise = exercises.find(e => e.id === exerciseId);
    if (!exercise) return;
    
    editingExerciseId = exerciseId;
    
    // Modal erstellen
    const modal = document.createElement('div');
    modal.id = 'edit-exercise-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
    `;
    
    const typeOptions = `
        <option value="strength" ${exercise.exercise_type === 'strength' ? 'selected' : ''}>💪 Kraft (Sätze/Wdh)</option>
        <option value="time" ${exercise.exercise_type === 'time' ? 'selected' : ''}>⏱️ Zeit (Dauer)</option>
    `;
    
    modal.innerHTML = `
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border: 1px solid rgba(0,212,255,0.3); border-radius: 16px; padding: 24px; width: 90%; max-width: 400px;">
            <h3 style="color: #00d4ff; margin-bottom: 20px; text-align: center;">✏️ Übung bearbeiten</h3>
            
            <div style="margin-bottom: 15px;">
                <label style="color: #888; display: block; margin-bottom: 5px;">Name</label>
                <input type="text" id="edit-exercise-name" value="${exercise.name}" 
                    style="width: 100%; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff;">
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="color: #888; display: block; margin-bottom: 5px;">Muskelgruppe</label>
                <select id="edit-exercise-muscle" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff;">
                    <option value="Judo" ${exercise.muscle_group === 'Judo' ? 'selected' : ''}>🥋 Judo</option>
                    <option value="Brust" ${exercise.muscle_group === 'Brust' ? 'selected' : ''}>Brust</option>
                    <option value="Rücken" ${exercise.muscle_group === 'Rücken' ? 'selected' : ''}>Rücken</option>
                    <option value="Schultern" ${exercise.muscle_group === 'Schultern' ? 'selected' : ''}>Schultern</option>
                    <option value="Beine" ${exercise.muscle_group === 'Beine' ? 'selected' : ''}>Beine</option>
                    <option value="Arme" ${exercise.muscle_group === 'Arme' ? 'selected' : ''}>Arme</option>
                    <option value="Bauch" ${exercise.muscle_group === 'Bauch' ? 'selected' : ''}>Bauch</option>
                    <option value="Ganzkörper" ${exercise.muscle_group === 'Ganzkörper' ? 'selected' : ''}>Ganzkörper</option>
                    <option value="Dehnen" ${exercise.muscle_group === 'Dehnen' ? 'selected' : ''}>Dehnen</option>
                    <option value="Mobilität" ${exercise.muscle_group === 'Mobilität' ? 'selected' : ''}>Mobilität</option>
                </select>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="color: #888; display: block; margin-bottom: 5px;">Typ</label>
                <select id="edit-exercise-type" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff;">
                    ${typeOptions}
                </select>
            </div>
            
            <div style="display: flex; gap: 10px;">
                <button onclick="closeEditModal()" style="flex: 1; padding: 12px; background: rgba(255,100,100,0.2); border: 1px solid rgba(255,100,100,0.5); border-radius: 8px; color: #f66; cursor: pointer;">❌ Abbrechen</button>
                <button onclick="saveExerciseEdit()" style="flex: 1; padding: 12px; background: linear-gradient(45deg, #00d4ff, #7b2cbf); border: none; border-radius: 8px; color: #fff; cursor: pointer; font-weight: bold;">💾 Speichern</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function closeEditModal() {
    const modal = document.getElementById('edit-exercise-modal');
    if (modal) {
        modal.remove();
        editingExerciseId = null;
    }
}

async function saveExerciseEdit() {
    if (!editingExerciseId) return;
    
    const name = document.getElementById('edit-exercise-name').value;
    const muscle_group = document.getElementById('edit-exercise-muscle').value;
    const exercise_type = document.getElementById('edit-exercise-type').value;
    
    if (!name || !muscle_group) {
        alert('Bitte Name und Muskelgruppe ausfüllen');
        return;
    }
    
    try {
        const res = await apiFetch(`/api/exercises/${editingExerciseId}`, {
            method: 'PUT',
            body: JSON.stringify({ name, muscle_group, exercise_type })
        });
        
        if (res && res.ok) {
            closeEditModal();
            await loadExercises();
            await autoBackup();
            alert('✅ Übung aktualisiert!');
        } else {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Konnte nicht speichern'));
        }
    } catch (err) {
        console.error('❌ Fehler beim Speichern:', err);
        alert('Fehler beim Speichern');
    }
}

// Render exercises list
function renderExercisesList() {
    const container = document.getElementById('exercises-list');
    
    if (exercises.length === 0) {
        container.innerHTML = '<p class="empty-state">Noch keine Übungen vorhanden.</p>';
        return;
    }
    
    // Gruppiere nach Muskelgruppe
    const grouped = {};
    exercises.forEach(e => {
        if (!grouped[e.muscle_group]) {
            grouped[e.muscle_group] = [];
        }
        grouped[e.muscle_group].push(e);
    });
    
    let html = '';
    Object.entries(grouped).forEach(([muscleGroup, exerciseList]) => {
        html += `<div style="margin-bottom: 20px;"></h3>${muscleGroup}</h3></div>`;
        html += exerciseList.map(e => {
            const typeIcon = e.exercise_type === 'time' ? '⏱️' : '💪';
            const gifPath = getExerciseGif(e.name);
            const gifHtml = gifPath ? `<img src="${gifPath}" alt="${e.name}" style="width: 80px; height: 60px; object-fit: cover; border-radius: 8px; margin-right: 12px; cursor: pointer;" onclick="showGifModal('${gifPath}', '${e.name}')" title="Klicken zum Vergrößern">` : '';
            return `
            <div class="list-item" style="margin-bottom: 10px; display: flex; align-items: center;">
                ${gifHtml}
                <div class="list-item-info" style="flex: 1;">
                    <h4>${e.name} <span style="color: #666; font-size: 0.8rem;">${typeIcon}</span></h4>
                    <p style="color: #888; font-size: 0.85rem;">${e.muscle_group}</p>
                </div>
                <div class="workout-actions" style="display: flex; gap: 8px;">
                    <button class="btn-edit" onclick="editExerciseForm(${e.id})" title="Bearbeiten">✏️</button>
                    <button class="btn-delete" onclick="deleteExercise(${e.id})" title="Löschen">🗑️</button>
                </div>
            </div>`;
        }).join('');
    });
    
    container.innerHTML = html;
}

// Modal für GIF Anzeige
function showGifModal(gifPath, exerciseName) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        cursor: pointer;
    `;
    modal.innerHTML = `
        <div style="text-align: center;" onclick="event.stopPropagation()">
            <h3 style="color: #00d4ff; margin-bottom: 20px;">${exerciseName}</h3>
            <img src="${gifPath}" style="max-width: 90vw; max-height: 70vh; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
            <p style="color: #888; margin-top: 20px; font-size: 0.9rem;">Klicke außerhalb zum Schließen</p>
        </div>
    `;
    modal.onclick = () => modal.remove();
    document.body.appendChild(modal);
}

// Load workouts
async function loadWorkouts() {
    try {
        const res = await apiFetch('/api/workouts');
        if (!res) return;
        workouts = await res.json();
        
        // WICHTIG: Sicherstellen dass exercises geladen sind
        if (exercises.length === 0) {
            console.log('🔄 Exercises noch nicht geladen, lade jetzt...');
            await loadExercises();
        }
        
        // Exercise-Type zu jedem Workout hinzufügen
        // WICHTIG: Überschreibe exercise_type nur wenn nicht vom Backend gesetzt
        workouts.forEach(w => {
            const exercise = exercises.find(e => e.id === w.exercise_id);
            if (exercise) {
                // Nur überschreiben wenn Backend es nicht erkannt hat UND Übung explizit 'time' ist
                if (!w.exercise_type || w.exercise_type === 'strength') {
                    if (exercise.exercise_type === 'time') {
                        w.exercise_type = 'time';
                        console.log('⏱️ Zeit-Übung erkannt für:', w.exercise_name);
                    }
                }
                w.muscle_group = exercise.muscle_group;
            } else {
                console.log('⚠️ Keine Übung gefunden für workout:', w.id, 'exercise_id:', w.exercise_id);
            }
        });
        
        renderWorkoutsList();
    } catch (err) {
        console.error('Fehler beim Laden der Workouts:', err);
    }
}

// Hilfsfunktion: Dauer-String zu Sekunden parsen
// Unterstützt: SS (Sekunden), MM:SS, HH:MM:SS
function parseDuration(str) {
    if (!str) return 0;
    
    // Trim whitespace
    str = str.trim();
    
    // Einfache Sekunden (nur Zahl, z.B. "90" -> 90 Sek)
    if (/^\d+$/.test(str)) {
        return parseInt(str);
    }
    
    // Format HH:MM:SS (z.B. "01:30:45")
    const hmsMatch = str.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (hmsMatch) {
        const hours = parseInt(hmsMatch[1]);
        const mins = parseInt(hmsMatch[2]);
        const secs = parseInt(hmsMatch[3]);
        if (mins >= 0 && mins <= 59 && secs >= 0 && secs <= 59) {
            return hours * 3600 + mins * 60 + secs;
        }
    }
    
    // Format MM:SS oder M:SS (z.B. "01:30" oder "1:30")
    const msMatch = str.match(/^(\d{1,2}):(\d{2})$/);
    if (msMatch) {
        const mins = parseInt(msMatch[1]);
        const secs = parseInt(msMatch[2]);
        if (secs >= 0 && secs <= 59) {
            return mins * 60 + secs;
        }
    }
    
    // Fallback: Versuche als Zahl zu parsen
    const num = parseFloat(str);
    return isNaN(num) ? 0 : Math.floor(num);
}

// Toggle zwischen Kraft- und Zeit-basierten Workout-Feldern
function toggleWorkoutFields(isTimeBased) {
    console.log('🔄 toggleWorkoutFields:', isTimeBased);
    
    const strengthFields = document.getElementById('strength-fields');
    const timeFields = document.getElementById('time-fields');
    const timeSetsGroup = document.getElementById('time-sets-group');
    
    console.log('📍 strengthFields:', !!strengthFields, '| timeFields:', !!timeFields, '| timeSetsGroup:', !!timeSetsGroup);
    
    if (!strengthFields || !timeFields) {
        console.log('❌ Felder nicht gefunden!');
        return;
    }
    
    if (isTimeBased) {
        console.log('⏱️ Zeige Zeit-Felder');
        strengthFields.style.display = 'none';
        timeFields.style.display = 'flex'; // Für einzelnes Feld
        if (timeSetsGroup) timeSetsGroup.style.display = 'block';
    } else {
        console.log('💪 Zeige Kraft-Felder');
        strengthFields.style.display = 'grid';
        timeFields.style.display = 'none';
        if (timeSetsGroup) timeSetsGroup.style.display = 'none';
    }
}

// Add workout
async function addWorkout(e) {
    e.preventDefault();
    
    const exerciseId = document.getElementById('workout-exercise').value;
    if (!exerciseId) {
        alert('Bitte eine Übung auswählen');
        return;
    }
    
    // Prüfe ob Zeit-basierte Übung
    const exercise = exercises.find(e => e.id === parseInt(exerciseId));
    const isTimeBased = exercise && exercise.exercise_type === 'time';
    
    const data = {
        exercise_id: parseInt(exerciseId),
        rest_seconds: parseInt(document.getElementById('workout-rest').value) || 60,
        feeling: parseInt(document.getElementById('workout-feeling').value) || 5,
        date: document.getElementById('workout-date').value || new Date().toISOString().split('T')[0]
    };
    
    if (isTimeBased) {
        // Zeit-basierte Übung - Dauer parsen
        const durationStr = document.getElementById('workout-duration').value;
        const durationSec = parseDuration(durationStr);
        data.duration_seconds = durationSec;
        
        // Optionale Sätze für Zeit-Übungen (z.B. 3 Sätze à 60 Sek)
        const setsTime = document.getElementById('workout-sets-time')?.value;
        data.sets = setsTime ? parseInt(setsTime) : 0;
        
        // Wenn Zeit-Übung, nimm Datum aus workout-date-time oder workout-date
        const dateTimeField = document.getElementById('workout-date-time');
        if (dateTimeField && dateTimeField.value) {
            data.date = dateTimeField.value;
        }
        
        // Bei Zeit-Übungen weight/reps auf 0 setzen
        data.weight = 0;
        data.reps = 0;
    } else {
        // Kraft-Übung
        data.weight = parseFloat(document.getElementById('workout-weight').value) || 0;
        data.sets = parseInt(document.getElementById('workout-sets').value) || 0;
        data.reps = parseInt(document.getElementById('workout-reps').value) || 0;
    }
    
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = editingWorkoutId ? '⏳ Aktualisieren...' : '⏳ Speichern...';
    btn.disabled = true;
    
    try {
        let res;
        
        if (editingWorkoutId) {
            // Update bestehendes Workout
            res = await apiFetch(`/api/workouts/${editingWorkoutId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            // Neues Workout erstellen
            res = await apiFetch('/api/workouts', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }
        
        if (res && res.ok) {
            document.getElementById('workout-form').reset();
            document.getElementById('workout-date').valueAsDate = new Date();
            
            if (editingWorkoutId) {
                cancelEdit();
                alert('✅ Workout aktualisiert!');
            } else {
                alert('✅ Workout gespeichert!');
            }
            
            loadWorkouts();
            loadStats();
            autoBackup();
        } else {
            const errorData = await res.json().catch(() => ({}));
            alert('Fehler: ' + (errorData.error || 'Konnte nicht speichern'));
        }
    } catch (err) {
        console.error('❌ Fehler:', err);
        alert('Fehler: ' + err.message);
    } finally {
        btn.textContent = editingWorkoutId ? '💾 Aktualisieren' : originalText;
        btn.disabled = false;
    }
}

// Edit workout - öffnet das Formular zum Bearbeiten
let editingWorkoutId = null;

function editWorkout(id) {
    const workout = workouts.find(w => w.id === id);
    if (!workout) return;
    
    editingWorkoutId = id;
    
    // Prüfe ob Zeit-basierte Übung (ROBUST für alte und neue Workouts)
    const exercise = exercises.find(e => e.id === workout.exercise_id);
    const duration = parseInt(workout.duration_seconds) || 0;
    const weight = parseFloat(workout.weight) || 0;
    const sets = parseInt(workout.sets) || 0;
    const reps = parseInt(workout.reps) || 0;
    
    // Neues Format: duration_seconds > 0 oder exercise_type === 'time'
    // Altes Format: sets=1, weight=0, reps=Zeit in Sekunden
    const isTimeBased = (exercise && exercise.exercise_type === 'time') || 
                       (duration > 0 && weight === 0) ||
                       (duration === 0 && weight === 0 && sets === 1 && reps > 0);
    
    // Nutze duration_seconds wenn verfügbar, sonst reps (altes Format)
    const effectiveDuration = duration > 0 ? duration : (isTimeBased && reps > 0 ? reps : 0);
    
    // Felder umschalten
    toggleWorkoutFields(isTimeBased);
    
    // Formular mit Daten füllen
    document.getElementById('workout-exercise').value = workout.exercise_id;
    document.getElementById('workout-date').value = workout.date;
    document.getElementById('workout-rest').value = workout.rest_seconds || '';
    document.getElementById('workout-feeling').value = workout.feeling || '';
    
    if (isTimeBased) {
        // Zeit-basierte Übung: Dauer in Min:Sek Format
        const durationSec = effectiveDuration;
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;
        const durationStr = mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}`;
        document.getElementById('workout-duration').value = durationStr;
        // Kraft-Felder leeren
        document.getElementById('workout-weight').value = '';
        document.getElementById('workout-sets').value = '';
        document.getElementById('workout-reps').value = '';
    } else {
        // Kraft-Übung
        document.getElementById('workout-weight').value = workout.weight || '';
        document.getElementById('workout-sets').value = workout.sets || '';
        document.getElementById('workout-reps').value = workout.reps || '';
        document.getElementById('workout-duration').value = '';
    }
    
    // Button-Text ändern
    const submitBtn = document.querySelector('#workout-form button[type="submit"]');
    submitBtn.textContent = '💾 Aktualisieren';
    submitBtn.dataset.mode = 'edit';
    
    // Cancel Button hinzufügen
    if (!document.getElementById('cancel-edit-btn')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.id = 'cancel-edit-btn';
        cancelBtn.className = 'btn-secondary';
        cancelBtn.style.cssText = 'margin-left: 10px; padding: 12px 20px; background: rgba(255,100,100,0.2); border: 1px solid rgba(255,100,100,0.5); color: #f66; border-radius: 8px; cursor: pointer;';
        cancelBtn.textContent = '❌ Abbrechen';
        cancelBtn.onclick = cancelEdit;
        submitBtn.after(cancelBtn);
    }
    
    // Zur Workouts-Sektion scrollen
    document.getElementById('workouts-tab').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
    editingWorkoutId = null;
    document.getElementById('workout-form').reset();
    document.getElementById('workout-date').valueAsDate = new Date();
    
    // Felder zurück auf Kraft-Modus
    toggleWorkoutFields(false);
    
    const submitBtn = document.querySelector('#workout-form button[type="submit"]');
    submitBtn.textContent = '💾 Speichern';
    submitBtn.dataset.mode = 'create';
    
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.remove();
}

// Gruppierte Workouts nach Datum
function groupWorkoutsByDate() {
    const grouped = {};
    workouts.forEach(w => {
        if (!grouped[w.date]) {
            grouped[w.date] = [];
        }
        grouped[w.date].push(w);
    });
    return grouped;
}

// Render workouts list mit Gruppierung und Bearbeiten
function renderWorkoutsList() {
    const container = document.getElementById('workouts-list');
    
    if (!container) {
        console.error('❌ Container #workouts-list nicht gefunden');
        return;
    }
    
    // SICHERHEIT: Prüfe ob workouts ein Array ist
    if (!Array.isArray(workouts)) {
        console.error('❌ workouts ist kein Array:', workouts);
        container.innerHTML = '<p class="empty-state">Fehler beim Laden der Workouts.</p>';
        return;
    }
    
    if (workouts.length === 0) {
        container.innerHTML = '<p class="empty-state">Noch keine Workouts eingetragen.</p>';
        return;
    }
    
    // Nach Datum sortieren (neueste zuerst)
    const grouped = groupWorkoutsByDate();
    const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));
    
    let html = '';
    
    sortedDates.forEach(date => {
        const dateWorkouts = grouped[date];
        const totalVolume = dateWorkouts.reduce((sum, w) => sum + ((w.weight || 0) * (w.sets || 0) * (w.reps || 0)), 0);
        const dateObj = new Date(date);
        const dateStr = dateObj.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
        
        // Prüfe ob Trainingssession (mehrere Übungen am selben Tag)
        const isSession = dateWorkouts.length > 1;
        const sessionType = isSession ? detectSessionType(dateWorkouts) : '';
        
        html += `
        <div class="workout-date-group">
            <div class="date-header" onclick="toggleDateGroup('${date}')">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: bold; font-size: 1.1rem;">${dateStr}${sessionType ? ` - ${sessionType}` : ''}</span>
                    <span style="color: #00d4ff;">${dateWorkouts.length} Workouts | ${formatWeight(totalVolume)}</span>
                </div>
                <span class="toggle-icon" id="toggle-${date}">▶</span>
            </div>
            <div class="workouts-in-date" id="workouts-${date}" style="display: none;">`;
        
        dateWorkouts.forEach(w => {
            // Prüfe ob Zeit-basierte Übung (ROBUST für alte und neue Workouts)
            const duration = parseInt(w.duration_seconds) || 0;
            const weight = parseFloat(w.weight) || 0;
            const sets = parseInt(w.sets) || 0;
            const reps = parseInt(w.reps) || 0;
            
            // Neues Format: duration_seconds > 0
            // Altes Format: sets=1, weight=0, reps=Zeit in Sekunden
            // Oder: exercise_type explizit auf 'time'
            // WICHTIG: Auch sets=0/null erlauben (neue Zeit-Workouts haben sets=null)
            const isTimeBased = (w.exercise_type === 'time') || 
                               (duration > 0 && weight === 0) ||
                               (duration === 0 && weight === 0 && sets <= 1 && reps > 0);
            
            // Nutze duration_seconds wenn verfügbar, sonst reps (altes Format)
            const effectiveDuration = duration > 0 ? duration : (isTimeBased && reps > 0 ? reps : 0);
            
            console.log('Workout:', w.exercise_name, 'type:', w.exercise_type, 'duration:', duration, 'weight:', weight, 'isTime:', isTimeBased, 'effectiveDuration:', effectiveDuration);
            
            let detailsText, statsValue;
            const feelingEmoji = w.feeling >= 8 ? '🔥' : w.feeling >= 5 ? '👍' : '😤';
            
            if (isTimeBased) {
                // Zeit-basierte Übung
                const mins = Math.floor(effectiveDuration / 60);
                const secs = effectiveDuration % 60;
                const durationStr = mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')} min` : `${secs} Sek`;
                detailsText = `${durationStr} | Ruhe: ${w.rest_seconds || '-'}s`;
                if (w.feeling) detailsText += ` | Gefühl: ${w.feeling}/10`;
                statsValue = durationStr;
            } else {
                // Kraft-Übung
                const volume = weight * sets * reps;
                detailsText = `${weight}kg × ${sets} × ${reps}`;
                if (w.rest_seconds) detailsText += ` | Ruhe: ${w.rest_seconds}s`;
                if (w.feeling) detailsText += ` | Gefühl: ${w.feeling}/10 ${feelingEmoji}`;
                statsValue = volume > 0 ? `${volume.toLocaleString()} kg` : '-';
            }
            
            html += `
            <div class="list-item workout-item" data-workout-id="${w.id}">
                <div class="list-item-info">
                    <h4>${w.exercise_name || 'Unbekannte Übung'} <span style="color: #888; font-size: 0.85rem;">(${w.muscle_group || '-'})</span></h4>
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
        
        html += `
            </div>
        </div>`;
    });
    
    container.innerHTML = html;
}

// Session Typ erkennen (Judo, Gym, etc.)
function detectSessionType(dateWorkouts) {
    const names = dateWorkouts.map(w => (w.exercise_name || '').toLowerCase());
    const muscleGroups = [...new Set(dateWorkouts.map(w => w.muscle_group).filter(Boolean))];
    
    // Judo-Training erkennen
    if (names.some(n => n.includes('judo') || n.includes('wurf') || n.includes('technik'))) {
        return '🥋 Judo Training';
    }
    
    // Core/Dehnung erkennen
    if (muscleGroups.includes('Bauch') && dateWorkouts.length <= 3) {
        return '💪 Core / Dehnen';
    }
    
    // Ganzkörper
    if (muscleGroups.length >= 3) {
        return '🏋️ Ganzkörper';
    }
    
    // Oberkörper
    if (muscleGroups.some(g => ['Brust', 'Rücken', 'Schultern', 'Arme'].includes(g))) {
        return '💪 Oberkörper';
    }
    
    // Unterkörper
    if (muscleGroups.includes('Beine')) {
        return '🦵 Unterkörper';
    }
    
    return '';
}

// Datum-Gruppe ein-/ausklappen
function toggleDateGroup(date) {
    const container = document.getElementById(`workouts-${date}`);
    const icon = document.getElementById(`toggle-${date}`);
    
    if (container.style.display === 'none') {
        container.style.display = 'block';
        icon.textContent = '▼';
    } else {
        container.style.display = 'none';
        icon.textContent = '▶';
    }
}

// Delete workout
async function deleteWorkout(id) {
    if (!confirm('Workout wirklich löschen?')) return;
    
    try {
        await apiFetch(`/api/workouts/${id}`, { method: 'DELETE' });
        if (editingWorkoutId === id) cancelEdit();
        loadWorkouts();
        loadStats();
        autoBackup();
    } catch (err) {
        console.error('❌ Fehler beim Löschen:', err);
    }
}

// Load stats
async function loadStats() {
    try {
        const res = await apiFetch('/api/stats');
        if (!res) return;
        const stats = await res.json();
        
        document.getElementById('total-volume').textContent = (stats.total_volume || 0).toLocaleString() + ' kg';
        document.getElementById('total-workouts').textContent = stats.total_workouts || 0;
        document.getElementById('total-exercises').textContent = stats.total_exercises || 0;
        document.getElementById('weekly-volume').textContent = (stats.weekly_volume || 0).toLocaleString() + ' kg';
    } catch (err) {
        console.error('Fehler beim Laden der Stats:', err);
    }
}

// Load progress chart
async function loadProgressChart() {
    const exerciseId = document.getElementById('stats-exercise').value;
    if (!exerciseId) return;
    
    try {
        const res = await apiFetch(`/api/progress/${exerciseId}`);
        if (!res) return;
        const data = await res.json();
        
        if (data.length === 0) {
            if (progressChart) progressChart.destroy();
            return;
        }
        
        const labels = data.map(d => formatDate(d.date));
        const weights = data.map(d => d.weight);
        const volumes = data.map(d => d.volume);
        
        const ctx = document.getElementById('progress-chart').getContext('2d');
        
        if (progressChart) progressChart.destroy();
        
        progressChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Gewicht (kg)',
                    data: weights,
                    borderColor: '#00d4ff',
                    backgroundColor: 'rgba(0,212,255,0.1)',
                    tension: 0.3,
                    fill: true
                }, {
                    label: 'Volumen',
                    data: volumes,
                    borderColor: '#7b2cbf',
                    backgroundColor: 'rgba(123,44,191,0.1)',
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#888' } },
                    y1: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { color: '#888' } },
                    x: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#888' } }
                },
                plugins: {
                    legend: { labels: { color: '#fff' } }
                }
            }
        });
    } catch (err) {
        console.error('Fehler beim Laden des Charts:', err);
    }
}

// Load volume chart
async function loadVolumeChart() {
    if (workouts.length === 0) return;
    
    const volumeByDate = {};
    workouts.forEach(w => {
        if (!volumeByDate[w.date]) volumeByDate[w.date] = 0;
        volumeByDate[w.date] += w.weight * w.sets * w.reps;
    });
    
    const sortedDates = Object.keys(volumeByDate).sort();
    const volumes = sortedDates.map(d => volumeByDate[d]);
    
    const ctx = document.getElementById('volume-chart').getContext('2d');
    
    if (volumeChart) volumeChart.destroy();
    
    volumeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedDates.map(formatDate),
            datasets: [{
                label: 'Tagesvolumen (kg)',
                data: volumes,
                backgroundColor: 'rgba(0,212,255,0.6)',
                borderColor: '#00d4ff',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#888' } },
                x: { grid: { display: false }, ticks: { color: '#888' } }
            },
            plugins: {
                legend: { labels: { color: '#fff' } }
            }
        }
    });
}

// ===================== INTERAKTIVER TRAININGSPLAN =====================

// Init checkbox handlers
function initPlanCheckboxes() {
    // Plan-übergreifend: Checkbox-Überwachung
    document.addEventListener('change', async (e) => {
        if (e.target.classList.contains('plan-check')) {
            const checkbox = e.target;
            
            // Finde übergeordnetes Element (li oder tr)
            const exerciseRow = checkbox.closest('.plan-exercise') || checkbox.closest('.plan-exercise-row');
            
            if (checkbox.checked) {
                // Übung abgeschlossen - Dialog für Gewicht
                const exerciseName = checkbox.dataset.exercise || 
                                    (exerciseRow?.dataset.exercise);
                const sets = checkbox.dataset.sets || 1;
                const reps = checkbox.dataset.reps || 1;
                const duration = checkbox.dataset.duration || '';
                
                // Suche oder erstelle Übung
                let exercise = exercises.find(e => e.name === exerciseName);
                
                if (!exercise) {
                    // Übung existiert noch nicht - erstelle sie automatisch
                    // Bestimme Muskelgruppe
                    let muscleGroup = 'Ganzkörper';
                    if (exerciseName.toLowerCase().includes('judo')) muscleGroup = 'Judo';
                    else if (exerciseName.toLowerCase().includes('bug') || exerciseName.toLowerCase().includes('plank') || exerciseName.toLowerCase().includes('bridge')) muscleGroup = 'Core';
                    else if (exerciseName.toLowerCase().includes('dehn') || exerciseName.toLowerCase().includes('dehnung') || exerciseName.toLowerCase().includes('stretch')) muscleGroup = 'Dehnen';
                    else if (exerciseName.toLowerCase().includes('atmung') || exerciseName.toLowerCase().includes('kindhaltung') || exerciseName.toLowerCase().includes('katze')) muscleGroup = 'Mobilität';
                    
                    const newExercise = await createExerciseIfNotExists(exerciseName, muscleGroup);
                    if (newExercise) {
                        exercise = newExercise;
                        await loadExercises(); // Liste neu laden
                    }
                }
                
                if (exercise) {
                    // Zeige Modal mit allen Feldern
                    const input = await showTrainingModal(
                        exerciseName, 
                        parseInt(sets) || 1, 
                        parseInt(reps) || 1, 
                        duration
                    );
                    
                    if (input !== null) {
                        // Workout speichern mit den bearbeiteten Werten
                        await addPlanWorkout(
                            exercise.id, 
                            input.weight, 
                            input.sets, 
                            input.reps
                        );
                        exerciseRow?.classList.add('completed');
                        
                        // Visuelle Bestätigung
                        showToast(`✅ ${exerciseName} gespeichert`);
                        
                        // Stats aktualisieren
                        await autoBackup();
                        await loadStats();
                    } else {
                        // Abgebrochen - Checkbox zurücksetzen
                        checkbox.checked = false;
                        exerciseRow?.classList.remove('completed');
                    }
                } else {
                    checkbox.checked = false;
                    exerciseRow?.classList.remove('completed');
                }
            } else {
                exerciseRow?.classList.remove('completed');
            }
        }
    });
    
    // Klick auf Tabellenzeilen zum Toggle
    document.addEventListener('click', (e) => {
        const row = e.target.closest('.plan-exercise-row');
        if (row && !e.target.closest('.checkbox-container')) {
            // Klick auf Zeile (nicht auf Checkbox) toggelt Checkbox
            const checkbox = row.querySelector('.plan-check');
            if (checkbox && !checkbox.disabled) {
                checkbox.click();
            }
        }
    });
}

// Modal für Trainingseintrag
function showTrainingModal(exerciseName, defaultSets, defaultReps, duration) {
    return new Promise((resolve) => {
        const isDuration = duration && (duration.includes('Sek') || duration.includes('Min'));
        const isStretch = exerciseName.toLowerCase().includes('dehn') || 
                         exerciseName.toLowerCase().includes('stretch') ||
                         exerciseName.toLowerCase().includes('haltung') ||
                         exerciseName.toLowerCase().includes('atmung');
        
        // Parse Duration für default Reps
        let defaultRepsFromDuration = defaultReps;
        if (duration) {
            const match = duration.match(/(\d+)/);
            if (match) defaultRepsFromDuration = parseInt(match[1]);
        }
        
        // Modal erstellen
        const modal = document.createElement('div');
        modal.className = 'training-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2000;
            animation: fadeIn 0.2s ease-out;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 1px solid rgba(0,212,255,0.3);
            border-radius: 16px;
            padding: 24px;
            width: 90%;
            max-width: 400px;
            animation: slideUp 0.3s ease-out;
        `;
        
        // Übungstitel
        const title = document.createElement('h3');
        title.textContent = exerciseName;
        title.style.cssText = `
            margin: 0 0 20px 0;
            color: #00d4ff;
            font-size: 1.3rem;
            text-align: center;
        `;
        
        // Formular
        const form = document.createElement('div');
        form.style.cssText = 'display: flex; flex-direction: column; gap: 15px;';
        
        // Gewicht Feld
        const weightGroup = document.createElement('div');
        weightGroup.style.cssText = 'display: flex; flex-direction: column; gap: 5px;';
        
        const weightLabel = document.createElement('label');
        weightLabel.textContent = isStretch ? 'Gewicht (optional, für extra Widerstand)' : 'Gewicht (kg)';
        weightLabel.style.cssText = 'color: #888; font-size: 0.9rem;';
        
        const weightInput = document.createElement('input');
        weightInput.type = 'number';
        weightInput.value = isStretch ? '0' : '20';
        weightInput.step = '0.5';
        weightInput.min = '0';
        weightInput.style.cssText = `
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            padding: 12px;
            color: #fff;
            font-size: 1rem;
        `;
        
        weightGroup.appendChild(weightLabel);
        weightGroup.appendChild(weightInput);
        
        // Sätze Feld
        const setsGroup = document.createElement('div');
        setsGroup.style.cssText = 'display: flex; flex-direction: column; gap: 5px;';
        
        const setsLabel = document.createElement('label');
        setsLabel.textContent = 'Sätze';
        setsLabel.style.cssText = 'color: #888; font-size: 0.9rem;';
        
        const setsInput = document.createElement('input');
        setsInput.type = 'number';
        setsInput.value = defaultSets;
        setsInput.min = '1';
        setsInput.style.cssText = `
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            padding: 12px;
            color: #fff;
            font-size: 1rem;
        `;
        
        setsGroup.appendChild(setsLabel);
        setsGroup.appendChild(setsInput);
        
        // Reps/Dauer Feld
        const repsGroup = document.createElement('div');
        repsGroup.style.cssText = 'display: flex; flex-direction: column; gap: 5px;';
        
        const repsLabel = document.createElement('label');
        repsLabel.textContent = isStretch ? 'Dauer (Sekunden)' : 'Wiederholungen';
        repsLabel.style.cssText = 'color: #888; font-size: 0.9rem;';
        
        const repsInput = document.createElement('input');
        repsInput.type = 'number';
        repsInput.value = defaultRepsFromDuration;
        repsInput.min = '1';
        repsInput.style.cssText = `
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            padding: 12px;
            color: #fff;
            font-size: 1rem;
        `;
        
        repsGroup.appendChild(repsLabel);
        repsGroup.appendChild(repsInput);
        
        // Buttons
        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = 'display: flex; gap: 10px; margin-top: 20px;';
        
        const saveBtn = document.createElement('button');
        saveBtn.textContent = '💾 Speichern';
        saveBtn.style.cssText = `
            flex: 1;
            padding: 12px;
            background: linear-gradient(45deg, #00d4ff, #7b2cbf);
            border: none;
            border-radius: 8px;
            color: #fff;
            font-size: 1rem;
            cursor: pointer;
            transition: transform 0.2s;
        `;
        saveBtn.onmouseover = () => saveBtn.style.transform = 'scale(1.02)';
        saveBtn.onmouseout = () => saveBtn.style.transform = 'scale(1)';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '❌ Abbrechen';
        cancelBtn.style.cssText = `
            flex: 1;
            padding: 12px;
            background: rgba(255,100,100,0.2);
            border: 1px solid rgba(255,100,100,0.5);
            border-radius: 8px;
            color: #f66;
            font-size: 1rem;
            cursor: pointer;
            transition: background 0.2s;
        `;
        cancelBtn.onmouseover = () => cancelBtn.style.background = 'rgba(255,100,100,0.3)';
        cancelBtn.onmouseout = () => cancelBtn.style.background = 'rgba(255,100,100,0.2)';
        
        buttonGroup.appendChild(cancelBtn);
        buttonGroup.appendChild(saveBtn);
        
        // Zusammenbauen
        form.appendChild(weightGroup);
        form.appendChild(setsGroup);
        form.appendChild(repsGroup);
        form.appendChild(buttonGroup);
        
        content.appendChild(title);
        content.appendChild(form);
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        // Event Handlers
        const handleSave = () => {
            const weight = parseFloat(weightInput.value) || 0;
            const sets = parseInt(setsInput.value) || defaultSets;
            const reps = parseInt(repsInput.value) || defaultRepsFromDuration;
            
            document.body.removeChild(modal);
            resolve({
                weight: isStretch ? 0 : weight,
                sets: sets,
                reps: reps
            });
        };
        
        const handleCancel = () => {
            document.body.removeChild(modal);
            resolve(null);
        };
        
        saveBtn.addEventListener('click', handleSave);
        cancelBtn.addEventListener('click', handleCancel);
        
        // Enter zum Speichern
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
        });
        
        // Klick außerhalb schließt
        modal.addEventListener('click', (e) => {
            if (e.target === modal) handleCancel();
        });
        
        // Fokus auf erstes Feld
        weightInput.focus();
    });
}

// Übung erstellen falls nicht existiert
async function createExerciseIfNotExists(name, muscleGroup) {
    try {
        const res = await apiFetch('/api/exercises', {
            method: 'POST',
            body: JSON.stringify({ name, muscle_group: muscleGroup })
        });
        
        if (res && res.ok) {
            const data = await res.json();
            console.log(`✅ Übung erstellt: ${name}`);
            return data;
        }
        return null;
    } catch (err) {
        console.error('❌ Fehler beim Erstellen der Übung:', err);
        return null;
    }
}

// Übungsbilder automatisch hinzufügen (falls im HTML noch nicht vorhanden)
function autoAddExerciseThumbnails() {
    document.querySelectorAll('.plan-exercise').forEach(item => {
        // Prüfe ob schon ein Thumb existiert
        if (!item.querySelector('.exercise-thumb')) {
            const checkbox = item.querySelector('.plan-check');
            const textSpan = item.querySelector('.exercise-text');
            
            if (checkbox) {
                const exerciseName = checkbox.dataset.exercise;
                const exerciseData = exerciseImages[exerciseName];
                const emoji = exerciseData?.emoji || '💪';
                const imagePath = exerciseData?.image; // GIF oder Bild Pfad
                
                // Erstelle Thumbnail
                const thumb = document.createElement('div');
                thumb.className = 'exercise-thumb';
                
                // Wenn ein Bild/GIF vorhanden ist, zeige es an
                if (imagePath) {
                    const img = document.createElement('img');
                    img.src = imagePath;
                    img.alt = exerciseName;
                    // KEIN lazy loading für GIFs - verursacht Probleme auf iOS
                    // img.loading = 'lazy';
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'cover';
                    img.onerror = () => {
                        // Fallback zu Emoji wenn Bild nicht geladen werden kann
                        thumb.textContent = emoji;
                        thumb.style.display = 'flex';
                        thumb.style.alignItems = 'center';
                        thumb.style.justifyContent = 'center';
                    };
                    thumb.appendChild(img);
                } else {
                    // Zeige Emoji als Platzhalter
                    thumb.textContent = emoji;
                    thumb.title = 'Klick für Details';
                }
                
                // Füge vor dem Text ein
                if (textSpan) {
                    item.insertBefore(thumb, textSpan);
                } else {
                    // Fallback: vor dem ersten Label
                    const label = item.querySelector('label');
                    if (label) item.insertBefore(thumb, label);
                }
            }
        }
    });
}

// Übungsbilder-Datenbank (mit lokalen Bildern/GIFs)
const exerciseImages = {
    'Dead Bug': {
        emoji: '🐛',
        image: 'exercises/dead-bug.gif',
        description: 'Rückenlage, Arme nach oben, Beine im 90° Winkel. Gegengleiche Bewegung von Arm und Bein.',
        tips: 'Rücken fest am Boden halten, LWS nicht durchhängen lassen.'
    },
    'Bird Dog': {
        emoji: '🐕',
        image: 'exercises/bird-dog.gif',
        description: 'Vierfüßlerstand, diagonal Arm und Bein strecken, 5 Sek. halten.',
        tips: 'Rumpf stabil halten, Becken nicht kippen.'
    },
    'Glute Bridge': {
        emoji: '🍑',
        image: 'exercises/glute-bridge.gif',
        description: 'Rückenlage, Füße nah am Gesäß, Becken anheben.',
        tips: 'Nur so hoch anheben, dass eine gerade Linie entsteht. Nicht überstrecken.'
    },
    'Side Plank': {
        emoji: '📐',
        image: 'exercises/side-plank.jpg',
        description: 'Seitstütz, Körper in einer Linie, Hüfte stabil.',
        tips: 'Bei modifizierter Version: Unteres Knie am Boden ablegen.'
    },
    'Pallof Press': {
        emoji: '🏋️',
        image: 'exercises/torso-rotation.gif',
        description: 'Kabel oder Band auf Bauchhöhe, nach vorne drücken ohne zu rotieren.',
        tips: 'Rumpf stabil, Anti-Rotation-Kraft trainieren.'
    },
    'Front Plank': {
        emoji: '📋',
        image: 'exercises/plank.jpg',
        description: 'Unterarmstütz, Körper in einer Linie.',
        tips: 'Hüfte nicht zu hoch oder zu tief. Core anspannen.'
    },
    'Glute March': {
        emoji: '🚶',
        description: 'Brückenposition, Beine abwechselnd anheben.',
        tips: 'Becken stabil halten, nicht kippen.'
    },
    'Copenhagen Plank': {
        emoji: '🇩🇰',
        description: 'Seitstütz, oberes Bein auf Erhöhung. Adduktoren-Training.',
        tips: 'Leichte Version: mit unterem Knie am Boden beginnen.'
    },
    'Kindhaltung': {
        emoji: '🧒',
        image: 'exercises/child-pose.jpg',
        description: 'Kniebeuge, Po auf Fersen, Arme nach vorne, Stirn zum Boden.',
        tips: 'Entspannte Wirbelsäule, tief durchatmen.'
    },
    'Katze-Kuh': {
        emoji: '🐱',
        image: 'exercises/cat-cow.gif',
        description: 'Vierfüßlerstand, abwechselnd Rücken rund und hohl.',
        tips: 'Mit der Atmung synchronisieren: Einatmen = Hohl, Ausatmen = Rund'
    },
    'Kniestand Hüftbeuger': {
        emoji: '🙏',
        image: 'exercises/hip-stretch.gif',
        description: 'Ein Knie steht, anderes Bein nach hinten, Becken vor schieben.',
        tips: 'Oberkörper aufrecht, leichter Zug im Hüftbeuger spürbar.'
    },
    '90/90 Hip Stretch': {
        emoji: '9️⃣',
        description: 'Sitzen mit 90° im vorderen und hinteren Bein, nach vorne lehnen.',
        tips: 'Langsam in die Dehnung gehen, bei Schmerzen aufhören.'
    },
    'Piriformis-Dehnung': {
        emoji: '🦵',
        description: 'Schere-Sitz, vorderes Bein über das andere, nach vorne drehen.',
        tips: 'Hüfte bleibt am Boden, Oberkörper zum Knie drehen.'
    },
    'Schmetterling': {
        emoji: '🦋',
        image: 'exercises/butterfly-stretch.gif',
        description: 'Sitzen, Fußsohlen zusammen, Knie nach außen sinken lassen.',
        tips: 'Entspannt halten, nicht mit Gewicht auf die Knie drücken.'
    },
    'ADIM': {
        emoji: '🫁',
        description: 'Bauchnabel Richtung Wirbelsäule einziehen, tief atmen.',
        tips: '10 Sekunden halten, fließend atmen. 3x täglich üben.'
    },
    'Hip Circles': {
        emoji: '⭕',
        description: 'Hüftkreisen, große Bewegung.',
        tips: 'Langsam und kontrolliert, beide Richtungen.'
    },
    'Schulterkreisen': {
        emoji: '🔃',
        description: 'Schultern kreisförmig bewegen.',
        tips: 'Zuerst rückwärts (korrigierend), dann vorwärts.'
    },
    'Tiefe Atmung': {
        emoji: '🌬️',
        description: 'Bauchatmung, langsam ein- und ausatmen.',
        tips: 'Hand auf Bauch, diese sollte sich heben.'
    },
    'Hüftbeuger-Dehnung': {
        emoji: '🤸',
        image: 'exercises/hip-stretch.gif',
        description: 'Lunge-Position, Hüfte nach vorne schieben.',
        tips: 'Oberkörper aufrecht, Beinstreckung spürbar.'
    },
    'Brust-Dehnung': {
        emoji: '🚪',
        description: 'Arm an Türrahmen, nach vorne lehnen.',
        tips: '90° Winkel am Arm, Brust öffnen.'
    },
    'Lat-Dehnung': {
        emoji: '👐',
        description: 'Arm über Kopf, zur Seite lehnen.',
        tips: 'Oberkörper seitlich neigen, nicht nach vorne oder hinten.'
    },
    'Nacken-Dehnung': {
        emoji: '🙆',
        description: 'Kopf sanft zur Seite neigen, Hand kann unterstützen.',
        tips: 'Nicht zwingen, sanfter Druck, beide Seiten.'
    },
    'LWS-Rotation': {
        emoji: '🔄',
        description: 'Rückenlage, Knie zur Seite lassen, Oberkörper stabil.',
        tips: 'Nur so weit, wie es angenehm ist.'
    }
};

// Bild-Modal für Übungen anzeigen
function showExerciseImageModal(exerciseName) {
    const exerciseData = exerciseImages[exerciseName] || {
        emoji: '💪',
        description: `${exerciseName} - Übung aus dem Trainingsplan.`,
        tips: 'Technik beachten, bei Schmerzen aufhören.'
    };
    
    const modal = document.createElement('div');
    modal.className = 'exercise-image-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3000;
        animation: fadeIn 0.2s ease-out;
    `;
    
    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.cssText = `
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid rgba(0,212,255,0.3);
        border-radius: 16px;
        padding: 30px;
        max-width: 400px;
        width: 90%;
        position: relative;
        animation: slideUp 0.3s ease-out;
    `;
    
    // Close Button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
        position: absolute;
        top: 15px;
        right: 15px;
        background: rgba(255,100,100,0.2);
        border: 1px solid rgba(255,100,100,0.5);
        color: #f66;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 1.2rem;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    closeBtn.onclick = () => document.body.removeChild(modal);
    
    // Emoji/Icon als große Darstellung
    const icon = document.createElement('div');
    icon.textContent = exerciseData.emoji;
    icon.style.cssText = `
        font-size: 4rem;
        text-align: center;
        margin-bottom: 15px;
    `;
    
    // Übungsname
    const title = document.createElement('h3');
    title.textContent = exerciseName;
    title.style.cssText = `
        color: #00d4ff;
        font-size: 1.4rem;
        margin-bottom: 15px;
        text-align: center;
    `;
    
    // Beschreibung
    const desc = document.createElement('p');
    desc.textContent = exerciseData.description;
    desc.style.cssText = `
        color: #ccc;
        font-size: 1rem;
        line-height: 1.6;
        margin-bottom: 15px;
    `;
    
    // Tipps
    const tipsLabel = document.createElement('p');
    tipsLabel.textContent = '💡 Tipps:';
    tipsLabel.style.cssText = 'color: #7b2cbf; font-weight: bold; margin-bottom: 5px;';
    
    const tips = document.createElement('p');
    tips.textContent = exerciseData.tips;
    tips.style.cssText = `
        color: #888;
        font-size: 0.9rem;
        line-height: 1.5;
        font-style: italic;
    `;
    
    // Zusammenbauen
    content.appendChild(closeBtn);
    content.appendChild(icon);
    content.appendChild(title);
    content.appendChild(desc);
    content.appendChild(tipsLabel);
    content.appendChild(tips);
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // Klick außerhalb schließt
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });
    
    // ESC schließt
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            document.body.removeChild(modal);
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

// Übungsbilder initialisieren
function initExerciseImages() {
    document.addEventListener('click', (e) => {
        const thumb = e.target.closest('.exercise-thumb');
        if (thumb) {
            // Finde den Übungsnamen
            const exerciseItem = thumb.closest('.plan-exercise');
            if (exerciseItem) {
                const checkbox = exerciseItem.querySelector('.plan-check');
                if (checkbox) {
                    const exerciseName = checkbox.dataset.exercise;
                    showExerciseImageModal(exerciseName);
                }
            }
        }
    });
}
async function addPlanWorkout(exerciseId, weight, sets, reps) {
    try {
        const data = {
            exercise_id: exerciseId,
            weight: weight,
            sets: sets,
            reps: reps,
            rest_seconds: 60,
            feeling: 7,
            date: new Date().toISOString().split('T')[0] // Heute
        };
        
        const res = await apiFetch('/api/workouts', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        
        if (res && res.ok) {
            // Lade Workouts neu
            await loadWorkouts();
            return true;
        }
        return false;
    } catch (err) {
        console.error('❌ Fehler beim Speichern:', err);
        return false;
    }
}

// Toast Notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(45deg, #00d4ff, #7b2cbf);
        color: #fff;
        padding: 12px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1000;
        animation: slideUp 0.3s ease-out;
        font-weight: 500;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// Helper: Format date
function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function showTab(tabName) {
    // Alle Tabs ausblenden
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Alle Buttons zurücksetzen
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Gewählten Tab anzeigen
    document.getElementById(tabName + '-tab').classList.add('active');
    
    // Button als aktiv markieren
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(btn => {
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes("'" + tabName + "'")) {
            btn.classList.add('active');
        }
    });
    
    // Stats initialisieren wenn Stats-Tab geöffnet wird
    if (tabName === 'stats') {
        initStats();
    }
}

// Backup to Google Drive - deaktiviert
/*
async function backupToDrive() {
    const statusEl = document.getElementById('backup-status');
    statusEl.textContent = '🔄 Backup wird erstellt...';
    statusEl.style.color = '#00d4ff';
    
    try {
        const res = await apiFetch('/api/backup/drive', { method: 'POST' });
        const data = await res.json();
        
        if (data.success) {
            statusEl.textContent = `✅ Backup gespeichert: ${data.fileName}`;
            statusEl.style.color = '#00ff88';
        } else {
            statusEl.textContent = '❌ Fehler: ' + data.error;
            statusEl.style.color = '#ff4444';
        }
    } catch (err) {
        statusEl.textContent = '❌ Backup fehlgeschlagen: ' + err.message;
        statusEl.style.color = '#ff4444';
    }
}
*/

// ===================== TRAININGSPLAN =====================

// Trainingsplan ein-/ausblenden
function togglePlan() {
    const panel = document.getElementById('plan-panel');
    const btn = document.getElementById('plan-toggle-btn');
    
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        btn.textContent = '📋 Trainingsplan ausblenden';
        btn.style.background = 'rgba(200,100,100,0.2)';
        btn.style.borderColor = 'rgba(200,100,100,0.5)';
        btn.style.color = '#c66';
        // Automatisch heute anzeigen
        selectTodayInPlan();
    } else {
        panel.style.display = 'none';
        btn.textContent = '📋 Trainingsplan anzeigen';
        btn.style.background = 'rgba(100,200,100,0.2)';
        btn.style.borderColor = 'rgba(100,200,100,0.5)';
        btn.style.color = '#6c6';
    }
}

// Tag im Trainingsplan anzeigen
function showPlanDay(day) {
    // Alle Tage ausblenden
    document.querySelectorAll('.plan-day').forEach(d => {
        d.classList.remove('active');
    });
    
    // Alle Buttons zurücksetzen
    document.querySelectorAll('.plan-day-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Gewählten Tag anzeigen
    document.getElementById('plan-' + day).classList.add('active');
    
    // Button als aktiv markieren (finde den zugehörigen Button)
    document.querySelectorAll('.plan-day-btn').forEach(btn => {
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes("'" + day + "'")) {
            btn.classList.add('active');
        }
    });
}

// Heutigen Tag im Plan vorauswählen (kann manuell aufgerufen werden)
function selectTodayInPlan() {
    const today = new Date().getDay();
    const days = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
    showPlanDay(days[today]);
}

// ===================== NEUE STATISTIK-FUNKTIONEN =====================

let currentWeekOffset = 0;
let selectedExercises = new Set();
let allExercisesList = [];
let allWorkoutsChart = null;
let dailyVolumeChart = null;
let singleExerciseChart = null;

function changeWeek(offset) {
    currentWeekOffset += offset;
    updateWeekView();
}

function resetToCurrentWeek() {
    currentWeekOffset = 0;
    updateWeekView();
}

function updateWeekView() {
    const now = new Date();
    const currentWeekStart = getWeekStart(now);
    currentWeekStart.setDate(currentWeekStart.getDate() + (currentWeekOffset * 7));
    
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    const label = document.getElementById('current-week-label');
    if (currentWeekOffset === 0) {
        label.textContent = 'Diese Woche';
    } else if (currentWeekOffset === -1) {
        label.textContent = 'Letzte Woche';
    } else if (currentWeekOffset === 1) {
        label.textContent = 'Nächste Woche';
    } else {
        const options = { month: 'short', day: 'numeric' };
        label.textContent = `${currentWeekStart.toLocaleDateString('de-DE', options)} - ${weekEnd.toLocaleDateString('de-DE', options)}`;
    }
    
    const weekWorkouts = workouts.filter(w => {
        const workoutDate = new Date(w.date);
        return workoutDate >= currentWeekStart && workoutDate <= weekEnd;
    });
    
    updateWeekStats(weekWorkouts);
    updateAllWorkoutsChart(weekWorkouts);
    updateDailyVolumeChart(weekWorkouts, currentWeekStart);
}

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function updateWeekStats(weekWorkouts) {
    let totalVolume = 0;
    const uniqueExercises = new Set();
    
    weekWorkouts.forEach(w => {
        totalVolume += w.weight * w.sets * w.reps;
        if (w.exercise_id) uniqueExercises.add(w.exercise_id);
    });
    
    document.getElementById('week-total-volume').textContent = formatWeight(totalVolume);
    document.getElementById('week-workout-count').textContent = weekWorkouts.length;
    document.getElementById('week-exercise-count').textContent = uniqueExercises.size;
}

function initExerciseFilter() {
    const container = document.getElementById('exercise-filter-list');
    if (!container) return;
    
    container.innerHTML = '';
    allExercisesList = exercises;
    
    if (exercises.length === 0) {
        container.innerHTML = '<div style="color: #666; font-style: italic;">Noch keine Übungen vorhanden</div>';
        return;
    }
    
    exercises.forEach(ex => {
        selectedExercises.add(ex.id);
    });
    
    exercises.forEach(ex => {
        const label = document.createElement('label');
        label.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(255,255,255,0.05); border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.value = ex.id;
        checkbox.onchange = (e) => {
            if (e.target.checked) {
                selectedExercises.add(parseInt(e.target.value));
            } else {
                selectedExercises.delete(parseInt(e.target.value));
            }
            updateWeekView();
        };
        
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(ex.name));
        container.appendChild(label);
    });
}

function selectAllExercises(select) {
    const checkboxes = document.querySelectorAll('#exercise-filter-list input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = select;
        if (select) {
            selectedExercises.add(parseInt(cb.value));
        } else {
            selectedExercises.delete(parseInt(cb.value));
        }
    });
    updateWeekView();
}

function updateAllWorkoutsChart(weekWorkouts) {
    const ctx = document.getElementById('all-workouts-chart')?.getContext('2d');
    if (!ctx) return;
    
    const dataByExercise = {};
    weekWorkouts.forEach(w => {
        if (!selectedExercises.has(w.exercise_id)) return;
        
        if (!dataByExercise[w.exercise_name]) {
            dataByExercise[w.exercise_name] = [];
        }
        dataByExercise[w.exercise_name].push({
            x: w.date,
            y: w.weight,
            volume: w.weight * w.sets * w.reps
        });
    });
    
    const datasets = Object.entries(dataByExercise).map(([name, data], index) => {
        const colors = ['#00d4ff', '#7b2cbf', '#ff6b6b', '#4ecdc4', '#ffe66d', '#a8e6cf', '#ff8b94'];
        const color = colors[index % colors.length];
        
        return {
            label: name,
            data: data.map(d => ({ x: d.x, y: d.y })),
            borderColor: color,
            backgroundColor: color + '33',
            tension: 0.3,
            fill: false
        };
    });
    
    if (allWorkoutsChart) {
        allWorkoutsChart.destroy();
    }
    
    if (datasets.length === 0) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = '#666';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Keine Workouts in dieser Woche', ctx.canvas.width / 2, ctx.canvas.height / 2);
        return;
    }
    
    allWorkoutsChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            scales: {
                x: {
                    type: 'category',
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: { color: '#888' }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: { color: '#888' },
                    title: { display: true, text: 'Gewicht (kg)', color: '#888' }
                }
            },
            plugins: {
                legend: { labels: { color: '#fff' }, position: 'top' }
            }
        }
    });
}

function updateDailyVolumeChart(weekWorkouts, weekStart) {
    const ctx = document.getElementById('daily-volume-chart')?.getContext('2d');
    if (!ctx) return;
    
    const volumeByDay = {};
    const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    
    for (let i = 0; i < 7; i++) {
        const day = new Date(weekStart);
        day.setDate(day.getDate() + i);
        const dayKey = day.toISOString().split('T')[0];
        volumeByDay[dayKey] = { volume: 0, label: dayNames[i], hasWorkouts: false };
    }
    
    weekWorkouts.forEach(w => {
        if (!selectedExercises.has(w.exercise_id)) return;
        
        const dayVolume = w.weight * w.sets * w.reps;
        if (volumeByDay[w.date]) {
            volumeByDay[w.date].volume += dayVolume;
            volumeByDay[w.date].hasWorkouts = true;
        }
    });
    
    const labels = Object.values(volumeByDay).map(d => d.label);
    const volumes = Object.values(volumeByDay).map(d => d.volume);
    
    if (dailyVolumeChart) {
        dailyVolumeChart.destroy();
    }
    
    // Alle Werte sind 0? Dann zeigen wir trotzdem das Diagramm
    const hasAnyWorkouts = volumes.some(v => v > 0);
    
    dailyVolumeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Tagesvolumen',
                data: volumes,
                backgroundColor: volumes.map(v => v > 0 ? 'rgba(0,212,255,0.6)' : 'rgba(255,255,255,0.05)'),
                borderColor: '#00d4ff',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: { 
                        color: '#888', 
                        callback: (v) => hasAnyWorkouts ? formatWeight(v) : '0 kg'
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#888' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `Volumen: ${formatWeight(ctx.raw)}`
                    },
                    enabled: hasAnyWorkouts
                },
                annotation: hasAnyWorkouts ? {} : {
                    annotations: {
                        text: {
                            type: 'label',
                            content: 'Keine Workouts diese Woche',
                            position: 'center'
                        }
                    }
                }
            }
        }
    });
}

async function loadSingleExerciseChart() {
    const exerciseId = document.getElementById('single-exercise-select')?.value;
    const container = document.getElementById('single-exercise-chart-container');
    
    if (!exerciseId) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    try {
        const res = await apiFetch(`/api/progress/${exerciseId}`);
        if (!res) return;
        const data = await res.json();
        
        if (data.length === 0) {
            if (singleExerciseChart) singleExerciseChart.destroy();
            return;
        }
        
        const ctx = document.getElementById('single-exercise-chart').getContext('2d');
        
        if (singleExerciseChart) singleExerciseChart.destroy();
        
        singleExerciseChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => formatDate(d.date)),
                datasets: [{
                    label: 'Gewicht (kg)',
                    data: data.map(d => d.weight),
                    borderColor: '#00d4ff',
                    backgroundColor: 'rgba(0,212,255,0.1)',
                    tension: 0.3,
                    fill: true
                }, {
                    label: 'Wiederholungen',
                    data: data.map(d => d.reps),
                    borderColor: '#7b2cbf',
                    backgroundColor: 'rgba(123,44,191,0.1)',
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#888' } },
                    y1: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { color: '#888' } },
                    x: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#888' } }
                },
                plugins: {
                    legend: { labels: { color: '#fff' } }
                }
            }
        });
    } catch (err) {
        console.error('Fehler beim Laden des Charts:', err);
    }
}

function formatWeight(kg) {
    if (kg >= 1000) {
        return (kg / 1000).toFixed(1) + 'k';
    }
    return Math.round(kg) + ' kg';
}

function initStats() {
    initExerciseFilter();
    updateExerciseSelects();
    resetToCurrentWeek();
}

// ===================== TIMER FUNKTIONEN =====================

// --- �bungs-Stopuhr (f�r Zeit-�bungen) ---
let exerciseTimerInterval = null;
let exerciseTimerSeconds = 0;
let exerciseTimerRunning = false;

function startExerciseTimer() {
    if (exerciseTimerRunning) return;
    
    exerciseTimerRunning = true;
    document.getElementById('exercise-timer-start').style.display = 'none';
    document.getElementById('exercise-timer-pause').style.display = 'inline-block';
    document.getElementById('exercise-timer-stop').style.display = 'inline-block';
    
    exerciseTimerInterval = setInterval(() => {
        exerciseTimerSeconds++;
        updateExerciseTimerDisplay();
    }, 1000);
}

function pauseExerciseTimer() {
    if (!exerciseTimerRunning) return;
    
    exerciseTimerRunning = false;
    clearInterval(exerciseTimerInterval);
    
    document.getElementById('exercise-timer-start').style.display = 'inline-block';
    document.getElementById('exercise-timer-pause').style.display = 'none';
}

function stopExerciseTimer() {
    exerciseTimerRunning = false;
    clearInterval(exerciseTimerInterval);
    
    // Zeit ins Feld �bertragen (Format: Min:Sek)
    const mins = Math.floor(exerciseTimerSeconds / 60);
    const secs = exerciseTimerSeconds % 60;
    const durationStr = mins + ':' + secs.toString().padStart(2, '0');
    
    const durationInput = document.getElementById('workout-duration');
    if (durationInput) {
        durationInput.value = durationStr;
    }
    
    // Reset
    exerciseTimerSeconds = 0;
    updateExerciseTimerDisplay();
    
    document.getElementById('exercise-timer-start').style.display = 'inline-block';
    document.getElementById('exercise-timer-pause').style.display = 'none';
    document.getElementById('exercise-timer-stop').style.display = 'inline-block';
}

function updateExerciseTimerDisplay() {
    const mins = Math.floor(exerciseTimerSeconds / 60);
    const secs = exerciseTimerSeconds % 60;
    const display = document.getElementById('exercise-timer-display');
    if (display) {
        display.textContent = mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
    }
}

// --- Globaler Trainings-Timer ---
let trainingTimerInterval = null;
let trainingTimerSeconds = 0;
let trainingTimerRunning = false;

function startTrainingTimer() {
    if (trainingTimerRunning) return;
    
    trainingTimerRunning = true;
    document.getElementById('training-timer-start').style.display = 'none';
    document.getElementById('training-timer-pause').style.display = 'inline-block';
    document.getElementById('training-timer-stop').style.display = 'inline-block';
    document.getElementById('training-timer-status').style.display = 'block';
    
    trainingTimerInterval = setInterval(() => {
        trainingTimerSeconds++;
        updateTrainingTimerDisplay();
    }, 1000);
}

function pauseTrainingTimer() {
    if (!trainingTimerRunning) return;
    
    trainingTimerRunning = false;
    clearInterval(trainingTimerInterval);
    
    // Bei Pause: Start zeigen (zum Fortsetzen), Pause ausblenden, Stop ausblenden (nicht mehr nötig)
    // Stattdessen einen "Speichern" Button zeigen oder erst nach Stoppen
    document.getElementById('training-timer-start').style.display = 'inline-block';
    document.getElementById('training-timer-pause').style.display = 'none';
    document.getElementById('training-timer-stop').style.display = 'inline-block'; // Speichern-Button
}

async function stopTrainingTimer() {
    trainingTimerRunning = false;
    clearInterval(trainingTimerInterval);
    
    // Als Workout speichern (Generische "Training" �bung)
    const totalMinutes = Math.floor(trainingTimerSeconds / 60);
    const totalSecs = trainingTimerSeconds % 60;
    const durationStr = totalMinutes + ':' + totalSecs.toString().padStart(2, '0');
    
    // Finde oder erstelle eine "Training" �bung
    let trainingExercise = exercises.find(e => e.name === 'Training (Gesamt)');
    if (!trainingExercise) {
        // Erstelle neue �bung
        const newExercise = {
            name: 'Training (Gesamt)',
            muscle_group: 'Ganzk�rper',
            exercise_type: 'time'
        };
        // Speichere �bung
        try {
            const res = await apiFetch('/api/exercises', {
                method: 'POST',
                body: JSON.stringify(newExercise)
            });
            if (res && res.ok) {
                const data = await res.json();
                trainingExercise = { id: data.id, ...newExercise };
                exercises.push(trainingExercise);
            }
        } catch (err) {
            console.error('Fehler beim Erstellen der �bung:', err);
        }
    }
    
    // Speichere Workout
    if (trainingExercise) {
        const data = {
            exercise_id: trainingExercise.id,
            duration_seconds: trainingTimerSeconds,
            weight: 0,
            sets: 0, reps: 0,
            rest_seconds: 0,
            feeling: 5,
            date: new Date().toISOString().split('T')[0]
        };
        
        try {
            const res = await apiFetch('/api/workouts', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            if (res && res.ok) {
                showNotification('Training gespeichert: ' + durationStr);
                loadWorkouts();
                loadStats();
            }
        } catch (err) {
            console.error('Fehler beim Speichern:', err);
            showNotification('? Fehler beim Speichern', 'error');
        }
    }
    
    // Reset
    trainingTimerSeconds = 0;
    updateTrainingTimerDisplay();
    
    document.getElementById('training-timer-start').style.display = 'inline-block';
    document.getElementById('training-timer-pause').style.display = 'none';
    document.getElementById('training-timer-stop').style.display = 'none';
    document.getElementById('training-timer-status').style.display = 'none';
    document.getElementById('training-timer-status').textContent = '?? Training l�uft... Gesamtdauer wird aufgezeichnet';
}

function updateTrainingTimerDisplay() {
    const hours = Math.floor(trainingTimerSeconds / 3600);
    const mins = Math.floor((trainingTimerSeconds % 3600) / 60);
    const secs = trainingTimerSeconds % 60;
    const display = document.getElementById('training-timer-display');
    if (display) {
        display.textContent = hours.toString().padStart(2, '0') + ':' + mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
    }
}

// Hilfsfunktion f�r Notification
function showNotification(message, type = 'success') {
    // Pr�fe ob Notification Funktion existiert
    if (typeof showNotificationInternal === 'function') {
        showNotificationInternal(message, type);
    } else {
        alert(message);
    }
}

// Timer-Funktionen global verf�gbar machen
window.startExerciseTimer = startExerciseTimer;
window.pauseExerciseTimer = pauseExerciseTimer;
window.stopExerciseTimer = stopExerciseTimer;
window.startTrainingTimer = startTrainingTimer;
window.pauseTrainingTimer = pauseTrainingTimer;
window.stopTrainingTimer = stopTrainingTimer;


