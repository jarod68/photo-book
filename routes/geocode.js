'use strict';

const express = require('express');
const places  = require('../services/places');

const router = express.Router();

// GET /api/geocode — place name for a GPS position (cached, see services/places.js)
router.get('/', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }
  res.json({ location: await places.lookup(lat, lng) });
});

module.exports = router;
