// @ts-check
'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const yazl      = require('yazl');

const { PHOTOS_DIR, isImage, isMedia, deletePhotoFiles } = require('../services/image');
const library  = require('../services/library');
const overrides = require('../services/overrides');
const albumInfo = require('../services/album-info');
const gpsPrivacy = require('../services/gps-privacy');
const database = require('../services/database');
const auth     = require('../services/auth');
const activity = require('../services/activity');
const uploads  = require('../services/uploads');
const articles = require('../services/articles');
const { resolveUser, getAlbumAccess, filterVisibleAlbums, canManageAlbum } = require('../services/access');
const profiles = require('../services/profiles');

const { BadRequest, sendError, requireWritableLibrary } = require('../services/http-errors');

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
    await fs.promises.mkdir(PHOTOS_DIR, { recursive: true });
    // no synchronous file access while serving a request (T7)
    const entries = (await library.listAlbums()).map(name => ({ name, isDirectory: () => true }));

    const user = await resolveUser(req.cookies?.pb_session);
    const { filtered, visibilityMap, ownerMap, authorizedSet } = await filterVisibleAlbums(entries, user);
    // who made each album (its card says so, unless it is the admin's)
    const owners = await profiles.byIds([...new Set(filtered.map((e) => ownerMap.get(e.name)).filter(Boolean))])
      .catch(() => new Map());

    const info = await albumInfo.loadAlbumInfo()
      .catch((err) => { console.error('Failed to load album info:', err.message); return new Map(); });
    const counts = await articles.counts()
      .catch((err) => { console.error('Failed to count articles:', err.message); return new Map(); });
    const visible = new Set(filtered.map((e) => e.name));
    // Photo metadata comes from the cached library index (cover, date range).
    const albums = await Promise.all(filtered.map(async e => {
      const photos = (await library.getAlbumPhotos(e.name)) ?? [];
      const { coverFile, ...summary } = albumInfo.summarize(photos, info.get(e.name));
      const visibility = visibilityMap.get(e.name) ?? 'public';
      const ownerId    = ownerMap.get(e.name) ?? null;
      const canManage  = canManageAlbum(user, ownerId);
      const canDelete  = canManage || (!!user && visibility === 'restricted' && authorizedSet.has(e.name));
      const o = ownerId ? owners.get(ownerId) : null;
      const owner = o ? { username: o.username, displayName: o.displayName, admin: o.role === 'admin' } : null;
      const n = counts.get(e.name) ?? { published: 0, drafts: 0 };
      const album = { name: e.name, ...summary, visibility, owner, canDelete, canManage, articles: n.published, ...(canManage && { drafts: n.drafts }) };
      // an album of articles only: its latest article's picture on the card
      if (!album.cover && n.published) Object.assign(album, await articleCover(e.name, visible));
      return album;
    }));

    res.json(albums);
  } catch (err) {
    sendError(res, err);
  }
});

// { cover, coverPreview, coverThumb } of the album's latest article with a
// picture the reader may see (its albums among `visible`), or {}.
async function articleCover(album, visible) {
  const list = await articles.listForAlbum(album).catch(() => []);
  const photos = await articles.resolvePhotos(list.flatMap((a) => articles.photoRefs(a)), async (name) => visible.has(name));
  for (const a of list.reverse()) {
    const c = articles.card(a, photos).cover;
    if (c?.thumbUrl) return { cover: c.url, coverPreview: c.previewUrl, coverThumb: c.thumbUrl };
  }
  return {};
}

// GET /api/albums/:album/download/zip
router.get('/:album/download/zip', async (req, res) => {
  try {
    const albumPath = safeAlbumPath(req.params.album);
    if (!await library.albumExists(req.params.album)) return res.status(404).json({ error: 'Not found' });

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

    const files = (await library.listPhotos(req.params.album)) ?? [];
    if (!files.length) return res.status(404).json({ error: 'Album is empty' });

    // Albums with a hidden / approximate position: images without their EXIF (F10).
    // The copies are made before the response starts, so an error is still a status.
    const exact = await gpsPrivacy.exactFor(req.params.album, user);
    const entries = [];
    for (const file of files) {
      entries.push(exact || !isImage(file)
        ? { from: path.join(albumPath, file), name: file }
        : { from: await gpsPrivacy.cleanCopy(req.params.album, file), name: gpsPrivacy.cleanName(file) });
    }

    const albumName   = req.params.album;
    const asciiName   = albumName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    const encodedName = encodeURIComponent(albumName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}.zip"; filename*=UTF-8''${encodedName}.zip`,
    );

    // Stored, not deflated: photos and videos are compressed already. A file
    // deleted meanwhile is left out (the archive is streamed, it can't fail
    // half-way with a status any more).
    const zip = new yazl.ZipFile();
    zip.outputStream.on('error', (err) => { console.error('Archive error:', err); res.destroy(err); });
    zip.outputStream.pipe(res);
    for (const { from, name } of entries) {
      const stat = await fs.promises.stat(from).catch(() => null);
      if (stat?.isFile()) zip.addFile(from, name, { compress: false, mtime: stat.mtime });
    }
    zip.end();
  } catch (err) {
    if (!res.headersSent) sendError(res, err);
    else console.error(err);
  }
});

// GET /api/albums/:album
router.get('/:album', async (req, res) => {
  try {
    safeAlbumPath(req.params.album);
    if (!await library.albumExists(req.params.album)) return res.status(404).json({ error: 'Not found' });

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
    const edited = ((await library.getAlbumPhotos(req.params.album)) ?? [])
      .map((p) => overrides.applyOverride(p, ovs.get(`${req.params.album}/${p.filename}`)));
    // position rounded or removed when the album asks for it (F10)
    const photos = await gpsPrivacy.protectAll(req.params.album, edited, user);

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

    const writable = await library.isWritable();
    // the same rights add photos from the viewer (POST …/photos below)
    res.json({ name: req.params.album, photos, canDelete: canDelete && writable, canUpload: canDelete && writable, canDownload: !!user });
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

// POST /api/albums/:album/photos  (user-facing upload, requires auth) — the
// admin, or a member of a restricted album they may change (the same right as
// deleting its photos); the files are handled like the admin's uploads.
router.post('/:album/photos', auth.requireAuth, requireWritableLibrary, async (req, res) => {
  try {
    const { album } = req.params;
    const albumPath = safeAlbumPath(album);
    if (!await library.albumExists(album)) return res.status(404).json({ error: 'Album not found' });
    const { canDelete } = await getAlbumAccess(album, req.user).catch(() => ({ canDelete: false }));
    if (!canDelete) return res.status(403).json({ error: 'Forbidden' });
    uploads.receive(req, res, albumPath);
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /api/albums/:album/photos/:filename  (user-facing, requires auth)
router.delete('/:album/photos/:filename', auth.requireAuth, requireWritableLibrary, async (req, res) => {
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
