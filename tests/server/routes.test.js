import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// database.js n'est PAS mocké : on récupère la même instance CJS que server.js
// via createRequire, puis on contrôle l'état avec _reset() / _setState().

vi.mock('../../services/image.js', () => ({
  PHOTOS_DIR:    '/test/photos',
  PREVIEWS_DIR:  '/test/previews',
  isImage:       f  => ['.jpg', '.jpeg', '.png'].some(e => f.endsWith(e)),
  isAlbumDir:    e  => e.isDirectory?.() ?? false,
  ensurePreview: vi.fn().mockResolvedValue('/previews/album/photo.jpg'),
  photoMeta:     vi.fn().mockResolvedValue({
    filename: 'photo.jpg', name: 'Photo', description: '',
    is360: false, gps: null, location: null,
    url: '/photos/album/photo.jpg', previewUrl: '/previews/album/photo.jpg',
  }),
  preGenerateAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync:  vi.fn().mockReturnValue(false),
    mkdirSync:   vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

// server.js est chargé en premier — il place database.js dans le cache CJS
const { app } = await import('../../server.js');

// createRequire donne accès au même cache CJS que les require() de server.js
const _require  = createRequire(import.meta.url);
const database  = _require('../../services/database.js');

const mockQuery = vi.fn();

beforeEach(() => {
  database._reset();
  mockQuery.mockReset();
});

// ── /api/geocode ──────────────────────────────────────────────────────────────

describe('GET /api/geocode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ address: { city: 'Paris', country: 'France' } }),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('retourne 400 pour lat NaN', async () => {
    const res = await request(app).get('/api/geocode?lat=abc&lng=2');
    expect(res.status).toBe(400);
  });

  it('retourne 400 pour lat hors plage (> 90)', async () => {
    const res = await request(app).get('/api/geocode?lat=91&lng=0');
    expect(res.status).toBe(400);
  });

  it('retourne 400 pour lng hors plage (< -180)', async () => {
    const res = await request(app).get('/api/geocode?lat=0&lng=-181');
    expect(res.status).toBe(400);
  });

  it('retourne 200 pour des coordonnées valides', async () => {
    const res = await request(app).get('/api/geocode?lat=48.85&lng=2.35');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('location');
  });
});

// ── /api/view ─────────────────────────────────────────────────────────────────

const VALID_TOKEN = '123e4567-e89b-12d3-a456-426614174000';

describe('POST /api/view', () => {
  it('retourne 400 si le token est absent', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/view')
      .send({ album: 'Paris', filename: 'photo.jpg' });
    expect(res.status).toBe(400);
  });

  it("retourne 400 si le token n'est pas un UUID valide", async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/view')
      .send({ album: 'Paris', filename: 'photo.jpg', token: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });

  it("retourne { views: null } si la DB n'est pas prête", async () => {
    // database._reset() appelé en beforeEach → dbReady = false
    const res = await request(app)
      .post('/api/view')
      .send({ album: 'Paris', filename: 'photo.jpg', token: VALID_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.views).toBeNull();
  });

  it('retourne views + likes + liked si la DB est prête', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1 })                         // INSERT view_log
      .mockResolvedValueOnce({ rowCount: 1 })                         // INSERT photo_views +1
      .mockResolvedValueOnce({ rows: [{ views: '5' }] })              // SELECT views
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })              // COUNT likes
      .mockResolvedValueOnce({ rowCount: 0 });                        // liked by token?
    database._setState({ query: mockQuery }, true);

    const res = await request(app)
      .post('/api/view')
      .send({ album: 'Paris', filename: 'photo.jpg', token: VALID_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.views).toBe(5);
    expect(res.body.likes).toBe(2);
    expect(res.body.liked).toBe(false);
  });
});

// ── /api/like ─────────────────────────────────────────────────────────────────

describe('POST /api/like', () => {
  it('retourne 400 si le token est absent', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/like')
      .send({ album: 'Paris', filename: 'photo.jpg' });
    expect(res.status).toBe(400);
  });

  it('retourne 400 pour un UUID invalide', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/like')
      .send({ album: 'Paris', filename: 'photo.jpg', token: 'bad' });
    expect(res.status).toBe(400);
  });

  it('retourne le résultat par défaut si DB non prête', async () => {
    // database._reset() → dbReady = false
    const res = await request(app)
      .post('/api/like')
      .send({ album: 'Paris', filename: 'photo.jpg', token: VALID_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ liked: false, count: 0 });
  });

  it("insère un like si pas encore liké", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0 })              // pas de like existant
      .mockResolvedValueOnce({ rowCount: 1 })              // INSERT like
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });  // COUNT
    database._setState({ query: mockQuery }, true);

    const res = await request(app)
      .post('/api/like')
      .send({ album: 'Paris', filename: 'photo.jpg', token: VALID_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.liked).toBe(true);
    expect(res.body.count).toBe(1);
  });

  it("supprime le like si déjà liké (unlike)", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1 })              // like existant
      .mockResolvedValueOnce({ rowCount: 1 })              // DELETE like
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });  // COUNT
    database._setState({ query: mockQuery }, true);

    const res = await request(app)
      .post('/api/like')
      .send({ album: 'Paris', filename: 'photo.jpg', token: VALID_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.liked).toBe(false);
    expect(res.body.count).toBe(0);
  });
});

// ── /api/liked ────────────────────────────────────────────────────────────────

describe('GET /api/liked', () => {
  it('retourne { filenames: [] } si token invalide', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/liked?album=Paris&token=bad');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ filenames: [] });
  });

  it('retourne { filenames: [] } si DB non prête', async () => {
    // database._reset() → dbReady = false
    const res = await request(app).get(`/api/liked?album=Paris&token=${VALID_TOKEN}`);
    expect(res.body).toEqual({ filenames: [] });
  });

  it('retourne les filenames likés', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ filename: 'a.jpg' }, { filename: 'b.jpg' }],
    });
    database._setState({ query: mockQuery }, true);

    const res = await request(app).get(`/api/liked?album=Paris&token=${VALID_TOKEN}`);
    expect(res.body.filenames).toEqual(['a.jpg', 'b.jpg']);
  });
});

// ── /api/albums ───────────────────────────────────────────────────────────────

describe('GET /api/albums', () => {
  it('retourne 200 avec un tableau', async () => {
    const res = await request(app).get('/api/albums');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
