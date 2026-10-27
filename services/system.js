'use strict';
// Admin System tab (F8): what is running and how it is doing — build,
// process, disk, database, caches, maintenance and recent errors. Replaces
// the Docker container list, which needed the host's Docker socket.
const fs   = require('fs');
const path = require('path');

const database = require('./database');
const library  = require('./library');
const errorLog = require('./error-log');
const { PHOTOS_DIR, PREVIEWS_DIR, MEDIUM_DIR, isImage, isVideo } = require('./image');

const startedAt = new Date();

// The commit the image was built from: written to public/version.json by CI.
function buildSha(root = path.join(__dirname, '..')) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'public', 'version.json'), 'utf8')).sha || 'dev'; }
  catch { return 'dev'; }
}

// Files and bytes under a directory (recursive). Cached for a few minutes:
// the photo library can hold many thousands of files.
const SIZE_TTL = 5 * 60 * 1000;
const sizeCache = new Map();   // dir → { at, value }
async function dirUsage(dir) {
  const hit = sizeCache.get(dir);
  if (hit && Date.now() - hit.at < SIZE_TTL) return hit.value;
  const value = { files: 0, bytes: 0, images: 0, videos: 0 };
  const walk = async (d) => {
    const entries = await fs.promises.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (!e.isFile()) continue;
      const st = await fs.promises.stat(p).catch(() => null);
      if (!st) continue;
      value.files++; value.bytes += st.size;
      if (isImage(e.name)) value.images++; else if (isVideo(e.name)) value.videos++;
    }
  };
  await walk(dir);
  sizeCache.set(dir, { at: Date.now(), value });
  return value;
}

async function volume(dir) {
  try {
    const s = await fs.promises.statfs(dir);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch { return null; }
}

async function disk() {
  const [photos, previews, medium, photosVolume, derivVolume] = await Promise.all([
    dirUsage(PHOTOS_DIR), dirUsage(PREVIEWS_DIR), dirUsage(MEDIUM_DIR), volume(PHOTOS_DIR), volume(PREVIEWS_DIR),
  ]);
  return { photos, previews, medium, photosVolume, derivativesVolume: derivVolume };
}

const COUNTED = {
  users:              'SELECT COUNT(*) AS n FROM users',
  activeSessions:     'SELECT COUNT(*) AS n FROM user_sessions WHERE expires_at > NOW()',
  activeShareLinks:   'SELECT COUNT(*) AS n FROM share_tokens WHERE expires_at > NOW()',
  pushSubscriptions:  'SELECT COUNT(*) AS n FROM push_subscriptions',
  photoEdits:         'SELECT COUNT(*) AS n FROM photo_overrides',
  places:             'SELECT COUNT(*) AS n FROM place_cache',
  activityLog:        'SELECT COUNT(*) AS n FROM activity_log',
};

async function db() {
  if (!database.dbReady) return { ready: false };
  const q = (sql) => database.db.query(sql);
  const [version, size, migrations, ...counts] = await Promise.all([
    q('SHOW server_version'),
    q('SELECT pg_database_size(current_database()) AS bytes'),
    q('SELECT version, name, applied_at FROM schema_migrations ORDER BY version'),
    ...Object.values(COUNTED).map((sql) => q(sql).catch(() => ({ rows: [{ n: null }] }))),
  ]);
  const pool = database.db;
  return {
    ready:      true,
    version:    version.rows[0]?.server_version ?? null,
    bytes:      Number(size.rows[0]?.bytes ?? 0),
    migrations: migrations.rows,
    counts:     Object.fromEntries(Object.keys(COUNTED).map((k, i) => [k, counts[i].rows[0].n == null ? null : Number(counts[i].rows[0].n)])),
    pool:       pool.totalCount != null ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } : null,
  };
}

async function report({ maintenance } = {}) {
  const mem = process.memoryUsage();
  const [diskInfo, dbInfo] = await Promise.all([
    disk().catch((err) => ({ error: err.message })),
    db().catch((err) => ({ ready: database.dbReady, error: err.message })),
  ]);
  return {
    // kept at the top level for existing clients
    node:   process.version,
    uptime: Math.floor(process.uptime()),
    build: {
      sha:       buildSha(),
      env:       process.env.APP_ENV || 'production',
      node:      process.version,
      startedAt: startedAt.toISOString(),
      memory:    { rss: mem.rss, heapUsed: mem.heapUsed },
    },
    disk:     diskInfo,
    database: dbInfo,
    caches:   { photoIndex: library.size() },
    maintenance: maintenance ?? null,
    errors:   errorLog.recent(),
  };
}

function _clearSizeCache() { sizeCache.clear(); }

module.exports = { report, buildSha, dirUsage, _clearSizeCache };
