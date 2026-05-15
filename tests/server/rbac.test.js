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

const { app } = await import('../../server.js');

const _require = createRequire(import.meta.url);
const database = _require('../../services/database.js');
const fsMod    = _require('fs');

// ⚠️  Ne pas appeler authMod._setBypass(true) — ce fichier teste les vraies
//     gardes d'authentification et d'autorisation (requireAuth, requireAdmin).
//
//     requireAuth appelle getSessionUser() via une référence de fonction locale
//     (CJS binding) — vi.spyOn sur l'export ne l'intercepte pas. On contrôle
//     la réponse de getSessionUser en mockant database.db.query à la place.

const TOKEN      = 'a'.repeat(64);
const BASIC_USER = { id: 2, username: 'alice', role: 'basic' };
const ADMIN_USER = { id: 1, username: 'admin', role: 'admin' };
const mockQuery  = vi.fn();

beforeEach(() => {
  database._reset();
  mockQuery.mockReset();
});

afterEach(() => vi.restoreAllMocks());

// ── Helpers ───────────────────────────────────────────────────────────────────

function withCookie(req) {
  return req.set('Cookie', `pb_session=${TOKEN}`);
}

// ── Inventaire des routes /api/admin/* ────────────────────────────────────────

const ADMIN_ROUTES = [
  ['GET',    '/api/admin/stats'],
  ['GET',    '/api/admin/system'],
  ['GET',    '/api/admin/top-photos'],   // requireAuth uniquement — pas requireAdmin
  ['POST',   '/api/admin/albums'],
  ['PATCH',  '/api/admin/albums/Paris'],
  ['DELETE', '/api/admin/albums/Paris'],
  ['POST',   '/api/admin/albums/Paris/photos'],
  ['DELETE', '/api/admin/albums/Paris/photos/photo.jpg'],
  ['GET',    '/api/admin/users'],
  ['POST',   '/api/admin/users'],
  ['PATCH',  '/api/admin/users/2'],
  ['DELETE', '/api/admin/users/2'],
  ['GET',    '/api/admin/albums/Paris/settings'],
  ['PUT',    '/api/admin/albums/Paris/settings'],
];

// Toutes sauf top-photos qui ne porte pas requireAdmin (server.js:210)
const REQUIRE_ADMIN_ROUTES = ADMIN_ROUTES.filter(([, p]) => p !== '/api/admin/top-photos');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Anonymous → 401 sur toutes les routes /api/admin/*
//    Le middleware app.use('/api/admin', requireAuth) doit bloquer toute
//    requête sans cookie de session (aucun appel DB requis).
// ─────────────────────────────────────────────────────────────────────────────

describe('anonymous — /api/admin/* bloqué (401)', () => {
  it.each(ADMIN_ROUTES)('%s %s', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Utilisateur basic → 403 sur les routes avec requireAdmin
//    requireAuth laisse passer (getSessionUser → BASIC_USER via DB mock),
//    requireAdmin doit bloquer (role='basic' ≠ 'admin').
// ─────────────────────────────────────────────────────────────────────────────

describe('basic — routes avec requireAdmin bloquées (403)', () => {
  beforeEach(() => {
    database._setState({ query: mockQuery }, true);
    // requireAuth appelle getSessionUser → 1 requête DB → retourne BASIC_USER
    mockQuery.mockResolvedValueOnce({ rows: [BASIC_USER] });
    // requireAdmin: role='basic' → 403, aucune autre requête DB
  });

  it.each(REQUIRE_ADMIN_ROUTES)('%s %s', async (method, path) => {
    const res = await withCookie(request(app)[method.toLowerCase()](path));
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /api/admin/top-photos — écart de sécurité
//    Cette route n'a que requireAuth, pas requireAdmin (server.js:210).
//    Un utilisateur basic peut y accéder — vérifier si c'est intentionnel.
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/top-photos — requireAuth uniquement', () => {
  it('anonymous → 401', async () => {
    const res = await request(app).get('/api/admin/top-photos');
    expect(res.status).toBe(401);
  });

  it('basic → 200 (pas de requireAdmin)', async () => {
    database._setState({ query: mockQuery }, true);
    mockQuery
      .mockResolvedValueOnce({ rows: [BASIC_USER] }) // getSessionUser (requireAuth)
      .mockResolvedValue({ rows: [] });              // photo_views + photo_likes
    const res = await withCookie(request(app).get('/api/admin/top-photos'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('photos');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. DELETE /api/albums/:album/photos/:filename — garde auth utilisateur
//    Route protégée par requireAuth + vérification canDelete dans le handler.
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/albums/:album/photos/:filename', () => {
  it('anonymous → 401', async () => {
    const res = await request(app).delete('/api/albums/Paris/photos/photo.jpg');
    expect(res.status).toBe(401);
  });

  it('basic sans canDelete (album public) → 403', async () => {
    // getSessionUser → BASIC_USER ; album_settings → public → canDelete=false
    database._setState({ query: mockQuery }, true);
    mockQuery
      .mockResolvedValueOnce({ rows: [BASIC_USER] }) // getSessionUser (requireAuth)
      .mockResolvedValue({ rows: [] });              // album_settings → public
    const res = await withCookie(request(app).delete('/api/albums/Paris/photos/photo.jpg'));
    expect(res.status).toBe(403);
  });

  it('basic autorisé sur album restreint → passe le garde (404 fichier absent)', async () => {
    database._setState({ query: mockQuery }, true);
    mockQuery
      .mockResolvedValueOnce({ rows: [BASIC_USER] })                     // getSessionUser
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] })  // album_settings
      .mockResolvedValueOnce({ rows: [{ user_id: 2 }] });               // album_users
    const res = await withCookie(request(app).delete('/api/albums/Paris/photos/photo.jpg'));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('admin → passe le garde (canDelete=true, 404 fichier absent)', async () => {
    // album public → canDelete = role==='admin' → true
    database._setState({ query: mockQuery }, true);
    mockQuery
      .mockResolvedValueOnce({ rows: [ADMIN_USER] }) // getSessionUser (requireAuth)
      .mockResolvedValue({ rows: [] });              // album_settings → public
    const res = await withCookie(request(app).delete('/api/albums/Paris/photos/photo.jpg'));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. albumAccessGuard — accès aux fichiers statiques (/previews, /medium, /photos)
//    albumAccessGuard appelle auth.getSessionUser via l'export du module
//    (pas une référence locale) → vi.spyOn fonctionne ici, mais on utilise
//    le mock DB pour cohérence. Ordre des appels DB :
//    1. getSessionUser (si cookie présent)
//    2. album_settings (getAlbumAccess)
//    3. album_users (isUserAuthorizedForAlbum, si restricted + non-admin)
// ─────────────────────────────────────────────────────────────────────────────

describe('albumAccessGuard — /previews/:album/* (visibilité restreinte)', () => {
  beforeEach(() => {
    database._setState({ query: mockQuery }, true);
    mockQuery.mockResolvedValue({ rows: [] }); // valeur par défaut
  });

  it('anonymous → 401', async () => {
    // Pas de cookie → pas d'appel getSessionUser ; album_settings → restricted
    mockQuery.mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] });
    const res = await request(app).get('/previews/Paris/photo.jpg');
    expect(res.status).toBe(401);
  });

  it('basic non autorisé → 401', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [BASIC_USER] })                    // getSessionUser
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }); // album_settings
    // album_users → défaut { rows: [] } → non autorisé → 401
    const res = await withCookie(request(app).get('/previews/Paris/photo.jpg'));
    expect(res.status).toBe(401);
  });

  it('basic autorisé → passe le garde (fichier absent → 404)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [BASIC_USER] })                    // getSessionUser
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [{ user_id: 2 }] });              // album_users
    const res = await withCookie(request(app).get('/previews/Paris/photo.jpg'));
    expect(res.status).not.toBe(401);
  });

  it('admin → passe le garde (album_users non consulté)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [ADMIN_USER] })                   // getSessionUser
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }); // album_settings
    const res = await withCookie(request(app).get('/previews/Paris/photo.jpg'));
    expect(res.status).not.toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET /api/albums/:album — contrôle d'accès par visibilité
//    Route publique mais bloquée en 401 si album restreint et accès refusé.
//    Ordre des appels DB :
//    1. getSessionUser (si cookie présent)
//    2. album_settings (getAlbumAccess)
//    3. album_users (si restricted + basic)
//    4+5. photo_views + photo_likes (si accès accordé et dbReady)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/albums/:album — contrôle d\'accès', () => {
  beforeEach(() => {
    vi.spyOn(fsMod, 'existsSync').mockReturnValue(true);
    vi.spyOn(fsMod, 'readdirSync').mockReturnValue([]);
    database._setState({ query: mockQuery }, true);
    mockQuery.mockResolvedValue({ rows: [] }); // défaut pour toutes les requêtes
  });

  it('anonymous sur album public → 200', async () => {
    // album_settings → { rows: [] } → public ; photo_views/likes → défaut
    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(200);
  });

  it('anonymous sur album restreint → 401', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }); // album_settings
    const res = await request(app).get('/api/albums/Paris');
    expect(res.status).toBe(401);
  });

  it('basic non autorisé sur album restreint → 401', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [BASIC_USER] })                    // getSessionUser
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }); // album_settings
    // album_users → défaut { rows: [] } → non autorisé → 401
    const res = await withCookie(request(app).get('/api/albums/Paris'));
    expect(res.status).toBe(401);
  });

  it('basic autorisé sur album restreint → 200', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [BASIC_USER] })                    // getSessionUser
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }) // album_settings
      .mockResolvedValueOnce({ rows: [{ user_id: 2 }] });              // album_users
    // photo_views + photo_likes → défaut { rows: [] }
    const res = await withCookie(request(app).get('/api/albums/Paris'));
    expect(res.status).toBe(200);
  });

  it('admin sur album restreint → 200 (album_users non consulté)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [ADMIN_USER] })                   // getSessionUser
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }); // album_settings
    // admin → autorisé ; photo_views + photo_likes → défaut { rows: [] }
    const res = await withCookie(request(app).get('/api/albums/Paris'));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Auto-protection du compte admin
//    Le compte système 'admin' ne peut ni être supprimé ni voir son rôle modifié.
// ─────────────────────────────────────────────────────────────────────────────

describe('auto-protection du compte admin', () => {
  beforeEach(() => {
    database._setState({ query: mockQuery }, true);
  });

  it('PATCH /api/admin/users/:id — changer le rôle de admin → 403', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [ADMIN_USER] })            // getSessionUser (requireAuth)
      .mockResolvedValue({ rows: [{ username: 'admin' }] });    // SELECT username → admin
    const res = await withCookie(
      request(app).patch('/api/admin/users/1').send({ role: 'basic' }),
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('The admin user role cannot be changed');
  });

  it('DELETE /api/admin/users/:id — supprimer le compte admin → 403', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [ADMIN_USER] })            // getSessionUser (requireAuth)
      .mockResolvedValue({ rows: [{ username: 'admin' }] });    // SELECT username → admin
    const res = await withCookie(request(app).delete('/api/admin/users/1'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('The admin user cannot be deleted');
  });
});
