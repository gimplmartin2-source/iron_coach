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

// Token-Laufzeiten (in Sekunden oder als String)
const TOKEN_SHORT = '24h';      // Standard-Session
const TOKEN_LONG = '365d';      // "Eingeloggt bleiben" (1 Jahr)

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
// WICHTIG: Session-Cookie auf 1 Jahr setzen für "Eingeloggt bleiben"
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: ONE_YEAR_MS
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
  
  // Google Refresh Tokens Tabelle (neu)
  db.run(`CREATE TABLE IF NOT EXISTS user_tokens (
    user_id INTEGER PRIMARY KEY,
    google_refresh_token TEXT,
    jwt_refresh_token TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Migration: jwt_refresh_token Spalte hinzufügen falls noch nicht vorhanden
  db.all(`PRAGMA table_info(user_tokens)`, [], (err, columns) => {
    if (!err && columns) {
      const hasJwtRefresh = columns.some(col => col.name === 'jwt_refresh_token');
      if (!hasJwtRefresh) {
        console.log('⚠️ Migration: jwt_refresh_token Spalte fehlt, füge hinzu...');
        db.run(`ALTER TABLE user_tokens ADD COLUMN jwt_refresh_token TEXT`, (alterErr) => {
          if (alterErr) {
            console.error('❌ Migration fehlgeschlagen:', alterErr.message);
          } else {
            console.log('✅ jwt_refresh_token Spalte zu user_tokens hinzugefügt');
          }
        });
      }
    }
  });

  // Exercises Tabelle - immer neu erstellen falls nicht existiert
  db.run(`CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    muscle_group TEXT NOT NULL,
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
      
      // Migration: Prüfe ob exercise_type Spalte existiert
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
    weight REAL NOT NULL,
    sets INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    duration_seconds INTEGER,
    rest_seconds INTEGER,
    feeling INTEGER CHECK(feeling >= 1 AND feeling <= 10),
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
  )`);

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
      
      // Migration: Prüfe ob duration_seconds Spalte existiert
      const hasDuration = columns.some(col => col.name === 'duration_seconds');
      if (!hasDuration) {
        console.log('⚠️ Migration: duration_seconds Spalte fehlt in workouts, füge hinzu...');
        db.run(`ALTER TABLE workouts ADD COLUMN duration_seconds INTEGER`, (alterErr) => {
          if (alterErr) {
            console.error('❌ Migration fehlgeschlagen:', alterErr.message);
          } else {
            console.log('✅ duration_seconds Spalte zu workouts hinzugefügt');
          }
        });
      }
    }
  });

  // Training Plans Tabelle
  db.run(`CREATE TABLE IF NOT EXISTS training_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    plan_data TEXT NOT NULL,
    is_active INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
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

// Hilfsfunktion: JWT Refresh Token generieren und speichern
function generateJwtRefreshToken() {
  return require('crypto').randomBytes(64).toString('hex');
}

async function storeJwtRefreshToken(userId, refreshToken) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO user_tokens (user_id, jwt_refresh_token, updated_at) VALUES (?, ?, datetime("now"))',
      [userId, refreshToken],
      (err) => {
        if (err) {
          console.error('❌ Fehler beim Speichern des JWT Refresh Tokens:', err.message);
          reject(err);
        } else {
          console.log('✅ JWT Refresh Token gespeichert für User:', userId);
          resolve();
        }
      }
    );
  });
}

async function getJwtRefreshToken(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT jwt_refresh_token FROM user_tokens WHERE user_id = ?', [userId], (err, row) => {
      if (err) {
        console.error('❌ Fehler beim Lesen des JWT Refresh Tokens:', err.message);
        reject(err);
      } else {
        resolve(row ? row.jwt_refresh_token : null);
      }
    });
  });
}

async function revokeJwtRefreshToken(userId) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE user_tokens SET jwt_refresh_token = NULL WHERE user_id = ?', [userId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// WICHTIG: Hilfsfunktion zum Erneuern des Google Access Tokens
async function refreshGoogleAccessToken(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT google_refresh_token FROM user_tokens WHERE user_id = ?', [userId], async (err, row) => {
      if (err || !row || !row.google_refresh_token) {
        console.log('ℹ️ Kein Refresh Token gefunden für User:', userId);
        return resolve(null);
      }
      
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        );
        
        oauth2Client.setCredentials({ refresh_token: row.google_refresh_token });
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        console.log('✅ Access Token erfolgreich erneuert für User:', userId);
        resolve(credentials.access_token);
      } catch (error) {
        console.error('❌ Fehler beim Erneuern des Access Tokens:', error.message);
        resolve(null);
      }
    });
  });
}

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
  // Baue absolute URL für Callback
  const getBaseUrl = () => {
    // Render setzt diese Variable automatisch
    if (process.env.RENDER_EXTERNAL_URL) {
      return process.env.RENDER_EXTERNAL_URL;  // z.B. https://trainings-tracker-7kuw.onrender.com
    }
    // Fallback: aus Host bauen
    const host = process.env.RENDER_EXTERNAL_HOSTNAME || process.env.HOST || 'localhost';
    const isSecure = process.env.NODE_ENV === 'production';
    return isSecure ? `https://${host}` : `http://${host}:${PORT}`;
  };
  
  const callbackURL = `${getBaseUrl()}/auth/google/callback`;
  console.log('🔑 Google OAuth Callback URL:', callbackURL);
  
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: callbackURL
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
        
        // WICHTIG: Refresh Token speichern für automatische Erneuerung
        if (refreshToken) {
          db.run(
            'INSERT OR REPLACE INTO user_tokens (user_id, google_refresh_token, updated_at) VALUES (?, ?, datetime("now"))',
            [user.id, refreshToken],
            (err) => {
              if (err) console.error('❌ Fehler beim Speichern des Refresh Tokens:', err.message);
              else console.log('✅ Refresh Token gespeichert für User:', user.id);
            }
          );
        }
        
        return done(null, user, authInfo);
      }
      
      // Neuen User erstellen
      db.run('INSERT INTO users (email, google_id, display_name) VALUES (?, ?, ?)', 
        [email, googleId, displayName], function(err) {
        if (err) return done(err);
        const newUserId = this.lastID;
        
        // WICHTIG: Refresh Token für neuen User speichern
        if (refreshToken) {
          db.run(
            'INSERT INTO user_tokens (user_id, google_refresh_token, updated_at) VALUES (?, ?, datetime("now"))',
            [newUserId, refreshToken],
            (err) => {
              if (err) console.error('❌ Fehler beim Speichern des Refresh Tokens:', err.message);
              else console.log('✅ Refresh Token gespeichert für neuen User:', newUserId);
            }
          );
        }
        
        // Standardübungen erstellen
        seedDefaultExercises(newUserId);
        
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

// Hilfsfunktion: Standardübungen für neuen User
function seedDefaultExercises(userId) {
  const defaultExercises = [
    // Arme
    { name: 'Bizepscurls Kurzhantel', muscle_group: 'Arme', exercise_type: 'strength' },
    { name: 'French Press', muscle_group: 'Arme', exercise_type: 'strength' },
    { name: 'Hammer Curl', muscle_group: 'Arme', exercise_type: 'strength' },
    { name: 'Hammercurl Kurzhantel', muscle_group: 'Arme', exercise_type: 'strength' },
    { name: 'Trizeps Pulldown Maschine', muscle_group: 'Arme', exercise_type: 'strength' },

    // Bauch
    { name: 'ADIM-Core (für Gleitwirbel)', muscle_group: 'Bauch', exercise_type: 'time' },
    { name: 'Bauchroller', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Beineheben angewinkelt auf Physio Art', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Beinheben', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Beinheben Klimmzugstange', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Beinheben Klimmzugstange Extrem', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Crunches', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Crunches Maschine', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Dead Bug Hold', muscle_group: 'Bauch', exercise_type: 'time' },
    { name: 'Kabel Crunches', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Mountain Climbers mit Ball', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Plank', muscle_group: 'Bauch', exercise_type: 'time' },
    { name: 'Plank auf Ball mit Knie am Boden', muscle_group: 'Bauch', exercise_type: 'time' },
    { name: 'Raupe', muscle_group: 'Bauch', exercise_type: 'time' },
    { name: 'Russian Twist', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Rückenextention Maschine', muscle_group: 'Bauch', exercise_type: 'strength' },
    { name: 'Side Plank Extreme', muscle_group: 'Bauch', exercise_type: 'time' },
    { name: 'Side Plank Rotation', muscle_group: 'Bauch', exercise_type: 'time' },
    { name: 'Vierfüßler und Knie hoch auf Physio Art', muscle_group: 'Bauch', exercise_type: 'strength' },

    // Beine
    { name: 'Ausfallschritt Kurzhantel', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Becknen Heben', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Beinbeuger', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Beinpresse', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Beinstrecker', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Kniebeugen', muscle_group: 'Beine', exercise_type: 'strength' },
    { name: 'Wadenheben', muscle_group: 'Beine', exercise_type: 'strength' },

    // Brust
    { name: 'Archer Pushups', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Bankdrücken Kurzhantel', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Bankdrücken Kurzhanteln', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Bankdrücken Langhantel', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Breite Liegestütz', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Butterfly', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Diamant Liegestütz', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Dips', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Enge Liegestütz', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Liegestütz', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Negative Liegestütz', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Schrägbank drücken', muscle_group: 'Brust', exercise_type: 'strength' },
    { name: 'Schrägbankdrücken', muscle_group: 'Brust', exercise_type: 'strength' },

    // Dehnen
    { name: 'Spagat', muscle_group: 'Dehnen', exercise_type: 'time' },

    // Ganzkörper
    { name: 'Klimmzüge', muscle_group: 'Ganzkörper', exercise_type: 'strength' },
    { name: 'Training (Gesamt)', muscle_group: 'Ganzkörper', exercise_type: 'time' },

    // Judo
    { name: 'Grip Fighting', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Kata', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Kata (Formen)', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Nage-Komi', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Nage-Komi (Bodenübungen)', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Ne-waza', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Ne-waza (Bodenkampf)', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Randori', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Randori (Freikampf)', muscle_group: 'Judo', exercise_type: 'time' },
    { name: 'Sprungsukomikomi', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Uchi-Komi', muscle_group: 'Judo', exercise_type: 'strength' },
    { name: 'Uchi-Komi (Wurfübungen)', muscle_group: 'Judo', exercise_type: 'strength' },

    // Rücken
    { name: 'Good Morning', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Klassisches Kreuzheben', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Klimmzug hold', muscle_group: 'Rücken', exercise_type: 'time' },
    { name: 'Klimmzüge Obergriff', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Klimmzüge Untergriff', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Klimmzüge der Stange entlang', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Kreuzheben', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Kurzhantel Rudern', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Latzug Maschine', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Ringe Hintere Schulter', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Rudern Maschine', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Rücken Extention Maschine', muscle_group: 'Rücken', exercise_type: 'strength' },
    { name: 'Rückenextention hold', muscle_group: 'Rücken', exercise_type: 'time' },
    { name: 'T Bar Rudern', muscle_group: 'Rücken', exercise_type: 'strength' },

    // Schultern
    { name: 'Face Pulls Kabelzug', muscle_group: 'Schultern', exercise_type: 'strength' },
    { name: 'Frontheben Kurzhantel', muscle_group: 'Schultern', exercise_type: 'strength' },
    { name: 'Kurzhantel Seitheben', muscle_group: 'Schultern', exercise_type: 'strength' },
    { name: 'Schulterdrücken Kurzhanteln', muscle_group: 'Schultern', exercise_type: 'strength' },
    { name: 'Seitheben Kurzhanteln', muscle_group: 'Schultern', exercise_type: 'strength' },
  ];
  
  defaultExercises.forEach(exercise => {
    const type = exercise.exercise_type || 'strength';
    db.run('INSERT INTO exercises (user_id, name, muscle_group, exercise_type) VALUES (?, ?, ?, ?)',
      [userId, exercise.name, exercise.muscle_group, type],
      (err) => {
        if (err) console.error('❌ Fehler beim Erstellen der Übung:', err.message);
      }
    );
  });
  
  console.log(`✅ ${defaultExercises.length} Standardübungen für User ${userId} erstellt`);
}

// Register
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { email, password, displayName, rememberMe } = req.body;

  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Email und Passwort (min. 6 Zeichen) erforderlich' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    let userId;
    try {
      userId = await new Promise((resolve, reject) => {
        db.run('INSERT INTO users (email, password, display_name) VALUES (?, ?, ?)',
          [email, hashedPassword, displayName || email], function(err) {
          if (err) {
            if (err.message.includes('UNIQUE')) {
              reject(new Error('Email bereits registriert'));
            } else {
              reject(new Error('Datenbankfehler: ' + err.message));
            }
            return;
          }
          resolve(this.lastID);
        });
      });
    } catch (insertErr) {
      if (insertErr.message === 'Email bereits registriert') {
        return res.status(409).json({ error: insertErr.message });
      }
      return res.status(500).json({ error: insertErr.message });
    }

    // "Eingeloggt bleiben" -> Token 1 Jahr gültig, sonst 24h
    const tokenExpiry = rememberMe ? TOKEN_LONG : TOKEN_SHORT;
    const token = jwt.sign({ userId: userId, email }, JWT_SECRET, { expiresIn: tokenExpiry });

    // JWT Refresh Token für automatische Verlängerung speichern (nur bei "remember me")
    let refreshToken = null;
    if (rememberMe) {
      refreshToken = generateJwtRefreshToken();
      await storeJwtRefreshToken(userId, refreshToken);
    }

    // Standardübungen erstellen
    seedDefaultExercises(userId);

    res.json({
      token,
      refreshToken,
      user: { id: userId, email, displayName: displayName || email }
    });
  } catch (err) {
    res.status(500).json({ error: 'Serverfehler' });
  }
});

// Login
app.post('/api/auth/login', authLimiter, (req, res, next) => {
  passport.authenticate('local', { session: false }, async (err, user, info) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: info.message });

    try {
      // "Eingeloggt bleiben" -> Token 1 Jahr gültig, sonst 24h
      const rememberMe = req.body.rememberMe === true;
      const tokenExpiry = rememberMe ? TOKEN_LONG : TOKEN_SHORT;

      const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: tokenExpiry });

      // JWT Refresh Token für automatische Verlängerung speichern (nur bei "remember me")
      let refreshToken = null;
      if (rememberMe) {
        refreshToken = generateJwtRefreshToken();
        await storeJwtRefreshToken(user.id, refreshToken);
      }

      res.json({
        token,
        refreshToken,
        user: { id: user.id, email: user.email, displayName: user.display_name }
      });
    } catch (loginErr) {
      console.error('❌ Fehler beim Login:', loginErr);
      res.status(500).json({ error: 'Login fehlgeschlagen' });
    }
  })(req, res, next);
});

// Google Auth Routes
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  // Google Auth: accessType offline holt Refresh Token
  // prompt: 'select_account' erlaubt Account-Auswahl, ohne jedes Mal neu zustimmen zu müssen
  // Dadurch bleibt der User bei wiederholtem Login eingeloggt, solange Google-Session gültig ist
  app.get('/auth/google', (req, res, next) => {
    const rememberMe = req.query.remember !== 'false';
    const state = rememberMe ? 'remember=true' : 'remember=false';
    passport.authenticate('google', {
      scope: ['profile', 'email', 'https://www.googleapis.com/auth/drive.file'],
      accessType: 'offline',
      prompt: 'select_account',
      state: state
    })(req, res, next);
  });

  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login.html' }),
    async (req, res) => {
      try {
        // WICHTIG: Refresh Token in DB speichern wenn vorhanden
        if (req.authInfo && req.authInfo.refreshToken && req.user) {
          db.run(
            'INSERT OR REPLACE INTO user_tokens (user_id, google_refresh_token, updated_at) VALUES (?, ?, datetime("now"))',
            [req.user.id, req.authInfo.refreshToken],
            (err) => {
              if (err) console.error('❌ Fehler beim Speichern des Refresh Tokens:', err.message);
              else console.log('✅ Refresh Token in DB gespeichert für User:', req.user.id);
            }
          );
        }

        // Google Tokens für Drive-Backup in JWT speichern
        const tokenPayload = {
          userId: req.user.id,
          email: req.user.email
        };

        // Wenn Google OAuth, zusätzliche Tokens speichern
        if (req.authInfo && req.authInfo.accessToken) {
          tokenPayload.googleAccessToken = req.authInfo.accessToken;
        }

        // Google-Login am Handy sollte dauerhaft gültig bleiben
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: TOKEN_LONG });

        // JWT Refresh Token für automatische Verlängerung speichern
        const refreshToken = generateJwtRefreshToken();
        await storeJwtRefreshToken(req.user.id, refreshToken);

        const state = req.query.state || 'remember=true';
        const rememberParam = state.includes('remember=true') ? '' : '&remember=false';

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const baseUrl = `${protocol}://${host}`;
        res.redirect(`${baseUrl}/?token=${token}&refreshToken=${refreshToken}${rememberParam}`);
      } catch (error) {
        console.error('❌ Fehler im Google Callback:', error);
        res.redirect('/login.html?error=google-callback-failed');
      }
    }
  );
}

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    app: 'IronCoach',
    version: '1.2.0',
    defaultExerciseCount: 78,
    commit: '9035852',
    timestamp: new Date().toISOString(),
    database: 'SQLite',
    environment: process.env.NODE_ENV || 'development',
    googleOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  });
});

// Verify Token
app.get('/api/auth/verify', authenticateJWT, (req, res) => {
  res.json({ user: req.user });
});

// JWT Refresh Token Endpunkt: erneuert Access Token ohne erneutes Login
app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Kein Refresh Token' });
  }

  try {
    // Suche User anhand des Refresh Tokens
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT user_id FROM user_tokens WHERE jwt_refresh_token = ?', [refreshToken], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!row) {
      return res.status(403).json({ error: 'Ungültiger Refresh Token' });
    }

    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id, email, display_name FROM users WHERE id = ?', [row.user_id], (err, user) => {
        if (err) reject(err);
        else resolve(user);
      });
    });

    if (!user) {
      return res.status(403).json({ error: 'User nicht gefunden' });
    }

    // Neuen Access Token + Refresh Token ausstellen
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: TOKEN_LONG }
    );
    const newRefreshToken = generateJwtRefreshToken();
    await storeJwtRefreshToken(user.id, newRefreshToken);

    res.json({
      token,
      refreshToken: newRefreshToken,
      user: { id: user.id, email: user.email, displayName: user.display_name || user.email }
    });
  } catch (error) {
    console.error('❌ Fehler beim Refresh:', error);
    res.status(500).json({ error: 'Refresh fehlgeschlagen' });
  }
});

// === PROTECTED API ROUTES ===

// Alle Übungen abrufen
app.get('/api/exercises', authenticateJWT, (req, res) => {
  db.all('SELECT id, user_id, name, muscle_group, exercise_type, created_at FROM exercises WHERE user_id = ? ORDER BY name', [req.user.userId], (err, rows) => {
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
  
  // exercise_type ist optional (default: 'strength')
  const type = exercise_type || 'strength';
  
  db.run('INSERT INTO exercises (user_id, name, muscle_group, exercise_type) VALUES (?, ?, ?, ?)', 
    [req.user.userId, name, muscle_group, type], function(err) {
    if (err) {
      console.error('❌ DB Fehler:', err);
      return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
    }
    console.log('✅ Übung gespeichert, ID:', this.lastID);
    res.json({ id: this.lastID, name, muscle_group, exercise_type: type });
  });
});

// Übung löschen
app.delete('/api/exercises/:id', authenticateJWT, (req, res) => {
  db.run('DELETE FROM exercises WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Übung gelöscht' });
  });
});

// Übung aktualisieren (EDIT)
app.put('/api/exercises/:id', authenticateJWT, (req, res) => {
  const { name, muscle_group, exercise_type } = req.body;
  
  console.log('📝 Übung aktualisieren:', { id: req.params.id, name, muscle_group, exercise_type, userId: req.user.userId });
  
  if (!name || !muscle_group) {
    return res.status(400).json({ error: 'Name und Muskelgruppe erforderlich' });
  }
  
  const type = exercise_type || 'strength';
  
  db.run(
    'UPDATE exercises SET name = ?, muscle_group = ?, exercise_type = ? WHERE id = ? AND user_id = ?',
    [name, muscle_group, type, req.params.id, req.user.userId],
    function(err) {
      if (err) {
        console.error('❌ DB Fehler beim Update:', err);
        return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
      }
      if (this.changes === 0) {
        console.log('❌ Übung nicht gefunden oder keine Berechtigung');
        return res.status(404).json({ error: 'Übung nicht gefunden oder keine Berechtigung' });
      }
      console.log('✅ Übung aktualisiert, ID:', req.params.id);
      res.json({ message: 'Übung aktualisiert', id: parseInt(req.params.id), name, muscle_group, exercise_type: type });
    }
  );
});

// Alle Workouts abrufen
app.get('/api/workouts', authenticateJWT, (req, res) => {
  const query = `
    SELECT w.*, e.name as exercise_name, e.muscle_group, e.exercise_type 
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

// Neues Workout hinzufügen
app.post('/api/workouts', authenticateJWT, async (req, res) => {
  const { exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date } = req.body;
  const userId = req.user.userId;
  
  console.log('📝 Workout POST erhalten:', { userId, exercise_id, weight, sets, reps, duration_seconds, date });
  
  // Validierung
  if (!exercise_id) {
    console.log('❌ Fehler: exercise_id fehlt');
    return res.status(400).json({ error: 'exercise_id ist erforderlich' });
  }
  
  // Konvertiere zu Integer
  const exerciseId = parseInt(exercise_id);
  if (isNaN(exerciseId)) {
    console.log('❌ Fehler: exercise_id ist keine gültige Zahl:', exercise_id);
    return res.status(400).json({ error: 'exercise_id muss eine gültige Zahl sein' });
  }
  
  // WICHTIG: Prüfe erst, ob Übung existiert
  try {
    const exerciseRow = await new Promise((resolve, reject) => {
      db.get('SELECT id, name FROM exercises WHERE id = ? AND user_id = ?', 
        [exerciseId, userId], 
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    
    if (!exerciseRow) {
      console.log('❌ Übung nicht gefunden:', exerciseId, 'für User:', userId);
      return res.status(400).json({ 
        error: 'Übung nicht gefunden', 
        details: `Keine Übung mit ID ${exerciseId} für User ${userId} gefunden.` 
      });
    }
    
    console.log('✅ Übung gefunden:', exerciseRow.name, '(ID:', exerciseId, ')');
    
  } catch (err) {
    console.error('❌ Fehler beim Prüfen der Übung:', err);
    return res.status(500).json({ error: 'Datenbankfehler beim Prüfen der Übung: ' + err.message });
  }
  
  // Jetzt erst INSERT durchführen - mit duration_seconds
  const hasDurationColumn = true; // Wir versuchen es immer zuerst mit
  
  db.run(
    'INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [userId, exerciseId, weight && parseFloat(weight) || 0, sets && parseInt(sets) || 0, reps && parseInt(reps) || 0, duration_seconds && parseInt(duration_seconds) || null, rest_seconds && parseInt(rest_seconds) || 60, feeling && parseInt(feeling) || 5, date || new Date().toISOString().split('T')[0]],
    function(err) {
      if (err && err.message.includes('no column named duration_seconds')) {
        console.log('⚠️ duration_seconds Spalte fehlt, füge hinzu...');
        // Spalte hinzufügen und INSERT ohne duration_seconds (temporär)
        db.run('ALTER TABLE workouts ADD COLUMN duration_seconds INTEGER', (alterErr) => {
          if (alterErr) {
            console.error('❌ Migration fehlgeschlagen:', alterErr.message);
            // Fallback: Ohne duration_seconds speichern
            db.run(
              'INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, rest_seconds, feeling, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [userId, exerciseId, weight && parseFloat(weight) || 0, sets && parseInt(sets) || 0, reps && parseInt(reps) || 0, rest_seconds && parseInt(rest_seconds) || 60, feeling && parseInt(feeling) || 5, date || new Date().toISOString().split('T')[0]],
              function(err2) {
                if (err2) {
                  console.error('❌ Workout INSERT Fehler:', err2.message);
                  return res.status(500).json({ error: 'Speichern fehlgeschlagen: ' + err2.message });
                }
                console.log('✅ Workout gespeichert (ohne duration_seconds)');
                res.json({ id: this.lastID, exercise_id: exerciseId, weight, sets, reps, rest_seconds, feeling, date });
              }
            );
          } else {
            console.log('✅ duration_seconds Spalte hinzugefügt, versuche INSERT erneut');
            // Erneut mit duration_seconds versuchen
            db.run(
              'INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [userId, exerciseId, weight && parseFloat(weight) || 0, sets && parseInt(sets) || 0, reps && parseInt(reps) || 0, duration_seconds && parseInt(duration_seconds) || null, rest_seconds && parseInt(rest_seconds) || 60, feeling && parseInt(feeling) || 5, date || new Date().toISOString().split('T')[0]],
              function(err3) {
                if (err3) {
                  console.error('❌ Workout INSERT Fehler:', err3.message);
                  return res.status(500).json({ error: 'Speichern fehlgeschlagen: ' + err3.message });
                }
                console.log('✅ Workout gespeichert (mit duration_seconds)');
                res.json({ id: this.lastID, exercise_id: exerciseId, weight, sets, reps, duration_seconds, rest_seconds, feeling, date });
              }
            );
          }
        });
      } else if (err) {
        console.error('❌ Workout INSERT Fehler:', err.message);
        return res.status(500).json({ error: 'Speichern fehlgeschlagen: ' + err.message });
      } else {
        console.log('✅ Workout gespeichert, ID:', this.lastID);
        res.json({ id: this.lastID, exercise_id: exerciseId, weight, sets, reps, duration_seconds, rest_seconds, feeling, date });
      }
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

// WICHTIG: Workout aktualisieren (EDIT)
app.put('/api/workouts/:id', authenticateJWT, async (req, res) => {
  const { exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date } = req.body;
  const userId = req.user.userId;
  const workoutId = req.params.id;
  
  console.log('📝 Workout UPDATE erhalten:', { workoutId, exercise_id, weight, sets, reps, duration_seconds, date });
  
  // Validierung
  if (!exercise_id) {
    return res.status(400).json({ error: 'exercise_id ist erforderlich' });
  }
  
  const exerciseId = parseInt(exercise_id);
  if (isNaN(exerciseId)) {
    return res.status(400).json({ error: 'exercise_id muss eine gültige Zahl sein' });
  }
  
  // Prüfe ob Übung existiert
  try {
    const exerciseRow = await new Promise((resolve, reject) => {
      db.get('SELECT id, name FROM exercises WHERE id = ? AND user_id = ?', 
        [exerciseId, userId], 
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    
    if (!exerciseRow) {
      return res.status(400).json({ error: 'Übung nicht gefunden' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
  }
  
  // UPDATE durchführen
  db.run(
    'UPDATE workouts SET exercise_id = ?, weight = ?, sets = ?, reps = ?, duration_seconds = ?, rest_seconds = ?, feeling = ?, date = ? WHERE id = ? AND user_id = ?',
    [exerciseId, 
     weight && parseFloat(weight) || 0, 
     sets && parseInt(sets) || 0, 
     reps && parseInt(reps) || 0, 
     duration_seconds && parseInt(duration_seconds) || null, 
     rest_seconds && parseInt(rest_seconds) || 60, 
     feeling && parseInt(feeling) || 5, 
     date || new Date().toISOString().split('T')[0],
     workoutId,
     userId],
    function(err) {
      if (err) {
        console.error('❌ Workout UPDATE Fehler:', err.message);
        return res.status(500).json({ error: 'Update fehlgeschlagen: ' + err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Workout nicht gefunden oder keine Berechtigung' });
      }
      console.log('✅ Workout aktualisiert, ID:', workoutId);
      res.json({ 
        message: 'Workout aktualisiert', 
        id: parseInt(workoutId), 
        exercise_id: exerciseId, 
        weight, sets, reps, duration_seconds, rest_seconds, feeling, date 
      });
    }
  );
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
  const query = `SELECT date, weight, sets, reps, (weight * sets * reps) as volume 
    FROM workouts WHERE exercise_id = ? AND user_id = ? ORDER BY date ASC`;
  db.all(query, [req.params.exercise_id, req.user.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// === TRAINING PLANS API ===

// Alle Trainingspläne abrufen
app.get('/api/training-plans', authenticateJWT, (req, res) => {
  db.all('SELECT id, name, description, is_active, created_at FROM training_plans WHERE user_id = ? ORDER BY updated_at DESC', 
    [req.user.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Einzelnen Plan abrufen
app.get('/api/training-plans/:id', authenticateJWT, (req, res) => {
  db.get('SELECT * FROM training_plans WHERE id = ? AND user_id = ?', 
    [req.params.id, req.user.userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Plan nicht gefunden' });
    try { row.plan_data = JSON.parse(row.plan_data); } catch (e) {}
    res.json(row);
  });
});

// Neuen Plan erstellen
app.post('/api/training-plans', authenticateJWT, (req, res) => {
  const { name, description, plan_data, is_active } = req.body;
  if (!name || !plan_data) return res.status(400).json({ error: 'Name und Plan-Daten erforderlich' });
  
  const planDataJson = typeof plan_data === 'string' ? plan_data : JSON.stringify(plan_data);
  const isActive = is_active ? 1 : 0;
  
  if (isActive) db.run('UPDATE training_plans SET is_active = 0 WHERE user_id = ?', [req.user.userId]);
  
  db.run('INSERT INTO training_plans (user_id, name, description, plan_data, is_active) VALUES (?, ?, ?, ?, ?)',
    [req.user.userId, name, description || '', planDataJson, isActive],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, description, is_active: isActive });
    }
  );
});

// Plan aktualisieren
app.put('/api/training-plans/:id', authenticateJWT, (req, res) => {
  const { name, description, plan_data, is_active } = req.body;
  if (!name || !plan_data) return res.status(400).json({ error: 'Name und Plan-Daten erforderlich' });
  
  const planDataJson = typeof plan_data === 'string' ? plan_data : JSON.stringify(plan_data);
  const isActive = is_active ? 1 : 0;
  const planId = req.params.id;
  
  if (isActive) db.run('UPDATE training_plans SET is_active = 0 WHERE user_id = ? AND id != ?', [req.user.userId, planId]);
  
  db.run('UPDATE training_plans SET name = ?, description = ?, plan_data = ?, is_active = ?, updated_at = datetime("now") WHERE id = ? AND user_id = ?',
    [name, description || '', planDataJson, isActive, planId, req.user.userId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Plan nicht gefunden' });
      res.json({ message: 'Plan aktualisiert', id: parseInt(planId) });
    }
  );
});

// Plan löschen
app.delete('/api/training-plans/:id', authenticateJWT, (req, res) => {
  db.run('DELETE FROM training_plans WHERE id = ? AND user_id = ?', 
    [req.params.id, req.user.userId], 
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Plan nicht gefunden' });
      res.json({ message: 'Plan gelöscht' });
    }
  );
});

// Vorlage herunterladen
app.get('/api/training-plans/template/download', authenticateJWT, (req, res) => {
  const template = {
    "name": "Gleitwirbel-kompatibler Trainingsplan",
    "description": "Core-Stabilisation für Gleitwirbel",
    "days": [
      {
        "day": "Montag",
        "focus": "🥋 Judo",
        "intensity": "Hoch",
        "duration": "90 Min",
        "warmup": [{"name": "ADIM-Core", "sets": 1, "duration": "20 Sek"}],
        "main": [{"name": "Reguläres Judo Training", "notes": "Im Dojo" }],
        "cooldown": [{"name": "Kindhaltung", "duration": "60 Sek" }]
      },
      {
        "day": "Dienstag",
        "focus": "💪 Core + Rücken",
        "intensity": "Mittel",
        "duration": "45 Min",
        "warmup": [{"name": "ADIM-Core", "sets": 3, "reps": 10}],
        "main": [
          {"name": "Dead Bug", "sets": 3, "reps": 10},
          {"name": "Bird Dog", "sets": 3, "reps": 10},
          {"name": "Klimmzüge", "sets": 3, "reps": "6-10"}
        ],
        "cooldown": [{"name": "Hüftbeuger-Dehnung", "duration": "60 Sek"}]
      },
      {"day": "Mittwoch", "focus": "💪 Tiefer Core", "intensity": "Mittel", "duration": "40 Min", "main": [{"name": "Dead Bug Extrem", "sets": 3, "reps": 8}, {"name": "Side Plank", "sets": 3, "duration": "30 Sek"}]},
      {"day": "Donnerstag", "focus": "🧘 Dehnen", "intensity": "Niedrig", "duration": "30 Min", "main": [{"name": "Hüftbeuger-Dehnung", "duration": "60 Sek pro Seite"}]},
      {"day": "Freitag", "focus": "🥋 Judo", "intensity": "Hoch", "duration": "90 Min", "main": [{"name": "Reguläres Judo Training" }]},
      {"day": "Samstag", "focus": "💪 Core", "intensity": "Mittel", "duration": "40 Min", "main": [{"name": "Plank", "sets": 3, "duration": "30-45 Sek"}]},
      {"day": "Sonntag", "focus": "☀️ Erholung", "intensity": "Niedrig", "duration": "20 Min", "main": [{"name": "Kindhaltung", "duration": "60 Sek"}]}
    ]
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="ironcoach-training-template.json"');
  res.json(template);
});

// === GOOGLE DRIVE BACKUP ===

// Backup zu Google Drive
app.post('/api/backup/drive', authenticateJWT, async (req, res) => {
  try {
    let accessToken = req.user.googleAccessToken;
    
    if (!accessToken) {
      // Versuche Token mit Refresh Token zu holen
      accessToken = await refreshGoogleAccessToken(req.user.userId || req.user.id);
      if (!accessToken) {
        return res.status(400).json({ 
          error: 'Nicht mit Google angemeldet. Bitte erneut einloggen.' 
        });
      }
    }
    
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // Suche ob Backup-Ordner existiert
    let folderResponse;
    try {
      folderResponse = await drive.files.list({
        q: "name='IronCoach-Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: 'files(id, name)',
        spaces: 'drive'
      });
    } catch (err) {
      if (err.code === 401 || err.response?.status === 401) {
        // Token abgelaufen, erneuern
        console.log('🔄 Token abgelaufen, versuche Erneuerung...');
        accessToken = await refreshGoogleAccessToken(req.user.userId || req.user.id);
        if (!accessToken) {
          return res.status(401).json({ error: 'Token abgelaufen. Bitte neu einloggen.' });
        }
        // Nochmal versuchen mit neuem Token
        oauth2Client.setCredentials({ access_token: accessToken });
        folderResponse = await drive.files.list({
          q: "name='IronCoach-Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false",
          fields: 'files(id, name)',
          spaces: 'drive'
        });
      } else {
        throw err;
      }
    }
    
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
    console.log('🔄 RESTORE-REQUEST für User:', req.user.userId || req.user.id);
    
    let accessToken = req.user.googleAccessToken;
    
    if (!accessToken) {
      // Versuche Token mit Refresh Token zu holen
      console.log('🔄 Kein Access Token, versuche Refresh...');
      accessToken = await refreshGoogleAccessToken(req.user.userId || req.user.id);
    }
    
    if (!accessToken) {
      console.log('❌ Kein Google Token verfügbar');
      return res.json({ restored: false, message: 'Nicht mit Google angemeldet' });
    }
    
    console.log('✅ Google Token gefunden');
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // Suche Backup-Ordner mit Fehlerbehandlung für abgelaufenes Token
    let folderResponse;
    try {
      console.log('🔍 Suche Backup-Ordner...');
      folderResponse = await drive.files.list({
        q: "name='IronCoach-Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: 'files(id, name)',
      });
    } catch (err) {
      if (err.code === 401) {
        console.log('🔄 Token abgelaufen, versuche Erneuerung...');
        accessToken = await refreshGoogleAccessToken(req.user.userId || req.user.id);
        if (!accessToken) {
          return res.json({ restored: false, message: 'Token abgelaufen. Bitte neu einloggen.' });
        }
        oauth2Client.setCredentials({ access_token: accessToken });
        folderResponse = await drive.files.list({
          q: "name='IronCoach-Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false",
          fields: 'files(id, name)',
        });
      } else {
        throw err;
      }
    }
    
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
    
    // Prüfe ob lokale DB Daten enthält (nicht nur ob sie neuer ist)
    const backupModified = new Date(fileResponse.data.files[0].modifiedTime);
    let localModified = null;
    let hasLocalData = false;
    
    try {
      const stats = fs.statSync(DB_PATH);
      localModified = stats.mtime;
      
      // Prüfe ob Users-Tabelle Einträge hat
      const userCount = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
          if (err) resolve(0);
          else resolve(row ? row.count : 0);
        });
      });
      hasLocalData = userCount > 0;
      console.log('📊 Lokale Users:', userCount);
    } catch (e) {
      console.log('ℹ Keine lokale DB vorhanden oder Fehler beim Lesen');
    }
    
    console.log('📊 Backup:', backupModified, '| Lokal:', localModified, '| Hat Daten:', hasLocalData);
    
    // Nur restore verweigern wenn lokale Daten VORHANDEN UND neuer
    if (hasLocalData && localModified && localModified > backupModified) {
      console.log('ℹ Lokale Daten sind neuer und enthalten Daten');
      return res.json({ restored: false, message: 'Lokale Daten sind neuer als Backup' });
    }
    
    console.log('📥 Starte Download...');
    
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
    
    // WICHTIG: Nach Restore Migration ausführen
    console.log('🔄 Führe Migrationen nach Restore aus...');
    await new Promise((resolve) => {
      db.all(`PRAGMA table_info(exercises)`, [], (err, columns) => {
        if (!err && columns) {
          const hasExerciseType = columns.some(col => col.name === 'exercise_type');
          if (!hasExerciseType) {
            console.log('⚠️ Migration: exercise_type fehlt, füge hinzu...');
            db.run(`ALTER TABLE exercises ADD COLUMN exercise_type TEXT DEFAULT 'strength'`, (alterErr) => {
              if (alterErr) console.error('❌ Migration fehlgeschlagen:', alterErr.message);
              else console.log('✅ exercise_type Spalte hinzugefügt');
              resolve();
            });
          } else {
            resolve();
          }
        } else {
          resolve();
        }
      });
    });
    
    res.json({ restored: true, message: 'Daten vom Backup wiederhergestellt' });
    
  } catch (error) {
    console.error('❌ Restore Fehler:', error);
    res.status(500).json({ error: 'Restore fehlgeschlagen: ' + error.message });
  }
});

// Alias für /api/restore (kurzform) - FÜHRT DIREKT DEN RESTORE AUS
app.post('/api/restore', authenticateJWT, async (req, res) => {
  console.log('🔄 RESTORE-REQUEST für User:', req.user.userId || req.user.id);
  
  try {
    let accessToken = req.user.googleAccessToken;
    
    if (!accessToken) {
      // Versuche Token mit Refresh Token zu holen
      console.log('🔄 Kein Access Token, versuche Refresh...');
      accessToken = await refreshGoogleAccessToken(req.user.userId || req.user.id);
    }
    
    if (!accessToken) {
      console.log('❌ Kein Google Token verfügbar');
      return res.json({ success: false, message: 'Nicht mit Google angemeldet' });
    }
    
    console.log('✅ Google Token gefunden');
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // Suche Backup-Ordner mit Fehlerbehandlung
    let folderResponse;
    try {
      console.log('🔍 Suche Backup-Ordner...');
      folderResponse = await drive.files.list({
        q: "name='IronCoach-Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: 'files(id, name)',
      });
    } catch (err) {
      if (err.code === 401) {
        console.log('🔄 Token abgelaufen, versuche Erneuerung...');
        accessToken = await refreshGoogleAccessToken(req.user.userId || req.user.id);
        if (!accessToken) {
          return res.json({ success: false, message: 'Token abgelaufen. Bitte neu einloggen.' });
        }
        oauth2Client.setCredentials({ access_token: accessToken });
        folderResponse = await drive.files.list({
          q: "name='IronCoach-Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false",
          fields: 'files(id, name)',
        });
      } else {
        throw err;
      }
    }
    
    console.log('📁 Ordner-Suche Ergebnis:', folderResponse.data.files.length, 'gefunden');
    
    if (folderResponse.data.files.length === 0) {
      console.log('❌ Kein Backup-Ordner gefunden');
      return res.json({ success: false, message: 'Kein Backup-Ordner gefunden' });
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
      return res.json({ success: false, message: 'Keine Backup-Datei gefunden' });
    }
    
    const fileId = fileResponse.data.files[0].id;
    console.log('✅ Backup-Datei ID:', fileId);
    
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
      dest.on('error', reject);
    });
    
    console.log('✅ Backup heruntergeladen');
    
    // WICHTIG: Nach Restore Migration ausführen (für neue Spalten wie exercise_type)
    console.log('🔄 Führe Migrationen nach Restore aus...');
    
    // DB neu verbinden
    await new Promise((resolve, reject) => {
      db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) reject(err);
        else {
          console.log('✅ DB neu verbunden');
          resolve();
        }
      });
    });
    
    db.run('PRAGMA foreign_keys = ON');
    
    // Migration: Prüfe und füge exercise_type Spalte hinzu falls fehlend
    await new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(exercises)`, [], (err, columns) => {
        if (!err && columns) {
          const hasExerciseType = columns.some(col => col.name === 'exercise_type');
          if (!hasExerciseType) {
            console.log('⚠️ Migration nach Restore: exercise_type fehlt, füge hinzu...');
            db.run(`ALTER TABLE exercises ADD COLUMN exercise_type TEXT DEFAULT 'strength'`, (alterErr) => {
              if (alterErr) {
                console.error('❌ Migration fehlgeschlagen:', alterErr.message);
              } else {
                console.log('✅ exercise_type Spalte nach Restore hinzugefügt');
              }
              resolve();
            });
          } else {
            resolve();
          }
        } else {
          resolve();
        }
      });
    });
    
    res.json({ success: true, message: 'Daten vom Backup wiederhergestellt' });
    
  } catch (error) {
    console.error('❌ Restore Fehler:', error);
    res.status(500).json({ error: 'Restore fehlgeschlagen: ' + error.message });
  }
});

// Sync Endpunkt - erstellt Standardübungen falls keine vorhanden
app.post('/api/exercises/sync', authenticateJWT, async (req, res) => {
  try {
    // Zähle vorhandene Übungen
    const existingCount = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM exercises WHERE user_id = ?', [req.user.userId], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.count : 0);
      });
    });
    
    // Wenn keine Übungen, erstelle Standardübungen
    if (existingCount === 0) {
      // Verwende die globale seedDefaultExercises Funktion
      // WICHTIG: Diese Funktion ist synchron und wartet nicht
      // Daher warten wir kurz bevor wir antworten
      seedDefaultExercises(req.user.userId);
      
      // Warte 500ms damit die INSERTs abgeschlossen werden können
      await new Promise(resolve => setTimeout(resolve, 500));
      
      res.json({ success: true, message: 'Standardübungen erstellt' });
    } else {
      res.json({ success: true, message: 'Übungen bereits vorhanden', count: existingCount });
    }
    
  } catch (error) {
    console.error('❌ Sync Fehler:', error);
    res.status(500).json({ error: 'Sync fehlgeschlagen: ' + error.message });
  }
});

// Static Files
const publicPath = path.join(__dirname, 'public');
console.log('📁 Serving static files from:', publicPath);
app.use(express.static(publicPath));

// API-Route: Liste verfügbare Videos (VOR dem Fallback!)
app.get('/api/exercises/videos', (req, res) => {
  const availableVideos = [
    'Bankdrücken (Langhantel).mp4',
    'Kniebeugen.mp4',
    'Klimmzüge.mp4',
    'plank.mp4'
  ];
  const videoMap = {};
  availableVideos.forEach(file => {
    videoMap[file.replace('.mp4', '')] = file;
  });
  res.json(videoMap);
});

// Fallback für SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Server starten
app.listen(PORT, () => {
  console.log(`🔒 IronCoach Server läuft auf http://localhost:${PORT}`);
  console.log(`📊 Umgebung: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📦 Version: 1.2.0 | Standardübungen: 78`);
  console.log(`🏥 Health-Check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});
