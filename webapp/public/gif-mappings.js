// GIF Zuordnung für Übungen - KEINE DOPPLIKATE!
// Format: 'Übungsname': 'dateiname.gif' oder null wenn kein GIF verfügbar
// HINWEIS: Einige GIFs funktionieren nicht auf Chrome Mobile - auf null gesetzt
const exerciseGifs = {
    // Brust
    'Bankdrücken (Langhantel)': 'bankdruecken_langhantel_flachbank.gif',
    'Bankdrücken Kurzhantel': 'bankdruecken_ausfuehrung_mit_kurzhanteln.gif',
    'Schrägbankdrücken': 'bankdruecken_schraeg_mit_langhantel-1.gif',
    'Fliegende (Butterfly)': 'butterfly_uebung_mit_kurzhanteln-2.gif',
    'Dips': 'dips_ausfuehrung-trizeps_dips_geraet-1.gif',
    
    // Rücken
    'Kreuzheben': 'rumenian_deadlift-1.gif',
    'Klimmzüge': 'klimmzugstange_uebungen-enge_klimmzuege_untergriff-1.gif',
    'Rudern (Langhantel)': 'rudern_langhantel.gif',
    'Rudern Kabelzug': 'rudern_am_kabelzug-einarmig-1.gif',
    'Rudern Kurzhantel': 'rudern_mit_kurzhantel-einarmig-1.gif',
    'Latzug': 'latzuggeraet_uebungen-latzuggeraet_kabelzug_obergriff.gif',
    'T-Bar Rudern': 't_bar_rudern-beidarmig.gif',
    'Rückenstrecker': 'rueckenstrecker_uebungen_gym-rueckenstrecker_geraet_zusatzgewicht.gif',
    
    // Beine
    'Kniebeugen': 'kniebeugen_ausfuehrung-1.gif',
    'Beinpresse': 'beinpresse_muskeln-45_grad_beinpresse_breit.gif',
    'Beinstrecker': 'beinstrecker_maschine-1.gif',
    'Beinbeuger': null,  // Chrome Mobile Problem
    'Beckenheben': 'glute-bridge.gif',
    'Wadenheben': 'calf_raises-1.gif',
    'Ausfallschritte': 'ausfallschritte_kurzhantel_nach_vorne.gif',
    
    // Schultern
    'Schulterdrücken': 'schulterdruecken_mit_kurzhanteln-stehend-1.gif',
    'Seitheben': 'kurzhantel_seitheben-sitzend-1.gif',
    'Frontheben': 'frontheben_kurzhantel_stehend_einarmig.gif',
    'Face Pulls': 'face-pulls-kabelzug.gif',
    
    // Arme
    'Bizeps-Curls': 'bizeps_curls_kurzhanteln_abwechselnd.gif',
    'Hammer Curls': 'hammercurl_kurzhanteln_abwechselnd.gif',
    'Trizeps-Drücken Kabel': 'trizeps_uebungen_fitnessstudio-trizepsdruecken_am_kabelzug-1.gif',
    'Französisches Trizeps': null,  // Chrome Mobile Problem
    
    // Core/Bauch
    'Plank (Unterarmstütz)': 'plank.gif',
    'Crunches': null,  // Chrome Mobile Problem
    'Beinheben': null,  // Chrome Mobile Problem
    'Russische Twist': 'russian_twist.gif',
    'ADIM-Core (für Gleitwirbel)': 'adim-core.gif',
    'Dead Bug': 'dead-bug.gif',
    'Bird Dog': 'bird-dog.gif',
    'Glute Bridge': 'glute-bridge.gif',
    'Torso Rotation': null,  // Chrome Mobile Problem
    
    // Mobilität/Dehnen
    'Butterfly Stretch': 'butterfly-stretch.gif',
    'Katze-Kuh': 'cat-cow.gif',
    'Hüftdehnung': 'hip-stretch.gif',
    'Kindhaltung': null,  // Chrome Mobile Problem
    
    // Ohne GIFs
    'Side Plank': null,
    'Pallof Press': null,
    'Uchi-Komi (Wurfübungen)': null,
    'Nage-Komi (Wurftraining)': null,
    'Randori (Freikampf)': null,
    'Kata (Formen)': null,
    'Sprungsukomikomi': null,
    'Explosive Beinarbeit': null,
    'Grip Fighting': null,
    'Ne-waza (Bodenkampf)': null,
    'Turn-Uchikomi': null,
};

// Cache-Busting für Mobile Chrome (verhindert Caching-Probleme)
const GIF_VERSION = '?v=2';

// Hilfsfunktion: Finde passendes GIF für Übung
function getExerciseGif(exerciseName) {
    if (!exerciseName) return null;
    
    // Explizit auf null gesetzt = kein GIF verfügbar
    if (exerciseGifs[exerciseName] === null) {
        return null;
    }
    
    // Direkte Übereinstimmung
    if (exerciseGifs[exerciseName]) {
        return `/exercises/${exerciseGifs[exerciseName]}${GIF_VERSION}`;
    }
    
    // Keine Teilübereinstimmung mehr - verhindert falsche Zuordnungen
    return null;
}

// Preload wichtige GIFs für bessere Mobile-Performance
function preloadExerciseGifs() {
    const preloadList = [
        'Bankdrücken (Langhantel)',
        'Kniebeugen',
        'Kreuzheben',
        'Klimmzüge',
        'Plank (Unterarmstütz)'
    ];
    
    preloadList.forEach(exercise => {
        const gifPath = getExerciseGif(exercise);
        if (gifPath) {
            const img = new Image();
            img.src = gifPath;
        }
    });
}

// Mobile-optimierte GIF-Ladung
function loadGifWithRetry(imgElement, gifPath, maxRetries = 3) {
    let retries = 0;
    
    function tryLoad() {
        imgElement.src = gifPath;
        
        imgElement.onerror = function() {
            retries++;
            if (retries < maxRetries) {
                console.log(`🔄 Retry ${retries}/${maxRetries} für GIF: ${gifPath}`);
                setTimeout(tryLoad, 500 * retries);
            } else {
                console.log('❌ GIF konnte nicht geladen werden:', gifPath);
                imgElement.style.display = 'none';
                if (imgElement.parentElement) {
                    imgElement.parentElement.style.display = 'none';
                }
            }
        };
        
        imgElement.onload = function() {
            imgElement.style.display = 'block';
            imgElement.decoding = 'async';
        };
    }
    
    tryLoad();
}
