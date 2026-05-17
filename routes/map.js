'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const exifr    = require('exifr');

const { PHOTOS_DIR, PREVIEWS_DIR, isImage } = require('../services/image');
const { resolveUser, filterVisibleAlbums }  = require('../services/access');

const router = express.Router();

// GET /api/map — all GPS photos across all visible albums
router.get('/', async (req, res) => {
  if (!fs.existsSync(PHOTOS_DIR)) return res.json([]);
  try {
    const albumDirs = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(
      e => e.isDirectory?.() ?? false,
    );

    const user = await resolveUser(req.cookies?.pb_session);
    const { filtered: allowedDirs } = await filterVisibleAlbums(albumDirs, user);

    const buckets = await Promise.all(allowedDirs.map(async dir => {
      const albumPath = path.join(PHOTOS_DIR, dir.name);
      const files     = fs.readdirSync(albumPath).filter(isImage).sort();
      const photos    = [];

      await Promise.all(files.map(async (file, albumIndex) => {
        try {
          const filePath = path.join(albumPath, file);
          const [g, tags] = await Promise.all([
            exifr.gps(filePath),
            exifr.parse(filePath, ['DateTimeOriginal', 'CreateDate']).catch(() => null),
          ]);
          if (!g?.latitude) return;

          const previewName = path.parse(file).name + '.jpg';
          const previewPath = path.join(PREVIEWS_DIR, dir.name, previewName);
          const previewUrl  = fs.existsSync(previewPath)
            ? `/previews/${encodeURIComponent(dir.name)}/${encodeURIComponent(previewName)}`
            : null;

          const rawDate = tags?.DateTimeOriginal ?? tags?.CreateDate ?? null;

          photos.push({
            gps:        { lat: +g.latitude.toFixed(6), lng: +g.longitude.toFixed(6) },
            date:       rawDate instanceof Date ? rawDate.toISOString() : null,
            name:       path.basename(file, path.extname(file)),
            filename:   file,
            previewUrl,
            url:        `/photos/${encodeURIComponent(dir.name)}/${encodeURIComponent(file)}`,
            album:      dir.name,
            albumIndex,
          });
        } catch (err) { console.error('Map photo EXIF read failed:', err.message); }
      }));

      return photos;
    }));

    res.json(buckets.flat());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
