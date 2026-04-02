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
    callbackURL: '/auth/google/callback',
    proxy: true
  }, (accessToken, refreshToken, profile, done) => {
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
    // Gym - Brust
    { name: 'Bankdrücken (Langhantel)', muscle_group: 'Brust' },
    { name: 'Schrägbankdrücken', muscle_group: 'Brust' },
    { name: 'Fliegende (Butterfly)', muscle_group: 'Brust' },
    { name: 'Dips', muscle_group: 'Brust' },
    
    // Gym - Rücken
    { name: 'Kreuzheben', muscle_group: 'Rücken' },
    { name: 'Klimmzüge', muscle_group: 'Rücken' },
    { name: 'Rudern (Langhantel)', muscle_group: 'Rücken' },
    { name: 'Latzug', muscle_group: 'Rücken' },
    { name: 'T-Bar Rudern', muscle_group: 'Rücken' },
    
    // Gym - Beine
    { name: 'Kniebeugen', muscle_group: 'Beine' },
    { name: 'Beinpresse', muscle_group: 'Beine' },
    { name: 'Beinstrecker', muscle_group: 'Beine' },
    { name: 'Beinbeuger', muscle_group: 'Beine' },
    { name: 'Wadenheben', muscle_group: 'Beine' },
    { name: 'Ausfallschritte', muscle_group: 'Beine' },
    
    // Gym - Schultern
    { name: 'Schulterdrücken', muscle_group: 'Schultern' },
    { name: 'Seitheben', muscle_group: 'Schultern' },
    { name: 'Frontheben', muscle_group: 'Schultern' },
    { name: 'Face Pulls', muscle_group: 'Schultern' },
    
    // Gym - Arme
    { name: 'Bizeps-Curls', muscle_group: 'Arme' },
    { name: 'Trizeps-Drücken', muscle_group: 'Arme' },
    { name: 'Hammer Curls', muscle_group: 'Arme' },
    { name: 'Französisches Trizeps', muscle_group: 'Arme' },
    
    // Gym - Bauch
    { name: 'Plank (Unterarmstütz)', muscle_group: 'Bauch' },
    { name: 'Crunches', muscle_group: 'Bauch' },
    { name: 'Beinheben', muscle_group: 'Bauch' },
    { name: 'Russische Twist', muscle_group: 'Bauch' },
    { name: 'ADIM-Core (für Gleitwirbel)', muscle_group: 'Bauch' },
    
    // Judo - Spezifisch
    { name: 'Uchi-Komi (Wurfübungen)', muscle_group: 'Ganzkörper' },
    { name: 'Nage-Komi (Wurftraining)', muscle_group: 'Ganzkörper' },
    { name: 'Randori (Freikampf)', muscle_group: 'Ganzkörper' },
    { name: 'Kata (Formen)', muscle_group: 'Ganzkörper' },
    { name: 'Sprungsukomikomi', muscle_group: 'Beine' },
    { name: 'Explosive Beinarbeit', muscle_group: 'Beine' },
    { name: 'Grip Fighting', muscle_group: 'Arme' },
    { name: 'Ne-waza (Bodenkampf)', muscle_group: 'Ganzkörper' },
    { name: 'Turn-Uchikomi', muscle_group: 'Rücken' },
  ];
  
  defaultExercises.forEach(exercise => {
    db.run('INSERT INTO exercises (user_id, name, muscle_group) VALUES (?, ?, ?)',
      [userId, exercise.name, exercise.muscle_group],
      (err) => {
        if (err) console.error('❌ Fehler beim Erstellen der Übung:', err.message);
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
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const baseUrl = `${protocol}://${host}`;
      res.redirect(`${baseUrl}/?token=${token}`);
    }
  );
}

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
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
  const { name, muscle_group } = req.body;
  
  console.log('📝 Übung hinzufügen:', { name, muscle_group, userId: req.user.userId });
  
  if (!name || !muscle_group) {
    return res.status(400).json({ error: 'Name und Muskelgruppe erforderlich' });
  }
  
  if (!req.user.userId) {
    console.error('❌ Keine userId im Token');
    return res.status(401).json({ error: 'Nicht authentifiziert' });
  }
  
  db.run('INSERT INTO exercises (user_id, name, muscle_group) VALUES (?, ?, ?)', 
    [req.user.userId, name, muscle_group], function(err) {
    if (err) {
      console.error('❌ DB Fehler:', err);
      return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
    }
    console.log('✅ Übung gespeichert, ID:', this.lastID);
    res.json({ id: this.lastID, name, muscle_group });
  });
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

// Neues Workout hinzufügen
app.post('/api/workouts', authenticateJWT, (req, res) => {
  const { exercise_id, weight, sets, reps, rest_seconds, feeling, date } = req.body;
  db.run(
    'INSERT INTO workouts (user_id, exercise_id, weight, sets, reps, rest_seconds, feeling, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [req.user.userId, exercise_id, weight, sets, reps, rest_seconds, feeling, date],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, exercise_id, weight, sets, reps, rest_seconds, feeling, date });
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
    
    res.json({ restored: true, message: 'Daten vom Backup wiederhergestellt' });
    
  } catch (error) {
    console.error('❌ Restore Fehler:', error);
    res.status(500).json({ error: 'Restore fehlgeschlagen: ' + error.message });
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
  console.log(`🔒 IronCoach Server läuft auf http://localhost:${PORT}`);
  console.log(`📊 Umgebung: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});
