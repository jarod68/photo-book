'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const database     = require('../services/database');
const push         = require('../services/push');
const { PHOTOS_DIR } = require('../services/image');
const { resolveUser, getAlbumAccess } = require('../services/access');

const router = express.Router();

// GET /api/push/vapid-key
router.get('/vapid-key', (_req, res) => {
  const publicKey = push.getVapidPublicKey();
  if (!publicKey) return res.status(503).json({ error: 'Push not initialised' });
  res.json({ publicKey });
});

// POST /api/push/subscribe
router.post('/subscribe', express.json(), async (req, res) => {
  const { album, subscription, share } = req.body ?? {};
  const endpoint = subscription?.endpoint;
  const p256dh   = subscription?.keys?.p256dh;
  const auth     = subscription?.keys?.auth;

  if (!album || !endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });

  // The album must exist on disk, and the caller must be allowed to see it —
  // otherwise restricted album names and activity leak through notifications.
  const albumPath = path.resolve(path.join(PHOTOS_DIR, album));
  const albumExists = albumPath.startsWith(PHOTOS_DIR + path.sep) && fs.existsSync(albumPath);
  if (!albumExists) return res.status(404).json({ error: 'Album not found' });

  const user = await resolveUser(req.cookies?.pb_session);
  const { allowed } = await getAlbumAccess(album, user, share ?? null)
    .catch(() => ({ allowed: false }));
  if (!allowed) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const userAgent = req.headers['user-agent']?.slice(0, 512) ?? null;
    await database.db.query(
      `INSERT INTO push_subscriptions (album, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (album, endpoint) DO UPDATE
         SET p256dh = $3, auth = $4, user_agent = $5, subscribed_at = CURRENT_TIMESTAMP`,
      [album, endpoint, p256dh, auth, userAgent],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/push/subscribe
router.delete('/subscribe', express.json(), async (req, res) => {
  const { album, endpoint } = req.body ?? {};
  if (!album || !endpoint) return res.status(400).json({ error: 'Missing fields' });
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });

  try {
    await database.db.query(
      'DELETE FROM push_subscriptions WHERE album = $1 AND endpoint = $2',
      [album, endpoint],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
