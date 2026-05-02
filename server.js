const express = require('express');
const path    = require('path');
const fs      = require('fs');
const exifr   = require('exifr');
const sharp   = require('sharp');

const app        = express();
const PORT       = process.env.PORT || 3000;
const PHOTOS_DIR = process.env.PHOTOS_DIR
  ? path.resolve(process.env.PHOTOS_DIR)
  : path.join(__dirname, 'photos');
const PREVIEWS_DIR = path.join(__dirname, 'public', 'previews');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif']);
const isImage   = f => IMAGE_EXT.has(path.extname(f).toLowerCase());

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
  let name        = path.basename(file, path.extname(file));
  let description = '';
  let is360       = false;

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
    filename: file,
    url:        `/photos/${encodeURIComponent(albumName)}/${encodeURIComponent(file)}`,
    previewUrl,
    name:        String(name).trim(),
    description: String(description).trim(),
    is360,
    gps,
  };
}

// ─── Startup pre-generation ──────────────────────────────────────────────────
// Runs in background after server start; skips photos that already have a
// preview so subsequent restarts are near-instant.

async function preGenerateAll() {
  if (!fs.existsSync(PHOTOS_DIR)) return;
  const albums = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'));

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
      .filter(e => e.isDirectory() && !e.name.startsWith('.'));

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
    // Previews are generated in parallel — first call takes ~165 ms/image
    const photos = await Promise.all(files.map(f => photoMeta(req.params.album, f, albumPath)));

    res.json({ name: req.params.album, photos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  360° Photo Viewer`);
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  Photos:   ${PHOTOS_DIR}`);
  console.log(`  Previews: ${PREVIEWS_DIR}\n`);
  preGenerateAll().catch(console.error);
});
