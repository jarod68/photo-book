'use strict';
/**
 * Automatic face blurring.
 *
 * Detection : Python + OpenCV Haar cascades (frontal + profile).
 * Blurring  : Sharp — pixelation (↓10% nearest-neighbor → ↑ original size)
 *             + light Gaussian blur at edges for a clean result.
 * Tracking  : <PHOTOS_DIR>/.faces-blurred.json — already-processed files
 *             are never re-analysed, even after restart.
 * Originals : modified in-place (via .tmp file for atomicity).
 *             Corresponding previews are deleted so ensurePreview()
 *             regenerates them on next access.
 */

const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');
const sharp      = require('sharp');

const PHOTOS_DIR    = process.env.PHOTOS_DIR
  ? path.resolve(process.env.PHOTOS_DIR)
  : path.join(__dirname, '..', 'photos');

const PREVIEWS_DIR  = path.join(__dirname, '..', 'public', 'previews');
const TRACKER_PATH  = path.join(PHOTOS_DIR, '.faces-blurred.json');
const DETECT_SCRIPT = path.join(__dirname, 'detect_faces.py');
const IMAGE_EXT     = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif']);
const isImage       = f => IMAGE_EXT.has(path.extname(f).toLowerCase());
const isAlbumDir    = e => e.isDirectory() && /^[A-Za-z0-9]/.test(e.name);

// ── Tracker ───────────────────────────────────────────────────────────────────

function loadTracker() {
  try { return JSON.parse(fs.readFileSync(TRACKER_PATH, 'utf8')); }
  catch { return {}; }
}

function saveTracker(data) {
  try { fs.writeFileSync(TRACKER_PATH, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('  Face tracker write error:', e.message); }
}

// ── Detection (Python subprocess) ────────────────────────────────────────────

function detectFaces(imagePath) {
  return new Promise(resolve => {
    const proc = spawn('python3', [DETECT_SCRIPT, imagePath]);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', code => {
      if (code !== 0 || !out.trim()) {
        if (err) console.error('  detect_faces error:', err.trim());
        return resolve(null);
      }
      try { resolve(JSON.parse(out)); }
      catch { resolve(null); }
    });
    proc.on('error', () => resolve(null)); // python3 not found
  });
}

// ── Blurring (Sharp) ──────────────────────────────────────────────────────────

async function blurFaces(imagePath, faces) {
  const meta = await sharp(imagePath).metadata();
  const iw = meta.width;
  const ih = meta.height;

  const composites = (
    await Promise.all(faces.map(async face => {
      const left = Math.max(0, Math.round(face.x));
      const top  = Math.max(0, Math.round(face.y));
      const w    = Math.min(iw - left, Math.max(1, Math.round(face.width)));
      const h    = Math.min(ih - top,  Math.max(1, Math.round(face.height)));
      if (w <= 4 || h <= 4) return null;

      // Pixelation: shrink to ~8% then upscale back
      const sw = Math.max(1, Math.round(w * 0.08));
      const sh = Math.max(1, Math.round(h * 0.08));

      const blurred = await sharp(imagePath)
        .extract({ left, top, width: w, height: h })
        .resize(sw, sh, { kernel: 'nearest' })
        .resize(w,  h,  { kernel: 'nearest' })
        .blur(2.5)     // smooths pixelation edges
        .toBuffer();

      return { input: blurred, left, top };
    }))
  ).filter(Boolean);

  if (!composites.length) return false;

  const tmp = imagePath + '.tmp_blur';
  await sharp(imagePath).composite(composites).toFile(tmp);
  fs.renameSync(tmp, imagePath);
  return true;
}

// ── Delete preview to force regeneration ─────────────────────────────────────

function deletePreview(albumName, filename) {
  const previewPath = path.join(
    PREVIEWS_DIR,
    albumName,
    path.parse(filename).name + '.jpg',
  );
  try { fs.unlinkSync(previewPath); } catch {}
}

// ── Main entry point ──────────────────────────────────────────────────────────

async function blurAllFaces() {
  if (!fs.existsSync(PHOTOS_DIR)) return;

  // Check python3 is available
  const available = await new Promise(resolve => {
    const p = spawn('python3', ['--version']);
    p.on('close', code => resolve(code === 0));
    p.on('error', ()   => resolve(false));
  });

  if (!available) {
    console.log('  ⚠  python3 not found — face blurring disabled');
    console.log('     (Docker: make sure py3-opencv is installed)');
    return;
  }

  const tracker = loadTracker();
  const albums  = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(isAlbumDir);

  let scanned = 0;
  let blurred = 0;

  for (const album of albums) {
    const albumPath = path.join(PHOTOS_DIR, album.name);
    const files     = fs.readdirSync(albumPath).filter(isImage);

    for (const file of files) {
      const key      = `${album.name}/${file}`;
      const filePath = path.join(albumPath, file);

      if (tracker[key]) continue; // already processed

      process.stdout.write(`  ⟳  Scanning faces: ${key}\r`);

      const faces = await detectFaces(filePath);
      if (faces === null) {
        // Erreur Python sur ce fichier : on marque pour ne pas re-tenter
        tracker[key] = { processedAt: new Date().toISOString(), facesFound: 0, error: true };
        scanned++;
        continue;
      }

      let modified = false;
      if (faces.length > 0) {
        modified = await blurFaces(filePath, faces).catch(e => {
          console.error(`\n  Blur error ${key}:`, e.message);
          return false;
        });
        if (modified) {
          deletePreview(album.name, file);
          blurred++;
        }
      }

      tracker[key] = {
        processedAt: new Date().toISOString(),
        facesFound:  faces.length,
        blurred:     modified,
      };
      scanned++;
    }
  }

  // Clear progress line
  if (scanned > 0) process.stdout.write(' '.repeat(60) + '\r');

  if (scanned > 0) saveTracker(tracker);

  const faceWord  = blurred !== 1 ? 'faces blurred' : 'face blurred';
  const photoWord = scanned !== 1 ? 'photos scanned' : 'photo scanned';
  if (scanned > 0 || blurred > 0) {
    console.log(`  ✓ ${scanned} ${photoWord}, ${blurred} ${faceWord}.`);
  }
}

module.exports = { blurAllFaces };
