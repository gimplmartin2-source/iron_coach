// Medien-Zuordnung fuer Uebungen - MP4 Videos (zuverlaessiger als GIF)
// Format: 'Uebungsname': 'dateiname.mp4' oder null
// Alle GIFs wurden zu MP4 konvertiert!
const exerciseMedia = {
    // Brust
    'Bankdrücken (Langhantel)': 'bankdruecken_langhantel_flachbank.mp4',
    'Bankdrücken Kurzhantel': 'bankdruecken_ausfuehrung_mit_kurzhanteln.mp4',
    'Schrägbankdrücken': 'bankdruecken_schraeg_mit_langhantel-1.mp4',
    'Fliegende (Butterfly)': 'butterfly_uebung_mit_kurzhanteln-2.mp4',
    'Dips': 'dips_ausfuehrung-trizeps_dips_geraet-1.mp4',
    
    // Rücken
    'Kreuzheben': 'rumenian_deadlift-1.mp4',
    'Klimmzüge': 'klimmzugstange_uebungen-enge_klimmzuege_untergriff-1.mp4',
    'Rudern (Langhantel)': 'rudern_langhantel.mp4',
    'Rudern Kabelzug': 'rudern_am_kabelzug-einarmig-1.mp4',
    'Rudern Kurzhantel': 'rudern_mit_kurzhantel-einarmig-1.mp4',
    'Latzug': 'latzuggeraet_uebungen-latzuggeraet_kabelzug_obergriff.mp4',
    'T-Bar Rudern': 't_bar_rudern-beidarmig.mp4',
    'Rückenstrecker': 'rueckenstrecker_uebungen_gym-rueckenstrecker_geraet_zusatzgewicht.mp4',
    
    // Beine
    'Kniebeugen': 'kniebeugen_ausfuehrung-1.mp4',
    'Beinpresse': 'beinpresse_muskeln-45_grad_beinpresse_breit.mp4',
    'Beinstrecker': 'beinstrecker_maschine-1.mp4',
    'Beinbeuger': 'beinbeuger.mp4',
    'Beckenheben': 'glute-bridge.mp4',
    'Wadenheben': 'calf_raises-1.mp4',
    'Ausfallschritte': 'ausfallschritte_kurzhantel_nach_vorne.mp4',
    
    // Schultern
    'Schulterdrücken': 'schulterdruecken_mit_kurzhanteln-stehend-1.mp4',
    'Seitheben': 'kurzhantel_seitheben-sitzend-1.mp4',
    'Frontheben': 'frontheben_kurzhantel_stehend_einarmig.mp4',
    'Face Pulls': 'face-pulls-kabelzug.mp4',
    
    // Arme
    'Bizeps-Curls': 'bizeps_curls_kurzhanteln_abwechselnd.mp4',
    'Hammer Curls': 'hammercurl_kurzhanteln_abwechselnd.mp4',
    'Trizeps-Drücken Kabel': 'trizeps_uebungen_fitnessstudio-trizepsdruecken_am_kabelzug-1.mp4',
    'Französisches Trizeps': 'franzoesisches_trizeps.mp4',
    
    // Core/Bauch
    'Plank (Unterarmstütz)': 'plank.mp4',
    'Crunches': 'crunches.mp4',
    'Beinheben': 'beinheben.mp4',
    'Russische Twist': 'russian_twist.mp4',
    'ADIM-Core (für Gleitwirbel)': 'adim-core.mp4',
    'Dead Bug': 'dead-bug.mp4',
    'Bird Dog': 'bird-dog.mp4',
    'Glute Bridge': 'glute-bridge.mp4',
    'Torso Rotation': 'torso_rotation.mp4',
    
    // Mobilität/Dehnen
    'Butterfly Stretch': 'butterfly-stretch.mp4',
    'Katze-Kuh': 'cat-cow.mp4',
    'Hüftdehnung': 'hip-stretch.mp4',
    'Kindhaltung': 'child_pose.mp4',
    
    // Judo & andere ohne Video
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

// Cache-Busting fuer MP4s
const MEDIA_VERSION = '?v=3';

// Hilfsfunktion: Finde Video fuer Uebung
function getExerciseMedia(exerciseName) {
    if (!exerciseName) return null;
    if (exerciseMedia[exerciseName] === null) return null;
    if (!exerciseMedia[exerciseName]) return null;
    
    return {
        type: 'video',
        src: `/exercises/${exerciseMedia[exerciseName]}${MEDIA_VERSION}`
    };
}

// Abwaertskompatibilitaet
function getExerciseGif(exerciseName) {
    const media = getExerciseMedia(exerciseName);
    return media ? media.src : null;
}

// Preload wichtiger Videos
function preloadExerciseMedia() {
    const preloadList = [
        'Bankdrücken (Langhantel)', 
        'Kniebeugen', 
        'Kreuzheben',
        'Klimmzüge', 
        'Plank (Unterarmstütz)'
    ];
    
    preloadList.forEach(exercise => {
        const media = getExerciseMedia(exercise);
        if (media) {
            const vid = document.createElement('video');
            vid.preload = 'metadata';
            vid.src = media.src;
        }
    });
}
