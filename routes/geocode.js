'use strict';

const express = require('express');

const router = express.Router();

// In-memory reverse geocoding cache — entries: key → { value, expiresAt }
const geoCache = new Map();
const GEO_MAX  = 2000;
const GEO_TTL  = 24 * 60 * 60 * 1000; // 24 h

// GET /api/geocode
router.get('/', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  const key    = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = geoCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return res.json({ location: cached.value });

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&accept-language=fr`;
    const raw = await fetch(url, {
      headers: { 'User-Agent': 'photo-book/1.0 (self-hosted personal use)' },
    });
    const data     = await raw.json();
    const a        = data.address || {};
    const place    = a.village || a.suburb || a.town || a.city_district || a.city || a.municipality || a.county || '';
    const country  = a.country || '';
    const location = [place, country].filter(Boolean).join(', ') || null;
    // Evict: remove oldest entry or any stale entry to stay within cap
    if (geoCache.size >= GEO_MAX) {
      const now = Date.now();
      const staleKey = [...geoCache.entries()].find(([, v]) => v.expiresAt <= now)?.[0]
        ?? geoCache.keys().next().value;
      geoCache.delete(staleKey);
    }
    geoCache.set(key, { value: location, expiresAt: Date.now() + GEO_TTL });
    res.json({ location });
  } catch (err) {
    console.error('Geocode error:', err.message);
    res.json({ location: null });
  }
});

module.exports = router;
