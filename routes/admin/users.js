'use strict';

const express  = require('express');

const { requireAdmin, hashPassword } = require('../../services/auth');
const database                       = require('../../services/database');
const activity                       = require('../../services/activity');
const { generatePassword, validatePassword } = require('../../services/password');

const router = express.Router();

const VALID_ROLES = new Set(['admin', 'basic']);

// GET /api/admin/users
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await database.db.query(
      'SELECT id, username, role, created_at, last_login_at FROM users ORDER BY id',
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
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    if (!VALID_ROLES.has(role))  return res.status(400).json({ error: 'Role must be admin or basic' });
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const hash = await hashPassword(password);
    const { rows } = await database.db.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
      [username.trim(), hash, role],
    );
    res.status(201).json({ user: rows[0] });
    activity.log('user_create', { username: req.user?.username ?? null, ip: req.ip, details: { created_username: username.trim(), role } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/users/:id
router.patch('/:id', requireAdmin, express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid user id' });
    const { role, password } = req.body ?? {};
    if (role !== undefined && !VALID_ROLES.has(role)) return res.status(400).json({ error: 'Role must be admin or basic' });
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
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(id);
    const { rowCount } = await database.db.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params,
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
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
