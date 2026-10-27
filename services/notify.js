'use strict';
// Automatic "new photos" notifications (F9).
//
// New files are collected per album — from uploads and from the photo
// watcher, so photos copied by any means count, once each — and a single
// push digest goes to the album's subscribers when no new photo has arrived
// for QUIET_MS (or MAX_WAIT_MS after the first one, for a long import).
// Albums can opt out in the admin (album_settings.notify_new). Pending
// digests live in memory: a restart in the quiet period drops them.
const database = require('./database');
const push     = require('./push');

const QUIET_MS    = Number(process.env.NOTIFY_QUIET_MS)    || 10 * 60 * 1000;
const MAX_WAIT_MS = Number(process.env.NOTIFY_MAX_WAIT_MS) || 60 * 60 * 1000;

const pending = new Map();   // album → { files: Set, first: ms, timer }

const MESSAGES = {
  // the server does not know the subscriber's language; the app's default is French
  one:  (n) => `${n} nouvelle photo`,
  many: (n) => `${n} nouvelles photos`,
};

async function enabledFor(album) {
  if (!database.dbReady) return true;
  const { rows } = await database.db.query('SELECT notify_new FROM album_settings WHERE album = $1', [album]);
  return rows[0]?.notify_new ?? true;
}

function photosAdded(album, filenames, _deps = {}) {
  if (!filenames.length) return;
  const now = (_deps.now ?? Date.now)();
  let p = pending.get(album);
  if (!p) { p = { files: new Set(), first: now, timer: null }; pending.set(album, p); }
  for (const f of filenames) p.files.add(f);
  clearTimeout(p.timer);
  const wait = Math.max(0, Math.min(QUIET_MS, p.first + MAX_WAIT_MS - now));
  p.timer = setTimeout(() => flush(album, _deps).catch((err) => console.error('New-photo notification failed:', err.message)), wait);
  p.timer.unref?.();
}

/** A photo deleted before the digest went out is not announced. */
function photoRemoved(album, filename) {
  pending.get(album)?.files.delete(filename);
}

async function flush(album, _deps = {}) {
  const p = pending.get(album);
  pending.delete(album);
  if (!p) return 0;
  clearTimeout(p.timer);
  const files = [...p.files].sort();
  if (!files.length || !(await enabledFor(album))) return 0;
  const n = files.length;
  const sent = await (_deps.send ?? push.sendToAlbum)(album, {
    title: album,
    body:  (n === 1 ? MESSAGES.one : MESSAGES.many)(n),
    photo: files[0],
    tag:   `album-${album}`,
  });
  if (sent) console.log(`  ✓ New-photo notification: ${album} (${n}) → ${sent} subscriber(s).`);
  return sent;
}

const pendingFor = (album) => [...(pending.get(album)?.files ?? [])];
function _reset() { for (const p of pending.values()) clearTimeout(p.timer); pending.clear(); }

module.exports = { photosAdded, photoRemoved, flush, pendingFor, QUIET_MS, MAX_WAIT_MS, _reset };
