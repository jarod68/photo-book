const path  = require('path');
const fs    = require('fs');
const exifr = require('exifr');
const sharp = require('sharp');

const PHOTOS_DIR   = process.env.PHOTOS_DIR
  ? path.resolve(process.env.PHOTOS_DIR)
  : path.join(__dirname, '..', 'photos');
const PREVIEWS_DIR = path.join(__dirname, '..', 'public', 'previews');

const IMAGE_EXT  = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif']);
const isImage    = f => IMAGE_EXT.has(path.extname(f).toLowerCase());
const isAlbumDir = e => e.isDirectory() && /^[A-Za-z0-9]/.test(e.name);

// ── Preview generation ────────────────────────────────────────────────────────
// Generates a low-res JPEG on first request, cached to public/previews/.
// 360° photos → 1536 px wide (maintains 2:1 for Pannellum preview)
// Standard     → 1024 px wide

async function ensurePreview(albumName, filename, filePath, is360, _deps = {}) {
  const _fs    = _deps.fs    ?? fs;
  const _sharp = _deps.sharp ?? sharp;

  const albumDir    = path.join(PREVIEWS_DIR, albumName);
  const previewName = path.parse(filename).name + '.jpg';
  const previewPath = path.join(albumDir, previewName);

  if (!_fs.existsSync(previewPath)) {
    _fs.mkdirSync(albumDir, { recursive: true });
    const width = is360 ? 1536 : 1024;
    await _sharp(filePath)
      .rotate()
      .resize(width, null, { withoutEnlargement: true })
      .jpeg({ quality: 76, progressive: true })
      .toFile(previewPath);
  }

  return `/previews/${encodeURIComponent(albumName)}/${encodeURIComponent(previewName)}`;
}

// ── EXIF metadata extraction ──────────────────────────────────────────────────

async function photoMeta(albumName, file, albumPath, _deps = {}) {
  const _exifr = _deps.exifr ?? exifr;

  const filePath = path.join(albumPath, file);
  let name         = path.basename(file, path.extname(file));
  let description  = '';
  let is360        = false;
  let iptcLocation = null;

  try {
    const exifData = await _exifr.parse(filePath, {
      xmp: true, iptc: true, exif: true, gps: true, icc: false, jfif: false,
    }) || {};

    const proj = exifData.ProjectionType;
    if (proj === 'equirectangular' || proj === 'Equirectangular' || exifData.UsePanoramaViewer === true) {
      is360 = true;
    }
    if (!is360 && exifData.ImageWidth && exifData.ImageHeight) {
      const r = exifData.ImageWidth / exifData.ImageHeight;
      is360 = r >= 1.95 && r <= 2.05;
    }

    const PLACEHOLDERS = new Set(['default', 'Default', 'DEFAULT', 'OLYMPUS DIGITAL CAMERA', '']);
    const clean = v => {
      const s = String(Array.isArray(v) ? v[0] : (v ?? '')).trim();
      return PLACEHOLDERS.has(s) ? '' : s;
    };

    const rawName = clean(exifData.Title) || clean(exifData.Headline) || clean(exifData.ObjectName);
    if (rawName) {
      name = rawName;
    } else {
      const desc = clean(exifData.ImageDescription);
      if (desc && desc.length < 80) name = desc;
    }

    const rawDesc = clean(exifData.Description) || clean(exifData['Caption-Abstract']) || clean(exifData.UserComment);
    description = rawDesc;
    if (!description) {
      const imgDesc = clean(exifData.ImageDescription);
      if (imgDesc && imgDesc !== name) description = imgDesc;
    }

    const iptcCity    = clean(exifData.City);
    const iptcState   = clean(exifData['Province-State']);
    const iptcCountry = clean(exifData['Country-PrimaryLocationName']) || clean(exifData.country);
    if (iptcCity || iptcState || iptcCountry) {
      iptcLocation = [iptcCity, iptcState, iptcCountry].filter(Boolean).join(', ');
    }
  } catch (_) { /* use filename defaults */ }

  const previewUrl = await ensurePreview(albumName, file, filePath, is360, _deps).catch(() => null);

  let gps = null;
  try {
    const g = await _exifr.gps(filePath);
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

// ── Startup pre-generation ────────────────────────────────────────────────────
// Runs in background after server start; skips photos that already have a
// preview so subsequent restarts are near-instant.

async function preGenerateAll(_deps = {}) {
  const _fs = _deps.fs ?? fs;

  if (!_fs.existsSync(PHOTOS_DIR)) return;
  const albums = _fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(isAlbumDir);

  let count = 0;
  for (const album of albums) {
    const albumPath = path.join(PHOTOS_DIR, album.name);
    const files     = _fs.readdirSync(albumPath).filter(isImage).sort();
    for (const file of files) {
      const previewPath = path.join(PREVIEWS_DIR, album.name, path.parse(file).name + '.jpg');
      if (!_fs.existsSync(previewPath)) {
        await photoMeta(album.name, file, albumPath, _deps).catch(e =>
          console.error('Preview error:', file, e.message),
        );
        count++;
      }
    }
  }
  if (count > 0) console.log(`  ✓ ${count} miniature${count > 1 ? 's' : ''} générée${count > 1 ? 's' : ''}.`);
}

module.exports = { PHOTOS_DIR, PREVIEWS_DIR, IMAGE_EXT, isImage, isAlbumDir, ensurePreview, photoMeta, preGenerateAll };
