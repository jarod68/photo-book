const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const helmet       = require('helmet');

const { PHOTOS_DIR, PREVIEWS_DIR, isImage, isAlbumDir, preGenerateAll } = require('./services/image');
const database = require('./services/database'); // database.db, database.dbReady (getters)
const auth     = require('./services/auth');
const activity = require('./services/activity');
const push     = require('./services/push');

// Route modules
const authRouter         = require('./routes/auth');
const albumsRouter       = require('./routes/albums');
const interactionsRouter = require('./routes/interactions');
const geocodeRouter      = require('./routes/geocode');
const mapRouter          = require('./routes/map');
const shareRouter        = require('./routes/share');
const pushRouter         = require('./routes/push');
const adminStatsRouter   = require('./routes/admin/stats');
const adminUsersRouter   = require('./routes/admin/users');
const adminAlbumsRouter  = require('./routes/admin/albums');
const adminLogsRouter    = require('./routes/admin/logs');

if (process.env.NODE_ENV !== 'test' && !process.env.POSTGRES_PASSWORD) {
  console.error('Missing required environment variable: POSTGRES_PASSWORD');
  process.exit(1);
}

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust Traefik's X-Forwarded-For so req.ip reflects the real client IP.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());

const IS_TEST = process.env.NODE_ENV === 'test';

const RATE_WINDOW_15MIN = 15 * 60 * 1000;
const RATE_WINDOW_1MIN  = 60 * 1000;
const RATE_API_MAX      = 600;
const RATE_LOGIN_MAX    = 10;
const RATE_GEOCODE_MAX  = 30;

app.use('/api/', rateLimit({
  windowMs:        RATE_WINDOW_15MIN,
  limit:           RATE_API_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders:   false,
  skip:            () => IS_TEST,
}));

app.use('/api/auth/login', rateLimit({
  windowMs:        RATE_WINDOW_15MIN,
  limit:           RATE_LOGIN_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders:   false,
  skip:            () => IS_TEST,
}));

// Nominatim ToS: max 1 req/s per user. 30/min per IP stays safely under that limit.
app.use('/api/geocode', rateLimit({
  windowMs:        RATE_WINDOW_1MIN,
  limit:           RATE_GEOCODE_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders:   false,
  skip:            () => IS_TEST,
}));

// ─── Static files ─────────────────────────────────────────────────────────────

// Medium (720p): generated once, never mutated → immutable 1 year
app.use('/medium', albumAccessGuard(), express.static(path.join(__dirname, 'public', 'medium'), {
  maxAge: '1y',
  immutable: true,
  etag: false,
  lastModified: false,
}));

// Previews: generated once, never mutated → immutable 1 year
app.use('/previews', albumAccessGuard(), express.static(path.join(__dirname, 'public', 'previews'), {
  maxAge: '1y',
  immutable: true,
  etag: false,
  lastModified: false,
}));

// App assets: login.html is public; other HTML pages require auth.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));

// Original photos: immutable 1 year (files are never overwritten on disk)
app.use('/photos', albumAccessGuard(), (req, res, next) => {
  const target = path.resolve(path.join(PHOTOS_DIR, req.path));
  if (!target.startsWith(PHOTOS_DIR)) return res.status(403).end();
  next();
}, express.static(PHOTOS_DIR, {
  maxAge: '1y',
  immutable: true,
  etag: false,
  lastModified: false,
}));

// ─── albumAccessGuard ─────────────────────────────────────────────────────────

function albumAccessGuard() {
  return async (req, res, next) => {
    if (!database.dbReady) return next();
    const parts = req.path.split('/').filter(Boolean);
    if (!parts.length) return next();
    const album      = decodeURIComponent(parts[0]);
    const token      = req.cookies?.pb_session;
    const shareToken = req.query?.share ?? null;
    const user  = token ? await auth.getSessionUser(token).catch(() => null) : null;
    // Fail closed: an access-check error must never expose a restricted album.
    let access;
    try {
      access = await getAlbumAccess(album, user, shareToken);
    } catch {
      return res.status(503).end();
    }
    if (!access.allowed) return res.status(401).end();
    next();
  };
}

// ─── Shared helpers (kept in server.js for watcher and guard) ─────────────────

async function getAlbumVisibility(album) {
  if (!database.dbReady) return 'public';
  const { rows } = await database.db.query(
    'SELECT visibility FROM album_settings WHERE album = $1', [album],
  );
  return rows[0]?.visibility ?? 'public';
}

async function isUserAuthorizedForAlbum(album, userId) {
  const { rows } = await database.db.query(
    'SELECT 1 FROM album_users WHERE album = $1 AND user_id = $2', [album, userId],
  );
  return rows.length > 0;
}

// Returns { allowed, canDelete }
async function getAlbumAccess(album, user, shareToken = null) {
  const visibility = await getAlbumVisibility(album);
  if (visibility === 'public') {
    return { allowed: true, canDelete: user?.role === 'admin' };
  }
  if (shareToken && database.dbReady) {
    const { rows } = await database.db.query(
      `SELECT 1 FROM share_tokens WHERE token = $1 AND album = $2 AND expires_at > NOW()`,
      [shareToken, album],
    );
    if (rows.length > 0) return { allowed: true, canDelete: false };
  }
  if (!user) return { allowed: false, canDelete: false };
  if (user.role === 'admin') return { allowed: true, canDelete: true };
  const authorized = await isUserAuthorizedForAlbum(album, user.id);
  return { allowed: authorized, canDelete: authorized };
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  const status = database.dbReady ? 'ok' : 'degraded';
  res.status(database.dbReady ? 200 : 503).json({ status, db: database.dbReady, uptime: process.uptime() });
});

// ─── API routes ───────────────────────────────────────────────────────────────

app.use('/api/auth',    authRouter);
app.use('/api/albums',  albumsRouter);
app.use('/api',         interactionsRouter);
app.use('/api/geocode', geocodeRouter);
app.use('/api/map',     mapRouter);
app.use('/api/share',   shareRouter);
app.use('/api/push',    pushRouter);

// Admin routes require authentication at the router level
app.use('/api/admin', auth.requireAuth);
app.use('/api/admin', adminStatsRouter);
app.use('/api/admin/users',  adminUsersRouter);
app.use('/api/admin/albums', adminAlbumsRouter);
app.use('/api/admin/logs',   adminLogsRouter);

// ─── File watching ────────────────────────────────────────────────────────────

async function deletePhotoFromDb(album, filename) {
  if (!database.dbReady) return;
  console.log(`  ✕ Photo deleted — DB cleanup: ${album}/${filename}`);
  const q = (sql) => database.db.query(sql, [album, filename]);
  await q('DELETE FROM photo_view_log WHERE album = $1 AND filename = $2');
  await q('DELETE FROM photo_likes    WHERE album = $1 AND filename = $2');
  await q('DELETE FROM photo_views    WHERE album = $1 AND filename = $2');
}

async function deleteAlbumFromDb(album) {
  if (!database.dbReady) return;
  console.log(`  ✕ Album deleted — DB cleanup: ${album}`);
  const q = (sql) => database.db.query(sql, [album]);
  await q('DELETE FROM photo_view_log     WHERE album = $1');
  await q('DELETE FROM photo_likes        WHERE album = $1');
  await q('DELETE FROM photo_views        WHERE album = $1');
  await q('DELETE FROM album_users        WHERE album = $1');
  await q('DELETE FROM album_settings     WHERE album = $1');
  await q('DELETE FROM share_tokens       WHERE album = $1');
  await q('DELETE FROM push_subscriptions WHERE album = $1');
}

function watchPhotosDir() {
  if (!fs.existsSync(PHOTOS_DIR)) return;

  let debounceTimer = null;
  const scheduleRegenerate = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log('  ↻ New photos detected — generating thumbnails…');
      preGenerateAll().catch(console.error);
    }, 2_000);
  };

  const watchAlbum = (albumPath, albumName) => {
    try {
      fs.watch(albumPath, (_event, name) => {
        if (!name || !isImage(name)) return;
        const full = path.join(albumPath, name);
        if (fs.existsSync(full)) {
          scheduleRegenerate();
        } else {
          deletePhotoFromDb(albumName, name).catch(console.error);
        }
      });
    } catch (err) { console.error('Album watcher failed:', albumName, err.message); }
  };

  try {
    fs.watch(PHOTOS_DIR, (_event, name) => {
      if (!name) return;
      setTimeout(() => {
        try {
          const full = path.join(PHOTOS_DIR, name);
          if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
            // New album detected
            scheduleRegenerate();
            watchAlbum(full, name);
          } else if (!fs.existsSync(full)) {
            // Album deleted
            deleteAlbumFromDb(name).catch(console.error);
          }
        } catch (err) { console.error('Photo dir watcher error:', err.message); }
      }, 500);
    });
  } catch (err) {
    console.warn('  ⚠ Photo watcher unavailable:', err.message);
    return;
  }

  fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })
    .filter(isAlbumDir)
    .forEach(a => watchAlbum(path.join(PHOTOS_DIR, a.name), a.name));

  console.log('  ✓ Photo watcher started.');
}

// ─── Start ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`\n  360° Photo Viewer`);
    console.log(`  ➜  http://localhost:${PORT}`);
    console.log(`  Photos:   ${PHOTOS_DIR}`);
    console.log(`  Previews: ${PREVIEWS_DIR}\n`);
    database.connectDb()
      .then(() => auth.ensureAdmin())
      .then(() => activity.purgeActivityLog())
      .then(() => database.syncPhotosToDb())
      .then(() => push.initVapid(database.db))
      .catch(console.error);
    preGenerateAll().catch(console.error);
    watchPhotosDir();
  });

  const shutdown = () => {
    console.log('  ⏹  Shutting down gracefully…');
    server.close(() => {
      (database.db?.end() ?? Promise.resolve())
        .catch(() => {})
        .finally(() => process.exit(0));
    });
    // Force exit if connections don't drain within 10 s
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

module.exports = { app, watchPhotosDir, deletePhotoFromDb, deleteAlbumFromDb };
