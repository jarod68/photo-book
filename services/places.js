// @ts-check
'use strict';
// Reverse geocoding (GPS → "Place, Country") with a persistent cache (F6).
// Besides that short name (shown), each lookup keeps for search the place's
// wider address — district, city, county, state, region — and its names in
// other languages ("terms": Manhattan → New York, Vienne → Wien, Vienna).
//
// Nominatim's usage policy: at most one request per second, an identifying
// User-Agent, and results cached. Lookups are serialized through one queue
// spaced by MIN_GAP_MS; results live in memory and in `place_cache`, so a
// place is fetched once per ~100 m cell, ever. In the background the server
// resolves every GPS photo that has no place yet, so search can find it.
const database = require('./database');

const MIN_GAP_MS = 1100;
const RETRY_MS   = 24 * 60 * 60 * 1000;   // a failed lookup is retried after a day
const memo = new Map();                    // key → { location (string | null), terms (string | null = not fetched yet) }
const failedAt = new Map();                // key → time of the last network failure
// places never looked up: remembered a while too, or every search would ask
// the database again for each such photo (2 queries a photo); a lookup that
// finds the place replaces the entry at once (memo.set)
const missedAt = new Map();                // key → time the database had nothing
const MISS_MS = 5 * 60_000;
let queue = Promise.resolve();
let lastCall = 0;

const keyOf = (lat, lng) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

// address parts kept for search, from the smallest to the widest
const AREA_KEYS = ['neighbourhood', 'quarter', 'suburb', 'village', 'hamlet', 'town', 'city_district', 'city', 'municipality',
  'county', 'state_district', 'state', 'province', 'region', 'island', 'archipelago'];
// names of the place itself in other languages, official and short forms
const NAME_KEY = /^(name|alt_name|short_name|official_name|int_name)(:(fr|en|es|de|it|pt|nl))?$/;

/** { location: "Place, Country" | null, terms: words for search ('' if none) } */
async function fetchPlace(lat, lng, _fetch = fetch) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&accept-language=fr&namedetails=1`;
  const raw = await _fetch(url, { headers: { 'User-Agent': 'photo-book/1.0 (self-hosted personal use)' } });
  if (!raw.ok) throw new Error(`Nominatim HTTP ${raw.status}`);
  const body = await raw.json();
  const a = body.address || {};
  const place   = a.village || a.suburb || a.town || a.city_district || a.city || a.municipality || a.county || '';
  const country = a.country || '';
  const words = new Set(AREA_KEYS.map((k) => a[k]).filter(Boolean));
  for (const [k, v] of Object.entries(body.namedetails || {})) if (NAME_KEY.test(k) && v) words.add(v);
  return { location: [place, country].filter(Boolean).join(', ') || null, terms: [...words].join(' ; ') };
}

// One Nominatim call at a time, at least MIN_GAP_MS apart.
function throttled(fn) {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

async function fromDb(key) {
  if (!database.dbReady) return undefined;
  const { rows } = await database.db.query('SELECT location, terms FROM place_cache WHERE key = $1', [key]);
  return rows.length ? { location: rows[0].location, terms: rows[0].terms ?? null } : undefined;
}

async function entry(key) {
  if (memo.has(key)) return memo.get(key);
  if (Date.now() - (missedAt.get(key) ?? -Infinity) < MISS_MS) return undefined;
  const v = await fromDb(key).catch(() => undefined);
  if (v !== undefined) memo.set(key, v);
  else missedAt.set(key, Date.now());
  return v;
}

/** Cached place name, or undefined when it was never looked up (no network call). */
async function cached(lat, lng) {
  return (await entry(keyOf(lat, lng)))?.location;
}

/** Cached search words of a place ('' none; null / undefined: not fetched yet). No network call. */
async function cachedTerms(lat, lng) {
  return (await entry(keyOf(lat, lng)))?.terms;
}

async function fetchAndStore(key, lat, lng, _deps) {
  if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS) return undefined;
  try {
    const v = await throttled(() => fetchPlace(lat, lng, _deps.fetch));
    memo.set(key, v);
    if (database.dbReady) {
      await database.db.query(
        `INSERT INTO place_cache (key, location, terms) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET location = $2, terms = $3, fetched_at = now()`, [key, v.location, v.terms],
      ).catch((err) => console.error('place_cache write failed:', err.message));
    }
    return v;
  } catch (err) {
    failedAt.set(key, Date.now());
    console.error('Geocode error:', err.message);
    return undefined;
  }
}

/** Place name for a GPS position, looked up on Nominatim when not cached. */
async function lookup(lat, lng, _deps = {}) {
  const key = keyOf(lat, lng);
  const hit = await entry(key);
  if (hit !== undefined) return hit.location;
  return (await fetchAndStore(key, lat, lng, _deps))?.location ?? null;
}

/**
 * In the background: geocode every GPS photo without a place, and fetch the
 * search words of places cached before they were kept (terms NULL).
 */
async function fillMissing(photos, _deps = {}) {
  let n = 0;
  const seen = new Set();
  for (const p of photos) {
    if (!p.gps || p.location) continue;
    const key = keyOf(p.gps.lat, p.gps.lng);
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = await entry(key);
    if (hit !== undefined && (hit.terms != null || hit.location == null)) continue;
    if (await fetchAndStore(key, p.gps.lat, p.gps.lng, _deps)) n++;
  }
  if (n) console.log(`  ✓ ${n} place(s) geocoded.`);
  return n;
}

function _reset() { memo.clear(); failedAt.clear(); missedAt.clear(); queue = Promise.resolve(); lastCall = 0; }

module.exports = { keyOf, cached, cachedTerms, lookup, fillMissing, fetchPlace, MIN_GAP_MS, _reset };
