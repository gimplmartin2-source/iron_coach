const fs = require('fs');

let content = fs.readFileSync('public/app.js', 'utf8');

// Finde und ersetze die kaputte Funktion
const oldFunc = `// Zeigt die Übungs-Vorschau mit GIF an
function showExercisePreview(exercise) {
    if (!exercise) return;
    
    const previewContainer = document.getElementById('exercise-preview');
    const videoEl = document.getElementById('preview-video');
    const imgFallback = document.getElementById('preview-gif-fallback');
    
    if (!previewContainer || !videoEl) return;
    
    // GIF laden mit Mobile-Optimierung
    const gifPath = getExerciseGif(exercise.name);
    if (gifPath) {
        // Erzwinge neues Laden durch Cache-Busting mit Timestamp
        const freshGifPath = gifPath + '&t=' + Date.now();
        
        // Mobile-Optimierung: eager loading
        gifImg.loading = 'eager';
        gifImg.decoding = 'async';
        
        // Chrome Mobile: GIF explizit zurücksetzen vor neuem Laden
        gifImg.src = '';
        
        // Kurze Verzögerung für Mobile Chrome
        setTimeout(() => {
            gifImg.src = freshGifPath;
            
            // Event-Handler für Mobile
            gifImg.onerror = function() {
                console.log('⚠️ GIF Fehler, versuche erneut...');
                setTimeout(() => {
                    gifImg.src = freshGifPath;
                }, 300);
            };
            
            gifImg.onload = function() {
                gifImg.style.display = 'block';
                // Chrome Mobile: Erzwinge Animation-Restart
                if (gifImg.complete) {
                    gifImg.style.animation = 'none';
                    gifImg.offsetHeight; // Trigger reflow
                    gifImg.style.animation = null;
                }
            };
        }, 50);
        
        videoEl.style.display = 'block';
    } else {
        gifImg.style.display = 'none';
        videoEl.style.display = 'none';
    }
}

// GIF manuell neu laden (für Mobile Chrome)
function reloadGif() {
    const gifImg = document.getElementById('preview-gif');
    const currentSrc = gifImg.src;
    
    if (currentSrc) {
        // Chrome Mobile: GIF explizit zurücksetzen
        gifImg.src = '';
        
        setTimeout(() => {
            // Cache-Busting mit neuem Timestamp
            const newSrc = currentSrc.split('&t=')[0] + '&t=' + Date.now();
            gifImg.src = newSrc;
        }, 100);
    }
}`;

const newFunc = `// Zeigt die Übungs-Vorschau mit Video an (zuverlässiger auf Mobile)
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
}`;

if (content.includes(oldFunc)) {
    content = content.replace(oldFunc, newFunc);
    fs.writeFileSync('public/app.js', content);
    console.log('✅ Funktion ersetzt!');
} else {
    console.log('❌ Alte Funktion nicht gefunden');
}
