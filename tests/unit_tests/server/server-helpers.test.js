import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../services/image.js', () => ({
  PHOTOS_DIR:       '/test/photos',
  PREVIEWS_DIR:     '/test/previews',
  MEDIUM_DIR:       '/test/medium',
  isImage:          f => ['.jpg', '.jpeg', '.png'].some(e => f.endsWith(e)),
  isAlbumDir:       e => e.isDirectory?.() ?? false,
  ensurePreview:    vi.fn().mockResolvedValue('/previews/album/photo.jpg'),
  photoMeta:        vi.fn().mockResolvedValue({ filename: 'photo.jpg', name: 'Photo' }),
  preGenerateAll:   vi.fn().mockResolvedValue(undefined),
  deletePhotoFiles: vi.fn().mockResolvedValue(undefined),
}));

// server.js requires fs via CJS — we use vi.spyOn on the same fs instance
// imported here as ESM so patches are visible inside server.js routes.
import fs from 'fs';

const { app, deletePhotoFromDb, deleteAlbumFromDb, watchPhotosDir } =
  await import('../../../server.js');

const _require = createRequire(import.meta.url);
const database = _require('../../../services/database.js');
const authMod  = _require('../../../services/auth.js');

authMod._setBypass(true);

const mockQuery = vi.fn();

beforeEach(() => {
  database._reset();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rowCount: 1 });
  vi.spyOn(fs, 'existsSync').mockReturnValue(false);
  vi.spyOn(fs, 'readdirSync').mockReturnValue([]);
  vi.spyOn(fs, 'watch').mockReturnValue({ close: vi.fn() });
});

afterEach(() => vi.restoreAllMocks());

// ── GET /api/health ───────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('retourne 503 et status degraded si DB non prête', async () => {
    // database._reset() → dbReady=false
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toBe(false);
  });

  it('retourne 200 et status ok si DB prête', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe(true);
  });

  it('inclut uptime dans la réponse', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body).toHaveProperty('uptime');
    expect(typeof res.body.uptime).toBe('number');
  });
});

// ── deletePhotoFromDb ─────────────────────────────────────────────────────────

describe('deletePhotoFromDb', () => {
  it('ne fait rien si DB non prête', async () => {
    await deletePhotoFromDb('Paris', 'photo.jpg');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('supprime les entrées dans les 3 tables', async () => {
    database._setState({ query: mockQuery }, true);
    await deletePhotoFromDb('Paris', 'sunset.jpg');
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const sqls = mockQuery.mock.calls.map(c => c[0]);
    expect(sqls.some(s => s.includes('photo_view_log'))).toBe(true);
    expect(sqls.some(s => s.includes('photo_likes'))).toBe(true);
    expect(sqls.some(s => s.includes('photo_views'))).toBe(true);
  });

  it('passe album et filename en paramètres', async () => {
    database._setState({ query: mockQuery }, true);
    await deletePhotoFromDb('Tokyo', 'night.jpg');
    for (const [, params] of mockQuery.mock.calls) {
      expect(params).toEqual(['Tokyo', 'night.jpg']);
    }
  });
});

// ── deleteAlbumFromDb ─────────────────────────────────────────────────────────

describe('deleteAlbumFromDb', () => {
  it('ne fait rien si DB non prête', async () => {
    await deleteAlbumFromDb('Paris');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('supprime les entrées dans les 7 tables', async () => {
    database._setState({ query: mockQuery }, true);
    await deleteAlbumFromDb('Paris');
    expect(mockQuery).toHaveBeenCalledTimes(7);
    const sqls = mockQuery.mock.calls.map(c => c[0]);
    expect(sqls.some(s => s.includes('photo_view_log'))).toBe(true);
    expect(sqls.some(s => s.includes('photo_likes'))).toBe(true);
    expect(sqls.some(s => s.includes('photo_views'))).toBe(true);
    expect(sqls.some(s => s.includes('album_users'))).toBe(true);
    expect(sqls.some(s => s.includes('album_settings'))).toBe(true);
    expect(sqls.some(s => s.includes('share_tokens'))).toBe(true);
    expect(sqls.some(s => s.includes('push_subscriptions'))).toBe(true);
  });

  it('passe le nom d\'album en paramètre', async () => {
    database._setState({ query: mockQuery }, true);
    await deleteAlbumFromDb('London');
    for (const [, params] of mockQuery.mock.calls) {
      expect(params).toEqual(['London']);
    }
  });
});

// ── watchPhotosDir ────────────────────────────────────────────────────────────

describe('watchPhotosDir', () => {
  it('retourne immédiatement si PHOTOS_DIR n\'existe pas', () => {
    fs.existsSync.mockReturnValue(false);
    expect(() => watchPhotosDir()).not.toThrow();
    expect(fs.watch).not.toHaveBeenCalled();
  });

  it('démarre fs.watch si PHOTOS_DIR existe', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue([]);
    watchPhotosDir();
    expect(fs.watch).toHaveBeenCalled();
  });

  it('gère l\'exception si fs.watch lève une erreur', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue([]);
    fs.watch.mockImplementation(() => { throw new Error('ENOTSUP'); });
    expect(() => watchPhotosDir()).not.toThrow();
  });
});

// ── albumAccessGuard avec share token ────────────────────────────────────────

describe('albumAccessGuard avec share token', () => {
  it('autorise l\'accès avec un share token valide sur album restreint', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] });                    // share_tokens
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .get('/previews/Paris/photo.jpg?share=validtoken123');
    expect(res.status).not.toBe(401);
  });

  it('refuse si share token invalide et pas d\'utilisateur', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] })
      .mockResolvedValueOnce({ rows: [] }); // token non trouvé
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .get('/previews/Paris/photo.jpg?share=badtoken');
    expect(res.status).toBe(401);
  });
});

// ── syncPhotosToDb (via database module) ─────────────────────────────────────

describe('database.syncPhotosToDb', () => {
  it('ne fait rien si DB non prête', async () => {
    await database.syncPhotosToDb();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ne fait rien si PHOTOS_DIR n\'existe pas', async () => {
    database._setState({ query: mockQuery }, true);
    fs.existsSync.mockReturnValue(false);
    await database.syncPhotosToDb();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('insère les photos trouvées dans photo_views', async () => {
    database._setState({ query: mockQuery }, true);
    fs.existsSync.mockReturnValue(true);
    const albumDir = { name: 'Paris', isDirectory: () => true };
    fs.readdirSync
      .mockReturnValueOnce([albumDir])       // albums
      .mockReturnValueOnce(['a.jpg', 'b.jpg']); // fichiers
    await database.syncPhotosToDb();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO photo_views');
    expect(sql).toContain('ON CONFLICT DO NOTHING');
  });
});
