// @ts-check
'use strict';
// Writing articles: the admin, or the owner of the article's album — create
// in an album, change, delete.

const express  = require('express');
const { getAlbumAccess } = require('../../services/access');
const library  = require('../../services/library');
const articles = require('../../services/articles');
const activity = require('../../services/activity');
const notify   = require('../../services/notify');
const { sendError } = require('../../services/http-errors');

const router = express.Router();
const json = express.json({ limit: '1mb' });

const idOf = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : null);

// may this user write in this album? (no user: the tests' auth bypass)
async function mayWrite(req, album) {
  if (!req.user) return true;
  return (await getAlbumAccess(album, req.user).catch(() => ({ canManage: false }))).canManage;
}

// POST /api/admin/articles  { album, title, summary?, body?, cover?, place?, date?, published? }
router.post('/', json, async (req, res) => {
  try {
    const { album, ...fields } = req.body ?? {};
    if (typeof album !== 'string' || !await library.albumExists(album)) return res.status(404).json({ error: 'Album not found' });
    if (!await mayWrite(req, album)) return res.status(403).json({ error: 'Forbidden' });
    const a = await articles.create(album, fields, req.user?.id ?? null);
    res.status(201).json(a);
    if (a.published) notify.articlePublished(album, a).catch((err) => console.error('Article notification failed:', err.message));
    activity.log('article_create', { username: req.user?.username ?? null, ip: req.ip, details: { album, slug: a.slug } });
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /api/admin/articles/:id  (the fields to change)
router.put('/:id', json, async (req, res) => {
  try {
    const id = idOf(req);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    const before = await articles.getById(id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    if (!await mayWrite(req, before.album)) return res.status(403).json({ error: 'Forbidden' });
    const a = await articles.update(id, req.body ?? {});
    if (!a) return res.status(404).json({ error: 'Not found' });
    res.json(a);
    // published now, a draft before: its followers learn of it
    if (a.published && !before.published) notify.articlePublished(a.album, a).catch((err) => console.error('Article notification failed:', err.message));
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /api/admin/articles/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = idOf(req);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    const a = await articles.getById(id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!await mayWrite(req, a.album)) return res.status(403).json({ error: 'Forbidden' });
    if (!await articles.remove(id)) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
    activity.log('article_delete', { username: req.user?.username ?? null, ip: req.ip, details: { album: a.album, slug: a.slug } });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
