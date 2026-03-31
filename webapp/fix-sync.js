// Temporäre Fix-Datei
const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

// Problemstelle finden und fixen
const oldSync = `app.post('/api/exercises/sync', authenticateJWT, async (req, res) => {
  try {
    console.log('🔄 Sync Standard-Übungen für User', req.user.userId);
    res.status(500).json({ error: err.message });
  }
});`;

const newSync = `app.post('/api/exercises/sync', authenticateJWT, async (req, res) => {
  try {
    console.log('🔄 Sync Standard-Übungen für User', req.user.userId);
    const added = await syncDefaultExercisesAsync(req.user.userId);
    res.json({ success: true, added, message: \`\${added} neue Standard-Übungen hinzugefügt\` });
  } catch (err) {
    console.error('❌ Sync Fehler:', err);
    res.status(500).json({ error: err.message });
  }
});`;

if (content.includes(oldSync)) {
  content = content.replace(oldSync, newSync);
  fs.writeFileSync('server.js', content);
  console.log('✅ server.js korrigiert');
} else {
  console.log('⚠️ Pattern nicht gefunden');
}
