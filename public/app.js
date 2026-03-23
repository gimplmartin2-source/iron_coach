const API_URL = '';

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
    const header = document.querySelector('header');
    if (currentUser && header) {
        const userDiv = document.createElement('div');
        userDiv.style.cssText = 'margin-top: 15px; display: flex; align-items: center; justify-content: center; gap: 15px;';
        userDiv.innerHTML = `
            <span style="color: #888;">👤 ${currentUser.displayName || currentUser.email}</span>
            <button id="logout-btn" style="padding: 8px 16px; background: rgba(255,50,50,0.2); border: 1px solid rgba(255,50,50,0.5); border-radius: 6px; color: #ff6666; cursor: pointer; font-size: 0.9rem;">Abmelden</button>
        `;
        header.appendChild(userDiv);
        
        // Re-attach event listener
        document.getElementById('logout-btn').addEventListener('click', logout);
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
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

// Update select dropdowns
function updateExerciseSelects() {
    const workoutSelect = document.getElementById('workout-exercise');
    const statsSelect = document.getElementById('stats-exercise');
    
    const options = exercises.map(e => `<option value="${e.id}">${e.name} (${e.muscle_group})</option>`).join('');
    
    workoutSelect.innerHTML = '<option value="">-- Wähle Übung --</option>' + options;
    statsSelect.innerHTML = '<option value="">-- Wähle Übung --</option>' + options;
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

// Delete exercise
async function deleteExercise(id) {
    if (!confirm('Übung wirklich löschen?')) return;
    
    try {
        await apiFetch(`/api/exercises/${id}`, { method: 'DELETE' });
        loadExercises();
        loadWorkouts();
        loadStats();
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

// Calculate 1RM (Epley formula)
function calculate1RM(weight, reps) {
    return weight * (1 + reps / 30);
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
