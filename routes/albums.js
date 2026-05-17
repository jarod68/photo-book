'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');

const { PHOTOS_DIR, PREVIEWS_DIR, MEDIUM_DIR, isImage, ensurePreview, photoMeta, deletePhotoFiles } = require('../services/image');
const database = require('../services/database');
const auth     = require('../services/auth');
const activity = require('../services/activity');
const { resolveUser, getAlbumAccess, filterVisibleAlbums } = require('../services/access');

const router = express.Router();

function safeAlbumPath(name) {
  const full = path.resolve(path.join(PHOTOS_DIR, name));
  const base = PHOTOS_DIR + path.sep;
  if (!full.startsWith(base) && full !== PHOTOS_DIR) throw new Error('Invalid album');
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

    const albums = await Promise.all(filtered.map(async e => {
      const files = fs.readdirSync(path.join(PHOTOS_DIR, e.name)).filter(isImage).sort();
      const firstFile = files[0];
      let cover = null;
      let coverPreview = null;
      if (firstFile) {
        cover = `/photos/${encodeURIComponent(e.name)}/${encodeURIComponent(firstFile)}`;
        const coverPath = path.join(PHOTOS_DIR, e.name, firstFile);
        coverPreview = await ensurePreview(e.name, firstFile, coverPath, false).catch(() => null);
      }
      const visibility = visibilityMap.get(e.name) ?? 'public';
      const canDelete  = user?.role === 'admin' || (user?.role === 'basic' && authorizedSet.has(e.name));
      return { name: e.name, count: files.length, cover, coverPreview, visibility, canDelete };
    }));

    res.json(albums);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/albums/:album
router.get('/:album', async (req, res) => {
  try {
    const albumPath = safeAlbumPath(req.params.album);
    if (!fs.existsSync(albumPath)) return res.status(404).json({ error: 'Not found' });

    const user = await resolveUser(req.cookies?.pb_session);
    const { allowed, canDelete } = await getAlbumAccess(req.params.album, user)
      .catch(() => ({ allowed: true, canDelete: false }));
    if (!allowed) return res.status(401).json({ error: 'Unauthorized' });

    const files  = fs.readdirSync(albumPath).filter(isImage).sort();
    const photos = await Promise.all(files.map(f => photoMeta(req.params.album, f, albumPath)));

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
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/albums/:album/cover
router.get('/:album/cover', async (req, res) => {
  try {
    const albumPath = safeAlbumPath(req.params.album);
    if (!fs.existsSync(albumPath)) return res.status(404).json({ error: 'Not found' });
    const files = fs.readdirSync(albumPath).filter(isImage).sort();
    if (!files.length) return res.status(404).json({ error: 'No photos' });
    const firstFile = files[0];
    const coverPath = path.join(PHOTOS_DIR, req.params.album, firstFile);
    const preview   = await ensurePreview(req.params.album, firstFile, coverPath, false).catch(() => null);
    res.json({
      cover:        `/photos/${encodeURIComponent(req.params.album)}/${encodeURIComponent(firstFile)}`,
      coverPreview: preview,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/albums/:album/photos/:filename  (user-facing, requires auth)
router.delete('/:album/photos/:filename', auth.requireAuth, async (req, res) => {
  try {
    const { album, filename } = req.params;
    const { canDelete } = await getAlbumAccess(album, req.user).catch(() => ({ canDelete: false }));
    if (!canDelete) return res.status(403).json({ error: 'Forbidden' });

    const albumPath = safeAlbumPath(album);
    if (!isImage(filename)) return res.status(400).json({ error: 'Not an image' });
    const filePath = path.resolve(path.join(albumPath, filename));
    if (!filePath.startsWith(albumPath + path.sep)) return res.status(400).json({ error: 'Invalid filename' });
    const fileExists = await fs.promises.access(filePath).then(() => true).catch(() => false);
    if (!fileExists) return res.status(404).json({ error: 'Photo not found' });
    await deletePhotoFiles(album, filename, database);
    res.json({ ok: true });
    activity.log('photo_delete', { username: req.user?.username ?? null, ip: req.ip, details: { album, filename } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
