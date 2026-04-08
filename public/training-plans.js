// Trainingsplan-Verwaltung für IronCoach
// Wird geladen wenn der Benutzer angemeldet ist

let trainingPlans = [];
let currentPlan = null;

// Initialisierung
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (token) {
        initTrainingPlans();
    }
});

async function initTrainingPlans() {
    await loadTrainingPlans();
    setupPlanSelector();
}

// Lädt alle Trainingspläne vom Server
async function loadTrainingPlans() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        
        const res = await fetch('/api/training-plans', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (!res.ok) throw new Error('Fehler beim Laden');
        
        trainingPlans = await res.json();
        
        // Falls Pläne vorhanden, aktiven laden oder ersten
        const active = trainingPlans.find(p => p.is_active) || trainingPlans[0];
        if (active && !currentPlan) {
            await loadPlan(active.id);
        }
        
    } catch (err) {
        console.error('Pläne laden fehlgeschlagen:', err);
    }
}

// Setup Plan Selector Dropdown
function setupPlanSelector() {
    const select = document.getElementById('plan-select');
    if (!select) return;
    
    // Standard-Option
    select.innerHTML = '<option value="">📋 Standard-Plan</option>';
    
    trainingPlans.forEach(plan => {
        const opt = document.createElement('option');
        opt.value = plan.id;
        opt.textContent = (plan.is_active ? '● ' : '') + plan.name;
        if (plan.is_active) opt.selected = true;
        select.appendChild(opt);
    });
    
    select.onchange = (e) => {
        if (e.target.value) loadPlan(e.target.value);
    };
}

// Lädt einen spezifischen Plan
async function loadPlan(planId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/training-plans/${planId}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (!res.ok) throw new Error('Plan nicht gefunden');
        
        currentPlan = await res.json();
        renderPlan(currentPlan.plan_data);
        
    } catch (err) {
        console.error('Plan laden fehlgeschlagen:', err);
    }
}

// Rendert den Plan (überschreibt den hardcoded Plan)
function renderPlan(planData) {
    if (!planData || !planData.days) return;
    
    // Titel aktualisieren
    const title = document.querySelector('#plan-panel h2');
    if (title) title.textContent = '📋 ' + (planData.name || 'Trainingsplan');
    
    // TODO: Dynamisches Rendering der Tage
    // Derzeit bleibt der hardcoded Plan sichtbar als Fallback
    console.log('Plan geladen:', planData.name);
}

// Vorlage herunterladen
async function downloadPlanTemplate() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/training-plans/template/download', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (!res.ok) throw new Error('Download fehlgeschlagen');
        
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ironcoach-training-template.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
    } catch (err) {
        alert('Fehler beim Download: ' + err.message);
    }
}

// Plan hochladen
async function uploadTrainingPlan(input) {
    try {
        const file = input.files[0];
        if (!file) return;
        
        const text = await file.text();
        const planData = JSON.parse(text);
        
        if (!planData.name || !planData.days) {
            throw new Error('Ungültiges Format: name und days[] erforderlich');
        }
        
        const token = localStorage.getItem('token');
        const res = await fetch('/api/training-plans', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                name: planData.name,
                description: planData.description || 'Hochgeladener Plan',
                plan_data: planData,
                is_active: true
            })
        });
        
        if (!res.ok) throw new Error('Upload fehlgeschlagen');
        
        const result = await res.json();
        alert(`Plan "${result.name}" hochgeladen!`);
        
        // Neu laden
        await loadTrainingPlans();
        setupPlanSelector();
        
    } catch (err) {
        alert('Fehler: ' + err.message);
    } finally {
        input.value = '';
    }
}