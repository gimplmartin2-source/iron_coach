// Medien-Zuordnung fuer Uebungen - MP4 Videos
// DYNAMISCH: Prüft, welche Videos im exercises-Ordner existieren

// Cache für verfügbare Videos
let availableVideos = null;

// Lade verfügbare Videos vom Server (einmalig)
async function loadAvailableVideos() {
    if (availableVideos) return availableVideos;
    
    try {
        const res = await fetch('/api/exercises/videos');
        if (res.ok) {
            availableVideos = await res.json();
            return availableVideos;
        }
    } catch (err) {
        console.log('⚠️ Konnte Videos nicht laden:', err);
    }
    
    // Fallback: Statisches Mapping von bekannten Videos
    availableVideos = {
        'Bankdrücken (Langhantel)': 'Bankdrücken (Langhantel).mp4',
        'Bankdrücken Kurzhanteln': 'Bankdrücken Kurzhanteln.mp4',
        'Kniebeugen': 'Kniebeugen.mp4',
        'Klimmzüge': 'Klimmzüge.mp4',
        // ... weitere bekannte Zuordnungen
    };
    
    return availableVideos;
}

// Cache-Busting fuer MP4s
const MEDIA_VERSION = '?v=3';

// Hilfsfunktion: Finde Video fuer Uebung - EXAKTES MATCHING
function getExerciseMedia(exerciseName) {
    if (!exerciseName) return null;
    
    const exerciseLower = exerciseName.toLowerCase().trim();
    
    // 1. EXAKTE ÜbereinstimmUNG (case-insensitive)
    // "Crunches" findet nur "Crunches.mp4", NICHT "Crunches (Maschine).mp4"
    
    // Prüfe zuerst im statischen Mapping
    const staticMapping = {
        'Bankdrücken (Langhantel)': 'Bankdrücken (Langhantel).mp4',
        'Bankdrücken Kurzhanteln': 'Bankdrücken Kurzhanteln.mp4',
        'Bankdrücken Kurzhantel': 'Bankdrücken Kurzhanteln.mp4',
        'Kniebeugen': 'Kniebeugen.mp4',
        'Klimmzüge': 'Klimmzüge Untergriff.mp4',
        'Plank (Unterarmstütz)': 'plank.mp4',
        'Crunches': 'Crunches.mp4',
        'Crunches (Maschine)': 'Crunches (Maschine).mp4',
        // ... weitere exakte Zuordnungen
    };
    
    if (staticMapping[exerciseName]) {
        return {
            type: 'video',
            src: `/${staticMapping[exerciseName]}${MEDIA_VERSION}`
        };
    }
    
    // 2. Oder direkt: Übung = Dateiname (ohne .mp4)
    // "Kreuzheben" → "Kreuzheben.mp4"
    // WICHTIG: Videos direkt im public Ordner
    return {
        type: 'video',
        src: `/${exerciseName}.mp4${MEDIA_VERSION}`
    };
}

// Abwaertskompatibilitaet
function getExerciseGif(exerciseName) {
    const media = getExerciseMedia(exerciseName);
    return media ? media.src : null;
}

// Initialisiere beim Laden
document.addEventListener('DOMContentLoaded', () => {
    loadAvailableVideos();
});
