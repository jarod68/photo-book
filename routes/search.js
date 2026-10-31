'use strict';

const express   = require('express');
const library   = require('../services/library');
const overrides = require('../services/overrides');
const places    = require('../services/places');
const search    = require('../services/search');
const albumInfo = require('../services/album-info');
const gpsPrivacy = require('../services/gps-privacy');
const { resolveUser, filterVisibleAlbums } = require('../services/access');

const { sendError } = require('../services/http-errors');

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
    const infos = await albumInfo.loadAlbumInfo().catch(() => new Map());

    const entries = [];
    for (const { name: album } of filtered) {
      const raws = ((await library.getAlbumPhotos(album)) ?? []).map((raw) => overrides.applyOverride(raw, ovs.get(`${album}/${raw.filename}`)));
      // an album whose positions are hidden gives no place away through search
      // either; rounded ones ('approx') still have their town (the cache is
      // keyed on the exact position, and a town name reveals no more)
      const shown = await gpsPrivacy.protectAll(album, raws, user);
      for (let i = 0; i < raws.length; i++) {
        const p = shown[i], gps = p.gps && raws[i].gps;
        let placeTerms = null;
        if (gps) {
          // the reverse-geocoding cache only (never a network call here)
          if (!p.location) p.location = (await places.cached(gps.lat, gps.lng)) ?? null;
          placeTerms = (await places.cachedTerms(gps.lat, gps.lng)) || null;
        }
        entries.push(search.toEntry(album, p, { placeTerms, albumDescription: infos.get(album)?.description }));
      }
    }
    res.json(search.search(search.withAlbumCountries(entries), filters));
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
