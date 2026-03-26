// Debug: Alle Workouts (alle User)
app.get('/api/debug/all-workouts', (req, res) => {
  const query = `
    SELECT w.id, w.user_id, w.exercise_id, w.weight, w.sets, w.reps, w.duration_seconds, w.date, 
           e.name as exercise_name, e.muscle_group, e.exercise_type 
    FROM workouts w 
    JOIN exercises e ON w.exercise_id = e.id 
    ORDER BY w.date DESC
    LIMIT 20
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ 
      count: rows.length,
      workouts: rows
    });
  });
});

// API Key Info