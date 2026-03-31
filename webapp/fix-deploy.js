// Temporäre Fix-Datei für den Server
const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

// Finde die kaputte Sync-Funktion
const startMarker = "// Standard-Übungen synchronisieren";
const endMarker = "// Übung aktualisieren";

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx);
  
  const newSync = `// Standard-Übungen synchronisieren (fehlende hinzufügen) - für Google Login
app.post('/api/exercises/sync', authenticateJWT, async (req, res) => {
  try {
    console.log('🔄 Sync Standard-Übungen für User', req.user.userId);
    const added = await syncDefaultExercisesAsync(req.user.userId);
    res.json({ success: true, added, message: added + ' exercises added' });
  } catch (err) {
    console.error('Sync Fehler:', err);
    res.status(500).json({ error: err.message });
  }
});

`;
  
  const newContent = before + newSync + after;
  fs.writeFileSync('server.js', newContent);
  console.log('✅ Sync-Funktion repariert');
} else {
  console.log('⚠️ Marker nicht gefunden');
}
