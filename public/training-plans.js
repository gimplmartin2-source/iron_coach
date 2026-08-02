// Trainingsplan-Verwaltung für IronCoach
// In-App Editor + automatische Google Drive Synchronisation

let trainingPlans = [];
let currentPlan = null;
let currentPlanId = null;
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
    await loadTrainingPlansList();
}

// --- PLAN LISTE ---

async function loadTrainingPlansList() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const res = await fetch('/api/training-plans', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Fehler beim Laden der Pläne');

        trainingPlans = await res.json();

        if (trainingPlans.length === 0) {
            await loadDefaultPlanAndSave();
        } else {
            const active = trainingPlans.find(p => p.is_active);
            if (active && active.id !== currentPlanId) {
                await loadPlan(active.id);
            } else if (!currentPlanId) {
                await loadPlan(trainingPlans[0].id);
            } else {
                setupPlanSelector();
            }
        }
    } catch (err) {
        console.error('Pläneliste laden fehlgeschlagen:', err);
        updateSyncStatus('Fehler beim Laden der Pläne');
        await loadDefaultPlan();
    }
}

async function loadDefaultPlanAndSave() {
    try {
        const res = await fetch('/default-training-plan.json');
        if (!res.ok) throw new Error('Default-Plan nicht gefunden');
        const planData = await res.json();

        const token = localStorage.getItem('token');
        const saveRes = await fetch('/api/training-plans', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token
            },
            body: JSON.stringify({
                name: planData.name || 'Mein Trainingsplan',
                description: planData.description || '',
                plan_data: planData,
                is_active: true
            })
        });
        if (!saveRes.ok) throw new Error('Default-Plan speichern fehlgeschlagen');
        const saved = await saveRes.json();
        currentPlanId = saved.id;
        currentPlan = planData;
        updateSyncStatus('Standard-Plan angelegt');
        await loadTrainingPlansList();
    } catch (err) {
        console.error('Default-Plan anlegen fehlgeschlagen:', err);
        await loadDefaultPlan();
    }
}

async function loadDefaultPlan() {
    try {
        const res = await fetch('/default-training-plan.json');
        if (!res.ok) throw new Error('Default-Plan nicht gefunden');
        const planData = await res.json();
        currentPlan = planData;
        currentPlanId = null;
        renderPlan(planData);
        updateSyncStatus('Standard-Plan geladen (noch nicht gespeichert)');
        setupPlanSelector();
    } catch (err) {
        console.error('Default-Plan laden fehlgeschlagen:', err);
        updateSyncStatus('Fehler beim Laden des Standard-Plans');
    }
}

async function loadPlan(planId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/training-plans/' + planId, {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Plan nicht gefunden');
        const row = await res.json();

        currentPlanId = row.id;
        currentPlan = row.plan_data || {};
        currentPlan.name = row.name || currentPlan.name || 'Trainingsplan';
        currentPlan.description = row.description || currentPlan.description || '';

        renderPlan(currentPlan);
        updateSyncStatus('Plan geladen');
        setupPlanSelector();
    } catch (err) {
        console.error('Plan laden fehlgeschlagen:', err);
        updateSyncStatus('Fehler: Plan konnte nicht geladen werden');
    }
}

function setupPlanSelector() {
    const select = document.getElementById('plan-select');
    if (!select) return;

    select.innerHTML = '';

    trainingPlans.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = (p.is_active ? '⭐ ' : '') + (p.name || 'Plan ' + p.id);
        opt.selected = (p.id === currentPlanId);
        select.appendChild(opt);
    });

    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ Neuer Plan';
    select.appendChild(newOpt);

    select.onchange = (e) => {
        const val = e.target.value;
        if (val === '__new__') {
            createNewPlan();
        } else if (val) {
            loadPlan(parseInt(val));
        }
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
            '<table class="plan-table interactive-plan-table"><tr><th>✓</th><th>Übung</th><th>kg</th><th>Sätze</th><th>Wdh/Dauer</th></tr>' +
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
    const weightPart = ex.weight ? ex.weight + 'kg ' : '';
    const display = ex.duration
        ? weightPart + (ex.sets || 1) + ' x ' + ex.duration
        : weightPart + (ex.sets || '-') + ' x ' + (ex.reps || '-');
    return '<li class="plan-exercise"><label class="checkbox-container"><input type="checkbox" class="plan-check" data-exercise="' + ex.name + '" data-sets="' + (ex.sets || 1) + '" data-reps="' + (ex.reps || 1) + '" data-duration="' + (ex.duration || '') + '"><span class="checkmark"></span></label>' + ex.name + ': ' + display + '</li>';
}

function renderExerciseRow(ex) {
    const hasDuration = ex.duration && (ex.duration.includes('Min') || ex.duration.includes('Sek'));
    const repsDisplay = hasDuration ? ex.duration : (ex.reps || '-');
    const mainStyle = ex.isMain ? 'background: rgba(255,215,0,0.12); border-left: 3px solid #ffd700;' : '';
    const mainIcon = ex.isMain ? '<span title="Hauptübung" style="margin-right: 4px;">👑</span>' : '';
    const mainClass = ex.isMain ? 'plan-main-exercise' : '';
    return '<tr class="plan-exercise-row ' + mainClass + '" data-exercise="' + ex.name + '" data-sets="' + (ex.sets || '') + '" data-reps="' + (ex.reps || '') + '" data-weight="' + (ex.weight || '') + '" data-duration="' + (ex.duration || '') + '" data-main="' + (ex.isMain ? '1' : '0') + '" style="' + mainStyle + '"><td><label class="checkbox-container"><input type="checkbox" class="plan-check"><span class="checkmark"></span></label></td><td style="font-weight: ' + (ex.isMain ? '700' : '400') + '; color: ' + (ex.isMain ? '#ffd700' : '#fff') + ';">' + mainIcon + (ex.name || '') + '</td><td>' + (ex.weight || '-') + '</td><td>' + (ex.sets || '-') + '</td><td>' + repsDisplay + '</td></tr>';
}

function updateSyncStatus(message) {
    const el = document.getElementById('plan-sync-status');
    if (el) el.textContent = message;
}

function isPlanActive(planId) {
    const p = trainingPlans.find(x => x.id === planId);
    return p ? p.is_active : false;
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
    ex = ex || { name: '', weight: '', sets: '', reps: '', duration: '' };
    const isMain = type === 'exercise' && ex.isMain === true;
    const mainIndicator = isMain ? `<span title="Hauptübung" style="color: #ffd700; font-size: 0.9rem;">👑</span>` : '';
    const mainCheckbox = type === 'exercise' ? `
        <label title="Als Hauptübung markieren" style="display: flex; align-items: center; justify-content: center; gap: 4px; color: #fff; cursor: pointer; font-size: 0.75rem; white-space: nowrap;">
            <input type="checkbox" data-${type}-main="${dayIndex}" ${isMain ? 'checked' : ''} style="accent-color: #00d4ff;">
            <span>Haupt</span>
        </label>
    ` : '';

    return `
    <div class="${type}-row" style="display: grid; grid-template-columns: 2fr 0.9fr 0.7fr 0.7fr 1fr auto auto; gap: 6px; margin-bottom: 6px; align-items: center;">
        <div style="display: flex; align-items: center; gap: 6px;">
            <input type="text" data-${type}-name="${dayIndex}" placeholder="Übung" value="${escapeHtml(ex.name || '')}" style="flex: 1; padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff; ${isMain ? 'border-color: #ffd700; box-shadow: 0 0 5px rgba(255,215,0,0.3);' : ''}">
            ${mainIndicator}
        </div>
        <input type="text" data-${type}-weight="${dayIndex}" placeholder="kg" value="${escapeHtml(ex.weight != null ? ex.weight : '')}" style="padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
        <input type="text" data-${type}-sets="${dayIndex}" placeholder="Sätze" value="${escapeHtml(ex.sets != null ? ex.sets : '')}" style="padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
        <input type="text" data-${type}-reps="${dayIndex}" placeholder="Wdh" value="${escapeHtml(ex.reps != null ? ex.reps : '')}" style="padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
        <input type="text" data-${type}-duration="${dayIndex}" placeholder="Dauer" value="${escapeHtml(ex.duration || '')}" style="padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
        ${mainCheckbox}
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
    // Neue Übung aus dem Pool der existierenden Übungen auswählen
    openPlanExerciseSelector(dayIndex, type);
}

function removeExerciseRow(btn) {
    btn.parentElement.remove();
}

// Modal: Übung aus dem eigenen Übungspool für den Plan auswählen
async function openPlanExerciseSelector(dayIndex, type) {
    if (!exercises || exercises.length === 0) {
        // Versuche, Übungen automatisch nachzuladen, falls die App sie noch nicht geladen hat
        if (typeof loadExercises === 'function') {
            try {
                await loadExercises();
            } catch (e) {
                console.error('Fehler beim Nachladen der Übungen:', e);
            }
        }
    }
    if (!exercises || exercises.length === 0) {
        alert('Keine Übungen verfügbar. Bitte lade die Seite neu oder erstelle zuerst eine Übung.');
        return;
    }

    // Vorhandenes Modal schließen
    const existing = document.getElementById('plan-exercise-selector-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'plan-exercise-selector-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.92);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3000;
        animation: fadeIn 0.2s ease-out;
        padding: 20px;
    `;

    // Nach Muskelgruppe gruppieren
    const grouped = {};
    exercises.forEach(e => {
        const category = e.muscle_group || 'Sonstige';
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push(e);
    });

    const categoryOrder = ['Brust', 'Rücken', 'Schultern', 'Beine', 'Arme', 'Bauch', 'Ganzkörper', 'Dehnen', 'Mobilität', 'Judo', 'Core', 'Sonstige'];
    const sortedCategories = Object.keys(grouped).sort((a, b) => {
        const idxA = categoryOrder.indexOf(a);
        const idxB = categoryOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b, 'de');
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });

    sortedCategories.forEach(cat => {
        grouped[cat].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    });

    let categoriesHtml = '';
    let exercisesHtml = '';
    sortedCategories.forEach((cat, index) => {
        const isFirst = index === 0;
        categoriesHtml += `<button type="button" class="plan-cat-btn ${isFirst ? 'active' : ''}" data-category="${escapeHtml(cat)}" onclick="selectPlanCategory('${escapeHtml(cat)}')" style="padding: 10px 18px; margin: 5px; background: ${isFirst ? 'linear-gradient(45deg, #00d4ff, #7b2cbf)' : 'rgba(255,255,255,0.1)'}; border: none; border-radius: 8px; color: #fff; cursor: pointer; transition: all 0.2s; font-size: 0.9rem;">${escapeHtml(cat)}</button>`;

        const display = isFirst ? 'grid' : 'none';
        exercisesHtml += `<div class="plan-exercise-grid" id="plan-exercises-${escapeHtml(cat)}" style="display: ${display}; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; margin-top: 15px;">`;
        grouped[cat].forEach(e => {
            exercisesHtml += `
                <button type="button" class="plan-exercise-option" data-exercise-id="${e.id}" data-exercise-name="${escapeHtml(e.name)}" onclick="selectPlanExerciseOption(this)" style="padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff; cursor: pointer; text-align: left; transition: all 0.2s;">
                    <div style="font-weight: 600; color: #00d4ff;">${escapeHtml(e.name)}</div>
                    <div style="font-size: 0.8rem; color: #888;">${escapeHtml(e.exercise_type || 'strength')}</div>
                </button>`;
        });
        exercisesHtml += '</div>';
    });

    const isMainAllowed = type === 'exercise';

    modal.innerHTML = `
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border: 1px solid rgba(0,212,255,0.3); border-radius: 16px; padding: 24px; width: 100%; max-width: 700px; max-height: 90vh; overflow-y: auto; animation: slideUp 0.3s ease-out;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; color: #00d4ff;">➕ Übung für ${escapeHtml(dayLabels[dayIndex])} hinzufügen</h3>
                <button onclick="closePlanExerciseSelector()" style="background: none; border: none; color: #888; font-size: 1.5rem; cursor: pointer;">×</button>
            </div>

            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; color: #888; font-size: 0.9rem;">Kategorie:</label>
                <div style="display: flex; flex-wrap: wrap; justify-content: center;">${categoriesHtml}</div>
            </div>

            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: #888; font-size: 0.9rem;">Übung auswählen:</label>
                ${exercisesHtml}
            </div>

            <div id="plan-selected-exercise-preview" style="margin-bottom: 20px; padding: 12px; background: rgba(0,212,255,0.1); border-radius: 8px; border: 1px solid rgba(0,212,255,0.2); display: none;">
                <div style="color: #00d4ff; font-weight: 600; margin-bottom: 10px;" id="plan-selected-exercise-name">Keine Übung ausgewählt</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                    <div>
                        <label style="display: block; color: #888; font-size: 0.8rem; margin-bottom: 4px;">Sätze</label>
                        <input type="number" id="plan-add-sets" value="3" min="1" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
                    </div>
                    <div>
                        <label style="display: block; color: #888; font-size: 0.8rem; margin-bottom: 4px;">Wiederholungen</label>
                        <input type="number" id="plan-add-reps" value="10" min="1" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
                    </div>
                    <div>
                        <label style="display: block; color: #888; font-size: 0.8rem; margin-bottom: 4px;">Dauer</label>
                        <input type="text" id="plan-add-duration" placeholder="z.B. 30 Sek" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; color: #fff;">
                    </div>
                </div>
                ${isMainAllowed ? `
                <label style="display: flex; align-items: center; gap: 8px; color: #fff; cursor: pointer; font-size: 0.95rem;">
                    <input type="checkbox" id="plan-add-main" style="width: 18px; height: 18px; accent-color: #00d4ff;">
                    <span>👑 Als Hauptübung markieren</span>
                </label>
                ` : ''}
            </div>

            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button onclick="closePlanExerciseSelector()" class="btn-secondary">Abbrechen</button>
                <button onclick="confirmAddPlanExercise(${dayIndex}, '${type}')" class="btn-primary" id="plan-add-confirm-btn" disabled>Hinzufügen</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function closePlanExerciseSelector() {
    const modal = document.getElementById('plan-exercise-selector-modal');
    if (modal) modal.remove();
}

function selectPlanCategory(category) {
    document.querySelectorAll('.plan-cat-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'rgba(255,255,255,0.1)';
        if (btn.dataset.category === category) {
            btn.classList.add('active');
            btn.style.background = 'linear-gradient(45deg, #00d4ff, #7b2cbf)';
        }
    });
    document.querySelectorAll('.plan-exercise-grid').forEach(grid => {
        grid.style.display = grid.id === 'plan-exercises-' + category ? 'grid' : 'none';
    });
}

let selectedPlanExerciseName = null;

function selectPlanExerciseOption(btn) {
    document.querySelectorAll('.plan-exercise-option').forEach(opt => {
        opt.style.background = 'rgba(255,255,255,0.05)';
        opt.style.borderColor = 'rgba(255,255,255,0.2)';
    });
    btn.style.background = 'rgba(0,212,255,0.2)';
    btn.style.borderColor = '#00d4ff';

    selectedPlanExerciseName = btn.dataset.exerciseName;
    const preview = document.getElementById('plan-selected-exercise-preview');
    const nameEl = document.getElementById('plan-selected-exercise-name');
    const confirmBtn = document.getElementById('plan-add-confirm-btn');

    if (preview && nameEl && confirmBtn) {
        preview.style.display = 'block';
        nameEl.textContent = selectedPlanExerciseName;
        confirmBtn.disabled = false;
    }
}

function confirmAddPlanExercise(dayIndex, type) {
    if (!selectedPlanExerciseName) return;

    const sets = document.getElementById('plan-add-sets')?.value || '3';
    const reps = document.getElementById('plan-add-reps')?.value || '10';
    const duration = document.getElementById('plan-add-duration')?.value || '';
    const isMain = type === 'exercise' ? (document.getElementById('plan-add-main')?.checked || false) : false;

    const ex = {
        name: selectedPlanExerciseName,
        sets: sets ? parseInt(sets) || sets : '',
        reps: reps ? parseInt(reps) || reps : '',
        duration: duration
    };
    if (isMain) ex.isMain = true;

    const container = document.querySelector(`.${type}-rows[data-day="${dayIndex}"]`);
    if (container) {
        const exIndex = container.children.length;
        const row = document.createElement('div');
        row.innerHTML = renderExerciseEditRow(type, dayIndex, exIndex, ex);
        container.appendChild(row.firstElementChild);
    }

    selectedPlanExerciseName = null;
    closePlanExerciseSelector();
}

function collectPlanFromEditor() {
    const name = document.getElementById('plan-edit-name')?.value || 'Mein Trainingsplan';
    const description = document.getElementById('plan-edit-description')?.value || '';

    // Sicherstellen, dass immer 7 Tage vorhanden sind (auch wenn der Plan ein anderes Format hat)
    const baseDays = (currentPlan && currentPlan.days) || [];
    const days = dayLabels.map((label, dayIndex) => {
        const day = baseDays[dayIndex] || { day: label, focus: label, intensity: 'Mittel', duration: '60 Min' };
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
        const name = row.querySelector(`[data-${type}-name="${dayIndex}"]`)?.value?.trim() || '';
        const weight = row.querySelector(`[data-${type}-weight="${dayIndex}"]`)?.value || '';
        const sets = row.querySelector(`[data-${type}-sets="${dayIndex}"]`)?.value || '';
        const reps = row.querySelector(`[data-${type}-reps="${dayIndex}"]`)?.value || '';
        const duration = row.querySelector(`[data-${type}-duration="${dayIndex}"]`)?.value || '';
        const isMain = type === 'exercise' ? (row.querySelector(`[data-${type}-main="${dayIndex}"]`)?.checked || false) : false;

        // Übung wird gespeichert, wenn mindestens ein Feld ausgefüllt ist.
        // Felder dürfen einzeln leer bleiben und werden dann nicht im JSON gesetzt.
        if (!name && !weight && !sets && !reps && !duration) return null;

        const ex = { name };
        if (weight) ex.weight = isNaN(weight) ? weight : parseFloat(weight);
        if (sets) ex.sets = isNaN(sets) ? sets : parseInt(sets);
        if (reps) ex.reps = isNaN(reps) ? reps : parseInt(reps);
        if (duration) ex.duration = duration;
        if (isMain) ex.isMain = true;
        return ex;
    }).filter(Boolean);
}

async function saveCurrentPlan() {
    try {
        updateSyncStatus('Speichere...');
        const planData = collectPlanFromEditor();
        const token = localStorage.getItem('token');

        let planId = currentPlanId;
        let saveUrl = '/api/training-plans';
        let method = 'POST';
        const wasNew = !planId;

        if (planId) {
            saveUrl = '/api/training-plans/' + planId;
            method = 'PUT';
        }

        // Neuer Plan oder Plan aus Editor soll immer aktiv werden, damit der Nutzer ihn sofort sieht
        const isActive = true;

        const saveRes = await fetch(saveUrl, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token
            },
            body: JSON.stringify({
                name: planData.name,
                description: planData.description,
                plan_data: planData,
                is_active: isActive
            })
        });

        if (!saveRes.ok) {
            let errMsg = 'Speichern in DB fehlgeschlagen';
            try {
                const errBody = await saveRes.json();
                errMsg = errBody.error || errBody.message || errMsg;
            } catch (e) {
                errMsg = saveRes.status + ' ' + saveRes.statusText;
            }
            throw new Error(errMsg);
        }

        const saveResult = await saveRes.json();
        planId = saveResult.id || planId;
        currentPlanId = planId;

        if (isActive) {
            try {
                const syncController = new AbortController();
                const syncTimeout = setTimeout(() => syncController.abort(), 15000);
                const syncRes = await fetch('/api/training-plans/' + planId + '/sync-drive', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + token },
                    signal: syncController.signal
                });
                clearTimeout(syncTimeout);
                const syncResult = await syncRes.json();
                if (syncRes.ok) {
                    updateSyncStatus('✅ Gespeichert & mit Google Drive synchronisiert');
                } else if (syncRes.status >= 500) {
                    updateSyncStatus('✅ Lokal gespeichert (Drive-Server temporär nicht erreichbar)');
                    console.warn('Drive-Sync Server-Fehler:', syncResult.error || syncRes.statusText);
                } else {
                    updateSyncStatus('✅ Lokal gespeichert (Drive: ' + (syncResult.error || 'nicht verfügbar') + ')');
                }
            } catch (syncErr) {
                if (syncErr.name === 'AbortError') {
                    updateSyncStatus('✅ Lokal gespeichert (Drive-Sync Zeitüberschreitung)');
                    console.warn('Drive-Sync Timeout (15s)');
                } else {
                    updateSyncStatus('✅ Lokal gespeichert (Drive-Sync fehlgeschlagen)');
                    console.warn('Drive-Sync fehlgeschlagen:', syncErr);
                }
            }
        } else {
            updateSyncStatus('✅ Plan gespeichert (inaktiv, keine Drive-Sync)');
        }

        currentPlan = planData;
        planBeforeEdit = null;
        isPlanEditing = false;

        document.getElementById('plan-editor').style.display = 'none';
        document.getElementById('btn-edit-plan').style.display = '';
        document.getElementById('btn-save-plan').style.display = 'none';
        document.getElementById('btn-cancel-edit').style.display = 'none';

        renderPlan(currentPlan);
        await loadTrainingPlansList();

    } catch (err) {
        console.error('Fehler beim Speichern:', err);
        alert('Fehler beim Speichern: ' + err.message);
        updateSyncStatus('❌ Fehler beim Speichern: ' + err.message);
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

async function createNewPlan() {
    const token = localStorage.getItem('token');
    if (!token) {
        alert('Fehler: Nicht eingeloggt. Bitte melde dich erneut an.');
        updateSyncStatus('❌ Nicht eingeloggt');
        return;
    }
    const empty = createEmptyPlan();

    try {
        updateSyncStatus('Lege neuen Plan an...');
        const res = await fetch('/api/training-plans', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token
            },
            body: JSON.stringify({
                name: empty.name,
                description: '',
                plan_data: empty,
                is_active: true
            })
        });
        if (!res.ok) {
            let errMsg = 'Neuer Plan konnte nicht angelegt werden';
            try {
                const errBody = await res.json();
                errMsg = errBody.error || errBody.message || errMsg;
            } catch (e) {
                errMsg = res.status + ' ' + res.statusText;
            }
            throw new Error(errMsg);
        }
        const saved = await res.json();
        currentPlanId = saved.id;
        currentPlan = empty;
        await loadTrainingPlansList();
        togglePlanEditor();
    } catch (err) {
        console.error('Neuer Plan fehlgeschlagen:', err);
        alert('Fehler: ' + err.message);
        updateSyncStatus('❌ Neuer Plan fehlgeschlagen: ' + err.message);
    }
}

async function duplicateCurrentPlan() {
    if (!currentPlan) return;
    const token = localStorage.getItem('token');
    const copy = JSON.parse(JSON.stringify(currentPlan));
    copy.name = (copy.name || 'Plan') + ' (Kopie)';

    try {
        updateSyncStatus('Dupliziere Plan...');
        const res = await fetch('/api/training-plans', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token
            },
            body: JSON.stringify({
                name: copy.name,
                description: copy.description || '',
                plan_data: copy,
                is_active: false
            })
        });
        if (!res.ok) throw new Error('Plan konnte nicht dupliziert werden');
        const saved = await res.json();
        await loadTrainingPlansList();
        await loadPlan(saved.id);
    } catch (err) {
        console.error('Duplizieren fehlgeschlagen:', err);
        alert('Fehler: ' + err.message);
        updateSyncStatus('❌ Duplizieren fehlgeschlagen');
    }
}

async function deleteCurrentPlan() {
    if (!currentPlanId) {
        alert('Dieser Plan ist noch nicht gespeichert.');
        return;
    }
    const p = trainingPlans.find(x => x.id === currentPlanId);
    if (!confirm('Plan "' + (p?.name || currentPlanId) + '" wirklich löschen?')) return;

    const token = localStorage.getItem('token');
    try {
        updateSyncStatus('Lösche Plan...');
        const res = await fetch('/api/training-plans/' + currentPlanId, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Plan konnte nicht gelöscht werden');
        currentPlanId = null;
        currentPlan = null;
        await loadTrainingPlansList();
    } catch (err) {
        console.error('Löschen fehlgeschlagen:', err);
        alert('Fehler: ' + err.message);
        updateSyncStatus('❌ Löschen fehlgeschlagen');
    }
}

async function setCurrentPlanActive() {
    if (!currentPlanId) {
        alert('Speichere den Plan erst, bevor du ihn als aktiv markierst.');
        return;
    }
    const token = localStorage.getItem('token');
    try {
        updateSyncStatus('Setze Plan als aktiv...');
        const res = await fetch('/api/training-plans/' + currentPlanId + '/activate', {
            method: 'PATCH',
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Aktivieren fehlgeschlagen');
        await loadTrainingPlansList();
        updateSyncStatus('⭐ Dieser Plan ist jetzt aktiv');
    } catch (err) {
        console.error('Aktivieren fehlgeschlagen:', err);
        alert('Fehler: ' + err.message);
        updateSyncStatus('❌ Aktivieren fehlgeschlagen');
    }
}
