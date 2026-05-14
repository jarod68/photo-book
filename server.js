const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const exifr        = require('exifr');
const cookieParser = require('cookie-parser');

const multer     = require('multer');
const { PHOTOS_DIR, PREVIEWS_DIR, MEDIUM_DIR, isImage, isAlbumDir, ensurePreview, photoMeta, preGenerateAll } = require('./services/image');
const database   = require('./services/database'); // database.db, database.dbReady (getters)
const auth       = require('./services/auth');
const dockerInfo = require('./services/docker-info');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cookieParser());

const { requireAuth, authStaticGuard } = auth;

// ─── Reverse geocoding cache (in-memory) ─────────────────────────────────────
const geoCache = new Map(); // key: "lat,lng" → location string | null
const GEO_MAX  = 2000;

// ─── Static files ─────────────────────────────────────────────────────────────

// Medium (720p): generated once, never mutated → immutable 1 year
app.use('/medium', express.static(path.join(__dirname, 'public', 'medium'), {
  maxAge: '1y',
  immutable: true,
  etag: false,
  lastModified: false,
}));

// Previews: generated once, never mutated → immutable 1 year
app.use('/previews', express.static(path.join(__dirname, 'public', 'previews'), {
  maxAge: '1y',
  immutable: true,
  etag: false,
  lastModified: false,
}));

// App assets: login.html is public; other HTML pages require auth.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));

// Original photos: immutable 1 year (files are never overwritten on disk)
app.use('/photos', (req, res, next) => {
  const target = path.resolve(path.join(PHOTOS_DIR, decodeURIComponent(req.path)));
  if (!target.startsWith(PHOTOS_DIR)) return res.status(403).end();
  next();
}, express.static(PHOTOS_DIR, {
  maxAge: '1y',
  immutable: true,
  etag: false,
  lastModified: false,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeAlbumPath(name) {
  const full = path.resolve(path.join(PHOTOS_DIR, name));
  const base = PHOTOS_DIR + path.sep;
  if (!full.startsWith(base) && full !== PHOTOS_DIR) throw new Error('Invalid album');
  return full;
}

// ─── Auth routes (public) ─────────────────────────────────────────────────────

app.post('/api/auth/login', express.json(), async (req, res) => {
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  try {
    const token = await auth.login(username, password);
    if (!token) return res.status(401).json({ error: 'Invalid credentials' });
    res.cookie('pb_session', token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   30 * 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies.pb_session;
  if (token && database.dbReady) await auth.logout(token).catch(() => {});
  res.clearCookie('pb_session');
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  if (!database.dbReady) return res.json({ user: null });
  const token = req.cookies.pb_session;
  if (!token) return res.json({ user: null });
  const user = await auth.getSessionUser(token).catch(() => null);
  res.json({ user: user ? { username: user.username, role: user.role } : null });
});

// Admin routes require authentication
app.use('/api/admin', requireAuth);

// ─── Admin routes ─────────────────────────────────────────────────────────────

app.get('/api/admin/stats', async (req, res) => {
  try {
    // Filesystem is the source of truth for album existence
    const entries = fs.existsSync(PHOTOS_DIR)
      ? fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(isAlbumDir)
      : [];
    const fsMap = new Map(entries.map(e => [
      e.name,
      fs.readdirSync(path.join(PHOTOS_DIR, e.name)).filter(isImage).length,
    ]));

    let viewMap = new Map();
    let likeMap = new Map();
    if (database.dbReady) {
      const [{ rows: viewRows }, { rows: likeRows }] = await Promise.all([
        database.db.query('SELECT album, SUM(views) AS views FROM photo_views GROUP BY album'),
        database.db.query('SELECT album, COUNT(*) AS likes FROM photo_likes GROUP BY album'),
      ]);
      viewMap = new Map(viewRows.map(r => [r.album, Number(r.views)]));
      likeMap = new Map(likeRows.map(r => [r.album, Number(r.likes)]));
    }

    const albums = [...fsMap.entries()].map(([album, photos]) => ({
      album,
      photos,
      views: viewMap.get(album) ?? 0,
      likes: likeMap.get(album) ?? 0,
    })).sort((a, b) => b.views - a.views || a.album.localeCompare(b.album));

    res.json({ albums });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/system', async (req, res) => {
  let containers = [];
  try { containers = await dockerInfo.getContainers(); } catch (_) {}
  res.json({
    node:       process.version,
    uptime:     Math.floor(process.uptime()),
    containers,
  });
});

app.get('/api/admin/top-photos', async (req, res) => {
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

const ALBUM_NAME_RE = /^[A-Za-z0-9][^/\\]*$/;

app.post('/api/admin/albums', express.json(), async (req, res) => {
  const { name } = req.body ?? {};
  if (!name || !ALBUM_NAME_RE.test(name)) return res.status(400).json({ error: 'Invalid album name' });
  try {
    const albumPath = safeAlbumPath(name);
    if (fs.existsSync(albumPath)) return res.status(409).json({ error: 'Album already exists' });
    fs.mkdirSync(albumPath, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/admin/albums/:album', express.json(), async (req, res) => {
  const { name: newName } = req.body ?? {};
  const oldName = req.params.album;
  if (!newName || !ALBUM_NAME_RE.test(newName)) return res.status(400).json({ error: 'Invalid album name' });
  try {
    const oldPath = safeAlbumPath(oldName);
    const newPath = safeAlbumPath(newName);
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Album not found' });
    if (fs.existsSync(newPath))  return res.status(409).json({ error: 'Name already taken' });
    fs.renameSync(oldPath, newPath);
    for (const base of [PREVIEWS_DIR, MEDIUM_DIR]) {
      const o = path.join(base, oldName);
      const n = path.join(base, newName);
      if (fs.existsSync(o)) fs.renameSync(o, n);
    }
    if (database.dbReady) {
      await Promise.all([
        database.db.query('UPDATE photo_views    SET album=$1 WHERE album=$2', [newName, oldName]),
        database.db.query('UPDATE photo_view_log SET album=$1 WHERE album=$2', [newName, oldName]),
        database.db.query('UPDATE photo_likes    SET album=$1 WHERE album=$2', [newName, oldName]),
      ]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/albums/:album', async (req, res) => {
  try {
    const albumPath = safeAlbumPath(req.params.album);
    if (!fs.existsSync(albumPath)) return res.status(404).json({ error: 'Album not found' });
    fs.rmSync(albumPath, { recursive: true, force: true });
    for (const base of [PREVIEWS_DIR, MEDIUM_DIR]) {
      const d = path.join(base, req.params.album);
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
    await deleteAlbumFromDb(req.params.album);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/albums/:album/photos/:filename', async (req, res) => {
  try {
    const { album, filename } = req.params;
    const albumPath = safeAlbumPath(album);
    if (!isImage(filename)) return res.status(400).json({ error: 'Not an image' });
    const filePath = path.resolve(path.join(albumPath, filename));
    if (!filePath.startsWith(albumPath + path.sep)) return res.status(400).json({ error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Photo not found' });
    fs.unlinkSync(filePath);
    const previewName = path.parse(filename).name + '.jpg';
    for (const base of [PREVIEWS_DIR, MEDIUM_DIR]) {
      const p = path.join(base, album, previewName);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    await deletePhotoFromDb(album, filename);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/albums/:album/photos', (req, res) => {
  let albumPath;
  try {
    albumPath = safeAlbumPath(req.params.album);
    if (!fs.existsSync(albumPath)) return res.status(404).json({ error: 'Album not found' });
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
    res.json({ ok: true, count: req.files?.length ?? 0 });
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/albums', async (req, res) => {
  try {
    if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

    const entries = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(isAlbumDir);

    const albums = await Promise.all(entries.map(async e => {
      const files = fs.readdirSync(path.join(PHOTOS_DIR, e.name)).filter(isImage).sort();
      const firstFile = files[0];
      let cover = null;
      let coverPreview = null;
      if (firstFile) {
        cover = `/photos/${encodeURIComponent(e.name)}/${encodeURIComponent(firstFile)}`;
        const coverPath = path.join(PHOTOS_DIR, e.name, firstFile);
        coverPreview = await ensurePreview(e.name, firstFile, coverPath, false).catch(() => null);
      }
      return { name: e.name, count: files.length, cover, coverPreview };
    }));

    res.json(albums);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/albums/:album', async (req, res) => {
  try {
    const albumPath = safeAlbumPath(req.params.album);
    if (!fs.existsSync(albumPath)) return res.status(404).json({ error: 'Not found' });

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
      } catch (_) {}
    }

    res.json({ name: req.params.album, photos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Global map — all GPS photos across all albums ────────────────────────────

app.get('/api/map', async (req, res) => {
  if (!fs.existsSync(PHOTOS_DIR)) return res.json([]);
  try {
    const albumDirs = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(isAlbumDir);

    const buckets = await Promise.all(albumDirs.map(async dir => {
      const albumPath = path.join(PHOTOS_DIR, dir.name);
      const files     = fs.readdirSync(albumPath).filter(isImage).sort();
      const photos    = [];

      await Promise.all(files.map(async (file, albumIndex) => {
        try {
          const filePath = path.join(albumPath, file);
          const [g, tags] = await Promise.all([
            exifr.gps(filePath),
            exifr.parse(filePath, ['DateTimeOriginal', 'CreateDate']).catch(() => null),
          ]);
          if (!g?.latitude) return;

          const previewName = path.parse(file).name + '.jpg';
          const previewPath = path.join(PREVIEWS_DIR, dir.name, previewName);
          const previewUrl  = fs.existsSync(previewPath)
            ? `/previews/${encodeURIComponent(dir.name)}/${encodeURIComponent(previewName)}`
            : null;

          const rawDate = tags?.DateTimeOriginal ?? tags?.CreateDate ?? null;

          photos.push({
            gps:        { lat: +g.latitude.toFixed(6), lng: +g.longitude.toFixed(6) },
            date:       rawDate instanceof Date ? rawDate.toISOString() : null,
            name:       path.basename(file, path.extname(file)),
            filename:   file,
            previewUrl,
            url:        `/photos/${encodeURIComponent(dir.name)}/${encodeURIComponent(file)}`,
            album:      dir.name,
            albumIndex,
          });
        } catch (_) {}
      }));

      return photos;
    }));

    res.json(buckets.flat());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Vues ─────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.post('/api/view', express.json(), async (req, res) => {
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

// ─── Likes ────────────────────────────────────────────────────────────────────

app.post('/api/like', express.json(), async (req, res) => {
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
    res.json({ liked: existing.rowCount === 0, count: Number(rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/liked', async (req, res) => {
  if (!database.dbReady) return res.json({ filenames: [] });
  const { album, token } = req.query;
  if (!album || !token || !UUID_RE.test(token)) return res.json({ filenames: [] });
  try {
    const { rows } = await database.db.query(
      'SELECT filename FROM photo_likes WHERE album = $1 AND user_token = $2',
      [album, token],
    );
    res.json({ filenames: rows.map(r => r.filename) });
  } catch (_) {
    res.json({ filenames: [] });
  }
});

// ─── Reverse geocoding (Nominatim proxy) ─────────────────────────────────────

app.get('/api/geocode', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (geoCache.has(key)) return res.json({ location: geoCache.get(key) });

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&accept-language=fr`;
    const raw = await fetch(url, {
      headers: { 'User-Agent': 'photo-book/1.0 (self-hosted personal use)' },
    });
    const data     = await raw.json();
    const a        = data.address || {};
    const place    = a.village || a.suburb || a.town || a.city_district || a.city || a.municipality || a.county || '';
    const country  = a.country || '';
    const location = [place, country].filter(Boolean).join(', ') || null;
    if (geoCache.size >= GEO_MAX) geoCache.delete(geoCache.keys().next().value);
    geoCache.set(key, location);
    res.json({ location });
  } catch (err) {
    console.error('Geocode error:', err.message);
    res.json({ location: null });
  }
});

// ─── File watching ────────────────────────────────────────────────────────────

async function deletePhotoFromDb(album, filename) {
  if (!database.dbReady) return;
  console.log(`  ✕ Photo deleted — DB cleanup: ${album}/${filename}`);
  const q = (sql) => database.db.query(sql, [album, filename]);
  await q('DELETE FROM photo_view_log WHERE album = $1 AND filename = $2');
  await q('DELETE FROM photo_likes    WHERE album = $1 AND filename = $2');
  await q('DELETE FROM photo_views    WHERE album = $1 AND filename = $2');
}

async function deleteAlbumFromDb(album) {
  if (!database.dbReady) return;
  console.log(`  ✕ Album deleted — DB cleanup: ${album}`);
  const q = (sql) => database.db.query(sql, [album]);
  await q('DELETE FROM photo_view_log WHERE album = $1');
  await q('DELETE FROM photo_likes    WHERE album = $1');
  await q('DELETE FROM photo_views    WHERE album = $1');
}

function watchPhotosDir() {
  if (!fs.existsSync(PHOTOS_DIR)) return;

  let debounceTimer = null;
  const scheduleRegenerate = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log('  ↻ New photos detected — generating thumbnails…');
      preGenerateAll().catch(console.error);
    }, 2_000);
  };

  const watchAlbum = (albumPath, albumName) => {
    try {
      fs.watch(albumPath, (_event, name) => {
        if (!name || !isImage(name)) return;
        const full = path.join(albumPath, name);
        if (fs.existsSync(full)) {
          scheduleRegenerate();
        } else {
          deletePhotoFromDb(albumName, name).catch(console.error);
        }
      });
    } catch (_) {}
  };

  try {
    fs.watch(PHOTOS_DIR, (_event, name) => {
      if (!name) return;
      setTimeout(() => {
        try {
          const full = path.join(PHOTOS_DIR, name);
          if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
            // New album detected
            scheduleRegenerate();
            watchAlbum(full, name);
          } else if (!fs.existsSync(full)) {
            // Album deleted
            deleteAlbumFromDb(name).catch(console.error);
          }
        } catch (_) {}
      }, 500);
    });
  } catch (err) {
    console.warn('  ⚠ Photo watcher unavailable:', err.message);
    return;
  }

  fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })
    .filter(isAlbumDir)
    .forEach(a => watchAlbum(path.join(PHOTOS_DIR, a.name), a.name));

  console.log('  ✓ Photo watcher started.');
}

// ─── Start ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  360° Photo Viewer`);
    console.log(`  ➜  http://localhost:${PORT}`);
    console.log(`  Photos:   ${PHOTOS_DIR}`);
    console.log(`  Previews: ${PREVIEWS_DIR}\n`);
    database.connectDb()
      .then(() => auth.ensureAdmin())
      .then(() => database.syncPhotosToDb())
      .catch(console.error);
    preGenerateAll().catch(console.error);
    watchPhotosDir();
  });
}

module.exports = { app };
