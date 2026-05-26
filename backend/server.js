const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;
const http = require('http'); // Import http module
const mysql = require('mysql2');
const cors = require('cors');
const session = require('express-session');
const { Server } = require('socket.io'); // Import Socket.IO Server
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const SALT_ROUNDS = 10;

const app = express();
app.set('trust proxy', 1); // Required for secure cookies/sessions on Render/Vercel

// ── Middleware order matters: cors → json → session → passport ──────────────
const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5000'].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
console.log('CORS: Configured for production and local development');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
// Passport MUST come after session()
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

// Prevent startup crash if OAuth credentials are missing
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || "/auth/google/callback"
    },
    function(accessToken, refreshToken, profile, done) {
      return done(null, profile);
    }
  ));
} else {
  console.warn('⚠️ Google OAuth credentials missing. Google login disabled.');
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(new GitHubStrategy({
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.GITHUB_CALLBACK_URL || "/auth/github/callback"
    },
    function(accessToken, refreshToken, profile, done) {
      return done(null, profile);
    }
  ));
}
// Serve Socket.IO client library
app.use('/socket.io', express.static(__dirname + '/node_modules/socket.io-client/dist'));

const localFrontendPath = path.join(__dirname, '..', 'frontend');
const publicPath = path.join(__dirname, 'public');
const finalStaticPath = fs.existsSync(publicPath) ? publicPath : (fs.existsSync(localFrontendPath) ? localFrontendPath : __dirname);

app.use(express.static(finalStaticPath));

// Root route — serve index or pro.html
app.get('/', (req, res) => {
  const tryFiles = ['index.html', 'pro.html'];
  for (const f of tryFiles) {
    const full = path.join(finalStaticPath, f);
    if (fs.existsSync(full)) return res.sendFile(full);
  }
  res.send('DataSpark Technologies — server is running ✅');
});

const server = http.createServer(app); // Create HTTP server
const io = new Server(server, { // Initialize Socket.IO
  cors: { 
    origin: allowedOrigins, 
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

function sendEnrollmentMail(toEmail, studentName, courseName) {
  const mailOptions = {
    from: `DATA SPARK TECHNOLOGIES <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Welcome to Data Spark Technologies! 🎉',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1e3a5f,#2c5282);padding:30px;text-align:center;">
          <h1 style="color:#00d4c2;margin:0;font-size:1.6rem;">DATA SPARK TECHNOLOGIES</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;">Your Learning Journey Begins!</p>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1e293b;">Hi ${studentName}! 👋</h2>
          <p style="color:#475569;line-height:1.8;">Thank you for enrolling with <strong>Data Spark Technologies</strong>. We are thrilled to have you on board!</p>
          <div style="background:#f0f4ff;border-left:4px solid #667eea;border-radius:8px;padding:16px 20px;margin:20px 0;">
            <p style="margin:0;color:#1e293b;"><strong>📚 Course Enrolled:</strong> ${courseName}</p>
          </div>
          <p style="color:#475569;line-height:1.8;">Our team will review your application and get back to you shortly. You can track your enrollment status anytime from your <strong>Student Dashboard</strong>.</p>
          <p style="color:#475569;line-height:1.8;">If you have any questions, feel free to reply to this email.</p>
          <p style="color:#475569;margin-top:24px;">Best Regards,<br><strong style="color:#1e293b;">Data Spark Technologies Team</strong></p>
        </div>
        <div style="background:#f8fafc;padding:16px;text-align:center;font-size:0.8rem;color:#94a3b8;">
          © 2024 Data Spark Technologies. All rights reserved.
        </div>
      </div>
    `
  };
  transporter.sendMail(mailOptions, (err) => {
    if (err) console.error('Mail error:', err.message);
  });
}

// Login attempt tracker
const loginAttempts = {};
const MAX_LOGIN_ATTEMPTS = 3;
const LOCKOUT_TIME_MS = 20 * 1000; // 20 seconds lockout after 3 failed attempts


function sendSecurityAlertMail(toEmail, username, attemptCount) {
  const mailOptions = {
    from: `DATA SPARK TECHNOLOGIES <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: '⚠️ Security Alert - Multiple Failed Login Attempts',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#dc2626,#ef4444);padding:30px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:1.6rem;">⚠️ Security Alert</h1>
          <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;">DATA SPARK TECHNOLOGIES</p>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1e293b;">Hi ${username}! 👋</h2>
          <p style="color:#475569;line-height:1.8;">We detected <strong>${attemptCount} failed login attempts</strong> on your account.</p>
          <div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:8px;padding:16px 20px;margin:20px 0;">
            <p style="margin:0;color:#dc2626;"><strong>🔐 Account:</strong> ${username}</p>
            <p style="margin:8px 0 0;color:#dc2626;"><strong>⏰ Time:</strong> ${new Date().toLocaleString('en-IN')}</p>
            <p style="margin:8px 0 0;color:#dc2626;"><strong>🔢 Failed Attempts:</strong> ${attemptCount}</p>
          </div>
          <p style="color:#475569;line-height:1.8;">If this was you, please make sure you are using the correct password.</p>
          <p style="color:#475569;line-height:1.8;">If this was <strong>NOT you</strong>, your account may be at risk. Please contact us immediately.</p>
          <div style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:8px;padding:16px 20px;margin:20px 0;">
            <p style="margin:0;color:#16a34a;"><strong>✅ What to do:</strong></p>
            <p style="margin:8px 0 0;color:#475569;">• Change your password immediately</p>
            <p style="margin:4px 0 0;color:#475569;">• Contact us at ${process.env.EMAIL_USER}</p>
          </div>
          <p style="color:#475569;margin-top:24px;">Best Regards,<br><strong style="color:#1e293b;">Data Spark Technologies Security Team</strong></p>
        </div>
        <div style="background:#f8fafc;padding:16px;text-align:center;font-size:0.8rem;color:#94a3b8;">
          © 2026 Data Spark Technologies. All rights reserved.
        </div>
      </div>
    `
  };
  transporter.sendMail(mailOptions, (err) => {
    if (err) console.error('Security alert mail error:', err.message);
    else console.log('Security alert sent to', toEmail);
  });
}

const otpStore = {};

// Socket tracking maps
const userSocketMap = new Map();
const adminSockets = new Set();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sendOTPMail(toEmail, otp) {
  const mailOptions = {
    from: `DATA SPARK TECHNOLOGIES <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Your OTP - DATA SPARK TECHNOLOGIES',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1e3a5f,#2c5282);padding:30px;text-align:center;">
          <h1 style="color:#00d4c2;margin:0;font-size:1.6rem;">DATA SPARK TECHNOLOGIES</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;">OTP Verification</p>
        </div>
        <div style="padding:32px;text-align:center;">
          <p style="color:#475569;font-size:1rem;">Your One-Time Password is:</p>
          <div style="background:#f0f4ff;border:2px dashed #667eea;border-radius:12px;padding:20px;margin:20px auto;display:inline-block;">
            <h2 style="color:#1a56ff;font-size:2.5rem;letter-spacing:10px;margin:0;">${otp}</h2>
          </div>
          <p style="color:#94a3b8;font-size:0.85rem;">Valid for <strong>5 minutes</strong>. Do not share this OTP.</p>
        </div>
        <div style="background:#f8fafc;padding:16px;text-align:center;font-size:0.8rem;color:#94a3b8;">
          © 2026 Data Spark Technologies. All rights reserved.
        </div>
      </div>
    `
  };
  return transporter.sendMail(mailOptions);
}

// Send OTP Route
app.post('/send-otp', (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, message: 'Email required' });
  const otp = generateOTP();
  otpStore[email] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 };
  console.log('Sending OTP', otp, 'to', email);
  sendOTPMail(email, otp)
    .then(() => {
      console.log('OTP mail sent successfully to', email);
      res.json({ success: true, message: 'OTP sent to ' + email });
    })
    .catch(err => {
      console.error('OTP mail error:', err.message);
      res.json({ success: false, message: err.message });
    });
});

// Verify OTP Route
app.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  const record = otpStore[email];
  if (!record) return res.json({ success: false, message: 'OTP not found. Please request again.' });
  if (Date.now() > record.expiresAt) {
    delete otpStore[email];
    return res.json({ success: false, message: 'OTP expired. Please request again.' });
  }
  if (record.otp !== otp) return res.json({ success: false, message: 'Invalid OTP. Please try again.' });
  delete otpStore[email];
  res.json({ success: true, message: 'OTP verified successfully!' });
});

function sendContactMail(toEmail, firstName, lastName, interestedCourse) {
  const mailOptions = {
    from: `DATA SPARK TECHNOLOGIES <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Thank You for Contacting Data Spark Technologies! 💬',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1e3a5f,#2c5282);padding:30px;text-align:center;">
          <h1 style="color:#00d4c2;margin:0;font-size:1.6rem;">DATA SPARK TECHNOLOGIES</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;">We Received Your Message!</p>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1e293b;">Hi ${firstName} ${lastName}! 👋</h2>
          <p style="color:#475569;line-height:1.8;">Thank you for reaching out to <strong>Data Spark Technologies</strong>. We have received your message and our team will get back to you shortly.</p>
          <div style="background:#f0f4ff;border-left:4px solid #667eea;border-radius:8px;padding:16px 20px;margin:20px 0;">
            <p style="margin:0;color:#1e293b;"><strong>💡 Interested Course:</strong> ${interestedCourse}</p>
          </div>
          <p style="color:#475569;line-height:1.8;">In the meantime, feel free to explore our courses and programs on our website.</p>
          <p style="color:#475569;line-height:1.8;">If you have any urgent queries, you can reply to this email directly.</p>
          <p style="color:#475569;margin-top:24px;">Best Regards,<br><strong style="color:#1e293b;">Data Spark Technologies Team</strong></p>
        </div>
        <div style="background:#f8fafc;padding:16px;text-align:center;font-size:0.8rem;color:#94a3b8;">
          © 2024 Data Spark Technologies. All rights reserved.
        </div>
      </div>
    `
  };
  transporter.sendMail(mailOptions, (err) => {
    if (err) console.error('Contact mail error:', err.message);
  });
}

// ── DATABASE ─────────────────────────────────────────────────────────────────
// Uses environment variables for Railway / PlanetScale / any remote MySQL.

// ── DATABASE ─────────────────────────────────────────────────────────────────
// Supports both DB_HOST style (set in Render) and MYSQLHOST style (Railway auto-inject)

const dbConfig = {
  host:     process.env.DB_HOST     || process.env.MYSQLHOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || process.env.MYSQLPORT || '3306', 10),
  user:     process.env.DB_USER     || process.env.MYSQLUSER     || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || 'root',
  database: process.env.DB_NAME     || process.env.MYSQLDATABASE || 'DataSpark',
  waitForConnections: true,
  multipleStatements: false
};

// Add SSL for any non-localhost host (required by Railway/PlanetScale)
const dbHost = dbConfig.host;
if (dbHost && dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
  dbConfig.ssl = { rejectUnauthorized: false };
}

const db = mysql.createPool(dbConfig);
const dbQuery = (sql, params, cb) => {
  db.getConnection((connErr, conn) => {
    if (connErr) { console.error('DB getConnection error:', connErr.message); return cb && cb(connErr); }
    conn.query(sql, params, (err, results) => {
      conn.release();
      if (cb) cb(err, results);
    });
  });
};

// Patch: make db.query use the pool (keeps rest of code unchanged)
db.query = dbQuery;

db.getConnection((err, conn) => {
  if (err) { console.error('❌ DB connection failed:', err.message); return; }
  console.log('✅ MySQL connected to', dbConfig.host);
  conn.release();
});

// ── Auto-create tables on startup ──────────────────────────────────────────
db.query(`CREATE TABLE IF NOT EXISTS courses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    category VARCHAR(100),
    duration VARCHAR(50),
    level VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (schemaErr) => {
    if (schemaErr) console.error('Error ensuring courses table exists:', schemaErr.message);
  });

  db.query(`CREATE TABLE IF NOT EXISTS chatbot_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_query TEXT NOT NULL,
    user_name VARCHAR(255),
    conversation_key VARCHAR(120), -- New column for consistent chat routing
    user_email VARCHAR(255),
    admin_reply TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (schemaErr) => {
    if (schemaErr) console.error('Error ensuring chatbot_messages table exists:', schemaErr.message);
  });

  db.query(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_key VARCHAR(120) NOT NULL,
    user_id INT NULL,
    sender_role ENUM('student','admin') NOT NULL,
    sender_name VARCHAR(255),
    sender_avatar VARCHAR(255),
    message TEXT,
    message_type ENUM('text', 'file') DEFAULT 'text',
    file_data LONGTEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_conversation_key (conversation_key),
    INDEX idx_user_id (user_id), 
    INDEX idx_sender_role (sender_role)
  )`, (schemaErr) => {
    if (schemaErr) console.error('Error ensuring chat_messages table exists:', schemaErr.message);
  });

  db.query(`CREATE TABLE IF NOT EXISTS chat_conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_key VARCHAR(120) NOT NULL UNIQUE,
    user_id INT NULL,
    user_name VARCHAR(255),
    user_email VARCHAR(255),
    user_avatar VARCHAR(255),
    online BOOLEAN DEFAULT FALSE,
    last_message TEXT,
    last_sender_role ENUM('student','admin') DEFAULT 'student',
    unread_count INT DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_chat_online (online),
    INDEX idx_chat_last_updated (last_updated)
  )`, (schemaErr) => {
    if (schemaErr) console.error('Error ensuring chat_conversations table exists:', schemaErr.message);
  });

  db.query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) DEFAULT NULL,
    password VARCHAR(255) DEFAULT NULL,
    role VARCHAR(80) DEFAULT 'Student',
    profile_image VARCHAR(255) DEFAULT NULL,
    last_login DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (schemaErr) => {
    if (schemaErr) console.error('Error ensuring users table exists:', schemaErr.message);
  });

  db.query(`CREATE TABLE IF NOT EXISTS contacts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    interested_course VARCHAR(255),
    message TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (schemaErr) => {
    if (schemaErr) console.error('Error ensuring contacts table exists:', schemaErr.message);
  });

  db.query(`CREATE TABLE IF NOT EXISTS applications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ref_number VARCHAR(255),
    full_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    dob DATE,
    gender VARCHAR(50),
    address TEXT,
    qualification VARCHAR(255),
    specialization VARCHAR(255),
    year_passing VARCHAR(50),
    current_status VARCHAR(80),
    course VARCHAR(255),
    batch VARCHAR(100),
    mode VARCHAR(100),
    source VARCHAR(255),
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (schemaErr) => {
    if (schemaErr) console.error('Error ensuring applications table exists:', schemaErr.message);
  });

  db.query(`CREATE TABLE IF NOT EXISTS completion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255),
    course_name VARCHAR(255),
    status VARCHAR(80),
    completed_at DATETIME NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_username_course (username, course_name)
  )`, (schemaErr) => {
    if (schemaErr) console.error('Error ensuring completion table exists:', schemaErr.message);
  });

  const requiredUserColumns = ['email', 'profile_image', 'last_login', 'created_at'];
  requiredUserColumns.forEach(column => {
    db.query(`SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`, [column], (schemaErr, rows) => {
      if (schemaErr) { console.error(`Error checking users.${column} existence:`, schemaErr.message); return; }
      if (rows && rows[0] && rows[0].count === 0) {
        let alterSql = '';
        if (column === 'email') alterSql = 'ALTER TABLE users ADD COLUMN email VARCHAR(255) DEFAULT NULL';
        if (column === 'profile_image') alterSql = 'ALTER TABLE users ADD COLUMN profile_image VARCHAR(255) DEFAULT NULL';
        if (column === 'last_login') alterSql = 'ALTER TABLE users ADD COLUMN last_login DATETIME DEFAULT NULL';
        if (column === 'created_at') alterSql = 'ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP';
        db.query(alterSql, (alterErr) => {
          if (alterErr) console.error(`Error adding users.${column} column:`, alterErr.message);
        });
      }
    });
  });

  db.query(
    "SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_login'",
    (schemaErr, rows) => {
      if (schemaErr) {
        console.error('Error checking users.last_login existence:', schemaErr.message);
        return;
      }
      if (rows && rows[0] && rows[0].count === 0) {
        db.query('ALTER TABLE users ADD COLUMN last_login DATETIME NULL', (alterErr) => {
          if (alterErr) console.error('Error adding users.last_login column:', alterErr.message);
        });
      }
    }
  );

app.post('/signup', (req, res) => {
  const { username, password, role, email } = req.body;
  if (!username || !password || !role)
    return res.json({ success: false, message: 'All fields required' });

  bcrypt.hash(password, SALT_ROUNDS, (err, hashedPassword) => {
    if (err) return res.json({ success: false, message: err.message });

    db.query('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username], (err, rows) => {
      if (err) return res.json({ success: false, message: err.message });

      if (rows.length > 0) {
        return res.json({ success: false, message: 'Username already exists!' });
      }

      db.query('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
        [username, email || null, hashedPassword, role],
        (err, result) => {
          if (err) return res.json({ success: false, message: err.message });
          req.session.user = { id: result.insertId, username, email: email || '', role };
          res.json({ success: true, message: 'Registered successfully', user: username, role, email: email || '' });
        });
    });
  });
});

app.post('/login', (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password)
    return res.json({ success: false, message: 'All fields required' });

  const now = Date.now();
  const key = String(username).toLowerCase();
  const loginAttempt = loginAttempts[key] || { count: 0, lockoutUntil: 0 };

  if (loginAttempt.lockoutUntil && now < loginAttempt.lockoutUntil) {
    const remainingSec = Math.ceil((loginAttempt.lockoutUntil - now) / 1000);
    return res.json({
      success: false,
      message: `Too many failed login attempts. Try again after ${remainingSec} seconds.`
    });
  }

  db.query('SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1', [username], (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    if (rows.length === 0) {
      loginAttempt.count = (loginAttempt.count || 0) + 1;
      if (loginAttempt.count >= MAX_LOGIN_ATTEMPTS && !loginAttempt.lockoutUntil) {
        loginAttempt.lockoutUntil = now + LOCKOUT_TIME_MS;
      }
      loginAttempts[key] = loginAttempt;
      return res.json({ success: false, message: 'Invalid username or password' });
    }

    bcrypt.compare(password, rows[0].password, (err, match) => {
      if (err) return res.json({ success: false, message: err.message });

      if (!match) {
        loginAttempt.count = (loginAttempt.count || 0) + 1;
        if (loginAttempt.count === MAX_LOGIN_ATTEMPTS) {
          const enteredEmail = (email || '').trim();
          const toEmail = enteredEmail || rows[0].email || process.env.EMAIL_USER;
          sendSecurityAlertMail(toEmail, rows[0].username || username, loginAttempt.count);
        }
        if (loginAttempt.count >= MAX_LOGIN_ATTEMPTS && !loginAttempt.lockoutUntil) {
          loginAttempt.lockoutUntil = now + LOCKOUT_TIME_MS;
        }
        loginAttempts[key] = loginAttempt;
        return res.json({ success: false, message: 'Invalid username or password' });
      }

      delete loginAttempts[key];
      req.session.user = {
        id: rows[0].id,
        username: rows[0].username,
        email: rows[0].email,
        role: rows[0].role
      };

      db.query('UPDATE users SET last_login = NOW(), email = COALESCE(NULLIF(?,""), email) WHERE id = ?', [email || null, rows[0].id], (err) => {
        if (err) console.error('Error updating last_login or email:', err.message);
      });

      res.json({
        success: true,
        user: rows[0].username,
        full_name: rows[0].username,
        role: rows[0].role,
        email: rows[0].email || ''
      });
    });
  });
});


app.delete('/reset-user/:username', (req, res) => {
  db.query('DELETE FROM users WHERE username = ?', [req.params.username], (err) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, message: 'User deleted. You can sign up again.' });
  });
});

app.post('/apply', (req, res) => {
  const { ref_number, full_name, email, phone, dob, gender, address,
    qualification, specialization, year_passing, current_status,
    course, batch, mode, source, message } = req.body;
  db.query('SELECT id FROM applications WHERE (LOWER(full_name) = LOWER(?) OR LOWER(email) = LOWER(?)) AND course = ?',
    [full_name, email, course],
    (err, rows) => {
      if (err) return res.json({ success: false, message: err.message });
      if (rows.length > 0) return res.json({ success: false, message: 'You are already enrolled in ' + course + '!' });
      db.query(
        `INSERT INTO applications 
         (ref_number, full_name, email, phone, dob, gender, address, qualification,
          specialization, year_passing, current_status, course, batch, mode, source, message)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [ref_number, full_name, email, phone, dob || null, gender, address, qualification,
         specialization, year_passing, current_status, course, batch, mode, source, message],
        (err) => {
          if (err) return res.json({ success: false, message: err.message });
          if (email) sendEnrollmentMail(email, full_name, course);
          res.json({ success: true, message: 'Application submitted!' });
        });
    });
});

app.get('/enrollment/:username', (req, res) => {
  db.query('SELECT u.username, u.role, a.* FROM users u LEFT JOIN applications a ON LOWER(u.username) = LOWER(a.full_name) WHERE LOWER(u.username) = LOWER(?) ORDER BY a.id DESC',
    [req.params.username],
    (err, rows) => {
      if (err) return res.json({ success: false, message: err.message });
      if (rows.length === 0 || !rows[0].course) return res.json({ success: false, message: 'No enrollment found' });
      res.json({ success: true, enrollment: rows[0], enrollments: rows, total: rows.length });
    });
});

app.get('/progress/:username', (req, res) => {
  db.query('SELECT username, course_name, module_index AS week_number FROM progress WHERE LOWER(username) = LOWER(?)', [req.params.username], (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, progress: rows });
  });
});

app.post('/progress', (req, res) => {
  const { username, course_name, week_number } = req.body;
  if (!username || !course_name || !week_number)
    return res.json({ success: false, message: 'Missing fields' });
  db.query(
    'INSERT IGNORE INTO progress (username, course_name, module_index) VALUES (LOWER(?), ?, ?)',
    [username, course_name, week_number],
    (err) => {
      if (err) return res.json({ success: false, message: err.message });
      db.query(
        'SELECT COUNT(DISTINCT module_index) as cnt FROM progress WHERE LOWER(username) = LOWER(?) AND course_name = ?',
        [username, course_name],
        (err, rows) => {
          if (err) return res.json({ success: true });
          const count = rows[0].cnt;
          const status = count >= 6 ? 'completed' : 'pending';
          const completedAt = count >= 6 ? new Date() : null;
          db.query(
            'INSERT INTO completion (username, course_name, status, completed_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status), completed_at = VALUES(completed_at)',
            [username, course_name, status, completedAt],
            () => res.json({ success: true, saved: true, week: week_number })
          );
        }
      );
    }
  );
});

app.post('/contact', (req, res) => {
  const { first_name, last_name, email, phone, interested_course, message } = req.body;
  db.query(
    'INSERT INTO contacts (first_name, last_name, email, phone, interested_course, message) VALUES (?,?,?,?,?,?)',
    [first_name, last_name, email, phone, interested_course, message],
    (err) => {
      if (err) return res.json({ success: false, message: err.message });
      if (email) sendContactMail(email, first_name, last_name, interested_course);
      res.json({ success: true, message: 'Message sent!' });
    });
});

// Admin endpoints
app.get('/admin/students-count', requireAdmin, (req, res) => {
  // Count distinct enrolled students (applications with a non-empty course)
  db.query(
    "SELECT COUNT(DISTINCT full_name) AS cnt FROM applications WHERE course IS NOT NULL AND course <> ''",
    (err, rows) => {
      if (err) return res.json({ success: false, message: err.message });
      const cnt = rows && rows[0] ? rows[0].cnt : 0;
      res.json({ success: true, enrolledStudents: cnt });
    }
  );
});

app.get('/admin/contacts', requireAdmin, (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const like = `%${q}%`;

  // Simple search across name/email/message/course
  const sql =
    "SELECT id, first_name, last_name, email, phone, interested_course, message, sent_at FROM contacts " +
    (q ? "WHERE (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR interested_course LIKE ? OR message LIKE ?) " : "") +
    "ORDER BY sent_at DESC" +
    " LIMIT 500";

  const params = q ? [like, like, like, like, like, like] : [];

  db.query(sql, params, (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, contacts: rows || [] });
  });
});

// --- Admin dashboard APIs ---
// Course Applications & Contact Messages for admin.html
// NOTE: This project currently stores both course and (potential) internship applications inside the `applications` table.
// Since no explicit internship type is implemented in backend code, Course Applications are treated as rows
// where `course` is NOT NULL/empty.

// GET: Course applications list
app.get('/api/admin/course-applications', requireAdmin, (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const status = (req.query.status || '').toString().trim().toLowerCase();
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);
  const offset = (page - 1) * limit;

  // status dropdown values in UI are: Pending | Approved | Rejected
  // Map them to current_status values in DB.
  // If DB uses lowercase, we normalize.
  const statusMap = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    // common lowercase variants
    'pending ': 'Pending'
  };

  let mappedStatus = '';
  if (status) {
    if (status === 'pending') mappedStatus = 'Pending';
    else if (status === 'approved') mappedStatus = 'Approved';
    else if (status === 'rejected') mappedStatus = 'Rejected';
    else mappedStatus = req.query.status; // fallback
  }

  const conditions = ["course IS NOT NULL", "course <> ''"];
  const params = [];

  if (mappedStatus) {
    conditions.push('current_status = ?');
    params.push(mappedStatus);
  }

  if (q) {
    const like = `%${q}%`;
    conditions.push(
      '(full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR course LIKE ? OR batch LIKE ? OR qualification LIKE ? OR specialization LIKE ?)' +
      ''
    );
    params.push(like, like, like, like, like, like, like);
  }

  const sql =
    'SELECT id, ref_number, full_name, email, phone, dob, gender, current_status, course, batch, mode, source, message, qualification, specialization, year_passing ' +
    'FROM applications ' +
    'WHERE ' + conditions.join(' AND ') +
    ' ORDER BY id DESC ' +
    ' LIMIT ? OFFSET ?';

  params.push(limit, offset);


  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching course applications:', err);
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true, applications: rows || [], page, limit });
  });
});

// GET: Course applications with enrollment details (student status from users table)
app.get('/api/admin/course-applications-with-enrollment', requireAdmin, (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const status = (req.query.status || '').toString().trim().toLowerCase();
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);
  const offset = (page - 1) * limit;

  let mappedStatus = '';
  if (status) {
    if (status === 'pending') mappedStatus = 'Pending';
    else if (status === 'approved') mappedStatus = 'Approved';
    else if (status === 'rejected') mappedStatus = 'Rejected';
    else mappedStatus = req.query.status;
  }

  const conditions = ["a.course IS NOT NULL", "a.course <> ''"];
  const params = [];

  if (mappedStatus) {
    conditions.push('a.current_status = ?');
    params.push(mappedStatus);
  }

  if (q) {
    const like = `%${q}%`;
    conditions.push(
      '(a.full_name LIKE ? OR a.email LIKE ? OR a.phone LIKE ? OR a.course LIKE ? OR a.batch LIKE ?)' 
    );
    params.push(like, like, like, like, like);
  }

  const sql =
    `SELECT a.id, a.ref_number, a.full_name, a.email, a.phone, a.dob, a.gender, a.current_status, a.course, a.batch, a.mode, a.source, a.message, a.qualification, a.specialization, a.year_passing,
            u.username, u.role, u.last_login, u.created_at as student_registered_at
     FROM applications a
     LEFT JOIN users u ON LOWER(a.full_name) = LOWER(u.username)
     WHERE ` + conditions.join(' AND ') +
    ` ORDER BY a.id DESC 
     LIMIT ? OFFSET ?`;

  params.push(limit, offset);

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching course applications with enrollment:', err);
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true, applications: rows || [], page, limit });
  });
});

// PATCH: update application status
app.patch('/api/admin/course-applications/:id/status', requireAdmin, (req, res) => {
  const id = req.params.id;
  const nextStatus = (req.body.status || '').toString().trim();

  if (!nextStatus) {
    return res.json({ success: false, message: 'Status is required.' });
  }

  const normalized = nextStatus.toLowerCase();
  let mapped = nextStatus;
  if (normalized === 'pending') mapped = 'Pending';
  else if (normalized === 'approved') mapped = 'Approved';
  else if (normalized === 'rejected') mapped = 'Rejected';

  db.query('UPDATE applications SET current_status = ? WHERE id = ? AND course IS NOT NULL AND course <> ?', [mapped, id, ''], (err, result) => {
    if (err) {
      console.error('Error updating application status:', err);
      return res.json({ success: false, message: err.message });
    }
    if (!result || result.affectedRows === 0) {
      return res.json({ success: false, message: 'Application not found.' });
    }
    res.json({ success: true, message: 'Status updated.' });
  });
});

// GET: All registered students from user table with email from applications
app.get('/api/admin/students', requireAdmin, (req, res) => {
  const q = (req.query.q || '').toString().trim(); // Get search query
  const params = [];
  const conditions = ["(LOWER(IFNULL(role, 'Student')) NOT LIKE '%admin%')"];

  if (q) {
    conditions.push('(LOWER(username) LIKE ? OR LOWER(email) LIKE ?)');
    const likeParam = `%${q.toLowerCase()}%`;
    params.push(likeParam, likeParam);
  }

  const sql = `SELECT username, role, created_at, email FROM users WHERE ${conditions.join(' AND ')} ORDER BY id DESC`;

  db.query(sql, params, (err, rows) => {
    if (err) { console.error('Error fetching students:', err); return res.json({ success: false, message: err.message }); }
    res.json({ success: true, students: rows || [] });
  });
});

// GET: Students who have logged in (with last login timestamp)
app.get('/api/admin/students-logged-in', requireAdmin, (req, res) => {
  const q = (req.query.q || '').toString().trim(); // Get search query
  const params = [];
  const conditions = ["(LOWER(IFNULL(role, 'Student')) NOT LIKE '%admin%')", "last_login IS NOT NULL"];

  if (q) {
    conditions.push('(LOWER(username) LIKE ? OR LOWER(email) LIKE ?)');
    const likeParam = `%${q.toLowerCase()}%`;
    params.push(likeParam, likeParam);
  }

  const sql = `SELECT username, role, created_at, last_login, email FROM users WHERE ${conditions.join(' AND ')} ORDER BY last_login DESC`;

  db.query(sql, params, (err, rows) => {
    if (err) { console.error('Error fetching logged-in students:', err); return res.json({ success: false, message: err.message }); }
    res.json({ success: true, students: rows || [] });
  });
});

// GET: Contact messages (for admin dashboard cards)
app.get('/api/admin/messages', requireAdmin, (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const like = `%${q}%`;

  const conditions = [];
  const params = [];

  if (q) {
    conditions.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR interested_course LIKE ? OR message LIKE ?)');
    params.push(like, like, like, like, like);
  }

  const where = conditions.length ? ('WHERE ' + conditions.join(' AND ')) : '';

  const sql =
    'SELECT id, first_name, last_name, email, interested_course, message, sent_at FROM contacts ' +
    where +
    ' ORDER BY sent_at DESC LIMIT 500';

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching contact messages:', err);
      return res.json({ success: false, message: err.message });
    }

    const messages = (rows || []).map(r => ({
      id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
      email: r.email,
      subject: r.interested_course || '-', // mapping: subject = interested_course
      message: r.message,
      date: r.sent_at
    }));

    res.json({ success: true, messages });
  });
});
// GOOGLE LOGIN
app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login"
  }),
  (req, res) => {
    res.redirect("/dashboard");
  }
);

// GITHUB LOGIN
app.get("/auth/github",
  passport.authenticate("github", { scope: ["user:email"] })
);

app.get("/auth/github/callback",
  passport.authenticate("github", {
    failureRedirect: "/login"
  }),
  (req, res) => {
    res.redirect("/dashboard");
  }
);
// =============================================
// ADMIN APPLICATIONS
// =============================================
app.get('/api/admin/applications', requireAdmin, (req, res) => {

  db.query(
    `SELECT
      id,
      full_name,
      email,
      phone,
      course_name,
      city,
      created_at
     FROM applications
     ORDER BY id DESC`,
    (err, rows) => {

      if (err) {
        console.log(err);
        return res.json([]);
      }

      res.json(rows || []);

    }
  );

});

// =============================================
// CHAT USERS
// =============================================
app.get('/api/admin/chat-users', requireAdmin, (req, res) => {

  db.query(
    `SELECT DISTINCT
      conversation_key AS user_id,
      user_name AS name
     FROM chatbot_messages
     ORDER BY id DESC`,
    (err, rows) => {

      if (err) {
        console.log(err);
        return res.json([]);
      }

      res.json(rows || []);

    }
  );

});

// =============================================
// CHAT HISTORY
// =============================================
app.get('/api/admin/chat/:userId', requireAdmin, (req, res) => {

  const userId = req.params.userId;

  db.query(
    `SELECT
      user_query AS message,
      user_name,
      timestamp AS created_at,
      'user' AS sender
     FROM chatbot_messages
     WHERE conversation_key = ?
     ORDER BY timestamp ASC`,
    [userId],
    (err, rows) => {

      if (err) {
        console.log(err);
        return res.json([]);
      }

      res.json(rows || []);

    }
  );

});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const stats = {
    totalStudents: 0,
    courseApps: 0,
    totalEnrollments: 0,
    totalMessages: 0,
    activeChats: 0,
    unreadChatSessions: 0,
    completedPrograms: 0
  };

  db.query('SELECT COUNT(*) AS totalStudents FROM users WHERE LOWER(role) NOT LIKE ?',[ '%admin%' ], (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    stats.totalStudents = rows[0]?.totalStudents || 0;

    db.query('SELECT COUNT(*) AS courseApps FROM applications WHERE course IS NOT NULL AND course <> ""', (err, rows) => {
      if (err) return res.json({ success: false, message: err.message });
      stats.courseApps = rows[0]?.courseApps || 0;

      db.query('SELECT COUNT(*) AS totalEnrollments FROM applications WHERE current_status = ?', ['Approved'], (err, rows) => {
        if (err) return res.json({ success: false, message: err.message });
        stats.totalEnrollments = rows[0]?.totalEnrollments || 0;

        db.query('SELECT COUNT(*) AS totalMessages FROM contacts', (err, rows) => {
          if (err) return res.json({ success: false, message: err.message });
          stats.totalMessages = rows[0]?.totalMessages || 0;

          db.query('SELECT COUNT(*) AS activeChats FROM chat_conversations WHERE online = TRUE', (err, rows) => {
            if (err) return res.json({ success: false, message: err.message });
            stats.activeChats = rows[0]?.activeChats || 0;

            db.query('SELECT SUM(unread_count) AS unreadChatSessions FROM chat_conversations', (err, rows) => {
              if (err) return res.json({ success: false, message: err.message });
              stats.unreadChatSessions = rows[0]?.unreadChatSessions || 0;

              db.query('SELECT COUNT(*) AS completedPrograms FROM completion WHERE status = ?', ['completed'], (err, rows) => {
                if (err) return res.json({ success: false, message: err.message });
                stats.completedPrograms = rows[0]?.completedPrograms || 0;
                res.json({ success: true, ...stats });
              });
            });
          });
        });
      });
    });
  });
});

app.get('/api/admin/completion', requireAdmin, (req, res) => {
  db.query('SELECT username, course_name, status, completed_at FROM completion ORDER BY completed_at DESC LIMIT 200', (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, completions: rows || [] });
  });
});

app.get('/api/chat/sessions', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const params = [];
  let sql = `SELECT conversation_key, user_name, user_email, user_avatar, online, last_message, last_sender_role, unread_count, last_updated FROM chat_conversations`;
  if (q) {
    sql += ' WHERE conversation_key LIKE ? OR user_name LIKE ? OR last_message LIKE ?';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY last_updated DESC LIMIT 200';
  db.query(sql, params, (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    const sessions = (rows || []).map(row => ({
      session_id: row.conversation_key,
      user_name: row.user_name || row.conversation_key,
      user_email: row.user_email || null,
      user_avatar: row.user_avatar || (row.user_name ? row.user_name.charAt(0).toUpperCase() : 'S'),
      online: !!row.online,
      last_message: row.last_message || 'No messages yet',
      last_sender_role: row.last_sender_role || 'student',
      unread_count: row.unread_count || 0,
      last_updated: row.last_updated
    }));
    res.json(sessions);
  });
});

app.get('/api/chat/history/:sessionId', (req, res) => {
  const sessionId = (req.params.sessionId || '').toString().trim();
  if (!sessionId) return res.json({ success: false, message: 'Session id is required.' });
  db.query('SELECT sender_role, sender_name, sender_avatar, message, is_read, created_at FROM chat_messages WHERE conversation_key = ? ORDER BY created_at ASC', [sessionId], (err, rows) => {
    if (err) return res.json({ success: false, message: err.message }); 
    const history = (rows || []).map(r => ({
      sender: r.sender_role,
      user_name: r.sender_name,
      sender_avatar: r.sender_avatar,
      message: r.message,
      is_read: !!r.is_read,
      created_at: r.created_at
    }));
    res.json(history);
  });
});

app.post('/api/chat/mark-read/:sessionId', (req, res) => {
  const sessionId = (req.params.sessionId || '').toString().trim();
  if (!sessionId) return res.json({ success: false, message: 'Session id is required.' });
  db.query('UPDATE chat_messages SET is_read = TRUE WHERE conversation_key = ? AND sender_role = ?', [sessionId, 'student'], (err) => {
    if (err) return res.json({ success: false, message: err.message });
    db.query('UPDATE chat_conversations SET unread_count = 0 WHERE conversation_key = ?', [sessionId], (err) => {
      if (err) console.error('Error resetting unread count:', err);
      res.json({ success: true, message: 'Conversation marked as read.' });
    });
  });
});

// --- Chatbot Message Endpoints ---
// Note: You need to create the 'chatbot_messages' table in your DataSpark database.
// Example SQL:
// CREATE TABLE chatbot_messages (
//     id INT AUTO_INCREMENT PRIMARY KEY,
//     user_query TEXT NOT NULL,
//     user_name VARCHAR(255),
//     user_email VARCHAR(255),
//     timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
//     admin_reply TEXT,
//     is_read BOOLEAN DEFAULT FALSE
// );

// API to receive messages from chatbot (pro.html)
app.post('/chatbot-message', (req, res) => {
  const { user_query, user_name, user_email, conversation_key } = req.body;
  if (!user_query) {
    return res.json({ success: false, message: 'Message content is required.' });
  }

  // Step 1: Save to chatbot_messages (legacy table for analytics)
  db.query(
    'INSERT INTO chatbot_messages (user_query, user_name, user_email, conversation_key) VALUES (?, ?, ?, ?)',
    [user_query, user_name || null, user_email || null, conversation_key || null],
    (err, result) => {
      if (err) {
        console.error('Error saving chatbot message:', err);
        return res.json({ success: false, message: 'Failed to save message.' });
      }

      // Step 2: ALSO save to chat_messages (for admin live chat visibility)
      const convKey = conversation_key || 'chatbot_' + (user_email || user_name || 'guest');
      const senderName = user_name || 'User';

      db.query(
        'INSERT INTO chat_messages (conversation_key, sender_role, sender_name, message, is_read) VALUES (?, ?, ?, ?, ?)',
        [convKey, 'student', senderName, user_query, 0], // is_read = 0 (unread for admin)
        (err2) => {
          if (err2) console.error('Error syncing chatbot to chat_messages:', err2.message);

          // Step 3: Upsert conversation record
          db.query(
            `INSERT INTO chat_conversations (conversation_key, user_name, user_email, online, last_message, last_sender_role, unread_count, last_updated)
             VALUES (?, ?, ?, 1, ?, 'student', 1, NOW())
             ON DUPLICATE KEY UPDATE
               user_name = COALESCE(VALUES(user_name), user_name),
               user_email = COALESCE(VALUES(user_email), user_email),
               online = 1,
               last_message = VALUES(last_message),
               last_sender_role = 'student',
               unread_count = unread_count + 1,
               last_updated = NOW()`,
            [convKey, senderName, user_email || null, user_query],
            (err3) => {
              if (err3) console.error('Error updating chat_conversations:', err3.message);
              
              // Step 4: Broadcast updated conversation list to all admins
              broadcastConversationUpdates();
              
              res.json({ success: true, message: 'Message saved and synced.', message_id: result.insertId });
            }
          );
        }
      );
    }
  );
});

// New User API to get a specific chatbot message (for replies)
app.get('/user/chatbot-messages/:id', (req, res) => {
  const messageId = req.params.id;
  db.query('SELECT admin_reply, is_read FROM chatbot_messages WHERE id = ?', [messageId], (err, rows) => {
    if (err) {
      console.error('Error fetching user chatbot message:', err);
      return res.json({ success: false, message: 'Failed to fetch message.' });
    }
    if (rows.length === 0) {
      return res.json({ success: false, message: 'Message not found.' });
    }
    // Return the admin_reply and is_read status
    res.json({ success: true, admin_reply: rows[0].admin_reply, is_read: rows[0].is_read });
    }
  );
});

// Admin API to get chatbot messages
app.get('/admin/chatbot-messages', (req, res) => {
  const { read_status, q } = req.query; // read_status can be 'read', 'unread', or 'all'
  let query = 'SELECT id, user_query, user_name, user_email, conversation_key, admin_reply, is_read, timestamp FROM chatbot_messages';
  const params = [];
  const conditions = [];

  if (read_status === 'unread') {
    conditions.push('is_read = FALSE');
  } else if (read_status === 'read') {
    conditions.push('is_read = TRUE');
  }

  if (q) {
    conditions.push('(user_query LIKE ? OR user_name LIKE ? OR user_email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY timestamp DESC';

  db.query(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching chatbot messages:', err);
      return res.json({ success: false, message: 'Failed to fetch messages.' });
    }
    res.json({ success: true, messages: rows });
  });
});

// Admin API to reply to a chatbot message
app.post('/admin/chatbot-messages/:id/reply', (req, res) => {
  const { id } = req.params;
  const { reply } = req.body;
  if (!reply) return res.json({ success: false, message: 'Reply content is required.' });

  db.query('UPDATE chatbot_messages SET admin_reply = ?, is_read = TRUE WHERE id = ?', [reply, id], (err) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, message: 'Reply saved.' });
  });
});

// Admin API to mark a chatbot message as read
app.post('/admin/chatbot-messages/:id/mark-read', (req, res) => {
  const messageId = req.params.id;
  db.query('UPDATE chatbot_messages SET is_read = TRUE WHERE id = ?', [messageId], (err) => {
    if (err) { console.error('Error marking message as read:', err); return res.json({ success: false, message: 'Failed to mark message as read.' }); }
    res.json({ success: true, message: 'Message marked as read.' });
  });
});

// Admin API to get unread chatbot messages count
app.get('/admin/unread-chatbot-messages-count', (req, res) => {
  db.query('SELECT COUNT(*) AS count FROM chatbot_messages WHERE is_read = FALSE', (err, rows) => {
    if (err) { console.error('Error fetching unread count:', err); return res.json({ success: false, message: 'Failed to fetch unread count.' }); }
    res.json({ success: true, count: rows[0].count });
  });
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && typeof req.session.user.role === 'string' && req.session.user.role.toLowerCase().includes('admin')) {
    return next();
  }
  res.status(403).json({ success: false, message: 'Admin access required.' });
}

app.get('/api/auth/session', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ success: true, user: req.session.user });
  }
  res.json({ success: true, user: null });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: 'Logged out successfully.' });
  });
});

app.get('/api/admin/chat/conversations', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const params = [];
  let sql = `SELECT conversation_key, user_name, user_email, user_avatar, online, last_message, last_sender_role, unread_count, last_updated FROM chat_conversations`;
  if (q) {
    sql += ' WHERE conversation_key LIKE ? OR user_name LIKE ? OR last_message LIKE ?';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY last_updated DESC LIMIT 200';
  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching chat conversations:', err);
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true, conversations: rows.map(row => ({
      ...row,
      user_name: row.user_name || row.conversation_key,
      user_avatar: row.user_avatar || (row.user_name ? row.user_name.charAt(0).toUpperCase() : 'S'),
      last_message: row.last_message || 'No messages yet',
      online: !!row.online
    })) });
  });
});

app.get('/api/admin/chat/history', (req, res) => {
  const conversationKey = (req.query.conversationKey || '').toString().trim();
  if (!conversationKey) {
    return res.json({ success: false, message: 'Conversation key required' });
  }
  db.query('SELECT sender_role, sender_name, sender_avatar, message, is_read, created_at FROM chat_messages WHERE conversation_key = ? ORDER BY created_at ASC', [conversationKey], (err, rows) => {
    if (err) {
      console.error('Error loading conversation history:', err);
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true, messages: rows || [] });
  });
});

app.post('/api/admin/chat/mark-read', (req, res) => {
  const { conversationKey } = req.body;
  if (!conversationKey) {
    return res.json({ success: false, message: 'Conversation key required' });
  }
  db.query('UPDATE chat_messages SET is_read = TRUE WHERE conversation_key = ? AND sender_role = ?', [conversationKey, 'student'], (err) => {
    if (err) {
      console.error('Error marking chat as read:', err);
      return res.json({ success: false, message: err.message });
    }
    db.query('UPDATE chat_conversations SET unread_count = 0 WHERE conversation_key = ?', [conversationKey], (err) => {
      if (err) console.error('Error resetting unread count:', err);
      res.json({ success: true, message: 'Conversation marked as read.' });
    });
  });
});

app.post('/api/admin/chat/reply', (req, res) => {
  const { conversationKey, message } = req.body;
  if (!conversationKey || !message) {
    return res.json({ success: false, message: 'Conversation and message are required.' });
  }
  const adminName = req.session.user?.username || 'Admin';
  const adminAvatar = '👨‍💼';
  db.query('INSERT INTO chat_messages (conversation_key, sender_role, sender_name, sender_avatar, message, is_read) VALUES (?,?,?,?,?,TRUE)',
    [conversationKey, 'admin', adminName, adminAvatar, message],
    (err) => {
      if (err) {
        console.error('Error saving admin reply:', err);
        return res.json({ success: false, message: err.message });
      }
      db.query(
        `INSERT INTO chat_conversations (conversation_key, user_name, user_email, user_avatar, online, last_message, last_sender_role, last_updated, unread_count)
         VALUES (?, NULL, NULL, NULL, IFNULL((SELECT online FROM chat_conversations WHERE conversation_key = ?), FALSE), ?, 'admin', NOW(), IFNULL((SELECT unread_count FROM chat_conversations WHERE conversation_key = ?), 0))
         ON DUPLICATE KEY UPDATE
           last_message = VALUES(last_message),
           last_sender_role = VALUES(last_sender_role),
           last_updated = VALUES(last_updated)`,
        [conversationKey, conversationKey, message, conversationKey],
        (err) => {
          if (err) console.error('Error updating chat conversation after admin reply:', err);
          broadcastConversationUpdates();
          notifyUserReply(conversationKey, { sender_name: adminName, sender_avatar: adminAvatar, message });
          res.json({ success: true, message: 'Reply delivered.' });
        }
      );
    });
});

// Student API: pending admin replies for chatbot open
// Used by pro.html loadPendingReplies()
app.get('/api/user/pending-replies', (req, res) => {
  const username = (req.query.username || '').toString().trim();
  if (!username) return res.json({ success: true, replies: [] });

  // Minimal matching: by stored user_name OR user_email.
  const like = `%${username}%`;

  db.query(
    `SELECT id, admin_reply
     FROM chatbot_messages
     WHERE admin_reply IS NOT NULL
       AND admin_reply <> ''
       AND is_read = FALSE
       AND (user_name LIKE ? OR user_email LIKE ?)
     ORDER BY timestamp DESC
     LIMIT 50`,
    [like, like],
    (err, rows) => {
      if (err) {
        console.error('Error fetching pending replies:', err);
        return res.json({ success: false, message: 'Failed to fetch pending replies.' });
      }

      const replies = (rows || [])
        .filter(r => r.admin_reply)
        .map(r => ({ id: r.id, admin_reply: r.admin_reply }));

      res.json({ success: true, replies });
    }
  );
});

// --- Course Management Endpoints ---
// Note: You need to create the 'courses' table in your DataSpark database.
// Example SQL:
// CREATE TABLE courses (
//     id INT AUTO_INCREMENT PRIMARY KEY,
//     name VARCHAR(255) NOT NULL UNIQUE,
//     category VARCHAR(100),
//     duration VARCHAR(50),
//     level VARCHAR(50),
//     description TEXT,
//     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
// );

// Public API: get all courses (for cor.html)
app.get('/api/courses', (req, res) => {
  const { q, category } = req.query;
  let query = 'SELECT id, name, category, duration, level, description, created_at FROM courses';
  const params = [];
  const conditions = [];

  if (q) {
    conditions.push('(name LIKE ? OR category LIKE ? OR description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category && category !== 'all') {
    conditions.push('LOWER(category) = LOWER(?)');
    params.push(category);
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC';

  db.query(query, params, (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, courses: rows || [] });
  });
});

// Admin API to get all courses (with optional search)
app.get('/api/admin/courses', (req, res) => {
  const { q } = req.query;
  let query = 'SELECT * FROM courses';
  const params = [];
  const conditions = [];

  if (q) {
    conditions.push('(name LIKE ? OR category LIKE ? OR description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY name ASC';

  db.query(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching courses:', err);
      return res.json({ success: false, message: 'Failed to fetch courses.' });
    }
    res.json({ success: true, courses: rows });
  });
});

// Admin API to get progress per student + course (percentages out of 6)
// NOTE: This is an admin dashboard API; it does not modify any existing student behavior.
app.get('/api/admin/progress', (req, res) => {
  // Compute per student+course using progress.module_index rows.
  // percentage = min(completedWeeks, 6)/6*100 capped.
  const sql = `
    SELECT
      LOWER(p.username) AS username_key,
      p.course_name AS course_name,
      COUNT(*) AS completed_weeks
    FROM progress p
    WHERE p.course_name IS NOT NULL AND p.course_name <> ''
    GROUP BY LOWER(p.username), p.course_name
    ORDER BY completed_weeks DESC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error('Error fetching admin progress:', err);
      return res.json({ success: false, message: err.message });
    }

    const results = (rows || []).map(r => {
      const completedWeeksRaw = parseInt(r.completed_weeks, 10) || 0;
      const completedWeeks = Math.min(completedWeeksRaw, 6);
      const percentage = Math.min(Math.round((completedWeeks / 6) * 100), 100);
      return {
        student_name: r.username_key,
        course_name: r.course_name,
        completed_weeks: completedWeeks,
        percentage
      };
    });

    res.json({ success: true, progress: results });
  });
});

// Admin API to add a new course
app.post('/api/admin/courses', (req, res) => {
  const { name, category, duration, level, description } = req.body;
  if (!name || !category || !duration || !level || !description) {
    return res.json({ success: false, message: 'All course fields are required.' });
  }
  db.query(
    'INSERT INTO courses (name, category, duration, level, description) VALUES (?, ?, ?, ?, ?)',
    [name, category, duration, level, description],
    (err, result) => {
      if (err) {
        console.error('Error adding course:', err);
        if (err.code === 'ER_DUP_ENTRY') {
          return res.json({ success: false, message: 'Course with this name already exists.' });
        }
        return res.json({ success: false, message: 'Failed to add course.' });
      }
      res.json({ success: true, message: 'Course added successfully!', courseId: result.insertId });
    }
  );
});

// Admin API to delete a course
app.delete('/api/admin/courses/:id', (req, res) => {
  const courseId = req.params.id;
  db.query('DELETE FROM courses WHERE id = ?', [courseId], (err, result) => {
    if (err) {
      console.error('Error deleting course:', err);
      return res.json({ success: false, message: 'Failed to delete course.' });
    }
    if (result.affectedRows === 0) {
      return res.json({ success: false, message: 'Course not found.' });
    }
    res.json({ success: true, message: 'Course deleted successfully.' });
  });
});

// GET: Unread applications count (pending)
app.get('/api/admin/unread-applications-count', (req, res) => {
  db.query("SELECT COUNT(*) AS count FROM applications WHERE current_status = 'Pending' AND course IS NOT NULL AND course <> ''", (err, rows) => {
    if (err) {
      console.error('Error fetching unread applications count:', err);
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true, count: rows[0].count || 0 });
  });
});

function updateConversationRecord(conversationKey, meta, incrementUnread, callback) {
  if (!conversationKey) return callback && callback();
  const values = [
    conversationKey,
    meta.user_id || null,
    meta.user_name || null,
    meta.user_email || null,
    meta.user_avatar || null,
    meta.online ? 1 : 0,
    meta.last_message || null,
    meta.last_sender_role || 'student',
    conversationKey,
    meta.last_message || null,
    meta.last_sender_role || 'student',
    meta.online ? 1 : 0
  ];
  const sql = `INSERT INTO chat_conversations
      (conversation_key, user_id, user_name, user_email, user_avatar, online, last_message, last_sender_role, unread_count, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        user_name = COALESCE(VALUES(user_name), user_name),
        user_email = COALESCE(VALUES(user_email), user_email),
        user_avatar = COALESCE(VALUES(user_avatar), user_avatar),
        online = VALUES(online),
        last_message = COALESCE(VALUES(last_message), last_message),
        last_sender_role = VALUES(last_sender_role),
        last_updated = NOW(),
        unread_count = unread_count + ?`;
  db.query(sql, [...values, incrementUnread ? 1 : 0], (err) => {
    if (err) console.error('Error updating conversation record:', err);
    if (callback) callback(err);
  });
}

function loadChatHistory(conversationKey, callback) {
  if (!conversationKey) return callback(null, []);
  db.query('SELECT sender_role, sender_name, sender_avatar, message, is_read, created_at FROM chat_messages WHERE conversation_key = ? ORDER BY created_at ASC', [conversationKey], (err, rows) => {
    if (err) {
      console.error('Error loading chat history:', err); 
      return callback(err, []);
    }
    callback(null, rows || []);
  });
}

function broadcastConversationUpdates() {
  db.query('SELECT conversation_key, user_name, user_email, user_avatar, online, last_message, last_sender_role, unread_count, last_updated FROM chat_conversations ORDER BY last_updated DESC LIMIT 200', (err, rows) => {
    if (err) {
      return console.error('Error broadcasting conversation updates:', err);
    }
    const payload = (rows || []).map(row => ({
      ...row,
      user_name: row.user_name || row.conversation_key,
      user_avatar: row.user_avatar || (row.user_name ? row.user_name.charAt(0).toUpperCase() : 'S'),
      last_message: row.last_message || 'No messages yet',
      online: !!row.online
    }));
    adminSockets.forEach(id => io.to(id).emit('conversation_list', payload));
  });
}

function notifyUserReply(conversationKey, payload) {
  const userSocketId = userSocketMap.get(conversationKey);
  if (userSocketId) {
    io.to(userSocketId).emit('receive_msg', {
      from: 'admin',
      msg: payload.message,
      name: payload.sender_name,
      avatar: payload.sender_avatar,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  }
}


// ═══════════════════════════════════════════════════════
//  SOCKET.IO — Single source of truth
//  Table used: chat_messages + chat_conversations
// ═══════════════════════════════════════════════════════
io.on('connection', (socket) => {

  // ── Student joins ──────────────────────────────────
  socket.on('student_join', ({ conversationKey, userId, userName, userEmail }) => {
    if (!conversationKey) return;
    socket.data.convKey   = conversationKey;
    socket.data.userName  = userName  || 'Guest';
    socket.data.userEmail = userEmail || '';
    socket.data.userId    = userId    || null;
    userSocketMap.set(conversationKey, socket.id);
    socket.join(conversationKey); // Keep student socket in its conversation room

    // Upsert conversation record
    db.query(
      `INSERT INTO chat_conversations (conversation_key, user_name, user_email, online, last_updated)
       VALUES (?,?,?,1,NOW())
       ON DUPLICATE KEY UPDATE
         user_name   = COALESCE(VALUES(user_name), user_name),
         user_email  = COALESCE(VALUES(user_email), user_email),
         online      = 1,
         last_updated = NOW()`,
      [conversationKey, socket.data.userName, socket.data.userEmail],
      (err) => {
        if (err) console.error('student_join upsert error:', err.message);
        // Send chat history to student
        db.query(
          'SELECT sender_role, sender_name, message, created_at FROM chat_messages WHERE conversation_key=? ORDER BY created_at ASC',
          [conversationKey],
          (err2, rows) => {
            if (!err2) socket.emit('chat_history', rows || []);
          }
        );
        // Tell admin about updated conversations
        broadcastConversationUpdates();
        // Tell student if admin is online
        socket.emit('admin_status', { online: adminSockets.size > 0 });
      }
    );
  });

  // ── Student sends message ──────────────────────────
  socket.on('student_msg', ({ conversationKey, msg, userName, userEmail, type, fileData }) => {
    if (!conversationKey || (!msg && !fileData)) return;
    const name    = userName  || socket.data.userName  || 'Guest';
    const email   = userEmail || socket.data.userEmail || '';
    const msgType = type || 'text';
    const text    = msg || null;

    const now = Date.now();
    if (socket.data.lastStudentMessage === text && now - (socket.data.lastStudentMessageTime || 0) < 3000) {
      return;
    }
    socket.data.lastStudentMessage = text;
    socket.data.lastStudentMessageTime = now;

    db.query(
      'INSERT INTO chat_messages (conversation_key, sender_role, sender_name, message, message_type, file_data, is_read) VALUES (?,?,?,?,?,?,0)',
      [conversationKey, 'student', name, text, msgType, fileData || null],
      (err) => {
        if (err) { console.error('student_msg insert error:', err.message); return; }

        // Update conversation summary
        db.query(
          `INSERT INTO chat_conversations (conversation_key, user_name, user_email, online, last_message, last_sender_role, unread_count, last_updated)
           VALUES (?,?,?,1,?,?,1,NOW())
           ON DUPLICATE KEY UPDATE
             user_name        = COALESCE(VALUES(user_name), user_name),
             user_email       = COALESCE(VALUES(user_email), user_email),
             online           = 1,
             last_message     = VALUES(last_message),
             last_sender_role = 'student',
             unread_count     = unread_count + 1,
             last_updated     = NOW()`,
          [conversationKey, name, email, text || 'File', 'student'],
          (err2) => {
            if (err2) console.error('conversation update error:', err2.message);
            // Push to all admin sockets
            const payload = { conversationKey, msg: text, name, email, type: msgType, fileData, time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) };
            io.to('admins').emit('new_student_msg', payload);
            // Broadcast updated conversation list to all admins
            broadcastConversationUpdates();
          }
        );
      }
    );
  });

  // ── Admin joins ────────────────────────────────────
  socket.on('admin_join', ({ adminName } = {}) => {
    socket.data.role      = 'admin';
    socket.data.adminName = adminName || 'Admin';
    adminSockets.add(socket.id);
    socket.join('admins'); // Keep admins in a shared room for notifications
    // Send current conversation list to this admin
    broadcastConversationUpdates();
    // Tell all students admin is online
    io.emit('admin_status', { online: true });
  });

  socket.on('student_typing', ({ conversationKey, userName }) => {
    if (!conversationKey) return;
    io.to('admins').emit('studentTyping', { conversationKey, name: userName || 'Student' });
  });

  socket.on('admin_typing', ({ conversationKey, adminName }) => {
    if (!conversationKey) return;
    io.to(conversationKey).emit('adminTyping', { conversationKey, adminName: adminName || 'Admin' });
  });

  // ── Admin sends message ────────────────────────────
  socket.on('admin_msg', ({ conversationKey, msg, senderName, type, fileData }) => {
    if (!conversationKey || (!msg && !fileData)) return;
    const adminName = senderName || socket.data.adminName || 'Admin';
    const msgType = type || 'text';
    const text = msg || null;

    const now = Date.now();
    if (socket.data.lastAdminMessage === text && now - (socket.data.lastAdminMessageTime || 0) < 3000) {
      return;
    }
    socket.data.lastAdminMessage = text;
    socket.data.lastAdminMessageTime = now;

    db.query(
      'INSERT INTO chat_messages (conversation_key, sender_role, sender_name, message, message_type, file_data, is_read) VALUES (?,?,?,?,?,?,1)',
      [conversationKey, 'admin', adminName, text, msgType, fileData || null],
      (err) => {
        if (err) { console.error('admin_msg insert error:', err.message); return; }

        const summaryMessage = msgType === 'file' ? 'File' : (text || 'File');
        db.query(
          `UPDATE chat_conversations SET last_message=?, last_sender_role='admin', last_updated=NOW() WHERE conversation_key=?`,
          [summaryMessage, conversationKey],
          (err2) => { if (err2) console.error('admin_msg conv update error:', err2.message); }
        );

        // Deliver to student
        const payload = {
          from: 'admin', msg: text,
          name: adminName,
          type: msgType,
          fileData: fileData || null,
          time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
        };
        const studentSocketId = userSocketMap.get(conversationKey);
        if (studentSocketId) {
          io.to(studentSocketId).emit('receive_msg', payload);
        } else {
          io.to(conversationKey).emit('receive_msg', payload);
        }
        // Confirm to admin
        socket.emit('message_sent', { conversationKey, msg: text, name: adminName });
        // Broadcast updated conversation list to all admins
        broadcastConversationUpdates();
      }
    );
  });

  // ── Disconnect ─────────────────────────────────────
  socket.on('disconnect', () => {
    if (socket.data.convKey) {
      userSocketMap.delete(socket.data.convKey);
      db.query('UPDATE chat_conversations SET online=0 WHERE conversation_key=?', [socket.data.convKey]);
    }
    adminSockets.delete(socket.id);
    if (adminSockets.size === 0) io.emit('admin_status', { online: false });
    broadcastConversationUpdates();
  });
});



const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});