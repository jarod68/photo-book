'use strict';
// GPS position privacy per album (F10): 'exact' (default), 'approx' (rounded
// to ~1 km) or 'hidden'. Applies to everyone but admins:
//  - the APIs (album, map, globe) round or drop the coordinates;
//  - original image files, whose EXIF holds the exact position, are replaced
//    by a full-size JPEG without metadata (the 'display' derivative), both in
//    /photos/… and in the zip export.
// Videos are served as they are: removing their metadata would need ffmpeg.
const path     = require('path');
const database = require('./database');
const { PHOTOS_DIR, MEDIUM_DIR, ensureDisplay, derivName } = require('./image');

const MODES = ['exact', 'approx', 'hidden'];
const APPROX_DECIMALS = 2;              // 0.01° ≈ 1.1 km of latitude
const TTL_MS = 60 * 1000;               // settings re-read at most once a minute

let cache = { at: 0, map: new Map() };  // album → mode (absent = exact)

async function load() {
  const { rows } = await database.db.query(
    "SELECT album, gps_privacy FROM album_settings WHERE gps_privacy <> 'exact'");
  return new Map(rows.map((r) => [r.album, r.gps_privacy]));
}

/** The album's mode. Without a database, the last known settings apply. */
async function modeFor(album) {
  if (database.dbReady && Date.now() - cache.at > TTL_MS) {
    try { cache = { at: Date.now(), map: await load() }; } catch (err) {
      console.error('GPS privacy settings unavailable:', err.message);
    }
  }
  return cache.map.get(album) ?? 'exact';
}

function invalidate() { cache = { at: 0, map: cache.map }; }

const isAdmin = (user) => user?.role === 'admin';

/** Whether this user gets the original file and exact position. */
async function exactFor(album, user) {
  return isAdmin(user) || (await modeFor(album)) === 'exact';
}

const round = (x) => Number(x.toFixed(APPROX_DECIMALS));

/** A copy of the photo with its position rounded or removed for `mode`. */
function protect(photo, mode) {
  if (mode === 'exact' || !photo.gps) return photo;
  if (mode === 'hidden') return { ...photo, gps: null };
  return { ...photo, gps: { lat: round(photo.gps.lat), lng: round(photo.gps.lng) }, gpsApprox: true };
}

/** protect() for every photo of an album, unless the user is an admin. */
async function protectAll(album, photos, user) {
  if (isAdmin(user)) return photos;
  const mode = await modeFor(album);
  return mode === 'exact' ? photos : photos.map((p) => protect(p, mode));
}

/**
 * Path of the photo's full-size copy without metadata (made on first use),
 * served instead of the original when the position must not leak.
 */
async function cleanCopy(album, file) {
  await ensureDisplay(album, file, path.join(PHOTOS_DIR, album, file));
  return path.join(MEDIUM_DIR, album, derivName('display', file));
}

/** File name of that copy in a download: always a JPEG, never a clash. */
const cleanName = (file) => (/\.jpe?g$/i.test(file) ? file : `${file}.jpg`);

function _reset() { cache = { at: 0, map: new Map() }; }

module.exports = { MODES, APPROX_DECIMALS, modeFor, invalidate, exactFor, protect, protectAll, cleanCopy, cleanName, _reset };
