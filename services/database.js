const path  = require('path');
const fs    = require('fs');
const { Pool } = require('pg');
const { PHOTOS_DIR, isImage, isAlbumDir } = require('./image');

let db      = null;
let dbReady = false;

async function connectDb(dbInstance = null) {
  db = dbInstance ?? new Pool({
    host:     process.env.POSTGRES_HOST || 'postgres',
    port:     5432,
    database: 'photobook',
    user:     'photobook',
    password: process.env.POSTGRES_PASSWORD,
  });

  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      await db.query('SELECT 1');
      await db.query(`
        CREATE TABLE IF NOT EXISTS photo_views (
          id       SERIAL PRIMARY KEY,
          album    VARCHAR(255) NOT NULL,
          filename VARCHAR(255) NOT NULL,
          views    BIGINT       NOT NULL DEFAULT 0,
          UNIQUE (album, filename)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS photo_view_log (
          album      VARCHAR(255) NOT NULL,
          filename   VARCHAR(255) NOT NULL,
          user_token VARCHAR(36)  NOT NULL,
          viewed_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (album, filename, user_token)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS photo_likes (
          album      VARCHAR(255) NOT NULL,
          filename   VARCHAR(255) NOT NULL,
          user_token VARCHAR(36)  NOT NULL,
          created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (album, filename, user_token)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id            SERIAL PRIMARY KEY,
          username      VARCHAR(64)  NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          role          VARCHAR(32)  NOT NULL DEFAULT 'viewer',
          created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          token      CHAR(64)  PRIMARY KEY,
          user_id    INTEGER   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NOT NULL
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS album_settings (
          album      VARCHAR(255) PRIMARY KEY,
          visibility VARCHAR(32)  NOT NULL DEFAULT 'public'
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS album_users (
          album   VARCHAR(255) NOT NULL,
          user_id INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (album, user_id)
        )
      `);
      dbReady = true;
      console.log('  ✓ PostgreSQL connected.');
      return;
    } catch (err) {
      if (attempt < 12) {
        await new Promise(r => setTimeout(r, 5_000));
      } else {
        console.error('  ✗ PostgreSQL unavailable:', err.message);
      }
    }
  }
}

async function syncPhotosToDb() {
  if (!dbReady || !fs.existsSync(PHOTOS_DIR)) return;
  const albums = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(isAlbumDir);
  let total = 0;
  for (const album of albums) {
    const files = fs.readdirSync(path.join(PHOTOS_DIR, album.name)).filter(isImage);
    for (const file of files) {
      await db.query(
        'INSERT INTO photo_views (album, filename, views) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING',
        [album.name, file],
      );
    }
    total += files.length;
  }
  console.log(`  ✓ ${total} photo(s) registered in photo_views.`);
}

// Test-only functions — allow controlling internal state
// without going through connectDb() (which requires a real PostgreSQL connection).
function _reset() {
  db      = null;
  dbReady = false;
}

function _setState(newDb, ready) {
  db      = newDb;
  dbReady = ready;
}

// Getters to expose current values after async initialization
module.exports = {
  get db()      { return db; },
  get dbReady() { return dbReady; },
  connectDb,
  syncPhotosToDb,
  _reset,
  _setState,
};
