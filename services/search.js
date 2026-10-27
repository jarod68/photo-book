'use strict';
// Photo search (F6): free text over title, caption, place, album, file name
// and camera; filters on capture date range, camera and album. Works on the
// cached photo index, so a search reads no file.

const MAX_RESULTS = 200;

// Lower case, accents removed: "Été à Évora" matches "ete evora".
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const cameraOf = (p) => {
  const make = (p.exif?.make ?? '').trim(), model = (p.exif?.model ?? '').trim();
  // "Apple iPhone 15", but "Canon EOS R6" (not "Canon Canon EOS R6") and
  // "NIKON Z 6" (not "NIKON CORPORATION NIKON Z 6"): drop the brand when the
  // model already starts with it.
  const brand = make.split(/\s+/)[0].toLowerCase();
  if (model && brand && model.toLowerCase().startsWith(brand)) return model;
  return [make, model].filter(Boolean).join(' ') || null;
};

/** One searchable entry per photo (overrides and place already applied). */
function toEntry(album, p) {
  const camera = cameraOf(p);
  return {
    album, filename: p.filename, type: p.type, name: p.name, description: p.description || '',
    location: p.location || null, camera, takenAt: p.takenAt || null,
    thumbUrl: p.thumbUrl || null, url: p.url,
    _text: norm([p.name, p.description, p.location, album, p.filename, camera].filter(Boolean).join(' ')),
    _time: p.takenAt ? Date.parse(p.takenAt) : NaN,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse and validate query parameters; returns { filters } or { error }. */
function parseQuery(query = {}) {
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const q = String(one(query.q) ?? '').trim().slice(0, 200);
  const from = one(query.from) || null, to = one(query.to) || null;
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return { error: 'from / to must be YYYY-MM-DD' };
  const fromMs = from ? Date.parse(`${from}T00:00:00Z`) : null;
  const toMs   = to   ? Date.parse(`${to}T23:59:59.999Z`) : null;   // the whole last day
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return { error: 'Invalid date' };
  return { filters: { terms: norm(q).split(/\s+/).filter(Boolean), fromMs, toMs, camera: one(query.camera) || null, album: one(query.album) || null } };
}

function matches(e, { terms, fromMs, toMs, camera, album }) {
  if (album && e.album !== album) return false;
  if (camera && e.camera !== camera) return false;
  if (fromMs !== null || toMs !== null) {
    if (Number.isNaN(e._time)) return false;
    if (fromMs !== null && e._time < fromMs) return false;
    if (toMs !== null && e._time > toMs) return false;
  }
  return terms.every((t) => e._text.includes(t));
}

/** Matching photos, most recent first (undated last), plus the filter choices. */
function search(entries, filters) {
  const hits = entries.filter((e) => matches(e, filters)).sort((a, b) => {
    const ta = Number.isNaN(a._time) ? -Infinity : a._time, tb = Number.isNaN(b._time) ? -Infinity : b._time;
    return tb - ta || a.album.localeCompare(b.album) || a.filename.localeCompare(b.filename);
  });
  const cameras = new Map();
  let min = Infinity, max = -Infinity;
  for (const e of entries) {
    if (e.camera) cameras.set(e.camera, (cameras.get(e.camera) ?? 0) + 1);
    if (!Number.isNaN(e._time)) { min = Math.min(min, e._time); max = Math.max(max, e._time); }
  }
  const strip = ({ _text, _time, ...e }) => e;
  return {
    total: hits.length,
    results: hits.slice(0, MAX_RESULTS).map(strip),
    facets: {
      cameras: [...cameras].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      albums:  [...new Set(entries.map((e) => e.album))].sort((a, b) => a.localeCompare(b)),
      dateFrom: Number.isFinite(min) ? new Date(min).toISOString() : null,
      dateTo:   Number.isFinite(max) ? new Date(max).toISOString() : null,
    },
  };
}

module.exports = { MAX_RESULTS, norm, cameraOf, toEntry, parseQuery, search };
