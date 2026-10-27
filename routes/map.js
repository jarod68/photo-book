'use strict';

const express  = require('express');
const path     = require('path');
const library  = require('../services/library');
const overrides = require('../services/overrides');
const { resolveUser, filterVisibleAlbums }  = require('../services/access');

const { sendError } = require('../services/http-errors');

const router = express.Router();

// GET /api/map — all GPS photos across all visible albums. Metadata comes from
// the cached library index, so this no longer re-reads every photo's EXIF.
router.get('/', async (req, res) => {
  try {
    const names = await library.listAlbums();
    const user = await resolveUser(req.cookies?.pb_session);
    const { filtered } = await filterVisibleAlbums(names.map((name) => ({ name, isDirectory: () => true })), user);

    const ovs = await overrides.loadOverrides(filtered.map((e) => e.name))
      .catch((err) => { console.error('Failed to load photo overrides:', err.message); return new Map(); });

    const buckets = await Promise.all(filtered.map(async ({ name: album }) => {
      const photos = ((await library.getAlbumPhotos(album)) ?? [])
        .map((p) => overrides.applyOverride(p, ovs.get(`${album}/${p.filename}`)));
      return photos
        .map((p, albumIndex) => ({ p, albumIndex }))
        .filter(({ p }) => p.gps)
        .map(({ p, albumIndex }) => ({
          gps:        p.gps,
          date:       p.takenAt,
          name:       p.name || path.basename(p.filename, path.extname(p.filename)),
          location:   p.location,
          filename:   p.filename,
          previewUrl: p.previewUrl,
          thumbUrl:   p.thumbUrl,
          url:        p.url,
          album,
          albumIndex,
        }));
    }));

    res.json(buckets.flat());
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
