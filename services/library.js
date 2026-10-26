'use strict';
// Photo library index (T2): album listings and per-photo metadata, cached.
//
// photoMeta() reads EXIF / GPS / XMP / IPTC and makes sure the derived images
// exist — far too much to redo for every photo on every album view or map
// load. The result is cached per photo and reused while the file's mtime and
// size are unchanged; a modified, replaced or deleted file is picked up on the
// next request (the photo watcher also drops entries eagerly). Concurrent
// requests for one photo share a single computation.
const path = require('path');
const fs = require('fs');
const { PHOTOS_DIR, isImage, isAlbumDir, photoMeta, withConcurrency } = require('./image');

const cache = new Map();      // "album/file" → { mtimeMs, size, meta }
const inflight = new Map();   // "album/file" → Promise<meta>
const key = (album, file) => `${album}/${file}`;

function albumPath(album) {
  const full = path.resolve(PHOTOS_DIR, album);
  if (!full.startsWith(PHOTOS_DIR + path.sep)) throw new Error('Invalid album');
  return full;
}

async function listAlbums() {
  const entries = await fs.promises.readdir(PHOTOS_DIR, { withFileTypes: true }).catch(() => []);
  return entries.filter(isAlbumDir).map((e) => e.name).sort((a, b) => a.localeCompare(b));
}

async function listPhotos(album) {
  const files = await fs.promises.readdir(albumPath(album)).catch(() => null);
  return files ? files.filter(isImage).sort() : null;
}

async function getPhoto(album, file) {
  const k = key(album, file);
  const dir = albumPath(album);
  const st = await fs.promises.stat(path.join(dir, file)).catch(() => null);
  const hit = cache.get(k);
  if (st && hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.meta;
  if (inflight.has(k)) return inflight.get(k);
  const p = photoMeta(album, file, dir)
    .then((meta) => {
      if (st) cache.set(k, { mtimeMs: st.mtimeMs, size: st.size, meta });
      return meta;
    })
    .finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

// Every photo of an album (null when the album does not exist), metadata
// computed with bounded concurrency; cache entries of vanished files dropped.
async function getAlbumPhotos(album, concurrency = 6) {
  const files = await listPhotos(album);
  if (!files) return null;
  const present = new Set(files);
  for (const k of cache.keys()) {
    const [a, ...rest] = k.split('/');
    if (a === album && !present.has(rest.join('/'))) cache.delete(k);
  }
  const out = new Array(files.length);
  await withConcurrency(files.map((f, i) => async () => { out[i] = await getPhoto(album, f); }), concurrency);
  return out;
}

function invalidate(album, file) {
  if (file) { cache.delete(key(album, file)); return; }
  for (const k of cache.keys()) if (k.startsWith(`${album}/`)) cache.delete(k);
}

function clear() { cache.clear(); }
const size = () => cache.size;

module.exports = { listAlbums, listPhotos, getPhoto, getAlbumPhotos, invalidate, clear, size, albumPath };
