// Zeigt die Uebungs-Vorschau mit automatisch neu ladendem GIF
function showExercisePreview(exercise) {
    if (!exercise) return;
    
    const previewContainer = document.getElementById('exercise-preview');
    const imgEl = document.getElementById('preview-gif-fallback');
    
    if (!previewContainer) return;
    
    // Altes GIF stoppen
    if (window.gifInterval) {
        clearInterval(window.gifInterval);
        window.gifInterval = null;
    }
    
    const gifPath = getExerciseGif(exercise.name);
    if (!gifPath) {
        previewContainer.style.display = 'none';
        if (imgEl) imgEl.style.display = 'none';
        return;
    }
    
    // Zeige IMG Element (kein Video mehr)
    const displayEl = imgEl || document.getElementById('preview-video');
    if (!displayEl) return;
    
    // Cache-Busting
    const freshPath = gifPath + '&t=' + Date.now();
    
    displayEl.src = freshPath;
    displayEl.style.display = 'block';
    
    // WICHTIG: Alle 2 Sekunden neu laden damit Chrome es nicht einfriert
    window.gifInterval = setInterval(() => {
        const newPath = gifPath + '&t=' + Date.now();
        displayEl.src = newPath;
    }, 2000);
    
    previewContainer.style.display = 'block';
}

// Saubere Funktion fuer reloadGif
function reloadGif() {
    // Intervall stoppen und neu starten
    if (window.gifInterval) {
        clearInterval(window.gifInterval);
        window.gifInterval = null;
    }
    
    const imgEl = document.getElementById('preview-gif-fallback') || 
                  document.getElementById('preview-video');
    
    if (imgEl && imgEl.src) {
        const basePath = imgEl.src.split('&t=')[0];
        imgEl.src = basePath + '&t=' + Date.now();
        
        const gifPath = basePath;
        window.gifInterval = setInterval(() => {
            imgEl.src = gifPath + '&t=' + Date.now();
        }, 2000);
    }
}
