import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

const image    = await import('../../../services/image.js');
const _require  = createRequire(import.meta.url);

const { withConcurrency, deletePhotoFiles, PHOTOS_DIR, PREVIEWS_DIR, MEDIUM_DIR } = image;

// ── withConcurrency ───────────────────────────────────────────────────────────

describe('withConcurrency', () => {
  it('exécute toutes les tâches d\'un tableau', async () => {
    const results = [];
    const tasks = [1, 2, 3].map(n => async () => { results.push(n); });
    await withConcurrency(tasks);
    expect(results.sort()).toEqual([1, 2, 3]);
  });

  it('retourne undefined une fois toutes les tâches terminées', async () => {
    const tasks = [async () => 42, async () => 99];
    const result = await withConcurrency(tasks);
    expect(result).toBeUndefined();
  });

  it('fonctionne avec un tableau vide', async () => {
    await expect(withConcurrency([])).resolves.toBeUndefined();
  });

  it('respecte la concurrence — toutes les tâches s\'exécutent', async () => {
    const order = [];
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      order.push(i);
    });
    await withConcurrency(tasks, 3);
    expect(order).toHaveLength(10);
    expect(order.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('utilise une concurrence de 1 correctement', async () => {
    const order = [];
    const tasks = [
      async () => { order.push('a'); },
      async () => { order.push('b'); },
      async () => { order.push('c'); },
    ];
    await withConcurrency(tasks, 1);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

// ── deletePhotoFiles ──────────────────────────────────────────────────────────

describe('deletePhotoFiles', () => {
  let mockUnlink;
  let mockQuery;
  let mockDb;

  beforeEach(() => {
    mockUnlink = vi.fn().mockResolvedValue(undefined);
    mockQuery  = vi.fn().mockResolvedValue({ rowCount: 1 });
    mockDb     = { dbReady: true, db: { query: mockQuery } };
  });

  it('appelle unlink sur le chemin du fichier original', async () => {
    await deletePhotoFiles('Paris', 'photo.jpg', mockDb, { fsPromises: { unlink: mockUnlink } });
    const expectedPath = path.resolve(path.join(PHOTOS_DIR, 'Paris', 'photo.jpg'));
    expect(mockUnlink).toHaveBeenCalledWith(expectedPath);
  });

  it('appelle unlink sur le preview dans PREVIEWS_DIR', async () => {
    await deletePhotoFiles('Paris', 'photo.jpg', mockDb, { fsPromises: { unlink: mockUnlink } });
    const expectedPreview = path.join(PREVIEWS_DIR, 'Paris', 'photo.jpg.jpg');
    const calls = mockUnlink.mock.calls.map(c => c[0]);
    expect(calls).toContain(expectedPreview);
  });

  it('appelle unlink sur le medium dans MEDIUM_DIR', async () => {
    await deletePhotoFiles('Paris', 'photo.jpg', mockDb, { fsPromises: { unlink: mockUnlink } });
    const expectedMedium = path.join(MEDIUM_DIR, 'Paris', 'photo.jpg.jpg');
    const calls = mockUnlink.mock.calls.map(c => c[0]);
    expect(calls).toContain(expectedMedium);
  });

  it('derivatives are named after the full filename (photo.png → photo.png.jpg), incl. the thumbnail', async () => {
    await deletePhotoFiles('Paris', 'photo.png', mockDb, { fsPromises: { unlink: mockUnlink } });
    const calls = mockUnlink.mock.calls.map(c => c[0]);
    expect(calls).toContain(path.join(PREVIEWS_DIR, 'Paris', 'photo.png.jpg'));
    expect(calls).toContain(path.join(PREVIEWS_DIR, 'Paris', 'photo.png.thumb.jpg'));
    expect(calls).toContain(path.join(MEDIUM_DIR, 'Paris', 'photo.png.jpg'));
    expect(calls.some(p => p.endsWith(path.sep + 'photo.jpg'))).toBe(false);   // never another photo's derivative
  });

  it('ignore les erreurs de suppression des fichiers preview', async () => {
    mockUnlink
      .mockResolvedValueOnce(undefined)   // original — ok
      .mockRejectedValueOnce(new Error('ENOENT')) // preview — missing
      .mockRejectedValueOnce(new Error('ENOENT')) // thumbnail — missing
      .mockRejectedValueOnce(new Error('ENOENT')); // medium — missing
    await expect(
      deletePhotoFiles('Paris', 'photo.jpg', mockDb, { fsPromises: { unlink: mockUnlink } }),
    ).resolves.toBeUndefined();
  });

  it('nettoie les 4 tables DB quand dbReady=true', async () => {
    await deletePhotoFiles('Paris', 'photo.jpg', mockDb, { fsPromises: { unlink: mockUnlink } });
    expect(mockQuery).toHaveBeenCalledTimes(4);
    expect(mockQuery.mock.calls.some(c => c[0].includes('photo_overrides'))).toBe(true);
    const sqls = mockQuery.mock.calls.map(c => c[0]);
    expect(sqls.some(s => s.includes('photo_view_log'))).toBe(true);
    expect(sqls.some(s => s.includes('photo_likes'))).toBe(true);
    expect(sqls.some(s => s.includes('photo_views'))).toBe(true);
  });

  it('passe les bons paramètres (album, filename) à chaque requête DB', async () => {
    await deletePhotoFiles('Paris', 'sunset.jpg', mockDb, { fsPromises: { unlink: mockUnlink } });
    for (const [, params] of mockQuery.mock.calls) {
      expect(params).toEqual(['Paris', 'sunset.jpg']);
    }
  });

  it('saute le nettoyage DB si dbReady=false', async () => {
    const noDbReady = { dbReady: false, db: { query: mockQuery } };
    await deletePhotoFiles('Paris', 'photo.jpg', noDbReady, { fsPromises: { unlink: mockUnlink } });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('appelle unlink exactement 4 fois (original + preview, vignette, medium)', async () => {
    await deletePhotoFiles('Paris', 'photo.jpg', mockDb, { fsPromises: { unlink: mockUnlink } });
    expect(mockUnlink).toHaveBeenCalledTimes(4);
  });
});
