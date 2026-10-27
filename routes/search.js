'use strict';

const express   = require('express');
const library   = require('../services/library');
const overrides = require('../services/overrides');
const places    = require('../services/places');
const search    = require('../services/search');
const { resolveUser, filterVisibleAlbums } = require('../services/access');

const router = express.Router();

// GET /api/search?q=&from=YYYY-MM-DD&to=YYYY-MM-DD&camera=&album=
// Searches the photos of every album the user can see.
router.get('/', async (req, res) => {
  const { filters, error } = search.parseQuery(req.query);
  if (error) return res.status(400).json({ error });
  try {
    const names = await library.listAlbums();
    const user = await resolveUser(req.cookies?.pb_session);
    const { filtered } = await filterVisibleAlbums(names.map((name) => ({ name, isDirectory: () => true })), user);
    const ovs = await overrides.loadOverrides(filtered.map((e) => e.name))
      .catch((err) => { console.error('Failed to load photo overrides:', err.message); return new Map(); });

    const entries = [];
    for (const { name: album } of filtered) {
      for (const raw of (await library.getAlbumPhotos(album)) ?? []) {
        const p = overrides.applyOverride(raw, ovs.get(`${album}/${raw.filename}`));
        // GPS photos without a place: the reverse-geocoding cache (never a network call here)
        if (!p.location && p.gps) p.location = (await places.cached(p.gps.lat, p.gps.lng)) ?? null;
        entries.push(search.toEntry(album, p));
      }
    }
    res.json(search.search(entries, filters));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
