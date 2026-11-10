// @ts-check
'use strict';
// GET /api/memories[?date=YYYY-MM-DD] — "on this day" in earlier years, from
// the albums the reader may see (the date: the reader's today, else the server's).

const express  = require('express');
const library  = require('../services/library');
const memories = require('../services/memories');
const { resolveUser, filterVisibleAlbums } = require('../services/access');
const { sendError } = require('../services/http-errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? new Date(`${req.query.date}T12:00:00Z`) : new Date();
    if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Invalid date' });
    const user = await resolveUser(req.cookies?.pb_session);
    const names = await library.listAlbums();
    const { filtered } = await filterVisibleAlbums(names.map((name) => ({ name, isDirectory: () => true })), user);
    const entries = [];
    for (const { name } of filtered) {
      for (const photo of (await library.getAlbumPhotos(name)) ?? []) entries.push({ album: name, photo });
    }
    res.json(memories.onThisDay(entries, date));
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
