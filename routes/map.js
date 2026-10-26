'use strict';

const express  = require('express');
const path     = require('path');
const library  = require('../services/library');
const { resolveUser, filterVisibleAlbums }  = require('../services/access');

const router = express.Router();

// GET /api/map — all GPS photos across all visible albums. Metadata comes from
// the cached library index, so this no longer re-reads every photo's EXIF.
router.get('/', async (req, res) => {
  try {
    const names = await library.listAlbums();
    const user = await resolveUser(req.cookies?.pb_session);
    const { filtered } = await filterVisibleAlbums(names.map((name) => ({ name, isDirectory: () => true })), user);

    const buckets = await Promise.all(filtered.map(async ({ name: album }) => {
      const photos = (await library.getAlbumPhotos(album)) ?? [];
      return photos
        .map((p, albumIndex) => ({ p, albumIndex }))
        .filter(({ p }) => p.gps)
        .map(({ p, albumIndex }) => ({
          gps:        p.gps,
          date:       p.takenAt,
          name:       path.basename(p.filename, path.extname(p.filename)),
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
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
