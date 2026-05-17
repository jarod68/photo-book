const path  = require('path');
const fs    = require('fs');
const exifr = require('exifr');
const sharp = require('sharp');

const APP_ROOT     = process.cwd();
const PHOTOS_DIR   = process.env.PHOTOS_DIR
  ? path.resolve(process.env.PHOTOS_DIR)
  : path.join(APP_ROOT, 'photos');
const PREVIEWS_DIR = path.join(APP_ROOT, 'public', 'previews');
const MEDIUM_DIR   = path.join(APP_ROOT, 'public', 'medium');

const IMAGE_EXT  = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif']);
const isImage    = f => IMAGE_EXT.has(path.extname(f).toLowerCase());
const isAlbumDir = e => e.isDirectory() && /^[A-Za-z0-9]/.test(e.name);

// ── Preview generation ────────────────────────────────────────────────────────
// public/previews/ — thumbnail strip (1024 px standard, 1536 px 360°)
// public/medium/   — 720p intermediate shown while the full image loads (1280 px)

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

async function ensureMedium(albumName, filename, filePath, _deps = {}) {
  const _fs    = _deps.fs    ?? fs;
  const _sharp = _deps.sharp ?? sharp;

  const albumDir  = path.join(MEDIUM_DIR, albumName);
  const medName   = path.parse(filename).name + '.jpg';
  const medPath   = path.join(albumDir, medName);
  const mediumUrl = `/medium/${encodeURIComponent(albumName)}/${encodeURIComponent(medName)}`;

  if (_fs.existsSync(medPath)) return mediumUrl;

  _fs.mkdirSync(albumDir, { recursive: true });
  await _sharp(filePath)
    .rotate()
    .resize(1280, null, { withoutEnlargement: true })
    .jpeg({ quality: 82, progressive: true })
    .toFile(medPath);

  return mediumUrl;
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

  const [previewUrl, mediumUrl] = await Promise.all([
    ensurePreview(albumName, file, filePath, is360, _deps).catch(() => null),
    ensureMedium(albumName, file, filePath, _deps).catch(err => {
      console.error('ensureMedium failed:', albumName, file, err.message);
      return null;
    }),
  ]);

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
    mediumUrl,
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

/**
 * Run an array of zero-argument async functions with bounded concurrency.
 * @param {Array<() => Promise<unknown>>} fns - Lazy task factories.
 * @param {number} concurrency - Maximum number of simultaneous tasks.
 */
async function withConcurrency(fns, concurrency = 6) {
  let i = 0;
  async function worker() {
    while (i < fns.length) {
      await fns[i++]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function preGenerateAll(_deps = {}) {
  const _fs = _deps.fs ?? fs;

  if (!_fs.existsSync(PHOTOS_DIR)) return;
  const albums = _fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(isAlbumDir);

  const tasks = albums.flatMap(album => {
    const albumPath = path.join(PHOTOS_DIR, album.name);
    const files     = _fs.readdirSync(albumPath).filter(isImage).sort();
    return files
      .filter(file => {
        const base = path.parse(file).name + '.jpg';
        return !_fs.existsSync(path.join(PREVIEWS_DIR, album.name, base))
            || !_fs.existsSync(path.join(MEDIUM_DIR,   album.name, base));
      })
      .map(file => () => photoMeta(album.name, file, albumPath, _deps).catch(e =>
        console.error('Preview error:', file, e.message),
      ));
  });
  await withConcurrency(tasks);
  if (tasks.length > 0) console.log(`  ✓ ${tasks.length} thumbnail${tasks.length > 1 ? 's' : ''} generated.`);
}

// ── Photo deletion ────────────────────────────────────────────────────────────
// Shared by the user-facing and admin DELETE /albums/:album/photos/:filename
// handlers. Removes the original file plus any generated preview and medium
// variants from disk, then cleans up the database rows.

/**
 * Delete a photo from disk (original + previews) and clean up DB rows.
 * Authorization must be verified by the caller before invoking this function.
 *
 * @param {string} album
 * @param {string} filename
 * @param {{ dbReady: boolean, db: object }} database - the database service module
 * @param {{ fs?: object }} _deps - injectable dependencies for testing
 */
async function deletePhotoFiles(album, filename, database, _deps = {}) {
  const _fsPromises = _deps.fsPromises ?? fs.promises;

  const albumPath = path.resolve(path.join(PHOTOS_DIR, album));
  const filePath  = path.resolve(path.join(albumPath, filename));
  await _fsPromises.unlink(filePath);

  const previewName = path.parse(filename).name + '.jpg';
  for (const base of [PREVIEWS_DIR, MEDIUM_DIR]) {
    const p = path.join(base, album, previewName);
    await _fsPromises.unlink(p).catch(() => {});
  }

  if (!database.dbReady) return;
  console.log(`  ✕ Photo deleted — DB cleanup: ${album}/${filename}`);
  const q = (sql) => database.db.query(sql, [album, filename]);
  await q('DELETE FROM photo_view_log WHERE album = $1 AND filename = $2');
  await q('DELETE FROM photo_likes    WHERE album = $1 AND filename = $2');
  await q('DELETE FROM photo_views    WHERE album = $1 AND filename = $2');
}

module.exports = { PHOTOS_DIR, PREVIEWS_DIR, MEDIUM_DIR, IMAGE_EXT, isImage, isAlbumDir, ensurePreview, ensureMedium, photoMeta, preGenerateAll, withConcurrency, deletePhotoFiles };
