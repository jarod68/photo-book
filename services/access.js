// @ts-check
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

const VISIBILITIES = ['public', 'restricted', 'private'];

/**
 * An album's visibility and owner. Without a database or a row: public, the
 * admin's (ownerId null).
 *
 * @param {string} album
 * @returns {Promise<{ visibility: string, ownerId: number|null }>}
 */
async function getAlbumSettings(album) {
  if (!database.dbReady) return { visibility: 'public', ownerId: null };
  const { rows } = await database.db.query(
    'SELECT visibility, owner_id FROM album_settings WHERE album = $1', [album],
  );
  return { visibility: rows[0]?.visibility ?? 'public', ownerId: rows[0]?.owner_id ?? null };
}

/** The admin, or the album's owner: may do everything with it. */
function canManageAlbum(user, ownerId) {
  return user?.role === 'admin' || (!!user && ownerId != null && ownerId === user.id);
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
 * What a user may do with an album: { allowed, canDelete, canManage }.
 *  - its owner and the admin: everything (canManage);
 *  - public: everybody reads;
 *  - restricted: its members read and change its photos (canDelete), a share
 *    link reads;
 *  - private: its owner and the admin only, and a share link they made.
 *
 * @param {string} album
 * @param {object|null} user
 * @param {string|null} shareToken
 * @returns {Promise<{ allowed: boolean, canDelete: boolean, canManage: boolean }>}
 */
async function getAlbumAccess(album, user, shareToken = null) {
  const { visibility, ownerId } = await getAlbumSettings(album);
  if (canManageAlbum(user, ownerId)) return { allowed: true, canDelete: true, canManage: true };
  const none = { allowed: false, canDelete: false, canManage: false };
  if (visibility === 'public') return { ...none, allowed: true };
  if (shareToken) {
    const valid = await validateShareToken(shareToken, album).catch(() => false);
    if (valid) return { ...none, allowed: true };
  }
  if (!user || visibility !== 'restricted') return none;
  const authorized = await isUserAuthorizedForAlbum(album, user.id);
  return { allowed: authorized, canDelete: authorized, canManage: false };
}

/**
 * Filters an array of album directory entries to those visible to the given user,
 * returning each with its visibility and canDelete flags.
 * Also returns the visibilityMap and authorizedSet for callers that need them.
 *
 * @param {{ name: string, isDirectory: () => boolean }[]} albumDirs  directory entries (or look-alikes)
 * @param {object|null} user
 * @returns {Promise<{
 *   filtered: { name: string, isDirectory: () => boolean }[],
 *   visibilityMap: Map<string, string>,
 *   ownerMap: Map<string, number>,
 *   authorizedSet: Set<string>
 * }>}
 */
async function filterVisibleAlbums(albumDirs, user) {
  let visibilityMap = new Map();
  let ownerMap = new Map();
  let authorizedSet = new Set();

  if (database.dbReady) {
    const [{ rows: settingsRows }, authorizedResult] = await Promise.all([
      database.db.query('SELECT album, visibility, owner_id FROM album_settings'),
      user && user.role !== 'admin'
        ? database.db.query('SELECT album FROM album_users WHERE user_id = $1', [user.id])
        : Promise.resolve({ rows: [] }),
    ]);
    visibilityMap = new Map(settingsRows.map(r => [r.album, r.visibility]));
    ownerMap = new Map(settingsRows.filter(r => r.owner_id != null).map(r => [r.album, r.owner_id]));
    authorizedSet = new Set(authorizedResult.rows.map(r => r.album));
  }

  const filtered = albumDirs.filter(e => {
    if (canManageAlbum(user, ownerMap.get(e.name) ?? null)) return true;
    const visibility = visibilityMap.get(e.name) ?? 'public';
    if (visibility === 'public') return true;
    if (!user || visibility !== 'restricted') return false;
    return authorizedSet.has(e.name);
  });

  return { filtered, visibilityMap, ownerMap, authorizedSet };
}

/**
 * Express middleware for the routes of one album (`:album`): its owner or
 * the admin, else 403 (after requireAuth). The admin passes at once; without
 * a user the admin rule decides (and the tests' auth bypass applies).
 */
async function requireAlbumManager(req, res, next) {
  if (!req.user || req.user.role === 'admin') return auth.requireAdmin(req, res, next);
  try {
    const { ownerId } = await getAlbumSettings(req.params.album);
    if (!canManageAlbum(req.user, ownerId)) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch {
    res.status(503).json({ error: 'Service unavailable' });
  }
}

module.exports = {
  VISIBILITIES, resolveUser, getAlbumSettings, canManageAlbum, getAlbumAccess, filterVisibleAlbums,
  validateShareToken, requireAlbumManager,
};
