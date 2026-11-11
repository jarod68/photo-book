// @ts-check
'use strict';

const express  = require('express');

const { requireAdmin, hashPassword } = require('../../services/auth');
const database                       = require('../../services/database');
const activity                       = require('../../services/activity');
const { generatePassword, validatePassword } = require('../../services/password');

const router = express.Router();

const VALID_ROLES = new Set(['admin', 'basic']);
// the address a Google account signs in with (null / '' clears it)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailOf = (v) => (v == null || v === '' ? null : String(v).trim());

// GET /api/admin/users
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await database.db.query(
      `SELECT id, username, role, created_at, last_login_at, email,
              totp_secret IS NOT NULL AS mfa, google_sub IS NOT NULL AS google, locked_until > now() AS locked
       FROM users ORDER BY id`,
    );
    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/users
router.post('/', requireAdmin, express.json(), async (req, res) => {
  try {
    const { username, password, role } = req.body ?? {};
    const email = emailOf(req.body?.email);
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid e-mail' });
    if (!VALID_ROLES.has(role))  return res.status(400).json({ error: 'Role must be admin or basic' });
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    // "Ana" when "ana" exists is the same name (also a unique index, migration 11)
    const { rows: taken } = await database.db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username.trim()]);
    if (taken.length) return res.status(409).json({ error: 'Username already taken' });
    const hash = await hashPassword(password);
    const { rows } = await database.db.query(
      'INSERT INTO users (username, password_hash, role, email) VALUES ($1, $2, $3, $4) RETURNING id, username, role, created_at, email',
      [username.trim(), hash, role, email],
    );
    res.status(201).json({ user: rows[0] });
    activity.log('user_create', { username: req.user?.username ?? null, ip: req.ip, details: { created_username: username.trim(), role } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: err.constraint === 'users_email_lower' ? 'E-mail already used by another account' : 'Username already taken' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/users/:id
router.patch('/:id', requireAdmin, express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid user id' });
    const { role, password, resetMfa, unlock } = req.body ?? {};
    const email = req.body?.email === undefined ? undefined : emailOf(req.body.email);
    if (role !== undefined && !VALID_ROLES.has(role)) return res.status(400).json({ error: 'Role must be admin or basic' });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid e-mail' });
    const { rows: found } = await database.db.query('SELECT username FROM users WHERE id = $1', [id]);
    if (!found.length) return res.status(404).json({ error: 'User not found' });
    if (role !== undefined && found[0].username === 'admin') return res.status(403).json({ error: 'The admin user role cannot be changed' });
    if (password) {
      const pwErr = validatePassword(password);
      if (pwErr) return res.status(400).json({ error: pwErr });
    }
    const sets = []; const params = [];
    if (role !== undefined) { params.push(role);                          sets.push(`role = $${params.length}`); }
    if (password)           { params.push(await hashPassword(password));    sets.push(`password_hash = $${params.length}`); }
    // a new address: the Google account linked to the old one no longer opens it
    if (email !== undefined) { params.push(email); sets.push(`email = $${params.length}`, 'google_sub = NULL'); }
    // a phone lost with its backup codes: two-factor sign-in off, to set up again
    if (resetMfa === true) sets.push('totp_secret = NULL', 'totp_pending = NULL', 'totp_last_step = NULL', 'totp_backup = NULL');
    if (unlock === true) sets.push('failed_logins = 0', 'locked_until = NULL');
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(id);
    const { rowCount } = await database.db.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params,
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
    if (resetMfa === true) activity.log('mfa_reset', { username: req.user?.username ?? null, ip: req.ip, details: { target: found[0].username } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'E-mail already used by another account' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid user id' });
    const { rows } = await database.db.query('SELECT username FROM users WHERE id = $1', [id]);
    if (!rows.length)                   return res.status(404).json({ error: 'User not found' });
    if (rows[0].username === 'admin')   return res.status(403).json({ error: 'The admin user cannot be deleted' });
    await database.db.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
    activity.log('user_delete', { username: req.user?.username ?? null, ip: req.ip, details: { deleted_username: rows[0].username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/generate-password
router.get('/generate-password', requireAdmin, (_req, res) => {
  res.json({ password: generatePassword() });
});

module.exports = router;
