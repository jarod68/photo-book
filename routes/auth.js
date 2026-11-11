// @ts-check
'use strict';

const express  = require('express');
const auth     = require('../services/auth');
const database = require('../services/database');
const activity = require('../services/activity');

const router = express.Router();

const mfa    = require('../services/mfa');
const google = require('../services/google-sso');

const sessionCookie = (res, token) => res.cookie('pb_session', token, {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   30 * 24 * 60 * 60 * 1000,
});

// POST /api/auth/login  { username, password } — signed in, or, with a second
// factor, { mfa: true, ticket } to send with the code (POST /login/code)
router.post('/login', express.json(), async (req, res) => {
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  try {
    const user = await auth.checkPassword(username, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.totpEnabled) return res.json({ mfa: true, ticket: mfa.issueTicket(user.id, 'password') });
    sessionCookie(res, await auth.createSession(user.id));
    res.json({ ok: true });
    activity.log('login', { username: user.username, ip: req.ip });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login/code  { ticket, code } — the authenticator app's code
// (or a backup code) after the password or Google
router.post('/login/code', express.json(), async (req, res) => {
  try {
    const { ticket, code } = req.body ?? {};
    const t = await mfa.redeemTicket(ticket, code);
    if (!t) return res.status(401).json({ error: 'Invalid code' });
    sessionCookie(res, await auth.createSession(t.userId));
    res.json({ ok: true });
    activity.log('login', { username: null, ip: req.ip, details: { userId: t.userId, via: t.via, mfa: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/providers — the other ways to sign in, for the login page
router.get('/providers', (_req, res) => res.json({ google: google.enabled() }));

// this site's address as the browser sees it (Traefik in front: trust proxy)
const originOf = (req) => process.env.PUBLIC_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
const OIDC_COOKIE = 'pb_oidc';

// GET /api/auth/google — off to Google
router.get('/google', (req, res) => {
  if (!google.enabled()) return res.status(404).json({ error: 'Not configured' });
  const { url, remember } = google.start(originOf(req));
  // lax: Google's redirect back is a top-level navigation from another site
  res.cookie(OIDC_COOKIE, JSON.stringify(remember), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 10 * 60_000, path: '/api/auth/google',
  });
  res.redirect(url);
});

// GET /api/auth/google/callback — back from Google: the account linked to
// that address, then the code if it has a second factor
router.get('/google/callback', async (req, res) => {
  let remembered = null;
  try { remembered = JSON.parse(req.cookies?.[OIDC_COOKIE] ?? 'null'); } catch { /* none */ }
  res.clearCookie(OIDC_COOKIE, { path: '/api/auth/google' });
  try {
    if (!google.enabled() || req.query.error) return res.redirect('/login.html?sso=error');
    const identity = await google.finish(originOf(req), req.query, remembered);
    const userId = database.dbReady ? await google.accountFor(identity) : null;
    if (!userId) {
      activity.log('login_failed', { username: null, ip: req.ip, details: { via: 'google', email: identity.email } });
      return res.redirect('/login.html?sso=unknown');
    }
    const { enabled } = await mfa.status(userId);
    if (enabled) return res.redirect(`/login.html?mfa=${mfa.issueTicket(userId, 'google')}`);
    sessionCookie(res, await auth.createSession(userId));
    activity.log('login', { username: null, ip: req.ip, details: { userId, via: 'google' } });
    res.redirect('/');
  } catch (err) {
    console.error('Google sign-in failed:', err.message);
    res.redirect('/login.html?sso=error');
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
  // mfaSetup: an admin who must still set up two-factor sign-in
  res.json({ user: user ? { username: user.username, role: user.role, mfaSetup: auth.mfaRequired() && user.role === 'admin' && user.totp_enabled === false } : null });
});

module.exports = router;
