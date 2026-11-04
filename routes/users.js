// @ts-check
'use strict';
// Users seen by others: the directory (choosing an album's members), a
// public profile, a profile picture.

const express  = require('express');
const auth     = require('../services/auth');
const profiles = require('../services/profiles');
const { sendError } = require('../services/http-errors');

const router = express.Router();

// GET /api/users — [{ id, username, displayName }], for signed-in users
router.get('/', auth.requireAuth, async (_req, res) => {
  try {
    res.json(await profiles.directory());
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/users/:username — { username, displayName, bio, avatarUrl } (its
// albums and articles: from /api/albums and /api/articles, as the visitor
// may see them)
router.get('/:username', async (req, res) => {
  try {
    const p = await profiles.byUsername(req.params.username);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({
      username: p.username, displayName: p.displayName, bio: p.bio,
      avatarUrl: p.avatarVersion ? `/api/users/${encodeURIComponent(p.username)}/avatar?v=${p.avatarVersion}` : null,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/users/:username/avatar — the picture (versioned address: cached a year)
router.get('/:username/avatar', async (req, res) => {
  try {
    const a = await profiles.avatarOf(req.params.username);
    if (!a) return res.status(404).end();
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.send(a.data);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
