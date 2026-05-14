import { createRequire } from 'module';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/image.js', () => ({
  PHOTOS_DIR: '/test/photos',
  isImage:    f => f.endsWith('.jpg'),
  // Accepts withFileTypes entries whose isDirectory() returns true,
  // allowing syncPhotosToDb to be tested with realistic fake albums.
  isAlbumDir: e => e.isDirectory?.() ?? false,
}));

// Module imported once — state reset via _reset() between tests.
// We inject a mock pool directly into connectDb() to avoid interception issues
// with require('pg') CJS in Vitest's ESM interop.
const database = await import('../../services/database.js');

// fsMod: same fs object used by database.js (shared CJS cache).
// vi.spyOn on its properties is immediately visible in the tested module.
const _require = createRequire(import.meta.url);
const fsMod    = _require('fs');

const mockQuery = vi.fn();
const mockPool  = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  database._reset();
});

// ── initial state ─────────────────────────────────────────────────────────────

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

    await vi.advanceTimersByTimeAsync(5_000); // failure 1
    await vi.advanceTimersByTimeAsync(5_000); // failure 2
    await connectPromise;                      // succeeds on 3rd attempt

    expect(database.dbReady).toBe(true);
    vi.useRealTimers();
  }, 10_000);

  it('effectue exactement 12 tentatives et ne dort pas après la dernière', async () => {
    vi.useFakeTimers();
    mockQuery.mockRejectedValue(new Error('fail'));

    const p = database.connectDb(mockPool);
    // 11 sleeps of 5 s (attempts 1–11); no sleep after attempt 12
    for (let i = 0; i < 11; i++) await vi.advanceTimersByTimeAsync(5_000);
    await p;

    // Une query SELECT 1 par tentative = 12 appels au total
    expect(mockQuery).toHaveBeenCalledTimes(12);
    expect(database.dbReady).toBe(false);
    vi.useRealTimers();
  }, 10_000);
});

// ── syncPhotosToDb ────────────────────────────────────────────────────────────

describe('syncPhotosToDb', () => {
  const albumEntry = { name: 'Paris', isDirectory: () => true };

  afterEach(() => vi.restoreAllMocks());

  it("ne fait rien si dbReady est false", async () => {
    // connectDb not called → dbReady stays false
    await database.syncPhotosToDb();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("ne fait rien si PHOTOS_DIR n'existe pas", async () => {
    database._setState(mockPool, true);
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);

    await database.syncPhotosToDb();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('insère une ligne par photo dans photo_views', async () => {
    database._setState(mockPool, true);
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync')
      .mockReturnValueOnce([albumEntry])           // PHOTOS_DIR
      .mockReturnValueOnce(['a.jpg', 'b.jpg']);    // album Paris

    await database.syncPhotosToDb();

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO photo_views'),
      ['Paris', 'a.jpg'],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO photo_views'),
      ['Paris', 'b.jpg'],
    );
  });

  it('traite plusieurs albums et ignore les fichiers non-images', async () => {
    const romeEntry = { name: 'Rome', isDirectory: () => true };
    database._setState(mockPool, true);
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync')
      .mockReturnValueOnce([albumEntry, romeEntry]) // PHOTOS_DIR
      .mockReturnValueOnce(['photo.jpg', 'doc.pdf']) // Paris (1 image, 1 ignored)
      .mockReturnValueOnce(['img.jpg']);             // Rome

    await database.syncPhotosToDb();

    // 1 photo dans Paris + 1 dans Rome = 2 INSERT
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenCalledWith(expect.anything(), ['Paris', 'photo.jpg']);
    expect(mockQuery).toHaveBeenCalledWith(expect.anything(), ['Rome', 'img.jpg']);
  });

  it("ne fait aucun INSERT si l'album est vide", async () => {
    database._setState(mockPool, true);
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync')
      .mockReturnValueOnce([albumEntry]) // PHOTOS_DIR
      .mockReturnValueOnce([]);          // album vide

    await database.syncPhotosToDb();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
