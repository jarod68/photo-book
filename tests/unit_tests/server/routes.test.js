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
const exifrMod  = _require('exifr'); // real module — we will use vi.spyOn

// Bypass auth for all route tests (vi.mock cannot intercept CJS require)
authMod._setBypass(true);

const mockQuery = vi.fn();

beforeEach(() => {
  database._reset();
  mockQuery.mockReset();
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
    const albumDir = { name: 'Paris', isDirectory: () => true };
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync')
      .mockReturnValueOnce([albumDir]) // PHOTOS_DIR listing
      .mockReturnValueOnce([]);        // Paris album contents
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

  it('exclut un album restricted quand aucun utilisateur authentifié', async () => {
    const dirs = [
      { name: 'Public', isDirectory: () => true },
      { name: 'Secret', isDirectory: () => true },
    ];
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync')
      .mockReturnValueOnce(dirs)   // PHOTOS_DIR listing
      .mockReturnValueOnce([]);    // Public album contents
    // Secret is filtered before readdirSync is called for it
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'Secret', visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [] }); // album_users
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/albums');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Public');
  });

  it('retourne 500 si readdirSync lève une exception', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync').mockImplementation(() => { throw new Error('disk error'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/albums');
    expect(res.status).toBe(500);
  });

  it('inclut les albums restricted pour un utilisateur admin (ligne 526)', async () => {
    const dirs = [{ name: 'VIP', isDirectory: () => true }];
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync')
      .mockReturnValueOnce(dirs)  // PHOTOS_DIR listing
      .mockReturnValueOnce([]);   // VIP album contents
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
    const dirs = [{ name: 'VIP', isDirectory: () => true }];
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync')
      .mockReturnValueOnce(dirs)  // PHOTOS_DIR listing
      .mockReturnValueOnce([]);   // VIP album contents
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
      .mockResolvedValueOnce({ rows: [] })  // getAlbumVisibility (album_settings)
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

  it('retourne canDelete false quand DB prête et aucun utilisateur (album public)', async () => {
    fsMod.existsSync.mockReturnValue(true);
    fsMod.readdirSync.mockReturnValue(['photo.jpg']);
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
    fsMod.existsSync.mockReturnValue(true);
    fsMod.readdirSync.mockReturnValue(['photo.jpg']);
    mockQuery.mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }); // getAlbumVisibility
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(401);
  });

  it('retourne 503 (fail-closed) si getAlbumAccess lève une exception', async () => {
    fsMod.existsSync.mockReturnValue(true);
    fsMod.readdirSync.mockReturnValue(['photo.jpg']);
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(503);
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

  it('filtre un album restricted quand DB prête et aucun utilisateur authentifié', async () => {
    const restrictedDir = { name: 'Secret', isDirectory: () => true };
    fsMod.existsSync.mockReturnValue(true);
    fsMod.readdirSync.mockReturnValueOnce([restrictedDir]);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'Secret', visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [] }); // album_users (no basic user)
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/map');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('retourne 500 si readdirSync lève une exception', async () => {
    fsMod.existsSync.mockReturnValue(true);
    fsMod.readdirSync.mockImplementation(() => { throw new Error('disk error'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/map');
    expect(res.status).toBe(500);
  });

  it('inclut les albums restricted pour un utilisateur admin (ligne 613)', async () => {
    const restrictedDir = { name: 'VIP', isDirectory: () => true };
    fsMod.existsSync.mockReturnValue(true);
    fsMod.readdirSync
      .mockReturnValueOnce([restrictedDir])
      .mockReturnValueOnce([]); // album has no photos
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'VIP', visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [] }); // album_users (admin: role check only, no user_id query)
    database._setState({ query: mockQuery }, true);
    vi.spyOn(authMod, 'getSessionUser').mockResolvedValue({ id: 1, role: 'admin' });
    const res = await request(app)
      .get('/api/map')
      .set('Cookie', 'pb_session=' + 'a'.repeat(64));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]); // album included but no GPS photos → empty flat
  });

  it('inclut les albums restricted pour un utilisateur basic autorisé (ligne 614)', async () => {
    const restrictedDir = { name: 'VIP', isDirectory: () => true };
    fsMod.existsSync.mockReturnValue(true);
    fsMod.readdirSync
      .mockReturnValueOnce([restrictedDir])
      .mockReturnValueOnce([]); // album has no photos
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'VIP', visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [{ album: 'VIP' }] }); // album_users: user 5 authorized
    database._setState({ query: mockQuery }, true);
    vi.spyOn(authMod, 'getSessionUser').mockResolvedValue({ id: 5, role: 'basic' });
    const res = await request(app)
      .get('/api/map')
      .set('Cookie', 'pb_session=' + 'a'.repeat(64));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]); // authorized but no GPS photos
  });

  it('date est null si exifr.parse lève une exception (catch ligne 628)', async () => {
    fsMod.existsSync
      .mockReturnValueOnce(true)   // PHOTOS_DIR exists
      .mockReturnValue(false);     // preview absent
    fsMod.readdirSync
      .mockReturnValueOnce([albumDir])
      .mockReturnValueOnce(['img.jpg']);
    exifrMod.gps.mockResolvedValue({ latitude: 48.8566, longitude: 2.3522 });
    exifrMod.parse.mockRejectedValue(new Error('parse failed')); // triggers catch → null
    const res = await request(app).get('/api/map');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].date).toBeNull();
  });
});

// ── POST /api/push/subscribe ──────────────────────────────────────────────────

describe('POST /api/push/subscribe', () => {
  beforeEach(() => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
  });

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
    fsMod.existsSync.mockReturnValue(false);
    mockQuery.mockResolvedValue({ rows: [] });
    database._setState({ query: mockQuery }, true);
    const res = await request(app).post('/api/push/subscribe').send(validBody);
    expect(res.status).toBe(404);
  });

  it('retourne 401 sur album restreint sans utilisateur ni share token', async () => {
    fsMod.existsSync.mockReturnValue(true);
    mockQuery.mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }); // album_settings
    database._setState({ query: mockQuery }, true);
    const res = await request(app).post('/api/push/subscribe').send(validBody);
    expect(res.status).toBe(401);
  });

  it('accepte l\'abonnement sur album public', async () => {
    fsMod.existsSync.mockReturnValue(true);
    mockQuery.mockResolvedValue({ rows: [] }); // visibility public + INSERT
    database._setState({ query: mockQuery }, true);
    const res = await request(app).post('/api/push/subscribe').send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const sqls = mockQuery.mock.calls.map(c => c[0]);
    expect(sqls.some(s => s.includes('INSERT INTO push_subscriptions'))).toBe(true);
  });

  it('accepte l\'abonnement sur album restreint avec share token valide', async () => {
    fsMod.existsSync.mockReturnValue(true);
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
