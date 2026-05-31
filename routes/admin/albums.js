'use strict';

const crypto   = require('crypto');
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');

const { requireAdmin } = require('../../services/auth');
const { PHOTOS_DIR, PREVIEWS_DIR, MEDIUM_DIR, isImage, preGenerateAll, deletePhotoFiles } = require('../../services/image');
const database = require('../../services/database');
const activity = require('../../services/activity');
const { getAlbumAccess } = require('../../services/access');

const router = express.Router();

const ALBUM_NAME_RE = /^[A-Za-z0-9][^/\\]*$/;

function safeAlbumPath(name) {
  const full = path.resolve(path.join(PHOTOS_DIR, name));
  const base = PHOTOS_DIR + path.sep;
  if (!full.startsWith(base) && full !== PHOTOS_DIR) throw new Error('Invalid album');
  return full;
}

async function deleteAlbumFromDb(album) {
  if (!database.dbReady) return;
  console.log(`  ✕ Album deleted — DB cleanup: ${album}`);
  const q = (sql) => database.db.query(sql, [album]);
  await q('DELETE FROM photo_view_log WHERE album = $1');
  await q('DELETE FROM photo_likes    WHERE album = $1');
  await q('DELETE FROM photo_views    WHERE album = $1');
  await q('DELETE FROM album_users    WHERE album = $1');
  await q('DELETE FROM album_settings WHERE album = $1');
}

// POST /api/admin/albums
router.post('/', requireAdmin, express.json(), async (req, res) => {
  const { name } = req.body ?? {};
  if (!name || !ALBUM_NAME_RE.test(name)) return res.status(400).json({ error: 'Invalid album name' });
  try {
    const albumPath = safeAlbumPath(name);
    const exists = await fs.promises.access(albumPath).then(() => true).catch(() => false);
    if (exists) return res.status(409).json({ error: 'Album already exists' });
    await fs.promises.mkdir(albumPath, { recursive: true });
    res.status(201).json({ ok: true });
    activity.log('album_create', { username: req.user?.username ?? null, ip: req.ip, details: { album: name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/albums/:album
router.patch('/:album', requireAdmin, express.json(), async (req, res) => {
  const { name: newName } = req.body ?? {};
  const oldName = req.params.album;
  if (!newName || !ALBUM_NAME_RE.test(newName)) return res.status(400).json({ error: 'Invalid album name' });
  try {
    const oldPath = safeAlbumPath(oldName);
    const newPath = safeAlbumPath(newName);
    const oldExists = await fs.promises.access(oldPath).then(() => true).catch(() => false);
    if (!oldExists) return res.status(404).json({ error: 'Album not found' });
    const newExists = await fs.promises.access(newPath).then(() => true).catch(() => false);
    if (newExists)  return res.status(409).json({ error: 'Name already taken' });
    await fs.promises.rename(oldPath, newPath);
    for (const base of [PREVIEWS_DIR, MEDIUM_DIR]) {
      const o = path.join(base, oldName);
      const n = path.join(base, newName);
      const oExists = await fs.promises.access(o).then(() => true).catch(() => false);
      if (oExists) await fs.promises.rename(o, n);
    }
    if (database.dbReady) {
      const client = await database.db.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE photo_views    SET album=$1 WHERE album=$2', [newName, oldName]);
        await client.query('UPDATE photo_view_log SET album=$1 WHERE album=$2', [newName, oldName]);
        await client.query('UPDATE photo_likes    SET album=$1 WHERE album=$2', [newName, oldName]);
        await client.query('UPDATE album_settings SET album=$1 WHERE album=$2', [newName, oldName]);
        await client.query('UPDATE album_users    SET album=$1 WHERE album=$2', [newName, oldName]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    res.json({ ok: true });
    activity.log('album_rename', { username: req.user?.username ?? null, ip: req.ip, details: { from: oldName, to: newName } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/albums/:album
router.delete('/:album', requireAdmin, async (req, res) => {
  try {
    const albumPath = safeAlbumPath(req.params.album);
    const albumExists = await fs.promises.access(albumPath).then(() => true).catch(() => false);
    if (!albumExists) return res.status(404).json({ error: 'Album not found' });
    fs.rmSync(albumPath, { recursive: true, force: true });
    for (const base of [PREVIEWS_DIR, MEDIUM_DIR]) {
      const d = path.join(base, req.params.album);
      const dExists = await fs.promises.access(d).then(() => true).catch(() => false);
      if (dExists) fs.rmSync(d, { recursive: true, force: true });
    }
    await deleteAlbumFromDb(req.params.album);
    res.json({ ok: true });
    activity.log('album_delete', { username: req.user?.username ?? null, ip: req.ip, details: { album: req.params.album } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/albums/:album/photos/:filename
router.delete('/:album/photos/:filename', requireAdmin, async (req, res) => {
  try {
    const { album, filename } = req.params;
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

// POST /api/admin/albums/:album/photos (upload)
router.post('/:album/photos', requireAdmin, async (req, res) => {
  let albumPath;
  try {
    albumPath = safeAlbumPath(req.params.album);
    const albumExists = await fs.promises.access(albumPath).then(() => true).catch(() => false);
    if (!albumExists) return res.status(404).json({ error: 'Album not found' });
  } catch {
    return res.status(400).json({ error: 'Invalid album' });
  }

  multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, albumPath),
      filename:    (_req, file,  cb) => cb(null, file.originalname),
    }),
    fileFilter: (_req, file, cb) => cb(null, isImage(file.originalname)),
    limits: { fileSize: 200 * 1024 * 1024 },
  }).array('photos', 500)(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    preGenerateAll().catch(console.error);
    const uploadedFiles = req.files?.map(f => f.originalname) ?? [];
    res.json({ ok: true, count: uploadedFiles.length });
    activity.log('photo_upload', { username: req.user?.username ?? null, ip: req.ip, details: { album: req.params.album, count: uploadedFiles.length, filenames: uploadedFiles } });
  });
});

// GET /api/admin/albums/:album/settings
router.get('/:album/settings', requireAdmin, async (req, res) => {
  if (!database.dbReady) return res.json({ visibility: 'public', users: [] });
  try {
    const [{ rows: settingRows }, { rows: userRows }] = await Promise.all([
      database.db.query('SELECT visibility FROM album_settings WHERE album = $1', [req.params.album]),
      database.db.query(
        `SELECT u.id, u.username FROM album_users au
         JOIN users u ON u.id = au.user_id
         WHERE au.album = $1`,
        [req.params.album],
      ),
    ]);
    res.json({
      visibility: settingRows[0]?.visibility ?? 'public',
      users: userRows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/albums/:album/settings
router.put('/:album/settings', requireAdmin, express.json(), async (req, res) => {
  const { album } = req.params;
  const { visibility, userIds = [] } = req.body ?? {};
  if (!['public', 'restricted'].includes(visibility)) {
    return res.status(400).json({ error: 'visibility must be public or restricted' });
  }
  if (!Array.isArray(userIds) || userIds.length > 500 ||
      userIds.some(id => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'Invalid userIds' });
  }
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });
  try {
    await database.db.query(
      `INSERT INTO album_settings (album, visibility) VALUES ($1, $2)
       ON CONFLICT (album) DO UPDATE SET visibility = $2`,
      [album, visibility],
    );
    await database.db.query('DELETE FROM album_users WHERE album = $1', [album]);
    if (userIds.length > 0) {
      const placeholders = userIds.map((_, i) => `($1, $${i + 2})`).join(', ');
      await database.db.query(
        `INSERT INTO album_users (album, user_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
        [album, ...userIds],
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/albums/:album/share — create share token
router.post('/:album/share', requireAdmin, express.json(), async (req, res) => {
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });
  const { days = 7, label = '' } = req.body ?? {};
  const daysNum = Number(days);
  if (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 365) {
    return res.status(400).json({ error: 'days must be between 1 and 365' });
  }
  try {
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + daysNum * 24 * 60 * 60 * 1000);
    const { rows } = await database.db.query(
      `INSERT INTO share_tokens (token, album, created_by, expires_at, label)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, token, expires_at`,
      [token, req.params.album, req.user.id, expiresAt, label || null],
    );
    res.status(201).json({ id: rows[0].id, token: rows[0].token, expires_at: rows[0].expires_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/albums/:album/share — list share tokens
router.get('/:album/share', requireAdmin, async (req, res) => {
  if (!database.dbReady) return res.json({ tokens: [] });
  try {
    const { rows } = await database.db.query(
      `SELECT id, token, label, created_at, expires_at
       FROM share_tokens WHERE album = $1 ORDER BY created_at DESC`,
      [req.params.album],
    );
    res.json({ tokens: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/albums/:album/share/:id — revoke share token
router.delete('/:album/share/:id', requireAdmin, async (req, res) => {
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await database.db.query(
      'DELETE FROM share_tokens WHERE id = $1 AND album = $2',
      [id, req.params.album],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
