// Dynamisches Video-Mapping System
// Scannt den exercises-Ordner und matched Videos zu Übungen

const fs = require('fs');
const path = require('path');

const EXERCISES_DIR = path.join(__dirname, 'public', 'exercises');

// Cache für Video-Mappings
let videoCache = null;
let lastScan = 0;

// Verfügbare Videos scannen
function scanVideos() {
  const now = Date.now();
  
  // Cache für 60 Sekunden
  if (videoCache && (now - lastScan) < 60000) {
    return videoCache;
  }
  
  try {
    const files = fs.readdirSync(EXERCISES_DIR);
    const videos = files.filter(f => f.endsWith('.mp4'));
    
    videoCache = {};
    
    videos.forEach(video => {
      const originalName = video.replace('.mp4', ''); // Original-Name ohne .mp4
      const normalized = originalName.toLowerCase();
      
      // Speichere verschiedene Varianten für Matching
      videoCache[normalized] = video;
      videoCache[normalized.replace(/[\-_]/g, ' ')] = video; // Mit Leerzeichen statt Bindestricht
      videoCache[normalized.replace(/[\-_\s]/g, '')] = video; // Ohne Leerzeichen/Bindestriche
      
      // Auch ohne Umlaute speichern (frobustes Matching)
      const withoutUmlauts = normalized
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss');
      videoCache[withoutUmlauts] = video;
    });
    
    lastScan = now;
    console.log(`📹 ${videos.length} Videos im exercises-Ordner gefunden`);
    
    return videoCache;
  } catch (err) {
    console.error('❌ Fehler beim Scannen der Videos:', err);
    return {};
  }
}

// Video für Übungsnamen finden - EXAKTES MATCHING
function findVideoForExercise(exerciseName) {
  const videos = scanVideos();
  
  if (!exerciseName) return null;
  
  const exerciseLower = exerciseName.toLowerCase().trim();
  
  // 1. EXAKTE ÜbereinstimmUNG (case-insensitive)
  // "Crunches" findet nur "Crunches.mp4", NICHT "Crunches (Maschine).mp4"
  if (videos[exerciseLower]) {
    return videos[exerciseLower];
  }
  
  // 2. Übereinstimmung mit normalisierten Umlauten
  // Wenn das Video "Bankdruecken.mp4" heißt aber die Übung "Bankdrücken"
  const normalizedExercise = exerciseLower
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  
  if (videos[normalizedExercise]) {
    return videos[normalizedExercise];
  }
  
  // KEIN fuzzy/teilweises Matching - "Crunches" soll nicht "Crunches (Maschine)" finden
  return null;
}

// Alle Übungen mit Videos anreichern
function enrichExercisesWithVideos(exercises) {
  return exercises.map(ex => ({
    ...ex,
    video_src: findVideoForExercise(ex.name)
  }));
}

// Manuelles Video-Mapping für Standard-Übungen
const manualVideoMappings = {
  'Bankdrücken (Langhantel)': 'bankdruecken_langhantel_flachbank.mp4',
  'Bankdrücken Kurzhantel': 'bankdruecken_ausfuehrung_mit_kurzhanteln.mp4',
  'Schrägbankdrücken': 'bankdruecken_schraeg_mit_langhantel-1.mp4',
  'Fliegende (Butterfly)': 'butterfly_uebung_mit_kurzhanteln-2.mp4',
  'Dips': 'dips_ausfuehrung-trizeps_dips_geraet-1.mp4',
  'Kreuzheben': 'rumenian_deadlift-1.mp4',
  'Klimmzüge': 'klimmzugstange_uebungen-enge_klimmzuege_untergriff-1.mp4',
  'Rudern (Langhantel)': 'rudern_langhantel.mp4',
  'Rudern Kabelzug': 'rudern_am_kabelzug-einarmig-1.mp4',
  'Rudern Kurzhantel': 'rudern_mit_kurzhantel-einarmig-1.mp4',
  'Latzug': 'latzuggeraet_uebungen-latzuggeraet_kabelzug_obergriff.mp4',
  'T-Bar Rudern': 't_bar_rudern-beidarmig.mp4',
  'Rückenstrecker': 'rueckenstrecker_uebungen_gym-rueckenstrecker_geraet_zusatzgewicht.mp4',
  'Kniebeugen': 'kniebeugen_ausfuehrung-1.mp4',
  'Beinpresse': 'beinpresse_muskeln-45_grad_beinpresse_breit.mp4',
  'Beinstrecker': 'beinstrecker_maschine-1.mp4',
  'Beinbeuger': 'beinbeuger.mp4',
  'Beckenheben': 'glute-bridge.mp4',
  'Wadenheben': 'calf_raises-1.mp4',
  'Ausfallschritte': 'ausfallschritte_kurzhantel_nach_vorne.mp4',
  'Schulterdrücken': 'schulterdruecken_mit_kurzhanteln-stehend-1.mp4',
  'Seitheben': 'kurzhantel_seitheben-sitzend-1.mp4',
  'Frontheben': 'frontheben_kurzhantel_stehend_einarmig.mp4',
  'Face Pulls': 'face-pulls-kabelzug.mp4',
  'Bizeps-Curls': 'bizeps_curls_kurzhanteln_abwechselnd.mp4',
  'Hammer Curls': 'hammercurl_kurzhanteln_abwechselnd.mp4',
  'Trizeps-Drücken Kabel': 'trizeps_uebungen_fitnessstudio-trizepsdruecken_am_kabelzug-1.mp4',
  'Französisches Trizeps': 'franzoesisches_trizeps.mp4',
  'Plank (Unterarmstütz)': 'plank.mp4',
  'Crunches': 'crunches.mp4',
  'Beinheben': 'beinheben.mp4',
  'Russische Twist': 'russian_twist.mp4',
  'ADIM-Core (für Gleitwirbel)': 'adim-core.mp4',
  'Dead Bug': 'dead-bug.mp4',
  'Bird Dog': 'bird-dog.mp4',
  'Glute Bridge': 'glute-bridge.mp4',
  'Torso Rotation': 'torso_rotation.mp4',
  'Butterfly Stretch': 'butterfly-stretch.mp4',
  'Katze-Kuh': 'cat-cow.mp4',
  'Hüftdehnung': 'hip-stretch.mp4',
  'Kindhaltung': 'child_pose.mp4',
};

// Kombiniertes Mapping (manuelles + dynamisches Scanning)
function getVideoForExercise(exerciseName) {
  // Zuerst manuelles Mapping prüfen
  if (manualVideoMappings[exerciseName]) {
    return manualVideoMappings[exerciseName];
  }
  
  // Dann dynamisches Scannen
  return findVideoForExercise(exerciseName);
}

module.exports = {
  getVideoForExercise,
  enrichExercisesWithVideos,
  scanVideos,
  manualVideoMappings
};
