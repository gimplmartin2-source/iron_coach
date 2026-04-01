const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-32-chars-long-here';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Datenbank
const db = new sqlite3.Database('./training.db');

// Middleware: JWT auth
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid token' });
  }
}

// Init DB
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    display_name TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    muscle_group TEXT,
    exercise_type TEXT DEFAULT 'strength'
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    exercise_id INTEGER,
    weight REAL,
    sets INTEGER,
    reps INTEGER,
    date TEXT
  )`);
});

// Routes
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  
  db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashed], function(err) {
    if (err) return res.status(400).json({ error: 'Email exists' });
    const token = jwt.sign({ userId: this.lastID, email }, JWT_SECRET);
    res.json({ token, user: { id: this.lastID, email } });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Login failed' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Login failed' });
    
    const token = jwt.sign({ userId: user.id, email }, JWT_SECRET);
    res.json({ token, user: { id: user.id, email } });
  });
});

app.get('/api/exercises', authenticateJWT, (req, res) => {
  db.all('SELECT * FROM exercises WHERE user_id = ?', [req.user.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/exercises', authenticateJWT, (req, res) => {
  const { name, muscle_group, exercise_type } = req.body;
  
  db.run('INSERT INTO exercises (user_id, name, muscle_group, exercise_type) VALUES (?, ?, ?, ?)',
    [req.user.userId, name, muscle_group, exercise_type || 'strength'],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, user_id: req.user.userId, name, muscle_group, exercise_type });
    }
  );
});

app.get('/api/workouts', authenticateJWT, (req, res) => {
  db.all('SELECT * FROM workouts WHERE user_id = ?', [req.user.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/workouts', authenticateJWT, (req, res) => {
  const { exercise_id, weight, sets, reps, date } = req.body;
  
  db.run('INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, date) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.userId, exercise_id, weight, sets, reps, date || new Date().toISOString().split('T')[0]],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
