'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');

const { requireAdmin } = require('../../services/auth');
const { PHOTOS_DIR, isImage, isAlbumDir } = require('../../services/image');
const database   = require('../../services/database');
const dockerInfo = require('../../services/docker-info');

const router = express.Router();

// GET /api/admin/stats
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const entries = fs.existsSync(PHOTOS_DIR)
      ? fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(isAlbumDir)
      : [];
    const fsMap = new Map(entries.map(e => [
      e.name,
      fs.readdirSync(path.join(PHOTOS_DIR, e.name)).filter(isImage).length,
    ]));

    let viewMap = new Map();
    let likeMap = new Map();
    let visibilityMap = new Map();
    if (database.dbReady) {
      const [{ rows: viewRows }, { rows: likeRows }, { rows: settingsRows }] = await Promise.all([
        database.db.query('SELECT album, SUM(views) AS views FROM photo_views GROUP BY album'),
        database.db.query('SELECT album, COUNT(*) AS likes FROM photo_likes GROUP BY album'),
        database.db.query('SELECT album, visibility FROM album_settings'),
      ]);
      viewMap       = new Map(viewRows.map(r => [r.album, Number(r.views)]));
      likeMap       = new Map(likeRows.map(r => [r.album, Number(r.likes)]));
      visibilityMap = new Map(settingsRows.map(r => [r.album, r.visibility]));
    }

    const albums = [...fsMap.entries()].map(([album, photos]) => ({
      album,
      photos,
      views:      viewMap.get(album) ?? 0,
      likes:      likeMap.get(album) ?? 0,
      visibility: visibilityMap.get(album) ?? 'public',
    })).sort((a, b) => b.views - a.views || a.album.localeCompare(b.album));

    res.json({ albums });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/system
router.get('/system', requireAdmin, async (req, res) => {
  let containers = [];
  try { containers = await dockerInfo.getContainers(); } catch (err) { console.error('Docker info unavailable:', err.message); }
  res.json({
    node:       process.version,
    uptime:     Math.floor(process.uptime()),
    containers,
  });
});

// GET /api/admin/top-photos  (requireAuth only — applied via app.use('/api/admin', requireAuth) in server.js)
router.get('/top-photos', async (req, res) => {
  if (!database.dbReady) return res.json({ photos: [] });
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const [{ rows: viewRows }, { rows: likeRows }] = await Promise.all([
      database.db.query(
        'SELECT album, filename, views FROM photo_views ORDER BY views DESC LIMIT $1',
        [limit],
      ),
      database.db.query(
        'SELECT album, filename, COUNT(*) AS likes FROM photo_likes GROUP BY album, filename',
      ),
    ]);
    const likeMap = new Map(likeRows.map(r => [`${r.album}/${r.filename}`, Number(r.likes)]));
    const photos  = viewRows.map(r => ({
      album:    r.album,
      filename: r.filename,
      views:    Number(r.views),
      likes:    likeMap.get(`${r.album}/${r.filename}`) ?? 0,
      url:      `/photos/${encodeURIComponent(r.album)}/${encodeURIComponent(r.filename)}`,
    }));
    res.json({ photos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
