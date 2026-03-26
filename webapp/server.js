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
app.use(express.json());

// Session Setup
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// SQLite Datenbank
const DB_PATH = process.env.DATABASE_PATH || './training.db';
let db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Datenbank-Fehler:', err.message);
  } else {
    console.log('✅ Datenbank verbunden:', DB_PATH);
    // Foreign Keys aktivieren
    db.run('PRAGMA foreign_keys = ON');
  }
});

// Tabellen erstellen / migrieren
db.serialize(() => {
  // Users Tabelle
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT,
    google_id TEXT UNIQUE,
    display_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Exercises Tabelle - IMMER mit exercise_type für neue DBs
  db.run(`CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    muscle_group TEXT NOT NULL,
    exercise_type TEXT DEFAULT 'strength',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Migration: Prüfe ob user_id Spalte in exercises existiert
  db.all(`PRAGMA table_info(exercises)`, [], (err, columns) => {
    if (!err && columns) {
      const hasUserId = columns.some(col => col.name === 'user_id');
      if (!hasUserId) {
        console.log('⚠️ Migration: user_id Spalte fehlt in exercises, füge hinzu...');
        db.run(`ALTER TABLE exercises ADD COLUMN user_id INTEGER DEFAULT 0`, (alterErr) => {
          if (alterErr) {
            console.error('❌ Migration fehlgeschlagen:', alterErr.message);
          } else {
            console.log('✅ user_id Spalte zu exercises hinzugefügt');
          }
        });
      }
    }
  });

  // Migration: exercise_type zu exercises hinzufügen
  db.all(`PRAGMA table_info(exercises)`, [], (err, columns) => {
    if (!err && columns) {
      const hasExerciseType = columns.some(col => col.name === 'exercise_type');
      if (!hasExerciseType) {
        console.log('⚠️ Migration: exercise_type Spalte fehlt in exercises, füge hinzu...');
        db.run(`ALTER TABLE exercises ADD COLUMN exercise_type TEXT DEFAULT 'strength'`, (alterErr) => {
          if (alterErr) {
            console.error('❌ Migration fehlgeschlagen:', alterErr.message);
          } else {
            console.log('✅ exercise_type Spalte zu exercises hinzugefügt');
          }
        });
      }
    }
  });

  // Workouts Tabelle
  db.run(`CREATE TABLE IF NOT EXISTS workouts (
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
  )`);

  // Migration: duration_seconds zu workouts hinzufügen ODER Tabelle rekonstruieren
  db.all(`PRAGMA table_info(workouts)`, [], (err, columns) => {
    if (!err && columns) {
      const hasDuration = columns.some(col => col.name === 'duration_seconds');
      const weightCol = columns.find(col => col.name === 'weight');
      const isWeightNotNull = weightCol && weightCol.notnull === 1;
      
      if (!hasDuration || isWeightNotNull) {
        console.log('⚠️ Migration: Workouts-Tabelle hat falsches Schema, rekonstruiere...');
        
        // Tabelle neu erstellen mit korrektem Schema
        db.run(`BEGIN TRANSACTION`, () => {
          // Temp-Tabelle erstellen
          db.run(`CREATE TABLE workouts_new (
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
          )`, (err) => {
            if (err) {
              console.error('❌ Fehler beim Erstellen der neuen Tabelle:', err.message);
              db.run(`ROLLBACK`);
              return;
            }
            
            // Daten kopieren
            db.run(`INSERT INTO workouts_new 
              (id, user_id, exercise_id, weight, sets, reps, rest_seconds, feeling, date, created_at)
              SELECT id, user_id, exercise_id, weight, sets, reps, rest_seconds, feeling, date, created_at 
              FROM workouts`, (err) => {
              if (err) {
                console.error('❌ Fehler beim Kopieren der Daten:', err.message);
                db.run(`ROLLBACK`);
                return;
              }
              
              // Alte Tabelle löschen
              db.run(`DROP TABLE workouts`, (err) => {
                if (err) {
                  console.error('❌ Fehler beim Löschen der alten Tabelle:', err.message);
                  db.run(`ROLLBACK`);
                  return;
                }
                
                // Neue Tabelle umbenennen
                db.run(`ALTER TABLE workouts_new RENAME TO workouts`, (err) => {
                  if (err) {
                    console.error('❌ Fehler beim Umbenennen:', err.message);
                    db.run(`ROLLBACK`);
                    return;
                  }
                  
                  db.run(`COMMIT`, () => {
                    console.log('✅ Workouts-Tabelle erfolgreich rekonstruiert mit duration_seconds');
                  });
                });
              });
            });
          });
        });
      }
    }
  });

  // Migration: Prüfe ob user_id Spalte in workouts existiert
  db.all(`PRAGMA table_info(workouts)`, [], (err, columns) => {
    if (!err && columns) {
      const hasUserId = columns.some(col => col.name === 'user_id');
      if (!hasUserId) {
        console.log('⚠️ Migration: user_id Spalte fehlt in workouts, füge hinzu...');
        db.run(`ALTER TABLE workouts ADD COLUMN user_id INTEGER DEFAULT 0`, (alterErr) => {
          if (alterErr) {
            console.error('❌ Migration fehlgeschlagen:', alterErr.message);
          } else {
            console.log('✅ user_id Spalte zu workouts hinzugefügt');
          }
        });
      }
    }
  });
});

// JWT Middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

// API Key Middleware für IronCoach (festes Token)
const IRONCOACH_API_KEY = process.env.IRONCOACH_API_KEY || 'ironcoach-dev-key-change-in-production';

const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (apiKey === IRONCOACH_API_KEY) {
    // API Key valid - setze einen Mock-User für Martin (User ID 1)
    req.user = { userId: 1, email: 'martin@example.com', isApiKey: true };
    return next();
  }
  
  // Falls kein API Key, versuche JWT
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

// Passport Local Strategy
passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) return done(err);
      if (!user) return done(null, false, { message: 'User nicht gefunden' });
      if (!user.password) return done(null, false, { message: 'Bitte mit Google anmelden' });
      
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return done(null, false, { message: 'Falsches Passwort' });
      
      return done(null, user);
    });
  }
));

// Passport Google Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails[0].value;
    const googleId = profile.id;
    const displayName = profile.displayName;
    
    // Tokens für Drive-API speichern
    const authInfo = { accessToken, refreshToken };

    db.get('SELECT * FROM users WHERE google_id = ? OR email = ?', [googleId, email], (err, user) => {
      if (err) return done(err);
      
      if (user) {
        // Update google_id falls nötig
        if (!user.google_id) {
          db.run('UPDATE users SET google_id = ? WHERE id = ?', [googleId, user.id]);
        }
        return done(null, user, authInfo);
      }
      
      // Neuen User erstellen
      db.run('INSERT INTO users (email, google_id, display_name) VALUES (?, ?, ?)', 
        [email, googleId, displayName], function(err) {
        if (err) return done(err);
        const newUserId = this.lastID;
        
        // KEINE Standardübungen hier erstellen - erst nach Restore-Check im Client!
        
        db.get('SELECT * FROM users WHERE id = ?', [newUserId], (err, newUser) => {
          done(err, newUser, authInfo);
        });
      });
    });
  }));
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => done(err, user));
});

// === AUTH ROUTES ===

// Hilfsfunktion: Standardübungen für neuen User (nur wenn noch keine existieren)
function seedDefaultExercises(userId) {
  // Prüfen ob bereits Übungen existieren
  db.get('SELECT COUNT(*) as count FROM exercises WHERE user_id = ?', [userId], (err, row) => {
    if (err) {
      console.error('❌ Fehler beim Prüfen der Übungen:', err.message);
      return;
    }
    
    if (row.count > 0) {
      console.log(`ℹ️ User ${userId} hat bereits ${row.count} Übungen, überspringe Standardübungen`);
      return;
    }
    
    const defaultExercises = [
      // 🥋 Judo - Als eigene Kategorie (Zeit-basiert, da Techniktraining)
      { name: 'Uchi-Komi (Wurfübungen)', muscle_group: 'Judo', exercise_type: 'strength' },
      { name: 'Nage-Komi (Wurftraining)', muscle_group: 'Judo', exercise_type: 'strength' },
      { name: 'Randori (Freikampf)', muscle_group: 'Judo', exercise_type: 'time' },
      { name: 'Kata (Formen)', muscle_group: 'Judo', exercise_type: 'time' },
      { name: 'Sprungsukomikomi', muscle_group: 'Judo', exercise_type: 'strength' },
      { name: 'Explosive Beinarbeit', muscle_group: 'Judo', exercise_type: 'strength' },
      { name: 'Grip Fighting', muscle_group: 'Judo', exercise_type: 'strength' },
      { name: 'Ne-waza (Bodenkampf)', muscle_group: 'Judo', exercise_type: 'time' },
      { name: 'Turn-Uchikomi', muscle_group: 'Judo', exercise_type: 'strength' },
      
      // Gym - Brust (Kraft)
      { name: 'Bankdrücken (Langhantel)', muscle_group: 'Brust', exercise_type: 'strength' },
      { name: 'Schrägbankdrücken', muscle_group: 'Brust', exercise_type: 'strength' },
      { name: 'Fliegende (Butterfly)', muscle_group: 'Brust', exercise_type: 'strength' },
      { name: 'Dips', muscle_group: 'Brust', exercise_type: 'strength' },
      
      // Gym - Rücken (Kraft)
      { name: 'Kreuzheben', muscle_group: 'Rücken', exercise_type: 'strength' },
      { name: 'Klimmzüge', muscle_group: 'Rücken', exercise_type: 'strength' },
      { name: 'Rudern (Langhantel)', muscle_group: 'Rücken', exercise_type: 'strength' },
      { name: 'Latzug', muscle_group: 'Rücken', exercise_type: 'strength' },
      { name: 'T-Bar Rudern', muscle_group: 'Rücken', exercise_type: 'strength' },
      
      // Gym - Beine (Kraft)
      { name: 'Kniebeugen', muscle_group: 'Beine', exercise_type: 'strength' },
      { name: 'Beinpresse', muscle_group: 'Beine', exercise_type: 'strength' },
      { name: 'Beinstrecker', muscle_group: 'Beine', exercise_type: 'strength' },
      { name: 'Beinbeuger', muscle_group: 'Beine', exercise_type: 'strength' },
      { name: 'Wadenheben', muscle_group: 'Beine', exercise_type: 'strength' },
      { name: 'Ausfallschritte', muscle_group: 'Beine', exercise_type: 'strength' },
      
      // Gym - Schultern (Kraft)
      { name: 'Schulterdrücken', muscle_group: 'Schultern', exercise_type: 'strength' },
      { name: 'Seitheben', muscle_group: 'Schultern', exercise_type: 'strength' },
      { name: 'Frontheben', muscle_group: 'Schultern', exercise_type: 'strength' },
      { name: 'Face Pulls', muscle_group: 'Schultern', exercise_type: 'strength' },
      
      // Gym - Arme (Kraft)
      { name: 'Bizeps-Curls', muscle_group: 'Arme', exercise_type: 'strength' },
      { name: 'Trizeps-Drücken', muscle_group: 'Arme', exercise_type: 'strength' },
      { name: 'Hammer Curls', muscle_group: 'Arme', exercise_type: 'strength' },
      { name: 'Französisches Trizeps', muscle_group: 'Arme', exercise_type: 'strength' },
      
      // Gym - Bauch (Mix - Core-Übungen sind Zeit, Crunches sind Kraft)
      { name: 'Plank (Unterarmstütz)', muscle_group: 'Bauch', exercise_type: 'time' },
      { name: 'Crunches', muscle_group: 'Bauch', exercise_type: 'strength' },
      { name: 'Beinheben', muscle_group: 'Bauch', exercise_type: 'strength' },
      { name: 'Russische Twist', muscle_group: 'Bauch', exercise_type: 'strength' },
      { name: 'ADIM-Core (für Gleitwirbel)', muscle_group: 'Bauch', exercise_type: 'time' },
    ];
    
    let insertedCount = 0;
    defaultExercises.forEach(exercise => {
      // Versuche mit exercise_type, falls nicht vorhanden Fallback
      db.run('INSERT INTO exercises (user_id, name, muscle_group, exercise_type) VALUES (?, ?, ?, ?)',
        [userId, exercise.name, exercise.muscle_group, exercise.exercise_type],
        (err) => {
          if (err && err.message.includes('no column named exercise_type')) {
            // Fallback ohne exercise_type
            db.run('INSERT INTO exercises (user_id, name, muscle_group) VALUES (?, ?, ?)',
              [userId, exercise.name, exercise.muscle_group]);
          } else if (err) {
            console.error('❌ Fehler beim Erstellen der Übung:', err.message);
          } else {
            insertedCount++;
          }
        }
      );
    });
    
    console.log(`✅ ${defaultExercises.length} Standardübungen für User ${userId} erstellt`);
  });
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
      [email, hashedPassword, displayName || email], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(409).json({ error: 'Email bereits registriert' });
        }
        return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
      }
      
      const token = jwt.sign({ userId: this.lastID, email }, JWT_SECRET, { expiresIn: '24h' });
      
      // Standardübungen erstellen
      seedDefaultExercises(this.lastID);
      
      res.json({ token, user: { id: this.lastID, email, displayName: displayName || email } });
    });
  } catch (err) {
    res.status(500).json({ error: 'Serverfehler' });
  }
});

// Login
app.post('/api/auth/login', authLimiter, (req, res, next) => {
  passport.authenticate('local', { session: false }, (err, user, info) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: info.message });
    
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ 
      token, 
      user: { id: user.id, email: user.email, displayName: user.display_name } 
    });
  })(req, res, next);
});

// Google Auth Routes
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  app.get('/auth/google', passport.authenticate('google', { 
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/drive.file'],
    accessType: 'offline',
    prompt: 'consent'
  }));

  app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/login.html' }),
    (req, res) => {
      // Google Tokens für Drive-Backup in JWT speichern
      const tokenPayload = { 
        userId: req.user.id, 
        email: req.user.email 
      };
      
      // Wenn Google OAuth, zusätzliche Tokens speichern
      if (req.authInfo && req.authInfo.accessToken) {
        tokenPayload.googleAccessToken = req.authInfo.accessToken;
      }
      
      const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });
      res.redirect(`/?token=${token}`);
    }
  );
}

// Health Check
app.get('/api/health', (req, res) => {
  const apiKeyConfigured = !!process.env.IRONCOACH_API_KEY;
  const apiKeyValue = process.env.IRONCOACH_API_KEY ? process.env.IRONCOACH_API_KEY.substring(0, 10) + '...' : 'NOT SET';
  
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: 'SQLite',
    environment: process.env.NODE_ENV || 'development',
    googleOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    apiKey: {
      configured: apiKeyConfigured,
      preview: apiKeyValue
    }
  });
});

// Verify Token
app.get('/api/auth/verify', authenticateJWT, (req, res) => {
  res.json({ user: req.user });
});

// === PROTECTED API ROUTES ===

// Alle Übungen abrufen
app.get('/api/exercises', authenticateJWT, (req, res) => {
  db.all('SELECT * FROM exercises WHERE user_id = ? ORDER BY name', [req.user.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Neue Übung hinzufügen
app.post('/api/exercises', authenticateJWT, (req, res) => {
  const { name, muscle_group, exercise_type } = req.body;
  
  console.log('📝 Übung hinzufügen:', { name, muscle_group, exercise_type, userId: req.user.userId });
  
  if (!name || !muscle_group) {
    return res.status(400).json({ error: 'Name und Muskelgruppe erforderlich' });
  }
  
  if (!req.user.userId) {
    console.error('❌ Keine userId im Token');
    return res.status(401).json({ error: 'Nicht authentifiziert' });
  }
  
  const type = exercise_type || 'strength';
  
  // Versuche mit exercise_type - falls Spalte fehlt, Fallback auf Basis-INSERT
  db.run('INSERT INTO exercises (user_id, name, muscle_group, exercise_type) VALUES (?, ?, ?, ?)', 
    [req.user.userId, name, muscle_group, type], function(err) {
    if (err) {
      if (err.message.includes('no column named exercise_type')) {
        // Fallback: Ohne exercise_type einfügen
        console.log('⚠️ exercise_type Spalte fehlt, füge ohne hinzu');
        db.run('INSERT INTO exercises (user_id, name, muscle_group) VALUES (?, ?, ?)', 
          [req.user.userId, name, muscle_group], function(err2) {
          if (err2) {
            console.error('❌ DB Fehler (Fallback):', err2);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err2.message });
          }
          console.log('✅ Übung gespeichert (ohne exercise_type), ID:', this.lastID);
          res.json({ id: this.lastID, name, muscle_group, exercise_type: 'strength' });
        });
        return;
      }
      console.error('❌ DB Fehler:', err);
      return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
    }
    console.log('✅ Übung gespeichert, ID:', this.lastID);
    res.json({ id: this.lastID, name, muscle_group, exercise_type: type });
  });
});

// Übung aktualisieren (PUT)
app.put('/api/exercises/:id', authenticateJWT, (req, res) => {
  const { name, muscle_group, exercise_type } = req.body;
  
  if (!name || !muscle_group) {
    return res.status(400).json({ error: 'Name und Muskelgruppe erforderlich' });
  }
  
  const type = exercise_type || 'strength';
  
  db.run('UPDATE exercises SET name = ?, muscle_group = ?, exercise_type = ? WHERE id = ? AND user_id = ?',
    [name, muscle_group, type, req.params.id, req.user.userId], function(err) {
    if (err) {
      // Fallback wenn exercise_type Spalte fehlt
      if (err.message.includes('no column named exercise_type')) {
        db.run('UPDATE exercises SET name = ?, muscle_group = ? WHERE id = ? AND user_id = ?',
          [name, muscle_group, req.params.id, req.user.userId], function(err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ message: 'Übung aktualisiert', id: req.params.id, name, muscle_group, exercise_type: 'strength' });
        });
        return;
      }
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) return res.status(404).json({ error: 'Übung nicht gefunden' });
    res.json({ message: 'Übung aktualisiert', id: req.params.id, name, muscle_group, exercise_type: type });
  });
});

// Standardübungen erstellen (nach Restore)
app.post('/api/exercises/seed', authenticateJWT, (req, res) => {
  seedDefaultExercises(req.user.userId);
  res.json({ message: 'Standardübungen werden erstellt' });
});

// Übung löschen
app.delete('/api/exercises/:id', authenticateJWT, (req, res) => {
  db.run('DELETE FROM exercises WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Übung gelöscht' });
  });
});

// Alle Workouts abrufen
app.get('/api/workouts', authenticateJWT, (req, res) => {
  // Einfache Abfrage ohne JOIN - schnell und sicher
  const query = `
    SELECT w.id, w.user_id, w.exercise_id, w.weight, w.sets, w.reps, w.duration_seconds, w.rest_seconds, w.feeling, w.date, w.created_at,
           e.name as exercise_name, e.muscle_group, 
           COALESCE(e.exercise_type, 'strength') as exercise_type
    FROM workouts w 
    LEFT JOIN exercises e ON w.exercise_id = e.id 
    WHERE w.user_id = ?
    ORDER BY w.date DESC, w.created_at DESC
  `;
  db.all(query, [req.user.userId], (err, rows) => {
    if (err) {
      console.error('❌ Fehler beim Laden der Workouts:', err.message);
      // Fallback: Nur workouts ohne JOIN
      const fallbackQuery = `
        SELECT * FROM workouts WHERE user_id = ? ORDER BY date DESC
      `;
      db.all(fallbackQuery, [req.user.userId], (err2, rows2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json(rows2);
      });
      return;
    }
    res.json(rows);
  });
});

// Neues Workout hinzufügen - mit Fallback für duration_seconds
app.post('/api/workouts', authenticateJWT, (req, res) => {
  const { exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date } = req.body;
  
  // Versuche mit duration_seconds
  db.run(
    'INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [req.user.userId, exercise_id, weight || null, sets || null, reps || null, duration_seconds || null, rest_seconds, feeling, date],
    function(err) {
      if (err) {
        if (err.message.includes('no column')) {
          // Fallback ohne duration_seconds
          console.log('⚠️ duration_seconds fehlt, speichere ohne');
          db.run(
            'INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, rest_seconds, feeling, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [req.user.userId, exercise_id, weight || null, sets || null, reps || null, rest_seconds, feeling, date],
            function(err2) {
              if (err2) return res.status(500).json({ error: err2.message });
              res.json({ id: this.lastID, exercise_id, weight, sets, reps, duration_seconds: null, rest_seconds, feeling, date });
            }
          );
          return;
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date });
    }
  );
});

// Workout aktualisieren (PUT)
app.put('/api/workouts/:id', authenticateJWT, (req, res) => {
  const { exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date } = req.body;
  db.run(
    'UPDATE workouts SET exercise_id = ?, weight = ?, sets = ?, reps = ?, duration_seconds = ?, rest_seconds = ?, feeling = ?, date = ? WHERE id = ? AND user_id = ?',
    [exercise_id, weight || null, sets || null, reps || null, duration_seconds || null, rest_seconds, feeling, date, req.params.id, req.user.userId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Workout nicht gefunden' });
      res.json({ message: 'Workout aktualisiert', id: req.params.id, exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date });
    }
  );
});

// Workout löschen
app.delete('/api/workouts/:id', authenticateJWT, (req, res) => {
  db.run('DELETE FROM workouts WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Workout gelöscht' });
  });
});

// Statistiken abrufen
app.get('/api/stats', authenticateJWT, (req, res) => {
  const stats = {};
  const userId = req.user.userId;
  
  db.get('SELECT SUM(weight * sets * reps) as total_volume FROM workouts WHERE user_id = ?', [userId], (err, row) => {
    stats.total_volume = row?.total_volume || 0;
    
    db.get('SELECT COUNT(*) as total_workouts FROM workouts WHERE user_id = ?', [userId], (err, row) => {
      stats.total_workouts = row?.total_workouts || 0;
      
      db.get('SELECT COUNT(*) as total_exercises FROM exercises WHERE user_id = ?', [userId], (err, row) => {
        stats.total_exercises = row?.total_exercises || 0;
        
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        db.get('SELECT SUM(weight * sets * reps) as volume FROM workouts WHERE user_id = ? AND date >= ?', 
          [userId, weekAgo.toISOString().split('T')[0]], (err, row) => {
          stats.weekly_volume = row?.volume || 0;
          res.json(stats);
        });
      });
    });
  });
});

// Progress für eine Übung
app.get('/api/progress/:exercise_id', authenticateJWT, (req, res) => {
  const query = `
    SELECT date, weight, sets, reps, (weight * sets * reps) as volume
    FROM workouts 
    WHERE exercise_id = ? AND user_id = ?
    ORDER BY date ASC
  `;
  db.all(query, [req.params.exercise_id, req.user.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// === GOOGLE DRIVE BACKUP ===

// Backup zu Google Drive
app.post('/api/backup/drive', authenticateJWT, async (req, res) => {
  try {
    // Google Token aus JWT holen
    const accessToken = req.user.googleAccessToken;
    
    if (!accessToken) {
      return res.status(400).json({ 
        error: 'Nicht mit Google angemeldet. Bitte mit Google-Login neu anmelden (nicht Email/Passwort).' 
      });
    }
    
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // Suche ob Backup-Ordner existiert
    const folderResponse = await drive.files.list({
      q: "name='IronCoach-Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id, name)',
      spaces: 'drive'
    });
    
    let folderId;
    if (folderResponse.data.files.length === 0) {
      // Ordner erstellen
      const folder = await drive.files.create({
        requestBody: {
          name: 'IronCoach-Backups',
          mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
      });
      folderId = folder.data.id;
      console.log('✅ Backup-Ordner erstellt:', folderId);
    } else {
      folderId = folderResponse.data.files[0].id;
    }
    
    // Backup-Datei hochladen/aktualisieren
    const userId = req.user.userId || req.user.id;
    const filename = `ironcoach_backup_user${userId}.db`;
    
    // Prüfe ob Backup-Datei schon existiert
    const existingFileResponse = await drive.files.list({
      q: `name='${filename}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id, name)',
    });
    
    let file;
    if (existingFileResponse.data.files.length > 0) {
      // Existierende Datei aktualisieren
      const fileId = existingFileResponse.data.files[0].id;
      file = await drive.files.update({
        fileId: fileId,
        media: {
          mimeType: 'application/x-sqlite3',
          body: fs.createReadStream(DB_PATH),
        },
        fields: 'id, name, webViewLink',
      });
      console.log('✅ Backup aktualisiert:', filename);
    } else {
      // Neue Datei erstellen
      file = await drive.files.create({
        requestBody: {
          name: filename,
          parents: [folderId],
        },
        media: {
          mimeType: 'application/x-sqlite3',
          body: fs.createReadStream(DB_PATH),
        },
        fields: 'id, name, webViewLink',
      });
      console.log('✅ Backup erstellt:', filename);
    }
    
    res.json({ 
      success: true, 
      message: 'Backup erfolgreich',
      fileName: filename,
      link: file.data.webViewLink
    });
    
  } catch (error) {
    console.error('❌ Backup Fehler:', error);
    res.status(500).json({ error: 'Backup fehlgeschlagen: ' + error.message });
  }
});

// Restore von Google Drive
app.post('/api/restore/drive', authenticateJWT, async (req, res) => {
  try {
    // Prüfe ob Google OAuth vorhanden
    console.log('🔄 RESTORE-REQUEST für User:', req.user.userId || req.user.id);
    
    const accessToken = req.user.googleAccessToken;
    
    if (!accessToken) {
      console.log('❌ Kein Google Access Token im JWT');
      return res.json({ restored: false, message: 'Nicht mit Google angemeldet' });
    }
    
    console.log('✅ Google Token gefunden');
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    
    console.log('📡 Verbinde zu Google Drive...');
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // Suche Backup-Ordner
    console.log('🔍 Suche Backup-Ordner...');
    const folderResponse = await drive.files.list({
      q: "name='IronCoach-Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id, name)',
    });
    
    console.log('📁 Ordner-Suche Ergebnis:', folderResponse.data.files.length, 'gefunden');
    
    if (folderResponse.data.files.length === 0) {
      console.log('❌ Kein Backup-Ordner gefunden');
      return res.json({ restored: false, message: 'Kein Backup-Ordner gefunden' });
    }
    
    const folderId = folderResponse.data.files[0].id;
    console.log('✅ Backup-Ordner ID:', folderId);
    
    // Suche Backup-Datei
    const userId = req.user.userId || req.user.id;
    const filename = `ironcoach_backup_user${userId}.db`;
    console.log('🔍 Suche Datei:', filename);
    
    const fileResponse = await drive.files.list({
      q: `name='${filename}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, modifiedTime)',
    });
    
    console.log('📄 Datei-Suche Ergebnis:', fileResponse.data.files.length, 'gefunden');
    
    if (fileResponse.data.files.length === 0) {
      console.log('❌ Keine Backup-Datei gefunden');
      return res.json({ restored: false, message: 'Keine Backup-Datei gefunden' });
    }
    
    const fileId = fileResponse.data.files[0].id;
    console.log('✅ Backup-Datei ID:', fileId);
    
    // Prüfe ob lokale DB wichtige Daten enthält (Workouts, nicht nur User!)
    const backupModified = new Date(fileResponse.data.files[0].modifiedTime);
    let localModified = null;
    let hasLocalWorkouts = false;
    let workoutCount = 0;
    
    try {
      const stats = fs.statSync(DB_PATH);
      localModified = stats.mtime;
      
      // Prüfe ob WORKOUTS vorhanden sind (nicht nur User!)
      const result = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM workouts', [], (err, row) => {
          if (err) resolve(0);
          else resolve(row ? row.count : 0);
        });
      });
      workoutCount = result;
      hasLocalWorkouts = workoutCount > 0;
      console.log('📊 Lokale Workouts:', workoutCount);
    } catch (e) {
      console.log('ℹ Keine lokale DB vorhanden oder Fehler beim Lesen');
    }
    
    console.log('📊 Backup:', backupModified, '| Lokal:', localModified, '| Workouts:', hasLocalWorkouts);
    
    // Nur restore verweigern wenn lokale WORKOUTS vorhanden sind UND neuer
    if (hasLocalWorkouts && localModified && localModified > backupModified) {
      console.log('ℹ Lokale Workouts sind neuer als Backup');
      return res.json({ restored: false, message: 'Lokale Workouts sind neuer als Backup' });
    }
    
    console.log('📥 Starte Download...');
    
    // Backup vor Restore sichern (falls was schiefgeht)
    try {
      const backupPath = DB_PATH + '.backup';
      fs.copyFileSync(DB_PATH, backupPath);
      console.log('📁 Aktuelle DB gesichert nach:', backupPath);
    } catch (e) {
      console.log('⚠ Konnte aktuelle DB nicht sichern');
    }
    
    // Download Backup
    console.log('📥 Lade Backup herunter...');
    const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    
    // Schließe aktuelle DB
    await new Promise((resolve) => {
      db.close(() => {
        console.log('📁 Alte DB geschlossen');
        resolve();
      });
    });
    
    // Backup herunterladen
    const dest = fs.createWriteStream(DB_PATH);
    response.data.pipe(dest);
    
    await new Promise((resolve, reject) => {
      dest.on('finish', resolve);
      dest.on('error', (err) => {
        console.error('❌ Download Fehler:', err);
        reject(err);
      });
    });
    
    console.log('✅ Backup heruntergeladen');
    
    // DB neu verbinden
    await new Promise((resolve, reject) => {
      db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          console.error('❌ DB Verbindung fehlgeschlagen:', err);
          reject(err);
        } else {
          console.log('✅ DB neu verbunden');
          resolve();
        }
      });
    });
    
    // Foreign Keys wieder aktivieren
    db.run('PRAGMA foreign_keys = ON');
    
    res.json({ restored: true, message: 'Daten vom Backup wiederhergestellt' });
    
  } catch (error) {
    console.error('❌ Restore Fehler:', error);
    res.status(500).json({ error: 'Restore fehlgeschlagen: ' + error.message });
  }
});

// === API KEY ROUTES für IronCoach Analyse ===

// Trainingsdaten für Analyse (API-Key oder JWT)
app.get('/api/analytics/workouts', authenticateApiKey, (req, res) => {
  const query = `
    SELECT w.*, e.name as exercise_name, e.muscle_group 
    FROM workouts w 
    JOIN exercises e ON w.exercise_id = e.id 
    WHERE w.user_id = ?
    ORDER BY w.date DESC, w.created_at DESC
  `;
  db.all(query, [req.user.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Übersichts-Statistiken für Analyse
app.get('/api/analytics/summary', authenticateApiKey, (req, res) => {
  const userId = req.user.userId;
  const summary = {};
  
  // Gesamtvolumen
  db.get('SELECT SUM(weight * sets * reps) as total_volume FROM workouts WHERE user_id = ?', [userId], (err, row) => {
    summary.total_volume = row?.total_volume || 0;
    
    // Workouts gesamt
    db.get('SELECT COUNT(*) as total_workouts FROM workouts WHERE user_id = ?', [userId], (err, row) => {
      summary.total_workouts = row?.total_workouts || 0;
      
      // Letzte 7 Tage
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      db.get('SELECT COUNT(*) as count, SUM(weight * sets * reps) as volume FROM workouts WHERE user_id = ? AND date >= ?', 
        [userId, weekAgo.toISOString().split('T')[0]], (err, row) => {
        summary.this_week = {
          workouts: row?.count || 0,
          volume: row?.volume || 0
        };
        
        // Progress pro Übung
        db.all(`
          SELECT e.name, MAX(w.weight) as max_weight, COUNT(w.id) as workout_count,
                 AVG(w.weight * w.sets * w.reps) as avg_volume
          FROM workouts w
          JOIN exercises e ON w.exercise_id = e.id
          WHERE w.user_id = ?
          GROUP BY w.exercise_id
          ORDER BY workout_count DESC
        `, [userId], (err, rows) => {
          summary.exercise_progress = rows || [];
          res.json(summary);
        });
      });
    });
  });
});

// API Key Info
app.get('/api/analytics/key-info', (req, res) => {
  res.json({ 
    valid: req.headers['x-api-key'] === IRONCOACH_API_KEY,
    hint: 'Verwende Header: X-API-Key'
  });
});

// DEBUG: Check exercises schema
app.get('/api/debug/exercises-schema', (req, res) => {
  db.all(`PRAGMA table_info(exercises)`, [], (err, columns) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // Also get a sample exercise
    db.get(`SELECT * FROM exercises LIMIT 1`, [], (err2, row) => {
      res.json({
        columns: columns,
        sampleExercise: row || null,
        hasExerciseType: columns.some(c => c.name === 'exercise_type')
      });
    });
  });
});

// DEBUG: Check workouts table
app.get('/api/debug/workouts-check', (req, res) => {
  db.all(`PRAGMA table_info(workouts)`, [], (err, columns) => {
    if (err) return res.status(500).json({ error: err.message });
    
    res.json({
      columns: columns,
      hasDurationSeconds: columns.some(c => c.name === 'duration_seconds'),
      columnNames: columns.map(c => c.name)
    });
  });
});

// DEBUG: Show all workouts (no auth)
app.get('/api/debug/all-workouts', (req, res) => {
  db.all(`SELECT * FROM workouts LIMIT 20`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ 
      count: rows.length,
      workouts: rows
    });
  });
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
  console.log(`🔒 IronCoach Server läuft auf http://localhost:${PORT}`);
  console.log(`📊 Umgebung: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});
