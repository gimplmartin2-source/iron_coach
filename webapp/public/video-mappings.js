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

// Hilfsfunktion: Finde Video fuer Uebung
function getExerciseMedia(exerciseName) {
    if (!exerciseName) return null;
    
    // DYNAMISCHES MATCHING - suche nach ähnlichen Namen
    const exerciseLower = exerciseName.toLowerCase().trim();
    
    // Erstelle eine Liste der möglichen Video-Dateinamen basierend auf dem Exercise-Namen
    const possibleNames = [
        exerciseName + '.mp4',  // Exakt: "Bankdrücken (Langhantel).mp4"
        exerciseName.replace(/[()]/g, '') + '.mp4',  // Ohne Klammern
        exerciseName.replace(/[äöüß]/g, (match) => ({'ä':'ae','ö':'oe','ü':'ue','ß':'ss'}[match])) + '.mp4',  // Ohne Umlaute
    ];
    
    // Wenn wir die availableVideos haben, suche dort
    if (availableVideos) {
        // Exakte Übereinstimmung
        if (availableVideos[exerciseName]) {
            return {
                type: 'video',
                src: `/exercises/${availableVideos[exerciseName]}${MEDIA_VERSION}`
            };
        }
        
        // Flexible Suche
        for (const [key, value] of Object.entries(availableVideos)) {
            const keyLower = key.toLowerCase();
            if (keyLower.includes(exerciseLower) || exerciseLower.includes(keyLower)) {
                return {
                    type: 'video',
                    src: `/exercises/${value}${MEDIA_VERSION}`
                };
            }
        }
    }
    
    // Fallback: Statisches Mapping für bekannte Übungen
    const staticMapping = {
        'Bankdrücken (Langhantel)': 'Bankdrücken (Langhantel).mp4',
        'Bankdrücken Kurzhantel': 'Bankdrücken Kurzhanteln.mp4',
        'Kniebeugen': 'Kniebeugen.mp4',
        'Klimmzüge': 'Klimmzüge Untergriff.mp4',
        'Plank (Unterarmstütz)': 'plank.mp4',
        'Crunches': 'Crunches.mp4',
        // ... weitere
    };
    
    if (staticMapping[exerciseName]) {
        return {
            type: 'video',
            src: `/exercises/${staticMapping[exerciseName]}${MEDIA_VERSION}`
        };
    }
    
    return null;
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
