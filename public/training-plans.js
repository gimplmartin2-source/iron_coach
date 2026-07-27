// Trainingsplan-Verwaltung für IronCoach
// In-App Editor + automatische Google Drive Synchronisation

let trainingPlans = [];
let currentPlan = null;
let planBeforeEdit = null;
let isPlanEditing = false;

const dayIds = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const dayLabels = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// Initialisierung
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (token) {
        initTrainingPlans();
    }
});

async function initTrainingPlans() {
    await loadTrainingPlanFromDrive();
    setupPlanSelector();
}

async function loadTrainingPlanFromDrive() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const res = await fetch('/api/training-plans/sync-drive', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) {
            if (res.status === 404) {
                await loadDefaultPlan();
                return;
            }
            throw new Error('Fehler beim Laden aus Drive');
        }
        const plan = await res.json();
        currentPlan = plan.plan_data || plan;
        if (!currentPlan.days) currentPlan = plan;
        renderPlan(currentPlan);
        updateSyncStatus(plan.source === 'drive' ? 'Mit Google Drive synchronisiert' : 'Lokal gespeichert');
    } catch (err) {
        console.error('Plan aus Drive laden fehlgeschlagen:', err);
        await loadDefaultPlan();
    }
}

async function loadTrainingPlans() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const res = await fetch('/api/training-plans', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Fehler beim Laden');
        trainingPlans = await res.json();
        const active = trainingPlans.find(p => p.is_active) || trainingPlans[0];
        if (active && !currentPlan) {
            await loadPlan(active.id);
        } else if (trainingPlans.length === 0 && !currentPlan) {
            await loadDefaultPlan();
        }
    } catch (err) {
        console.error('Pläne laden fehlgeschlagen:', err);
        if (!currentPlan) await loadDefaultPlan();
    }
}

async function loadDefaultPlan() {
    try {
        const res = await fetch('/default-training-plan.json');
        if (!res.ok) throw new Error('Default-Plan nicht gefunden');
        const planData = await res.json();
        currentPlan = planData;
        renderPlan(planData);
        updateSyncStatus('Standard-Plan geladen');
        console.log('Default-Plan geladen:', planData.name);
    } catch (err) {
        console.error('Default-Plan laden fehlgeschlagen:', err);
    }
}

async function loadPlan(planId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/training-plans/' + planId, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Plan nicht gefunden');
        const plan = await res.json();
        currentPlan = plan.plan_data || plan;
        renderPlan(currentPlan);
    } catch (err) {
        console.error('Plan laden fehlgeschlagen:', err);
    }
}

function setupPlanSelector() {
    const select = document.getElementById('plan-select');
    if (!select) return;
    select.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = 'active';
    opt.textContent = currentPlan ? (currentPlan.name || 'Mein Trainingsplan') : 'Standard-Plan';
    opt.selected = true;
    select.appendChild(opt);
    select.onchange = (e) => {
        if (e.target.value === 'active' && currentPlan) renderPlan(currentPlan);
    };
}

function renderPlan(planData) {
    if (!planData || !planData.days) return;
    renderDynamicPlan(planData);
}

function renderDynamicPlan(planData) {
    if (!planData || !planData.days) return;
    const title = document.querySelector('#plan-panel h2');
    if (title) title.textContent = '📋 ' + (planData.name || 'Trainingsplan');
    planData.days.forEach((day, index) => {
        const dayId = dayIds[index];
        if (!dayId) return;
        const dayDiv = document.getElementById('plan-' + dayId);
        if (!dayDiv) return;
        const intensityClass = day.intensity === 'Hoch' ? 'intensity-high' :
                              day.intensity === 'Mittel' ? 'intensity-medium' : 'intensity-low';
        let warmupHtml = '';
        if (day.warmup && day.warmup.length > 0) {
            warmupHtml = '<p><strong>Aufwärmen:</strong></p><ul class="checklist">' + day.warmup.map(ex => renderListExercise(ex)).join('') + '</ul>';
        }
        let cooldownHtml = '';
        if (day.cooldown && day.cooldown.length > 0) {
            cooldownHtml = '<p style="margin-top: 15px;"><strong>Cooldown:</strong></p><ul class="checklist">' + day.cooldown.map(ex => renderListExercise(ex)).join('') + '</ul>';
        }
        const exercises = day.exercises || day.main || [];
        const exercisesHtml = exercises.length > 0 ?
            '<div class="plan-content">' + warmupHtml +
            '<p style="margin-top: 15px;"><strong>Hauptübungen:</strong></p>' +
            '<table class="plan-table interactive-plan-table"><tr><th>✓</th><th>Übung</th><th>Sätze</th><th>Wdh/Dauer</th></tr>' +
            exercises.map(ex => renderExerciseRow(ex)).join('') +
            '</table>' + cooldownHtml + '</div>' :
            '<div class="plan-content">' + warmupHtml + cooldownHtml + '</div>';
        dayDiv.innerHTML = '<h3>' + (day.focus || day.day) + '</h3>' +
            '<div class="plan-meta"><span class="badge ' + intensityClass + '">Intensität: ' + (day.intensity || 'Mittel') + '</span><span class="badge">' + (day.duration || '-') + '</span></div>' +
            exercisesHtml;
    });
    console.log('Plan gerendert:', planData.name);
}

function renderListExercise(ex) {
    const display = ex.duration ? (ex.sets || 1) + ' x ' + ex.duration : (ex.sets || '-') + ' x ' + (ex.reps || '-');
    return '<li class="plan-exercise"><label class="checkbox-container"><input type="checkbox" class="plan-check" data-exercise="' + ex.name + '" data-sets="' + (ex.sets || 1) + '" data-reps="' + (ex.reps || 1) + '" data-duration="' + (ex.duration || '') + '"><span class="checkmark"></span></label>' + ex.name + ': ' + display + '</li>';
}

function renderExerciseRow(ex) {
    const hasDuration = ex.duration && (ex.duration.includes('Min') || ex.duration.includes('Sek'));
    const repsDisplay = hasDuration ? ex.duration : ex.reps;
    return '<tr class="plan-exercise-row" data-exercise="' + ex.name + '" data-sets="' + ex.sets + '" data-reps="' + (ex.reps || 1) + '"><td><label class="checkbox-container"><input type="checkbox" class="plan-check"><span class="checkmark"></span></label></td><td>' + ex.name + '</td><td>' + ex.sets + '</td><td>' + repsDisplay + '</td></tr>';
}

function updateSyncStatus(message) {
    const el = document.getElementById('plan-sync-status');
    if (el) el.textContent = message;
}

// --- PLAN EDITOR ---

function togglePlanEditor() {
    const editor = document.getElementById('plan-editor');
    const btnEdit = document.getElementById('btn-edit-plan');
    const btnSave = document.getElementById('btn-save-plan');
    const btnCancel = document.getElementById('btn-cancel-edit');

    if (isPlanEditing) {
        // Schließen ohne Speichern (nur visuell)
        editor.style.display = 'none';
        btnEdit.style.display = '';
        btnSave.style.display = 'none';
        btnCancel.style.display = 'none';
        isPlanEditing = false;
    } else {
        // Öffnen
        if (!currentPlan) {
            currentPlan = createEmptyPlan();
        }
        planBeforeEdit = JSON.parse(JSON.stringify(currentPlan));
        isPlanEditing = true;
        renderPlanEditor();
        editor.style.display = 'block';
        btnEdit.style.display = 'none';
        btnSave.style.display = '';
        btnCancel.style.display = '';
    }
}

function createEmptyPlan() {
    return {
        name: 'Mein Trainingsplan',
        description: 'Individueller Trainingsplan',
        days: dayLabels.map(label => ({
            day: label,
            focus: label,
            intensity: 'Mittel',
            duration: '60 Min',
            warmup: [],
            exercises: []
        }))
    };
}

function renderPlanEditor() {
    const nameInput = document.getElementById('plan-edit-name');
    const descInput = document.getElementById('plan-edit-description');
    const container = document.getElementById('plan-days-editor');

    if (nameInput) nameInput.value = currentPlan.name || '';
    if (descInput) descInput.value = currentPlan.description || '';
    if (!container) return;

    container.innerHTML = currentPlan.days.map((day, dayIndex) => {
        const warmupRows = (day.warmup || []).map((ex, i) => renderExerciseEditRow('warmup', dayIndex, i, ex)).join('');
        const exerciseRows = (day.exercises || day.main || []).map((ex, i) => renderExerciseEditRow('exercise', dayIndex, i, ex)).join('');
        const cooldownRows = (day.cooldown || []).map((ex, i) => renderExerciseEditRow('cooldown', dayIndex, i, ex)).join('');

        return `
        <div class="plan-day-edit" style="margin-bottom: 25px; padding: 15px; background: rgba(255,255,255,0.03); border-radius: 8px;">
            <h4 style="margin-top: 0; color: #6c6;">${dayLabels[dayIndex]}</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 12px;">
                <input type="text" data-plan-field="focus" data-day="${dayIndex}" placeholder="Fokus" value="${escapeHtml(day.focus || day.day)}" style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
                <select data-plan-field="intensity" data-day="${dayIndex}" style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
                    <option value="Hoch" ${day.intensity === 'Hoch' ? 'selected' : ''}>Hoch</option>
                    <option value="Mittel" ${day.intensity === 'Mittel' ? 'selected' : ''}>Mittel</option>
                    <option value="Niedrig" ${day.intensity === 'Niedrig' ? 'selected' : ''}>Niedrig</option>
                </select>
                <input type="text" data-plan-field="duration" data-day="${dayIndex}" placeholder="Dauer" value="${escapeHtml(day.duration || '')}" style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
            </div>

            <div style="margin-bottom: 12px;">
                <strong style="color: #888; font-size: 0.9rem;">Aufwärmen</strong>
                <div class="warmup-rows" data-day="${dayIndex}">${warmupRows}</div>
                <button type="button" onclick="addExerciseRow(${dayIndex}, 'warmup')" class="btn-secondary" style="margin-top: 5px; padding: 5px 10px; font-size: 0.8rem;">+ Aufwärmübung</button>
            </div>

            <div style="margin-bottom: 12px;">
                <strong style="color: #888; font-size: 0.9rem;">Hauptübungen</strong>
                <div class="exercise-rows" data-day="${dayIndex}">${exerciseRows}</div>
                <button type="button" onclick="addExerciseRow(${dayIndex}, 'exercise')" class="btn-secondary" style="margin-top: 5px; padding: 5px 10px; font-size: 0.8rem;">+ Übung</button>
            </div>

            <div style="margin-bottom: 12px;">
                <strong style="color: #888; font-size: 0.9rem;">Cooldown</strong>
                <div class="cooldown-rows" data-day="${dayIndex}">${cooldownRows}</div>
                <button type="button" onclick="addExerciseRow(${dayIndex}, 'cooldown')" class="btn-secondary" style="margin-top: 5px; padding: 5px 10px; font-size: 0.8rem;">+ Cooldown-Übung</button>
            </div>
        </div>`;
    }).join('');
}

function renderExerciseEditRow(type, dayIndex, exIndex, ex) {
    ex = ex || { name: '', sets: '', reps: '', duration: '' };
    return `
    <div class="${type}-row" style="display: grid; grid-template-columns: 2fr 0.7fr 0.7fr 1.2fr auto; gap: 6px; margin-bottom: 6px;">
        <input type="text" data-${type}-name="${dayIndex}" placeholder="Übung" value="${escapeHtml(ex.name || '')}" style="padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
        <input type="text" data-${type}-sets="${dayIndex}" placeholder="Sätze" value="${escapeHtml(ex.sets != null ? ex.sets : '')}" style="padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
        <input type="text" data-${type}-reps="${dayIndex}" placeholder="Wdh" value="${escapeHtml(ex.reps != null ? ex.reps : '')}" style="padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
        <input type="text" data-${type}-duration="${dayIndex}" placeholder="Dauer (z.B. 30 Sek)" value="${escapeHtml(ex.duration || '')}" style="padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
        <button type="button" onclick="removeExerciseRow(this)" class="btn-secondary" style="padding: 5px 10px; font-size: 0.8rem;">🗑️</button>
    </div>`;
}

function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function addExerciseRow(dayIndex, type) {
    const container = document.querySelector(`.${type}-rows[data-day="${dayIndex}"]`);
    if (!container) return;
    const exIndex = container.children.length;
    const row = document.createElement('div');
    row.innerHTML = renderExerciseEditRow(type, dayIndex, exIndex, {});
    container.appendChild(row.firstElementChild);
}

function removeExerciseRow(btn) {
    btn.parentElement.remove();
}

function collectPlanFromEditor() {
    const name = document.getElementById('plan-edit-name')?.value || 'Mein Trainingsplan';
    const description = document.getElementById('plan-edit-description')?.value || '';

    const days = currentPlan.days.map((day, dayIndex) => {
        const focus = document.querySelector(`[data-plan-field="focus"][data-day="${dayIndex}"]`)?.value || day.day;
        const intensity = document.querySelector(`[data-plan-field="intensity"][data-day="${dayIndex}"]`)?.value || 'Mittel';
        const duration = document.querySelector(`[data-plan-field="duration"][data-day="${dayIndex}"]`)?.value || '';

        const warmup = collectExercises(dayIndex, 'warmup');
        const exercises = collectExercises(dayIndex, 'exercise');
        const cooldown = collectExercises(dayIndex, 'cooldown');

        return {
            day: day.day,
            focus,
            intensity,
            duration,
            warmup,
            exercises,
            cooldown
        };
    });

    return { name, description, days };
}

function collectExercises(dayIndex, type) {
    const container = document.querySelector(`.${type}-rows[data-day="${dayIndex}"]`);
    if (!container) return [];
    return Array.from(container.children).map(row => {
        const name = row.querySelector(`[data-${type}-name="${dayIndex}"]`)?.value || '';
        if (!name) return null;
        const sets = row.querySelector(`[data-${type}-sets="${dayIndex}"]`)?.value || '';
        const reps = row.querySelector(`[data-${type}-reps="${dayIndex}"]`)?.value || '';
        const duration = row.querySelector(`[data-${type}-duration="${dayIndex}"]`)?.value || '';
        const ex = { name };
        if (sets) ex.sets = isNaN(sets) ? sets : parseInt(sets);
        if (reps) ex.reps = isNaN(reps) ? reps : parseInt(reps);
        if (duration) ex.duration = duration;
        return ex;
    }).filter(Boolean);
}

async function saveCurrentPlan() {
    try {
        updateSyncStatus('Speichere...');
        const planData = collectPlanFromEditor();
        const token = localStorage.getItem('token');

        // 1. In DB speichern / aktualisieren
        let planId = currentPlan.id;
        let saveUrl = '/api/training-plans';
        let method = 'POST';

        if (planId) {
            saveUrl = '/api/training-plans/' + planId;
            method = 'PUT';
        }

        const saveRes = await fetch(saveUrl, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                name: planData.name,
                description: planData.description,
                plan_data: planData,
                is_active: true
            })
        });

        if (!saveRes.ok) throw new Error('Speichern in DB fehlgeschlagen');
        const saveResult = await saveRes.json();
        planId = saveResult.id || planId;

        // 2. In Google Drive synchronisieren
        try {
            const syncRes = await fetch('/api/training-plans/' + planId + '/sync-drive', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const syncResult = await syncRes.json();
            if (syncRes.ok) {
                updateSyncStatus('✅ Gespeichert & mit Google Drive synchronisiert');
            } else {
                updateSyncStatus('✅ Lokal gespeichert (Drive: ' + (syncResult.error || 'nicht verfügbar') + ')');
            }
        } catch (syncErr) {
            console.warn('Drive-Sync fehlgeschlagen:', syncErr);
            updateSyncStatus('✅ Lokal gespeichert (Drive-Sync fehlgeschlagen)');
        }

        // Aktuellen Plan aktualisieren und Editor schließen
        currentPlan = planData;
        currentPlan.id = planId;
        planBeforeEdit = null;
        isPlanEditing = false;

        document.getElementById('plan-editor').style.display = 'none';
        document.getElementById('btn-edit-plan').style.display = '';
        document.getElementById('btn-save-plan').style.display = 'none';
        document.getElementById('btn-cancel-edit').style.display = 'none';

        renderPlan(currentPlan);
        setupPlanSelector();

    } catch (err) {
        console.error('Fehler beim Speichern:', err);
        alert('Fehler beim Speichern: ' + err.message);
        updateSyncStatus('❌ Fehler beim Speichern');
    }
}

function cancelPlanEdit() {
    if (planBeforeEdit) {
        currentPlan = planBeforeEdit;
    }
    planBeforeEdit = null;
    isPlanEditing = false;

    const editor = document.getElementById('plan-editor');
    if (editor) editor.style.display = 'none';

    const btnEdit = document.getElementById('btn-edit-plan');
    const btnSave = document.getElementById('btn-save-plan');
    const btnCancel = document.getElementById('btn-cancel-edit');
    if (btnEdit) btnEdit.style.display = '';
    if (btnSave) btnSave.style.display = 'none';
    if (btnCancel) btnCancel.style.display = 'none';

    if (currentPlan) renderPlan(currentPlan);
}
