'use strict';
// Photo search (F6): free text over title, caption, place, album, file name
// and camera — plus the place's country in every language with its code,
// nicknames and continent (services/geo-names.js), and the capture month
// and year in words; filters on capture date range, camera and album. Works
// on the cached photo index, so a search reads no file.
//
// Every word must match (the start of a word or inside it). A photo with no
// place takes the countries of its album's other photos. When nothing
// matches, the search tolerates a typo per word (results flagged
// `approximate`).

const { countryOf, countryTerms } = require('./geo-names');

const MAX_RESULTS = 200;
const MONTH_LANGS = ['fr', 'en', 'es'];

// Lower case, accents removed, hyphens and apostrophes as spaces: "Été à
// Évora" matches "ete evora", "États-Unis" matches "etats unis".
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-'’]/g, ' ');

const cameraOf = (p) => {
  const make = (p.exif?.make ?? '').trim(), model = (p.exif?.model ?? '').trim();
  // "Apple iPhone 15", but "Canon EOS R6" (not "Canon Canon EOS R6") and
  // "NIKON Z 6" (not "NIKON CORPORATION NIKON Z 6"): drop the brand when the
  // model already starts with it.
  const brand = make.split(/\s+/)[0].toLowerCase();
  if (model && brand && model.toLowerCase().startsWith(brand)) return model;
  return [make, model].filter(Boolean).join(' ') || null;
};

// "juillet july julio 2025" for a capture date (camera-local time stored as UTC)
const monthFmts = MONTH_LANGS.map((l) => new Intl.DateTimeFormat(l, { month: 'long', timeZone: 'UTC' }));
function dateWords(ms) {
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  return [...new Set(monthFmts.map((f) => f.format(d)))].join(' ') + ` ${d.getUTCFullYear()}`;
}

/** One searchable entry per photo (overrides and place already applied). */
function toEntry(album, p) {
  const camera = cameraOf(p);
  const time = p.takenAt ? Date.parse(p.takenAt) : NaN;
  const country = countryOf(p.location);
  return {
    album, filename: p.filename, type: p.type, name: p.name, description: p.description || '',
    location: p.location || null, camera, takenAt: p.takenAt || null,
    thumbUrl: p.thumbUrl || null, url: p.url,
    _text: norm([p.name, p.description, p.location, album, p.filename, camera, country && countryTerms(country), dateWords(time)]
      .filter(Boolean).join(' ')),
    _time: time,
    _country: country,
  };
}

/**
 * A photo with no recognised country takes those of its album's other photos:
 * the shots of an album "New York" without GPS still answer "usa".
 */
function withAlbumCountries(entries) {
  const byAlbum = new Map();
  for (const e of entries) if (e._country) {
    if (!byAlbum.has(e.album)) byAlbum.set(e.album, new Set());
    byAlbum.get(e.album).add(e._country);
  }
  for (const e of entries) {
    const codes = !e._country && byAlbum.get(e.album);
    if (codes) e._text += ' ' + norm([...codes].map(countryTerms).join(' '));
  }
  return entries;
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

// ── Typo tolerance (only when nothing matches exactly) ──────────────────────

/** Damerau–Levenshtein distance, stopping early above `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

// a word of 4+ letters may have one typo, of 8+ two; it is compared with each
// word of the photo and with that word's start of the same length (the
// search matches word starts too)
function nearWord(term, words) {
  const max = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
  if (!max) return words.some((w) => w.includes(term));
  return words.some((w) => w.includes(term)
    || editDistance(term, w, max) <= max
    || (w.length > term.length && editDistance(term, w.slice(0, term.length), max) <= max));
}

function matchesApprox(e, filters) {
  if (!matches(e, { ...filters, terms: [] })) return false;
  e._words ??= e._text.split(' ');
  return filters.terms.every((t) => nearWord(t, e._words));
}

/** Matching photos, most recent first (undated last), plus the filter choices. */
function search(entries, filters) {
  let hits = entries.filter((e) => matches(e, filters));
  const approximate = !hits.length && filters.terms.length > 0;
  if (approximate) hits = entries.filter((e) => matchesApprox(e, filters));
  hits.sort((a, b) => {
    const ta = Number.isNaN(a._time) ? -Infinity : a._time, tb = Number.isNaN(b._time) ? -Infinity : b._time;
    return tb - ta || a.album.localeCompare(b.album) || a.filename.localeCompare(b.filename);
  });
  const cameras = new Map();
  let min = Infinity, max = -Infinity;
  for (const e of entries) {
    if (e.camera) cameras.set(e.camera, (cameras.get(e.camera) ?? 0) + 1);
    if (!Number.isNaN(e._time)) { min = Math.min(min, e._time); max = Math.max(max, e._time); }
  }
  const strip = ({ _text, _time, _country, _words, ...e }) => e;
  return {
    total: hits.length,
    approximate: approximate && hits.length > 0,
    results: hits.slice(0, MAX_RESULTS).map(strip),
    facets: {
      cameras: [...cameras].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      albums:  [...new Set(entries.map((e) => e.album))].sort((a, b) => a.localeCompare(b)),
      dateFrom: Number.isFinite(min) ? new Date(min).toISOString() : null,
      dateTo:   Number.isFinite(max) ? new Date(max).toISOString() : null,
    },
  };
}

module.exports = { MAX_RESULTS, norm, cameraOf, toEntry, withAlbumCountries, parseQuery, search, editDistance };
