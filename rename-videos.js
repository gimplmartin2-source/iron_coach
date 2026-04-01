#!/usr/bin/env node
// Skript zum Umbenennen der Videos in Title Case mit Leerzeichen

const fs = require('fs');
const path = require('path');

const EXERCISES_DIR = path.join(__dirname, 'webapp', 'public', 'exercises');

function toTitleCase(str) {
    // Nur den Dateinamen ohne Erweiterung nehmen
    const ext = path.extname(str);
    const nameWithoutExt = str.replace(ext, '');
    
    // Ersetze Bindestriche, Unterstriche und Punkte durch Leerzeichen
    let result = nameWithoutExt
        .replace(/[-_.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    // Jedes Wort mit Großbuchstabe
    const titleCase = result.replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
    
    // Erweiterung wieder anhängen (klein)
    return titleCase + ext.toLowerCase();
}

// Liste der aktuellen "falschen" Dateinamen (mit "Mp4" statt ".mp4")
const wrongFiles = [
    ['Ausfallschritte Kurzhantel Mp4', 'Ausfallschritte Kurzhantel.mp4'],
    ['Bankdruecken Langhantel Mp4', 'Bankdruecken Langhantel.mp4'],
    ['Bankdruecken Kurzhanteln Mp4', 'Bankdruecken Kurzhanteln.mp4'],
    ['Bankdrücken (Langhantel) Mp4', 'Bankdrücken (Langhantel).mp4'],
    ['Bankdrücken Kurzhanteln Mp4', 'Bankdrücken Kurzhanteln.mp4'],
    ['Bauchroller Mp4', 'Bauchroller.mp4'],
    ['Becken Heben Mp4', 'Becken Heben.mp4'],
    ['Beckenheben Mp4', 'Beckenheben.mp4'],
    ['Beinheben Klimmzugstange Mp4', 'Beinheben Klimmzugstange.mp4'],
    ['Beinheben Mp4', 'Beinheben.mp4'],
    ['Beinpresse Mp4', 'Beinpresse.mp4'],
    ['Beinstrecker Mp4', 'Beinstrecker.mp4'],
    ['Bizepscurls Kurzhantel Mp4', 'Bizepscurls Kurzhantel.mp4'],
    ['Butterfly Mp4', 'Butterfly.mp4'],
    ['Crunches (Maschine) Mp4', 'Crunches (Maschine).mp4'],
    ['Crunches Mp4', 'Crunches.mp4'],
    ['Dips Mp4', 'Dips.mp4'],
    ['Face Pulls Kabelzug Mp4', 'Face Pulls Kabelzug.mp4'],
    ['French Press Mp4', 'French Press.mp4'],
    ['Frontheben Kurzhantel Mp4', 'Frontheben Kurzhantel.mp4'],
    ['Hammercurl Kurzhantel Mp4', 'Hammercurl Kurzhantel.mp4'],
    ['Hreuzheben Mp4', 'Hreuzheben.mp4'],
    ['Kabel Crunches Mp4', 'Kabel Crunches.mp4'],
    ['Klimmzugstange Untergriff Mp4', 'Klimmzugstange Untergriff.mp4'],
    ['Klasssisches Kreuzheben Mp4', 'Klasssisches Kreuzheben.mp4'],
    ['Klimmzüge Obergriff Mp4', 'Klimmzüge Obergriff.mp4'],
    ['Klimmzüge Untergriff Mp4', 'Klimmzüge Untergriff.mp4'],
    ['Kniebeugen Mp4', 'Kniebeugen.mp4'],
    ['Kurzhantel Rudern Mp4', 'Kurzhantel Rudern.mp4'],
    ['Kurzhantel Seitheben Mp4', 'Kurzhantel Seitheben.mp4'],
    ['Latzug Maschine Mp4', 'Latzug Maschine.mp4'],
    ['Plank Mp4', 'Plank.mp4'],
    ['Rudern Maschine Mp4', 'Rudern Maschine.mp4'],
    ['Russian Twist Mp4', 'Russian Twist.mp4'],
    ['Rückenextention Maschine Mp4', 'Rückenextention Maschine.mp4'],
    ['Schrägbank Drücken Mp4', 'Schrägbank Drücken.mp4'],
    ['Schulterdrücken Kurzhanteln Mp4', 'Schulterdrücken Kurzhanteln.mp4'],
    ['Side Plank Extreme Mp4', 'Side Plank Extreme.mp4'],
    ['Side Plank Rotation Mp4', 'Side Plank Rotation.mp4'],
    ['T Bar Rudern Mp4', 'T Bar Rudern.mp4'],
    ["Trizeps Pulldown Maschine Mp4", "Trizeps Pulldown Maschine.mp4"]
];

// Korrigiere die falschen Dateien
wrongFiles.forEach(([wrong, correct]) => {
    const wrongPath = path.join(EXERCISES_DIR, wrong);
    const correctPath = path.join(EXERCISES_DIR, correct);
    
    if (fs.existsSync(wrongPath)) {
        fs.rename(wrongPath, correctPath, (err) => {
            if (err) console.error(`❌ Fehler bei ${wrong}:`, err);
            else console.log(`✅ Korrigiert: ${wrong} → ${correct}`);
        });
    }
});

console.log('🔄 Korrigiere Dateiendungen...');
