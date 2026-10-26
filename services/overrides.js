'use strict';
// Photo title / description / location edited in the admin (F2).
//
// Stored in `photo_overrides`, one row per edited photo; a NULL field is not
// overridden and the value read from the file (EXIF / IPTC / XMP) is shown.
// The photo files are never modified.
const database = require('./database');

const FIELDS = { title: 200, description: 2000, location: 200 };   // name → max length

// Map "album/filename" → { title, description, location } for the given albums
// (all albums when omitted). Empty when the database is unavailable.
async function loadOverrides(albums) {
  const out = new Map();
  if (!database.dbReady) return out;
  const { rows } = albums
    ? await database.db.query(
      'SELECT album, filename, title, description, location FROM photo_overrides WHERE album = ANY($1)',
      [albums])
    : await database.db.query('SELECT album, filename, title, description, location FROM photo_overrides');
  for (const r of rows) {
    out.set(`${r.album}/${r.filename}`, { title: r.title, description: r.description, location: r.location });
  }
  return out;
}

// A copy of the photo with its overrides applied; the file's own values are
// kept under `original` when `withOriginal` is set (admin editor).
function applyOverride(photo, ov, { withOriginal = false } = {}) {
  const out = { ...photo };
  if (withOriginal) {
    out.original = { title: photo.name, description: photo.description, location: photo.location };
    out.override = { title: ov?.title ?? null, description: ov?.description ?? null, location: ov?.location ?? null };
  }
  if (!ov) return out;
  if (ov.title != null)       out.name        = ov.title;
  if (ov.description != null) out.description = ov.description;
  if (ov.location != null)    out.location    = ov.location;
  return out;
}

// Validate a PUT body: each field is a string (trimmed; "" clears the
// override) or null. Returns { values } or { error }.
function parseOverride(body) {
  const values = {};
  for (const [field, max] of Object.entries(FIELDS)) {
    const v = body?.[field];
    if (v === undefined || v === null) { values[field] = null; continue; }
    if (typeof v !== 'string') return { error: `${field} must be a string` };
    const s = v.trim();
    if (s.length > max) return { error: `${field} is too long (max ${max})` };
    values[field] = s === '' ? null : s;
  }
  return { values };
}

async function saveOverride(album, filename, { title, description, location }) {
  if (title == null && description == null && location == null) {
    await database.db.query('DELETE FROM photo_overrides WHERE album = $1 AND filename = $2', [album, filename]);
    return;
  }
  await database.db.query(
    `INSERT INTO photo_overrides (album, filename, title, description, location, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (album, filename) DO UPDATE
       SET title = $3, description = $4, location = $5, updated_at = now()`,
    [album, filename, title, description, location],
  );
}

module.exports = { FIELDS, loadOverrides, applyOverride, parseOverride, saveOverride };
