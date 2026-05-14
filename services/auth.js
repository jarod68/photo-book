const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const database = require('./database');
const IS_PROD  = process.env.NODE_ENV === 'production';

const WORDS = [
  'ash','bay','bolt','crow','dusk','echo','elm','fog','gem','glen',
  'glow','hawk','iris','jade','jay','kite','lake','lark','leaf','luna',
  'lynx','mist','moor','moss','oak','owl','peak','pine','rain','reed',
  'rose','rune','sage','sand','snow','star','stem','swan','teal','tide',
  'wolf','wren',
];

function generatePassword() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const n    = String(10 + Math.floor(Math.random() * 90));
  return `${pick()}-${pick()}${n}`;  // e.g. "oak-wolf42" (9-11 chars)
}

async function ensureAdmin() {
  const { rows } = await database.db.query(
    "SELECT id FROM users WHERE username = 'admin'",
  );
  if (rows.length > 0) return;

  const password = generatePassword();
  const hash     = await bcrypt.hash(password, 12);
  await database.db.query(
    "INSERT INTO users (username, password_hash, role) VALUES ('admin', $1, 'admin')",
    [hash],
  );
  console.log('  ✓ Admin user created.');
  console.log(`  ✎ Password: ${password}`);
}

async function login(username, password) {
  const { rows } = await database.db.query(
    'SELECT id, password_hash FROM users WHERE username = $1',
    [username],
  );
  if (rows.length === 0) return null;

  const match = await bcrypt.compare(password, rows[0].password_hash);
  if (!match) return null;

  const token    = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await database.db.query(
    'INSERT INTO user_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, rows[0].id, expiresAt],
  );
  return token;
}

async function getSessionUser(token) {
  if (!token || token.length !== 64) return null;
  const { rows } = await database.db.query(
    `SELECT u.id, u.username, u.role
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token],
  );
  return rows[0] ?? null;
}

async function logout(token) {
  await database.db.query('DELETE FROM user_sessions WHERE token = $1', [token]);
}

let _testBypass = false;

async function requireAuth(req, res, next) {
  if (_testBypass) return next();
  const token = req.cookies?.pb_session;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const user = await getSessionUser(token).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  req.user = user;
  next();
}

function authStaticGuard(req, res, next) {
  if (_testBypass) return next();
  const token = req.cookies?.pb_session;
  if (!token) return res.redirect('/login.html');
  getSessionUser(token)
    .then(user => (user ? next() : res.redirect('/login.html')))
    .catch(() => res.redirect('/login.html'));
}

// Test-only: bypass all auth checks
function _setBypass(val) { _testBypass = val; }

module.exports = { ensureAdmin, login, getSessionUser, logout, requireAuth, authStaticGuard, _setBypass };
