import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// Articles: reading (/api/articles…) with the albums' rights, writing
// (/api/admin/articles…) for the admin only. The real auth guards run (no
// bypass); the database is a small in-memory stand-in answering the queries
// of services/articles.js, access.js and auth.js.

vi.mock('../../../services/image.js', () => ({
  PHOTOS_DIR:       '/test/photos',
  PREVIEWS_DIR:     '/test/previews',
  MEDIUM_DIR:       '/test/medium',
  isImage:          f => ['.jpg', '.jpeg', '.png'].some(e => f.endsWith(e)),
  isMedia:          f => ['.jpg', '.jpeg', '.png'].some(e => f.endsWith(e)),
  isAlbumDir:       e => e.isDirectory?.() ?? false,
  ensurePreview:    vi.fn().mockResolvedValue('/previews/album/photo.jpg'),
  photoMeta:        vi.fn(),
  preGenerateAll:   vi.fn().mockResolvedValue(undefined),
  deletePhotoFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, existsSync: vi.fn().mockReturnValue(false), mkdirSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]) };
});

const { app } = await import('../../../server.js');

const _require   = createRequire(import.meta.url);
const database   = _require('../../../services/database.js');
const libraryMod = _require('../../../services/library.js');

const ADMIN = 'a'.repeat(64), BASIC = 'b'.repeat(64);
const USERS = { [ADMIN]: { id: 1, username: 'admin', role: 'admin' }, [BASIC]: { id: 2, username: 'alice', role: 'basic' } };

// albums: Voyage (public, 3 photos), Carnet (public, no photo), Prive (restricted, 1 photo)
const LIBRARY = { Voyage: ['a.jpg', 'b.jpg', 'c.jpg'], Carnet: [], Prive: ['secret.jpg'] };
const VISIBILITY = { Prive: 'restricted' };

let rows, nextId, likes;
const art = (o) => ({
  id: nextId++, album: 'Voyage', slug: 'x', title: 'X', summary: null, body: '', cover: null, place: null,
  date: null, published: true, created_at: new Date(Date.UTC(2026, 3, nextId)), updated_at: new Date(Date.UTC(2026, 3, nextId)), ...o,
});

// the queries of the app, answered from `rows`
async function query(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ');
  if (s.includes('FROM user_sessions')) return { rows: USERS[params[0]] ? [USERS[params[0]]] : [] };
  if (s.startsWith('SELECT visibility, owner_id FROM album_settings')) return { rows: VISIBILITY[params[0]] ? [{ visibility: VISIBILITY[params[0]], owner_id: null }] : [] };
  if (s.startsWith('SELECT album, visibility, owner_id FROM album_settings')) return { rows: Object.entries(VISIBILITY).map(([album, visibility]) => ({ album, visibility, owner_id: null })) };
  if (s.includes('FROM album_users') || s.includes('FROM share_tokens') || s.includes('FROM photo_overrides')) return { rows: [] };
  if (s.includes('FROM album_settings')) return { rows: [] };
  if (s.startsWith('INSERT INTO activity_log')) return { rows: [], rowCount: 1 };
  if (s.includes('FROM photo_views') || s.includes('FROM photo_likes')) return { rows: [] };

  if (s.startsWith('DELETE FROM article_likes')) {
    const before = likes.length;
    likes = likes.filter(([id, t]) => !(id === params[0] && t === params[1]));
    return { rowCount: before - likes.length };
  }
  if (s.startsWith('INSERT INTO article_likes')) { likes.push([params[0], params[1]]); return { rowCount: 1 }; }
  if (s.startsWith('SELECT COUNT(*) AS n FROM article_likes')) return { rows: [{ n: String(likes.filter(([id]) => id === params[0]).length) }] };
  if (s.startsWith('SELECT 1 FROM article_likes')) return { rows: likes.filter(([id, t]) => id === params[0] && t === params[1]) };
  if (s.includes('COUNT(*) FILTER')) {
    const out = new Map();
    for (const r of rows) {
      const c = out.get(r.album) ?? { album: r.album, published: 0, drafts: 0 };
      c[r.published ? 'published' : 'drafts']++;
      out.set(r.album, c);
    }
    return { rows: [...out.values()] };
  }
  if (s.startsWith('SELECT slug FROM articles')) {
    return { rows: rows.filter(r => r.album === params[0] && (r.slug === params[1] || r.slug.startsWith(`${params[1]}-`)) && r.id !== params[2]) };
  }
  if (s.startsWith('INSERT INTO articles')) {
    const cols = s.match(/\(album, slug, author_id, ([^)]*)\)/)[1].split(', ');
    const r = art({ album: params[0], slug: params[1], title: null, published: false });
    cols.forEach((c, i) => { r[c === 'story_date' ? 'date' : c] = params[i + 3]; });
    rows.push(r);
    return { rows: [{ id: r.id }] };
  }
  if (s.startsWith('UPDATE articles SET')) {
    const r = rows.find(x => x.id === params[0]);
    if (!r) return { rowCount: 0 };
    for (const [, col, n] of s.matchAll(/(\w+) = \$(\d+)/g)) r[col === 'story_date' ? 'date' : col] = params[Number(n) - 1];
    return { rowCount: 1 };
  }
  if (s.startsWith('DELETE FROM articles')) {
    const before = rows.length;
    rows = rows.filter(r => r.id !== params[0]);
    return { rowCount: before - rows.length };
  }
  if (s.includes('FROM articles')) {
    let list = rows.slice();
    if (s.includes('WHERE id = $1')) list = list.filter(r => r.id === params[0]);
    else if (s.includes('album = ANY($1)')) list = list.filter(r => r.published && params[0].includes(r.album)).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.created_at - a.created_at).slice(0, params[1]);
    else {
      list = list.filter(r => r.album === params[0]);
      if (s.includes('slug = $2')) list = list.filter(r => r.slug === params[1]);
      if (s.includes('AND published')) list = list.filter(r => r.published);
      list.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.created_at - b.created_at);
    }
    return { rows: list.map(r => ({ ...r, likes: String(likes.filter(([id]) => id === r.id).length) })) };
  }
  throw new Error(`unexpected query: ${s}`);
}

beforeEach(() => {
  database._reset();
  database._setState({ query: vi.fn(query) }, true);
  nextId = 1;
  likes = [];
  rows = [
    art({ slug: 'jour-1', title: 'Jour 1', date: '2026-04-01', cover: 'b.jpg', body: 'Bonjour.\n\n![Le port](a.jpg)\n![](<Prive/secret.jpg>)' }),
    art({ slug: 'jour-2', title: 'Jour 2', date: '2026-04-02', body: 'Suite.' }),
    art({ slug: 'brouillon', title: 'Brouillon', date: '2026-04-03', published: false }),
    art({ album: 'Prive', slug: 'cache', title: 'Caché', body: '![](secret.jpg)' }),
    art({ album: 'Carnet', slug: 'notes', title: 'Notes', body: '![](<Voyage/c.jpg>)' }),
  ];
  vi.spyOn(libraryMod, 'listAlbums').mockResolvedValue(Object.keys(LIBRARY));
  vi.spyOn(libraryMod, 'albumExists').mockImplementation(async (a) => a in LIBRARY);
  vi.spyOn(libraryMod, 'isWritable').mockResolvedValue(true);
  vi.spyOn(libraryMod, 'getAlbumPhotos').mockImplementation(async (a) => (LIBRARY[a] ? LIBRARY[a].map((filename) => ({
    filename, type: 'photo', name: filename.replace(/\..*/, ''), url: `/photos/${a}/${filename}`,
    previewUrl: `/previews/${a}/${filename}.jpg`, thumbUrl: `/previews/${a}/${filename}.thumb.jpg`, mediumUrl: null,
  })) : null));
});

afterEach(() => vi.restoreAllMocks());

const as = (req, token) => (token ? req.set('Cookie', `pb_session=${token}`) : req);

describe('GET /api/articles (accueil)', () => {
  it('les derniers articles publiés des albums visibles, par leur date (les plus récents d’abord, sans date à la fin), sans corps', async () => {
    const res = await request(app).get('/api/articles');
    expect(res.status).toBe(200);
    expect(res.body.map(a => a.slug)).toEqual(['jour-2', 'jour-1', 'notes']);
    expect(res.body[0].body).toBeUndefined();
    // la couverture d'un carnet sans photo vient d'un autre album
    expect(res.body.find(a => a.slug === 'notes').cover.thumbUrl).toBe('/previews/Voyage/c.jpg.thumb.jpg');
  });

  it('un membre connecté voit aussi les albums réservés qui lui sont ouverts (ici l’admin)', async () => {
    const res = await as(request(app).get('/api/articles?limit=10'), ADMIN);
    expect(res.body.map(a => a.slug)).toContain('cache');
    expect(res.body.map(a => a.slug)).not.toContain('brouillon');
  });
});

describe('GET /api/articles/:album', () => {
  it('ordre du voyage, brouillons cachés aux visiteurs', async () => {
    const res = await request(app).get('/api/articles/Voyage');
    expect(res.status).toBe(200);
    expect(res.body.articles.map(a => a.slug)).toEqual(['jour-1', 'jour-2']);
    expect(res.body.canEdit).toBe(false);
    expect(res.body.articles[0]).toMatchObject({ summary: 'Bonjour.', readMinutes: 1, cover: { filename: 'b.jpg' } });
  });

  it('l’admin voit les brouillons et peut écrire', async () => {
    const res = await as(request(app).get('/api/articles/Voyage'), ADMIN);
    expect(res.body.articles.map(a => a.slug)).toEqual(['jour-1', 'jour-2', 'brouillon']);
    expect(res.body.canEdit).toBe(true);
  });

  it('album réservé : 401 pour un visiteur, 404 pour un album inconnu', async () => {
    expect((await request(app).get('/api/articles/Prive')).status).toBe(401);
    expect((await request(app).get('/api/articles/Nope')).status).toBe(404);
  });
});

describe('GET /api/articles/:album/:slug', () => {
  it('corps, photos visibles seulement, voisins', async () => {
    const res = await request(app).get('/api/articles/Voyage/jour-1');
    expect(res.status).toBe(200);
    expect(res.body.body).toContain('![Le port](a.jpg)');
    // la photo de l'album réservé n'est pas donnée au visiteur
    expect(Object.keys(res.body.photos).sort()).toEqual(['Voyage/a.jpg', 'Voyage/b.jpg']);
    expect(res.body.prev).toBeNull();
    expect(res.body.next).toMatchObject({ slug: 'jour-2', title: 'Jour 2' });
    expect(res.body.coverRef).toBe('b.jpg');
  });

  it('l’admin reçoit aussi la photo de l’album réservé', async () => {
    const res = await as(request(app).get('/api/articles/Voyage/jour-1'), ADMIN);
    expect(Object.keys(res.body.photos)).toContain('Prive/secret.jpg');
  });

  it('un brouillon : 404 pour un visiteur, visible pour l’admin', async () => {
    expect((await request(app).get('/api/articles/Voyage/brouillon')).status).toBe(404);
    const res = await as(request(app).get('/api/articles/Voyage/brouillon'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.published).toBe(false);
    expect(res.body.prev.slug).toBe('jour-2');
  });
});

describe('écriture (admin)', () => {
  it('visiteur 401, membre 403', async () => {
    expect((await request(app).post('/api/admin/articles').send({ album: 'Voyage', title: 'T' })).status).toBe(401);
    expect((await as(request(app).post('/api/admin/articles'), BASIC).send({ album: 'Voyage', title: 'T' })).status).toBe(403);
    expect((await as(request(app).put('/api/admin/articles/1'), BASIC).send({ title: 'T' })).status).toBe(403);
    expect((await as(request(app).delete('/api/admin/articles/1'), BASIC)).status).toBe(403);
  });

  it('créer : adresse tirée du titre, unique dans l’album', async () => {
    const res = await as(request(app).post('/api/admin/articles'), ADMIN)
      .send({ album: 'Voyage', title: 'Jour 1', body: 'Texte', date: '2026-04-05', published: true });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ album: 'Voyage', slug: 'jour-1-2', title: 'Jour 1', date: '2026-04-05', published: true });
  });

  it('créer : album inconnu 404, titre manquant ou date invalide 400', async () => {
    expect((await as(request(app).post('/api/admin/articles'), ADMIN).send({ album: 'Nope', title: 'T' })).status).toBe(404);
    expect((await as(request(app).post('/api/admin/articles'), ADMIN).send({ album: 'Voyage', title: '  ' })).status).toBe(400);
    expect((await as(request(app).post('/api/admin/articles'), ADMIN).send({ album: 'Voyage', title: 'T', date: '1er avril' })).status).toBe(400);
  });

  it('modifier garde l’adresse ; publier', async () => {
    const res = await as(request(app).put('/api/admin/articles/3'), ADMIN).send({ title: 'Madrid', published: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ slug: 'brouillon', title: 'Madrid', published: true });
    expect((await request(app).get('/api/articles/Voyage/brouillon')).status).toBe(200);
  });

  it('modifier / supprimer : id invalide 400, inconnu 404', async () => {
    expect((await as(request(app).put('/api/admin/articles/abc'), ADMIN).send({ title: 'T' })).status).toBe(400);
    expect((await as(request(app).put('/api/admin/articles/99'), ADMIN).send({ title: 'T' })).status).toBe(404);
    expect((await as(request(app).delete('/api/admin/articles/abc'), ADMIN)).status).toBe(400);
    expect((await as(request(app).delete('/api/admin/articles/99'), ADMIN)).status).toBe(404);
  });

  it('supprimer', async () => {
    expect((await as(request(app).delete('/api/admin/articles/2'), ADMIN)).status).toBe(200);
    expect(rows.map(r => r.slug)).not.toContain('jour-2');
  });
});

describe('GET /api/albums : nombre d’articles', () => {
  it('articles publiés par album ; brouillons pour l’admin ; couverture d’un carnet sans photo', async () => {
    const anon = (await request(app).get('/api/albums')).body;
    const voyage = anon.find(a => a.name === 'Voyage');
    expect(voyage.articles).toBe(2);
    expect(voyage.drafts).toBeUndefined();
    const carnet = anon.find(a => a.name === 'Carnet');
    expect(carnet).toMatchObject({ count: 0, articles: 1, coverThumb: '/previews/Voyage/c.jpg.thumb.jpg' });
    const admin = (await as(request(app).get('/api/albums'), ADMIN)).body;
    expect(admin.find(a => a.name === 'Voyage')).toMatchObject({ articles: 2, drafts: 1 });
  });
});

describe('j’aime sur un article', () => {
  const T1 = '11111111-1111-4111-8111-111111111111', T2 = '22222222-2222-4222-8222-222222222222';
  const like = (slug, token, album = 'Voyage') => request(app).post(`/api/articles/${album}/${slug}/like`).send({ token });

  it('un par visiteur, un second clic le retire ; compté sur les cartes et l’article', async () => {
    expect((await like('jour-1', T1)).body).toEqual({ liked: true, count: 1 });
    expect((await like('jour-1', T2)).body).toEqual({ liked: true, count: 2 });
    expect((await like('jour-1', T1)).body).toEqual({ liked: false, count: 1 });
    const list = (await request(app).get('/api/articles/Voyage')).body.articles;
    expect(list.find((a) => a.slug === 'jour-1').likes).toBe(1);
    const a = (await request(app).get(`/api/articles/Voyage/jour-1?token=${T2}`)).body;
    expect(a).toMatchObject({ likes: 1, liked: true });
    expect((await request(app).get(`/api/articles/Voyage/jour-1?token=${T1}`)).body.liked).toBe(false);
    expect((await request(app).get('/api/articles/Voyage/jour-1')).body.liked).toBe(false);
  });

  it('jeton invalide 400 ; un brouillon ou un album réservé : pas pour un visiteur', async () => {
    expect((await like('jour-1', 'nope')).status).toBe(400);
    expect((await like('brouillon', T1)).status).toBe(404);
    expect((await like('cache', T1, 'Prive')).status).toBe(401);
    expect((await as(request(app).post('/api/articles/Voyage/brouillon/like'), ADMIN).send({ token: T1 })).status).toBe(200);
  });
});

describe('ses abonnés apprennent qu’un article paraît', () => {
  it('à la création publiée, et quand un brouillon est publié — pas à chaque modification', async () => {
    const notify = _require('../../../services/notify.js');
    const sent = vi.spyOn(notify, 'articlePublished').mockResolvedValue(1);
    await as(request(app).post('/api/admin/articles'), ADMIN).send({ album: 'Voyage', title: 'Neuf', published: true });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0][1]).toMatchObject({ slug: 'neuf', title: 'Neuf' });
    await as(request(app).post('/api/admin/articles'), ADMIN).send({ album: 'Voyage', title: 'Brouillon 2' });
    expect(sent).toHaveBeenCalledTimes(1);
    await as(request(app).put('/api/admin/articles/3'), ADMIN).send({ published: true });   // the draft
    expect(sent).toHaveBeenCalledTimes(2);
    await as(request(app).put('/api/admin/articles/3'), ADMIN).send({ title: 'Retouché' });   // already published
    expect(sent).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/memories', () => {
  it('ce jour-là, des albums visibles seulement ; date invalide ignorée', async () => {
    vi.spyOn(libraryMod, 'getAlbumPhotos').mockImplementation(async (a) => (a === 'Voyage'
      ? [{ filename: 'old.jpg', takenAt: '2024-04-02T10:00:00Z', thumbUrl: '/t/old.jpg' }]
      : a === 'Prive' ? [{ filename: 'secret.jpg', takenAt: '2024-04-02T10:00:00Z', thumbUrl: '/t/s.jpg' }] : []));
    const res = await request(app).get('/api/memories?date=2026-04-01');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ year: 2024, yearsAgo: 2, count: 1 })]);
    expect(res.body[0].photos.map((p) => p.filename)).toEqual(['old.jpg']);
    expect((await request(app).get('/api/memories?date=bad')).status).toBe(200);
  });
});
