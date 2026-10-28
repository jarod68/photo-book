'use strict';

const crypto   = require('crypto');
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');

const { requireAdmin } = require('../../services/auth');
const { PHOTOS_DIR, PREVIEWS_DIR, MEDIUM_DIR, isImage, isMedia, preGenerateAll, deletePhotoFiles } = require('../../services/image');
const database = require('../../services/database');
const activity = require('../../services/activity');
const { getAlbumAccess } = require('../../services/access');
const library   = require('../../services/library');
const overrides = require('../../services/overrides');
const cleanup   = require('../../services/cleanup');
const albumInfo = require('../../services/album-info');
const uploads   = require('../../services/uploads');
const notify    = require('../../services/notify');
const gpsPrivacy = require('../../services/gps-privacy');

const { BadRequest, sendError, requireWritableLibrary } = require('../../services/http-errors');

const router = express.Router();

// Must start alphanumeric (matches isAlbumDir); excludes path separators and
// HTML-significant characters since album names are rendered in the UI.
// eslint-disable-next-line no-control-regex
const ALBUM_NAME_RE = /^[A-Za-z0-9][^/\\<>&"'`\x00-\x1f]*$/;

function safeAlbumPath(name) {
  const full = path.resolve(path.join(PHOTOS_DIR, name));
  const base = PHOTOS_DIR + path.sep;
  if (!full.startsWith(base) && full !== PHOTOS_DIR) throw new BadRequest('Invalid album');
  return full;
}

async function deleteAlbumFromDb(album) {
  if (!database.dbReady) return;
  console.log(`  ✕ Album deleted — DB cleanup: ${album}`);
  await cleanup.deleteAlbumRows(database.db, album);
}

// POST /api/admin/albums
router.post('/', requireAdmin, requireWritableLibrary, express.json(), async (req, res) => {
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
    sendError(res, err);
  }
});

// PATCH /api/admin/albums/:album
router.patch('/:album', requireAdmin, requireWritableLibrary, express.json(), async (req, res) => {
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
        await cleanup.renameAlbumRows(client, oldName, newName);
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
    sendError(res, err);
  }
});

// DELETE /api/admin/albums/:album
router.delete('/:album', requireAdmin, requireWritableLibrary, async (req, res) => {
  try {
    const albumPath = safeAlbumPath(req.params.album);
    const albumExists = await fs.promises.access(albumPath).then(() => true).catch(() => false);
    if (!albumExists) return res.status(404).json({ error: 'Album not found' });
    await fs.promises.rm(albumPath, { recursive: true, force: true });
    for (const base of [PREVIEWS_DIR, MEDIUM_DIR]) {
      await fs.promises.rm(path.join(base, req.params.album), { recursive: true, force: true });
    }
    await deleteAlbumFromDb(req.params.album);
    res.json({ ok: true });
    activity.log('album_delete', { username: req.user?.username ?? null, ip: req.ip, details: { album: req.params.album } });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /api/admin/albums/:album/photos/:filename
router.delete('/:album/photos/:filename', requireAdmin, requireWritableLibrary, async (req, res) => {
  try {
    const { album, filename } = req.params;
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

// GET /api/admin/albums/:album/photos — every photo with its file metadata
// and its admin overrides (photo editor).
router.get('/:album/photos', requireAdmin, async (req, res) => {
  try {
    safeAlbumPath(req.params.album);
    const photos = await library.getAlbumPhotos(req.params.album);
    if (!photos) return res.status(404).json({ error: 'Album not found' });
    const [ovs, info] = await Promise.all([overrides.loadOverrides([req.params.album]), albumInfo.loadAlbumInfo()]);
    const { coverFile, description } = albumInfo.summarize(photos, info.get(req.params.album));
    res.json({
      album:  { cover: coverFile, chosenCover: info.get(req.params.album)?.cover ?? null, description },
      photos: photos.map((p) => overrides.applyOverride(p, ovs.get(`${req.params.album}/${p.filename}`), { withOriginal: true })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /api/admin/albums/:album/photos/:filename/meta — { title, description, location }
// A null or empty field reverts to the value stored in the file.
router.put('/:album/photos/:filename/meta', requireAdmin, express.json(), async (req, res) => {
  const { album, filename } = req.params;
  const { values, error } = overrides.parseOverride(req.body);
  if (error) return res.status(400).json({ error });
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });
  try {
    const albumPath = safeAlbumPath(album);
    if (!isMedia(filename)) return res.status(400).json({ error: 'Not a photo or video' });
    const filePath = path.resolve(path.join(albumPath, filename));
    if (!filePath.startsWith(albumPath + path.sep)) return res.status(400).json({ error: 'Invalid filename' });
    const fileExists = await fs.promises.access(filePath).then(() => true).catch(() => false);
    if (!fileExists) return res.status(404).json({ error: 'Photo not found' });
    await overrides.saveOverride(album, filename, values);
    res.json({ ok: true, override: values });
    activity.log('photo_edit', { username: req.user?.username ?? null, ip: req.ip, details: { album, filename } });
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /api/admin/albums/:album/details — { cover, description }
// cover: a photo of the album, or null for the first readable photo.
router.put('/:album/details', requireAdmin, express.json(), async (req, res) => {
  const { album } = req.params;
  const { cover = null, description = null } = req.body ?? {};
  if (cover !== null && (typeof cover !== 'string' || !isImage(cover))) return res.status(400).json({ error: 'cover must be a photo' });
  if (description !== null && typeof description !== 'string') return res.status(400).json({ error: 'description must be a string' });
  const desc = description?.trim() || null;
  if (desc && desc.length > albumInfo.DESCRIPTION_MAX) return res.status(400).json({ error: 'description is too long' });
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });
  try {
    const albumPath = safeAlbumPath(album);
    if (!await fs.promises.access(albumPath).then(() => true, () => false)) return res.status(404).json({ error: 'Album not found' });
    if (cover) {
      const coverPath = path.resolve(albumPath, cover);
      if (path.dirname(coverPath) !== albumPath) return res.status(400).json({ error: 'Invalid cover' });
      if (!await fs.promises.access(coverPath).then(() => true, () => false)) return res.status(404).json({ error: 'Photo not found' });
    }
    await albumInfo.saveAlbumInfo(album, { cover, description: desc });
    res.json({ ok: true, cover, description: desc });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/admin/albums/:album/photos (upload)
router.post('/:album/photos', requireAdmin, requireWritableLibrary, async (req, res) => {
  let albumPath;
  try {
    albumPath = safeAlbumPath(req.params.album);
    const albumExists = await fs.promises.access(albumPath).then(() => true).catch(() => false);
    if (!albumExists) return res.status(404).json({ error: 'Album not found' });
  } catch {
    return res.status(400).json({ error: 'Invalid album' });
  }

  // Never overwrite (F7): a taken name gets a " (2)" suffix, see services/uploads.js.
  const reserved = new Set();
  const skipped  = [];
  multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, albumPath),
      filename: (_req, file, cb) => {
        // basename strips any client-supplied path components (e.g. "../../x.jpg")
        file.wanted = path.basename(file.originalname);
        try {
          const name = uploads.uniqueName(albumPath, file.wanted, reserved);
          reserved.add(name.toLowerCase());
          cb(null, name);
        } catch (e) { cb(e); }
      },
    }),
    fileFilter: (_req, file, cb) => {
      const ok = isMedia(file.originalname);
      if (!ok) skipped.push(path.basename(file.originalname));
      cb(null, ok);
    },
    limits: { fileSize: 200 * 1024 * 1024 },
    defParamCharset: 'utf8',   // browsers send UTF-8 file names ("défilé.jpg")
  }).array('photos', 500)(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message });   // multer removes the batch's files
    const renamed = [], duplicates = [], uploadedFiles = [];
    for (const f of req.files ?? []) {
      if (f.filename !== f.wanted && await uploads.sameContent(f.path, path.join(albumPath, f.wanted))) {
        await fs.promises.unlink(f.path).catch(() => {});
        duplicates.push(f.wanted);
        continue;
      }
      if (f.filename !== f.wanted) renamed.push({ from: f.wanted, to: f.filename });
      uploadedFiles.push(f.filename);
    }
    preGenerateAll().catch(console.error);
    res.json({ ok: true, count: uploadedFiles.length, files: uploadedFiles, renamed, duplicates, skipped });
    activity.log('photo_upload', { username: req.user?.username ?? null, ip: req.ip, details: { album: req.params.album, count: uploadedFiles.length, filenames: uploadedFiles } });
    // one digest per album once the uploads stop (services/notify.js)
    notify.photosAdded(req.params.album, uploadedFiles);
  });
});

// GET /api/admin/albums/:album/settings
router.get('/:album/settings', requireAdmin, async (req, res) => {
  if (!database.dbReady) return res.json({ visibility: 'public', users: [], notifyNew: true, gpsPrivacy: 'exact' });
  try {
    const [{ rows: settingRows }, { rows: userRows }] = await Promise.all([
      database.db.query('SELECT visibility, notify_new, gps_privacy FROM album_settings WHERE album = $1', [req.params.album]),
      database.db.query(
        `SELECT u.id, u.username FROM album_users au
         JOIN users u ON u.id = au.user_id
         WHERE au.album = $1`,
        [req.params.album],
      ),
    ]);
    res.json({
      visibility: settingRows[0]?.visibility ?? 'public',
      notifyNew:  settingRows[0]?.notify_new ?? true,
      gpsPrivacy: settingRows[0]?.gps_privacy ?? 'exact',
      users: userRows,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /api/admin/albums/:album/settings
router.put('/:album/settings', requireAdmin, express.json(), async (req, res) => {
  const { album } = req.params;
  const { visibility, userIds = [], notifyNew = true, gpsPrivacy: privacy = 'exact' } = req.body ?? {};
  if (!['public', 'restricted'].includes(visibility)) {
    return res.status(400).json({ error: 'visibility must be public or restricted' });
  }
  if (typeof notifyNew !== 'boolean') return res.status(400).json({ error: 'notifyNew must be a boolean' });
  if (!gpsPrivacy.MODES.includes(privacy)) return res.status(400).json({ error: `gpsPrivacy must be one of ${gpsPrivacy.MODES.join(', ')}` });
  if (!Array.isArray(userIds) || userIds.length > 500 ||
      userIds.some(id => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'Invalid userIds' });
  }
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });
  try {
    await database.db.query(
      `INSERT INTO album_settings (album, visibility, notify_new, gps_privacy) VALUES ($1, $2, $3, $4)
       ON CONFLICT (album) DO UPDATE SET visibility = $2, notify_new = $3, gps_privacy = $4`,
      [album, visibility, notifyNew, privacy],
    );
    await database.db.query('DELETE FROM album_users WHERE album = $1', [album]);
    if (userIds.length > 0) {
      const placeholders = userIds.map((_, i) => `($1, $${i + 2})`).join(', ');
      await database.db.query(
        `INSERT INTO album_users (album, user_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
        [album, ...userIds],
      );
    }
    gpsPrivacy.invalidate();   // applies at once, not after the cache's minute
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
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
    sendError(res, err);
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
    sendError(res, err);
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
    sendError(res, err);
  }
});

// ── Push notification admin routes ────────────────────────────────────────────

const push = require('../../services/push');

// GET /api/admin/albums/:album/subscribers
router.get('/:album/subscribers', requireAdmin, async (req, res) => {
  if (!database.dbReady) return res.json({ count: 0, subscribers: [] });
  try {
    const { rows } = await database.db.query(
      `SELECT id, endpoint, user_agent, subscribed_at
       FROM push_subscriptions WHERE album = $1 ORDER BY subscribed_at DESC`,
      [req.params.album],
    );
    res.json({
      count: rows.length,
      subscribers: rows.map(r => ({
        id:           r.id,
        endpoint_short: r.endpoint.slice(-20),
        user_agent:   r.user_agent,
        subscribed_at: r.subscribed_at,
      })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /api/admin/albums/:album/subscribers/:id
router.delete('/:album/subscribers/:id', requireAdmin, async (req, res) => {
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await database.db.query(
      'DELETE FROM push_subscriptions WHERE id = $1 AND album = $2',
      [id, req.params.album],
    );
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/admin/albums/:album/notify
router.post('/:album/notify', requireAdmin, express.json(), async (req, res) => {
  const { title, body } = req.body ?? {};
  if (!title && !body) return res.status(400).json({ error: 'title or body required' });
  try {
    const sent = await push.sendToAlbum(req.params.album, { title: title ?? '', body: body ?? '' });
    res.json({ ok: true, sent });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
