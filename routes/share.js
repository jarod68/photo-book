'use strict';

const express  = require('express');
const database = require('../services/database');

const router = express.Router();

// GET /api/share/:token — validate share token, return album info
router.get('/:token', async (req, res) => {
  if (!database.dbReady) return res.status(503).json({ error: 'Service unavailable' });
  try {
    const { rows } = await database.db.query(
      `SELECT album, expires_at FROM share_tokens
       WHERE token = $1 AND expires_at > NOW()`,
      [req.params.token],
    );
    if (!rows.length) return res.status(404).json({ error: 'Invalid or expired share link' });
    res.json({ album: rows[0].album, expires_at: rows[0].expires_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
