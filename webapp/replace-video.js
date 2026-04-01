const fs = require('fs');

const file = 'public/app.js';
let content = fs.readFileSync(file, 'utf8');

// Finde die showExercisePreview Funktion und ersetze sie
const startMarker = 'function showExercisePreview(exercise) {';
const endMarker = 'previewContainer.style.display = \'block\';\n}';

const startIdx = content.indexOf(startMarker);
if (startIdx === -1) {
    console.log('Start marker nicht gefunden');
    process.exit(1);
}

// Finde das Ende der Funktion (die nächste geschweifte Klammer auf oberster Ebene)
let braceCount = 0;
let endIdx = startIdx;
let foundStart = false;

for (let i = startIdx; i < content.length; i++) {
    if (content[i] === '{') {
        braceCount++;
        foundStart = true;
    } else if (content[i] === '}') {
        braceCount--;
        if (foundStart && braceCount === 0) {
            endIdx = i + 1;
            break;
        }
    }
}

const newFunction = `function showExercisePreview(exercise) {
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
    
    const freshPath = gifPath + '\u0026t=' + Date.now();
    
    // Reset video
    videoEl.pause();
    videoEl.currentTime = 0;
    videoEl.src = freshPath;
    
    // Mobile attributes
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.loop = true;
    videoEl.preload = 'auto';
    videoEl.autoplay = true;
    videoEl.style.display = 'block';
    
    if (imgFallback) imgFallback.style.display = 'none';
    
    // Try to play with retries
    const tryPlay = (retries = 3) => {
        if (retries <= 0) {
            videoEl.style.display = 'none';
            if (imgFallback) {
                imgFallback.src = freshPath;
                imgFallback.style.display = 'block';
            }
            return;
        }
        videoEl.play().catch(() => setTimeout(() => tryPlay(retries - 1), 100));
    };
    
    videoEl.onloadeddata = () => tryPlay();
    videoEl.oncanplay = () => tryPlay();
    videoEl.onerror = () => {
        videoEl.style.display = 'none';
        if (imgFallback) {
            imgFallback.src = freshPath;
            imgFallback.style.display = 'block';
        }
    };
    
    previewContainer.style.display = 'block';
    setTimeout(() => tryPlay(), 50);
}`;

const before = content.substring(0, startIdx);
const after = content.substring(endIdx);

const newContent = before + newFunction + after;

fs.writeFileSync(file, newContent);
console.log('✅ showExercisePreview aktualisiert!');
