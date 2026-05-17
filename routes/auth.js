'use strict';

const express  = require('express');
const auth     = require('../services/auth');
const database = require('../services/database');
const activity = require('../services/activity');

const router = express.Router();

// POST /api/auth/login
router.post('/login', express.json(), async (req, res) => {
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  try {
    const token = await auth.login(username, password);
    if (!token) return res.status(401).json({ error: 'Invalid credentials' });
    res.cookie('pb_session', token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   30 * 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true });
    activity.log('login', { username, ip: req.ip });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = req.cookies.pb_session;
  let username = null;
  if (token && database.dbReady) {
    const u = await auth.getSessionUser(token).catch(() => null);
    username = u?.username ?? null;
    await auth.logout(token).catch(err => console.error('Session cleanup failed:', err.message));
  }
  res.clearCookie('pb_session');
  res.json({ ok: true });
  activity.log('logout', { username, ip: req.ip });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  if (!database.dbReady) return res.json({ user: null });
  const token = req.cookies.pb_session;
  if (!token) return res.json({ user: null });
  const user = await auth.getSessionUser(token).catch(() => null);
  res.json({ user: user ? { username: user.username, role: user.role } : null });
});

module.exports = router;
