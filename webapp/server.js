const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { google } = require('googleapis');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dein-geheimer-schluessel-mindestens-32-zeichen-lang';
const SESSION_SECRET = process.env.SESSION_SECRET || 'session-secret-mindestens-32-zeichen-lang-hier';

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false
}));

// Trust proxy for Render/Heroku
app.set('trust proxy', 1);

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Zu viele Anfragen, bitte später versuchen' }
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Zu viele Login-Versuche' }
});

// CORS
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// JSON Body Parsing
app.use(express.json());

// Session Configuration
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Datenbank
const DB_PATH = process.env.DB_PATH || './training.db';
console.log('📁 Datenbank Pfad:', DB_PATH);
let db = new sqlite3.Database(DB_PATH);

// Schema-Status für Caching
let schemaStatus = {
  workoutsHasDuration: false,
  exercisesHasType: false,
  initialized: false
};

// Hilfsfunktion: Schema prüfen
async function checkSchema() {
  return new Promise((resolve, reject) => {
    if (schemaStatus.initialized) {
      resolve(schemaStatus);
      return;
    }

    db.all(`PRAGMA table_info(workouts)`, [], (err, workoutCols) => {
      if (err) {
        reject(err);
        return;
      }
      
      db.all(`PRAGMA table_info(exercises)`, [], (err2, exerciseCols) => {
        if (err2) {
          reject(err2);
          return;
        }
        
        schemaStatus.workoutsHasDuration = workoutCols.some(c => c.name === 'duration_seconds');
        schemaStatus.exercisesHasType = exerciseCols.some(c => c.name === 'exercise_type');
        schemaStatus.initialized = true;
        
        console.log('📊 Schema Status:', {
          workoutsDuration: schemaStatus.workoutsHasDuration,
          exercisesType: schemaStatus.exercisesHasType
        });
        
        resolve(schemaStatus);
      });
    });
  });
}

// Hilfsfunktion: Migration sicher ausführen
function runMigration(sql, description) {
  return new Promise((resolve) => {
    db.run(sql, (err) => {
      if (err) {
        console.log(`⚠️ ${description}: ${err.message}`);
        resolve(false);
      } else {
        console.log(`✅ ${description}`);
        resolve(true);
      }
    });
  });
}

// Datenbank Initialisierung
async function initDatabase() {
  console.log('🔄 Initialisiere Datenbank...');
  
  // Schema-Version verfolgen
  await runMigration(`CREATE TABLE IF NOT EXISTS _schema_version (
    id INTEGER PRIMARY KEY,
    version INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, 'Schema-Version Tabelle');
  
  // Users Tabelle
  await runMigration(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT,
    google_id TEXT UNIQUE,
    display_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, 'Users Tabelle');
  
  // Exercises Tabelle mit exercise_type
  await runMigration(`CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    muscle_group TEXT NOT NULL,
    exercise_type TEXT DEFAULT 'strength',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`, 'Exercises Tabelle');
  
  // Workouts Tabelle mit allen Feldern
  await runMigration(`CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    exercise_id INTEGER,
    weight REAL,
    sets INTEGER,
    reps INTEGER,
    duration_seconds INTEGER,
    rest_seconds INTEGER,
    feeling INTEGER CHECK(feeling >= 1 AND feeling <= 10),
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
  )`, 'Workouts Tabelle');
  
  // Migration: exercise_type zu exercises hinzufügen
  const hasExerciseType = await new Promise((resolve) => {
    db.all(`PRAGMA table_info(exercises)`, [], (err, cols) => {
      resolve(cols && cols.some(c => c.name === 'exercise_type'));
    });
  });
  
  if (!hasExerciseType) {
    await runMigration(`ALTER TABLE exercises ADD COLUMN exercise_type TEXT DEFAULT 'strength'`,
      'Migration: exercise_type zu exercises');
  }
  
  // Migration: duration_seconds zu workouts hinzufügen
  const hasDuration = await new Promise((resolve) => {
    db.all(`PRAGMA table_info(workouts)`, [], (err, cols) => {
      resolve(cols && cols.some(c => c.name === 'duration_seconds'));
    });
  });
  
  if (!hasDuration) {
    await runMigration(`ALTER TABLE workouts ADD COLUMN duration_seconds INTEGER`,
      'Migration: duration_seconds zu workouts');
  }
  
  // Schema neu laden
  schemaStatus = { workoutsHasDuration: false, exercisesHasType: false, initialized: false };
  await checkSchema();
  
  console.log('✅ Datenbank initialisiert');
}

// Datenbank beim Start initialisieren
initDatabase().catch(err => {
  console.error('❌ DB Init Fehler:', err);
});

// Passport Serialisierung
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  db.get('SELECT id, email, display_name FROM users WHERE id = ?', [id], (err, row) => {
    done(err, row);
  });
});

// Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    db.get('SELECT * FROM users WHERE google_id = ?', [profile.id], (err, user) => {
      if (err) return done(err);
      
      if (user) {
        return done(null, user);
      }
      
      const email = profile.emails[0].value;
      db.run('INSERT INTO users (email, google_id, display_name) VALUES (?, ?, ?)',
        [email, profile.id, profile.displayName],
        function(err) {
          if (err) return done(err);
          
          // Standard-Übungen erstellen
          const userId = this.lastID;
          createDefaultExercises(userId);
          
          db.get('SELECT * FROM users WHERE id = ?', [userId], (err, newUser) => {
            done(err, newUser);
          });
        });
    });
  } catch (err) {
    done(err);
  }
}));

// Local Strategy
passport.use(new LocalStrategy({
  usernameField: 'email',
  passwordField: 'password'
}, async (email, password, done) => {
  try {
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) return done(err);
      if (!user) return done(null, false, { message: 'Benutzer nicht gefunden' });
      
      if (!user.password) {
        return done(null, false, { message: 'Bitte mit Google anmelden' });
      }
      
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return done(null, false, { message: 'Falsches Passwort' });
      
      return done(null, user);
    });
  } catch (err) {
    done(err);
  }
}));

// JWT Middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({ error: 'Token ungültig' });
      }
      req.user = user;
      next();
    });
  } else {
    res.status(401).json({ error: 'Nicht autorisiert' });
  }
};

// Standard-Übungen erstellen
function createDefaultExercises(userId) {
  const defaultExercises = [
    { name: 'Uchi-Komi (Wurfübungen)', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Nage-Komi (Wurftraining)', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Randori (Freikampf)', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Kata (Formen)', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Sprungsukomikomi', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Explosive Beinarbeit', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Grip Fighting', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Ne-waza (Bodenkampf)', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Turn-Uchikomi', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Bankdrücken (Langhantel)', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Schrägbankdrücken', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Fliegende (Butterfly)', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Dips', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Kreuzheben', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Klimmzüge', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Rudern (Langhantel)', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Latzug', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'T-Bar Rudern', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Kniebeugen', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Beinpresse', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Beinstrecker', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Beinbeuger', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Wadenheben', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Ausfallschritte', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Schulterdrücken', muscle_group: 'Schultern', exercise_type: 'strength' },
    { name: 'Seitheben', muscle_group: 'Schultern', exercise_type: 'strength' },
    { name: 'Frontheben', muscle_group: 'Schultern', exercise_type: 'strength' },
    { name: 'Face Pulls', muscle_group: 'Schultern', exercise_type: 'strength' },
    { name: 'Bizeps-Curls', muscle_group: 'Arme', exercise_type: 'strength' },
    { name: 'Trizeps-Drücken', muscle_group: 'Arme', exercise_type: 'strength' },
    { name: 'Hammer Curls', muscle_group: 'Arme', exercise_type: 'strength' },
    { name: 'Französisches Trizeps', muscle_group: 'Arme', exercise_type: 'strength' },
    { name: 'Plank (Unterarmstütz)', muscle_group: 'Bauch', exercise_type: 'time' },
    { name: 'Crunches', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Beinheben', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Russische Twist', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'ADIM-Core (für Gleitwirbel)', muscle_group: 'Bauch', exercise_type: 'time' },
  ];
  
  defaultExercises.forEach(exercise => {
    db.run('INSERT INTO exercises (user_id, name, muscle_group, exercise_type) VALUES (?, ?, ?, ?)',
      [userId, exercise.name, exercise.muscle_group, exercise.exercise_type],
      (err) => {
        if (err && !err.message.includes('UNIQUE constraint failed')) {
          console.error('❌ Fehler beim Erstellen der Übung:', err.message);
        }
      }
    );
  });
  
  console.log(`✅ ${defaultExercises.length} Standardübungen für User ${userId} erstellt`);
}

// Register
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { email, password, displayName } = req.body;
  
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Email und Passwort (min. 6 Zeichen) erforderlich' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run('INSERT INTO users (email, password, display_name) VALUES (?, ?, ?)',
      [email, hashedPassword, displayName || email.split('@')[0]],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email bereits registriert' });
          }
          return res.status(500).json({ error: err.message });
        }
        
        const userId = this.lastID;
        createDefaultExercises(userId);
        
        const token = jwt.sign({ userId: userId, email: email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: userId, email, display_name: displayName } });
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post('/api/auth/login', authLimiter, (req, res, next) => {
  passport.authenticate('local', { session: false }, (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message || 'Login fehlgeschlagen' });
    
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, display_name: user.display_name } });
  })(req, res, next);
});

// Google Auth Routes
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/drive.file'],
  accessType: 'offline',
  prompt: 'consent'
}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login.html' }),
  (req, res) => {
    const token = jwt.sign({ userId: req.user.id, email: req.user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.redirect(`/?token=${token}`);
  }
);

// Alle Übungen abrufen
app.get('/api/exercises', authenticateJWT, async (req, res) => {
  await checkSchema();
  
  const query = schemaStatus.exercisesHasType
    ? `SELECT id, user_id, name, muscle_group, exercise_type, created_at FROM exercises WHERE user_id = ?`
    : `SELECT id, user_id, name, muscle_group, 'strength' as exercise_type, created_at FROM exercises WHERE user_id = ?`;
  
  db.all(query, [req.user.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Neue Übung hinzufügen
app.post('/api/exercises', authenticateJWT, async (req, res) => {
  await checkSchema();
  
  const { name, muscle_group, exercise_type } = req.body;
  const type = exercise_type || 'strength';
  
  if (schemaStatus.exercisesHasType) {
    db.run('INSERT INTO exercises (user_id, name, muscle_group, exercise_type) VALUES (?, ?, ?, ?)',
      [req.user.userId, name, muscle_group, type],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, user_id: req.user.userId, name, muscle_group, exercise_type: type });
      });
  } else {
    db.run('INSERT INTO exercises (user_id, name, muscle_group) VALUES (?, ?, ?)',
      [req.user.userId, name, muscle_group],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, user_id: req.user.userId, name, muscle_group, exercise_type: 'strength' });
      });
  }
});

// Übung aktualisieren
app.put('/api/exercises/:id', authenticateJWT, async (req, res) => {
  await checkSchema();
  
  const { name, muscle_group, exercise_type } = req.body;
  const type = exercise_type || 'strength';
  
  if (schemaStatus.exercisesHasType) {
    db.run('UPDATE exercises SET name = ?, muscle_group = ?, exercise_type = ? WHERE id = ? AND user_id = ?',
      [name, muscle_group, type, req.params.id, req.user.userId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Übung nicht gefunden' });
        res.json({ message: 'Übung aktualisiert', id: req.params.id, name, muscle_group, exercise_type: type });
      });
  } else {
    db.run('UPDATE exercises SET name = ?, muscle_group = ? WHERE id = ? AND user_id = ?',
      [name, muscle_group, req.params.id, req.user.userId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Übung nicht gefunden' });
        res.json({ message: 'Übung aktualisiert', id: req.params.id, name, muscle_group, exercise_type: 'strength' });
      });
  }
});

// Übung löschen
app.delete('/api/exercises/:id', authenticateJWT, (req, res) => {
  db.run('DELETE FROM exercises WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Übung gelöscht' });
  });
});

// Alle Workouts abrufen - ROBUST mit Fallback
app.get('/api/workouts', authenticateJWT, async (req, res) => {
  await checkSchema();
  
  let query;
  if (schemaStatus.workoutsHasDuration && schemaStatus.exercisesHasType) {
    // Alles vorhanden - volles Query
    query = `
      SELECT w.id, w.user_id, w.exercise_id, w.weight, w.sets, w.reps, w.duration_seconds,
             w.rest_seconds, w.feeling, w.date, w.created_at,
             e.name as exercise_name, e.muscle_group,
             COALESCE(e.exercise_type, 'strength') as exercise_type
      FROM workouts w
      LEFT JOIN exercises e ON w.exercise_id = e.id
      WHERE w.user_id = ?
      ORDER BY w.date DESC, w.created_at DESC
    `;
  } else if (schemaStatus.workoutsHasDuration) {
    // Nur duration da
    query = `
      SELECT w.id, w.user_id, w.exercise_id, w.weight, w.sets, w.reps, w.duration_seconds,
             w.rest_seconds, w.feeling, w.date, w.created_at,
             e.name as exercise_name, e.muscle_group, 'strength' as exercise_type
      FROM workouts w
      LEFT JOIN exercises e ON w.exercise_id = e.id
      WHERE w.user_id = ?
      ORDER BY w.date DESC, w.created_at DESC
    `;
  } else {
    // Altes Schema - minimales Query
    query = `
      SELECT w.*, e.name as exercise_name, e.muscle_group, 'strength' as exercise_type
      FROM workouts w
      LEFT JOIN exercises e ON w.exercise_id = e.id
      WHERE w.user_id = ?
      ORDER BY w.date DESC, w.created_at DESC
    `;
  }
  
  db.all(query, [req.user.userId], (err, rows) => {
    if (err) {
      console.error('❌ Fehler beim Laden:', err.message);
      // Ultimativer Fallback
      db.all('SELECT * FROM workouts WHERE user_id = ? ORDER BY date DESC', [req.user.userId], (err2, rows2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json(rows2);
      });
      return;
    }
    res.json(rows);
  });
});

// Neues Workout hinzufügen - ROBUST
app.post('/api/workouts', authenticateJWT, async (req, res) => {
  await checkSchema();
  
  const { exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date } = req.body;
  const safeDate = date || new Date().toISOString().split('T')[0];
  
  if (schemaStatus.workoutsHasDuration) {
    db.run(
      'INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.userId, exercise_id || null, weight || null, sets || null, reps || null, duration_seconds || null, rest_seconds || 60, feeling || 5, safeDate],
      function(err) {
        if (err) {
          console.error('❌ Fehler:', err.message);
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date: safeDate });
      }
    );
  } else {
    // Altes Schema ohne duration_seconds
    db.run(
      'INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, rest_seconds, feeling, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.userId, exercise_id || null, weight || null, sets || null, reps || null, rest_seconds || 60, feeling || 5, safeDate],
      function(err) {
        if (err) {
          console.error('❌ Fehler:', err.message);
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, exercise_id, weight, sets, reps, duration_seconds: null, rest_seconds, feeling, date: safeDate });
      }
    );
  }
});

// Workout aktualisieren
app.put('/api/workouts/:id', authenticateJWT, async (req, res) => {
  await checkSchema();
  
  const { exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date } = req.body;
  
  if (schemaStatus.workoutsHasDuration) {
    db.run(
      'UPDATE workouts SET exercise_id = ?, weight = ?, sets = ?, reps = ?, duration_seconds = ?, rest_seconds = ?, feeling = ?, date = ? WHERE id = ? AND user_id = ?',
      [exercise_id || null, weight || null, sets || null, reps || null, duration_seconds || null, rest_seconds, feeling, date, req.params.id, req.user.userId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Workout nicht gefunden' });
        res.json({ message: 'Workout aktualisiert' });
      }
    );
  } else {
    db.run(
      'UPDATE workouts SET exercise_id = ?, weight = ?, sets = ?, reps = ?, rest_seconds = ?, feeling = ?, date = ? WHERE id = ? AND user_id = ?',
      [exercise_id || null, weight || null, sets || null, reps || null, rest_seconds, feeling, date, req.params.id, req.user.userId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Workout nicht gefunden' });
        res.json({ message: 'Workout aktualisiert' });
      }
    );
  }
});

// Workout löschen
app.delete('/api/workouts/:id', authenticateJWT, (req, res) => {
  db.run('DELETE FROM workouts WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Workout gelöscht' });
  });
});

// Backup erstellen
app.post('/api/backup', authenticateJWT, async (req, res) => {
  try {
    if (!req.user.googleToken) {
      return res.status(400).json({ error: 'Nicht mit Google verbunden' });
    }
    
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: req.user.googleToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // Backup hochladen
    const fileMetadata = {
      name: `ironcoach_backup_user${req.user.userId}.db`,
      parents: [process.env.BACKUP_FOLDER_ID]
    };
    
    const media = {
      mimeType: 'application/x-sqlite3',
      body: fs.createReadStream(DB_PATH)
    };
    
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id'
    });
    
    res.json({ success: true, fileId: file.data.id });
  } catch (err) {
    console.error('Backup Fehler:', err);
    res.status(500).json({ error: err.message });
  }
});

// Restore
app.post('/api/restore', authenticateJWT, async (req, res) => {
  try {
    if (!req.user.googleToken) {
      return res.status(400).json({ error: 'Nicht mit Google verbunden' });
    }
    
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: req.user.googleToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // Backup suchen
    const response = await drive.files.list({
      q: `name='ironcoach_backup_user${req.user.userId}.db'`,
      fields: 'files(id, name)'
    });
    
    if (response.data.files.length === 0) {
      return res.status(404).json({ error: 'Kein Backup gefunden' });
    }
    
    const fileId = response.data.files[0].id;
    
    // Backup herunterladen
    const dest = fs.createWriteStream(DB_PATH + '.restore');
    const res2 = await drive.files.get({ fileId: fileId, alt: 'media' }, { responseType: 'stream' });
    
    res2.data.pipe(dest);
    
    dest.on('finish', () => {
      // Alte DB schließen, neue kopieren, neu laden
      db.close();
      fs.copyFileSync(DB_PATH + '.restore', DB_PATH);
      db = new sqlite3.Database(DB_PATH);
      fs.unlinkSync(DB_PATH + '.restore');
      
      // Schema neu laden
      schemaStatus = { workoutsHasDuration: false, exercisesHasType: false, initialized: false };
      checkSchema().then(() => {
        console.log('✅ Datenbank wiederhergestellt');
        res.json({ success: true });
      });
    });
    
    dest.on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
  } catch (err) {
    console.error('Restore Fehler:', err);
    res.status(500).json({ error: err.message });
  }
});

// Debug Endpoints
app.get('/api/debug/schema', (req, res) => {
  res.json(schemaStatus);
});

// Static Files
const publicPath = path.join(__dirname, 'public');
console.log('📁 Serving static files from:', publicPath);
app.use(express.static(publicPath));

// Fallback für SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Server starten
app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
