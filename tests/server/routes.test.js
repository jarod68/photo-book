import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// database.js is NOT mocked: we retrieve the same CJS instance as server.js
// via createRequire, then control the state with _reset() / _setState().

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

// server.js is loaded first — it places database.js in the CJS cache
const { app } = await import('../../server.js');

// createRequire gives access to the same CJS cache as server.js's require() calls.
// fsMod and exifrMod are the same objects used by server.js:
// modifying their properties here is immediately visible in the routes.
const _require  = createRequire(import.meta.url);
const database  = _require('../../services/database.js');
const fsMod     = _require('fs');    // vi.fn() instances depuis vi.mock('fs', …)
const exifrMod  = _require('exifr'); // real module — we will use vi.spyOn

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
    // database._reset() called in beforeEach → dbReady = false
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
      .mockResolvedValueOnce({ rowCount: 0 })              // no existing like
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
      .mockResolvedValueOnce({ rowCount: 1 })              // existing like
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

// ── /api/albums/:album ────────────────────────────────────────────────────────

describe('GET /api/albums/:album', () => {
  beforeEach(() => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    vi.spyOn(fsMod, 'readdirSync').mockReturnValue([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("retourne 404 si l'album n'existe pas", async () => {
    // fsMod.existsSync returns false by default (describe beforeEach spy)
    const res = await request(app).get('/api/albums/Inconnu');
    expect(res.status).toBe(404);
  });

  it('retourne 200 avec { name, photos } si l\'album existe (sans DB)', async () => {
    fsMod.existsSync.mockReturnValue(true);
    fsMod.readdirSync.mockReturnValue(['photo.jpg']);

    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Paris');
    expect(Array.isArray(res.body.photos)).toBe(true);
    expect(res.body.photos).toHaveLength(1);
  });

  it('enrichit les photos avec views et likes si la DB est prête', async () => {
    fsMod.existsSync.mockReturnValue(true);
    fsMod.readdirSync.mockReturnValue(['photo.jpg']);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ filename: 'photo.jpg', views: '7' }] })
      .mockResolvedValueOnce({ rows: [{ filename: 'photo.jpg', likes: '3' }] });
    database._setState({ query: mockQuery }, true);

    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(200);
    expect(res.body.photos[0].views).toBe(7);
    expect(res.body.photos[0].likes).toBe(3);
  });

  it('retourne 500 si readdirSync lève une exception', async () => {
    fsMod.existsSync.mockReturnValue(true);
    fsMod.readdirSync.mockImplementation(() => { throw new Error('disk error'); });

    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(500);
  });
});

// ── /api/map ──────────────────────────────────────────────────────────────────
// exifr is mocked via vi.spyOn on the module loaded by server.js.
// vi.restoreAllMocks() in afterEach restores the original after each test.

describe('GET /api/map', () => {
  const albumDir = { name: 'Paris', isDirectory: () => true };

  beforeEach(() => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    vi.spyOn(fsMod, 'readdirSync').mockReturnValue([]);
    vi.spyOn(exifrMod, 'gps').mockResolvedValue(null);
    vi.spyOn(exifrMod, 'parse').mockResolvedValue(null);
  });

  afterEach(() => vi.restoreAllMocks());

  it('retourne [] si PHOTOS_DIR est absent', async () => {
    // fsMod.existsSync returns false by default
    const res = await request(app).get('/api/map');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("retourne [] si aucune photo n'a de coordonnées GPS", async () => {
    fsMod.existsSync.mockReturnValue(true);
    fsMod.readdirSync
      .mockReturnValueOnce([albumDir])
      .mockReturnValueOnce(['photo.jpg']);
    // exifrMod.gps returns null by default → photo skipped

    const res = await request(app).get('/api/map');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('retourne les photos GPS avec tous les champs attendus', async () => {
    fsMod.existsSync
      .mockReturnValueOnce(true)   // PHOTOS_DIR existe
      .mockReturnValue(false);     // preview not generated
    fsMod.readdirSync
      .mockReturnValueOnce([albumDir])
      .mockReturnValueOnce(['img.jpg']);
    exifrMod.gps.mockResolvedValue({ latitude: 48.8566, longitude: 2.3522 });
    exifrMod.parse.mockResolvedValue({ DateTimeOriginal: new Date('2024-06-15T12:00:00Z') });

    const res = await request(app).get('/api/map');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const photo = res.body[0];
    expect(photo.gps).toEqual({ lat: 48.8566, lng: 2.3522 });
    expect(photo.album).toBe('Paris');
    expect(photo.filename).toBe('img.jpg');
    expect(photo.name).toBe('img');
    expect(photo.url).toBe('/photos/Paris/img.jpg');
    expect(photo.albumIndex).toBe(0);
    expect(photo.date).toBe('2024-06-15T12:00:00.000Z');
    expect(photo.previewUrl).toBeNull();
  });

  it('inclut previewUrl si le fichier de preview existe sur le disque', async () => {
    fsMod.existsSync.mockReturnValue(true); // PHOTOS_DIR + preview
    fsMod.readdirSync
      .mockReturnValueOnce([albumDir])
      .mockReturnValueOnce(['img.jpg']);
    exifrMod.gps.mockResolvedValue({ latitude: 48.8566, longitude: 2.3522 });

    const res = await request(app).get('/api/map');
    expect(res.body[0].previewUrl).toBe('/previews/Paris/img.jpg');
  });

  it('ignore les photos sans coordonnées GPS', async () => {
    fsMod.existsSync.mockReturnValueOnce(true).mockReturnValue(false);
    fsMod.readdirSync
      .mockReturnValueOnce([albumDir])
      .mockReturnValueOnce(['avec-gps.jpg', 'sans-gps.jpg']);
    exifrMod.gps
      .mockResolvedValueOnce({ latitude: 48.8566, longitude: 2.3522 })
      .mockResolvedValueOnce(null);

    const res = await request(app).get('/api/map');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].filename).toBe('avec-gps.jpg');
  });
});
