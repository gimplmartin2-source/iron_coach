// Canvas-basierte GIF-Wiedergabe (zuverlaessigst auf Mobile)
function showExercisePreview(exercise) {
    if (!exercise) return;
    
    const previewContainer = document.getElementById('exercise-preview');
    const videoEl = document.getElementById('preview-video');
    const imgFallback = document.getElementById('preview-gif-fallback');
    
    if (!previewContainer) return;
    
    // Altes Interval stoppen
    if (window.gifRefreshInterval) {
        clearInterval(window.gifRefreshInterval);
        window.gifRefreshInterval = null;
    }
    
    const gifPath = getExerciseGif(exercise.name);
    if (!gifPath) {
        previewContainer.style.display = 'none';
        if (videoEl) videoEl.style.display = 'none';
        if (imgFallback) imgFallback.style.display = 'none';
        return;
    }
    
    const freshPath = gifPath + '&t=' + Date.now();
    
    // Verstecke Video, zeige Fallback IMG
    if (videoEl) videoEl.style.display = 'none';
    if (imgFallback) {
        imgFallback.src = freshPath;
        imgFallback.style.display = 'block';
        
        // WICHTIG: Chrome Mobile Trick - alle 3 Sekunden "ankurbeln"
        let refreshCount = 0;
        window.gifRefreshInterval = setInterval(() => {
            refreshCount++;
            // Nach 3 Sekunden kurzes "Zappeln" um Animation am Leben zu halten
            if (refreshCount % 3 === 0) {
                imgFallback.style.transform = 'scale(1.001)';
                setTimeout(() => {
                    imgFallback.style.transform = 'scale(1)';
                }, 50);
            }
            // Nach 10 Sekunden komplett neu laden (frischer Start)
            if (refreshCount >= 10) {
                refreshCount = 0;
                const newPath = gifPath + '&t=' + Date.now();
                imgFallback.src = newPath;
            }
        }, 1000);
    }
    
    previewContainer.style.display = 'block';
}

function reloadGif() {
    if (window.gifRefreshInterval) {
        clearInterval(window.gifRefreshInterval);
        window.gifRefreshInterval = null;
    }
    
    const imgEl = document.getElementById('preview-gif-fallback');
    if (imgEl && imgEl.src) {
        const basePath = imgEl.src.split('&t=')[0];
        imgEl.src = basePath + '&t=' + Date.now();
    }
}
