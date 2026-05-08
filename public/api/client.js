/**
 * @typedef {{ name: string, count: number, cover: string|null, coverPreview: string|null }} Album
 */

/**
 * @typedef {{
 *   filename:    string,
 *   url:         string,
 *   previewUrl:  string|null,
 *   name:        string,
 *   description: string,
 *   is360:       boolean,
 *   gps:         { lat: number, lng: number }|null,
 *   location:    string|null,
 *   views:       number,
 *   likes:       number,
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
 * @returns {Promise<{ name: string, photos: Photo[] }>}
 */
export async function getAlbum(name) {
  const r = await fetch(`/api/albums/${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error(`getAlbum: ${r.status}`);
  return r.json();
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
