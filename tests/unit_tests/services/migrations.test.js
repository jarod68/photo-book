import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { runMigrations, MIGRATIONS } = require('../../../services/migrations.js');

// Fake PostgreSQL client: remembers applied versions and the statements run.
function fakeDb(applied = []) {
  const done = new Set(applied);
  const sql = [];
  const client = {
    query: vi.fn(async (text, params) => {
      sql.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
      if (text.startsWith('SELECT 1 FROM schema_migrations')) return { rows: done.has(params[0]) ? [{}] : [] };
      if (text.startsWith('INSERT INTO schema_migrations')) done.add(params[0]);
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { db: { connect: async () => client }, client, done, sql };
}

describe('migrations (T5)', () => {
  it('applies pending migrations in version order, each in a locked transaction', async () => {
    const order = [];
    const migs = [
      { version: 2, name: 'two', up: async () => order.push(2) },
      { version: 1, name: 'one', up: async () => order.push(1) },
    ];
    const { db, client, done, sql } = fakeDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await runMigrations(db, migs)).toEqual([1, 2]);
    expect(order).toEqual([1, 2]);
    expect([...done]).toEqual([1, 2]);
    expect(sql.filter((s) => s === 'BEGIN')).toHaveLength(2);
    expect(sql.filter((s) => s.startsWith('SELECT pg_advisory_xact_lock'))).toHaveLength(2);
    expect(client.release).toHaveBeenCalled();
  });

  it('skips migrations already recorded', async () => {
    const up = vi.fn();
    const { db } = fakeDb([1]);
    expect(await runMigrations(db, [{ version: 1, name: 'one', up }])).toEqual([]);
    expect(up).not.toHaveBeenCalled();
  });

  it('rolls back and reports a failing migration, and stops there', async () => {
    const later = vi.fn();
    const { db, sql, done } = fakeDb();
    await expect(runMigrations(db, [
      { version: 1, name: 'boom', up: async () => { throw new Error('syntax error'); } },
      { version: 2, name: 'later', up: later },
    ])).rejects.toThrow('Migration 1 (boom) failed: syntax error');
    expect(sql).toContain('ROLLBACK');
    expect(done.size).toBe(0);
    expect(later).not.toHaveBeenCalled();
  });

  it('versions are unique and increasing; v1 is the idempotent baseline', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(MIGRATIONS[0]).toMatchObject({ version: 1, name: 'baseline schema' });
    expect(MIGRATIONS[0].up.toString()).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
  });
});

describe('cleanup table lists', () => {
  const { PHOTO_TABLES, ALBUM_TABLES } = require('../../../services/cleanup.js');

  it('every table with an album column is cleaned / renamed with its album', async () => {
    const created = [];
    const q = async (sql) => {
      const m = sql.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+) \(([\s\S]*)\)/);
      if (m) created.push({ table: m[1], album: /^\s*album\s/m.test(m[2]), filename: /^\s*filename\s/m.test(m[2]) });
      return { rows: [] };
    };
    for (const m of MIGRATIONS) await m.up(q);
    for (const { table, album, filename } of created) {
      if (album) expect(ALBUM_TABLES, table).toContain(table);
      if (album && filename) expect(PHOTO_TABLES, table).toContain(table);
    }
  });
});
