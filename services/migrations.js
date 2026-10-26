'use strict';
// Versioned database migrations (T5).
//
// Each migration has a version number and an `up(q)` function; the applied
// versions are recorded in `schema_migrations`. On startup every pending
// migration runs in order, each in its own transaction, under a PostgreSQL
// advisory lock so two instances never migrate concurrently.
//
// Rules: never edit a migration once released — add a new one. Version 1 is
// the schema as it stood before migrations existed; its statements are all
// idempotent (IF NOT EXISTS), so an existing database records it unchanged.

const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline schema',
    async up(q) {
      await q(`
        CREATE TABLE IF NOT EXISTS photo_views (
          id       SERIAL PRIMARY KEY,
          album    VARCHAR(255) NOT NULL,
          filename VARCHAR(255) NOT NULL,
          views    BIGINT       NOT NULL DEFAULT 0,
          UNIQUE (album, filename)
        )
      `);
      await q(`
        CREATE TABLE IF NOT EXISTS photo_view_log (
          album      VARCHAR(255) NOT NULL,
          filename   VARCHAR(255) NOT NULL,
          user_token VARCHAR(36)  NOT NULL,
          viewed_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (album, filename, user_token)
        )
      `);
      await q(`
        CREATE TABLE IF NOT EXISTS photo_likes (
          album      VARCHAR(255) NOT NULL,
          filename   VARCHAR(255) NOT NULL,
          user_token VARCHAR(36)  NOT NULL,
          created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (album, filename, user_token)
        )
      `);
      await q(`
        CREATE TABLE IF NOT EXISTS users (
          id            SERIAL PRIMARY KEY,
          username      VARCHAR(64)  NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          role          VARCHAR(32)  NOT NULL DEFAULT 'viewer',
          created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await q(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          token      CHAR(64)  PRIMARY KEY,
          user_id    INTEGER   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NOT NULL
        )
      `);
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`);
      await q(`
        CREATE TABLE IF NOT EXISTS album_settings (
          album      VARCHAR(255) PRIMARY KEY,
          visibility VARCHAR(32)  NOT NULL DEFAULT 'public'
        )
      `);
      await q(`
        CREATE TABLE IF NOT EXISTS album_users (
          album   VARCHAR(255) NOT NULL,
          user_id INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (album, user_id)
        )
      `);
      await q(`
        CREATE TABLE IF NOT EXISTS activity_log (
          id         SERIAL      PRIMARY KEY,
          action     VARCHAR(64) NOT NULL,
          username   VARCHAR(64),
          ip         VARCHAR(45),
          details    JSONB       NOT NULL DEFAULT '{}',
          created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await q(`
        CREATE INDEX IF NOT EXISTS activity_log_created_idx ON activity_log (created_at DESC)
      `);
      await q(`
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
      await q(`
        CREATE INDEX IF NOT EXISTS share_tokens_token_idx   ON share_tokens(token)
      `);
      await q(`
        CREATE INDEX IF NOT EXISTS share_tokens_expires_idx ON share_tokens(expires_at)
      `);
      await q(`
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
      await q(`
        CREATE TABLE IF NOT EXISTS push_vapid (
          id          INTEGER PRIMARY KEY DEFAULT 1,
          public_key  TEXT NOT NULL,
          private_key TEXT NOT NULL,
          CHECK (id = 1)
        )
      `);
    },
  },
  {
    version: 2,
    name: 'photo title / description / location overrides',
    async up(q) {
      // NULL = not overridden: the value read from the file is shown.
      await q(`
        CREATE TABLE photo_overrides (
          album       VARCHAR(255) NOT NULL,
          filename    VARCHAR(255) NOT NULL,
          title       TEXT,
          description TEXT,
          location    TEXT,
          updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
          PRIMARY KEY (album, filename)
        )
      `);
    },
  },
];

const LOCK_KEY = 726571;   // arbitrary, constant: pg_advisory_xact_lock key

async function runMigrations(db, migrations = MIGRATIONS) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const q = (sql, params) => client.query(sql, params);
  const applied = [];
  try {
    await q(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER     PRIMARY KEY,
      name       TEXT        NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    for (const m of [...migrations].sort((x, y) => x.version - y.version)) {
      await q('BEGIN');
      try {
        await q('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
        const { rows } = await q('SELECT 1 FROM schema_migrations WHERE version = $1', [m.version]);
        if (rows.length === 0) {
          await m.up(q);
          await q('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name]);
          applied.push(m.version);
        }
        await q('COMMIT');
      } catch (err) {
        await q('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${m.version} (${m.name}) failed: ${err.message}`);
      }
    }
  } finally {
    client.release?.();
  }
  if (applied.length) console.log(`  ✓ Database migrated (${applied.join(', ')}).`);
  return applied;
}

module.exports = { MIGRATIONS, runMigrations };
