'use strict';
// Reverse geocoding (GPS → "Place, Country") with a persistent cache (F6).
//
// Nominatim's usage policy: at most one request per second, an identifying
// User-Agent, and results cached. Lookups are serialized through one queue
// spaced by MIN_GAP_MS; results live in memory and in `place_cache`, so a
// place is fetched once per ~100 m cell, ever. In the background the server
// resolves every GPS photo that has no place yet, so search can find it.
const database = require('./database');

const MIN_GAP_MS = 1100;
const RETRY_MS   = 24 * 60 * 60 * 1000;   // a failed lookup is retried after a day
const memo = new Map();                    // key → location (string | null)
const failedAt = new Map();                // key → time of the last network failure
let queue = Promise.resolve();
let lastCall = 0;

const keyOf = (lat, lng) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

async function fetchPlace(lat, lng, _fetch = fetch) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&accept-language=fr`;
  const raw = await _fetch(url, { headers: { 'User-Agent': 'photo-book/1.0 (self-hosted personal use)' } });
  if (!raw.ok) throw new Error(`Nominatim HTTP ${raw.status}`);
  const a = (await raw.json()).address || {};
  const place   = a.village || a.suburb || a.town || a.city_district || a.city || a.municipality || a.county || '';
  const country = a.country || '';
  return [place, country].filter(Boolean).join(', ') || null;
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
  const { rows } = await database.db.query('SELECT location FROM place_cache WHERE key = $1', [key]);
  return rows.length ? rows[0].location : undefined;
}

/** Cached place name, or undefined when it was never looked up (no network call). */
async function cached(lat, lng) {
  const key = keyOf(lat, lng);
  if (memo.has(key)) return memo.get(key);
  const v = await fromDb(key).catch(() => undefined);
  if (v !== undefined) memo.set(key, v);
  return v;
}

/** Place name for a GPS position, looked up on Nominatim when not cached. */
async function lookup(lat, lng, _deps = {}) {
  const key = keyOf(lat, lng);
  const hit = await cached(lat, lng);
  if (hit !== undefined) return hit;
  if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS) return null;
  try {
    const location = await throttled(() => fetchPlace(lat, lng, _deps.fetch));
    memo.set(key, location);
    if (database.dbReady) {
      await database.db.query(
        `INSERT INTO place_cache (key, location) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET location = $2, fetched_at = now()`, [key, location],
      ).catch((err) => console.error('place_cache write failed:', err.message));
    }
    return location;
  } catch (err) {
    failedAt.set(key, Date.now());
    console.error('Geocode error:', err.message);
    return null;
  }
}

/** Resolve, in the background, every GPS photo without a place. */
async function fillMissing(photos, _deps = {}) {
  let n = 0;
  for (const p of photos) {
    if (!p.gps || p.location) continue;
    if (await cached(p.gps.lat, p.gps.lng) !== undefined) continue;
    await lookup(p.gps.lat, p.gps.lng, _deps);
    n++;
  }
  if (n) console.log(`  ✓ ${n} place(s) geocoded.`);
  return n;
}

function _reset() { memo.clear(); failedAt.clear(); queue = Promise.resolve(); lastCall = 0; }

module.exports = { keyOf, cached, lookup, fillMissing, fetchPlace, MIN_GAP_MS, _reset };
