// Admin System tab data (F8) on real temporary folders.
import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sys-'));
process.env.PHOTOS_DIR   = path.join(tmp, 'photos');
process.env.PREVIEWS_DIR = path.join(tmp, 'previews');
process.env.MEDIUM_DIR   = path.join(tmp, 'medium');

const _require = createRequire(import.meta.url);
const database = _require('../../../services/database.js');
const errorLog = _require('../../../services/error-log.js');
const system   = _require('../../../services/system.js');

const write = (rel, bytes) => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes));
};

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('system (F8)', () => {
  beforeEach(() => { database._reset(); system._clearSizeCache(); errorLog._reset(); });

  it('dirUsage compte fichiers, octets, photos et vidéos (sous-dossiers compris)', async () => {
    write('photos/Porto/a.jpg', 1000);
    write('photos/Porto/b.HEIC', 500);
    write('photos/Porto/clip.mov', 3000);
    write('photos/Porto/notes.txt', 10);
    expect(await system.dirUsage(process.env.PHOTOS_DIR)).toEqual({ files: 4, bytes: 4510, images: 2, videos: 1 });
    expect(await system.dirUsage(path.join(tmp, 'missing'))).toEqual({ files: 0, bytes: 0, images: 0, videos: 0 });
  });

  it('dirUsage garde le résultat quelques minutes', async () => {
    write('previews/Porto/a.jpg.thumb.jpg', 100);
    const first = await system.dirUsage(process.env.PREVIEWS_DIR);
    write('previews/Porto/b.jpg.thumb.jpg', 100);
    expect(await system.dirUsage(process.env.PREVIEWS_DIR)).toEqual(first);
    system._clearSizeCache();
    expect((await system.dirUsage(process.env.PREVIEWS_DIR)).files).toBe(2);
  });

  it('buildSha lit version.json, "dev" sans fichier', () => {
    write('app/public/version.json', 0);
    fs.writeFileSync(path.join(tmp, 'app/public/version.json'), '{"sha":"abc1234"}');
    expect(system.buildSha(path.join(tmp, 'app'))).toBe('abc1234');
    expect(system.buildSha(path.join(tmp, 'nowhere'))).toBe('dev');
  });

  it('report sans base : build, disque, volumes, erreurs récentes', async () => {
    errorLog.record(['boom']);
    const r = await system.report({ maintenance: { at: '2026-10-27T00:00:00Z', sessions: 2, shares: 0 } });
    expect(r.database).toEqual({ ready: false });
    expect(r.build).toMatchObject({ node: process.version, env: expect.any(String), memory: { rss: expect.any(Number) } });
    expect(r.disk.photos.images).toBe(2);
    expect(r.disk.photosVolume.total).toBeGreaterThan(r.disk.photosVolume.free);
    expect(r.maintenance.sessions).toBe(2);
    expect(r.errors[0].message).toBe('boom');
  });

  it('report avec base : version, taille, migrations, compteurs, connexions', async () => {
    const query = vi.fn(async (sql) => {
      if (sql.startsWith('SHOW')) return { rows: [{ server_version: '17.6' }] };
      if (sql.includes('pg_database_size')) return { rows: [{ bytes: '1024' }] };
      if (sql.includes('schema_migrations')) return { rows: [{ version: 5, name: 'x', applied_at: 'now' }] };
      if (sql.includes('place_cache')) throw new Error('relation missing');   // a counter may fail alone
      return { rows: [{ n: '4' }] };
    });
    database._setState({ query, totalCount: 3, idleCount: 2, waitingCount: 0 }, true);
    const { database: db } = await system.report();
    expect(db).toMatchObject({ ready: true, version: '17.6', bytes: 1024, pool: { total: 3, idle: 2, waiting: 0 } });
    expect(db.counts).toMatchObject({ users: 4, places: null });
  });

  it('report signale une base qui répond en erreur sans échouer', async () => {
    database._setState({ query: vi.fn().mockRejectedValue(new Error('connection lost')) }, true);
    const { database: db } = await system.report();
    expect(db).toMatchObject({ ready: true, error: 'connection lost' });
  });
});
