import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../services/image.js', () => ({
  PHOTOS_DIR: '/test/photos',
  isImage:    f => f.endsWith('.jpg'),
  isAlbumDir: () => false,
}));

// Module importé une seule fois — état réinitialisé via _reset() entre les tests.
// On injecte un pool mock directement dans connectDb() pour éviter les problèmes
// d'interception du require('pg') CJS dans l'interop ESM de Vitest.
const database = await import('../../services/database.js');

const mockQuery = vi.fn();
const mockPool  = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  database._reset();
});

// ── état initial ──────────────────────────────────────────────────────────────

describe('état initial', () => {
  it('dbReady vaut false avant connectDb()', () => {
    expect(database.dbReady).toBe(false);
  });

  it('db vaut null avant connectDb()', () => {
    expect(database.db).toBeNull();
  });
});

// ── connectDb ─────────────────────────────────────────────────────────────────

describe('connectDb', () => {
  it('passe dbReady à true en cas de succès', async () => {
    await database.connectDb(mockPool);
    expect(database.dbReady).toBe(true);
  });

  it('crée les trois tables requises', async () => {
    await database.connectDb(mockPool);
    const sqls = mockQuery.mock.calls.map(c => c[0]);
    expect(sqls.some(s => s.includes('photo_views'))).toBe(true);
    expect(sqls.some(s => s.includes('photo_view_log'))).toBe(true);
    expect(sqls.some(s => s.includes('photo_likes'))).toBe(true);
  });

  it('laisse dbReady à false si toutes les tentatives échouent', async () => {
    vi.useFakeTimers();
    mockQuery.mockRejectedValue(new Error('ECONNREFUSED'));

    const connectPromise = database.connectDb(mockPool);

    for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(5_000);
    await connectPromise;

    expect(database.dbReady).toBe(false);
    vi.useRealTimers();
  }, 10_000);

  it('réussit après quelques échecs (retry)', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    mockQuery.mockImplementation(() => {
      attempt++;
      if (attempt < 3) throw new Error('not ready');
      return Promise.resolve({ rows: [] });
    });

    const connectPromise = database.connectDb(mockPool);

    await vi.advanceTimersByTimeAsync(5_000); // échec 1
    await vi.advanceTimersByTimeAsync(5_000); // échec 2
    await connectPromise;                      // succès à la 3e tentative

    expect(database.dbReady).toBe(true);
    vi.useRealTimers();
  }, 10_000);
});

// ── syncPhotosToDb ────────────────────────────────────────────────────────────

describe('syncPhotosToDb', () => {
  it("ne fait rien si dbReady est false", async () => {
    // connectDb non appelé → dbReady reste false
    await database.syncPhotosToDb();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
