// @ts-check
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const database = require('./database');
const { generatePassword } = require('./password');

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

const MAX_FAILED = 5;                 // wrong passwords in a row…
const LOCK_MS = 15 * 60_000;          // …lock the account this long

/**
 * The account if the password is right — { id, username, role, totpEnabled }
 * — else null. The case of the name does not matter (the exact spelling
 * first, should two old accounts differ only by it). Five wrong passwords in
 * a row lock the account for 15 minutes, whatever the address they come
 * from; meanwhile even the right password gets null (the same answer: an
 * attacker learns nothing).
 */
async function checkPassword(username, password) {
  const { rows } = await database.db.query(
    `SELECT id, username, role, password_hash, totp_secret IS NOT NULL AS totp, locked_until > now() AS locked
       FROM users WHERE lower(username) = lower($1) ORDER BY (username = $1) DESC LIMIT 1`,
    [username],
  );
  if (rows.length === 0) return null;
  const u = rows[0];
  if (u.locked) return null;
  const match = await bcrypt.compare(password, u.password_hash);
  if (!match) {
    await database.db.query(
      `UPDATE users SET
         locked_until  = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(secs => $3) ELSE locked_until END,
         failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END
       WHERE id = $1`, [u.id, MAX_FAILED, LOCK_MS / 1000]);
    return null;
  }
  await database.db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
  return { id: u.id, username: u.username, role: u.role, totpEnabled: !!u.totp };
}

/** A new 30-day session for the user: its token. */
async function createSession(userId) {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await database.db.query(
    'INSERT INTO user_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expiresAt],
  );
  await database.db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
  return token;
}

/** Password, then a session (accounts without a second factor): its token, or null. */
async function login(username, password) {
  const u = await checkPassword(username, password);
  return u ? createSession(u.id) : null;
}

async function getSessionUser(token) {
  if (!token || token.length !== 64) return null;
  const { rows } = await database.db.query(
    `SELECT u.id, u.username, u.role, u.totp_secret IS NOT NULL AS totp_enabled
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
let _testUser   = null;

async function requireAuth(req, res, next) {
  if (_testBypass) {
    if (_testUser) req.user = _testUser;
    return next();
  }
  const token = req.cookies?.pb_session;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const user = await getSessionUser(token).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  req.user = user;
  next();
}

// Two-factor sign-in is required of the admin (in production; the tests
// switch it on to check it): until it is set up, the admin routes answer 403
// with code "mfa_setup" — the admin page sends to My account to set it up.
let _mfaRequired = process.env.NODE_ENV === 'production' || process.env.ADMIN_MFA === 'required';

function requireAdmin(req, res, next) {
  if (_testBypass) return next();
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  if (_mfaRequired && req.user.totp_enabled === false) {
    return res.status(403).json({ error: 'Two-factor sign-in must be set up first', code: 'mfa_setup' });
  }
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

/**
 * Hash a plain-text password using bcrypt with a cost factor of 12.
 * @param {string} password
 * @returns {Promise<string>} The bcrypt hash.
 */
async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

// Test-only helpers — not exported in production
function _setBypass(val)  { _testBypass = val; }
function _setTestUser(u)  { _testUser = u; }
function _setMfaRequired(v) { _mfaRequired = v; }
/** Is two-factor sign-in required of the admin here? */
const mfaRequired = () => _mfaRequired;

const testExports = process.env.NODE_ENV !== 'production'
  ? { _setBypass, _setTestUser, _setMfaRequired }
  : {};

module.exports = { ensureAdmin, login, checkPassword, createSession, mfaRequired, getSessionUser, logout, requireAuth, requireAdmin, authStaticGuard, hashPassword, ...testExports };
