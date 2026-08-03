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
const { Readable } = require('stream');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dein-geheimer-schluessel-mindestens-32-zeichen-lang';
const SESSION_SECRET = process.env.SESSION_SECRET || 'session-secret-mindestens-32-zeichen-lang-hier';

// Google Drive Backup ist standardmäßig AKTIV, damit Login + automatisches Backup
// wieder zusammen funktionieren wie vorher. Nur mit GOOGLE_DRIVE_ENABLED=false
// explizit deaktivieren.
const GOOGLE_DRIVE_ENABLED = process.env.GOOGLE_DRIVE_ENABLED !== 'false';

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
app.use(express.json({ limit: '10mb' }));

// Session Setup
// WICHTIG: Session-Cookie auf 1 Jahr setzen für "Eingeloggt bleiben"
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Cookie-Sicherheit: Auf localhost (auch mit NODE_ENV=production) darf secure=false
// bleiben, sonst lehnt der Browser das Cookie unter http://localhost ab.
const isRender = !!process.env.RENDER_EXTERNAL_URL;
const isLocalhost = !isRender && (!process.env.HOST || process.env.HOST.includes('localhost'));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isRender || (!isLocalhost && process.env.NODE_ENV === 'production'),
    httpOnly: true,
    sameSite: 'lax',
    maxAge: ONE_YEAR_MS
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// SQLite Datenbank
const DB_PATH = process.env.DATABASE_PATH || './training.db';
let db = null;

// Promise-Helfer für SQLite (ermöglicht zuverlässiges Schema-Management)
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Hilfsfunktion: Spalte hinzufügen falls sie fehlt (Auto-Heal für Render-Deployments)
async function ensureColumn(table, column, type = 'TEXT') {
  const columns = await allAsync(`PRAGMA table_info(${table})`).catch(() => []);
  const exists = columns.some(col => col.name === column);
  if (exists) return;
  console.log(`⚠️ Auto-Heal: Spalte ${column} fehlt in ${table}, füge hinzu...`);
  await runAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  console.log(`✅ Spalte ${column} zu ${table} hinzugefügt`);
}

// Hilfsfunktion: Prüfen ob Tabelle existiert
async function tableExists(table) {
  const row = await getAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [table]
  ).catch(() => null);
  return !!row;
}

// Auto-Heal: Tabelle anlegen falls sie komplett fehlt
async function ensureTable(name, ddl) {
  if (await tableExists(name)) return;
  console.log(`⚠️ Auto-Heal: Tabelle ${name} fehlt, lege an...`);
  await runAsync(ddl);
  if (!(await tableExists(name))) {
    throw new Error(`Auto-Heal fehlgeschlagen: Tabelle ${name} konnte nicht angelegt werden`);
  }
  console.log(`✅ Tabelle ${name} angelegt`);
}

// Robustes, asynchrones Schema-Setup – Server startet erst, wenn alles bereit ist
async function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, async (err) => {
      if (err) return reject(err);
      console.log('✅ Datenbank verbunden:', DB_PATH);

      try {
        await runAsync('PRAGMA foreign_keys = ON');
        await runAsync('PRAGMA busy_timeout = 5000');
        await runAsync('PRAGMA journal_mode = WAL');

        // Users Tabelle
        await ensureTable('users', `CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password TEXT,
          google_id TEXT UNIQUE,
          display_name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Google Refresh Tokens Tabelle
        await ensureTable('user_tokens', `CREATE TABLE IF NOT EXISTS user_tokens (
          user_id INTEGER PRIMARY KEY,
          google_refresh_token TEXT,
          jwt_refresh_token TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        await ensureColumn('user_tokens', 'jwt_refresh_token', 'TEXT');

        // Exercises Tabelle
        await ensureTable('exercises', `CREATE TABLE IF NOT EXISTS exercises (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          muscle_group TEXT NOT NULL,
          exercise_type TEXT DEFAULT 'strength',
          info TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        await ensureColumn('exercises', 'user_id', 'INTEGER DEFAULT 0');
        await ensureColumn('exercises', 'exercise_type', "TEXT DEFAULT 'strength'");
        await ensureColumn('exercises', 'info', 'TEXT');

        // Workouts Tabelle
        await ensureTable('workouts', `CREATE TABLE IF NOT EXISTS workouts (
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
          info TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
        )`);
        await ensureColumn('workouts', 'user_id', 'INTEGER DEFAULT 0');
        await ensureColumn('workouts', 'duration_seconds', 'INTEGER');
        await ensureColumn('workouts', 'info', 'TEXT');

        // Training Plans Tabelle
        await ensureTable('training_plans', `CREATE TABLE IF NOT EXISTS training_plans (
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
        await ensureColumn('training_plans', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');

        // Finale Validierung: alle erwarteten Tabellen müssen existieren
        const expectedTables = ['users', 'user_tokens', 'exercises', 'workouts', 'training_plans'];
        for (const tbl of expectedTables) {
          if (!(await tableExists(tbl))) {
            throw new Error(`Validierung fehlgeschlagen: Tabelle ${tbl} existiert nicht nach Init`);
          }
        }

        console.log('✅ Datenbank-Schema initialisiert');
        resolve();
      } catch (initErr) {
        console.error('❌ Datenbank-Initialisierung fehlgeschlagen:', initErr.message);
        reject(initErr);
      }
    });
  });
}

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

// Holt einen gültigen Google Drive Access Token für den User.
// Bevorzugt das gespeicherte Refresh Token, damit abgelaufene JWT-AccessTokens
// nicht zum Problem werden. Fallback auf noch gültiges Token aus JWT.
async function getDriveAccessToken(userId, jwtAccessToken) {
  const refreshed = await refreshGoogleAccessToken(userId);
  if (refreshed) {
    console.log('☁️ Verwende frischen Access Token aus Refresh Token für User:', userId);
    return refreshed;
  }
  if (jwtAccessToken) {
    console.log('☁️ Verwende Access Token aus JWT für User:', userId);
    return jwtAccessToken;
  }
  return null;
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
  // Baue absolute Callback-URL. Reihenfolge:
  // 1. Render setzt RENDER_EXTERNAL_URL automatisch -> immer diese nehmen
  // 2. Benutzer kann GOOGLE_CALLBACK_URL explizit setzen (lokal oder eigener Server)
  // 3. Fallback: http://localhost:PORT (nie https://localhost!)
  const getBaseUrl = () => {
    if (process.env.RENDER_EXTERNAL_URL) {
      return process.env.RENDER_EXTERNAL_URL;  // z.B. https://iron-coach-90eu.onrender.com
    }
    if (process.env.PUBLIC_HOSTNAME) {
      const isSecure = process.env.NODE_ENV === 'production';
      return isSecure
        ? `https://${process.env.PUBLIC_HOSTNAME}`
        : `http://${process.env.PUBLIC_HOSTNAME}`;
    }
    return `http://localhost:${PORT}`;
  };

  const dynamicCallbackURL = `${getBaseUrl()}/auth/google/callback`;
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || dynamicCallbackURL;
  console.log('🔑 Google OAuth Callback URL:', callbackURL);
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log('   (aus RENDER_EXTERNAL_URL, weil auf Render deployed)');
  } else if (process.env.GOOGLE_CALLBACK_URL) {
    console.log('   (aus GOOGLE_CALLBACK_URL Umgebungsvariable)');
  } else {
    console.log('   (Fallback für lokale Entwicklung)');
  }
  
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
        
        // Standardübungen und Default-Trainingsplan erstellen
        seedDefaultExercises(newUserId);
        seedDefaultTrainingPlan(newUserId);

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

// Hilfsfunktion: Standard-Trainingsplan für neuen User anlegen, falls noch keiner existiert
async function seedDefaultTrainingPlan(userId) {
  try {
    const existing = await getAsync(
      'SELECT id FROM training_plans WHERE user_id = ? LIMIT 1',
      [userId]
    );
    if (existing) {
      console.log(`ℹ️ User ${userId} hat bereits einen Trainingsplan – kein Default nötig`);
      return;
    }

    const planPath = path.join(__dirname, 'public', 'default-training-plan.json');
    if (!fs.existsSync(planPath)) {
      console.warn('⚠️ default-training-plan.json nicht gefunden');
      return;
    }

    const raw = fs.readFileSync(planPath, 'utf8');
    const defaultPlan = JSON.parse(raw);
    const planDataJson = JSON.stringify(defaultPlan);

    await runAsync(
      'INSERT INTO training_plans (user_id, name, description, plan_data, is_active) VALUES (?, ?, ?, ?, ?)',
      [userId, defaultPlan.name, defaultPlan.description || '', planDataJson, 1]
    );
    console.log(`✅ Default-Trainingsplan für User ${userId} erstellt`);
  } catch (err) {
    console.error('❌ Fehler beim Erstellen des Default-Trainingsplans:', err.message);
  }
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

    // Standardübungen und Default-Trainingsplan erstellen
    seedDefaultExercises(userId);
    await seedDefaultTrainingPlan(userId);

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

      // Sicherstellen, dass jeder User mindestens einen Default-Trainingsplan hat
      await seedDefaultTrainingPlan(user.id);

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
  // Google Auth: accessType offline holt beim ersten Login ein Google-Refresh-Token.
  // Kein 'prompt' -> Google wählt den aktiven Account automatisch, damit bleibt der
  // Nutzer dauerhaft eingeloggt, solange die Google-Session gültig ist.
  //
  // Google Drive Backup ist standardmäßig aktiv (wie vorher). Mit
  // GOOGLE_DRIVE_ENABLED=false kann der drive.file-Scope abgeschaltet werden.
  const googleScopes = ['profile', 'email'];
  if (GOOGLE_DRIVE_ENABLED) {
    googleScopes.push('https://www.googleapis.com/auth/drive.file');
  }
  console.log('🔑 Google OAuth Scopes:', googleScopes.join(', '));
  console.log('☁️ Google Drive Backup:', GOOGLE_DRIVE_ENABLED ? 'aktiv' : 'deaktiviert');

  app.get('/auth/google', (req, res, next) => {
    const rememberMe = req.query.remember !== 'false';
    const state = rememberMe ? 'remember=true' : 'remember=false';
    const authOptions = {
      scope: googleScopes,
      accessType: 'offline',
      state: state
    };
    // Wenn Drive-Backup aktiv ist, müssen wir Google zwingen, den Consent
    // erneut anzuzeigen, damit wir einen Refresh-Token mit drive.file-Scope
    // bekommen (sonst liefert Google bei wiederholtem Login keinen neuen Scope).
    if (GOOGLE_DRIVE_ENABLED) {
      authOptions.prompt = 'consent';
    }
    passport.authenticate('google', authOptions)(req, res, next);
  });

  app.get('/auth/google/callback',
    (req, res, next) => {
      passport.authenticate('google', (err, user, authInfo) => {
        if (err) {
          console.error('❌ Google OAuth Fehler:', err.message);
          console.error('❌ Google OAuth Fehler-Details:', err.code || 'kein code', err.stack || '');
          // Hilfreiche Fehlermeldung für bekannte Probleme
          let message = 'Google-Login ist momentan nicht möglich. Bitte versuche es später erneut.';
          const errMsg = (err.message || '').toLowerCase();
          const expectedCallback = getGoogleCallbackURL();
          if (errMsg.includes('redirect_uri') || err.code === 'redirect_uri_mismatch') {
            const localhostHint = expectedCallback.startsWith('http://localhost')
              ? ' Google erlaubt localhost-URIs nur im Test-Modus der App.'
              : '';
            message = `Google OAuth Redirect-URI passt nicht. In der Google Cloud Console muss EXAKT diese URL hinterlegt sein: ${expectedCallback}.${localhostHint}`;
          } else if (errMsg.includes('access_denied')) {
            message = 'Google hat den Zugriff abgelehnt. App ist evtl. noch im Test-Modus – Martin muss als Testnutzer hinzugefügt sein oder die App verifizieren.';
          } else if (errMsg.includes('invalid_client') || errMsg.includes('unauthorized_client')) {
            message = 'Google Client-ID oder Client-Secret ist ungültig. Bitte Render-Umgebungsvariablen prüfen.';
          }
          return res.redirect(`/login.html?google_error=${encodeURIComponent(message)}`);
        }
        if (!user) {
          return res.redirect('/login.html?error=google-login-failed');
        }

        req.logIn(user, async (loginErr) => {
          if (loginErr) {
            console.error('❌ Fehler beim Einloggen:', loginErr);
            return res.redirect(`/login.html?google_error=${encodeURIComponent('Login fehlgeschlagen')}`);
          }

          try {
            // WICHTIG: Google-Refresh-Token in DB speichern wenn vorhanden
            if (authInfo && authInfo.refreshToken) {
              db.run(
                'INSERT OR REPLACE INTO user_tokens (user_id, google_refresh_token, updated_at) VALUES (?, ?, datetime("now"))',
                [user.id, authInfo.refreshToken],
                (dbErr) => {
                  if (dbErr) console.error('❌ Fehler beim Speichern des Refresh Tokens:', dbErr.message);
                  else console.log('✅ Refresh Token in DB gespeichert für User:', user.id);
                }
              );
            }

            // Google Tokens für Drive-Backup in JWT speichern
            const tokenPayload = {
              userId: user.id,
              email: user.email
            };
            if (authInfo && authInfo.accessToken) {
              tokenPayload.googleAccessToken = authInfo.accessToken;
            }

            // Google-Login dauerhaft gültig (1 Jahr)
            const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: TOKEN_LONG });

            // JWT Refresh Token für automatische Verlängerung speichern
            const refreshToken = generateJwtRefreshToken();
            await storeJwtRefreshToken(user.id, refreshToken);

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
        });
      })(req, res, next);
    }
  );
}

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    app: 'IronCoach',
    version: '1.3.2',
    defaultExerciseCount: 78,
    commit: 'fix-drive-token-refresh',
    timestamp: new Date().toISOString(),
    database: 'SQLite',
    environment: process.env.NODE_ENV || 'development',
    googleOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  });
});

// Hilfsfunktion: aktuelle Callback-URL ermitteln (wird an mehreren Stellen genutzt)
function getGoogleCallbackURL() {
  if (process.env.RENDER_EXTERNAL_URL) {
    return `${process.env.RENDER_EXTERNAL_URL}/auth/google/callback`;
  }
  return process.env.GOOGLE_CALLBACK_URL || `http://localhost:${PORT}/auth/google/callback`;
}

// Google OAuth Diagnose-Endpoint (keine Secrets ausgeben!)
app.get('/api/auth/status', (req, res) => {
  const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const callbackURL = getGoogleCallbackURL();
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  res.json({
    googleOAuthEnabled: googleEnabled,
    callbackURL: callbackURL,
    renderExternalUrl: process.env.RENDER_EXTERNAL_URL || null,
    environment: process.env.NODE_ENV || 'development',
    googleDriveEnabled: GOOGLE_DRIVE_ENABLED,
    // Nur Anfang und Ende der Client-ID (ohne Standard-Suffix), damit Martin
    // prüfen kann, ob auf Render die gleiche ID wie lokal hinterlegt ist.
    googleClientIdHint: clientId
      ? `${clientId.split('-')[0]}-...-${clientId.replace('.apps.googleusercontent.com', '').split('-').pop()}`
      : null,
    requiredRedirectUriInConsole: callbackURL,
    localhostNote: callbackURL.startsWith('http://localhost')
      ? 'Google erlaubt http://localhost-URIs nur im Test-Modus der App.'
      : null
  });
});

// Verify Token
app.get('/api/auth/verify', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const googleTokenRow = await new Promise((resolve, reject) => {
      db.get('SELECT google_refresh_token FROM user_tokens WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    const googleLinked = !!req.user.googleAccessToken || !!(googleTokenRow && googleTokenRow.google_refresh_token);
    res.json({ user: req.user, googleLinked });
  } catch (error) {
    console.error('❌ Fehler bei /api/auth/verify:', error.message);
    res.json({ user: req.user, googleLinked: false });
  }
});

// JWT Refresh Token Endpunkt: erneuert Access Token ohne erneutes Login
app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken, currentToken } = req.body;

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
      db.get('SELECT id, email, display_name, google_id FROM users WHERE id = ?', [row.user_id], (err, user) => {
        if (err) reject(err);
        else resolve(user);
      });
    });

    if (!user) {
      return res.status(403).json({ error: 'User nicht gefunden' });
    }

    // Aus dem alten (ggf. abgelaufenen) Token Google-Daten übernehmen,
    // damit Auto-Backup und Drive-Sync nach einem Token-Refresh weiterlaufen.
    let googleAccessToken = null;
    let displayName = user.display_name;
    if (currentToken) {
      try {
        const oldPayload = jwt.verify(currentToken, JWT_SECRET, { ignoreExpiration: true });
        googleAccessToken = oldPayload.googleAccessToken || null;
        displayName = oldPayload.displayName || displayName;
      } catch (e) {
        // Altes Token nicht verifizierbar -> ignorieren
      }
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email
    };
    if (displayName) tokenPayload.displayName = displayName;
    if (googleAccessToken) tokenPayload.googleAccessToken = googleAccessToken;

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: TOKEN_LONG });
    const newRefreshToken = generateJwtRefreshToken();
    await storeJwtRefreshToken(user.id, newRefreshToken);

    // Prüfe, ob Google-Refresh-Token in DB vorhanden ist (für Client-Info)
    const googleTokenRow = await new Promise((resolve, reject) => {
      db.get('SELECT google_refresh_token FROM user_tokens WHERE user_id = ?', [user.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    const googleLinked = !!googleAccessToken || !!(googleTokenRow && googleTokenRow.google_refresh_token);

    res.json({
      token,
      refreshToken: newRefreshToken,
      googleLinked,
      user: { id: user.id, email: user.email, displayName: displayName || user.email, googleLinked }
    });
  } catch (error) {
    console.error('❌ Fehler beim Refresh:', error);
    res.status(500).json({ error: 'Refresh fehlgeschlagen' });
  }
});

// === PROTECTED API ROUTES ===

// Alle Übungen abrufen
app.get('/api/exercises', authenticateJWT, async (req, res) => {
  try {
    await ensureColumn('exercises', 'info', 'TEXT');
    db.all('SELECT id, user_id, name, muscle_group, exercise_type, info, created_at FROM exercises WHERE user_id = ? ORDER BY name', [req.user.userId], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } catch (err) {
    console.error('❌ Fehler beim Sicherstellen der info-Spalte:', err.message);
    res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
  }
});

// Neue Übung hinzufügen
app.post('/api/exercises', authenticateJWT, async (req, res) => {
  try {
    await ensureColumn('exercises', 'info', 'TEXT');
  } catch (err) {
    console.error('❌ Fehler beim Sicherstellen der info-Spalte:', err.message);
    return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
  }

  const { name, muscle_group, exercise_type, info } = req.body;

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
  const exerciseInfo = info || null;

  db.run('INSERT INTO exercises (user_id, name, muscle_group, exercise_type, info) VALUES (?, ?, ?, ?, ?)',
    [req.user.userId, name, muscle_group, type, exerciseInfo], function(err) {
    if (err) {
      console.error('❌ DB Fehler:', err);
      return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
    }
    console.log('✅ Übung gespeichert, ID:', this.lastID);
    res.json({ id: this.lastID, name, muscle_group, exercise_type: type, info: exerciseInfo });
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
app.put('/api/exercises/:id', authenticateJWT, async (req, res) => {
  try {
    await ensureColumn('exercises', 'info', 'TEXT');
  } catch (err) {
    console.error('❌ Fehler beim Sicherstellen der info-Spalte:', err.message);
    return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
  }

  const { name, muscle_group, exercise_type, info } = req.body;

  console.log('📝 Übung aktualisieren:', { id: req.params.id, name, muscle_group, exercise_type, userId: req.user.userId });

  if (!name || !muscle_group) {
    return res.status(400).json({ error: 'Name und Muskelgruppe erforderlich' });
  }

  const type = exercise_type || 'strength';
  const exerciseInfo = info !== undefined ? info : null;

  db.run(
    'UPDATE exercises SET name = ?, muscle_group = ?, exercise_type = ?, info = ? WHERE id = ? AND user_id = ?',
    [name, muscle_group, type, exerciseInfo, req.params.id, req.user.userId],
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
      res.json({ message: 'Übung aktualisiert', id: parseInt(req.params.id), name, muscle_group, exercise_type: type, info: exerciseInfo });
    }
  );
});

// Alle Workouts abrufen
app.get('/api/workouts', authenticateJWT, async (req, res) => {
  try {
    await ensureColumn('exercises', 'info', 'TEXT');
    await ensureColumn('workouts', 'info', 'TEXT');
  } catch (err) {
    console.error('❌ Fehler beim Sicherstellen der info-Spalte:', err.message);
    return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
  }

  const query = `
    SELECT w.*, e.name as exercise_name, e.muscle_group, e.exercise_type, e.info as exercise_info
    FROM workouts w
    LEFT JOIN exercises e ON w.exercise_id = e.id
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
  const { exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date, info } = req.body;
  const userId = req.user.userId;

  console.log('📝 Workout POST erhalten:', { userId, exercise_id, weight, sets, reps, duration_seconds, date, info });
  
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

  // Auto-Heal: Sicherstellen dass die info-Spalte in workouts existiert
  try {
    await ensureColumn('workouts', 'info', 'TEXT');
  } catch (err) {
    console.error('❌ Fehler beim Sicherstellen der workouts.info-Spalte:', err.message);
    return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
  }

  // Jetzt erst INSERT durchführen - mit duration_seconds und info
  const hasDurationColumn = true; // Wir versuchen es immer zuerst mit
  const workoutInfo = info !== undefined ? info : null;

  db.run(
    'INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [userId, exerciseId, weight && parseFloat(weight) || 0, sets && parseInt(sets) || 0, reps && parseInt(reps) || 0, duration_seconds && parseInt(duration_seconds) || null, rest_seconds && parseInt(rest_seconds) || 60, feeling && parseInt(feeling) || 5, date || new Date().toISOString().split('T')[0], workoutInfo],
    function(err) {
      if (err && err.message.includes('no column named duration_seconds')) {
        console.log('⚠️ duration_seconds Spalte fehlt, füge hinzu...');
        // Spalte hinzufügen und INSERT ohne duration_seconds (temporär)
        db.run('ALTER TABLE workouts ADD COLUMN duration_seconds INTEGER', (alterErr) => {
          if (alterErr) {
            console.error('❌ Migration fehlgeschlagen:', alterErr.message);
            // Fallback: Ohne duration_seconds speichern
            db.run(
              'INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, rest_seconds, feeling, date, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [userId, exerciseId, weight && parseFloat(weight) || 0, sets && parseInt(sets) || 0, reps && parseInt(reps) || 0, rest_seconds && parseInt(rest_seconds) || 60, feeling && parseInt(feeling) || 5, date || new Date().toISOString().split('T')[0], workoutInfo],
              function(err2) {
                if (err2) {
                  console.error('❌ Workout INSERT Fehler:', err2.message);
                  return res.status(500).json({ error: 'Speichern fehlgeschlagen: ' + err2.message });
                }
                console.log('✅ Workout gespeichert (ohne duration_seconds)');
                res.json({ id: this.lastID, exercise_id: exerciseId, weight, sets, reps, rest_seconds, feeling, date, info: workoutInfo });
              }
            );
          } else {
            console.log('✅ duration_seconds Spalte hinzugefügt, versuche INSERT erneut');
            // Erneut mit duration_seconds versuchen
            db.run(
              'INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [userId, exerciseId, weight && parseFloat(weight) || 0, sets && parseInt(sets) || 0, reps && parseInt(reps) || 0, duration_seconds && parseInt(duration_seconds) || null, rest_seconds && parseInt(rest_seconds) || 60, feeling && parseInt(feeling) || 5, date || new Date().toISOString().split('T')[0], workoutInfo],
              function(err3) {
                if (err3) {
                  console.error('❌ Workout INSERT Fehler:', err3.message);
                  return res.status(500).json({ error: 'Speichern fehlgeschlagen: ' + err3.message });
                }
                console.log('✅ Workout gespeichert (mit duration_seconds)');
                res.json({ id: this.lastID, exercise_id: exerciseId, weight, sets, reps, duration_seconds, rest_seconds, feeling, date, info: workoutInfo });
              }
            );
          }
        });
      } else if (err) {
        console.error('❌ Workout INSERT Fehler:', err.message);
        return res.status(500).json({ error: 'Speichern fehlgeschlagen: ' + err.message });
      } else {
        console.log('✅ Workout gespeichert, ID:', this.lastID);
        res.json({ id: this.lastID, exercise_id: exerciseId, weight, sets, reps, duration_seconds, rest_seconds, feeling, date, info: workoutInfo });
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
  const { exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date, info } = req.body;
  const userId = req.user.userId;
  const workoutId = req.params.id;

  console.log('📝 Workout UPDATE erhalten:', { workoutId, exercise_id, weight, sets, reps, duration_seconds, date, info });
  
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

  // Auto-Heal: Sicherstellen dass die info-Spalte in workouts existiert
  try {
    await ensureColumn('workouts', 'info', 'TEXT');
  } catch (err) {
    console.error('❌ Fehler beim Sicherstellen der workouts.info-Spalte:', err.message);
    return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
  }

  // UPDATE durchführen
  const workoutInfo = info !== undefined ? info : null;

  db.run(
    'UPDATE workouts SET exercise_id = ?, weight = ?, sets = ?, reps = ?, duration_seconds = ?, rest_seconds = ?, feeling = ?, date = ?, info = ? WHERE id = ? AND user_id = ?',
    [exerciseId,
     weight && parseFloat(weight) || 0,
     sets && parseInt(sets) || 0,
     reps && parseInt(reps) || 0,
     duration_seconds && parseInt(duration_seconds) || null,
     rest_seconds && parseInt(rest_seconds) || 60,
     feeling && parseInt(feeling) || 5,
     date || new Date().toISOString().split('T')[0],
     workoutInfo,
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
        weight, sets, reps, duration_seconds, rest_seconds, feeling, date, info: workoutInfo
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

// Auto-Heal: Sicherstellen, dass die Tabelle existiert, bevor eine Anfrage verarbeitet wird
async function ensureTrainingPlansTable(req, res, next) {
  try {
    if (!db) throw new Error('Datenbank nicht verbunden');
    await ensureTable('training_plans', `CREATE TABLE IF NOT EXISTS training_plans (
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
    next();
  } catch (err) {
    console.error('❌ Auto-Heal training_plans fehlgeschlagen:', err.message);
    res.status(500).json({ error: 'Datenbank-Tabellen konnten nicht initialisiert werden: ' + err.message });
  }
}
app.use('/api/training-plans', ensureTrainingPlansTable);

// Alle Trainingspläne abrufen
app.get('/api/training-plans', authenticateJWT, (req, res) => {
  db.all('SELECT id, name, description, is_active, created_at FROM training_plans WHERE user_id = ? ORDER BY updated_at DESC', 
    [req.user.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// === TRAINING PLAN RESTORE FROM DRIVE ===
// Wiederherstellung ALLER Trainingspläne aus separaten Google Drive Dateien
app.get('/api/training-plans/restore-drive', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const accessToken = await getDriveAccessToken(userId, req.user.googleAccessToken);

    if (!accessToken) {
      return res.status(400).json({ error: 'Kein Google-Token. Bitte mit Google anmelden, um Pläne aus Drive zu laden.' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const folderId = await getOrCreateDriveFolder(drive, 'IronCoach-Backups');

    // 1. Neue separate Plan-Dateien laden (ironcoach_training_plan_userX_planY_Name.json)
    const planFiles = await listUserPlanFiles(drive, folderId, userId);
    const importedPlans = [];
    let activePlanId = null;

    for (const file of planFiles) {
      try {
        const data = await loadPlanFileFromDrive(drive, file.id);
        if (!data || !data.name) {
          console.warn('⚠️ Überspringe ungültige Plan-Datei:', file.name);
          continue;
        }

        const planName = data.name || 'Plan aus Drive';
        const planDescription = data.description || '';
        const isActive = data.is_active === true || data.isActive === true;
        const planDataJson = JSON.stringify(data);

        // Prüfe ob lokaler Plan mit dieser ID schon existiert
        const existingPlan = await getAsync('SELECT id FROM training_plans WHERE id = ? AND user_id = ?', [data.id, userId]);

        let planId;
        if (existingPlan) {
          await runAsync(
            'UPDATE training_plans SET name = ?, description = ?, plan_data = ?, is_active = ?, updated_at = datetime("now") WHERE id = ? AND user_id = ?',
            [planName, planDescription, planDataJson, isActive ? 1 : 0, existingPlan.id, userId]
          );
          planId = existingPlan.id;
        } else {
          planId = (await runAsync(
            'INSERT INTO training_plans (user_id, name, description, plan_data, is_active) VALUES (?, ?, ?, ?, ?)',
            [userId, planName, planDescription, planDataJson, isActive ? 1 : 0]
          )).lastID;
        }

        if (isActive) activePlanId = planId;
        importedPlans.push({ id: planId, name: planName, isActive });
      } catch (err) {
        console.warn('⚠️ Fehler beim Laden einer Plan-Datei:', file.name, err.message);
      }
    }

    // 2. Fallback: alte einzelne Datei ironcoach_training_plan_userX.json
    if (importedPlans.length === 0) {
      try {
        const oldFilename = `ironcoach_training_plan_user${userId}.json`;
        const oldFile = await drive.files.list({
          q: `name='${oldFilename}' and '${folderId}' in parents and trashed=false`,
          fields: 'files(id, name, modifiedTime)',
          orderBy: 'modifiedTime desc',
          timeout: DRIVE_TIMEOUT_MS
        });
        if (oldFile.data.files.length > 0) {
          const data = await loadPlanFileFromDrive(drive, oldFile.data.files[0].id);
          const planName = data.name || 'Plan aus Drive (Legacy)';
          const planDescription = data.description || 'Aus alter Google Drive Datei synchronisierter Plan';
          const planDataJson = JSON.stringify(data);

          const existingActive = await getAsync('SELECT id FROM training_plans WHERE user_id = ? AND is_active = 1', [userId]);
          let planId;
          if (existingActive) {
            await runAsync(
              'UPDATE training_plans SET name = ?, description = ?, plan_data = ?, updated_at = datetime("now") WHERE id = ? AND user_id = ?',
              [planName, planDescription, planDataJson, existingActive.id, userId]
            );
            planId = existingActive.id;
          } else {
            planId = (await runAsync(
              'INSERT INTO training_plans (user_id, name, description, plan_data, is_active) VALUES (?, ?, ?, ?, ?)',
              [userId, planName, planDescription, planDataJson, 1]
            )).lastID;
          }
          activePlanId = planId;
          importedPlans.push({ id: planId, name: planName, isActive: true });
        }
      } catch (e) {
        console.warn('⚠️ Fallback alte Plan-Datei fehlgeschlagen:', e.message);
      }
    }

    // Sicherstellen, dass maximal EIN Plan aktiv ist
    if (activePlanId) {
      await runAsync('UPDATE training_plans SET is_active = 0 WHERE user_id = ? AND id != ?', [userId, activePlanId]);
    } else if (importedPlans.length > 0) {
      const firstPlan = await getAsync('SELECT id FROM training_plans WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', [userId]);
      if (firstPlan) {
        await runAsync('UPDATE training_plans SET is_active = 1 WHERE id = ?', [firstPlan.id]);
        activePlanId = firstPlan.id;
      }
    }

    res.json({
      success: true,
      importedCount: importedPlans.length,
      activePlanId,
      plans: importedPlans
    });
  } catch (error) {
    console.error('❌ Plan Restore Fehler:', error);
    res.status(500).json({ error: 'Wiederherstellung aus Drive fehlgeschlagen: ' + error.message });
  }
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
app.post('/api/training-plans', authenticateJWT, async (req, res) => {
  try {
    const { name, description, plan_data, is_active } = req.body;
    if (!name || !plan_data) return res.status(400).json({ error: 'Name und Plan-Daten erforderlich' });

    let planDataJson;
    try {
      planDataJson = typeof plan_data === 'string' ? plan_data : JSON.stringify(plan_data);
    } catch (jsonErr) {
      console.error('❌ Ungültige Plan-Daten (JSON.stringify):', jsonErr.message);
      return res.status(400).json({ error: 'Plan-Daten können nicht serialisiert werden: ' + jsonErr.message });
    }
    const isActive = is_active ? 1 : 0;

    // Aktive Pläne zurücksetzen, falls der neue Plan aktiv werden soll
    if (isActive) {
      await runAsync('UPDATE training_plans SET is_active = 0 WHERE user_id = ?', [req.user.userId]);
    }

    const result = await runAsync(
      'INSERT INTO training_plans (user_id, name, description, plan_data, is_active) VALUES (?, ?, ?, ?, ?)',
      [req.user.userId, name, description || '', planDataJson, isActive]
    );

    res.json({ id: result.lastID, name, description, is_active: isActive });
  } catch (err) {
    console.error('❌ Fehler POST /api/training-plans:', err.message);
    res.status(500).json({ error: err.message || 'Interner Serverfehler beim Speichern des Plans' });
  }
});

// Plan aktualisieren
app.put('/api/training-plans/:id', authenticateJWT, async (req, res) => {
  try {
    const { name, description, plan_data, is_active } = req.body;
    if (!name || !plan_data) return res.status(400).json({ error: 'Name und Plan-Daten erforderlich' });

    let planDataJson;
    try {
      planDataJson = typeof plan_data === 'string' ? plan_data : JSON.stringify(plan_data);
    } catch (jsonErr) {
      console.error('❌ Ungültige Plan-Daten (JSON.stringify):', jsonErr.message);
      return res.status(400).json({ error: 'Plan-Daten können nicht serialisiert werden: ' + jsonErr.message });
    }
    const isActive = is_active ? 1 : 0;
    const planId = req.params.id;

    // Aktive Pläne zurücksetzen, falls dieser Plan aktiv werden soll
    if (isActive) {
      await runAsync('UPDATE training_plans SET is_active = 0 WHERE user_id = ? AND id != ?', [req.user.userId, planId]);
    }

    const result = await runAsync(
      'UPDATE training_plans SET name = ?, description = ?, plan_data = ?, is_active = ?, updated_at = datetime("now") WHERE id = ? AND user_id = ?',
      [name, description || '', planDataJson, isActive, planId, req.user.userId]
    );

    if (result.changes === 0) return res.status(404).json({ error: 'Plan nicht gefunden' });
    res.json({ message: 'Plan aktualisiert', id: parseInt(planId) });
  } catch (err) {
    console.error('❌ Fehler PUT /api/training-plans/:id:', err.message);
    res.status(500).json({ error: err.message || 'Interner Serverfehler beim Aktualisieren des Plans' });
  }
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

// Plan als aktiv markieren
app.patch('/api/training-plans/:id/activate', authenticateJWT, (req, res) => {
  const userId = req.user.userId;
  const planId = req.params.id;
  db.run('UPDATE training_plans SET is_active = 0 WHERE user_id = ?', [userId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    db.run(
      'UPDATE training_plans SET is_active = 1, updated_at = datetime("now") WHERE id = ? AND user_id = ?',
      [planId, userId],
      function(err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Plan nicht gefunden' });
        res.json({ message: 'Plan ist jetzt aktiv', id: parseInt(planId) });
      }
    );
  });
});

// === GOOGLE DRIVE TRAINING PLAN SYNC ===

// Konstanten für Google Drive API Timeouts (Render-Gateway bricht nach 30-60s ab)
const DRIVE_TIMEOUT_MS = 20000;
const DRIVE_TIMEOUT_ERR = 'Google Drive Anfrage hat das Zeitlimit überschritten';

// Google Drive Fehler klassifizieren, damit Frontend konkrete Hinweise anzeigen kann
function classifyDriveError(error) {
  const code = error.code || error.status || (error.response && error.response.status);
  const message = (error.message || '').toLowerCase();
  const details = error.errors && error.errors[0] && error.errors[0].message ? error.errors[0].message.toLowerCase() : '';

  // 401 / unauthenticated -> Token abgelaufen oder ungültig
  if (code === 401 || message.includes('invalid credentials') || message.includes('unauthorized') || details.includes('invalid credentials')) {
    return {
      type: 'AUTH_EXPIRED',
      status: 401,
      userMessage: 'Google-Token abgelaufen. Bitte abmelden und neu mit Google einloggen.'
    };
  }

  // 403 / insufficient permissions -> Drive-Scope fehlt
  if (code === 403 || message.includes('insufficient permission') || message.includes('forbidden') || details.includes('insufficient permission') || details.includes('does not have')) {
    return {
      type: 'NO_DRIVE_SCOPE',
      status: 403,
      userMessage: 'Keine Google-Drive Berechtigung. Bitte abmelden und neu mit Google einloggen (Drive-Zugriff erlauben).'
    };
  }

  // 404 -> Datei nicht gefunden
  if (code === 404) {
    return {
      type: 'NOT_FOUND',
      status: 404,
      userMessage: 'Drive-Datei nicht gefunden.'
    };
  }

  // 5xx Google Server-Fehler -> temporär nicht erreichbar
  if (code >= 500 && code < 600) {
    return {
      type: 'DRIVE_SERVER_ERROR',
      status: 503,
      userMessage: 'Google Drive ist temporär nicht erreichbar. Bitte später erneut versuchen.'
    };
  }

  // Netzwerk/Timeout
  if (message.includes('timeout') || message.includes('etimedout') || message.includes('econnreset')) {
    return {
      type: 'TIMEOUT',
      status: 503,
      userMessage: 'Google Drive Antwort-Zeitüberschreitung. Bitte später erneut versuchen.'
    };
  }

  return {
    type: 'UNKNOWN',
    status: 500,
    userMessage: 'Drive-Synchronisation fehlgeschlagen: ' + error.message
  };
}

// Sicheren Dateinamen aus Plan-Namen erzeugen
function safeDriveFilename(name) {
  return (name || 'Plan')
    .toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50);
}

function planDriveFilename(userId, planId, name) {
  return `ironcoach_training_plan_user${userId}_plan${planId}_${safeDriveFilename(name)}.json`;
}

// Hilfsfunktion: Google Drive Ordner suchen oder erstellen
async function getOrCreateDriveFolder(drive, name) {
  let response;
  try {
    response = await drive.files.list({
      q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
      timeout: DRIVE_TIMEOUT_MS
    });
  } catch (err) {
    if (err.code === 401) throw err;
    throw err;
  }

  if (response.data.files.length > 0) {
    return response.data.files[0].id;
  }

  const folder = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
    timeout: DRIVE_TIMEOUT_MS
  });
  return folder.data.id;
}

// Hilfsfunktion: Trainingsplan als JSON in Google Drive speichern/aktualisieren
async function savePlanToDrive(drive, folderId, filename, planData) {
  const jsonString = JSON.stringify(planData, null, 2);
  const stream = Readable.from([jsonString]);

  // Prüfe ob Datei existiert
  const existing = await drive.files.list({
    q: `name='${filename}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, name)',
    timeout: DRIVE_TIMEOUT_MS
  });

  if (existing.data.files.length > 0) {
    const fileId = existing.data.files[0].id;
    const file = await drive.files.update({
      fileId,
      media: { mimeType: 'application/json', body: stream },
      fields: 'id, name, modifiedTime',
      timeout: DRIVE_TIMEOUT_MS
    });
    return { id: file.data.id, updated: true, modifiedTime: file.data.modifiedTime };
  } else {
    const file = await drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType: 'application/json', body: stream },
      fields: 'id, name, modifiedTime',
      timeout: DRIVE_TIMEOUT_MS
    });
    return { id: file.data.id, created: true, modifiedTime: file.data.modifiedTime };
  }
}

// Hilfsfunktion: Liste aller separaten Trainingsplan-Dateien eines Users
async function listUserPlanFiles(drive, folderId, userId) {
  const prefix = `ironcoach_training_plan_user${userId}_`;
  const response = await drive.files.list({
    q: `name contains '${prefix}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, modifiedTime)',
    orderBy: 'name',
    spaces: 'drive',
    timeout: DRIVE_TIMEOUT_MS
  });
  return response.data.files || [];
}

// Hilfsfunktion: Einzelne Datei aus Drive laden
async function loadPlanFileFromDrive(drive, fileId) {
  const download = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'json', timeout: DRIVE_TIMEOUT_MS });
  return download.data;
}

// Hilfsfunktion: Datei aus Drive in den Papierkorb verschieben
async function deletePlanFileFromDrive(drive, fileId) {
  await drive.files.update({ fileId, requestBody: { trashed: true }, timeout: DRIVE_TIMEOUT_MS });
}

// === TRAINING PLAN SAVE TO DRIVE ===
// Speichert ALLE Trainingspläne des Users als separate Dateien in Drive
app.post('/api/training-plans/sync-all-drive', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const accessToken = await getDriveAccessToken(userId, req.user.googleAccessToken);

    if (!accessToken) {
      return res.status(400).json({ error: 'Kein Google-Token. Bitte mit Google anmelden, um in Drive zu synchronisieren.' });
    }

    // Alle Pläne des Users laden
    const plans = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM training_plans WHERE user_id = ?', [userId], (err, rows) => {
        if (err) return reject(err);
        rows.forEach(row => {
          try { row.plan_data = JSON.parse(row.plan_data); } catch (e) {}
        });
        resolve(rows);
      });
    });

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const folderId = await getOrCreateDriveFolder(drive, 'IronCoach-Backups');

    // Bestehende Plan-Dateien finden, um verwaiste Dateien später zu löschen
    const existingFiles = await listUserPlanFiles(drive, folderId, userId);
    const savedFileIds = [];
    const savedPlans = [];

    for (const plan of plans) {
      const planData = plan.plan_data || {};
      planData.id = plan.id;
      planData.name = plan.name;
      planData.description = plan.description;
      planData.is_active = plan.is_active === 1;

      const filename = planDriveFilename(userId, plan.id, plan.name);
      const result = await savePlanToDrive(drive, folderId, filename, planData);
      savedFileIds.push(result.id);
      savedPlans.push({ id: plan.id, name: plan.name, driveFileId: result.id });
    }

    // Dateien löschen, die nicht mehr zu aktuellen Plänen passen (z. B. gelöschte Pläne)
    let deletedCount = 0;
    for (const file of existingFiles) {
      if (!savedFileIds.includes(file.id)) {
        try {
          await deletePlanFileFromDrive(drive, file.id);
          deletedCount++;
          console.log('🗑️ Verwaiste Plan-Datei gelöscht:', file.name);
        } catch (e) {
          console.warn('⚠️ Konnte alte Plan-Datei nicht löschen:', file.name, e.message);
        }
      }
    }

    res.json({
      success: true,
      message: 'Trainingspläne in Google Drive synchronisiert',
      savedCount: savedPlans.length,
      deletedCount,
      plans: savedPlans
    });
  } catch (error) {
    const classified = classifyDriveError(error);
    console.error(`❌ Plan Sync Fehler [${classified.type}]:`, error.message);
    res.status(classified.status).json({
      error: classified.userMessage,
      errorType: classified.type,
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// === GOOGLE DRIVE DIAGNOSTICS ===
// Testet, ob die Google Drive Verbindung wirklich funktioniert (Token + Scope).
// Gibt KEINE Secrets zurück, nur Status.
app.get('/api/drive/test', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    // 1. Prüfen, ob überhaupt ein Token vorhanden ist
    const hasJwtGoogleToken = !!req.user.googleAccessToken;
    const googleTokenRow = await new Promise((resolve, reject) => {
      db.get('SELECT google_refresh_token FROM user_tokens WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    const hasRefreshToken = !!(googleTokenRow && googleTokenRow.google_refresh_token);

    if (!hasJwtGoogleToken && !hasRefreshToken) {
      return res.status(400).json({
        connected: false,
        errorType: 'NO_TOKEN',
        error: 'Kein Google-Token vorhanden. Bitte mit Google einloggen.'
      });
    }

    // 2. Gültiges Access Token holen
    const accessToken = await getDriveAccessToken(userId, req.user.googleAccessToken);
    if (!accessToken) {
      return res.status(401).json({
        connected: false,
        errorType: 'AUTH_EXPIRED',
        error: 'Google-Token konnte nicht erneuert werden. Bitte abmelden und neu mit Google einloggen.'
      });
    }

    // 3. Drive API testen (about.get braucht Drive-Scope)
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    await drive.about.get({ fields: 'user(displayName)' });

    res.json({
      connected: true,
      message: 'Google Drive Verbindung OK',
      source: hasRefreshToken ? 'refresh_token' : 'jwt_access_token'
    });
  } catch (error) {
    const classified = classifyDriveError(error);
    console.error(`❌ Drive Test Fehler [${classified.type}]:`, error.message);
    res.status(classified.status).json({
      connected: false,
      errorType: classified.type,
      error: classified.userMessage,
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// === GOOGLE DRIVE BACKUP ===

// Backup zu Google Drive
app.post('/api/backup/drive', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    let accessToken = await getDriveAccessToken(userId, req.user.googleAccessToken);

    if (!accessToken) {
      return res.status(400).json({
        error: 'Nicht mit Google angemeldet. Bitte erneut einloggen.'
      });
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
    const userId = req.user.userId || req.user.id;
    console.log('🔄 RESTORE-REQUEST für User:', userId);

    let accessToken = await getDriveAccessToken(userId, req.user.googleAccessToken);

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
  const userId = req.user.userId || req.user.id;
  console.log('🔄 RESTORE-REQUEST für User:', userId);

  try {
    const accessToken = await getDriveAccessToken(userId, req.user.googleAccessToken);

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

// === BACKUP MERGE IMPORT (SQLite Backup einlesen, fehlende Uebungen anlegen, Workouts verknuepfen) ===

const BACKUPS_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

// Hilfsfunktion: SQLite-Spalten einer Tabelle ermitteln
async function getColumns(dbHandle, table) {
  return new Promise((resolve, reject) => {
    dbHandle.all(`PRAGMA table_info(${table})`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.name));
    });
  });
}

// Hilfsfunktion: Backup-Datenbank pruefen und Tabellen anpassen
async function attachBackup(tempDbPath) {
  return new Promise((resolve, reject) => {
    const backupDb = new sqlite3.Database(tempDbPath, sqlite3.OPEN_READONLY, async (err) => {
      if (err) return reject(err);
      try {
        const tables = await new Promise((res, rej) => {
          backupDb.all("SELECT name FROM sqlite_master WHERE type='table'", [], (e, r) => {
            if (e) rej(e);
            else res(r.map(x => x.name));
          });
        });
        if (!tables.includes('exercises') || !tables.includes('workouts')) {
          throw new Error('Backup muss Tabellen "exercises" und "workouts" enthalten');
        }
        resolve(backupDb);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Backup-Import mit Merge: Fehlende Uebungen anlegen, Workouts remappen
app.post('/api/import/merge-backup', authenticateJWT, async (req, res) => {
  const userId = req.user.userId || req.user.id;
  const { backupBase64 } = req.body;

  if (!backupBase64) {
    return res.status(400).json({ error: 'Kein Backup-Daten erhalten' });
  }

  let tempPath = null;
  let backupDb = null;
  let fkDisabled = false;

  try {
    // Temporaeres Backup aus Base64 erzeugen
    const buffer = Buffer.from(backupBase64, 'base64');
    tempPath = path.join(BACKUPS_DIR, `import_temp_${userId}_${Date.now()}.db`);
    fs.writeFileSync(tempPath, buffer);

    backupDb = await attachBackup(tempPath);

    const exerciseCols = await getColumns(backupDb, 'exercises');
    const workoutCols = await getColumns(backupDb, 'workouts');

    // Fremdschluessel-Checks waehrend des Imports abschalten, damit
    // inkonsistente oder aeltere Backups trotzdem importiert werden koennen.
    // Wird am Ende in finally wieder eingeschaltet.
    await runAsync('PRAGMA foreign_keys = OFF');
    fkDisabled = true;

    // Uebungen aus Backup laden
    const backupExercises = await new Promise((resolve, reject) => {
      const fields = ['id', 'name', 'muscle_group']
        .map(f => exerciseCols.includes(f) ? f : "'' as " + f)
        .join(', ');
      const typeField = exerciseCols.includes('exercise_type') ? ', exercise_type' : ", 'strength' as exercise_type";
      const infoField = exerciseCols.includes('info') ? ', info' : ", null as info";
      backupDb.all(`SELECT ${fields}${typeField}${infoField} FROM exercises`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Aktuelle Uebungen des Users laden
    const currentExercises = await allAsync(
      'SELECT id, name FROM exercises WHERE user_id = ?',
      [userId]
    );

    // Name -> id Map fuer schnelles Matching (case-insensitive, getrimmt)
    const currentByName = new Map();
    currentExercises.forEach(e => {
      currentByName.set(e.name.trim().toLowerCase(), e.id);
    });

    const exerciseIdMap = new Map(); // backupId -> currentId
    let createdExercises = 0;
    let failedExercises = 0;

    for (const be of backupExercises) {
      try {
        const normalizedName = (be.name || '').trim().toLowerCase();
        if (!normalizedName) continue;

        let currentId = currentByName.get(normalizedName);
        if (!currentId) {
          const type = be.exercise_type || 'strength';
          const muscle = be.muscle_group || 'Sonstiges';
          const info = be.info || null;
          const result = await runAsync(
            'INSERT INTO exercises (user_id, name, muscle_group, exercise_type, info) VALUES (?, ?, ?, ?, ?)',
            [userId, be.name.trim(), muscle, type, info]
          );
          currentId = result.lastID;
          currentByName.set(normalizedName, currentId);
          createdExercises++;
        }
        exerciseIdMap.set(be.id, currentId);
      } catch (exErr) {
        failedExercises++;
        console.warn('⚠️ Übung aus Backup übersprungen:', exErr.message, '| Übung:', be.name);
      }
    }

    // Workouts aus Backup laden
    const backupWorkouts = await new Promise((resolve, reject) => {
      const fields = ['exercise_id', 'weight', 'sets', 'reps', 'date']
        .map(f => workoutCols.includes(f) ? f : (f === 'weight' ? '0 as weight' : f === 'sets' ? '0 as sets' : f === 'reps' ? '0 as reps' : "'' as " + f))
        .join(', ');
      const optional = ['duration_seconds', 'rest_seconds', 'feeling', 'info', 'created_at']
        .map(f => workoutCols.includes(f) ? `, ${f}` : (f === 'duration_seconds' ? ', null as duration_seconds' : f === 'rest_seconds' ? ', null as rest_seconds' : f === 'feeling' ? ', null as feeling' : f === 'info' ? ', null as info' : ", datetime('now') as created_at"))
        .join('');
      backupDb.all(`SELECT ${fields}${optional} FROM workouts`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    let importedWorkouts = 0;
    let skippedWorkouts = 0;
    let failedWorkouts = 0;

    for (const bw of backupWorkouts) {
      const currentExerciseId = exerciseIdMap.get(bw.exercise_id);
      if (!currentExerciseId) {
        skippedWorkouts++;
        continue;
      }

      try {
        await runAsync(
          `INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, duration_seconds, rest_seconds, feeling, date, info, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            currentExerciseId,
            bw.weight || 0,
            bw.sets || 0,
            bw.reps || 0,
            bw.duration_seconds || null,
            bw.rest_seconds || null,
            bw.feeling || null,
            bw.date || new Date().toISOString().split('T')[0],
            bw.info || null,
            bw.created_at || new Date().toISOString()
          ]
        );
        importedWorkouts++;
      } catch (woErr) {
        failedWorkouts++;
        console.warn('⚠️ Workout aus Backup übersprungen:', woErr.message, '| exercise_id:', bw.exercise_id);
      }
    }

    // Trainingspläne aus Backup laden (falls Tabelle existiert)
    let importedPlans = 0;
    let skippedPlans = 0;
    let failedPlans = 0;
    let totalPlansInBackup = 0;
    try {
      const planCols = await getColumns(backupDb, 'training_plans');
      if (planCols.includes('name') && planCols.includes('plan_data')) {
        const backupPlans = await new Promise((resolve, reject) => {
          const fields = [
            { name: 'name', fallback: "'' as name" },
            { name: 'description', fallback: 'null as description' },
            { name: 'plan_data', fallback: 'null as plan_data' },
            { name: 'is_active', fallback: '0 as is_active' },
            { name: 'created_at', fallback: "datetime('now') as created_at" },
            { name: 'updated_at', fallback: "datetime('now') as updated_at" }
          ]
            .map(f => planCols.includes(f.name) ? f.name : f.fallback)
            .join(', ');
          backupDb.all(`SELECT ${fields} FROM training_plans`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });

        totalPlansInBackup = backupPlans.length;

        // Aktuelle Plannamen des Users (case-insensitive) für eindeutige Namen
        const currentPlans = await allAsync(
          'SELECT id, name FROM training_plans WHERE user_id = ?',
          [userId]
        );
        const currentPlanNames = new Set(currentPlans.map(p => p.name.trim().toLowerCase()));

        for (const bp of backupPlans) {
          if (!bp.plan_data) {
            skippedPlans++;
            continue;
          }
          try {
            let baseName = (bp.name || 'Trainingsplan').trim();
            if (!baseName) baseName = 'Trainingsplan';

            let uniqueName = baseName;
            let suffix = 1;
            while (currentPlanNames.has(uniqueName.toLowerCase())) {
              suffix++;
              uniqueName = `${baseName} (Import${suffix > 2 ? ' ' + suffix : ''})`;
            }
            currentPlanNames.add(uniqueName.toLowerCase());

            await runAsync(
              'INSERT INTO training_plans (user_id, name, description, plan_data, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
              [
                userId,
                uniqueName,
                bp.description || null,
                bp.plan_data,
                bp.created_at || new Date().toISOString(),
                bp.updated_at || new Date().toISOString()
              ]
            );
            importedPlans++;
          } catch (plErr) {
            failedPlans++;
            console.warn('⚠️ Trainingsplan aus Backup übersprungen:', plErr.message, '| Name:', bp.name);
          }
        }
      }
    } catch (planErr) {
      console.warn('⚠️ Trainingspläne aus Backup konnten nicht gelesen werden:', planErr.message);
    }

    backupDb.close();

    // Temporaere Datei aufraeumen
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    // Lokalen Snapshot als aktualisiertes Backup speichern
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const localBackupPath = path.join(BACKUPS_DIR, `ironcoach_backup_user${userId}_${timestamp}.db`);
    fs.copyFileSync(DB_PATH, localBackupPath);

    res.json({
      success: true,
      message: 'Backup erfolgreich importiert und zusammengefuehrt',
      importedWorkouts,
      createdExercises,
      skippedWorkouts,
      failedWorkouts,
      totalExercisesInBackup: backupExercises.length,
      totalWorkoutsInBackup: backupWorkouts.length,
      failedExercises,
      importedPlans,
      skippedPlans,
      failedPlans,
      totalPlansInBackup,
      localBackupPath: path.basename(localBackupPath)
    });

  } catch (error) {
    console.error('❌ Merge-Backup Fehler:', error);
    res.status(500).json({ error: 'Import fehlgeschlagen: ' + error.message });
  } finally {
    if (backupDb) backupDb.close();
    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    if (fkDisabled) {
      try {
        await runAsync('PRAGMA foreign_keys = ON');
      } catch (fkErr) {
        console.warn('⚠️ Fremdschluessel-Checks konnten nicht wieder aktiviert werden:', fkErr.message);
      }
    }
  }
});

// Lokales Backup erstellen und als Download bereitstellen
app.get('/api/backup/local', authenticateJWT, (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `ironcoach_backup_user${userId}_${timestamp}.db`;
    const backupPath = path.join(BACKUPS_DIR, filename);
    fs.copyFileSync(DB_PATH, backupPath);
    res.download(backupPath, filename, (err) => {
      if (err) {
        console.error('❌ Download Fehler:', err);
      }
    });
  } catch (error) {
    console.error('❌ Lokales Backup Fehler:', error);
    res.status(500).json({ error: 'Backup fehlgeschlagen: ' + error.message });
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

// Globale Error-Handler: Verhindern, dass der Prozess bei unerwarteten Fehlern crasht (Render -> 502)
process.on('uncaughtException', (err) => {
  console.error('❌ Unbehandelte Exception:', err);
  // Server weiterlaufen lassen, aber Admin informieren
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unbehandeltes Promise-Rejection:', reason);
});

// Server starten – erst nach erfolgreicher Datenbank-Initialisierung
let server = null;
initDatabase()
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`🔒 IronCoach Server läuft auf http://localhost:${PORT}`);
      console.log(`📊 Umgebung: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📦 Version: 1.3.2 | Standardübungen: 78`);
      console.log(`🏥 Health-Check: http://localhost:${PORT}/api/health`);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      db.close();
      server.close(() => {
        process.exit(0);
      });
    });
  })
  .catch(err => {
    console.error('❌ Server konnte nicht starten:', err.message);
    process.exit(1);
  });
