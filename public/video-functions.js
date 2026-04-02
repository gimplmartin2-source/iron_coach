// Zeigt die Übungs-Vorschau mit Video an (zuverlässiger auf Mobile)
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
    
    // Cache-Busting
    const freshPath = gifPath + '&t=' + Date.now();
    
    // Video einrichten
    videoEl.src = freshPath;
    videoEl.style.display = 'block';
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.loop = true;
    videoEl.preload = 'auto';
    
    // Fallback verstecken
    if (imgFallback) imgFallback.style.display = 'none';
    
    // Video abspielen
    const playVideo = () => {
        videoEl.play().catch(err => {
            console.log('Video play failed, using fallback:', err);
            // Fallback auf IMG
            videoEl.style.display = 'none';
            if (imgFallback) {
                imgFallback.src = freshPath;
                imgFallback.style.display = 'block';
            }
        });
    };
    
    videoEl.onloadeddata = playVideo;
    videoEl.onerror = () => {
        console.log('Video error, using fallback');
        videoEl.style.display = 'none';
        if (imgFallback) {
            imgFallback.src = freshPath;
            imgFallback.style.display = 'block';
        }
    };
    
    previewContainer.style.display = 'block';
}

// Video neu laden
function reloadGif() {
    const videoEl = document.getElementById('preview-video');
    if (videoEl && videoEl.src) {
        videoEl.currentTime = 0;
        videoEl.play();
    }
}

function closeExerciseSelector() {