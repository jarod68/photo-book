'use strict';

const path  = require('path');
const fs    = require('fs');
const { Pool } = require('pg');
const { PHOTOS_DIR, isImage, isAlbumDir } = require('./image');

let db      = null;
let dbReady = false;

// Schema is managed with CREATE TABLE IF NOT EXISTS + ALTER TABLE IF NOT EXISTS.
// New columns are always nullable or have a DEFAULT so existing rows are unaffected.
// No migration framework is needed as long as schema changes follow this pattern.
async function initSchema() {
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
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`);
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id         SERIAL      PRIMARY KEY,
      action     VARCHAR(64) NOT NULL,
      username   VARCHAR(64),
      ip         VARCHAR(45),
      details    JSONB       NOT NULL DEFAULT '{}',
      created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS activity_log_created_idx ON activity_log (created_at DESC)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS share_tokens (
      id         SERIAL       PRIMARY KEY,
      token      CHAR(64)     UNIQUE NOT NULL,
      album      VARCHAR(255) NOT NULL,
      created_by INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP    NOT NULL,
      label      VARCHAR(255)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS share_tokens_token_idx   ON share_tokens(token)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS share_tokens_expires_idx ON share_tokens(expires_at)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id           SERIAL       PRIMARY KEY,
      album        VARCHAR(255) NOT NULL,
      endpoint     TEXT         NOT NULL,
      p256dh       TEXT         NOT NULL,
      auth         TEXT         NOT NULL,
      user_agent   TEXT,
      subscribed_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (album, endpoint)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS push_vapid (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      public_key  TEXT NOT NULL,
      private_key TEXT NOT NULL,
      CHECK (id = 1)
    )
  `);
}

async function tryConnect() {
  await db.query('SELECT 1');
  await initSchema();
  dbReady = true;
  console.log('  ✓ PostgreSQL connected.');
}

async function connectDb(dbInstance = null) {
  db = dbInstance ?? new Pool({
    host:     process.env.POSTGRES_HOST || 'postgres',
    port:     5432,
    database: 'photobook',
    user:     'photobook',
    password: process.env.POSTGRES_PASSWORD,
  });

  // Log unexpected idle-client errors so they don't crash the process silently.
  if (!dbInstance) {
    db.on('error', err => console.error('  ✗ PostgreSQL pool error:', err.message));
  }

  // Exponential backoff: 1 s → 2 s → 4 s → … capped at 32 s, then background retry every 32 s.
  let delay = 1_000;
  for (let attempt = 1; ; attempt++) {
    try {
      await tryConnect();
      return;
    } catch (err) {
      dbReady = false;
      if (attempt === 1) {
        console.error('  ✗ PostgreSQL unavailable, retrying…');
      }
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 32_000);

      // After 8 fast attempts (~60 s total), keep retrying silently in background
      // so the caller is not blocked indefinitely.
      if (attempt === 8) {
        console.error('  ✗ PostgreSQL still unavailable after 8 attempts — retrying in background.');
        (async () => {
          while (!dbReady) {
            await new Promise(r => setTimeout(r, 32_000));
            try { await tryConnect(); } catch (_) {}
          }
        })();
        return;
      }
    }
  }
}

async function syncPhotosToDb() {
  if (!dbReady || !fs.existsSync(PHOTOS_DIR)) return;
  const albums = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).filter(isAlbumDir);
  const allPhotos = albums.flatMap(album => {
    const files = fs.readdirSync(path.join(PHOTOS_DIR, album.name)).filter(isImage);
    return files.map(file => ({ album: album.name, file }));
  });
  await Promise.all(allPhotos.map(({ album, file }) =>
    db.query(
      'INSERT INTO photo_views (album, filename, views) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING',
      [album, file],
    ),
  ));
  console.log(`  ✓ ${allPhotos.length} photo(s) registered in photo_views.`);
}

// Test-only helpers — allow controlling internal state
// without going through connectDb() (which requires a real PostgreSQL connection).
function _reset() {
  db      = null;
  dbReady = false;
}

function _setState(newDb, ready) {
  db      = newDb;
  dbReady = ready;
}

module.exports = {
  get db()      { return db; },
  get dbReady() { return dbReady; },
  connectDb,
  syncPhotosToDb,
  _reset,
  _setState,
};
