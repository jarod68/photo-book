import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// /api/me (one's account) and /api/users (seen by others): the real auth
// guard, the profiles service stubbed.

vi.mock('../../../services/image.js', () => ({
  PHOTOS_DIR: '/test/photos', PREVIEWS_DIR: '/test/previews', MEDIUM_DIR: '/test/medium',
  isImage: f => f.endsWith('.jpg'), isMedia: f => f.endsWith('.jpg'), isAlbumDir: e => e.isDirectory?.() ?? false,
  ensurePreview: vi.fn(), photoMeta: vi.fn(), preGenerateAll: vi.fn().mockResolvedValue(undefined), deletePhotoFiles: vi.fn(),
}));
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, existsSync: vi.fn().mockReturnValue(false), mkdirSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]) };
});

const { app } = await import('../../../server.js');
const _require = createRequire(import.meta.url);
const database = _require('../../../services/database.js');
const profiles = _require('../../../services/profiles.js');
const libraryMod = _require('../../../services/library.js');
const fsMod = _require('fs');

const TOKEN = 'c'.repeat(64);
const ANA = { id: 3, username: 'ana', role: 'basic' };
const P = { id: 3, username: 'ana', role: 'basic', displayName: 'Ana', bio: 'Hi', avatarVersion: 42 };
const as = (req) => req.set('Cookie', `pb_session=${TOKEN}`);

beforeEach(() => {
  database._reset();
  database._setState({ query: vi.fn(async (sql) => {
    if (sql.includes('FROM user_sessions')) return { rows: [ANA] };
    if (sql.includes('FROM album_settings')) return { rows: [{ visibility: 'private', owner_id: 9 }] };
    return { rows: [] };
  }) }, true);
});
afterEach(() => vi.restoreAllMocks());

describe('/api/me', () => {
  it('connexion requise', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401);
    expect((await request(app).put('/api/me/password').send({})).status).toBe(401);
  });

  it('lire et changer son profil', async () => {
    vi.spyOn(profiles, 'byId').mockResolvedValue(P);
    const res = await as(request(app).get('/api/me'));
    expect(res.body).toEqual({ username: 'ana', role: 'basic', displayName: 'Ana', bio: 'Hi', avatarUrl: '/api/users/ana/avatar?v=42' });
    const upd = vi.spyOn(profiles, 'update').mockResolvedValue({ ...P, bio: 'Salut' });
    const put = await as(request(app).put('/api/me')).send({ displayName: 'Ana', bio: 'Salut', role: 'admin' });
    expect(put.status).toBe(200);
    expect(upd).toHaveBeenCalledWith(3, { displayName: 'Ana', bio: 'Salut' });   // never the role
  });

  it('photo : envoyée (multipart), ou une photo d’un album permis ; retirée', async () => {
    const set = vi.spyOn(profiles, 'setAvatar').mockResolvedValue(P);
    const up = await as(request(app).put('/api/me/avatar')).attach('avatar', Buffer.from('img'), 'a.png');
    expect(up.status).toBe(200);
    expect(set.mock.calls[0][1]).toEqual(Buffer.from('img'));
    expect((await as(request(app).put('/api/me/avatar'))).status).toBe(400);   // nothing sent
    // an album of someone else, private: no
    expect((await as(request(app).put('/api/me/avatar')).send({ album: 'Theirs', file: 'a.jpg' })).status).toBe(403);
    expect((await as(request(app).put('/api/me/avatar')).send({ album: 'Theirs' })).status).toBe(400);
    const clear = vi.spyOn(profiles, 'clearAvatar').mockResolvedValue(undefined);
    expect((await as(request(app).delete('/api/me/avatar'))).status).toBe(200);
    expect(clear).toHaveBeenCalledWith(3);
  });

  it('photo d’un album : son aperçu, jamais hors du dossier des aperçus', async () => {
    database._setState({ query: vi.fn(async (sql) => {
      if (sql.includes('FROM user_sessions')) return { rows: [ANA] };
      if (sql.includes('FROM album_settings')) return { rows: [{ visibility: 'public', owner_id: null }] };
      return { rows: [] };
    }) }, true);
    vi.spyOn(libraryMod, 'getAlbumPhotos').mockResolvedValue([
      { filename: 'a.jpg', previewUrl: '/previews/A/a.jpg.jpg?v=1' },
      { filename: 'evil.jpg', previewUrl: '/previews/../../etc/passwd' },
    ]);
    const read = vi.spyOn(fsMod.promises, 'readFile').mockResolvedValue(Buffer.from('jpeg'));
    const set = vi.spyOn(profiles, 'setAvatar').mockResolvedValue(P);
    expect((await as(request(app).put('/api/me/avatar')).send({ album: 'A', file: 'a.jpg' })).status).toBe(200);
    const { PREVIEWS_DIR } = _require('../../../services/image.js');   // the real one (CJS require is not mocked)
    expect(read.mock.calls[0][0]).toBe(_require('path').join(PREVIEWS_DIR, 'A', 'a.jpg.jpg'));
    expect(set).toHaveBeenCalledWith(3, Buffer.from('jpeg'));
    expect((await as(request(app).put('/api/me/avatar')).send({ album: 'A', file: 'evil.jpg' })).status).toBe(400);
    expect((await as(request(app).put('/api/me/avatar')).send({ album: 'A', file: 'none.jpg' })).status).toBe(404);
  });

  it('mot de passe : la session courante est gardée', async () => {
    const ch = vi.spyOn(profiles, 'changePassword').mockResolvedValue(undefined);
    const res = await as(request(app).put('/api/me/password')).send({ current: 'a', password: 'b' });
    expect(res.status).toBe(200);
    expect(ch).toHaveBeenCalledWith(3, 'a', 'b', TOKEN);
    ch.mockRejectedValueOnce(Object.assign(new Error('Wrong current password'), { status: 403 }));
    expect((await as(request(app).put('/api/me/password')).send({ current: 'x', password: 'b' })).status).toBe(403);
  });
});

describe('/api/users', () => {
  it('l’annuaire : connecté seulement', async () => {
    vi.spyOn(profiles, 'directory').mockResolvedValue([{ id: 3, username: 'ana', displayName: 'Ana' }]);
    expect((await request(app).get('/api/users')).status).toBe(401);
    expect((await as(request(app).get('/api/users'))).body).toHaveLength(1);
  });

  it('un profil public et sa photo (adresse versionnée : en cache un an)', async () => {
    vi.spyOn(profiles, 'byUsername').mockImplementation(async (u) => (u === 'ana' ? P : null));
    const res = await request(app).get('/api/users/ana');
    expect(res.body).toEqual({ username: 'ana', displayName: 'Ana', bio: 'Hi', avatarUrl: '/api/users/ana/avatar?v=42' });
    expect((await request(app).get('/api/users/nobody')).status).toBe(404);
    vi.spyOn(profiles, 'avatarOf').mockImplementation(async (u) => (u === 'ana' ? { data: Buffer.from('webp'), updatedAt: new Date() } : null));
    const img = await request(app).get('/api/users/ana/avatar?v=42');
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toContain('immutable');
    expect((await request(app).get('/api/users/nobody/avatar')).status).toBe(404);
  });
});
