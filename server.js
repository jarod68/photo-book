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
      xmp: true, iptc: true, exif: true, gps: false, icc: false, jfif: false,
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

  return {
    filename: file,
    url:        `/photos/${encodeURIComponent(albumName)}/${encodeURIComponent(file)}`,
    previewUrl,
    name:        String(name).trim(),
    description: String(description).trim(),
    is360,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/api/albums', (req, res) => {
  try {
    if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

    const albums = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => {
        const files = fs.readdirSync(path.join(PHOTOS_DIR, e.name)).filter(isImage).sort();
        return {
          name:  e.name,
          count: files.length,
          cover: files[0]
            ? `/photos/${encodeURIComponent(e.name)}/${encodeURIComponent(files[0])}`
            : null,
        };
      });

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
});
