import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../services/image.js', () => ({
  PHOTOS_DIR:     '/test/photos',
  PREVIEWS_DIR:   '/test/previews',
  MEDIUM_DIR:     '/test/medium',
  isImage:        f => ['.jpg', '.jpeg', '.png'].some(e => f.endsWith(e)),
  isAlbumDir:     e => e.isDirectory?.() ?? false,
  ensurePreview:  vi.fn().mockResolvedValue('/previews/album/photo.jpg'),
  photoMeta:      vi.fn().mockResolvedValue({
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
    renameSync:  vi.fn(),
    rmSync:      vi.fn(),
    unlinkSync:  vi.fn(),
    watch:       vi.fn().mockReturnValue({ close: vi.fn() }),
    statSync:    vi.fn().mockReturnValue({ isDirectory: () => false }),
  };
});

const {
  app,
  watchPhotosDir,
  deletePhotoFromDb,
  deleteAlbumFromDb,
} = await import('../../server.js');

const _require      = createRequire(import.meta.url);
const database      = _require('../../services/database.js');
const authMod       = _require('../../services/auth.js');
const dockerInfoMod = _require('../../services/docker-info.js');
const fsMod         = _require('fs');

authMod._setBypass(true);

const mockQuery = vi.fn();

beforeEach(() => {
  database._reset();
  mockQuery.mockReset();
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 503 si la DB n\'est pas prête', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'pass' });
    expect(res.status).toBe(503);
  });

  it('retourne 400 si username manquant', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'pass' });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si password manquant', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin' });
    expect(res.status).toBe(400);
  });

  it('retourne 401 si les credentials sont invalides', async () => {
    database._setState({ query: mockQuery }, true);
    vi.spyOn(authMod, 'login').mockResolvedValue(null);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('retourne 200 avec un cookie session si login réussi', async () => {
    database._setState({ query: mockQuery }, true);
    vi.spyOn(authMod, 'login').mockResolvedValue('fake64hextoken');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'correct' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const cookie = res.headers['set-cookie'];
    expect(cookie).toBeDefined();
    expect(cookie[0]).toContain('pb_session');
  });

  it('retourne 500 si auth.login lève une exception', async () => {
    database._setState({ query: mockQuery }, true);
    vi.spyOn(authMod, 'login').mockRejectedValue(new Error('db crash'));
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'pass' });
    expect(res.status).toBe(500);
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 200 même sans cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('supprime la session si cookie présent et DB prête', async () => {
    database._setState({ query: mockQuery }, true);
    const logoutSpy = vi.spyOn(authMod, 'logout').mockResolvedValue();
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'pb_session=sometoken');
    expect(res.status).toBe(200);
    expect(logoutSpy).toHaveBeenCalledWith('sometoken');
    const cookie = res.headers['set-cookie'];
    expect(cookie[0]).toContain('pb_session=;');
  });

  it('ne plante pas si DB non prête et cookie présent', async () => {
    // dbReady = false (reset in beforeEach)
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'pb_session=sometoken');
    expect(res.status).toBe(200);
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne { user: null } si DB non prête', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('retourne { user: null } si pas de cookie', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/auth/me');
    expect(res.body.user).toBeNull();
  });

  it('retourne { user: null } si session expirée ou invalide', async () => {
    database._setState({ query: mockQuery }, true);
    vi.spyOn(authMod, 'getSessionUser').mockResolvedValue(null);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'pb_session=badtoken');
    expect(res.body.user).toBeNull();
  });

  it('retourne username et role si session valide', async () => {
    database._setState({ query: mockQuery }, true);
    vi.spyOn(authMod, 'getSessionUser').mockResolvedValue({
      username: 'admin', role: 'admin',
    });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'pb_session=validtoken');
    expect(res.body.user).toEqual({ username: 'admin', role: 'admin' });
  });
});

// ── GET /api/admin/stats ──────────────────────────────────────────────────────

describe('GET /api/admin/stats', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne { albums: [] } si PHOTOS_DIR absent', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body.albums).toEqual([]);
  });

  it('retourne les albums depuis le filesystem sans DB', async () => {
    const albumDir = { name: 'Paris', isDirectory: () => true };
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync')
      .mockReturnValueOnce([albumDir])   // PHOTOS_DIR listing
      .mockReturnValueOnce(['a.jpg', 'b.jpg']); // album contents
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body.albums).toHaveLength(1);
    expect(res.body.albums[0]).toMatchObject({ album: 'Paris', photos: 2, views: 0, likes: 0 });
  });

  it('enrichit avec les stats DB si prête', async () => {
    const albumDir = { name: 'Rome', isDirectory: () => true };
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync')
      .mockReturnValueOnce([albumDir])
      .mockReturnValueOnce(['x.jpg']);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'Rome', views: '10' }] })
      .mockResolvedValueOnce({ rows: [{ album: 'Rome', likes: '3' }] })
      .mockResolvedValueOnce({ rows: [] });  // album_settings
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/admin/stats');
    expect(res.body.albums[0]).toMatchObject({ album: 'Rome', photos: 1, views: 10, likes: 3 });
  });

  it('trie par vues décroissantes', async () => {
    const dirs = [
      { name: 'A', isDirectory: () => true },
      { name: 'B', isDirectory: () => true },
    ];
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync')
      .mockReturnValueOnce(dirs)
      .mockReturnValueOnce([])    // A: 0 photos
      .mockReturnValueOnce([]);   // B: 0 photos
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'A', views: '5' }, { album: 'B', views: '20' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });  // album_settings
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/admin/stats');
    expect(res.body.albums[0].album).toBe('B');
    expect(res.body.albums[1].album).toBe('A');
  });

  it('retourne 500 si readdirSync lève une exception', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync').mockImplementation(() => { throw new Error('disk error'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(500);
  });
});

// ── GET /api/admin/system ─────────────────────────────────────────────────────

describe('GET /api/admin/system', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne node, uptime et containers', async () => {
    vi.spyOn(dockerInfoMod, 'getContainers').mockResolvedValue([
      { id: 'abc123', name: 'photo-book', image: 'myimage', status: 'Up', state: 'running', tags: [], digest: null },
    ]);
    const res = await request(app).get('/api/admin/system');
    expect(res.status).toBe(200);
    expect(res.body.node).toBe(process.version);
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.containers).toHaveLength(1);
    expect(res.body.containers[0].name).toBe('photo-book');
  });

  it('retourne containers vide si Docker indisponible', async () => {
    vi.spyOn(dockerInfoMod, 'getContainers').mockRejectedValue(new Error('socket unavailable'));
    const res = await request(app).get('/api/admin/system');
    expect(res.status).toBe(200);
    expect(res.body.containers).toEqual([]);
  });
});

// ── GET /api/admin/top-photos ─────────────────────────────────────────────────

describe('GET /api/admin/top-photos', () => {
  it('retourne { photos: [] } si DB non prête', async () => {
    const res = await request(app).get('/api/admin/top-photos');
    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual([]);
  });

  it('retourne les photos triées par vues avec likes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { album: 'Paris', filename: 'a.jpg', views: '15' },
        { album: 'Rome',  filename: 'b.jpg', views: '8'  },
      ]})
      .mockResolvedValueOnce({ rows: [
        { album: 'Paris', filename: 'a.jpg', likes: '4' },
      ]});
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/admin/top-photos');
    expect(res.status).toBe(200);
    expect(res.body.photos).toHaveLength(2);
    expect(res.body.photos[0]).toMatchObject({ album: 'Paris', filename: 'a.jpg', views: 15, likes: 4 });
    expect(res.body.photos[1]).toMatchObject({ album: 'Rome',  filename: 'b.jpg', views: 8,  likes: 0 });
  });

  it('limite à 50 même si ?limit=999', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    database._setState({ query: mockQuery }, true);
    await request(app).get('/api/admin/top-photos?limit=999');
    const [[sql, [limit]]] = mockQuery.mock.calls;
    expect(limit).toBe(50);
  });

  it('utilise limit=10 par défaut', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    database._setState({ query: mockQuery }, true);
    await request(app).get('/api/admin/top-photos');
    const [[sql, [limit]]] = mockQuery.mock.calls;
    expect(limit).toBe(10);
  });

  it('retourne 500 si la requête DB échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db crash'));
    database._setState({ query: mockQuery }, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/admin/top-photos');
    expect(res.status).toBe(500);
  });
});

// ── POST /api/admin/albums ────────────────────────────────────────────────────

describe('POST /api/admin/albums', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 400 si le nom est absent', async () => {
    const res = await request(app).post('/api/admin/albums').send({});
    expect(res.status).toBe(400);
  });

  it('retourne 400 si le nom contient des caractères interdits', async () => {
    const res = await request(app).post('/api/admin/albums').send({ name: '../secret' });
    expect(res.status).toBe(400);
  });

  it('retourne 409 si l\'album existe déjà', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    const res = await request(app).post('/api/admin/albums').send({ name: 'Paris' });
    expect(res.status).toBe(409);
  });

  it('crée le répertoire et retourne 200', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    const mkdirSpy = vi.spyOn(fsMod, 'mkdirSync');
    const res = await request(app).post('/api/admin/albums').send({ name: 'Nouveau' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mkdirSpy).toHaveBeenCalled();
  });

  it('retourne 500 si mkdirSync lève une exception', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    vi.spyOn(fsMod, 'mkdirSync').mockImplementation(() => { throw new Error('disk full'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).post('/api/admin/albums').send({ name: 'Nouveau' });
    expect(res.status).toBe(500);
  });
});

// ── PATCH /api/admin/albums/:album ────────────────────────────────────────────

describe('PATCH /api/admin/albums/:album', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 400 si le nouveau nom est invalide', async () => {
    const res = await request(app)
      .patch('/api/admin/albums/Paris')
      .send({ name: '../hack' });
    expect(res.status).toBe(400);
  });

  it('retourne 404 si l\'album source n\'existe pas', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    const res = await request(app)
      .patch('/api/admin/albums/Inexistant')
      .send({ name: 'Nouveau' });
    expect(res.status).toBe(404);
  });

  it('retourne 409 si le nom cible est déjà pris', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true); // both old and new exist
    const res = await request(app)
      .patch('/api/admin/albums/Paris')
      .send({ name: 'Rome' });
    expect(res.status).toBe(409);
  });

  it('renomme le dossier et met à jour la DB dans une transaction', async () => {
    vi.spyOn(fsMod, 'existsSync')
      .mockReturnValueOnce(true)   // old path exists
      .mockReturnValueOnce(false)  // new path free
      .mockReturnValue(false);     // previews/medium dirs don't exist
    const renameSpy = vi.spyOn(fsMod, 'renameSync').mockImplementation(() => {});
    const clientQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    const clientRelease = vi.fn();
    database._setState({
      query: mockQuery,
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: clientRelease }),
    }, true);
    const res = await request(app)
      .patch('/api/admin/albums/Paris')
      .send({ name: 'London' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    // BEGIN + 5 UPDATEs + COMMIT = 7
    expect(clientQuery).toHaveBeenCalledTimes(7);
    expect(clientRelease).toHaveBeenCalledTimes(1);
  });

  it('renomme sans erreur si DB non prête', async () => {
    vi.spyOn(fsMod, 'existsSync')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValue(false);
    vi.spyOn(fsMod, 'renameSync').mockImplementation(() => {});
    const res = await request(app)
      .patch('/api/admin/albums/Paris')
      .send({ name: 'London' });
    expect(res.status).toBe(200);
  });

  it('renomme également les dossiers previews/medium si existants (ligne 267)', async () => {
    vi.spyOn(fsMod, 'existsSync')
      .mockReturnValueOnce(true)   // old path exists
      .mockReturnValueOnce(false)  // new path free
      .mockReturnValue(true);      // previews + medium dirs exist → renameSync appelé pour eux
    const renameSpy = vi.spyOn(fsMod, 'renameSync').mockImplementation(() => {});
    const res = await request(app)
      .patch('/api/admin/albums/Paris')
      .send({ name: 'London' });
    expect(res.status).toBe(200);
    expect(renameSpy).toHaveBeenCalledTimes(3); // album + previews + medium
  });

  it('retourne 500 si renameSync lève une exception', async () => {
    vi.spyOn(fsMod, 'existsSync')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    vi.spyOn(fsMod, 'renameSync').mockImplementation(() => { throw new Error('disk error'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .patch('/api/admin/albums/Paris')
      .send({ name: 'London' });
    expect(res.status).toBe(500);
  });
});

// ── DELETE /api/admin/albums/:album ───────────────────────────────────────────
// Also covers deleteAlbumFromDb indirectly.

describe('DELETE /api/admin/albums/:album', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 404 si l\'album n\'existe pas', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    const res = await request(app).delete('/api/admin/albums/Ghost');
    expect(res.status).toBe(404);
  });

  it('supprime le répertoire et nettoie la DB (deleteAlbumFromDb)', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    const rmSpy = vi.spyOn(fsMod, 'rmSync');
    mockQuery.mockResolvedValue({ rowCount: 1 });
    database._setState({ query: mockQuery }, true);
    const res = await request(app).delete('/api/admin/albums/Paris');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // album dir + previews + medium
    expect(rmSpy).toHaveBeenCalledTimes(3);
    // 5 DELETE queries (view_log, likes, views, album_users, album_settings) + 1 INSERT activity_log
    expect(mockQuery).toHaveBeenCalledTimes(6);
  });

  it('supprime sans erreur si DB non prête', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'rmSync');
    const res = await request(app).delete('/api/admin/albums/Paris');
    expect(res.status).toBe(200);
  });

  it('supprime également les dossiers previews/medium si existants (ligne 292)', async () => {
    // First existsSync: album dir (true), then previews (true), medium (true)
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    const rmSpy = vi.spyOn(fsMod, 'rmSync').mockImplementation(() => {});
    mockQuery.mockResolvedValue({ rowCount: 1 });
    database._setState({ query: mockQuery }, true);
    const res = await request(app).delete('/api/admin/albums/Paris');
    expect(res.status).toBe(200);
    expect(rmSpy).toHaveBeenCalledTimes(3); // album + previews + medium
  });

  it('retourne 500 si rmSync lève une exception', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'rmSync').mockImplementation(() => { throw new Error('disk error'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).delete('/api/admin/albums/Paris');
    expect(res.status).toBe(500);
  });
});

// ── DELETE /api/admin/albums/:album/photos/:filename ──────────────────────────
// Also covers deletePhotoFromDb indirectly.

describe('DELETE /api/admin/albums/:album/photos/:filename', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 400 si le fichier n\'est pas une image', async () => {
    const res = await request(app).delete('/api/admin/albums/Paris/photos/script.sh');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Not an image');
  });

  it('retourne 404 si la photo n\'existe pas', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    const res = await request(app).delete('/api/admin/albums/Paris/photos/photo.jpg');
    expect(res.status).toBe(404);
  });

  it('supprime le fichier, les previews et nettoie la DB (deletePhotoFromDb)', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    const unlinkSpy = vi.spyOn(fsMod, 'unlinkSync').mockImplementation(() => {});
    mockQuery.mockResolvedValue({ rowCount: 1 });
    database._setState({ query: mockQuery }, true);
    const res = await request(app).delete('/api/admin/albums/Paris/photos/shot.jpg');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // original + preview + medium
    expect(unlinkSpy).toHaveBeenCalledTimes(3);
    // 3 DELETE queries (view_log, likes, views) + 1 INSERT activity_log
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  it('supprime sans preview ni medium si absents', async () => {
    vi.spyOn(fsMod, 'existsSync')
      .mockReturnValueOnce(true)   // original file exists
      .mockReturnValue(false);     // previews/medium don't exist
    const unlinkSpy = vi.spyOn(fsMod, 'unlinkSync').mockImplementation(() => {});
    database._setState({ query: mockQuery }, true);
    mockQuery.mockResolvedValue({ rowCount: 1 });
    const res = await request(app).delete('/api/admin/albums/Paris/photos/shot.jpg');
    expect(res.status).toBe(200);
    expect(unlinkSpy).toHaveBeenCalledTimes(1); // only original
  });

  it('retourne 500 si unlinkSync lève une exception', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'unlinkSync').mockImplementation(() => { throw new Error('disk error'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).delete('/api/admin/albums/Paris/photos/shot.jpg');
    expect(res.status).toBe(500);
  });
});

// ── POST /api/admin/albums/:album/photos (upload) ────────────────────────────

describe('POST /api/admin/albums/:album/photos', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 404 si l\'album n\'existe pas', async () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    const res = await request(app)
      .post('/api/admin/albums/Ghost/photos')
      .attach('photos', Buffer.from('fake'), 'test.jpg');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Album not found');
  });

  it('retourne 400 si multer ne peut pas écrire dans le répertoire', async () => {
    // existsSync=true → dépasse le check 404; multer tente d'écrire dans /test/photos/Paris
    // qui n'existe pas sur le vrai disque → multer appelle le callback avec une erreur ENOENT
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/api/admin/albums/Paris/photos')
      .attach('photos', Buffer.from('fake jpeg'), 'test.jpg');
    expect(res.status).toBe(400);
  });
});

// ── watchPhotosDir ────────────────────────────────────────────────────────────

describe('watchPhotosDir', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ne fait rien si PHOTOS_DIR n\'existe pas', () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    const watchSpy = vi.spyOn(fsMod, 'watch');
    watchPhotosDir();
    expect(watchSpy).not.toHaveBeenCalled();
  });

  it('log un warning et retourne si fs.watch lève une exception', () => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync').mockReturnValue([]);
    vi.spyOn(fsMod, 'watch').mockImplementation(() => { throw new Error('no watcher'); });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    watchPhotosDir();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Photo watcher unavailable'),
      expect.any(String),
    );
  });

  it('installe un watcher sur PHOTOS_DIR et sur chaque album existant', () => {
    const albumDir = { name: 'Paris', isDirectory: () => true };
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync').mockReturnValue([albumDir]);
    const watchSpy = vi.spyOn(fsMod, 'watch').mockReturnValue({ close: vi.fn() });
    watchPhotosDir();
    // one call for PHOTOS_DIR, one for the Paris album
    expect(watchSpy).toHaveBeenCalledTimes(2);
    // first call: PHOTOS_DIR root; second call: album subdir
    expect(watchSpy.mock.calls[1][0]).toContain('Paris');
    expect(watchSpy.mock.calls[0][1]).toBeTypeOf('function');
  });
});

// ── watchPhotosDir — PHOTOS_DIR callback ─────────────────────────────────────

describe('watchPhotosDir — callback PHOTOS_DIR', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  function setupWatchers(albums = []) {
    const cbs = [];
    vi.spyOn(fsMod, 'watch').mockImplementation((_path, cb) => {
      cbs.push(cb);
      return { close: vi.fn() };
    });
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync').mockReturnValue(albums);
    watchPhotosDir();
    return cbs; // cbs[0] = PHOTOS_DIR callback
  }

  it('ignore un name=null', () => {
    const cbs = setupWatchers();
    expect(() => cbs[0]('rename', null)).not.toThrow();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('installe un nouveau watcher si un dossier est créé', async () => {
    vi.useFakeTimers();
    const cbs = setupWatchers();
    vi.spyOn(fsMod, 'statSync').mockReturnValue({ isDirectory: () => true });
    cbs[0]('rename', 'Rome');
    await vi.advanceTimersByTimeAsync(600);
    const watched = fsMod.watch.mock.calls.map(([p]) => p);
    expect(watched.some(p => p.includes('Rome'))).toBe(true);
  });

  it('appelle deleteAlbumFromDb quand un album est supprimé', async () => {
    vi.useFakeTimers();
    const cbs = setupWatchers();
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    mockQuery.mockResolvedValue({ rowCount: 1 });
    database._setState({ query: mockQuery }, true);
    cbs[0]('rename', 'OldAlbum');
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(mockQuery).toHaveBeenCalled();
    const allParams = mockQuery.mock.calls.flatMap(c => c[1] ?? []);
    expect(allParams).toContain('OldAlbum');
  });

  it('ne fait rien si le chemin existe mais n\'est pas un dossier', async () => {
    vi.useFakeTimers();
    const cbs = setupWatchers();
    vi.spyOn(fsMod, 'statSync').mockReturnValue({ isDirectory: () => false });
    cbs[0]('rename', 'file.jpg');
    await vi.advanceTimersByTimeAsync(600);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(fsMod.watch.mock.calls).toHaveLength(1); // only PHOTOS_DIR
  });
});

// ── watchAlbum — album callback ───────────────────────────────────────────────

describe('watchAlbum — callback photo', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  function setupWatchers() {
    const cbs = [];
    vi.spyOn(fsMod, 'watch').mockImplementation((_path, cb) => {
      cbs.push(cb);
      return { close: vi.fn() };
    });
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync').mockReturnValue([
      { name: 'Paris', isDirectory: () => true },
    ]);
    watchPhotosDir();
    return cbs; // cbs[0] = PHOTOS_DIR, cbs[1] = Paris album
  }

  it('ignore un name=null', () => {
    const cbs = setupWatchers();
    expect(() => cbs[1]('rename', null)).not.toThrow();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ignore un fichier non-image', () => {
    const cbs = setupWatchers();
    database._setState({ query: mockQuery }, true);
    cbs[1]('rename', 'thumbs.db');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('déclenche scheduleRegenerate si une image est ajoutée (existsSync=true)', async () => {
    vi.useFakeTimers();
    const cbs = setupWatchers();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    cbs[1]('rename', 'new.jpg');
    await vi.advanceTimersByTimeAsync(2100);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('New photos detected'));
  });

  it('appelle deletePhotoFromDb avec album et filename corrects si une image est supprimée', async () => {
    const cbs = setupWatchers();
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    mockQuery.mockResolvedValue({ rowCount: 1 });
    database._setState({ query: mockQuery }, true);
    cbs[1]('rename', 'old.jpg');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(mockQuery).toHaveBeenCalled();
    const allParams = mockQuery.mock.calls.flatMap(c => c[1] ?? []);
    expect(allParams).toContain('Paris');
    expect(allParams).toContain('old.jpg');
  });
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────

describe('GET /api/admin/users', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne la liste des utilisateurs', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, username: 'admin', role: 'admin', created_at: '2024-01-01' },
        { id: 2, username: 'alice', role: 'basic', created_at: '2024-01-02' },
      ],
    });
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    expect(res.body.users[0].username).toBe('admin');
    expect(res.body.users[1].username).toBe('alice');
  });

  it('retourne 500 si la requête DB échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db crash'));
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(500);
  });
});

// ── POST /api/admin/users ─────────────────────────────────────────────────────

describe('POST /api/admin/users', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 400 si username ou password manquant', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/admin/users')
      .send({ username: 'alice' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password are required');
  });

  it('retourne 400 si le rôle est invalide', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/admin/users')
      .send({ username: 'alice', password: 'pass', role: 'superuser' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Role must be admin or basic');
  });

  it('retourne 400 si le mot de passe ne respecte pas la politique', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/admin/users')
      .send({ username: 'alice', password: 'weak', role: 'basic' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uppercase|lowercase|digit|special|characters/i);
  });

  it('retourne 409 si le username est déjà pris', async () => {
    const dupErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    mockQuery.mockRejectedValueOnce(dupErr);
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/admin/users')
      .send({ username: 'admin', password: 'Valid1@pass', role: 'basic' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Username already taken');
  });

  it('retourne 201 avec l\'utilisateur créé', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 3, username: 'alice', role: 'basic', created_at: '2024-01-03' }],
    });
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .post('/api/admin/users')
      .send({ username: 'alice', password: 'Valid1@pass', role: 'basic' });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('alice');
    expect(res.body.user.role).toBe('basic');
  });

  it('retourne 500 si la requête DB échoue avec une erreur autre que doublon', async () => {
    mockQuery.mockRejectedValueOnce(new Error('generic db error'));
    database._setState({ query: mockQuery }, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/api/admin/users')
      .send({ username: 'alice', password: 'Valid1@pass', role: 'basic' });
    expect(res.status).toBe(500);
  });
});

// ── PATCH /api/admin/users/:id ────────────────────────────────────────────────

describe('PATCH /api/admin/users/:id', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 400 si l\'id est invalide', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .patch('/api/admin/users/abc')
      .send({ role: 'basic' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid user id');
  });

  it('retourne 404 si l\'utilisateur n\'existe pas', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT username
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .patch('/api/admin/users/99')
      .send({ role: 'basic' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('retourne 403 si on tente de changer le rôle de admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ username: 'admin' }] }); // SELECT username
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .patch('/api/admin/users/1')
      .send({ role: 'basic' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('The admin user role cannot be changed');
  });

  it('retourne 400 si le rôle fourni est invalide (ligne 411)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ username: 'alice' }] }); // SELECT username
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .patch('/api/admin/users/2')
      .send({ role: 'superuser' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Role must be admin or basic');
  });

  it('retourne 400 si rien à mettre à jour', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ username: 'alice' }] }); // SELECT username
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .patch('/api/admin/users/2')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nothing to update');
  });

  it('retourne 400 si le nouveau mot de passe est trop faible', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ username: 'alice' }] });
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .patch('/api/admin/users/2')
      .send({ password: 'weak' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uppercase|lowercase|digit|special|characters/i);
  });

  it('met à jour le mot de passe si fourni (ligne 417)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ username: 'alice' }] }) // SELECT username
      .mockResolvedValueOnce({ rowCount: 1 });                  // UPDATE
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .patch('/api/admin/users/2')
      .send({ password: 'NewPass1@test' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const updateCall = mockQuery.mock.calls[1][0];
    expect(updateCall).toContain('password_hash');
  });

  it('retourne 404 si l\'UPDATE ne trouve aucune ligne (ligne 423)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ username: 'alice' }] }) // SELECT username
      .mockResolvedValueOnce({ rowCount: 0 });                  // UPDATE → no row updated
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .patch('/api/admin/users/2')
      .send({ role: 'admin' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('retourne 200 ok si la mise à jour réussit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ username: 'alice' }] }) // SELECT username
      .mockResolvedValueOnce({ rowCount: 1 });                  // UPDATE
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .patch('/api/admin/users/2')
      .send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('retourne 500 si la requête DB échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db crash'));
    database._setState({ query: mockQuery }, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .patch('/api/admin/users/2')
      .send({ role: 'admin' });
    expect(res.status).toBe(500);
  });
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────

describe('DELETE /api/admin/users/:id', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 400 si l\'id est invalide', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app).delete('/api/admin/users/xyz');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid user id');
  });

  it('retourne 404 si l\'utilisateur n\'existe pas', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT username
    database._setState({ query: mockQuery }, true);
    const res = await request(app).delete('/api/admin/users/99');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('retourne 403 si on tente de supprimer admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ username: 'admin' }] }); // SELECT username
    database._setState({ query: mockQuery }, true);
    const res = await request(app).delete('/api/admin/users/1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('The admin user cannot be deleted');
  });

  it('retourne 200 ok si la suppression réussit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ username: 'alice' }] }) // SELECT username
      .mockResolvedValueOnce({ rowCount: 1 });                  // DELETE
    database._setState({ query: mockQuery }, true);
    const res = await request(app).delete('/api/admin/users/2');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('retourne 500 si la requête DB échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db crash'));
    database._setState({ query: mockQuery }, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).delete('/api/admin/users/2');
    expect(res.status).toBe(500);
  });
});

// ── GET /api/admin/albums/:album/settings ─────────────────────────────────────

describe('GET /api/admin/albums/:album/settings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne les valeurs par défaut si DB non prête', async () => {
    // database._reset() in beforeEach → dbReady = false
    const res = await request(app).get('/api/admin/albums/Paris/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ visibility: 'public', users: [] });
  });

  it('retourne visibility public et users vides si aucune entrée en DB', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // album_settings
      .mockResolvedValueOnce({ rows: [] }); // album_users
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/admin/albums/Paris/settings');
    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe('public');
    expect(res.body.users).toEqual([]);
  });

  it('retourne visibility et liste d\'utilisateurs depuis la DB', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] })   // album_settings
      .mockResolvedValueOnce({ rows: [{ id: 2, username: 'alice' }] });   // album_users
    database._setState({ query: mockQuery }, true);
    const res = await request(app).get('/api/admin/albums/Paris/settings');
    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe('restricted');
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].username).toBe('alice');
  });

  it('retourne 500 si la requête DB échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db crash'));
    database._setState({ query: mockQuery }, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/admin/albums/Paris/settings');
    expect(res.status).toBe(500);
  });
});

// ── PUT /api/admin/albums/:album/settings ─────────────────────────────────────

describe('PUT /api/admin/albums/:album/settings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retourne 400 si visibility est invalide', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .put('/api/admin/albums/Paris/settings')
      .send({ visibility: 'private' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('visibility must be public or restricted');
  });

  it('retourne 400 si userIds contient une valeur non entière', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .put('/api/admin/albums/Paris/settings')
      .send({ visibility: 'restricted', userIds: [1, 'abc'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid userIds');
  });

  it('retourne 400 si userIds n\'est pas un tableau', async () => {
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .put('/api/admin/albums/Paris/settings')
      .send({ visibility: 'restricted', userIds: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid userIds');
  });

  it('retourne 503 si DB non prête', async () => {
    // database._reset() in beforeEach → dbReady = false
    const res = await request(app)
      .put('/api/admin/albums/Paris/settings')
      .send({ visibility: 'public' });
    expect(res.status).toBe(503);
  });

  it('retourne 200 ok avec visibility public et sans userIds', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT album_settings
      .mockResolvedValueOnce({ rowCount: 0 }); // DELETE album_users
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .put('/api/admin/albums/Paris/settings')
      .send({ visibility: 'public' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('retourne 200 ok avec restricted et userIds', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT album_settings
      .mockResolvedValueOnce({ rowCount: 2 }) // DELETE album_users
      .mockResolvedValueOnce({ rowCount: 2 }); // INSERT album_users
    database._setState({ query: mockQuery }, true);
    const res = await request(app)
      .put('/api/admin/albums/Paris/settings')
      .send({ visibility: 'restricted', userIds: [2, 3] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('retourne 500 si la requête DB échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db crash'));
    database._setState({ query: mockQuery }, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .put('/api/admin/albums/Paris/settings')
      .send({ visibility: 'public' });
    expect(res.status).toBe(500);
  });
});

// ── DELETE /api/albums/:album/photos/:filename ────────────────────────────────

describe('DELETE /api/albums/:album/photos/:filename', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    authMod._setTestUser(null);
  });

  it('retourne 403 si req.user est undefined (album public, canDelete=false)', async () => {
    // bypass=true but no test user → req.user=undefined
    // getAlbumAccess: DB not ready → visibility='public', canDelete = undefined?.role==='admin' = false
    const res = await request(app).delete('/api/albums/Paris/photos/photo.jpg');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('retourne 403 si album restricted et utilisateur non autorisé', async () => {
    authMod._setTestUser({ id: 5, role: 'basic' });
    // DB ready: album_settings → restricted; album_users → user 5 not in list
    mockQuery
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }) // getAlbumVisibility
      .mockResolvedValueOnce({ rows: [] });                             // isUserAuthorizedForAlbum
    database._setState({ query: mockQuery }, true);
    const res = await request(app).delete('/api/albums/Paris/photos/photo.jpg');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('retourne 200 ok quand admin supprime une photo existante', async () => {
    authMod._setTestUser({ id: 1, role: 'admin' });
    // getAlbumAccess: visibility='public' → canDelete = 'admin'==='admin' = true
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getAlbumVisibility (public by default)
    database._setState({ query: mockQuery }, true);
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'unlinkSync').mockImplementation(() => {});
    mockQuery.mockResolvedValue({ rowCount: 1 }); // deletePhotoFromDb queries
    const res = await request(app).delete('/api/albums/Paris/photos/photo.jpg');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('retourne 404 si le fichier n\'existe pas (admin)', async () => {
    authMod._setTestUser({ id: 1, role: 'admin' });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getAlbumVisibility (public)
    database._setState({ query: mockQuery }, true);
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(false);
    const res = await request(app).delete('/api/albums/Paris/photos/missing.jpg');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Photo not found');
  });

  it('retourne 400 si le fichier n\'est pas une image (route utilisateur)', async () => {
    authMod._setTestUser({ id: 1, role: 'admin' });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getAlbumVisibility (public)
    database._setState({ query: mockQuery }, true);
    const res = await request(app).delete('/api/albums/Paris/photos/script.sh');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Not an image');
  });

  it('retourne 500 si une exception est levée (route utilisateur, catch ligne 322)', async () => {
    authMod._setTestUser({ id: 1, role: 'admin' });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getAlbumVisibility
    database._setState({ query: mockQuery }, true);
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'unlinkSync').mockImplementation(() => { throw new Error('disk error'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).delete('/api/albums/Paris/photos/photo.jpg');
    expect(res.status).toBe(500);
  });
});
