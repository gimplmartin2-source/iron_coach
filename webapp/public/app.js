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
        
        if (res.status === 401) {
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
    
    // Restore VOR dem Laden der Daten (nur einmal pro Session)
    const restoreAttempted = sessionStorage.getItem('restoreAttempted');
    if (!restoreAttempted) {
        sessionStorage.setItem('restoreAttempted', 'true');
        const restoreResult = await restoreFromDrive();
        if (restoreResult) {
            // Restore erfolgreich, Seite wird neu geladen
            return;
        }
    }
    
    // Kein Restore nötig oder fehlgeschlagen - normale Initialisierung
    loadExercises();
    loadWorkouts();
    loadStats();
    
    // Set today's date
    document.getElementById('workout-date').valueAsDate = new Date();
    
    // Form handlers
    document.getElementById('exercise-form').addEventListener('submit', addExercise);
    document.getElementById('workout-form').addEventListener('submit', addWorkout);
    
    // Logout Button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
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
    
    // Prüfe ob Google-User
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (!payload.googleAccessToken) {
            console.log('ℹ️ Kein Google-Token, überspringe Restore');
            return false;
        }
        
        console.log('🔍 Versuche Restore vom Server...');
        
        // Restore vom Server
        const res = await apiFetch('/api/restore/drive', { method: 'POST' });
        const data = await res.json();
        
        if (data.restored) {
            console.log('✅ Daten von Drive wiederhergestellt');
            // WICHTIG: Seite neu laden damit neue DB verwendet wird
            window.location.reload();
            return true;
        } else if (data.message) {
            console.log('ℹ️ ' + data.message);
        }
        return false;
    } catch (err) {
        console.log('ℹ️ Kein Backup vorhanden oder Fehler:', err.message);
        return false;
    }
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

// Update select dropdowns - gruppiert nach Muskelgruppe
function updateExerciseSelects() {
    const workoutSelect = document.getElementById('workout-exercise');
    const statsSelect = document.getElementById('stats-exercise');
    const singleSelect = document.getElementById('single-exercise-select');
    
    // Nach Muskelgruppe gruppieren
    const grouped = {};
    exercises.forEach(e => {
        if (!grouped[e.muscle_group]) {
            grouped[e.muscle_group] = [];
        }
        grouped[e.muscle_group].push(e);
    });
    
    // Sortierte Reihenfolge der Muskelgruppen
    const muscleOrder = ['Brust', 'Rücken', 'Schultern', 'Beine', 'Arme', 'Bauch', 'Ganzkörper'];
    const sortedMuscles = Object.keys(grouped).sort((a, b) => {
        const idxA = muscleOrder.indexOf(a);
        const idxB = muscleOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });
    
    // Optgroup HTML erstellen
    let options = '';
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
            body: JSON.stringify({ name, muscle_group: muscle })
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

// Render exercises list
function renderExercisesList() {
    const container = document.getElementById('exercises-list');
    
    if (exercises.length === 0) {
        container.innerHTML = '<p class="empty-state">Noch keine Übungen vorhanden.</p>';
        return;
    }
    
    container.innerHTML = exercises.map(e => `
        <div class="list-item">
            <div class="list-item-info">
                <h4>${e.name}</h4>
                <p>${e.muscle_group}</p>
            </div>
            <button class="btn-delete" onclick="deleteExercise(${e.id})">🗑️</button>
        </div>
    `).join('');
}

// Load workouts
async function loadWorkouts() {
    try {
        const res = await apiFetch('/api/workouts');
        if (!res) return;
        workouts = await res.json();
        renderWorkoutsList();
    } catch (err) {
        console.error('Fehler beim Laden der Workouts:', err);
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
    
    const data = {
        exercise_id: parseInt(exerciseId),
        weight: parseFloat(document.getElementById('workout-weight').value),
        sets: parseInt(document.getElementById('workout-sets').value),
        reps: parseInt(document.getElementById('workout-reps').value),
        rest_seconds: parseInt(document.getElementById('workout-rest').value) || 60,
        feeling: parseInt(document.getElementById('workout-feeling').value) || 5,
        date: document.getElementById('workout-date').value
    };
    
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = '⏳ Speichern...';
    btn.disabled = true;
    
    try {
        const res = await apiFetch('/api/workouts', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        
        if (res && res.ok) {
            document.getElementById('workout-form').reset();
            document.getElementById('workout-date').valueAsDate = new Date();
            loadWorkouts();
            loadStats();
            alert('✅ Workout gespeichert!');
            autoBackup(); // Auto-Backup
        } else {
            const errorData = await res.json().catch(() => ({}));
            alert('Fehler: ' + (errorData.error || 'Konnte nicht speichern'));
        }
    } catch (err) {
        console.error('❌ Fehler:', err);
        alert('Fehler: ' + err.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// Delete workout
async function deleteWorkout(id) {
    if (!confirm('Workout wirklich löschen?')) return;
    
    try {
        await apiFetch(`/api/workouts/${id}`, { method: 'DELETE' });
        loadWorkouts();
        loadStats();
        autoBackup(); // Auto-Backup
    } catch (err) {
        console.error('Fehler beim Löschen:', err);
    }
}

// Render workouts list
function renderWorkoutsList() {
    const container = document.getElementById('workouts-list');
    
    if (workouts.length === 0) {
        container.innerHTML = '<p class="empty-state">Noch keine Workouts eingetragen.</p>';
        return;
    }
    
    container.innerHTML = workouts.map(w => {
        const volume = (w.weight * w.sets * w.reps).toLocaleString();
        const feelingEmoji = w.feeling >= 8 ? '🔥' : w.feeling >= 5 ? '👍' : '😤';
        
        return `
        <div class="list-item">
            <div class="list-item-info">
                <h4>${w.exercise_name}</h4>
                <p>${w.weight}kg × ${w.sets} × ${w.reps} | Ruhe: ${w.rest_seconds}s | Gefühl: ${w.feeling}/10 ${feelingEmoji}</p>
            </div>
            <div class="list-item-stats">
                <div class="volume">${volume} kg</div>
                <div class="date">${formatDate(w.date)}</div>
                <button class="btn-delete" onclick="deleteWorkout(${w.id})">🗑️</button>
            </div>
        </div>`;
    }).join('');
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

// Backup to Google Drive
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
        volumeByDay[dayKey] = { volume: 0, label: dayNames[i] };
    }
    
    weekWorkouts.forEach(w => {
        if (!selectedExercises.has(w.exercise_id)) return;
        
        const dayVolume = w.weight * w.sets * w.reps;
        if (volumeByDay[w.date]) {
            volumeByDay[w.date].volume += dayVolume;
        }
    });
    
    const labels = Object.values(volumeByDay).map(d => d.label);
    const volumes = Object.values(volumeByDay).map(d => d.volume);
    
    if (dailyVolumeChart) {
        dailyVolumeChart.destroy();
    }
    
    dailyVolumeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Tagesvolumen',
                data: volumes,
                backgroundColor: volumes.map(v => v > 0 ? 'rgba(0,212,255,0.6)' : 'rgba(255,255,255,0.1)'),
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
                    ticks: { color: '#888', callback: (v) => formatWeight(v) }
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
                    label: 'Volumen',
                    data: data.map(d => d.volume),
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
