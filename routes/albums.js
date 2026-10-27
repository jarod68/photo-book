'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const { ZipArchive } = require('archiver');

const { PHOTOS_DIR, isMedia, deletePhotoFiles } = require('../services/image');
const library  = require('../services/library');
const overrides = require('../services/overrides');
const albumInfo = require('../services/album-info');
const database = require('../services/database');
const auth     = require('../services/auth');
const activity = require('../services/activity');
const { resolveUser, getAlbumAccess, filterVisibleAlbums } = require('../services/access');

const { BadRequest, sendError } = require('../services/http-errors');

const router = express.Router();

function safeAlbumPath(name) {
  const full = path.resolve(path.join(PHOTOS_DIR, name));
  const base = PHOTOS_DIR + path.sep;
  if (!full.startsWith(base) && full !== PHOTOS_DIR) throw new BadRequest('Invalid album');
  return full;
}

// GET /api/albums
router.get('/', async (req, res) => {
  try {
    if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

    const entries = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(
      e => e.isDirectory?.() ?? false,
    );

    const user = await resolveUser(req.cookies?.pb_session);
    const { filtered, visibilityMap, authorizedSet } = await filterVisibleAlbums(entries, user);

    const info = await albumInfo.loadAlbumInfo()
      .catch((err) => { console.error('Failed to load album info:', err.message); return new Map(); });
    // Photo metadata comes from the cached library index (cover, date range).
    const albums = await Promise.all(filtered.map(async e => {
      const photos = (await library.getAlbumPhotos(e.name)) ?? [];
      const { coverFile, ...summary } = albumInfo.summarize(photos, info.get(e.name));
      const visibility = visibilityMap.get(e.name) ?? 'public';
      const canDelete  = user?.role === 'admin' || (user?.role === 'basic' && authorizedSet.has(e.name));
      return { name: e.name, ...summary, visibility, canDelete };
    }));

    res.json(albums);
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/albums/:album/download/zip
router.get('/:album/download/zip', async (req, res) => {
  try {
    const albumPath = safeAlbumPath(req.params.album);
    if (!fs.existsSync(albumPath)) return res.status(404).json({ error: 'Not found' });

    const user       = await resolveUser(req.cookies?.pb_session);
    const shareToken = req.query?.share ?? null;
    // Fail closed: an access-check error must never expose a restricted album.
    let access;
    try {
      access = await getAlbumAccess(req.params.album, user, shareToken);
    } catch {
      return res.status(503).json({ error: 'Service unavailable' });
    }
    if (!access.allowed) return res.status(401).json({ error: 'Unauthorized' });

    const files = fs.readdirSync(albumPath).filter(isMedia).sort();
    if (!files.length) return res.status(404).json({ error: 'Album is empty' });

    const albumName   = req.params.album;
    const asciiName   = albumName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    const encodedName = encodeURIComponent(albumName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}.zip"; filename*=UTF-8''${encodedName}.zip`,
    );

    const archive = new ZipArchive({ zlib: { level: 0 } });
    archive.on('warning', err => { if (err.code !== 'ENOENT') console.warn('Archive warning:', err); });
    archive.on('error',   err => { console.error('Archive error:', err); res.destroy(err); });
    archive.pipe(res);
    for (const file of files) {
      archive.file(path.join(albumPath, file), { name: file });
    }
    archive.finalize(); // event-driven — do not await
  } catch (err) {
    if (!res.headersSent) sendError(res, err);
    else console.error(err);
  }
});

// GET /api/albums/:album
router.get('/:album', async (req, res) => {
  try {
    const albumPath = safeAlbumPath(req.params.album);
    if (!fs.existsSync(albumPath)) return res.status(404).json({ error: 'Not found' });

    const user       = await resolveUser(req.cookies?.pb_session);
    const shareToken = req.query?.share ?? null;
    // Fail closed: an access-check error must never expose a restricted album.
    let access;
    try {
      access = await getAlbumAccess(req.params.album, user, shareToken);
    } catch {
      return res.status(503).json({ error: 'Service unavailable' });
    }
    const { allowed, canDelete } = access;
    if (!allowed) return res.status(401).json({ error: 'Unauthorized' });

    // Cached per photo (services/library.js); copied (applyOverride) because
    // titles edited in the admin and counters are added below.
    const ovs = await overrides.loadOverrides([req.params.album])
      .catch((err) => { console.error('Failed to load photo overrides:', err.message); return new Map(); });
    const photos = ((await library.getAlbumPhotos(req.params.album)) ?? [])
      .map((p) => overrides.applyOverride(p, ovs.get(`${req.params.album}/${p.filename}`)));

    if (database.dbReady) {
      try {
        const [{ rows: viewRows }, { rows: likeRows }] = await Promise.all([
          database.db.query('SELECT filename, views FROM photo_views WHERE album = $1', [req.params.album]),
          database.db.query('SELECT filename, COUNT(*) AS likes FROM photo_likes WHERE album = $1 GROUP BY filename', [req.params.album]),
        ]);
        const viewMap = new Map(viewRows.map(r => [r.filename, Number(r.views)]));
        const likeMap = new Map(likeRows.map(r => [r.filename, Number(r.likes)]));
        photos.forEach(p => {
          p.views = viewMap.get(p.filename) ?? 0;
          p.likes = likeMap.get(p.filename) ?? 0;
        });
      } catch (err) { console.error('Failed to load view/like counts:', err.message); }
    }

    res.json({ name: req.params.album, photos, canDelete, canDownload: !!user });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/albums/:album/cover
router.get('/:album/cover', async (req, res) => {
  try {
    safeAlbumPath(req.params.album);
    const photos = await library.getAlbumPhotos(req.params.album);
    if (!photos) return res.status(404).json({ error: 'Not found' });
    const info = await albumInfo.loadAlbumInfo().catch(() => new Map());
    const { cover, coverPreview, coverThumb } = albumInfo.summarize(photos, info.get(req.params.album));
    if (!cover) return res.status(404).json({ error: 'No photos' });
    res.json({ cover, coverPreview, coverThumb });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /api/albums/:album/photos/:filename  (user-facing, requires auth)
router.delete('/:album/photos/:filename', auth.requireAuth, async (req, res) => {
  try {
    const { album, filename } = req.params;
    const { canDelete } = await getAlbumAccess(album, req.user).catch(() => ({ canDelete: false }));
    if (!canDelete) return res.status(403).json({ error: 'Forbidden' });

    const albumPath = safeAlbumPath(album);
    if (!isMedia(filename)) return res.status(400).json({ error: 'Not a photo or video' });
    const filePath = path.resolve(path.join(albumPath, filename));
    if (!filePath.startsWith(albumPath + path.sep)) return res.status(400).json({ error: 'Invalid filename' });
    const fileExists = await fs.promises.access(filePath).then(() => true).catch(() => false);
    if (!fileExists) return res.status(404).json({ error: 'Photo not found' });
    await deletePhotoFiles(album, filename, database);
    res.json({ ok: true });
    activity.log('photo_delete', { username: req.user?.username ?? null, ip: req.ip, details: { album, filename } });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
