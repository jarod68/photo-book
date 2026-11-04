// @ts-check
'use strict';

const express  = require('express');

const { requireAdmin } = require('../../services/auth');
const database   = require('../../services/database');
const library    = require('../../services/library');
const system      = require('../../services/system');
const maintenance = require('../../services/maintenance');
const duplicates  = require('../../services/duplicates');
const albumInfo   = require('../../services/album-info');

const router = express.Router();

// GET /api/admin/stats — every album for the admin; a user's own albums
// for the others (their "My albums" page)
router.get('/stats', async (req, res) => {
  try {
    const isAdmin = !req.user || req.user.role === 'admin';   // no user: the tests' auth bypass
    let names = await library.listAlbums();
    let viewMap = new Map();
    let likeMap = new Map();
    let visibilityMap = new Map();
    let ownerMap = new Map();
    if (database.dbReady) {
      const [{ rows: viewRows }, { rows: likeRows }, { rows: settingsRows }] = await Promise.all([
        database.db.query('SELECT album, SUM(views) AS views FROM photo_views GROUP BY album'),
        database.db.query('SELECT album, COUNT(*) AS likes FROM photo_likes GROUP BY album'),
        database.db.query(`SELECT s.album, s.visibility, s.owner_id, u.username, u.display_name
                           FROM album_settings s LEFT JOIN users u ON u.id = s.owner_id`),
      ]);
      viewMap       = new Map(viewRows.map(r => [r.album, Number(r.views)]));
      likeMap       = new Map(likeRows.map(r => [r.album, Number(r.likes)]));
      visibilityMap = new Map(settingsRows.map(r => [r.album, r.visibility]));
      ownerMap      = new Map(settingsRows.filter(r => r.owner_id != null)
        .map(r => [r.album, { id: r.owner_id, username: r.username, displayName: r.display_name ?? null }]));
    }
    if (!isAdmin) names = names.filter((n) => ownerMap.get(n)?.id === req.user.id);
    const fsMap = new Map(await Promise.all(names.map(async name => /** @type {[string, number]} */ ([
      name, ((await library.listPhotos(name)) ?? []).length,
    ]))));

    // collection and capture dates, for the admin's filters, sort and groups
    const infos = await albumInfo.loadAlbumInfo().catch(() => new Map());
    const dates = new Map(await Promise.all(names.map(async (name) => /** @type {[string, { dateFrom: string | null, dateTo: string | null }]} */ ([
      name, albumInfo.dateRange((await library.getAlbumPhotos(name)) ?? []),
    ]))));

    const albums = [...fsMap.entries()].map(([album, photos]) => ({
      album,
      photos,
      views:      viewMap.get(album) ?? 0,
      likes:      likeMap.get(album) ?? 0,
      visibility: visibilityMap.get(album) ?? 'public',
      owner:      ownerMap.get(album) ?? null,
      collection: infos.get(album)?.collection ?? null,
      ...dates.get(album),
    })).sort((a, b) => b.views - a.views || a.album.localeCompare(b.album));

    res.json({ albums, readOnly: !await library.isWritable() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/system — build, disk, database, caches, maintenance, recent errors
router.get('/system', requireAdmin, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(await system.report({ maintenance: maintenance.lastRun() }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
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
      // the strip's thumbnail (services/image.js, kind "thumb"); may not exist yet
      thumbUrl: `/previews/${encodeURIComponent(r.album)}/${encodeURIComponent(r.filename)}.thumb.jpg`,
    }));
    res.json({ photos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/duplicates — identical files and probable copies of the
// same shot across the library (the admin decides what to delete)
router.get('/duplicates', requireAdmin, async (_req, res) => {
  try {
    res.json(await duplicates.findDuplicates());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
