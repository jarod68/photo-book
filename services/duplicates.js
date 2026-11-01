// @ts-check
'use strict';
// Duplicate photos across the library (admin, F3 of the 2026-11 audit).
//
// - identical: the same bytes. Files are first grouped by size (a stat, no
//   read); only files sharing a size are hashed (SHA-1, streamed), and the
//   hash is kept in memory per path + size + mtime, so a second look reads
//   nothing new.
// - probable: different files of the same shot — the same capture time to
//   the second, the same camera and the same proportions (a resized or
//   re-exported copy, a HEIC and its JPEG). Bursts can share a second: the
//   admin looks before deleting.
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const library = require('./library');
const { PHOTOS_DIR } = require('./image');

const hashes = new Map();   // "path:size:mtime" → sha1

function sha1(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

async function hashOf(file, stat) {
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (!hashes.has(key)) hashes.set(key, await sha1(file));
  return hashes.get(key);
}

/** @param {any} p a library photo  @param {string} album  @param {number} size */
const describe = (p, album, size) => ({
  album, filename: p.filename, type: p.type, name: p.name, url: p.url, thumbUrl: p.thumbUrl || null,
  takenAt: p.takenAt || null, width: p.exif?.width ?? null, height: p.exif?.height ?? null, size,
});

/**
 * { identical: [[photo, …], …], probable: [[photo, …], …] } — each group
 * sorted by album then file name; groups biggest first.
 * @param {{ albums?: string[], root?: string }} [opts]  root: the photo library (tests)
 */
async function findDuplicates({ albums, root = PHOTOS_DIR } = {}) {
  const items = [];
  for (const album of albums ?? await library.listAlbums()) {
    for (const p of (await library.getAlbumPhotos(album)) ?? []) {
      const file = path.join(root, album, p.filename);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (stat?.isFile()) items.push({ p, album, file, stat });
    }
  }

  // identical: same size, then same hash
  const bySize = new Map();
  for (const it of items) {
    if (!bySize.has(it.stat.size)) bySize.set(it.stat.size, []);
    bySize.get(it.stat.size).push(it);
  }
  const byHash = new Map();
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    for (const it of group) {
      const h = await hashOf(it.file, it.stat).catch(() => null);
      if (!h) continue;
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(it);
    }
  }
  const identical = [...byHash.values()].filter((g) => g.length > 1);
  const inIdentical = new Set(identical.flat());

  // probable: same second, same camera, same proportions (either way round)
  const byShot = new Map();
  for (const it of items) {
    const { p } = it;
    if (inIdentical.has(it) || p.type === 'video' || !p.takenAt || !p.exif?.width || !p.exif?.height) continue;
    const ratio = Math.max(p.exif.width, p.exif.height) / Math.min(p.exif.width, p.exif.height);
    const key = [p.takenAt.slice(0, 19), p.exif.make ?? '', p.exif.model ?? '', ratio.toFixed(2)].join('|');
    if (!byShot.has(key)) byShot.set(key, []);
    byShot.get(key).push(it);
  }
  const probable = [...byShot.values()].filter((g) => g.length > 1);

  const out = (groups) => groups
    .map((g) => g.map((it) => describe(it.p, it.album, it.stat.size))
      .sort((a, b) => a.album.localeCompare(b.album) || a.filename.localeCompare(b.filename)))
    .sort((a, b) => b.length - a.length || a[0].album.localeCompare(b[0].album) || a[0].filename.localeCompare(b[0].filename));
  return { identical: out(identical), probable: out(probable) };
}

function _reset() { hashes.clear(); }

module.exports = { findDuplicates, _reset };
