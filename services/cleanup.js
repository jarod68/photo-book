'use strict';
// Rows keyed by album / photo, kept in step with the photo folders: removed
// when a photo or album disappears, moved when an album is renamed. Every
// table with an (album[, filename]) key must be listed here.

const PHOTO_TABLES = ['photo_view_log', 'photo_likes', 'photo_views', 'photo_overrides'];
const ALBUM_TABLES = [...PHOTO_TABLES, 'album_users', 'album_settings', 'share_tokens', 'push_subscriptions'];

// `db` is anything with query(sql, params): the pool or a transaction client.
async function deletePhotoRows(db, album, filename) {
  for (const t of PHOTO_TABLES) await db.query(`DELETE FROM ${t} WHERE album = $1 AND filename = $2`, [album, filename]);
}

async function deleteAlbumRows(db, album) {
  for (const t of ALBUM_TABLES) await db.query(`DELETE FROM ${t} WHERE album = $1`, [album]);
}

async function renameAlbumRows(db, from, to) {
  for (const t of ALBUM_TABLES) await db.query(`UPDATE ${t} SET album = $1 WHERE album = $2`, [to, from]);
}

module.exports = { PHOTO_TABLES, ALBUM_TABLES, deletePhotoRows, deleteAlbumRows, renameAlbumRows };
