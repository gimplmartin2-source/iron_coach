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

// Auto-Backup Funktionen
let autoBackupFunctions = null;

// Hilfsfunktion: Schedule Backup nach Änderung
function scheduleBackup(userId) {
  if (autoBackupFunctions && autoBackupFunctions.scheduleBackup) {
    autoBackupFunctions.scheduleBackup(userId).catch(err => {
      console.log('⚠️ Backup scheduled with error:', err.message);
    });
  }
}

const videoResolver = require('./video-resolver');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dein-geheimer-schluessel-mindestens-32-zeichen-lang';
const SESSION_SECRET = process.env.SESSION_SECRET || 'session-secret-mindestens-32-zeichen-lang-hier';

// ZENTRALE Standard-Übungen (nur einmal definiert!)
const DEFAULT_EXERCISES = [
    // Judo
    { name: 'Uchi-Komi (Wurfübungen)', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Nage-Komi (Wurftraining)', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Randori (Freikampf)', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Kata (Formen)', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Sprungsukomikomi', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Explosive Beinarbeit', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Grip Fighting', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Ne-waza (Bodenkampf)', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Turn-Uchikomi', muscle_group: 'Judo', exercise_type: 'strength' },
    // Brust
    { name: 'Bankdrücken (Langhantel)', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Bankdrücken Kurzhantel', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Schrägbankdrücken', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Fliegende (Butterfly)', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Dips', muscle_group: 'Brust', exercise_type: 'strength' },
    // Rücken
    { name: 'Kreuzheben', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Klimmzüge', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Rudern (Langhantel)', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Rudern Kabelzug', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Rudern Kurzhantel', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Latzug', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'T-Bar Rudern', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Rückenstrecker', muscle_group: 'Rücken', exercise_type: 'strength' },
    // Beine
    { name: 'Kniebeugen', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Beinpresse', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Beinstrecker', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Beinbeuger', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Wadenheben', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Ausfallschritte', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Beckenheben', muscle_group: 'Beine', exercise_type: 'strength' },
    // Schultern
    { name: 'Schulterdrücken', muscle_group: 'Schultern', exercise_type: 'strength' },
    { name: 'Seitheben', muscle_group: 'Schultern', exercise_type: 'strength' },
    { name: 'Frontheben', muscle_group: 'Schultern', exercise_type: 'strength' },
    { name: 'Face Pulls', muscle_group: 'Schultern', exercise_type: 'strength' },
    // Arme
    { name: 'Bizeps-Curls', muscle_group: 'Arme', exercise_type: 'strength' },
    { name: 'Hammer Curls', muscle_group: 'Arme', exercise_type: 'strength' },
    { name: 'Trizeps-Drücken Kabel', muscle_group: 'Arme', exercise_type: 'strength' },
    { name: 'Französisches Trizeps', muscle_group: 'Arme', exercise_type: 'strength' },
    // Core/Bauch (zeitbasiert = Plank, Side Plank, ADIM)
    { name: 'Plank (Unterarmstütz)', muscle_group: 'Bauch', exercise_type: 'time' },
    { name: 'Side Plank', muscle_group: 'Bauch', exercise_type: 'time' },
    { name: 'Crunches', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Beinheben', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Russische Twist', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Dead Bug', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Bird Dog', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Glute Bridge', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Pallof Press', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Torso Rotation', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'ADIM-Core (für Gleitwirbel)', muscle_group: 'Bauch', exercise_type: 'time' },
    // Mobilität/Dehnen
    { name: 'Katze-Kuh', muscle_group: 'Mobilität', exercise_type: 'time' },
    { name: 'Butterfly Stretch', muscle_group: 'Dehnen', exercise_type: 'time' },
    { name: 'Hüftdehnung', muscle_group: 'Dehnen', exercise_type: 'time' },
    { name: 'Kindhaltung', muscle_group: 'Mobilität', exercise_type: 'time' },
];

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
    google_access_token TEXT,
    display_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, 'Users Tabelle');
  
  // Migration: google_access_token hinzufügen
  const hasGoogleToken = await new Promise((resolve) => {
    db.all(`PRAGMA table_info(users)`, [], (err, cols) => {
      resolve(cols && cols.some(c => c.name === 'google_access_token'));
    });
  });
  
  if (!hasGoogleToken) {
    await runMigration(`ALTER TABLE users ADD COLUMN google_access_token TEXT`,
      'Migration: google_access_token zu users');
  }
  
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
  
  // Migration: UNIQUE Constraint auf exercises(user_id, name) hinzufügen
  // Hinweis: SQLite unterstützt ALTER TABLE ADD CONSTRAINT nicht
  // Wir prüfen ob Constraint existiert durch Versuch eines doppelten INSERTs
  console.log('🔍 Prüfe UNIQUE Constraint auf exercises...');
  const hasUniqueConstraint = await new Promise((resolve) => {
    // Erstelle temporäre Test-Übung
    db.run(`INSERT INTO exercises (user_id, name, muscle_group) VALUES (-999, '_unique_test_', 'Test')`, [], (err) => {
      if (err) {
        // Wenn Fehler wegen Constraint, ist alles OK
        resolve(err.message.includes('UNIQUE'));
      } else {
        // Test-Eintrag erfolgreich, also kein Constraint - löschen und false zurückgeben
        db.run(`DELETE FROM exercises WHERE user_id = -999`);
        resolve(false);
      }
    });
  });
  
  if (!hasUniqueConstraint) {
    console.log('⚠️  Kein UNIQUE Constraint gefunden. Führe Migration durch...');
    // Migration: Tabelle neu erstellen mit UNIQUE constraint
    await runMigration(`BEGIN TRANSACTION`, 'Migration Start');
    await runMigration(`
      CREATE TABLE exercises_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        muscle_group TEXT NOT NULL,
        exercise_type TEXT DEFAULT 'strength',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, name)
      )
    `, 'Erstelle neue Tabelle mit UNIQUE');
    await runMigration(`
      INSERT INTO exercises_new (user_id, name, muscle_group, exercise_type, created_at)
      SELECT user_id, name, muscle_group, COALESCE(exercise_type, 'strength'), created_at
      FROM exercises
    `, 'Kopiere Daten');
    await runMigration(`DROP TABLE exercises`, 'Lösche alte Tabelle');
    await runMigration(`ALTER TABLE exercises_new RENAME TO exercises`, 'Benenne Tabelle um');
    await runMigration(`COMMIT`, 'Migration Commit');
    console.log('✅ UNIQUE Constraint Migration abgeschlossen');
  } else {
    console.log('✅ UNIQUE Constraint bereits vorhanden');
  }
  
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

  // Migration: video_src zu exercises hinzufügen
  const hasVideoSrc = await new Promise((resolve) => {
    db.all(`PRAGMA table_info(exercises)`, [], (err, cols) => {
      resolve(cols && cols.some(c => c.name === 'video_src'));
    });
  });

  if (!hasVideoSrc) {
    await runMigration(`ALTER TABLE exercises ADD COLUMN video_src TEXT`,
      'Migration: video_src zu exercises');
  }
  
  // Migration: UNIQUE Index auf exercises (user_id, name) hinzufügen
  const hasUniqueIndex = await new Promise((resolve) => {
    db.get(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='index' AND name='idx_exercises_user_name'`, [], (err, row) => {
      resolve(row && row.count > 0);
    });
  });
  
  if (!hasUniqueIndex) {
    // Zuerst Duplikate entfernen (nur neueste behalten)
    console.log('🔧 Entferne Duplikate aus exercises...');
    db.run(`
      DELETE FROM exercises 
      WHERE id NOT IN (
        SELECT MIN(id) 
        FROM exercises 
        GROUP BY user_id, name
      )
    `, (err) => {
      if (err) {
        console.error('Fehler beim Entfernen von Duplikaten:', err);
      } else {
        console.log('✅ Duplikate entfernt');
        // Jetzt UNIQUE Index erstellen
        db.run(`CREATE UNIQUE INDEX idx_exercises_user_name ON exercises(user_id, name)`, (err2) => {
          if (err2) {
            console.error('Fehler beim Erstellen des UNIQUE Index:', err2);
          } else {
            console.log('✅ UNIQUE Index auf exercises erstellt');
          }
        });
      }
    });
  }
  
  // Schema neu laden
  schemaStatus = { workoutsHasDuration: false, exercisesHasType: false, initialized: false };
  await checkSchema();
  
  console.log('✅ Datenbank initialisiert');
}

// Datenbank beim Start initialisieren
initDatabase().then(async () => {
  console.log('✅ Datenbank initialisiert');
  
  // Auto-Restore für alle User mit Google Token
  console.log('🔄 Starte auto-restore für Google User...');
  try {
    // Lade auto-backup Funktionen
    const autoBackup = require('./auto-backup');
    if (autoBackup && autoBackup.autoRestoreOnStartup) {
      await autoBackup.autoRestoreOnStartup(db);
    }
  } catch (err) {
    console.log('ℹ️ Auto-restore Modul nicht geladen:', err.message);
  }
  
  // Speichere scheduleBackup Funktion global
  const autoBackup = require('./auto-backup');
  if (autoBackup) {
    global.scheduleBackupFn = autoBackup.scheduleBackup;
  }
}).catch(err => {
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
        // Update access token
        db.run('UPDATE users SET google_access_token = ? WHERE id = ?', [accessToken, user.id], () => {
          user.google_access_token = accessToken;
          done(null, user);
        });
        return;
      }
      
      const email = profile.emails[0].value;
      db.run('INSERT INTO users (email, google_id, display_name, google_access_token) VALUES (?, ?, ?, ?)',
        [email, profile.id, profile.displayName, accessToken],
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
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Token ungültig' });
      }
      
      // User aus Token - vertraue dem Token!
      req.user = {
        userId: decoded.userId,
        email: decoded.email
      };
      
      // Versuche Google Token zu laden (optional)
      db.get('SELECT google_access_token FROM users WHERE id = ?', [decoded.userId], (err, row) => {
        if (!err && row) {
          req.user.googleToken = row.google_access_token;
        }
        next();
      });
    });
  } else {
    res.status(401).json({ error: 'Nicht autorisiert' });
  }
};

// Standard-Übungen erstellen
function createDefaultExercises(userId) {
  // Prüfe zuerst ob schon Übungen existieren
  db.get('SELECT COUNT(*) as count FROM exercises WHERE user_id = ?', [userId], (err, row) => {
    if (err) {
      console.error('Fehler beim Prüfen:', err);
      return;
    }
    // Wenn schon Übungen existieren, nicht neu erstellen
    if (row.count > 0) {
      console.log(`✅ User ${userId} hat schon ${row.count} Übungen, überspringe Standard-Übungen`);
      return;
    }
    
    // Sonst Standard-Übungen erstellen (aus zentraler Konstante)
    DEFAULT_EXERCISES.forEach(exercise => {
      // Video-Mapping hinzuf�gen
  const videoMapping = '';
  const videoSrc = videoMapping || null;
  
  db.run('INSERT INTO exercises (user_id, name, muscle_group, exercise_type, video_src) VALUES (?, ?, ?, ?, ?)',
        [userId, exercise.name, exercise.muscle_group, exercise.exercise_type, videoSrc],
        (err) => {
          if (err && !err.message.includes('UNIQUE constraint failed')) {
            console.error('❌ Fehler beim Erstellen der Übung:', err.message);
          }
        }
      );
    });
    
    console.log(`✅ ${DEFAULT_EXERCISES.length} Standardübungen für User ${userId} erstellt (falls nicht vorhanden)`);
  });
}

// Fehlende Standard-Übungen nach Restore ergänzen (Merge-Modus)
function syncDefaultExercises(userId) {
  let added = 0;
  DEFAULT_EXERCISES.forEach(exercise => {
    db.run('INSERT OR IGNORE INTO exercises (user_id, name, muscle_group, exercise_type) VALUES (?, ?, ?, ?)',
      [userId, exercise.name, exercise.muscle_group, exercise.exercise_type],
      function(err) {
        if (!err && this.changes > 0) {
          added++;
        }
      }
    );
  });
  
  console.log(`🔄 ${added} fehlende Standardübungen für User ${userId} ergänzt`);
}

// Fehlende Standard-Übungen nach Restore ergänzen (Merge-Modus) - ASYNC VERSION
async function syncDefaultExercisesAsync(userId) {
  // Alle INSERTs als Promises
  const promises = DEFAULT_EXERCISES.map(exercise => {
    return new Promise((resolve) => {
      db.run('INSERT OR IGNORE INTO exercises (user_id, name, muscle_group, exercise_type) VALUES (?, ?, ?, ?)',
        [userId, exercise.name, exercise.muscle_group, exercise.exercise_type],
        function(err) {
          if (!err && this.changes > 0) {
            resolve(1);
          } else {
            resolve(0);
          }
        }
      );
    });
  });
  
  const results = await Promise.all(promises);
  const added = results.reduce((a, b) => a + b, 0);
  console.log(`🔄 ${added} fehlende Standardübungen für User ${userId} ergänzt`);
  return added;
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
    // WICHTIG: Google Access Token ins JWT packen für Auto-Backup
    const token = jwt.sign({ 
      userId: req.user.id, 
      email: req.user.email,
      googleAccessToken: req.user.google_access_token 
    }, JWT_SECRET, { expiresIn: '7d' });
    res.redirect(`/?token=${token}`);
  }
);

// Alle Übungen abrufen (mit Video)
app.get('/api/exercises', authenticateJWT, async (req, res) => {
  try {
    await checkSchema();
    
    // Prüfe ob video_src Spalte existiert
    const hasVideoSrc = await new Promise((resolve) => {
      db.all(`PRAGMA table_info(exercises)`, [], (err, cols) => {
        resolve(cols && cols.some(c => c.name === 'video_src'));
      });
    });
    
    // Query mit oder ohne video_src
    const query = hasVideoSrc 
      ? `SELECT id, user_id, name, muscle_group, 
                COALESCE(exercise_type, 'strength') as exercise_type,
                video_src,
                created_at 
         FROM exercises 
         WHERE user_id = ?`
      : `SELECT id, user_id, name, muscle_group, 
                COALESCE(exercise_type, 'strength') as exercise_type,
                NULL as video_src,
                created_at 
         FROM exercises 
         WHERE user_id = ?`;
    
    db.all(query, [req.user.userId], (err, rows) => {
      if (err) {
        console.error('❌ DB Fehler in /api/exercises:', err);
        return res.status(500).json({ error: err.message });
      }
      
      // Sicherstellen dass rows ein Array ist
      const safeRows = Array.isArray(rows) ? rows : [];
      
      try {
        // Video-Resolver für Übungen ohne video_src
        const enrichedRows = safeRows.map(row => ({
          ...row,
          video_src: row.video_src || videoResolver.getVideoForExercise(row.name)
        }));
        
        res.json(enrichedRows);
      } catch (resolverErr) {
        console.error('❌ Video Resolver Fehler:', resolverErr);
        // Im Fehlerfall trotzdem die Daten ohne Video zurückgeben
        res.json(safeRows.map(row => ({ ...row, video_src: null })));
      }
    });
  } catch (err) {
    console.error('❌ Unhandled Fehler in /api/exercises:', err);
    res.status(500).json({ error: err.message });
  }
});

// Neue �bung hinzuf�gen (mit Video)
app.post('/api/exercises', authenticateJWT, async (req, res) => {
  await checkSchema();
  
  const { name, muscle_group, exercise_type } = req.body;
  const type = exercise_type || 'strength';
  
  // Automatisch Video zuweisen
  const videoSrc = videoResolver.getVideoForExercise(name);
  
  db.run('INSERT INTO exercises (user_id, name, muscle_group, exercise_type, video_src) VALUES (?, ?, ?, ?, ?)',
    [req.user.userId, name, muscle_group, type, videoSrc],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        id: this.lastID,
        user_id: req.user.userId,
        name,
        muscle_group,
        exercise_type: type,
        video_src: videoSrc
      });
      if (global.scheduleBackupFn) global.scheduleBackupFn(req.user.userId);
    }
  );
});

// Standard-Übungen synchronisieren (fehlende hinzufügen) - für Google Login
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

// Übung aktualisieren
app.put('/api/exercises/:id', authenticateJWT, async (req, res) => {
  await checkSchema();
  
  const { name, muscle_group, exercise_type } = req.body;
  const type = exercise_type || 'strength';
  
  // Versuche immer exercise_type zu speichern (falls Spalte existiert)
  db.run('UPDATE exercises SET name = ?, muscle_group = ?, exercise_type = ? WHERE id = ? AND user_id = ?',
    [name, muscle_group, type, req.params.id, req.user.userId],
    function(err) {
      if (err) {
        // Falls exercise_type Spalte fehlt, ohne die Spalte updaten
        if (err.message.includes('no such column')) {
          db.run('UPDATE exercises SET name = ?, muscle_group = ? WHERE id = ? AND user_id = ?',
            [name, muscle_group, req.params.id, req.user.userId],
            function(err2) {
              if (err2) return res.status(500).json({ error: err2.message });
              if (this.changes === 0) return res.status(404).json({ error: 'Übung nicht gefunden' });
              res.json({ message: 'Übung aktualisiert (ohne Typ)', id: req.params.id, name, muscle_group });
            });
          return;
        }
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) return res.status(404).json({ error: 'Übung nicht gefunden' });
      res.json({ message: 'Übung aktualisiert', id: req.params.id, name, muscle_group, exercise_type: type });
    });
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
    // Wichtig: Wenn duration_seconds > 0 UND weight = 0, dann ist es eine Zeit-Übung
    query = `
      SELECT w.id, w.user_id, w.exercise_id, w.weight, w.sets, w.reps, w.duration_seconds,
             w.rest_seconds, w.feeling, w.date, w.created_at,
             e.name as exercise_name, e.muscle_group,
             CASE 
               WHEN e.exercise_type IS NOT NULL THEN e.exercise_type
               WHEN w.duration_seconds > 0 AND (w.weight IS NULL OR w.weight = 0) THEN 'time'
               ELSE 'strength'
             END as exercise_type
      FROM workouts w
      LEFT JOIN exercises e ON w.exercise_id = e.id
      WHERE w.user_id = ?
      ORDER BY w.date DESC, w.created_at DESC
    `;
  } else if (schemaStatus.workoutsHasDuration) {
    // Nur duration da - CASE statement fuer Zeit-Erkennung
    query = `
      SELECT w.id, w.user_id, w.exercise_id, w.weight, w.sets, w.reps, w.duration_seconds,
             w.rest_seconds, w.feeling, w.date, w.created_at,
             e.name as exercise_name, e.muscle_group,
             CASE 
               WHEN e.exercise_type IS NOT NULL THEN e.exercise_type
               WHEN w.duration_seconds > 0 AND (w.weight IS NULL OR w.weight = 0) THEN 'time'
               ELSE 'strength'
             END as exercise_type
      FROM workouts w
      LEFT JOIN exercises e ON w.exercise_id = e.id
      WHERE w.user_id = ?
      ORDER BY w.date DESC, w.created_at DESC
    `;
  } else {
    // Altes Schema - minimales Query
    // Zeit-Erkennung bei alten Daten: sets=1, weight=0, reps>0
    query = `
      SELECT w.*, e.name as exercise_name, e.muscle_group,
             CASE
               WHEN e.exercise_type IS NOT NULL THEN e.exercise_type
               WHEN (w.weight IS NULL OR w.weight = 0) AND (w.sets IS NULL OR w.sets <= 1) AND w.reps > 0 THEN 'time'
               ELSE 'strength'
             END as exercise_type
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
      [req.user.userId, exercise_id || null, weight !== undefined ? weight : null, sets !== undefined ? sets : null, reps !== undefined ? reps : null, duration_seconds !== undefined ? duration_seconds : null, rest_seconds || 60, feeling || 5, safeDate],
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
      [req.user.userId, exercise_id || null, weight !== undefined ? weight : null, sets !== undefined ? sets : null, reps !== undefined ? reps : null, rest_seconds || 60, feeling || 5, safeDate],
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
      [exercise_id || null, weight !== undefined ? weight : null, sets !== undefined ? sets : null, reps !== undefined ? reps : null, duration_seconds !== undefined ? duration_seconds : null, rest_seconds, feeling, date, req.params.id, req.user.userId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Workout nicht gefunden' });
        res.json({ message: 'Workout aktualisiert' });
      }
    );
  } else {
    db.run(
      'UPDATE workouts SET exercise_id = ?, weight = ?, sets = ?, reps = ?, rest_seconds = ?, feeling = ?, date = ? WHERE id = ? AND user_id = ?',
      [exercise_id || null, weight !== undefined ? weight : null, sets !== undefined ? sets : null, reps !== undefined ? reps : null, rest_seconds, feeling, date, req.params.id, req.user.userId],
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

// Stats für Dashboard
app.get('/api/stats', authenticateJWT, (req, res) => {
  const userId = req.user.userId;
  
  // Gesamtvolumen
  db.get(`SELECT COALESCE(SUM(weight * sets * reps), 0) as total_volume FROM workouts WHERE user_id = ?`, [userId], (err, volume) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // Anzahl Workouts
    db.get(`SELECT COUNT(*) as count FROM workouts WHERE user_id = ?`, [userId], (err, count) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // Anzahl Übungen
      db.get(`SELECT COUNT(*) as count FROM exercises WHERE user_id = ?`, [userId], (err, exercises) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Diese Woche
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekStartStr = weekStart.toISOString().split('T')[0];
        
        db.get(`SELECT COALESCE(SUM(weight * sets * reps), 0) as week_volume FROM workouts WHERE user_id = ? AND date >= ?`, [userId, weekStartStr], (err, week) => {
          if (err) return res.status(500).json({ error: err.message });
          
          res.json({
            total_volume: volume.total_volume,
            total_workouts: count.count,
            total_exercises: exercises.count,
            weekly_volume: week.week_volume
          });
        });
      });
    });
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

// Restore - akzeptiert Token aus DB oder aus Request Body
// WICHTIG: Route muss VOR app.get('*') sein
app.post('/api/restore', authenticateJWT, async (req, res) => {
  try {
    // Token aus Request Body (frisch vom Frontend) oder aus DB
    const googleToken = req.body.googleToken || req.user.googleToken;
    
    if (!googleToken) {
      return res.status(400).json({ error: 'Google Token erforderlich. Bitte neu mit Google einloggen oder Token manuell eingeben.' });
    }
    
    console.log('🔄 Starte Restore mit Google Token...');
    
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleToken });
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
    
    dest.on('finish', async () => {
      // Alte DB schließen, neue kopieren, neu laden
      db.close();
      fs.copyFileSync(DB_PATH + '.restore', DB_PATH);
      db = new sqlite3.Database(DB_PATH);
      fs.unlinkSync(DB_PATH + '.restore');
      
      // Schema neu laden und MIGRATION durchführen
      schemaStatus = { workoutsHasDuration: false, exercisesHasType: false, initialized: false };
      await checkSchema();
      
      // Migration: duration_seconds Spalte hinzufügen falls fehlt
      if (!schemaStatus.workoutsHasDuration) {
        console.log('🔧 Migration: Füge duration_seconds Spalte hinzu...');
        await new Promise((resolve) => {
          db.run('ALTER TABLE workouts ADD COLUMN duration_seconds INTEGER', (err) => {
            if (err && !err.message.includes('duplicate column')) {
              console.error('Migration Fehler:', err);
            } else {
              console.log('✅ Migration erfolgreich');
              schemaStatus.workoutsHasDuration = true;
            }
            resolve();
          });
        });
      }
      
      // Migration: exercise_type zur exercises Tabelle
      if (!schemaStatus.exercisesHasType) {
        console.log('🔧 Migration: Füge exercise_type Spalte hinzu...');
        await new Promise((resolve) => {
          db.run('ALTER TABLE exercises ADD COLUMN exercise_type TEXT DEFAULT "strength"', (err2) => {
            if (err2 && !err2.message.includes('duplicate column')) {
              console.error('Migration Fehler:', err2);
            } else {
              schemaStatus.exercisesHasType = true;
            }
            resolve();
          });
        });
      }
      
      // WICHTIG: Unique Constraint sicherstellen nach Restore
      console.log('🔧 Prüfe UNIQUE Constraint nach Restore...');
      const hasUnique = await new Promise((resolve) => {
        db.all(`PRAGMA index_list(exercises)`, [], (err, rows) => {
          if (err) resolve(false);
          else resolve(rows && rows.some(r => r.unique && r.name.includes('exercises')));
        });
      });
      
      if (!hasUnique) {
        console.log('🔧 Migration: Füge UNIQUE Constraint hinzu...');
        await new Promise((resolve) => {
          db.run(`BEGIN TRANSACTION`, [], (err) => {
            if (err) { resolve(); return; }
            
            // Entferne Duplikate zuerst
            db.run(`
              DELETE FROM exercises 
              WHERE id NOT IN (
                SELECT MIN(id) 
                FROM exercises 
                GROUP BY user_id, name
              )
            `, [], function(err) {
              if (err) { db.run(`ROLLBACK`); resolve(); return; }
              
              console.log(`   ✅ ${this.changes} Duplikate entfernt`);
              
              // Tabelle neu erstellen mit UNIQUE
              db.run(`
                CREATE TABLE exercises_new (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER NOT NULL,
                  name TEXT NOT NULL,
                  muscle_group TEXT NOT NULL,
                  exercise_type TEXT DEFAULT 'strength',
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                  UNIQUE(user_id, name)
                )
              `, [], (err) => {
                if (err) { db.run(`ROLLBACK`); resolve(); return; }
                
                db.run(`INSERT INTO exercises_new SELECT * FROM exercises`, [], function(err) {
                  if (err) { db.run(`ROLLBACK`); resolve(); return; }
                  
                  db.run(`DROP TABLE exercises`, [], (err) => {
                    if (err) { db.run(`ROLLBACK`); resolve(); return; }
                    
                    db.run(`ALTER TABLE exercises_new RENAME TO exercises`, [], (err) => {
                      if (err) { db.run(`ROLLBACK`); resolve(); return; }
                      
                      db.run(`COMMIT`, [], (err) => {
                        console.log('   ✅ UNIQUE Constraint hinzugefügt');
                        resolve();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      }
      
      // ACHTUNG: Nach Restore fehlende Standard-Übungen ergänzen
      console.log('🔄 Synchronisiere Standard-Übungen nach Restore...');
      await syncDefaultExercisesAsync(req.user.userId);
      res.json({ success: true });
    });
    
    dest.on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
  } catch (err) {
    console.error('Restore Fehler:', err);
    res.status(500).json({ error: err.message });
  }
});

// Duplikate entfernen (Admin/Debug Endpunkt)
app.post('/api/admin/fix-duplicates', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log(`🔧 Fix Duplikate für User ${userId}...`);
    
    // Finde Duplikate für diesen User
    const duplicates = await new Promise((resolve, reject) => {
      db.all(`
        SELECT name, COUNT(*) as count, MIN(id) as keep_id, GROUP_CONCAT(id) as all_ids
        FROM exercises 
        WHERE user_id = ?
        GROUP BY name 
        HAVING count > 1
      `, [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    if (duplicates.length === 0) {
      return res.json({ success: true, message: 'Keine Duplikate gefunden', deleted: 0 });
    }
    
    let deletedCount = 0;
    
    for (const dup of duplicates) {
      const ids = dup.all_ids.split(',').map(Number);
      const keepId = dup.keep_id;
      const deleteIds = ids.filter(id => id !== keepId);
      
      console.log(`   Lösche Duplikate für "${dup.name}": IDs [${deleteIds.join(', ')}]`);
      
      // Lösche Duplikate
      const placeholders = deleteIds.map(() => '?').join(',');
      await new Promise((resolve, reject) => {
        db.run(`DELETE FROM exercises WHERE id IN (${placeholders})`, deleteIds, function(err) {
          if (err) reject(err);
          else {
            deletedCount += this.changes;
            resolve();
          }
        });
      });
    }
    
    console.log(`✅ ${deletedCount} Duplikate entfernt`);
    res.json({ 
      success: true, 
      deleted: deletedCount, 
      duplicatesFound: duplicates.length,
      message: `${deletedCount} Duplikate entfernt`
    });
    
  } catch (err) {
    console.error('❌ Fehler:', err);
    res.status(500).json({ error: err.message });
  }
});

// Debug Endpoints
app.get('/api/debug/schema', (req, res) => {
  res.json(schemaStatus);
});

// Debug: Zeige Duplikate (ohne löschen)
app.get('/api/debug/duplicates', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const duplicates = await new Promise((resolve, reject) => {
      db.all(`
        SELECT name, COUNT(*) as count, GROUP_CONCAT(id) as ids
        FROM exercises 
        WHERE user_id = ?
        GROUP BY name 
        HAVING count > 1
      `, [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json({ 
      userId, 
      duplicatesFound: duplicates.length,
      duplicates 
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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




