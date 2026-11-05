// @ts-check
'use strict';
// User profiles: the name shown, a few lines about oneself, a small picture —
// on a public page (profile.html) and on the cards of one's albums — and
// one's own password. The picture is kept in the database (WebP, 256 px
// square): a few kilobytes, no volume to add.
const sharp    = require('sharp');
const bcrypt   = require('bcryptjs');
const database = require('./database');
const { hashPassword } = require('./auth');
const { validatePassword } = require('./password');
const { BadRequest } = require('./http-errors');

const DISPLAY_NAME_MAX = 80;
const BIO_MAX = 1000;
const AVATAR_PX = 256;

const fromRow = (r) => ({
  id: r.id, username: r.username, role: r.role, displayName: r.display_name ?? null, bio: r.bio ?? null,
  avatarVersion: r.avatar_updated_at ? new Date(r.avatar_updated_at).getTime() : null,
});
const COLS = 'id, username, role, display_name, bio, avatar_updated_at';

/** Map id → { id, username, role, displayName } for these users. */
async function byIds(ids) {
  const out = new Map();
  if (!database.dbReady || !ids.length) return out;
  const { rows } = await database.db.query(`SELECT ${COLS} FROM users WHERE id = ANY($1)`, [ids]);
  for (const r of rows) out.set(r.id, fromRow(r));
  return out;
}

async function byUsername(username) {
  if (!database.dbReady) return null;
  const { rows } = await database.db.query(
    `SELECT ${COLS} FROM users WHERE lower(username) = lower($1) ORDER BY (username = $1) DESC LIMIT 1`, [username]);
  return rows[0] ? fromRow(rows[0]) : null;
}

async function byId(id) {
  if (!database.dbReady) return null;
  const { rows } = await database.db.query(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? fromRow(rows[0]) : null;
}

/** Everybody, for choosing the members of an album: [{ id, username, displayName }]. */
async function directory() {
  if (!database.dbReady) return [];
  const { rows } = await database.db.query('SELECT id, username, display_name FROM users ORDER BY lower(username)');
  return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name ?? null }));
}

/**
 * Change one's name shown and bio (the fields given; '' clears).
 * @param {number} id @param {{ displayName?: string|null, bio?: string|null }} fields
 */
async function update(id, { displayName, bio } = {}) {
  const sets = [], params = /** @type {any[]} */ ([id]);
  const text = (v, max, what) => {
    if (v === null) return null;
    if (typeof v !== 'string') throw new BadRequest(`Invalid ${what}`);
    const t = v.trim();
    if (t.length > max) throw new BadRequest(`${what} is too long (${max} max)`);
    return t || null;
  };
  if (displayName !== undefined) { params.push(text(displayName, DISPLAY_NAME_MAX, 'displayName')); sets.push(`display_name = $${params.length}`); }
  if (bio !== undefined) { params.push(text(bio, BIO_MAX, 'bio')); sets.push(`bio = $${params.length}`); }
  if (sets.length) await database.db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);
  return byId(id);
}

/** A picture (any image sharp reads) → the user's 256 px square WebP. */
async function setAvatar(id, input) {
  let webp;
  try {
    webp = await sharp(input, { failOn: 'error' }).rotate()
      .resize(AVATAR_PX, AVATAR_PX, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 }).toBuffer();
  } catch {
    throw new BadRequest('Not an image');
  }
  await database.db.query('UPDATE users SET avatar = $2, avatar_updated_at = now() WHERE id = $1', [id, webp]);
  return byId(id);
}

async function clearAvatar(id) {
  await database.db.query('UPDATE users SET avatar = NULL, avatar_updated_at = NULL WHERE id = $1', [id]);
}

/** { data: Buffer, updatedAt: Date } or null. */
async function avatarOf(username) {
  if (!database.dbReady) return null;
  const { rows } = await database.db.query(
    `SELECT avatar, avatar_updated_at FROM users WHERE lower(username) = lower($1) AND avatar IS NOT NULL
     ORDER BY (username = $1) DESC LIMIT 1`, [username]);
  return rows[0] ? { data: rows[0].avatar, updatedAt: rows[0].avatar_updated_at } : null;
}

/**
 * Change one's own password: the current one first. Other sessions are
 * closed (a stolen session ends with the old password), not this one.
 */
async function changePassword(id, current, next, keepToken) {
  if (typeof current !== 'string' || typeof next !== 'string') throw new BadRequest('current and password are required');
  const err = validatePassword(next);
  if (err) throw new BadRequest(err);
  const { rows } = await database.db.query('SELECT password_hash FROM users WHERE id = $1', [id]);
  if (!rows[0] || !await bcrypt.compare(current, rows[0].password_hash)) {
    const e = /** @type {Error & { status?: number }} */ (new Error('Wrong current password'));
    e.status = 403;
    throw e;
  }
  await database.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, await hashPassword(next)]);
  await database.db.query('DELETE FROM user_sessions WHERE user_id = $1 AND token <> $2', [id, keepToken ?? '']);
}

module.exports = {
  DISPLAY_NAME_MAX, BIO_MAX, byIds, byUsername, byId, directory, update, setAvatar, clearAvatar, avatarOf, changePassword,
};
