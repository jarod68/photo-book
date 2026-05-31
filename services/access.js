'use strict';

const database = require('./database');
const auth     = require('./auth');

/**
 * Resolves the authenticated user from a session cookie token.
 * Returns null if the token is absent or invalid.
 *
 * @param {string|undefined} cookieToken
 * @returns {Promise<object|null>}
 */
async function resolveUser(cookieToken) {
  if (!cookieToken) return null;
  return auth.getSessionUser(cookieToken).catch(() => null);
}

/**
 * Returns the visibility setting for an album from the DB.
 * Falls back to 'public' when the DB is not ready or no row exists.
 *
 * @param {string} album
 * @returns {Promise<string>}
 */
async function getAlbumVisibility(album) {
  if (!database.dbReady) return 'public';
  const { rows } = await database.db.query(
    'SELECT visibility FROM album_settings WHERE album = $1', [album],
  );
  return rows[0]?.visibility ?? 'public';
}

/**
 * Returns true when the given user_id is listed in album_users for the album.
 *
 * @param {string} album
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
async function isUserAuthorizedForAlbum(album, userId) {
  const { rows } = await database.db.query(
    'SELECT 1 FROM album_users WHERE album = $1 AND user_id = $2', [album, userId],
  );
  return rows.length > 0;
}

/**
 * Returns true when the share token is valid (exists + not expired) for the album.
 *
 * @param {string|null} token
 * @param {string} album
 * @returns {Promise<boolean>}
 */
async function validateShareToken(token, album) {
  if (!database.dbReady || !token) return false;
  const { rows } = await database.db.query(
    `SELECT 1 FROM share_tokens WHERE token = $1 AND album = $2 AND expires_at > NOW()`,
    [token, album],
  );
  return rows.length > 0;
}

/**
 * Checks and returns access information for a specific album for the given user.
 * Returns { allowed, canDelete }.
 *
 * @param {string} album
 * @param {object|null} user
 * @param {string|null} shareToken
 * @returns {Promise<{ allowed: boolean, canDelete: boolean }>}
 */
async function getAlbumAccess(album, user, shareToken = null) {
  const visibility = await getAlbumVisibility(album);
  if (visibility === 'public') {
    return { allowed: true, canDelete: user?.role === 'admin' };
  }
  if (shareToken) {
    const valid = await validateShareToken(shareToken, album).catch(() => false);
    if (valid) return { allowed: true, canDelete: false };
  }
  if (!user) return { allowed: false, canDelete: false };
  if (user.role === 'admin') return { allowed: true, canDelete: true };
  const authorized = await isUserAuthorizedForAlbum(album, user.id);
  return { allowed: authorized, canDelete: authorized };
}

/**
 * Filters an array of album directory entries to those visible to the given user,
 * returning each with its visibility and canDelete flags.
 * Also returns the visibilityMap and authorizedSet for callers that need them.
 *
 * @param {import('fs').Dirent[]} albumDirs
 * @param {object|null} user
 * @returns {Promise<{
 *   filtered: import('fs').Dirent[],
 *   visibilityMap: Map<string, string>,
 *   authorizedSet: Set<string>
 * }>}
 */
async function filterVisibleAlbums(albumDirs, user) {
  let visibilityMap = new Map();
  let authorizedSet = new Set();

  if (database.dbReady) {
    const [{ rows: settingsRows }, authorizedResult] = await Promise.all([
      database.db.query('SELECT album, visibility FROM album_settings'),
      user?.role === 'basic'
        ? database.db.query('SELECT album FROM album_users WHERE user_id = $1', [user.id])
        : Promise.resolve({ rows: [] }),
    ]);
    visibilityMap = new Map(settingsRows.map(r => [r.album, r.visibility]));
    authorizedSet = new Set(authorizedResult.rows.map(r => r.album));
  }

  const filtered = albumDirs.filter(e => {
    const visibility = visibilityMap.get(e.name) ?? 'public';
    if (visibility === 'public') return true;
    if (!user) return false;
    if (user.role === 'admin') return true;
    return authorizedSet.has(e.name);
  });

  return { filtered, visibilityMap, authorizedSet };
}

module.exports = { resolveUser, getAlbumAccess, filterVisibleAlbums, validateShareToken };
