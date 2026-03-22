const express = require('express');
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
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dein-geheimer-schluessel-mindestens-32-zeichen-lang';
const SESSION_SECRET = process.env.SESSION_SECRET || 'session-secret-mindestens-32-zeichen-lang-hier';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // Optional: shared spreadsheet

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false
}));

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

// In-Memory User Store (nur für lokale Auth, kein SQLite mehr)
const users = new Map();
let userIdCounter = 1;

// Google Sheets Auth Helper
function getSheetsClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: 'v4', auth });
}

// Create user spreadsheet
async function createUserSpreadsheet(accessToken, userId) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });
  
  // Create spreadsheet
  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: `IronCoach - Trainingsdaten (${userId})`
      },
      sheets: [
        {
          properties: { title: 'Exercises', sheetId: 0 },
          data: [{
            rowData: [{
              values: [
                { userEnteredValue: { stringValue: 'ID' } },
                { userEnteredValue: { stringValue: 'Name' } },
                { userEnteredValue: { stringValue: 'Muskelgruppe' } },
                { userEnteredValue: { stringValue: 'Erstellt am' } }
              ]
            }]
          }]
        },
        {
          properties: { title: 'Workouts', sheetId: 1 },
          data: [{
            rowData: [{
              values: [
                { userEnteredValue: { stringValue: 'ID' } },
                { userEnteredValue: { stringValue: 'Exercise ID' } },
                { userEnteredValue: { stringValue: 'Gewicht' } },
                { userEnteredValue: { stringValue: 'Sätze' } },
                { userEnteredValue: { stringValue: 'Wdh' } },
                { userEnteredValue: { stringValue: 'Ruhezeit' } },
                { userEnteredValue: { stringValue: 'Gefühl' } },
                { userEnteredValue: { stringValue: 'Datum' } },
                { userEnteredValue: { stringValue: 'Erstellt am' } }
              ]
            }]
          }]
        }
      ]
    }
  });
  
  return spreadsheet.data.spreadsheetId;
}

// Local Strategy
passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    const user = Array.from(users.values()).find(u => u.email === email);
    if (!user) return done(null, false, { message: 'User nicht gefunden' });
    if (!user.password) return done(null, false, { message: 'Bitte mit Google anmelden' });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return done(null, false, { message: 'Falsches Passwort' });
    
    return done(null, user);
  }
));

// Google Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
  }, async (accessToken, refreshToken, profile, done) => {
    const email = profile.emails[0].value;
    const googleId = profile.id;
    const displayName = profile.displayName;
    
    let user = Array.from(users.values()).find(u => u.googleId === googleId || u.email === email);
    
    if (user) {
      // Update access token
      user.googleAccessToken = accessToken;
      user.googleRefreshToken = refreshToken;
      
      // Create spreadsheet if not exists
      if (!user.spreadsheetId) {
        try {
          user.spreadsheetId = await createUserSpreadsheet(accessToken, user.id);
          console.log('✅ Spreadsheet erstellt:', user.spreadsheetId);
        } catch (err) {
          console.error('❌ Fehler beim Erstellen des Spreadsheets:', err);
        }
      }
      return done(null, user);
    }
    
    // New user
    const newUser = {
      id: userIdCounter++,
      email,
      googleId,
      displayName,
      password: null,
      googleAccessToken: accessToken,
      googleRefreshToken: refreshToken,
      spreadsheetId: null,
      createdAt: new Date().toISOString()
    };
    
    // Create spreadsheet for new user
    try {
      newUser.spreadsheetId = await createUserSpreadsheet(accessToken, newUser.id);
      console.log('✅ Spreadsheet für neuen User erstellt:', newUser.spreadsheetId);
    } catch (err) {
      console.error('❌ Fehler beim Erstellen des Spreadsheets:', err);
    }
    
    users.set(newUser.id, newUser);
    done(null, newUser);
  }));
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = users.get(id);
  done(null, user || null);
});

// JWT Middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) return res.sendStatus(403);
      const user = users.get(decoded.userId);
      if (!user) return res.sendStatus(401);
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

// === AUTH ROUTES ===

// Register
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { email, password, displayName } = req.body;
  
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Email und Passwort (min. 6 Zeichen) erforderlich' });
  }
  
  if (Array.from(users.values()).find(u => u.email === email)) {
    return res.status(409).json({ error: 'Email bereits registriert' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: userIdCounter++,
      email,
      password: hashedPassword,
      googleId: null,
      displayName: displayName || email,
      googleAccessToken: null,
      googleRefreshToken: null,
      spreadsheetId: null,
      createdAt: new Date().toISOString()
    };
    users.set(newUser.id, newUser);
    
    const token = jwt.sign({ userId: newUser.id, email }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: newUser.id, email, displayName: newUser.displayName } });
  } catch (err) {
    console.error('❌ Registrierungsfehler:', err);
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
      user: { id: user.id, email: user.email, displayName: user.displayName },
      spreadsheetId: user.spreadsheetId
    });
  })(req, res, next);
});

// Google Auth Routes
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  // Mit Drive-Scope für Sheets
  app.get('/auth/google', passport.authenticate('google', { 
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file']
  }));

  app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/login.html' }),
    (req, res) => {
      const token = jwt.sign({ userId: req.user.id, email: req.user.email }, JWT_SECRET, { expiresIn: '24h' });
      res.redirect(`/?token=${token}&sheet=${req.user.spreadsheetId || ''}`);
    }
  );
}

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    storage: 'Google Sheets',
    environment: process.env.NODE_ENV || 'development',
    googleOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  });
});

// Config Endpoint
app.get('/api/config', (req, res) => {
  res.json({
    googleOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    timestamp: new Date().toISOString()
  });
});

// === SHEETS API ROUTES ===

// Alle Übungen abrufen
app.get('/api/exercises', authenticateJWT, async (req, res) => {
  try {
    if (!req.user.spreadsheetId) {
      return res.json([]);
    }
    
    const sheets = getSheetsClient(req.user.googleAccessToken);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Exercises!A2:D'
    });
    
    const rows = response.data.values || [];
    const exercises = rows.map((row, index) => ({
      id: parseInt(row[0]) || index + 1,
      name: row[1] || '',
      muscle_group: row[2] || '',
      created_at: row[3] || new Date().toISOString()
    }));
    
    res.json(exercises);
  } catch (err) {
    console.error('❌ Fehler beim Laden der Übungen:', err);
    res.status(500).json({ error: 'Fehler beim Laden: ' + err.message });
  }
});

// Neue Übung hinzufügen
app.post('/api/exercises', authenticateJWT, async (req, res) => {
  const { name, muscle_group } = req.body;
  
  if (!name || !muscle_group) {
    return res.status(400).json({ error: 'Name und Muskelgruppe erforderlich' });
  }
  
  try {
    // Für lokale Auth brauchen wir Google OAuth - nicht unterstützt für Sheets
    if (!req.user.googleAccessToken) {
      return res.status(400).json({ error: 'Für Datenspeicherung bitte mit Google anmelden' });
    }
    
    // Ensure spreadsheet exists
    if (!req.user.spreadsheetId) {
      req.user.spreadsheetId = await createUserSpreadsheet(req.user.googleAccessToken, req.user.id);
    }
    
    const sheets = getSheetsClient(req.user.googleAccessToken);
    
    // Get current number of rows to generate ID
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Exercises!A:A'
    });
    const nextId = (response.data.values?.length || 1);
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Exercises!A:D',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[nextId, name, muscle_group, new Date().toISOString()]]
      }
    });
    
    res.json({ id: nextId, name, muscle_group });
  } catch (err) {
    console.error('❌ Fehler beim Hinzufügen:', err);
    res.status(500).json({ error: 'Fehler beim Speichern: ' + err.message });
  }
});

// Übung löschen
app.delete('/api/exercises/:id', authenticateJWT, async (req, res) => {
  if (!req.user.googleAccessToken) {
    return res.status(400).json({ error: 'Nur mit Google-Auth verfügbar' });
  }
  
  try {
    const sheets = getSheetsClient(req.user.googleAccessToken);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Exercises!A:D'
    });
    
    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] == req.params.id);
    
    if (rowIndex >= 0) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: req.user.spreadsheetId,
        range: `Exercises!A${rowIndex + 1}:D${rowIndex + 1}`
      });
    }
    
    res.json({ message: 'Übung gelöscht' });
  } catch (err) {
    console.error('❌ Fehler beim Löschen:', err);
    res.status(500).json({ error: 'Fehler beim Löschen: ' + err.message });
  }
});

// Alle Workouts abrufen
app.get('/api/workouts', authenticateJWT, async (req, res) => {
  try {
    if (!req.user.spreadsheetId) {
      return res.json([]);
    }
    
    const sheets = getSheetsClient(req.user.googleAccessToken);
    
    // Get workouts
    const workoutsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Workouts!A2:I'
    });
    
    // Get exercises for joining
    const exercisesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Exercises!A2:D'
    });
    
    const workouts = (workoutsResponse.data.values || []).map((row, index) => {
      const exerciseId = parseInt(row[1]);
      const exerciseRow = (exercisesResponse.data.values || []).find(e => e[0] == exerciseId);
      return {
        id: parseInt(row[0]) || index + 1,
        exercise_id: exerciseId,
        weight: parseFloat(row[2]) || 0,
        sets: parseInt(row[3]) || 0,
        reps: parseInt(row[4]) || 0,
        rest_seconds: parseInt(row[5]) || 60,
        feeling: parseInt(row[6]) || 5,
        date: row[7] || new Date().toISOString().split('T')[0],
        exercise_name: exerciseRow ? exerciseRow[1] : 'Unbekannt',
        muscle_group: exerciseRow ? exerciseRow[2] : ''
      };
    });
    
    res.json(workouts);
  } catch (err) {
    console.error('❌ Fehler beim Laden der Workouts:', err);
    res.status(500).json({ error: 'Fehler beim Laden: ' + err.message });
  }
});

// Neues Workout hinzufügen
app.post('/api/workouts', authenticateJWT, async (req, res) => {
  const { exercise_id, weight, sets, reps, rest_seconds, feeling, date } = req.body;
  
  if (!req.user.googleAccessToken) {
    return res.status(400).json({ error: 'Für Datenspeicherung bitte mit Google anmelden' });
  }
  
  try {
    if (!req.user.spreadsheetId) {
      req.user.spreadsheetId = await createUserSpreadsheet(req.user.googleAccessToken, req.user.id);
    }
    
    const sheets = getSheetsClient(req.user.googleAccessToken);
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Workouts!A:A'
    });
    const nextId = (response.data.values?.length || 1);
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Workouts!A:I',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[nextId, exercise_id, weight, sets, reps, rest_seconds || 60, feeling || 5, date, new Date().toISOString()]]
      }
    });
    
    res.json({ id: nextId, exercise_id, weight, sets, reps, rest_seconds, feeling, date });
  } catch (err) {
    console.error('❌ Fehler beim Speichern:', err);
    res.status(500).json({ error: 'Fehler beim Speichern: ' + err.message });
  }
});

// Workout löschen
app.delete('/api/workouts/:id', authenticateJWT, async (req, res) => {
  if (!req.user.googleAccessToken) {
    return res.status(400).json({ error: 'Nur mit Google-Auth verfügbar' });
  }
  
  try {
    const sheets = getSheetsClient(req.user.googleAccessToken);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Workouts!A:I'
    });
    
    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] == req.params.id);
    
    if (rowIndex >= 0) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: req.user.spreadsheetId,
        range: `Workouts!A${rowIndex + 1}:I${rowIndex + 1}`
      });
    }
    
    res.json({ message: 'Workout gelöscht' });
  } catch (err) {
    console.error('❌ Fehler beim Löschen:', err);
    res.status(500).json({ error: 'Fehler beim Löschen: ' + err.message });
  }
});

// Statistiken abrufen
app.get('/api/stats', authenticateJWT, async (req, res) => {
  try {
    if (!req.user.googleAccessToken) {
      return res.json({ total_volume: 0, total_workouts: 0, total_exercises: 0, weekly_volume: 0 });
    }
    
    const sheets = getSheetsClient(req.user.googleAccessToken);
    
    const workoutsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Workouts!A2:I'
    });
    
    const exercisesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Exercises!A2:D'
    });
    
    const workouts = (workoutsResponse.data.values || []).map(row => ({
      weight: parseFloat(row[2]) || 0,
      sets: parseInt(row[3]) || 0,
      reps: parseInt(row[4]) || 0,
      date: row[7]
    }));
    
    const totalVolume = workouts.reduce((sum, w) => sum + (w.weight * w.sets * w.reps), 0);
    const totalWorkouts = workouts.length;
    const totalExercises = (exercisesResponse.data.values || []).length;
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weeklyVolume = workouts
      .filter(w => new Date(w.date) >= weekAgo)
      .reduce((sum, w) => sum + (w.weight * w.sets * w.reps), 0);
    
    res.json({
      total_volume: totalVolume,
      total_workouts: totalWorkouts,
      total_exercises: totalExercises,
      weekly_volume: weeklyVolume
    });
  } catch (err) {
    console.error('❌ Fehler beim Laden der Stats:', err);
    res.status(500).json({ error: 'Fehler beim Laden: ' + err.message });
  }
});

// Progress für eine Übung
app.get('/api/progress/:exercise_id', authenticateJWT, async (req, res) => {
  if (!req.user.googleAccessToken) {
    return res.json([]);
  }
  
  try {
    const sheets = getSheetsClient(req.user.googleAccessToken);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.spreadsheetId,
      range: 'Workouts!A2:I'
    });
    
    const rows = (response.data.values || [])
      .filter(row => row[1] == req.params.exercise_id)
      .map(row => ({
        date: row[7],
        weight: parseFloat(row[2]) || 0,
        sets: parseInt(row[3]) || 0,
        reps: parseInt(row[4]) || 0,
        volume: (parseFloat(row[2]) || 0) * (parseInt(row[3]) || 0) * (parseInt(row[4]) || 0)
      }));
    
    res.json(rows);
  } catch (err) {
    console.error('❌ Fehler beim Laden des Progress:', err);
    res.status(500).json({ error: 'Fehler beim Laden: ' + err.message });
  }
});

// Spreadsheet Info
app.get('/api/sheet-info', authenticateJWT, (req, res) => {
  if (req.user.spreadsheetId) {
    res.json({ 
      spreadsheetId: req.user.spreadsheetId,
      url: `https://docs.google.com/spreadsheets/d/${req.user.spreadsheetId}/edit`
    });
  } else {
    res.status(404).json({ error: 'Kein Spreadsheet vorhanden' });
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
  console.log(`📈 Speicher: Google Sheets`);
});

module.exports = app;
