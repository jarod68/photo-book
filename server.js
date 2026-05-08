const express = require('express');
const path    = require('path');
const fs      = require('fs');
const exifr   = require('exifr');
const sharp   = require('sharp');
const { Pool } = require('pg');

const app        = express();
const PORT       = process.env.PORT || 3000;
const PHOTOS_DIR = process.env.PHOTOS_DIR
  ? path.resolve(process.env.PHOTOS_DIR)
  : path.join(__dirname, 'photos');
const PREVIEWS_DIR = path.join(__dirname, 'public', 'previews');

const IMAGE_EXT  = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif']);
const isImage    = f => IMAGE_EXT.has(path.extname(f).toLowerCase());
const isAlbumDir = e => e.isDirectory() && /^[A-Za-z0-9]/.test(e.name);

// ─── Database ─────────────────────────────────────────────────────────────────
let db      = null;
let dbReady = false;

async function connectDb() {
  db = new Pool({
    host:     process.env.POSTGRES_HOST || 'postgres',
    port:     5432,
    database: 'photobook',
    user:     'photobook',
    password: 'photobook_secret',
  });

  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      await db.query('SELECT 1');
      await db.query(`
        CREATE TABLE IF NOT EXISTS photo_views (
          id       SERIAL PRIMARY KEY,
          album    VARCHAR(255) NOT NULL,
          filename VARCHAR(255) NOT NULL,
          views    BIGINT       NOT NULL DEFAULT 0,
          UNIQUE (album, filename)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS photo_view_log (
          album      VARCHAR(255) NOT NULL,
          filename   VARCHAR(255) NOT NULL,
          user_token VARCHAR(36)  NOT NULL,
          viewed_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (album, filename, user_token)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS photo_likes (
          album      VARCHAR(255) NOT NULL,
          filename   VARCHAR(255) NOT NULL,
          user_token VARCHAR(36)  NOT NULL,
          created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (album, filename, user_token)
        )
      `);
      dbReady = true;
      console.log('  ✓ PostgreSQL connecté.');
      return;
    } catch (err) {
      if (attempt < 12) {
        await new Promise(r => setTimeout(r, 5_000));
      } else {
        console.error('  ✗ PostgreSQL indisponible :', err.message);
      }
    }
  }
}

async function syncPhotosToDb() {
  if (!dbReady || !fs.existsSync(PHOTOS_DIR)) return;
  const albums = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(isAlbumDir);
  let total = 0;
  for (const album of albums) {
    const files = fs.readdirSync(path.join(PHOTOS_DIR, album.name)).filter(isImage);
    for (const file of files) {
      await db.query(
        'INSERT INTO photo_views (album, filename, views) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING',
        [album.name, file],
      );
    }
    total += files.length;
  }
  console.log(`  ✓ ${total} photo(s) enregistrée(s) dans photo_views.`);
}

// ─── Reverse geocoding cache (in-memory) ─────────────────────────────────────
const geoCache = new Map(); // key: "lat,lng" → location string | null

// ─── Static files ────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

app.use('/photos', (req, res, next) => {
  const target = path.resolve(path.join(PHOTOS_DIR, decodeURIComponent(req.path)));
  if (!target.startsWith(PHOTOS_DIR)) return res.status(403).end();
  next();
}, express.static(PHOTOS_DIR));

// ─── Preview generation ──────────────────────────────────────────────────────
// Generates a low-res JPEG on first request, cached to public/previews/.
// 360° photos → 1536 px wide (maintains 2:1 for Pannellum preview)
// Standard     → 1024 px wide
// ~150–200 ms per image, served as static files on subsequent requests.

async function ensurePreview(albumName, filename, filePath, is360) {
  const albumDir   = path.join(PREVIEWS_DIR, albumName);
  const previewName = path.parse(filename).name + '.jpg';
  const previewPath = path.join(albumDir, previewName);

  if (!fs.existsSync(previewPath)) {
    fs.mkdirSync(albumDir, { recursive: true });
    const width = is360 ? 1536 : 1024;
    await sharp(filePath)
      .resize(width, null, { withoutEnlargement: true })
      .jpeg({ quality: 76, progressive: true })
      .toFile(previewPath);
  }

  return `/previews/${encodeURIComponent(albumName)}/${encodeURIComponent(previewName)}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeAlbumPath(name) {
  const full = path.resolve(path.join(PHOTOS_DIR, name));
  const base = PHOTOS_DIR + path.sep;
  if (!full.startsWith(base) && full !== PHOTOS_DIR) throw new Error('Invalid album');
  return full;
}

async function photoMeta(albumName, file, albumPath) {
  const filePath = path.join(albumPath, file);
  let name         = path.basename(file, path.extname(file));
  let description  = '';
  let is360        = false;
  let iptcLocation = null;

  try {
    const exif = await exifr.parse(filePath, {
      xmp: true, iptc: true, exif: true, gps: true, icc: false, jfif: false,
    }) || {};

    const proj = exif.ProjectionType;
    if (proj === 'equirectangular' || proj === 'Equirectangular' || exif.UsePanoramaViewer === true) {
      is360 = true;
    }
    if (!is360 && exif.ImageWidth && exif.ImageHeight) {
      const r = exif.ImageWidth / exif.ImageHeight;
      is360 = r >= 1.95 && r <= 2.05;
    }

    const PLACEHOLDERS = new Set(['default', 'Default', 'DEFAULT', 'OLYMPUS DIGITAL CAMERA', '']);
    const clean = v => {
      const s = String(Array.isArray(v) ? v[0] : (v ?? '')).trim();
      return PLACEHOLDERS.has(s) ? '' : s;
    };

    const rawName = clean(exif.Title) || clean(exif.Headline) || clean(exif.ObjectName);
    if (rawName) {
      name = rawName;
    } else {
      const desc = clean(exif.ImageDescription);
      if (desc && desc.length < 80) name = desc;
    }

    const rawDesc = clean(exif.Description) || clean(exif['Caption-Abstract']) || clean(exif.UserComment);
    description = rawDesc;
    if (!description) {
      const imgDesc = clean(exif.ImageDescription);
      if (imgDesc && imgDesc !== name) description = imgDesc;
    }

    // IPTC location fields (populated by some cameras and editing software)
    const iptcCity    = clean(exif.City);
    const iptcState   = clean(exif['Province-State']);
    const iptcCountry = clean(exif['Country-PrimaryLocationName']) || clean(exif.country);
    if (iptcCity || iptcState || iptcCountry) {
      iptcLocation = [iptcCity, iptcState, iptcCountry].filter(Boolean).join(', ');
    }
  } catch (_) { /* use filename defaults */ }

  // Generate preview (cached after first run — ~165 ms for 8K on first call)
  const previewUrl = await ensurePreview(albumName, file, filePath, is360).catch(() => null);

  // GPS extracted separately to avoid polluting the try/catch above
  let gps = null;
  try {
    const g = await exifr.gps(filePath);
    if (g?.latitude != null && g?.longitude != null) {
      gps = { lat: +g.latitude.toFixed(6), lng: +g.longitude.toFixed(6) };
    }
  } catch (_) {}

  return {
    filename:    file,
    url:         `/photos/${encodeURIComponent(albumName)}/${encodeURIComponent(file)}`,
    previewUrl,
    name:        String(name).trim(),
    description: String(description).trim(),
    is360,
    gps,
    location:    iptcLocation,
  };
}

// ─── Startup pre-generation ──────────────────────────────────────────────────
// Runs in background after server start; skips photos that already have a
// preview so subsequent restarts are near-instant.

async function preGenerateAll() {
  if (!fs.existsSync(PHOTOS_DIR)) return;
  const albums = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })
    .filter(e => isAlbumDir(e));

  let count = 0;
  for (const album of albums) {
    const albumPath = path.join(PHOTOS_DIR, album.name);
    const files = fs.readdirSync(albumPath).filter(isImage).sort();
    for (const file of files) {
      const previewPath = path.join(PREVIEWS_DIR, album.name, path.parse(file).name + '.jpg');
      if (!fs.existsSync(previewPath)) {
        await photoMeta(album.name, file, albumPath).catch(e => console.error('Preview error:', file, e.message));
        count++;
      }
    }
  }
  if (count > 0) console.log(`  ✓ ${count} miniature${count > 1 ? 's' : ''} générée${count > 1 ? 's' : ''}.`);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/api/albums', async (req, res) => {
  try {
    if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

    const entries = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })
      .filter(e => isAlbumDir(e));

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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/albums/:album', async (req, res) => {
  try {
    const albumPath = safeAlbumPath(req.params.album);
    if (!fs.existsSync(albumPath)) return res.status(404).json({ error: 'Not found' });

    const files  = fs.readdirSync(albumPath).filter(isImage).sort();
    const photos = await Promise.all(files.map(f => photoMeta(req.params.album, f, albumPath)));

    if (dbReady) {
      try {
        const [{ rows: viewRows }, { rows: likeRows }] = await Promise.all([
          db.query('SELECT filename, views FROM photo_views WHERE album = $1', [req.params.album]),
          db.query('SELECT filename, COUNT(*) AS likes FROM photo_likes WHERE album = $1 GROUP BY filename', [req.params.album]),
        ]);
        const viewMap  = new Map(viewRows.map(r  => [r.filename, Number(r.views)]));
        const likeMap  = new Map(likeRows.map(r  => [r.filename, Number(r.likes)]));
        photos.forEach(p => {
          p.views = viewMap.get(p.filename) ?? 0;
          p.likes = likeMap.get(p.filename) ?? 0;
        });
      } catch (_) {}
    }

    res.json({ name: req.params.album, photos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Global map — all GPS photos across all albums ────────────────────────────

app.get('/api/map', async (req, res) => {
  if (!fs.existsSync(PHOTOS_DIR)) return res.json([]);
  try {
    const albumDirs = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })
      .filter(e => isAlbumDir(e));

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
    res.status(500).json({ error: err.message });
  }
});

// ─── Vues ─────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.post('/api/view', express.json(), async (req, res) => {
  if (!dbReady) return res.json({ views: null });
  const { album, filename, token } = req.body ?? {};
  if (!album || !filename || !token || !UUID_RE.test(token)) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    // Enregistre la visite — ON CONFLICT ne fait rien si déjà vue par ce token
    const log = await db.query(
      `INSERT INTO photo_view_log (album, filename, user_token)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [album, filename, token],
    );

    // N'incrémente que si c'est une première visite pour ce token
    if (log.rowCount > 0) {
      await db.query(
        `INSERT INTO photo_views (album, filename, views) VALUES ($1, $2, 1)
         ON CONFLICT (album, filename) DO UPDATE SET views = photo_views.views + 1`,
        [album, filename],
      );
    }

    // Retourne le compteur de vues, le nombre de likes et le statut liked de ce token
    const [viewResult, likeCountResult, likedResult] = await Promise.all([
      db.query(
        `INSERT INTO photo_views (album, filename, views) VALUES ($1, $2, 0)
         ON CONFLICT (album, filename) DO UPDATE SET views = photo_views.views
         RETURNING views`,
        [album, filename],
      ),
      db.query(
        'SELECT COUNT(*) AS count FROM photo_likes WHERE album = $1 AND filename = $2',
        [album, filename],
      ),
      db.query(
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
    res.status(500).json({ error: err.message });
  }
});

// ─── Likes ────────────────────────────────────────────────────────────────────

app.post('/api/like', express.json(), async (req, res) => {
  if (!dbReady) return res.json({ liked: false, count: 0 });
  const { album, filename, token } = req.body ?? {};
  if (!album || !filename || !token || !UUID_RE.test(token)) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const existing = await db.query(
      'SELECT 1 FROM photo_likes WHERE album = $1 AND filename = $2 AND user_token = $3',
      [album, filename, token],
    );
    if (existing.rowCount > 0) {
      await db.query(
        'DELETE FROM photo_likes WHERE album = $1 AND filename = $2 AND user_token = $3',
        [album, filename, token],
      );
    } else {
      await db.query(
        'INSERT INTO photo_likes (album, filename, user_token) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [album, filename, token],
      );
    }
    const { rows } = await db.query(
      'SELECT COUNT(*) AS count FROM photo_likes WHERE album = $1 AND filename = $2',
      [album, filename],
    );
    res.json({ liked: existing.rowCount === 0, count: Number(rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/liked', async (req, res) => {
  if (!dbReady) return res.json({ filenames: [] });
  const { album, token } = req.query;
  if (!album || !token || !UUID_RE.test(token)) return res.json({ filenames: [] });
  try {
    const { rows } = await db.query(
      'SELECT filename FROM photo_likes WHERE album = $1 AND user_token = $2',
      [album, token],
    );
    res.json({ filenames: rows.map(r => r.filename) });
  } catch (_) {
    res.json({ filenames: [] });
  }
});

// ─── Reverse geocoding (Nominatim proxy) ─────────────────────────────────────
// Proxied server-side so we can set a proper User-Agent and cache results.

app.get('/api/geocode', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'Invalid coordinates' });

  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`; // ~110 m precision
  if (geoCache.has(key)) return res.json({ location: geoCache.get(key) });

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&accept-language=fr`;
    const raw = await fetch(url, {
      headers: { 'User-Agent': 'photo-book/1.0 (self-hosted personal use)' },
    });
    const data = await raw.json();
    const a    = data.address || {};
    const place   = a.village || a.suburb || a.town || a.city_district || a.city || a.municipality || a.county || '';
    const country = a.country || '';
    const location = [place, country].filter(Boolean).join(', ') || null;
    geoCache.set(key, location);
    res.json({ location });
  } catch (err) {
    console.error('Geocode error:', err.message);
    res.json({ location: null });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  360° Photo Viewer`);
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  Photos:   ${PHOTOS_DIR}`);
  console.log(`  Previews: ${PREVIEWS_DIR}\n`);
  connectDb().then(() => syncPhotosToDb()).catch(console.error);
  preGenerateAll().catch(console.error);
});
