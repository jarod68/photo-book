'use strict';

const path  = require('path');
const fs    = require('fs');
const { Pool } = require('pg');
const { PHOTOS_DIR, isMedia, isAlbumDir } = require('./image');
const { runMigrations } = require('./migrations');

let db      = null;
let dbReady = false;

// Schema: versioned migrations in services/migrations.js.
async function initSchema() {
  await runMigrations(db);
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
    port:     Number(process.env.POSTGRES_PORT) || 5432,
    // Overridable so a QA deployment can use its own database and role.
    database: process.env.POSTGRES_DB   || 'photobook',
    user:     process.env.POSTGRES_USER || 'photobook',
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
    const files = fs.readdirSync(path.join(PHOTOS_DIR, album.name)).filter(isMedia);
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
