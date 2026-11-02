// @ts-check
'use strict';
// Writing articles (admin): create in an album, change, delete.

const express  = require('express');
const { requireAdmin } = require('../../services/auth');
const library  = require('../../services/library');
const articles = require('../../services/articles');
const activity = require('../../services/activity');
const { sendError } = require('../../services/http-errors');

const router = express.Router();
const json = express.json({ limit: '1mb' });

const idOf = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : null);

// POST /api/admin/articles  { album, title, summary?, body?, cover?, place?, date?, published? }
router.post('/', requireAdmin, json, async (req, res) => {
  try {
    const { album, ...fields } = req.body ?? {};
    if (typeof album !== 'string' || !await library.albumExists(album)) return res.status(404).json({ error: 'Album not found' });
    const a = await articles.create(album, fields, req.user?.id ?? null);
    res.status(201).json(a);
    activity.log('article_create', { username: req.user?.username ?? null, ip: req.ip, details: { album, slug: a.slug } });
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /api/admin/articles/:id  (the fields to change)
router.put('/:id', requireAdmin, json, async (req, res) => {
  try {
    const id = idOf(req);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    const a = await articles.update(id, req.body ?? {});
    if (!a) return res.status(404).json({ error: 'Not found' });
    res.json(a);
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /api/admin/articles/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = idOf(req);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    const a = await articles.getById(id);
    if (!a || !await articles.remove(id)) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
    activity.log('article_delete', { username: req.user?.username ?? null, ip: req.ip, details: { album: a.album, slug: a.slug } });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
