const path  = require('path');
const fs    = require('fs');
const exifr = require('./exif');   // photo metadata (ExifReader, exifr-compatible API)
const sharp = require('sharp');
const cleanup = require('./cleanup');

const APP_ROOT     = process.cwd();
const PHOTOS_DIR   = process.env.PHOTOS_DIR
  ? path.resolve(process.env.PHOTOS_DIR)
  : path.join(APP_ROOT, 'photos');
// Overridable (tests use temporary directories); server.js serves these paths.
const PREVIEWS_DIR = path.resolve(process.env.PREVIEWS_DIR || path.join(APP_ROOT, 'public', 'previews'));
const MEDIUM_DIR   = path.resolve(process.env.MEDIUM_DIR   || path.join(APP_ROOT, 'public', 'medium'));

// Media accepted in albums (F1): still images (incl. iPhone HEIC/HEIF and AVIF)
// and short videos. Browsers cannot show HEIC/HEIF (bar Safari) or TIFF, so
// those also get a full-size JPEG "display" derivative.
const IMAGE_EXT  = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.heic', '.heif', '.avif']);
const VIDEO_EXT  = new Set(['.mp4', '.m4v', '.mov', '.webm']);
const NEEDS_DISPLAY = new Set(['.heic', '.heif', '.tiff', '.tif']);
const HEIF_EXT   = new Set(['.heic', '.heif']);
const ext        = f => path.extname(f).toLowerCase();
const isImage    = f => IMAGE_EXT.has(ext(f));
const isVideo    = f => VIDEO_EXT.has(ext(f));
const isMedia    = f => isImage(f) || isVideo(f);
const VIDEO_MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
const isAlbumDir = e => e.isDirectory() && /^[A-Za-z0-9]/.test(e.name);

// ── Derived images ────────────────────────────────────────────────────────────
// public/previews/<album>/<file>.jpg        viewer preview (1024 px, 1536 px for 360°)
// public/previews/<album>/<file>.thumb.jpg  thumbnail strip, album cards, map popups (480 px: sharp at 2× on cards)
// public/medium/<album>/<file>.jpg          720p shown while the full image loads (1280 px)
//
// Named after the FULL source filename ("IMG_1.JPG" → "IMG_1.JPG.jpg") so that
// IMG_1.jpg and IMG_1.png in one album no longer share a derivative, and
// rebuilt whenever the source is newer (a photo replaced under the same name).
// URLs carry the source's mtime (?v=…): the routes serve derivatives as
// immutable for a year, so a new version must have a new URL.
const DERIVATIVES = {
  preview: { dir: () => PREVIEWS_DIR, suffix: '.jpg',       width: (is360) => (is360 ? 1536 : 1024), quality: 76, route: 'previews' },
  thumb:   { dir: () => PREVIEWS_DIR, suffix: '.thumb.jpg', width: () => 480,                          quality: 72, route: 'previews' },
  medium:  { dir: () => MEDIUM_DIR,   suffix: '.jpg',       width: () => 1280,                         quality: 82, route: 'medium' },
  // full-size JPEG for formats browsers cannot display (HEIC/HEIF, TIFF)
  display: { dir: () => MEDIUM_DIR,   suffix: '.full.jpg',  width: () => 6000,                         quality: 90, route: 'medium', only: (f) => NEEDS_DISPLAY.has(ext(f)) },
};
const kindsFor = (filename) => Object.keys(DERIVATIVES).filter((k) => !DERIVATIVES[k].only || DERIVATIVES[k].only(filename));

// HEIC/HEIF (HEVC) is not decodable by the prebuilt sharp: heic-decode
// (libheif in WebAssembly) produces raw RGBA that sharp then resizes. A 12 MP
// iPhone photo decodes to ~48 MB, so at most two decodes run at once, and one
// photo is decoded once for all its derivatives (lazySource).
const heicDecode = require('heic-decode');
let heifSlots = 2;
const heifWaiters = [];
async function withHeifSlot(fn) {
  if (heifSlots === 0) await new Promise((r) => heifWaiters.push(r));
  heifSlots--;
  try { return await fn(); } finally { heifSlots++; heifWaiters.shift()?.(); }
}
function lazySource(filePath) {
  // failOn 'none': a slightly damaged file (truncated, odd JPEG markers) still
  // gets derivatives from whatever decodes, instead of none at all; browsers
  // show such files too. A file that does not decode at all still fails.
  if (!HEIF_EXT.has(ext(filePath))) return () => Promise.resolve({ input: filePath, options: { failOn: 'none' } });
  let p;
  return () => (p ??= withHeifSlot(async () => {
    const { width, height, data } = await heicDecode({ buffer: await fs.promises.readFile(filePath) });
    return { input: Buffer.from(data.buffer, data.byteOffset, data.length), options: { raw: { width, height, channels: 4 } } };
  }));
}

const derivName = (kind, filename) => filename + DERIVATIVES[kind].suffix;

function derivUrl(kind, albumName, filename, srcMtimeMs) {
  const { route } = DERIVATIVES[kind];
  const v = srcMtimeMs ? `?v=${Math.floor(srcMtimeMs)}` : '';
  return `/${route}/${encodeURIComponent(albumName)}/${encodeURIComponent(derivName(kind, filename))}${v}`;
}

async function srcMtime(filePath, _fsp) {
  return (await _fsp.stat(filePath)).mtimeMs;
}

// Derivatives being written, by output path: the startup pre-generation and a
// request for the same photo share one build instead of racing on the file.
const building = new Map();
let tmpSeq = 0;

async function ensureDerivative(kind, albumName, filename, filePath, { is360 = false, mtimeMs, source } = {}, _deps = {}) {
  const _fsp   = _deps.fsPromises ?? fs.promises;
  const _sharp = _deps.sharp ?? sharp;
  const spec   = DERIVATIVES[kind];
  const srcMs  = mtimeMs ?? await srcMtime(filePath, _fsp);
  const outDir = path.join(spec.dir(), albumName);
  const out    = path.join(outDir, derivName(kind, filename));

  const outMs = await _fsp.stat(out).then((st) => st.mtimeMs, () => -1);
  if (outMs < srcMs) {
    if (!building.has(out)) {
      const build = (async () => {
        await _fsp.mkdir(outDir, { recursive: true });
        const tmp = `${out}.${process.pid}-${++tmpSeq}.tmp`;
        const { input, options } = await (source ?? lazySource(filePath))();
        try {
          await _sharp(input, options)
            .rotate()
            .resize(spec.width(is360), null, { withoutEnlargement: true })
            .jpeg({ quality: spec.quality, progressive: true })
            .toFile(tmp);
          await _fsp.rename(tmp, out);   // atomic: a reader never sees a half-written file
        } catch (err) {
          await _fsp.unlink(tmp).catch(() => {});
          throw err;
        }
      })().finally(() => building.delete(out));
      building.set(out, build);
    }
    await building.get(out);
  }
  return derivUrl(kind, albumName, filename, srcMs);
}

const ensurePreview = (albumName, filename, filePath, is360, _deps = {}, mtimeMs, source) =>
  ensureDerivative('preview', albumName, filename, filePath, { is360, mtimeMs, source }, _deps);
const ensureThumb = (albumName, filename, filePath, _deps = {}, mtimeMs, source) =>
  ensureDerivative('thumb', albumName, filename, filePath, { mtimeMs, source }, _deps);
const ensureMedium = (albumName, filename, filePath, _deps = {}, mtimeMs, source) =>
  ensureDerivative('medium', albumName, filename, filePath, { mtimeMs, source }, _deps);
const ensureDisplay = (albumName, filename, filePath, _deps = {}, mtimeMs, source) =>
  ensureDerivative('display', albumName, filename, filePath, { mtimeMs, source }, _deps);

// ── EXIF metadata extraction ──────────────────────────────────────────────────

function formatShutterSpeed(t) {
  if (t >= 1) return `${t}s`;
  const den = Math.round(1 / t);
  return `1/${den}`;
}

// A video: played natively by the browser (no derivatives; the strip shows
// its first frame). No EXIF; takenAt stays null.
async function videoMeta(albumName, file, filePath, _deps = {}) {
  const mtimeMs = await srcMtime(filePath, _deps.fsPromises ?? fs.promises).catch(() => undefined);
  const url = `/photos/${encodeURIComponent(albumName)}/${encodeURIComponent(file)}`;
  return {
    type: 'video', mimeType: VIDEO_MIME[ext(file)], filename: file,
    url: mtimeMs ? `${url}?v=${Math.floor(mtimeMs)}` : url,
    previewUrl: null, mediumUrl: null, thumbUrl: null, displayUrl: null, mtimeMs: mtimeMs ?? null,
    name: path.basename(file, path.extname(file)), description: '', is360: false,
    gps: null, location: null, takenAt: null, exif: null,
  };
}

async function photoMeta(albumName, file, albumPath, _deps = {}) {
  const _exifr = _deps.exifr ?? exifr;

  const filePath = path.join(albumPath, file);
  if (isVideo(file)) return videoMeta(albumName, file, filePath, _deps);
  let name         = path.basename(file, path.extname(file));
  let description  = '';
  let is360        = false;
  let iptcLocation = null;
  let exifOut      = null;
  let takenAt      = null;   // capture date (ISO), for the map, timeline, sorting, search

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

    const make   = clean(exifData.Make);
    const model  = clean(exifData.Model);
    const lens   = clean(exifData.LensModel) || clean(exifData.Lens);
    const dtRaw  = exifData.DateTimeOriginal;
    const dateTime = dtRaw instanceof Date
      ? dtRaw.toISOString()
      : typeof dtRaw === 'string' ? dtRaw : null;
    const created = exifData.CreateDate;
    takenAt = dateTime ?? (created instanceof Date ? created.toISOString() : null);
    const iso        = exifData.ISO ?? exifData.ISOSpeedRatings ?? null;
    const fnumber    = exifData.FNumber ?? null;
    const expTime    = exifData.ExposureTime ?? null;
    const focal      = exifData.FocalLength ?? null;
    const focal35    = exifData.FocalLengthIn35mmFilm ?? null;
    const imgWidth   = exifData.ImageWidth  || exifData.ExifImageWidth  || null;
    const imgHeight  = exifData.ImageHeight || exifData.ExifImageHeight || null;

    if (make || model || lens || dateTime || iso != null || fnumber != null || expTime != null || focal != null) {
      exifOut = {
        make:          make   || null,
        model:         model  || null,
        lens:          lens   || null,
        dateTime,
        iso:           iso       != null ? Number(iso)      : null,
        aperture:      fnumber   != null ? Number(fnumber)  : null,
        shutterSpeed:  expTime   != null ? formatShutterSpeed(Number(expTime)) : null,
        focalLength:   focal     != null ? Number(focal)    : null,
        focalLength35: focal35   != null ? Number(focal35)  : null,
        width:         imgWidth  != null ? Number(imgWidth) : null,
        height:        imgHeight != null ? Number(imgHeight): null,
      };
    }
  } catch (_) { /* use filename defaults */ }

  const mtimeMs = await srcMtime(filePath, _deps.fsPromises ?? fs.promises).catch(() => undefined);
  const logFail = (kind) => (err) => { console.error(`${kind} failed:`, albumName, file, err.message); return null; };
  const source = lazySource(filePath);   // HEIC: decoded once for every derivative
  const [previewUrl, mediumUrl, thumbUrl, displayUrl] = await Promise.all([
    ensurePreview(albumName, file, filePath, is360, _deps, mtimeMs, source).catch(() => null),
    ensureMedium(albumName, file, filePath, _deps, mtimeMs, source).catch(logFail('ensureMedium')),
    ensureThumb(albumName, file, filePath, _deps, mtimeMs, source).catch(logFail('ensureThumb')),
    NEEDS_DISPLAY.has(ext(file))
      ? ensureDisplay(albumName, file, filePath, _deps, mtimeMs, source).catch(logFail('ensureDisplay'))
      : null,
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
    // originals are served as immutable too: version the URL like the derivatives
    url:         `/photos/${encodeURIComponent(albumName)}/${encodeURIComponent(file)}${mtimeMs ? `?v=${Math.floor(mtimeMs)}` : ''}`,
    type:        'photo',
    previewUrl,
    mediumUrl,
    thumbUrl,
    displayUrl,                // full-size JPEG when the original is HEIC / TIFF
    mtimeMs:     mtimeMs ?? null,
    name:        String(name).trim(),
    description: String(description).trim(),
    is360,
    gps,
    location:    iptcLocation,
    takenAt,
    exif:        exifOut,
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
  const _fs  = _deps.fs ?? fs;
  const _fsp = _deps.fsPromises ?? fs.promises;

  if (!_fs.existsSync(PHOTOS_DIR)) return;
  const albums = _fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(isAlbumDir);

  // A photo needs work when any of its derivatives is missing or older than it.
  const stale = async (album, file) => {
    const src = await _fsp.stat(path.join(PHOTOS_DIR, album, file)).then((st) => st.mtimeMs, () => null);
    if (src == null) return false;
    for (const kind of kindsFor(file)) {
      const out = path.join(DERIVATIVES[kind].dir(), album, derivName(kind, file));
      const ms = await _fsp.stat(out).then((st) => st.mtimeMs, () => -1);
      if (ms < src) return true;
    }
    return false;
  };

  const tasks = [];
  for (const album of albums) {
    const albumPath = path.join(PHOTOS_DIR, album.name);
    for (const file of _fs.readdirSync(albumPath).filter(isImage).sort()) {
      if (await stale(album.name, file)) {
        tasks.push(() => photoMeta(album.name, file, albumPath, _deps).catch((e) =>
          console.error('Preview error:', file, e.message)));
      }
    }
  }
  await withConcurrency(tasks);
  if (tasks.length > 0) console.log(`  ✓ ${tasks.length} thumbnail${tasks.length > 1 ? 's' : ''} generated.`);
  await pruneDerivatives(_deps).catch((e) => console.error('Derivative cleanup failed:', e.message));
}

// Remove derived images whose source is gone: deleted photos and albums, and
// files from the previous naming scheme ("IMG_1.jpg" for "IMG_1.JPG").
async function pruneDerivatives(_deps = {}) {
  const _fsp = _deps.fsPromises ?? fs.promises;
  const albums = new Map();   // album → Set of expected derivative names
  for (const e of await _fsp.readdir(PHOTOS_DIR, { withFileTypes: true }).catch(() => [])) {
    if (!isAlbumDir(e)) continue;
    const files = (await _fsp.readdir(path.join(PHOTOS_DIR, e.name)).catch(() => [])).filter(isImage);
    albums.set(e.name, new Set(files.flatMap((f) => kindsFor(f).map((k) => derivName(k, f)))));
  }
  let removed = 0;
  for (const root of new Set(Object.values(DERIVATIVES).map((d) => d.dir()))) {
    for (const e of await _fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const expected = albums.get(e.name);
      const dir = path.join(root, e.name);
      for (const f of await _fsp.readdir(dir).catch(() => [])) {
        if (!f.endsWith('.jpg') || expected?.has(f)) continue;
        await _fsp.unlink(path.join(dir, f)).then(() => removed++, () => {});
      }
      if (!expected) await _fsp.rmdir(dir).catch(() => {});
    }
  }
  if (removed) console.log(`  ✓ ${removed} orphaned derivative${removed > 1 ? 's' : ''} removed.`);
  return removed;
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

  for (const kind of kindsFor(filename)) {
    const p = path.join(DERIVATIVES[kind].dir(), album, derivName(kind, filename));
    await _fsPromises.unlink(p).catch(() => {});
  }

  if (!database.dbReady) return;
  console.log(`  ✕ Photo deleted — DB cleanup: ${album}/${filename}`);
  await cleanup.deletePhotoRows(database.db, album, filename);
}

module.exports = { PHOTOS_DIR, PREVIEWS_DIR, MEDIUM_DIR, IMAGE_EXT, VIDEO_EXT, isImage, isVideo, isMedia, isAlbumDir, ensurePreview, ensureMedium, ensureThumb, ensureDisplay, derivUrl, derivName, photoMeta, preGenerateAll, pruneDerivatives, withConcurrency, deletePhotoFiles };
