// @ts-check
'use strict';
// Articles: stories written in the app, kept in an album — beside its photos,
// or alone in an album holding only articles (a travel diary, a blog).
//
// The body is Markdown (rendered in the browser, public/utils/article-render.js).
// Photos are referenced, not copied: ![caption](<Album/file.jpg>) — any album,
// the reader seeing only those of the albums they may see; a bare file name
// means the article's own album. The cover is such a reference too.
// Drafts (published = false) are seen by the admin only.
const database  = require('./database');
const library   = require('./library');
const overrides = require('./overrides');
const { BadRequest } = require('./http-errors');

const LIMITS = { title: 200, summary: 600, body: 200_000, place: 200, cover: 600 };
const WORDS_PER_MINUTE = 200;

/** "Lisbonne, jour 1 !" → "lisbonne-jour-1" (never empty). */
function slugify(title) {
  const s = String(title).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
  return s || 'article';
}

// ![caption](<Album/file.jpg>) or ![caption](file.jpg): the whole line or inline
const REF_RE = /!\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^)\s]+))\)/g;

/**
 * "Album/file.jpg" → { album, file }; a bare file name → the given album.
 * @param {string} ref @param {string} album
 */
function parseRef(ref, album) {
  const i = ref.lastIndexOf('/');
  return i < 0 ? { album, file: ref } : { album: ref.slice(0, i), file: ref.slice(i + 1) };
}

/** The photos an article shows (body and cover), deduplicated: [{ album, file }]. */
function photoRefs(article) {
  const seen = new Map();
  const add = (ref) => {
    if (!ref || /^[a-z]+:/i.test(ref)) return;     // a web address: not a photo
    const r = parseRef(ref, article.album);
    if (r.file) seen.set(`${r.album}/${r.file}`, r);
  };
  add(article.cover);
  for (const m of String(article.body ?? '').matchAll(REF_RE)) add(m[2] ?? m[3]);
  return [...seen.values()];
}

/** Plain text of the Markdown (no photos, links reduced to their text, no marks). */
function plainText(body) {
  return String(body ?? '')
    .replace(REF_RE, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/^-{3,}$/gm, '');
}

function readMinutes(body) {
  const words = plainText(body).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** The summary, or the start of the first paragraph (about 240 characters). */
function excerpt(summary, body) {
  if (summary) return summary;
  const first = plainText(body).split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  return first.length > 240 ? `${first.slice(0, 240).replace(/\s+\S*$/, '')}…` : first;
}

/**
 * Checked and trimmed fields for a save; `partial`: only those given.
 * @param {Record<string, any>} input
 * @param {{ partial?: boolean }} [opts]
 */
function validate(input, { partial = false } = {}) {
  const out = {};
  const text = (key, max, required = false) => {
    if (input[key] === undefined) {
      if (required && !partial) throw new BadRequest(`${key} is required`);
      return;
    }
    if (input[key] !== null && typeof input[key] !== 'string') throw new BadRequest(`Invalid ${key}`);
    const v = (input[key] ?? '').trim();
    if (required && !v) throw new BadRequest(`${key} is required`);
    if (v.length > max) throw new BadRequest(`${key} is too long (${max} max)`);
    out[key] = v || (key === 'body' ? '' : null);
  };
  text('title', LIMITS.title, true);
  text('summary', LIMITS.summary);
  text('body', LIMITS.body);
  text('place', LIMITS.place);
  text('cover', LIMITS.cover);
  if (input.date !== undefined) {
    if (input.date !== null && input.date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.date))) throw new BadRequest('Invalid date');
    if (input.date && Number.isNaN(Date.parse(input.date))) throw new BadRequest('Invalid date');
    out.date = input.date || null;
  }
  if (input.published !== undefined) {
    if (typeof input.published !== 'boolean') throw new BadRequest('Invalid published');
    out.published = input.published;
  }
  return out;
}

const COLUMNS = { title: 'title', summary: 'summary', body: 'body', place: 'place', cover: 'cover', date: 'story_date', published: 'published' };
const SELECT = `SELECT id, album, slug, title, summary, body, cover, place,
  to_char(story_date, 'YYYY-MM-DD') AS date, published, created_at, updated_at,
  (SELECT COUNT(*) FROM article_likes l WHERE l.article_id = articles.id) AS likes FROM articles`;
// in an album: the story's day (oldest first, undated last), then writing order
const ALBUM_ORDER = 'ORDER BY story_date ASC NULLS LAST, created_at ASC, id ASC';

function fromRow(r) {
  return {
    id: r.id, album: r.album, slug: r.slug, title: r.title, summary: r.summary, body: r.body,
    cover: r.cover, place: r.place, date: r.date, published: r.published, likes: Number(r.likes ?? 0),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

/** The articles of an album, in reading order (drafts: the admin's view). */
async function listForAlbum(album, { drafts = false } = {}) {
  if (!database.dbReady) return [];
  const { rows } = await database.db.query(
    `${SELECT} WHERE album = $1 ${drafts ? '' : 'AND published'} ${ALBUM_ORDER}`, [album]);
  return rows.map(fromRow);
}

/** The latest published articles of these albums: by their date, newest first (undated last). */
async function latest(albums, limit = 6) {
  if (!database.dbReady || !albums.length) return [];
  const { rows } = await database.db.query(
    `${SELECT} WHERE published AND album = ANY($1) ORDER BY story_date DESC NULLS LAST, created_at DESC, id DESC LIMIT $2`, [albums, limit]);
  return rows.map(fromRow);
}

/** Map album → { published, drafts }. */
async function counts() {
  const out = new Map();
  if (!database.dbReady) return out;
  const { rows } = await database.db.query(
    `SELECT album, COUNT(*) FILTER (WHERE published) AS published, COUNT(*) FILTER (WHERE NOT published) AS drafts
     FROM articles GROUP BY album`);
  for (const r of rows) out.set(r.album, { published: Number(r.published), drafts: Number(r.drafts) });
  return out;
}

async function get(album, slug, { drafts = false } = {}) {
  if (!database.dbReady) return null;
  const { rows } = await database.db.query(
    `${SELECT} WHERE album = $1 AND slug = $2 ${drafts ? '' : 'AND published'}`, [album, slug]);
  return rows[0] ? fromRow(rows[0]) : null;
}

async function getById(id) {
  if (!database.dbReady) return null;
  const { rows } = await database.db.query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ? fromRow(rows[0]) : null;
}

/** A free slug in the album: "title", then "title-2", "title-3"… */
async function freeSlug(album, title, exceptId = null) {
  const base = slugify(title);
  const { rows } = await database.db.query(
    `SELECT slug FROM articles WHERE album = $1 AND (slug = $2 OR slug LIKE $2 || '-%') AND id IS DISTINCT FROM $3`,
    [album, base, exceptId]);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** @param {string} album @param {Record<string, any>} input @param {number|null} authorId */
async function create(album, input, authorId) {
  const fields = validate(input);
  const slug = await freeSlug(album, fields.title);
  const cols = Object.keys(fields).map((k) => COLUMNS[k]);
  const { rows } = await database.db.query(
    `INSERT INTO articles (album, slug, author_id, ${cols.join(', ')})
     VALUES ($1, $2, $3, ${cols.map((_, i) => `$${i + 4}`).join(', ')}) RETURNING id`,
    [album, slug, authorId, ...Object.values(fields)]);
  return getById(rows[0].id);
}

/**
 * Save the given fields. The address (slug) stays as it was, so that links
 * keep working after a title change.
 */
async function update(id, input) {
  const fields = validate(input, { partial: true });
  const keys = Object.keys(fields);
  if (keys.length) {
    const { rowCount } = await database.db.query(
      `UPDATE articles SET ${keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
      [id, ...Object.values(fields)]);
    if (!rowCount) return null;
  }
  return getById(id);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Like the article, or take the like back: { liked, count }. `token`: the visitor's browser. */
async function toggleLike(id, token) {
  if (!UUID_RE.test(String(token))) throw new BadRequest('Invalid token');
  const { rowCount } = await database.db.query('DELETE FROM article_likes WHERE article_id = $1 AND user_token = $2', [id, token]);
  if (!rowCount) await database.db.query('INSERT INTO article_likes (article_id, user_token) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, token]);
  const { rows } = await database.db.query('SELECT COUNT(*) AS n FROM article_likes WHERE article_id = $1', [id]);
  return { liked: !rowCount, count: Number(rows[0].n) };
}

/** Has this visitor liked the article? (false for no / a malformed token) */
async function likedBy(id, token) {
  if (!database.dbReady || !UUID_RE.test(String(token))) return false;
  const { rows } = await database.db.query('SELECT 1 FROM article_likes WHERE article_id = $1 AND user_token = $2', [id, token]);
  return rows.length > 0;
}

async function remove(id) {
  const { rowCount } = await database.db.query('DELETE FROM articles WHERE id = $1', [id]);
  return rowCount > 0;
}

/**
 * What the reader needs of each photo shown: Map "Album/file" → photo, only
 * for the albums `canSee(album)` allows (the others are left out — the page
 * skips them). Titles edited in the admin are applied.
 * @param {{ album: string, file: string }[]} refs
 * @param {(album: string) => Promise<boolean>} canSee
 */
async function resolvePhotos(refs, canSee) {
  const out = new Map();
  const byAlbum = new Map();
  for (const r of refs) {
    if (!byAlbum.has(r.album)) byAlbum.set(r.album, []);
    byAlbum.get(r.album).push(r.file);
  }
  // the albums side by side (each: its rights, its photos, its edited titles)
  await Promise.all([...byAlbum].map(async ([album, files]) => {
    if (!(await canSee(album).catch(() => false))) return;
    const [photos, ovs] = await Promise.all([
      library.getAlbumPhotos(album).catch(() => null),
      overrides.loadOverrides([album]).catch(() => new Map()),
    ]);
    if (!photos) return;
    for (const file of files) {
      const p = photos.find((x) => x.filename === file);
      if (!p) continue;
      const o = overrides.applyOverride(p, ovs.get(`${album}/${file}`));
      out.set(`${album}/${file}`, {
        album, filename: file, type: o.type, name: o.name, description: o.description || null, is360: !!o.is360,
        url: o.url, displayUrl: o.displayUrl ?? null, previewUrl: o.previewUrl, mediumUrl: o.mediumUrl ?? null, thumbUrl: o.thumbUrl,
        width: o.exif?.width ?? null, height: o.exif?.height ?? null,
      });
    }
  }));
  return out;
}

/** A list entry: what a card shows (no body). `photos`: resolvePhotos' map. */
function card(a, photos) {
  const ref = a.cover ? parseRef(a.cover, a.album) : null;
  return {
    id: a.id, album: a.album, slug: a.slug, title: a.title, summary: excerpt(a.summary, a.body),
    date: a.date, place: a.place, published: a.published, readMinutes: readMinutes(a.body), likes: a.likes ?? 0,
    cover: (ref && photos.get(`${ref.album}/${ref.file}`)) || firstPhoto(a, photos) || null,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

// no cover chosen: the article's first photo the reader may see
function firstPhoto(a, photos) {
  for (const r of photoRefs({ ...a, cover: null })) {
    const p = photos.get(`${r.album}/${r.file}`);
    if (p && p.type !== 'video' && p.thumbUrl) return p;
  }
  return null;
}

module.exports = {
  LIMITS, slugify, parseRef, photoRefs, plainText, readMinutes, excerpt, validate,
  listForAlbum, latest, counts, get, getById, create, update, remove, resolvePhotos, card, toggleLike, likedBy,
};
