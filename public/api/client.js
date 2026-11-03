// @ts-check
/**
 * @typedef {{ name: string, count: number, cover: string|null, coverPreview: string|null, coverThumb: string|null,
 *   visibility?: string, description?: string|null, collection?: string|null, dateFrom?: string|null, dateTo?: string|null,
 *   articles?: number, drafts?: number }} Album
 */

/**
 * @typedef {{
 *   make:          string|null,
 *   model:         string|null,
 *   lens:          string|null,
 *   dateTime:      string|null,
 *   iso:           number|null,
 *   aperture:      number|null,
 *   shutterSpeed:  string|null,
 *   focalLength:   number|null,
 *   focalLength35: number|null,
 *   width:         number|null,
 *   height:        number|null,
 * }} ExifData
 */

/**
 * @typedef {{
 *   type:        'photo'|'video',
 *   mimeType?:   string,                // videos
 *   filename:    string,
 *   url:         string,                // original (versioned ?v=mtime)
 *   previewUrl:  string|null,
 *   mediumUrl:   string|null,
 *   thumbUrl:    string|null,           // 480 px thumbnail
 *   displayUrl:  string|null,           // full-size JPEG for HEIC / TIFF originals
 *   takenAt:     string|null,           // capture date (ISO)
 *   name:        string,
 *   description: string,
 *   is360:       boolean,
 *   gps:         { lat: number, lng: number }|null,
 *   location:    string|null,
 *   views:       number,
 *   likes:       number,
 *   exif:        ExifData|null,
 * }} Photo
 */

/**
 * @typedef {{
 *   gps:        { lat: number, lng: number },
 *   date:       string|null,
 *   name:       string,
 *   filename:   string,
 *   previewUrl: string|null,
 *   url:        string,
 *   album:      string,
 *   albumIndex: number,
 * }} MapPhoto
 */

/** @typedef {{ views: number, likes: number, liked: boolean }} ViewResult */
/** @typedef {{ liked: boolean, count: number }} LikeResult */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// ── Albums ────────────────────────────────────────────────────────────────────

/** @returns {Promise<Album[]>} */
export async function getAlbums() {
  const r = await fetch('/api/albums');
  if (!r.ok) throw new Error(`getAlbums: ${r.status}`);
  return r.json();
}

/**
 * @param {string} name
 * @param {string|null} shareToken
 * @returns {Promise<{ name: string, photos: Photo[], canDelete: boolean, canDownload: boolean }>}
 */
export async function getAlbum(name, shareToken = null) {
  const qs = shareToken ? `?share=${encodeURIComponent(shareToken)}` : '';
  const r  = await fetch(`/api/albums/${encodeURIComponent(name)}${qs}`);
  if (!r.ok) throw new Error(`getAlbum: ${r.status}`);
  return r.json();
}

// ── Share tokens ──────────────────────────────────────────────────────────────

/**
 * @param {string} album
 * @param {number} days
 * @returns {Promise<{ id: number, token: string, expires_at: string }>}
 */
export async function createShareToken(album, days = 7) {
  const r = await fetch(`/api/admin/albums/${encodeURIComponent(album)}/share`, {
    method:  'POST',
    headers: JSON_HEADERS,
    body:    JSON.stringify({ days }),
  });
  if (!r.ok) throw new Error(`createShareToken: ${r.status}`);
  return r.json();
}

/**
 * @param {string} album
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function deleteShareToken(album, id) {
  const r = await fetch(`/api/admin/albums/${encodeURIComponent(album)}/share/${id}`, {
    method: 'DELETE',
  });
  return r.ok;
}

// ── Likes ─────────────────────────────────────────────────────────────────────

/**
 * @param {string} album
 * @param {string} token
 * @returns {Promise<{ filenames: string[] }>}
 */
export async function getLiked(album, token) {
  try {
    const r = await fetch(`/api/liked?album=${encodeURIComponent(album)}&token=${token}`);
    return r.ok ? r.json() : { filenames: [] };
  } catch {
    return { filenames: [] };
  }
}

/**
 * @param {string} album
 * @param {string} filename
 * @param {string} token
 * @returns {Promise<LikeResult|null>}
 */
export async function toggleLike(album, filename, token) {
  const r = await fetch('/api/like', {
    method:  'POST',
    headers: JSON_HEADERS,
    body:    JSON.stringify({ album, filename, token }),
  });
  return r.ok ? r.json() : null;
}

// ── Views ─────────────────────────────────────────────────────────────────────

/**
 * @param {string} album
 * @param {string} filename
 * @param {string} token
 * @returns {Promise<ViewResult|null>}
 */
export async function recordView(album, filename, token) {
  const r = await fetch('/api/view', {
    method:  'POST',
    headers: JSON_HEADERS,
    body:    JSON.stringify({ album, filename, token }),
  });
  return r.ok ? r.json() : null;
}

// ── Geocoding ─────────────────────────────────────────────────────────────────

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string|null>}
 */
export async function geocode(lat, lng) {
  const r = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`);
  if (!r.ok) return null;
  const data = await r.json();
  return data.location ?? null;
}

// ── Map ───────────────────────────────────────────────────────────────────────

/** @returns {Promise<MapPhoto[]>} */
export async function getMapPhotos() {
  const r = await fetch('/api/map');
  if (!r.ok) throw new Error(`getMapPhotos: ${r.status}`);
  return r.json();
}

// ── Articles ──────────────────────────────────────────────────────────────────

/**
 * @typedef {{ id: number, album: string, slug: string, title: string, summary: string, date: string|null,
 *   place: string|null, published: boolean, readMinutes: number, cover: object|null }} ArticleCard
 */

// an error carrying the HTTP status (401: restricted album, 404: no such article)
async function jsonOrThrow(r, what) {
  if (r.ok) return r.json();
  const err = /** @type {Error & { status?: number }} */ (new Error(`${what}: ${r.status}`));
  err.status = r.status;
  throw err;
}
const shareQs = (share) => (share ? `?share=${encodeURIComponent(share)}` : '');
// always asked again (a 304 when unchanged): coming Back to a page, browsers
// reuse their cached answer without asking, and would show it as before an edit
const FRESH = { cache: /** @type {RequestCache} */ ('no-cache') };

/** The latest published articles the visitor may read. @returns {Promise<ArticleCard[]>} */
export async function getLatestArticles(limit = 6) {
  return jsonOrThrow(await fetch(`/api/articles?limit=${limit}`, FRESH), 'getLatestArticles');
}

/** @returns {Promise<{ album: string, articles: ArticleCard[], canEdit: boolean }>} */
export async function getAlbumArticles(album, share = null) {
  return jsonOrThrow(await fetch(`/api/articles/${encodeURIComponent(album)}${shareQs(share)}`, FRESH), 'getAlbumArticles');
}

/** One article: its card, body, photos ("Album/file" → photo), prev / next. */
export async function getArticle(album, slug, share = null) {
  return jsonOrThrow(await fetch(`/api/articles/${encodeURIComponent(album)}/${encodeURIComponent(slug)}${shareQs(share)}`, FRESH), 'getArticle');
}

/** Create (`id` null, `fields.album` set) or change an article (admin). */
export async function saveArticle(id, fields) {
  const r = await fetch(id ? `/api/admin/articles/${id}` : '/api/admin/articles', {
    method: id ? 'PUT' : 'POST', headers: JSON_HEADERS, body: JSON.stringify(fields),
  });
  return jsonOrThrow(r, 'saveArticle');
}

export async function deleteArticle(id) {
  return jsonOrThrow(await fetch(`/api/admin/articles/${id}`, { method: 'DELETE' }), 'deleteArticle');
}
