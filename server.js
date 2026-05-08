const express = require('express');
const path    = require('path');
const fs      = require('fs');
const exifr   = require('exifr');

const { PHOTOS_DIR, PREVIEWS_DIR, isImage, isAlbumDir, ensurePreview, photoMeta, preGenerateAll } = require('./services/image');
const database = require('./services/database'); // database.db, database.dbReady (getters)

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Reverse geocoding cache (in-memory) ─────────────────────────────────────
const geoCache = new Map(); // key: "lat,lng" → location string | null
const GEO_MAX  = 2000;

// ─── Static files ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

app.use('/photos', (req, res, next) => {
  const target = path.resolve(path.join(PHOTOS_DIR, decodeURIComponent(req.path)));
  if (!target.startsWith(PHOTOS_DIR)) return res.status(403).end();
  next();
}, express.static(PHOTOS_DIR));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeAlbumPath(name) {
  const full = path.resolve(path.join(PHOTOS_DIR, name));
  const base = PHOTOS_DIR + path.sep;
  if (!full.startsWith(base) && full !== PHOTOS_DIR) throw new Error('Invalid album');
  return full;
}

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

// ─── Start ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  360° Photo Viewer`);
    console.log(`  ➜  http://localhost:${PORT}`);
    console.log(`  Photos:   ${PHOTOS_DIR}`);
    console.log(`  Previews: ${PREVIEWS_DIR}\n`);
    database.connectDb().then(() => database.syncPhotosToDb()).catch(console.error);
    preGenerateAll().catch(console.error);
  });
}

module.exports = { app };
