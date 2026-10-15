// Sprach-Eintrag: Aufnahme im Browser -> WAV 16 kHz -> POST /api/voice/transcribe
// (lokales Whisper auf dem PC) -> Vorschau der erkannten Übungen -> Speichern über
// das bestehende POST /api/workouts. Es werden nur Übungen aus der eigenen Liste
// gespeichert; unbekannte/mehrdeutige Einträge blockieren, bis sie aufgelöst sind.
(function () {
    'use strict';

    const MAX_SECONDS = 90;
    const AUTO_SAVE_KEY = 'ironcoach.voice.autosave';

    let recorder = null;
    let stream = null;
    let chunks = [];
    let timerId = null;
    let startedAt = 0;
    let currentEntries = [];
    let lastTranscript = '';

    const $ = id => document.getElementById(id);

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function setStatus(text, kind) {
        const el = $('voice-status');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'voice-status' + (kind ? ' voice-status-' + kind : '');
    }

    function allExercises() {
        return (typeof exercises !== 'undefined' && Array.isArray(exercises)) ? exercises : [];
    }

    function localToday() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // ---------------------------------------------------------------- Aufnahme

    async function toggleRecording() {
        if (recorder && recorder.state === 'recording') {
            recorder.stop();
            return;
        }
        if (!navigator.mediaDevices || !window.MediaRecorder) {
            setStatus('Mikrofon nicht verfügbar – nur über HTTPS (Tailscale-Adresse) oder localhost möglich. Alternativ Text unten eintippen.', 'error');
            $('voice-text-wrap').open = true;
            return;
        }
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
        } catch (err) {
            setStatus('Kein Mikrofonzugriff: ' + err.message, 'error');
            return;
        }
        chunks = [];
        const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        const mimeType = preferred.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = onRecordingStopped;
        recorder.start();
        startedAt = Date.now();
        $('voice-record-btn').classList.add('recording');
        $('voice-record-label').textContent = 'Stopp';
        timerId = setInterval(() => {
            const s = Math.floor((Date.now() - startedAt) / 1000);
            setStatus(`🔴 Aufnahme läuft … ${s}s (nochmal tippen zum Beenden)`, 'rec');
            if (s >= MAX_SECONDS) recorder.stop();
        }, 250);
        setStatus('🔴 Aufnahme läuft … sag z.B. „Liegestütz, 3 Sätze à 20“', 'rec');
    }

    async function onRecordingStopped() {
        clearInterval(timerId);
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = null;
        $('voice-record-btn').classList.remove('recording');
        $('voice-record-label').textContent = 'Aufnehmen';

        const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
        recorder = null;
        if ((Date.now() - startedAt) < 700 || blob.size < 1000) {
            setStatus('Aufnahme zu kurz.', 'error');
            return;
        }
        setBusy(true);
        setStatus('⏳ Wird auf dem PC transkribiert …', 'busy');
        try {
            let body = blob;
            try {
                body = await toWav16k(blob); // kleiner + Whisper braucht dann kein ffmpeg
            } catch (convErr) {
                console.warn('⚠️ WAV-Konvertierung fehlgeschlagen, sende Original:', convErr);
            }
            const res = await apiFetch('/api/voice/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': body.type || 'application/octet-stream' },
                body
            });
            await handleParseResponse(res);
        } catch (err) {
            setStatus('Fehler: ' + err.message, 'error');
        } finally {
            setBusy(false);
        }
    }

    // Dekodiert die Aufnahme und rechnet sie auf 16 kHz Mono PCM-WAV herunter
    async function toWav16k(blob) {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        let decoded;
        try {
            decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
        } finally {
            if (ctx.close) ctx.close();
        }
        const rate = 16000;
        const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
        const src = offline.createBufferSource();
        src.buffer = decoded;
        src.connect(offline.destination);
        src.start();
        const rendered = await offline.startRendering();
        const pcm = rendered.getChannelData(0);

        const buffer = new ArrayBuffer(44 + pcm.length * 2);
        const v = new DataView(buffer);
        const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
        str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
        for (let i = 0, o = 44; i < pcm.length; i++, o += 2) {
            const s = Math.max(-1, Math.min(1, pcm[i]));
            v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        return new Blob([buffer], { type: 'audio/wav' });
    }

    // ---------------------------------------------------------------- Text auswerten

    async function parseText() {
        const text = $('voice-text').value.trim();
        if (!text) { setStatus('Bitte Text eingeben.', 'error'); return; }
        setBusy(true);
        setStatus('⏳ Wird ausgewertet …', 'busy');
        try {
            const res = await apiFetch('/api/voice/parse', { method: 'POST', body: JSON.stringify({ text }) });
            await handleParseResponse(res);
        } catch (err) {
            setStatus('Fehler: ' + err.message, 'error');
        } finally {
            setBusy(false);
        }
    }

    async function handleParseResponse(res) {
        if (!res) { setStatus('Keine Antwort vom Server.', 'error'); return; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            setStatus('❌ ' + (data.error || `Serverfehler ${res.status}`), 'error');
            if (data.text !== undefined) $('voice-text').value = data.text;
            return;
        }
        $('voice-text').value = data.text || '';
        lastTranscript = data.text || '';
        currentEntries = (data.entries || []).map(e => ({ ...e }));
        renderEntries(data);

        const allOk = currentEntries.length > 0 && currentEntries.every(e => e.status === 'ok' && !e.review);
        if (!currentEntries.length) {
            setStatus('❌ ' + (data.error || 'Keine Übung erkannt'), 'error');
        } else if (allOk && $('voice-autosave').checked) {
            await saveEntries();
        } else if (allOk) {
            setStatus(`✅ ${currentEntries.length} Eintrag/Einträge erkannt – prüfen und „Eintragen“ tippen.`, 'ok');
        } else {
            const bad = currentEntries.filter(e => e.status !== 'ok').length;
            setStatus(`⚠️ ${bad} Eintrag/Einträge mit Fehler – Übung auswählen/korrigieren oder entfernen.`, 'error');
        }
    }

    // ---------------------------------------------------------------- Vorschau

    function exerciseOptions(entry) {
        const all = allExercises().slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));
        const cands = entry.candidates || [];
        const selectedId = entry.exercise ? entry.exercise.id : '';
        let html = `<option value="">— Übung wählen —</option>`;
        if (cands.length) {
            html += '<optgroup label="Vorschläge">' + cands.map(c =>
                `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + '</optgroup>';
        }
        html += '<optgroup label="Alle Übungen">' + all.map(e =>
            `<option value="${e.id}" ${e.id === selectedId && !cands.some(c => c.id === e.id) ? 'selected' : ''}>${esc(e.name)}</option>`).join('') + '</optgroup>';
        return html;
    }

    function renderEntries(data) {
        const box = $('voice-result');
        if (!currentEntries.length) { box.innerHTML = ''; box.hidden = true; return; }
        box.hidden = false;
        const parserNote = data && data.parser === 'llm' ? ' · ausgewertet mit lokalem LLM' : '';
        box.innerHTML = currentEntries.map((e, i) => {
            const isTime = e.exercise ? e.exercise.exercise_type === 'time' : false;
            const icon = e.status === 'ok' ? (e.review ? '⚠️' : '✅') : '❌';
            const fields = isTime
                ? `<label>Sätze<input type="number" min="1" data-i="${i}" data-f="sets" value="${e.sets ?? ''}"></label>
                   <label>Sek.<input type="number" min="1" data-i="${i}" data-f="duration_seconds" value="${e.duration_seconds ?? ''}"></label>`
                : `<label>Sätze<input type="number" min="1" data-i="${i}" data-f="sets" value="${e.sets ?? ''}"></label>
                   <label>Wdh.<input type="number" min="1" data-i="${i}" data-f="reps" value="${e.reps ?? ''}"></label>
                   <label>kg<input type="number" min="0" step="0.5" data-i="${i}" data-f="weight" value="${e.weight ?? 0}"></label>`;
            const msgs = [e.error, ...(e.warnings || [])].filter(Boolean).map(m => `<div class="voice-entry-msg">${esc(m)}</div>`).join('');
            return `<div class="voice-entry voice-entry-${e.status}${e.review ? ' voice-entry-review' : ''}">
                <div class="voice-entry-head">
                    <span class="voice-entry-icon">${icon}</span>
                    <select data-i="${i}" data-f="exercise">${exerciseOptions(e)}</select>
                    <button type="button" class="voice-entry-remove" data-remove="${i}" title="Entfernen">✕</button>
                </div>
                <div class="voice-entry-fields">${fields}</div>
                ${msgs}
            </div>`;
        }).join('') + `<div class="voice-actions">
                <button type="button" class="btn-primary" id="voice-save-btn">✅ Eintragen</button>
                <button type="button" class="btn-secondary" id="voice-discard-btn">Verwerfen</button>
                <span class="voice-note">${esc(parserNote)}</span>
            </div>`;
        $('voice-save-btn').onclick = saveEntries;
        $('voice-discard-btn').onclick = () => { currentEntries = []; renderEntries(); setStatus(''); };
        updateSaveButton();
    }

    function revalidate(e) {
        if (!e.exercise) {
            e.status = e.status === 'ok' ? 'unknown' : e.status;
            return;
        }
        const isTime = e.exercise.exercise_type === 'time';
        const okSets = Number.isInteger(e.sets) && e.sets >= 1 && e.sets <= 50;
        const okMain = isTime ? (e.duration_seconds > 0) : (Number.isInteger(e.reps) && e.reps >= 1 && e.reps <= 1000);
        const okWeight = isTime || (e.weight >= 0 && e.weight <= 500);
        e.status = okSets && okMain && okWeight ? 'ok' : 'incomplete';
        e.error = e.status === 'ok' ? null : (isTime ? 'Sätze/Dauer prüfen' : 'Sätze/Wiederholungen/Gewicht prüfen');
    }

    function onResultChange(ev) {
        const t = ev.target;
        const i = parseInt(t.dataset.i, 10);
        if (isNaN(i) || !currentEntries[i]) return;
        const e = currentEntries[i];
        if (t.dataset.f === 'exercise') {
            const ex = allExercises().find(x => x.id === parseInt(t.value, 10));
            const wasTime = e.exercise && e.exercise.exercise_type === 'time';
            e.exercise = ex ? { id: ex.id, name: ex.name, exercise_type: ex.exercise_type || 'strength' } : null;
            e.review = false;
            e.warnings = [];
            const isTime = e.exercise && e.exercise.exercise_type === 'time';
            if (isTime && !wasTime) { e.weight = 0; if (!e.duration_seconds && e.reps) e.duration_seconds = e.reps; e.reps = 0; }
            if (!isTime && wasTime) { e.duration_seconds = null; e.reps = null; }
            revalidate(e);
            renderEntries();
            return;
        }
        const val = t.value === '' ? null : Number(t.value);
        e[t.dataset.f] = t.dataset.f === 'weight' ? (val || 0) : (val === null ? null : Math.round(val));
        revalidate(e);
        // Nur Icon/Hinweise aktualisieren, damit der Fokus im Feld bleibt
        const card = t.closest('.voice-entry');
        card.className = `voice-entry voice-entry-${e.status}`;
        card.querySelector('.voice-entry-icon').textContent = e.status === 'ok' ? '✅' : '❌';
        card.querySelectorAll('.voice-entry-msg').forEach(m => m.remove());
        if (e.error) card.insertAdjacentHTML('beforeend', `<div class="voice-entry-msg">${esc(e.error)}</div>`);
        updateSaveButton();
    }

    function updateSaveButton() {
        const btn = $('voice-save-btn');
        if (!btn) return;
        const valid = currentEntries.filter(e => e.status === 'ok').length;
        const blocked = currentEntries.length - valid;
        btn.disabled = valid === 0 || blocked > 0;
        btn.textContent = blocked > 0 ? `❌ ${blocked} Fehler beheben` : `✅ ${valid} eintragen`;
    }

    async function saveEntries() {
        const toSave = currentEntries.filter(e => e.status === 'ok');
        if (!toSave.length || toSave.length !== currentEntries.length) return;
        const dateField = $('workout-date');
        const date = (dateField && dateField.value) || localToday();
        setBusy(true);
        setStatus(`⏳ Speichere ${toSave.length} Eintrag/Einträge …`, 'busy');
        const failed = [];
        for (const e of toSave) {
            const isTime = e.exercise.exercise_type === 'time';
            const payload = {
                exercise_id: e.exercise.id,
                sets: e.sets,
                reps: isTime ? 0 : e.reps,
                weight: isTime ? 0 : (e.weight || 0),
                duration_seconds: isTime ? e.duration_seconds : null,
                rest_seconds: e.rest_seconds || 60,
                feeling: e.feeling || 5,
                date,
                info: '🎤 ' + (lastTranscript || e.source || '').slice(0, 500)
            };
            try {
                const res = await apiFetch('/api/workouts', { method: 'POST', body: JSON.stringify(payload) });
                if (!res || !res.ok) {
                    const d = res ? await res.json().catch(() => ({})) : {};
                    failed.push({ e, msg: d.error || 'Speichern fehlgeschlagen' });
                }
            } catch (err) {
                failed.push({ e, msg: err.message });
            }
        }
        setBusy(false);
        const savedCount = toSave.length - failed.length;
        if (savedCount > 0) {
            if (typeof loadWorkouts === 'function') loadWorkouts();
            if (typeof loadStats === 'function') loadStats();
            if (typeof autoBackup === 'function') autoBackup();
        }
        if (failed.length) {
            currentEntries = failed.map(f => ({ ...f.e, status: 'incomplete', error: f.msg }));
            renderEntries();
            setStatus(`⚠️ ${savedCount} gespeichert, ${failed.length} fehlgeschlagen.`, 'error');
        } else {
            const summary = toSave.map(e => e.exercise.name).join(', ');
            currentEntries = [];
            renderEntries();
            $('voice-text').value = '';
            setStatus(`✅ Eingetragen (${date}): ${summary}`, 'ok');
        }
    }

    function setBusy(busy) {
        ['voice-record-btn', 'voice-parse-btn', 'voice-save-btn'].forEach(id => {
            const el = $(id);
            if (el) el.disabled = busy;
        });
        if (!busy) updateSaveButton();
    }

    function init() {
        const bar = $('voice-bar');
        if (!bar) return;
        $('voice-record-btn').addEventListener('click', toggleRecording);
        $('voice-parse-btn').addEventListener('click', parseText);
        $('voice-result').addEventListener('change', onResultChange);
        $('voice-result').addEventListener('click', ev => {
            const idx = ev.target.dataset && ev.target.dataset.remove;
            if (idx === undefined) return;
            currentEntries.splice(parseInt(idx, 10), 1);
            renderEntries();
        });
        const auto = $('voice-autosave');
        try { auto.checked = localStorage.getItem(AUTO_SAVE_KEY) === '1'; } catch (e) { /* ignore */ }
        auto.addEventListener('change', () => {
            try { localStorage.setItem(AUTO_SAVE_KEY, auto.checked ? '1' : '0'); } catch (e) { /* ignore */ }
        });
        if (!window.isSecureContext) {
            setStatus('Hinweis: Mikrofon braucht HTTPS (Tailscale-Adresse) oder localhost.', 'error');
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
