// @ts-check
'use strict';
// Reading articles (services/articles.js): the latest ones for the home page,
// those of an album, one article. An album's rights apply to its articles
// (public, restricted to its members, a share link); a photo shown in an
// article comes along only if the reader may see that photo's album.

const express  = require('express');
const library  = require('../services/library');
const articles = require('../services/articles');
const { resolveUser, getAlbumAccess, filterVisibleAlbums } = require('../services/access');
const { sendError } = require('../services/http-errors');

const router = express.Router();

// canSee(album), memoized for one request; the share link opens its own album only
function seer(user, album = null, shareToken = null) {
  const cache = new Map();
  return (name) => {
    if (!cache.has(name)) {
      cache.set(name, getAlbumAccess(name, user, name === album ? shareToken : null).then((a) => a.allowed, () => false));
    }
    return cache.get(name);
  };
}

// The album's access, or an answer already sent (404 / 401 / 503).
async function albumAccess(req, res) {
  const { album } = req.params;
  if (!await library.albumExists(album)) { res.status(404).json({ error: 'Not found' }); return null; }
  const user = await resolveUser(req.cookies?.pb_session);
  const shareToken = typeof req.query?.share === 'string' ? req.query.share : null;
  let access;
  try {
    access = await getAlbumAccess(album, user, shareToken);
  } catch {
    res.status(503).json({ error: 'Service unavailable' });
    return null;
  }
  if (!access.allowed) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  // the admin and the album's owner: drafts too, and the pen
  return { user, shareToken, canManage: access.canManage };
}

// GET /api/articles — the latest published articles of the albums the reader may see
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 6));
    const user = await resolveUser(req.cookies?.pb_session);
    const entries = (await library.listAlbums()).map((name) => ({ name, isDirectory: () => true }));
    const { filtered } = await filterVisibleAlbums(entries, user);
    const list = await articles.latest(filtered.map((e) => e.name), limit);
    const photos = await articles.resolvePhotos(list.flatMap((a) => articles.photoRefs(a)), seer(user));
    res.json(list.map((a) => articles.card(a, photos)));
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/articles/:album — the album's articles, in reading order (drafts for the admin)
router.get('/:album', async (req, res) => {
  try {
    const ctx = await albumAccess(req, res);
    if (!ctx) return;
    const list = await articles.listForAlbum(req.params.album, { drafts: ctx.canManage });
    const photos = await articles.resolvePhotos(list.flatMap((a) => articles.photoRefs(a)), seer(ctx.user, req.params.album, ctx.shareToken));
    res.json({ album: req.params.album, articles: list.map((a) => articles.card(a, photos)), canEdit: ctx.canManage });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/articles/:album/:slug — one article, its photos, the previous and next ones
router.get('/:album/:slug', async (req, res) => {
  try {
    const ctx = await albumAccess(req, res);
    if (!ctx) return;
    const { album, slug } = req.params;
    const list = await articles.listForAlbum(album, { drafts: ctx.canManage });
    const i = list.findIndex((a) => a.slug === slug);
    if (i < 0) return res.status(404).json({ error: 'Not found' });
    const article = list[i];
    const photos = await articles.resolvePhotos(articles.photoRefs(article), seer(ctx.user, album, ctx.shareToken));
    const near = (a) => (a ? { slug: a.slug, title: a.title, published: a.published } : null);
    const liked = await articles.likedBy(article.id, req.query.token).catch(() => false);
    res.json({
      liked,
      ...articles.card(article, photos),
      body: article.body,
      lead: article.summary,
      coverRef: article.cover,
      photos: Object.fromEntries(photos),
      prev: near(list[i - 1]), next: near(list[i + 1]),
      canEdit: ctx.canManage,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/articles/:album/:slug/like  { token } — like it, or take the like back
router.post('/:album/:slug/like', express.json(), async (req, res) => {
  try {
    const ctx = await albumAccess(req, res);
    if (!ctx) return;
    const a = await articles.get(req.params.album, req.params.slug, { drafts: ctx.canManage });
    if (!a) return res.status(404).json({ error: 'Not found' });
    res.json(await articles.toggleLike(a.id, req.body?.token));
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
