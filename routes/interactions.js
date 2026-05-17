'use strict';

const express  = require('express');
const database = require('../services/database');
const auth     = require('../services/auth');
const activity = require('../services/activity');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/view
router.post('/view', express.json(), async (req, res) => {
  if (!database.dbReady) return res.json({ views: null });
  const { album, filename, token } = req.body ?? {};
  if (!album || !filename || !token || !UUID_RE.test(token)) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const log = await database.db.query(
      `INSERT INTO photo_view_log (album, filename, user_token)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [album, filename, token],
    );

    if (log.rowCount > 0) {
      await database.db.query(
        `INSERT INTO photo_views (album, filename, views) VALUES ($1, $2, 1)
         ON CONFLICT (album, filename) DO UPDATE SET views = photo_views.views + 1`,
        [album, filename],
      );
    }

    const [viewResult, likeCountResult, likedResult] = await Promise.all([
      database.db.query(
        `INSERT INTO photo_views (album, filename, views) VALUES ($1, $2, 0)
         ON CONFLICT (album, filename) DO UPDATE SET views = photo_views.views
         RETURNING views`,
        [album, filename],
      ),
      database.db.query(
        'SELECT COUNT(*) AS count FROM photo_likes WHERE album = $1 AND filename = $2',
        [album, filename],
      ),
      database.db.query(
        'SELECT 1 FROM photo_likes WHERE album = $1 AND filename = $2 AND user_token = $3',
        [album, filename, token],
      ),
    ]);
    res.json({
      views: Number(viewResult.rows[0].views),
      likes: Number(likeCountResult.rows[0].count),
      liked: likedResult.rowCount > 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/like
router.post('/like', express.json(), async (req, res) => {
  if (!database.dbReady) return res.json({ liked: false, count: 0 });
  const { album, filename, token } = req.body ?? {};
  if (!album || !filename || !token || !UUID_RE.test(token)) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const existing = await database.db.query(
      'SELECT 1 FROM photo_likes WHERE album = $1 AND filename = $2 AND user_token = $3',
      [album, filename, token],
    );
    if (existing.rowCount > 0) {
      await database.db.query(
        'DELETE FROM photo_likes WHERE album = $1 AND filename = $2 AND user_token = $3',
        [album, filename, token],
      );
    } else {
      await database.db.query(
        'INSERT INTO photo_likes (album, filename, user_token) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [album, filename, token],
      );
    }
    const { rows } = await database.db.query(
      'SELECT COUNT(*) AS count FROM photo_likes WHERE album = $1 AND filename = $2',
      [album, filename],
    );
    const liked = existing.rowCount === 0;
    const sessionToken = req.cookies?.pb_session;
    const sessionUser  = sessionToken ? await auth.getSessionUser(sessionToken).catch(() => null) : null;
    res.json({ liked, count: Number(rows[0].count) });
    activity.log('photo_like', { username: sessionUser?.username ?? null, ip: req.ip, details: { album, filename, liked } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/liked
router.get('/liked', async (req, res) => {
  if (!database.dbReady) return res.json({ filenames: [] });
  const { album, token } = req.query;
  if (!album || !token || !UUID_RE.test(token)) return res.json({ filenames: [] });
  try {
    const { rows } = await database.db.query(
      'SELECT filename FROM photo_likes WHERE album = $1 AND user_token = $2',
      [album, token],
    );
    res.json({ filenames: rows.map(r => r.filename) });
  } catch (err) {
    console.error('Failed to load likes:', err.message);
    res.json({ filenames: [] });
  }
});

module.exports = router;
