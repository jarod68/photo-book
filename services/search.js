// @ts-check
'use strict';
// Photo search (F6). Works on the cached photo index, so a search reads no file.
//
// Each photo is a set of fields, each with a weight: its title, album and
// place count most; then its caption, the album's description, the place's
// wider address and other-language names (services/places.js), its country
// in every language with code, nicknames and continent (services/geo-names.js),
// its date in words (day, month, season, year) and kind (video, 360°); then
// file name and camera. Text is compared without accents, case, ligatures or
// punctuation.
//
// The query's words are matched against the words of those fields — a whole
// word, the start of one ("pari" → Paris), a light plural ("plages" →
// plage), or inside a word for 4+ letters and numbers — and small words
// ("de", "the", "photos") are left out. Every word must match; results are
// ranked by how well (the field's weight × whole word > start > inside),
// then most recent first. When no photo matches every word, the search
// falls back to approximate matching: a typo per word (two from 8 letters),
// then — for queries of 3 words or more — the photos that match most of
// them (with two words, one of them alone is too loose: "san francisco"
// would bring every "San José"); flagged `approximate`.
// Filters: capture date range, camera, album. Results come by pages
// (offset / limit).

const { countryOf, countryTerms } = require('./geo-names');

const PAGE_SIZE = 120;      // results per page (the page asks for the next ones)
const MAX_PAGE  = 500;
const MONTH_LANGS = ['fr', 'en', 'es'];

// Lower case, accents and ligatures removed, punctuation as spaces (but "_"
// and "." kept inside file names): "Été à Évora" matches "ete evora",
// "États-Unis" "etats unis", "Œuvre" "oeuvre".
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/ł/g, 'l')
  .replace(/[^\p{L}\p{N}_.]+/gu, ' ').replace(/(^|\s)\.+|\.+(\s|$)/g, ' ').trim();

const words = (s) => norm(s).split(' ').filter(Boolean);

// Words that say nothing about a photo, in French, English and Spanish.
const STOP = new Set(('de du des la le les un une et en a au aux dans sur pour par avec ' +
  'the of a an and in on at to for with from my our ' +
  'el los las del y con por para mi ' +
  'photo photos foto fotos picture pictures image images pic pics').split(' '));

// A light plural: "plages" → "plage", "chevaux" stays (too irregular).
const stem = (w) => (w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);

const cameraOf = (p) => {
  const make = (p.exif?.make ?? '').trim(), model = (p.exif?.model ?? '').trim();
  // "Apple iPhone 15", but "Canon EOS R6" (not "Canon Canon EOS R6") and
  // "NIKON Z 6" (not "NIKON CORPORATION NIKON Z 6"): drop the brand when the
  // model already starts with it.
  const brand = make.split(/\s+/)[0].toLowerCase();
  if (model && brand && model.toLowerCase().startsWith(brand)) return model;
  return [make, model].filter(Boolean).join(' ') || null;
};

// ── Date in words ────────────────────────────────────────────────────────────

const monthFmts = MONTH_LANGS.map((l) => new Intl.DateTimeFormat(l, { month: 'long', timeZone: 'UTC' }));
const SEASONS = [   // northern hemisphere; flipped south of the equator
  'hiver winter invierno', 'printemps spring primavera', 'ete summer verano', 'automne autumn fall otono',
];
/** "14 juin june junio ete summer verano 2025" (camera-local time stored as UTC). */
function dateWords(ms, lat) {
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  let season = Math.floor(((d.getUTCMonth() + 1) % 12) / 3);   // Dec–Feb = 0 (winter)
  if (lat < 0) season = (season + 2) % 4;
  return [d.getUTCDate(), ...new Set(monthFmts.map((f) => f.format(d))), SEASONS[season], d.getUTCFullYear()].join(' ');
}

// ── Index ────────────────────────────────────────────────────────────────────

// field → weight in the score
const WEIGHTS = { name: 5, album: 4, place: 4, description: 3, area: 3, country: 2, when: 2, kind: 2, albumText: 1.5, file: 1, camera: 1 };

/**
 * One searchable entry per photo (overrides, privacy and place applied).
 * extra: { placeTerms: the place's wider address / names, albumDescription }
 */
function toEntry(album, p, extra = {}) {
  const camera = cameraOf(p);
  const time = p.takenAt ? Date.parse(p.takenAt) : NaN;
  const country = countryOf(p.location) ?? countryOf(extra.placeTerms);
  const kind = [p.type === 'video' && 'video film', p.is360 && '360 panorama panoramique'].filter(Boolean).join(' ');
  const fields = {
    name: p.name, album, place: p.location, description: p.description, area: extra.placeTerms,
    country: country && countryTerms(country), when: dateWords(time, p.gps?.lat ?? 0), kind,
    albumText: extra.albumDescription, file: p.filename, camera,
  };
  return {
    album, filename: p.filename, type: p.type, name: p.name, description: p.description || '',
    location: p.location || null, camera, takenAt: p.takenAt || null,
    thumbUrl: p.thumbUrl || null, url: p.url,
    _fields: Object.entries(fields).filter(([, v]) => v).map(([k, v]) => ({ w: WEIGHTS[k], words: words(v) })),
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
    if (codes) e._fields.push({ w: WEIGHTS.country * 0.75, words: words([...codes].map(countryTerms).join(' ')) });
  }
  return entries;
}

// ── Query ────────────────────────────────────────────────────────────────────

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
  const all = [...new Set(words(q))];
  const kept = all.filter((w) => !STOP.has(w));
  const int = (v, def, max) => Math.min(max, Math.max(0, Number.parseInt(one(v), 10) || def));
  return { filters: {
    terms: kept.length ? kept : all, fromMs, toMs, camera: one(query.camera) || null, album: one(query.album) || null,
    offset: int(query.offset, 0, 1e6), limit: int(query.limit, PAGE_SIZE, MAX_PAGE) || PAGE_SIZE,
  } };
}

function passesFilters(e, { fromMs, toMs, camera, album }) {
  if (album && e.album !== album) return false;
  if (camera && e.camera !== camera) return false;
  if (fromMs !== null || toMs !== null) {
    if (Number.isNaN(e._time)) return false;
    if (fromMs !== null && e._time < fromMs) return false;
    if (toMs !== null && e._time > toMs) return false;
  }
  return true;
}

// ── Matching ─────────────────────────────────────────────────────────────────

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

/**
 * How well one query word matches one word of a photo: 1 whole word (or the
 * same plural), 0.75 its start, 0.4 inside it (4+ letters or a number),
 * 0.5 with a typo when `fuzzy`; 0 no match.
 */
function wordScore(t, w, fuzzy) {
  if (w === t || stem(w) === stem(t)) return 1;
  if (w.startsWith(t)) return 0.75;
  if ((t.length >= 4 || /^\d+$/.test(t)) && w.includes(t)) return 0.4;
  if (fuzzy && t.length >= 4) {
    const max = t.length >= 8 ? 2 : 1;
    if (editDistance(t, w, max) <= max) return 0.5;
    if (w.length > t.length && editDistance(t, w.slice(0, t.length), max) <= max) return 0.4;
  }
  return 0;
}

/** Best score of a query word over a photo's fields (field weight × match). */
function termScore(e, t, fuzzy) {
  let best = 0;
  for (const f of e._fields) {
    if (f.w <= best) continue;
    for (const w of f.words) {
      const s = f.w * wordScore(t, w, fuzzy);
      if (s > best) best = s;
      if (best === f.w) break;
    }
  }
  return best;
}

/** { score, matched } of a photo for the query words. */
function scoreOf(e, terms, fuzzy) {
  let score = 0, matched = 0;
  for (const t of terms) {
    const s = termScore(e, t, fuzzy);
    if (s > 0) { score += s; matched++; }
  }
  return { score, matched };
}

/** Matching photos, best first (then most recent; undated last), plus the filter choices. */
function search(entries, filters) {
  const pool = entries.filter((e) => passesFilters(e, filters));
  const { terms } = filters;
  let hits, approximate = false;
  if (!terms.length) {
    hits = pool.map((e) => ({ e, score: 0 }));
  } else {
    const rank = (fuzzy) => pool.map((e) => ({ e, ...scoreOf(e, terms, fuzzy) }));
    hits = rank(false).filter((h) => h.matched === terms.length);
    if (!hits.length) {
      // approximate: a typo allowed; every word if possible, else as many as can be
      const ranked = rank(true).filter((h) => h.matched > 0);
      const best = Math.max(0, ...ranked.map((h) => h.matched));
      const enough = best === terms.length || (terms.length >= 3 && best >= Math.ceil(terms.length / 2));
      hits = enough ? ranked.filter((h) => h.matched === best) : [];
      approximate = hits.length > 0;
    }
  }
  const timeOf = (e) => (Number.isNaN(e._time) ? -Infinity : e._time);
  hits.sort((a, b) => b.score - a.score || timeOf(b.e) - timeOf(a.e)
    || a.e.album.localeCompare(b.e.album) || a.e.filename.localeCompare(b.e.filename));

  const cameras = new Map();
  let min = Infinity, max = -Infinity;
  for (const e of entries) {
    if (e.camera) cameras.set(e.camera, (cameras.get(e.camera) ?? 0) + 1);
    if (!Number.isNaN(e._time)) { min = Math.min(min, e._time); max = Math.max(max, e._time); }
  }
  const strip = ({ _fields, _time, _country, ...e }) => e;
  return {
    total: hits.length,
    approximate,
    offset: filters.offset ?? 0,
    results: hits.slice(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? PAGE_SIZE)).map((h) => strip(h.e)),
    facets: {
      cameras: [...cameras].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      albums:  [...new Set(entries.map((e) => e.album))].sort((a, b) => a.localeCompare(b)),
      dateFrom: Number.isFinite(min) ? new Date(min).toISOString() : null,
      dateTo:   Number.isFinite(max) ? new Date(max).toISOString() : null,
    },
  };
}

module.exports = { PAGE_SIZE, norm, cameraOf, toEntry, withAlbumCountries, parseQuery, search, editDistance };
