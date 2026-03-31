// Medien-Zuordnung für Übungen
// Format: 'Übungsname': { type: 'gif'|'video', src: 'datei.gif|.mp4' }
// Videos zuverlässiger auf Chrome Mobile!
const exerciseMedia = {
    // Brust
    'Bankdrücken (Langhantel)': { type: 'gif', src: 'bankdruecken_langhantel_flachbank.gif' },
    'Bankdrücken Kurzhantel': { type: 'gif', src: 'bankdruecken_ausfuehrung_mit_kurzhanteln.gif' },
    'Schrägbankdrücken': { type: 'gif', src: 'bankdruecken_schraeg_mit_langhantel-1.gif' },
    'Fliegende (Butterfly)': { type: 'gif', src: 'butterfly_uebung_mit_kurzhanteln-2.gif' },
    'Dips': { type: 'gif', src: 'dips_ausfuehrung-trizeps_dips_geraet-1.gif' },
    
    // Rücken
    'Kreuzheben': { type: 'gif', src: 'rumenian_deadlift-1.gif' },
    'Klimmzüge': { type: 'gif', src: 'klimmzugstange_uebungen-enge_klimmzuege_untergriff-1.gif' },
    'Rudern (Langhantel)': { type: 'gif', src: 'rudern_langhantel.gif' },
    'Rudern Kabelzug': { type: 'gif', src: 'rudern_am_kabelzug-einarmig-1.gif' },
    'Rudern Kurzhantel': { type: 'gif', src: 'rudern_mit_kurzhantel-einarmig-1.gif' },
    'Latzug': { type: 'gif', src: 'latzuggeraet_uebungen-latzuggeraet_kabelzug_obergriff.gif' },
    'T-Bar Rudern': { type: 'gif', src: 't_bar_rudern-beidarmig.gif' },
    'Rückenstrecker': { type: 'gif', src: 'rueckenstrecker_uebungen_gym-rueckenstrecker_geraet_zusatzgewicht.gif' },
    
    // Beine
    'Kniebeugen': { type: 'gif', src: 'kniebeugen_ausfuehrung-1.gif' },
    'Beinpresse': { type: 'gif', src: 'beinpresse_muskeln-45_grad_beinpresse_breit.gif' },
    'Beinstrecker': { type: 'gif', src: 'beinstrecker_maschine-1.gif' },
    'Beinbeuger': { type: 'video', src: 'beinbeuger.mp4' },
    'Beckenheben': { type: 'gif', src: 'glute-bridge.gif' },
    'Wadenheben': { type: 'gif', src: 'calf_raises-1.gif' },
    'Ausfallschritte': { type: 'gif', src: 'ausfallschritte_kurzhantel_nach_vorne.gif' },
    
    // Schultern
    'Schulterdrücken': { type: 'gif', src: 'schulterdruecken_mit_kurzhanteln-stehend-1.gif' },
    'Seitheben': { type: 'gif', src: 'kurzhantel_seitheben-sitzend-1.gif' },
    'Frontheben': { type: 'gif', src: 'frontheben_kurzhantel_stehend_einarmig.gif' },
    'Face Pulls': { type: 'gif', src: 'face-pulls-kabelzug.gif' },
    
    // Arme
    'Bizeps-Curls': { type: 'gif', src: 'bizeps_curls_kurzhanteln_abwechselnd.gif' },
    'Hammer Curls': { type: 'gif', src: 'hammercurl_kurzhanteln_abwechselnd.gif' },
    'Trizeps-Drücken Kabel': { type: 'gif', src: 'trizeps_uebungen_fitnessstudio-trizepsdruecken_am_kabelzug-1.gif' },
    'Französisches Trizeps': { type: 'video', src: 'franzoesisches_trizeps.mp4' },
    
    // Core/Bauch
    'Plank (Unterarmstütz)': { type: 'gif', src: 'plank.gif' },
    'Crunches': { type: 'video', src: 'crunches.mp4' },
    'Beinheben': { type: 'video', src: 'beinheben.mp4' },
    'Russische Twist': { type: 'gif', src: 'russian_twist.gif' },
    'ADIM-Core (für Gleitwirbel)': { type: 'gif', src: 'adim-core.gif' },
    'Dead Bug': { type: 'gif', src: 'dead-bug.gif' },
    'Bird Dog': { type: 'gif', src: 'bird-dog.gif' },
    'Glute Bridge': { type: 'gif', src: 'glute-bridge.gif' },
    'Torso Rotation': { type: 'video', src: 'torso_rotation.mp4' },
    
    // Mobilität/Dehnen
    'Butterfly Stretch': { type: 'gif', src: 'butterfly-stretch.gif' },
    'Katze-Kuh': { type: 'gif', src: 'cat-cow.gif' },
    'Hüftdehnung': { type: 'gif', src: 'hip-stretch.gif' },
    'Kindhaltung': { type: 'video', src: 'child_pose.mp4' },
    
    // Ohne Medien
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

// Cache-Busting
const MEDIA_VERSION = '?v=2';

// Hilfsfunktion: Finde Medium für Übung
function getExerciseMedia(exerciseName) {
    if (!exerciseName) return null;
    if (exerciseMedia[exerciseName] === null) return null;
    if (!exerciseMedia[exerciseName]) return null;
    
    const media = exerciseMedia[exerciseName];
    return {
        type: media.type,
        src: media.type === 'video' 
            ? `/exercises/${media.src}` 
            : `/exercises/${media.src}${MEDIA_VERSION}`
    };
}

// Hilfsfunktion: Abwärtskompatibel - altes Format
function getExerciseGif(exerciseName) {
    const media = getExerciseMedia(exerciseName);
    return media ? media.src : null;
}

// Preload
function preloadExerciseMedia() {
    const preloadList = ['Bankdrücken (Langhantel)', 'Kniebeugen', 'Klimmzüge', 'Plank (Unterarmstütz)'];
    
    preloadList.forEach(exercise => {
        const media = getExerciseMedia(exercise);
        if (media) {
            if (media.type === 'video') {
                const vid = document.createElement('video');
                vid.preload = 'metadata';
                vid.src = media.src;
            } else {
                const img = new Image();
                img.src = media.src;
            }
        }
    });
}
