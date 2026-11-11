// @ts-check
'use strict';
// One's own account: profile (name shown, bio, picture) and password.

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const auth     = require('../services/auth');
const profiles = require('../services/profiles');
const library  = require('../services/library');
const activity = require('../services/activity');
const mfa      = require('../services/mfa');
const database = require('../services/database');
const { PREVIEWS_DIR } = require('../services/image');
const { getAlbumAccess } = require('../services/access');
const { BadRequest, sendError } = require('../services/http-errors');

const router = express.Router();
router.use(auth.requireAuth);

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } }).single('avatar');

const view = (p) => ({
  username: p.username, role: p.role, displayName: p.displayName, bio: p.bio,
  avatarUrl: p.avatarVersion ? `/api/users/${encodeURIComponent(p.username)}/avatar?v=${p.avatarVersion}` : null,
});

// GET /api/me
router.get('/', async (req, res) => {
  try {
    const p = await profiles.byId(req.user.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(view(p));
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /api/me  { displayName?, bio? }
router.put('/', express.json(), async (req, res) => {
  try {
    const { displayName, bio } = req.body ?? {};
    res.json(view(await profiles.update(req.user.id, { displayName, bio })));
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /api/me/avatar — a picture sent (multipart field "avatar"), or one of
// the photos the user may see ({ album, file } in JSON)
router.put('/avatar', (req, res) => {
  const done = async (input) => {
    try {
      res.json(view(await profiles.setAvatar(req.user.id, input)));
    } catch (err) {
      sendError(res, err);
    }
  };
  if (req.is('application/json')) {
    return express.json()(req, res, async () => {
      try {
        const { album, file } = req.body ?? {};
        if (typeof album !== 'string' || typeof file !== 'string') throw new BadRequest('album and file are required');
        if (!(await getAlbumAccess(album, req.user)).allowed) return res.status(403).json({ error: 'Forbidden' });
        const photo = ((await library.getAlbumPhotos(album)) ?? []).find((p) => p.filename === file);
        if (!photo?.previewUrl) return res.status(404).json({ error: 'Photo not found' });
        // its preview (a JPEG whatever the original: HEIC, TIFF…)
        const rel = decodeURIComponent(photo.previewUrl.replace(/^\/previews\//, '').replace(/\?.*$/, ''));
        const full = path.resolve(PREVIEWS_DIR, rel);
        if (!full.startsWith(path.resolve(PREVIEWS_DIR) + path.sep)) throw new BadRequest('Invalid photo');
        await done(await fs.promises.readFile(full));
      } catch (err) {
        sendError(res, err);
      }
    });
  }
  avatarUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No picture' });
    await done(req.file.buffer);
  });
});

// ── Two-factor sign-in (an authenticator app) and Google ────────────────────

// GET /api/me/security — { twoFactor: { enabled, backupLeft, required }, email, google }
router.get('/security', async (req, res) => {
  try {
    const { rows } = await database.db.query('SELECT email, google_sub IS NOT NULL AS google FROM users WHERE id = $1', [req.user.id]);
    res.json({
      twoFactor: { ...(await mfa.status(req.user.id)), required: auth.mfaRequired() && req.user.role === 'admin' },
      email: rows[0]?.email ?? null, google: !!rows[0]?.google,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/me/2fa/setup — a new secret (QR code + text), confirmed by /enable
router.post('/2fa/setup', async (req, res) => {
  try {
    res.json(await mfa.setup(req.user.id));
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/me/2fa/enable  { code } — on; the backup codes, shown once
router.post('/2fa/enable', express.json(), async (req, res) => {
  try {
    const backupCodes = await mfa.enable(req.user.id, req.body?.code);
    res.json({ backupCodes });
    activity.log('mfa_enable', { username: req.user.username, ip: req.ip });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/me/2fa/disable  { password } — off (not for an admin who must have it)
router.post('/2fa/disable', express.json(), async (req, res) => {
  try {
    if (auth.mfaRequired() && req.user.role === 'admin') return res.status(403).json({ error: 'Required for the admin' });
    if (!await auth.checkPassword(req.user.username, String(req.body?.password ?? ''))) return res.status(403).json({ error: 'Wrong password' });
    await mfa.disable(req.user.id);
    res.json({ ok: true });
    activity.log('mfa_disable', { username: req.user.username, ip: req.ip });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/me/2fa/backup-codes  { code } — new backup codes (the old ones no longer work)
router.post('/2fa/backup-codes', express.json(), async (req, res) => {
  try {
    if (!await mfa.verify(req.user.id, req.body?.code)) return res.status(403).json({ error: 'Wrong code' });
    res.json({ backupCodes: await mfa.regenerateBackup(req.user.id) });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /api/me/google — unlink the Google account (signing in with it then
// links it again only through the e-mail the admin set)
router.delete('/google', async (req, res) => {
  try {
    await database.db.query('UPDATE users SET google_sub = NULL WHERE id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /api/me/avatar
router.delete('/avatar', async (req, res) => {
  try {
    await profiles.clearAvatar(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /api/me/password  { current, password } — the user's other sessions are closed
router.put('/password', express.json(), async (req, res) => {
  try {
    const { current, password } = req.body ?? {};
    await profiles.changePassword(req.user.id, current, password, req.cookies?.pb_session);
    res.json({ ok: true });
    activity.log('password_change', { username: req.user.username, ip: req.ip });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
