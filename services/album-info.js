'use strict';
// Album cover, description and date range (F3).
//
// The cover and description are chosen in the admin and stored in
// album_settings; the date range is computed from the photos' capture dates.
const database = require('./database');

const DESCRIPTION_MAX = 2000;

// Map album → { cover, description } (empty without a database).
async function loadAlbumInfo() {
  const out = new Map();
  if (!database.dbReady) return out;
  const { rows } = await database.db.query(
    'SELECT album, cover, description FROM album_settings WHERE cover IS NOT NULL OR description IS NOT NULL');
  for (const r of rows) out.set(r.album, { cover: r.cover, description: r.description });
  return out;
}

// The photo shown on the album card: the chosen cover if it is still a
// readable photo of the album, else the first photo whose thumbnail could
// be made (a video or a corrupt file never becomes the cover).
function pickCover(photos, chosen) {
  const usable = (p) => p.type !== 'video' && p.thumbUrl;
  return (chosen && photos.find((p) => p.filename === chosen && usable(p))) || photos.find(usable) || null;
}

// Earliest and latest capture date (ISO strings), null when no photo has one.
function dateRange(photos) {
  let from = null, to = null;
  for (const p of photos) {
    const t = p.takenAt ? Date.parse(p.takenAt) : NaN;
    if (Number.isNaN(t)) continue;
    if (from === null || t < from) from = t;
    if (to === null || t > to) to = t;
  }
  return from === null ? { dateFrom: null, dateTo: null }
    : { dateFrom: new Date(from).toISOString(), dateTo: new Date(to).toISOString() };
}

function summarize(photos, info = {}) {
  const cover = pickCover(photos, info.cover);
  return {
    count:        photos.length,
    cover:        cover?.url ?? null,
    coverFile:    cover?.filename ?? null,
    coverPreview: cover?.previewUrl ?? null,
    coverThumb:   cover?.thumbUrl ?? null,
    description:  info.description ?? null,
    ...dateRange(photos),
  };
}

async function saveAlbumInfo(album, { cover, description }) {
  await database.db.query(
    `INSERT INTO album_settings (album, cover, description) VALUES ($1, $2, $3)
     ON CONFLICT (album) DO UPDATE SET cover = $2, description = $3`,
    [album, cover, description],
  );
}

module.exports = { DESCRIPTION_MAX, loadAlbumInfo, pickCover, dateRange, summarize, saveAlbumInfo };
