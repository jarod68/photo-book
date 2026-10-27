import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// database.js is NOT mocked: we retrieve the same CJS instance as server.js
// via createRequire, then control the state with _reset() / _setState().

vi.mock('../../../services/image.js', () => ({
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
const { app } = await import('../../../server.js');

// createRequire gives access to the same CJS cache as server.js's require() calls.
// fsMod and exifrMod are the same objects used by server.js:
// modifying their properties here is immediately visible in the routes.
const _require  = createRequire(import.meta.url);
const database  = _require('../../../services/database.js');
const authMod   = _require('../../../services/auth.js');
const fsMod     = _require('fs');    // vi.fn() instances from vi.mock('fs', …)
const libraryMod = _require('../../../services/library.js'); // photo index used by the album and map routes — vi.spyOn

// Bypass auth for all route tests (vi.mock cannot intercept CJS require)
authMod._setBypass(true);

const mockQuery = vi.fn();

// What the photo library holds in a test: album name → file names. The routes
// read albums only through services/library.js (no synchronous fs, T7).
function stubLibrary(albums) {
  vi.spyOn(libraryMod, 'listAlbums').mockResolvedValue(Object.keys(albums));
  vi.spyOn(libraryMod, 'albumExists').mockImplementation(async (a) => a in albums);
  vi.spyOn(libraryMod, 'listPhotos').mockImplementation(async (a) => albums[a] ?? null);
  vi.spyOn(libraryMod, 'getAlbumPhotos').mockImplementation(async (a) =>
    (albums[a] ?? []).map((filename) => ({ filename, url: `/photos/${a}/${filename}` })));
}

beforeEach(() => {
  database._reset();
  mockQuery.mockReset();
  _require('../../../services/gps-privacy.js')._reset();   // its settings cache
});

// ── albumAccessGuard ──────────────────────────────────────────────────────────

describe('albumAccessGuard (via /previews)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('appelle next() directement si DB non prête (dbReady=false)', async () => {
    // database._reset() in beforeEach → dbReady=false → line 106 next()
    const res = await request(app).get('/previews/Paris/photo.jpg');
    expect(res.status).not.toBe(401);
  });

  it('appelle next() si le chemin n\'a pas de segment d\'album', async () => {
    // dbReady=true, req.path='/' → parts=[] → line 108 next()
    mockQuery.mockResolvedValue({ rows: [] });
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/previews/');
    expect(res.status).not.toBe(401);
  });

  it('appelle next() si l\'album est public (ligne 114)', async () => {
    // DB ready, no album_settings row → visibility='public' → allowed=true → next()
    mockQuery.mockResolvedValue({ rows: [] });
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/previews/Paris/photo.jpg');
    // Static file absent → 404 is fine; pas de 401
    expect(res.status).not.toBe(401);
  });

  it('retourne 401 si album restreint et pas d\'utilisateur connecté', async () => {
    // DB ready, visibility='restricted', no token → user=null → not allowed → 401
    mockQuery.mockResolvedValue({ rows: [{ visibility: 'restricted' }] });
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/previews/Paris/photo.jpg');
    expect(res.status).toBe(401);
  });
});

// ── /api/geocode ──────────────────────────────────────────────────────────────

describe('GET /api/geocode', () => {
  beforeEach(() => {
    _require('../../../services/places.js')._reset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
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

  it('retourne { location: null } si fetch lève une exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/geocode?lat=48.86&lng=2.36');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ location: null });
    errSpy.mockRestore();
  });

  it('utilise le cache pour des coordonnées déjà demandées', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ address: { city: 'Lyon', country: 'France' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await request(app).get('/api/geocode?lat=45.75&lng=4.83');
    await request(app).get('/api/geocode?lat=45.75&lng=4.83');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it('retourne 500 si la requête DB échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db crash'));
    database._setState({ query: mockQuery }, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/api/view')
      .send({ album: 'Paris', filename: 'photo.jpg', token: VALID_TOKEN });
    expect(res.status).toBe(500);
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

  it('retourne 500 si la requête DB échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    database._setState({ query: mockQuery }, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/api/like')
      .send({ album: 'Paris', filename: 'photo.jpg', token: VALID_TOKEN });
    expect(res.status).toBe(500);
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

  it('retourne { filenames: [] } si la requête DB échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get(`/api/liked?album=Paris&token=${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ filenames: [] });
  });
});

// ── /api/albums ───────────────────────────────────────────────────────────────

describe('GET /api/albums', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 200 avec un tableau', async () => {
    const res = await request(app).get('/api/albums');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('retourne visibility public et canDelete false quand DB prête et aucun cookie', async () => {
    stubLibrary({ Paris: [] });
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // album_settings (no entries)
      .mockResolvedValueOnce({ rows: [] }); // album_users (no basic user)
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/albums');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].visibility).toBe('public');
    expect(res.body[0].canDelete).toBe(false);
  });

  it('renvoie couverture choisie, description et plage de dates (F3)', async () => {
    stubLibrary({ Paris: ['a.jpg', 'b.jpg'] });
    vi.spyOn(libraryMod, 'getAlbumPhotos').mockResolvedValue([
      { filename: 'a.jpg', type: 'photo', url: '/photos/Paris/a.jpg', thumbUrl: '/t/a', previewUrl: '/p/a', takenAt: '2024-05-01T10:00:00.000Z' },
      { filename: 'b.jpg', type: 'photo', url: '/photos/Paris/b.jpg', thumbUrl: '/t/b', previewUrl: '/p/b', takenAt: '2024-04-01T10:00:00.000Z' },
    ]);
    mockQuery.mockImplementation(async (sql) => (
      sql.includes('cover, description')
        ? { rows: [{ album: 'Paris', cover: 'b.jpg', description: 'Printemps' }] }
        : { rows: [] }));
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/albums');
    expect(res.body[0]).toMatchObject({
      name: 'Paris', count: 2, cover: '/photos/Paris/b.jpg', coverThumb: '/t/b', description: 'Printemps',
      dateFrom: '2024-04-01T10:00:00.000Z', dateTo: '2024-05-01T10:00:00.000Z',
    });
    expect(res.body[0].coverFile).toBeUndefined();
  });

  it('exclut un album restricted quand aucun utilisateur authentifié', async () => {
    stubLibrary({ Public: [], Secret: [] });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'Secret', visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [] }); // album_users
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/albums');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Public');
  });

  it('retourne 500 si la lecture des albums échoue', async () => {
    vi.spyOn(libraryMod, 'listAlbums').mockRejectedValue(new Error('disk error'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/albums');
    expect(res.status).toBe(500);
  });

  it('inclut les albums restricted pour un utilisateur admin (ligne 526)', async () => {
    stubLibrary({ VIP: [] });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'VIP', visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [] }); // album_users (admin: no user_id query)
    database._setState({ query: mockQuery }, true);
    vi.spyOn(authMod, 'getSessionUser').mockResolvedValue({ id: 1, role: 'admin' });
    const res = await request(app)
      .get('/api/albums')
      .set('Cookie', 'pb_session=' + 'a'.repeat(64));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('VIP');
  });

  it('inclut les albums restricted pour un utilisateur basic autorisé (ligne 527)', async () => {
    stubLibrary({ VIP: [] });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'VIP', visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [{ album: 'VIP' }] }); // album_users: user authorized
    database._setState({ query: mockQuery }, true);
    vi.spyOn(authMod, 'getSessionUser').mockResolvedValue({ id: 5, role: 'basic' });
    const res = await request(app)
      .get('/api/albums')
      .set('Cookie', 'pb_session=' + 'a'.repeat(64));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('VIP');
  });
});

// ── /api/albums/:album ────────────────────────────────────────────────────────

describe('GET /api/albums/:album', () => {
  beforeEach(() => stubLibrary({}));

  afterEach(() => vi.restoreAllMocks());

  it("retourne 404 si l'album n'existe pas", async () => {
    // no album in the library (describe beforeEach)
    const res = await request(app).get('/api/albums/Inconnu');
    expect(res.status).toBe(404);
  });

  it('retourne 200 avec { name, photos } si l\'album existe (sans DB)', async () => {
    stubLibrary({ Paris: ['photo.jpg'] });

    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Paris');
    expect(Array.isArray(res.body.photos)).toBe(true);
    expect(res.body.photos).toHaveLength(1);
  });

  it('enrichit les photos avec views et likes si la DB est prête', async () => {
    stubLibrary({ Paris: ['photo.jpg'] });
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // getAlbumVisibility (album_settings)
      .mockResolvedValueOnce({ rows: [] })  // photo_overrides
      .mockResolvedValueOnce({ rows: [] })  // gps_privacy (F10)
      .mockResolvedValueOnce({ rows: [{ filename: 'photo.jpg', views: '7' }] })
      .mockResolvedValueOnce({ rows: [{ filename: 'photo.jpg', likes: '3' }] });
    database._setState({ query: mockQuery }, true);

    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(200);
    expect(res.body.photos[0].views).toBe(7);
    expect(res.body.photos[0].likes).toBe(3);
  });

  it('retourne 500 si la lecture de l\'album échoue', async () => {
    stubLibrary({ Paris: [] });
    libraryMod.getAlbumPhotos.mockRejectedValue(new Error('disk error'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(500);
  });

  it('ne modifie pas les objets du cache en ajoutant views / likes', async () => {
    stubLibrary({ Paris: [] });
    const cached = { filename: 'photo.jpg' };
    libraryMod.getAlbumPhotos.mockResolvedValue([cached]);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })  // gps_privacy (F10)
      .mockResolvedValueOnce({ rows: [{ filename: 'photo.jpg', views: '7' }] })
      .mockResolvedValueOnce({ rows: [] });
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/albums/Paris');
    expect(res.body.photos[0].views).toBe(7);
    expect(cached.views).toBeUndefined();
  });

  it('applique les titres / légendes / lieux modifiés dans l\'admin (F2)', async () => {
    stubLibrary({ Paris: [] });
    const cached = { filename: 'photo.jpg', name: 'IMG_1', description: 'exif', location: null };
    libraryMod.getAlbumPhotos.mockResolvedValue([cached]);
    mockQuery.mockImplementation(async (sql) => (
      sql.includes('photo_overrides')
        ? { rows: [{ album: 'Paris', filename: 'photo.jpg', title: 'Tour Eiffel', description: null, location: 'Paris, France' }] }
        : { rows: [] }));
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/albums/Paris');
    expect(res.body.photos[0]).toMatchObject({ name: 'Tour Eiffel', description: 'exif', location: 'Paris, France' });
    expect(cached.name).toBe('IMG_1');
  });

  it('retourne canDelete false quand DB prête et aucun utilisateur (album public)', async () => {
    stubLibrary({ Paris: ['photo.jpg'] });
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // getAlbumVisibility → public
      .mockResolvedValueOnce({ rows: [] })  // photo_views
      .mockResolvedValueOnce({ rows: [] }); // photo_likes
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(200);
    expect(res.body.canDelete).toBe(false);
  });

  it('retourne 401 si album restricted et aucun utilisateur', async () => {
    stubLibrary({ Paris: ['photo.jpg'] });
    mockQuery.mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }); // getAlbumVisibility
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(401);
  });

  it('retourne 503 (fail-closed) si getAlbumAccess lève une exception', async () => {
    stubLibrary({ Paris: ['photo.jpg'] });
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(503);
  });
});

// ── /api/map ──────────────────────────────────────────────────────────────────
// services/exif.js is mocked via vi.spyOn on the module loaded by server.js.
// vi.restoreAllMocks() in afterEach restores the original after each test.

describe('GET /api/map', () => {
  // Photos as the cached library returns them (services/library.js).
  const photo = (filename, extra = {}) => ({
    filename, url: `/photos/Paris/${filename}`,
    previewUrl: `/previews/Paris/${filename}.jpg?v=1`, thumbUrl: `/previews/Paris/${filename}.thumb.jpg?v=1`,
    gps: null, takenAt: null, ...extra,
  });

  beforeEach(() => {
    vi.spyOn(libraryMod, 'listAlbums').mockResolvedValue([]);
    vi.spyOn(libraryMod, 'getAlbumPhotos').mockResolvedValue([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("retourne [] s'il n'y a aucun album", async () => {
    const res = await request(app).get('/api/map');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('retourne les photos GPS avec tous les champs attendus', async () => {
    libraryMod.listAlbums.mockResolvedValue(['Paris']);
    libraryMod.getAlbumPhotos.mockResolvedValue([
      photo('img.jpg', { gps: { lat: 48.8566, lng: 2.3522 }, takenAt: '2024-06-15T12:00:00.000Z' }),
    ]);
    const res = await request(app).get('/api/map');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      gps: { lat: 48.8566, lng: 2.3522 }, date: '2024-06-15T12:00:00.000Z', name: 'img', filename: 'img.jpg',
      previewUrl: '/previews/Paris/img.jpg.jpg?v=1', thumbUrl: '/previews/Paris/img.jpg.thumb.jpg?v=1',
      url: '/photos/Paris/img.jpg', album: 'Paris', albumIndex: 0,
    }]);
  });

  it("ignore les photos sans GPS mais garde l'index de la photo dans l'album", async () => {
    libraryMod.listAlbums.mockResolvedValue(['Paris']);
    libraryMod.getAlbumPhotos.mockResolvedValue([photo('sans-gps.jpg'), photo('avec-gps.jpg', { gps: { lat: 1, lng: 2 } })]);
    const res = await request(app).get('/api/map');
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ filename: 'avec-gps.jpg', albumIndex: 1, date: null });
  });

  it('filtre un album restricted quand DB prête et aucun utilisateur authentifié', async () => {
    libraryMod.listAlbums.mockResolvedValue(['Secret']);
    libraryMod.getAlbumPhotos.mockResolvedValue([photo('x.jpg', { gps: { lat: 1, lng: 2 } })]);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'Secret', visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [] }); // album_users
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/map');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(libraryMod.getAlbumPhotos).not.toHaveBeenCalled();
  });

  it('inclut les albums restricted pour un utilisateur admin', async () => {
    libraryMod.listAlbums.mockResolvedValue(['VIP']);
    libraryMod.getAlbumPhotos.mockResolvedValue([photo('x.jpg', { gps: { lat: 1, lng: 2 } })]);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'VIP', visibility: 'restricted' }] })
      .mockResolvedValueOnce({ rows: [] });
    database._setState({ query: mockQuery }, true);
    vi.spyOn(authMod, 'getSessionUser').mockResolvedValue({ id: 1, role: 'admin' });
    const res = await request(app).get('/api/map').set('Cookie', 'pb_session=' + 'a'.repeat(64));
    expect(res.body.map((p) => p.album)).toEqual(['VIP']);
  });

  it('inclut les albums restricted pour un utilisateur basic autorisé', async () => {
    libraryMod.listAlbums.mockResolvedValue(['VIP']);
    libraryMod.getAlbumPhotos.mockResolvedValue([photo('x.jpg', { gps: { lat: 1, lng: 2 } })]);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'VIP', visibility: 'restricted' }] })
      .mockResolvedValueOnce({ rows: [{ album: 'VIP' }] }); // user 5 authorized
    database._setState({ query: mockQuery }, true);
    vi.spyOn(authMod, 'getSessionUser').mockResolvedValue({ id: 5, role: 'basic' });
    const res = await request(app).get('/api/map').set('Cookie', 'pb_session=' + 'a'.repeat(64));
    expect(res.body.map((p) => p.album)).toEqual(['VIP']);
  });

  it("retourne 500 si l'index échoue", async () => {
    libraryMod.listAlbums.mockRejectedValue(new Error('disk error'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/map');
    expect(res.status).toBe(500);
  });
});

// ── POST /api/push/subscribe ──────────────────────────────────────────────────

describe('POST /api/push/subscribe', () => {
  beforeEach(() => stubLibrary({}));

  afterEach(() => vi.restoreAllMocks());

  const validBody = {
    album: 'Paris',
    subscription: { endpoint: 'https://push.example/ep', keys: { p256dh: 'k', auth: 'a' } },
  };

  it('retourne 400 si champs manquants', async () => {
    const res = await request(app).post('/api/push/subscribe').send({ album: 'Paris' });
    expect(res.status).toBe(400);
  });

  it('retourne 404 si l\'album n\'existe pas sur disque', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    database._setState({ query: mockQuery }, true);
    const res = await request(app).post('/api/push/subscribe').send(validBody);
    expect(res.status).toBe(404);
  });

  it('retourne 401 sur album restreint sans utilisateur ni share token', async () => {
    stubLibrary({ Paris: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }); // album_settings
    database._setState({ query: mockQuery }, true);
    const res = await request(app).post('/api/push/subscribe').send(validBody);
    expect(res.status).toBe(401);
  });

  it('accepte l\'abonnement sur album public', async () => {
    stubLibrary({ Paris: [] });
    mockQuery.mockResolvedValue({ rows: [] }); // visibility public + INSERT
    database._setState({ query: mockQuery }, true);
    const res = await request(app).post('/api/push/subscribe').send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const sqls = mockQuery.mock.calls.map(c => c[0]);
    expect(sqls.some(s => s.includes('INSERT INTO push_subscriptions'))).toBe(true);
  });

  it('accepte l\'abonnement sur album restreint avec share token valide', async () => {
    stubLibrary({ Paris: [] });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] })                     // share_tokens
      .mockResolvedValueOnce({ rows: [] });                            // INSERT
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/push/subscribe')
      .send({ ...validBody, share: 'tok123' });
    expect(res.status).toBe(200);
  });
});

describe('security headers', () => {
  it('sends the origin as Referer cross-site (OSM tile usage policy), never the full URL', async () => {
    const res = await request(app).get('/login.html');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});

describe('GET /version.json', () => {
  afterEach(() => { delete process.env.APP_ENV; });

  it('reports production when APP_ENV is unset, never cached', async () => {
    delete process.env.APP_ENV;
    const res = await request(app).get('/version.json');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ env: 'production' });
    expect(typeof res.body.sha).toBe('string');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reports the QA environment from APP_ENV', async () => {
    process.env.APP_ENV = 'qa';
    const res = await request(app).get('/version.json');
    expect(res.body.env).toBe('qa');
  });
});

// ── /api/search (F6) ──────────────────────────────────────────────────────────

describe('GET /api/search', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cherche dans les albums visibles, avec titres modifiés et lieux du cache', async () => {
    vi.spyOn(libraryMod, 'listAlbums').mockResolvedValue(['Porto', 'Secret']);
    vi.spyOn(libraryMod, 'getAlbumPhotos').mockImplementation(async (album) => [
      { filename: `${album}.jpg`, type: 'photo', name: album, description: '', location: null,
        gps: { lat: 41.14, lng: -8.61 }, takenAt: '2024-06-14T21:00:00.000Z', exif: null, url: `/photos/${album}/${album}.jpg`, thumbUrl: null },
    ]);
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM album_settings')) return { rows: [{ album: 'Secret', visibility: 'restricted' }] };
      if (sql.includes('photo_overrides')) return { rows: [{ album: 'Porto', filename: 'Porto.jpg', title: 'Ribeira', description: null, location: null }] };
      if (sql.includes('place_cache')) return { rows: [{ location: 'Porto, Portugal' }] };
      return { rows: [] };
    });
    database._setState({ query: mockQuery }, true);

    const res = await request(app).get('/api/search?q=ribeira%20portugal');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results[0]).toMatchObject({ album: 'Porto', name: 'Ribeira', location: 'Porto, Portugal' });
    expect(res.body.facets.albums).toEqual(['Porto']);   // the restricted album is not searched
  });

  it('400 sur une date invalide', async () => {
    const res = await request(app).get('/api/search?from=hier');
    expect(res.status).toBe(400);
  });
});

describe('chemins d\'album invalides (F8)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('répond 400 sans journaliser d\'erreur serveur', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const url of ['/api/albums/..%2F..%2Fetc', '/api/albums/..%2F..%2Fetc/cover', '/api/albums/..%2F..%2Fetc/download/zip']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(400);
      expect(res.body.error).toBe('Invalid album');
    }
    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe('CSP (T6)', () => {
  it('chaque réponse porte la politique, et /api/csp-report accepte les rapports', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'.*script-src 'self' 'sha256-/);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await request(app).post('/api/csp-report').set('Content-Type', 'application/csp-report')
      .send(JSON.stringify({ 'csp-report': { 'effective-directive': 'connect-src', 'blocked-uri': 'https://x.test', 'document-uri': 'http://l/map.html' } }));
    expect(r.status).toBe(204);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('CSP violation: connect-src'));
    errSpy.mockRestore();
  });

  it('sert les bibliothèques sous /vendor/ depuis node_modules sans build', async () => {
    const res = await request(app).get('/vendor/leaflet/leaflet.js');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Leaflet/);
    expect((await request(app).get('/vendor/three/addons/lines/LineMaterial.js')).status).toBe(200);
  });
});

// ── GET /api/share/:token ─────────────────────────────────────────────────────

describe('GET /api/share/:token', () => {
  afterEach(() => vi.restoreAllMocks());

  it('503 sans DB, 404 si jeton inconnu ou expiré, sinon l\'album', async () => {
    expect((await request(app).get('/api/share/abc')).status).toBe(503);
    database._setState({ query: mockQuery }, true);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await request(app).get('/api/share/abc')).status).toBe(404);
    mockQuery.mockResolvedValueOnce({ rows: [{ album: 'Paris', expires_at: '2026-12-01T00:00:00.000Z' }] });
    const res = await request(app).get('/api/share/abc');
    expect(res.body).toEqual({ album: 'Paris', expires_at: '2026-12-01T00:00:00.000Z' });
    expect(mockQuery.mock.calls.at(-1)[0]).toMatch(/expires_at > NOW\(\)/);
  });

  it('500 si la base échoue', async () => {
    database._setState({ query: mockQuery }, true);
    mockQuery.mockRejectedValueOnce(new Error('db'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await request(app).get('/api/share/abc')).status).toBe(500);
  });
});

// ── /api/push: VAPID key and unsubscribe ──────────────────────────────────────

describe('/api/push — clé VAPID et désabonnement', () => {
  const pushMod = _require('../../../services/push.js');
  afterEach(() => vi.restoreAllMocks());

  it('GET vapid-key : 503 tant que les clés ne sont pas prêtes, puis la clé publique', async () => {
    vi.spyOn(pushMod, 'getVapidPublicKey').mockReturnValue(null);
    expect((await request(app).get('/api/push/vapid-key')).status).toBe(503);
    pushMod.getVapidPublicKey.mockReturnValue('BPub');
    expect((await request(app).get('/api/push/vapid-key')).body).toEqual({ publicKey: 'BPub' });
  });

  it('POST subscribe : 503 sans DB', async () => {
    const res = await request(app).post('/api/push/subscribe')
      .send({ album: 'Paris', subscription: { endpoint: 'e', keys: { p256dh: 'k', auth: 'a' } } });
    expect(res.status).toBe(503);
  });

  it('POST subscribe : 500 si l\'enregistrement échoue', async () => {
    stubLibrary({ Paris: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('db'));
    database._setState({ query: mockQuery }, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).post('/api/push/subscribe')
      .send({ album: 'Paris', subscription: { endpoint: 'e', keys: { p256dh: 'k', auth: 'a' } } });
    expect(res.status).toBe(500);
  });

  it('DELETE subscribe : 400, 503, puis suppression de cet abonnement', async () => {
    expect((await request(app).delete('/api/push/subscribe').send({ album: 'Paris' })).status).toBe(400);
    expect((await request(app).delete('/api/push/subscribe').send({ album: 'Paris', endpoint: 'e' })).status).toBe(503);
    database._setState({ query: mockQuery }, true);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await request(app).delete('/api/push/subscribe').send({ album: 'Paris', endpoint: 'e' })).body).toEqual({ ok: true });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM push_subscriptions'), ['Paris', 'e']);
    mockQuery.mockRejectedValueOnce(new Error('db'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await request(app).delete('/api/push/subscribe').send({ album: 'Paris', endpoint: 'e' })).status).toBe(500);
  });
});

// ── GET /api/albums/:album/download/zip ───────────────────────────────────────

describe('GET /api/albums/:album/download/zip', () => {
  afterEach(() => vi.restoreAllMocks());

  it('404 si l\'album n\'existe pas ou est vide', async () => {
    stubLibrary({ Vide: [] });
    expect((await request(app).get('/api/albums/Nope/download/zip')).status).toBe(404);
    const res = await request(app).get('/api/albums/Vide/download/zip');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Album is empty');
  });

  it('401 sur un album restreint, 503 si le contrôle d\'accès échoue (fail-closed)', async () => {
    stubLibrary({ Secret: ['a.jpg'] });
    database._setState({ query: mockQuery }, true);
    mockQuery.mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] });
    expect((await request(app).get('/api/albums/Secret/download/zip')).status).toBe(401);
    mockQuery.mockRejectedValueOnce(new Error('db'));
    expect((await request(app).get('/api/albums/Secret/download/zip')).status).toBe(503);
  });

  it('renvoie une archive zip nommée d\'après l\'album (accents encodés)', async () => {
    stubLibrary({ 'Été à Évora': ['a.jpg'] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app).get(`/api/albums/${encodeURIComponent('Été à Évora')}/download/zip`)
      .buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="_t_ _ _vora.zip"; filename*=UTF-8''${encodeURIComponent('Été à Évora')}.zip`);
    expect(res.body.subarray(0, 2).toString()).toBe('PK');
  });
});

// ── GPS position privacy (F10) ────────────────────────────────────────────────

describe('confidentialité de la position GPS (F10)', () => {
  const geo = (filename, lat, lng) => ({ filename, url: `/photos/A/${filename}`, gps: { lat, lng }, takenAt: null });
  // album_settings answers: Approx is rounded, Hidden has no position, Open is exact
  const settings = async (sql) => (sql.includes('gps_privacy')
    ? { rows: [{ album: 'Approx', gps_privacy: 'approx' }, { album: 'Hidden', gps_privacy: 'hidden' }] }
    : { rows: [] });

  beforeEach(() => {
    stubLibrary({ Approx: ['a.jpg'], Hidden: ['h.jpg'], Open: ['o.jpg'] });
    libraryMod.getAlbumPhotos.mockImplementation(async (album) => [geo(`${album[0].toLowerCase()}.jpg`, 48.858370, 2.294481)]);
    mockQuery.mockImplementation(settings);
    database._setState({ query: mockQuery }, true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('album : position arrondie ou retirée pour un visiteur', async () => {
    expect((await request(app).get('/api/albums/Approx')).body.photos[0]).toMatchObject({ gps: { lat: 48.86, lng: 2.29 }, gpsApprox: true });
    expect((await request(app).get('/api/albums/Hidden')).body.photos[0].gps).toBeNull();
    expect((await request(app).get('/api/albums/Open')).body.photos[0].gps).toEqual({ lat: 48.858370, lng: 2.294481 });
  });

  it('album : un admin voit la position exacte', async () => {
    vi.spyOn(authMod, 'getSessionUser').mockResolvedValue({ id: 1, role: 'admin' });
    const res = await request(app).get('/api/albums/Hidden').set('Cookie', 'pb_session=' + 'a'.repeat(64));
    expect(res.body.photos[0].gps).toEqual({ lat: 48.858370, lng: 2.294481 });
  });

  it('carte : albums masqués absents, approximatifs arrondis', async () => {
    const res = await request(app).get('/api/map');
    expect(res.body.map((m) => [m.album, m.gps])).toEqual([
      ['Approx', { lat: 48.86, lng: 2.29 }],
      ['Open', { lat: 48.858370, lng: 2.294481 }],
    ]);
  });
});
