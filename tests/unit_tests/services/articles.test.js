import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _require = createRequire(import.meta.url);
const database = _require('../../../services/database.js');
const articles = _require('../../../services/articles.js');

describe('articles : fonctions pures', () => {
  it('slugify', () => {
    expect(articles.slugify('Lisbonne, jour 1 !')).toBe('lisbonne-jour-1');
    expect(articles.slugify('Ça déménage à Cádiz')).toBe('ca-demenage-a-cadiz');
    expect(articles.slugify('!!!')).toBe('article');
    expect(articles.slugify('a'.repeat(100))).toHaveLength(80);
  });

  it('photoRefs : couverture et corps, sans doublon ni adresse web', () => {
    const refs = articles.photoRefs({ album: 'A', cover: 'B/x.jpg', body: '![](a.jpg)\n![](<B/x.jpg>) ![](https://ex.com/y.jpg) ![](a.jpg)' });
    expect(refs).toEqual([{ album: 'B', file: 'x.jpg' }, { album: 'A', file: 'a.jpg' }]);
  });

  it('plainText, readMinutes, excerpt', () => {
    expect(articles.plainText('## Titre\n**gras** [lien](https://x) ![](a.jpg)\n> cite')).toBe('Titre\ngras lien  \ncite');
    expect(articles.readMinutes('')).toBe(1);
    expect(articles.readMinutes('mot '.repeat(1000))).toBe(5);
    expect(articles.excerpt('Chapeau', 'texte')).toBe('Chapeau');
    expect(articles.excerpt(null, '![](a.jpg)\n\nPremier *paragraphe*.\n\nSecond.')).toBe('Premier paragraphe.');
    const long = articles.excerpt(null, 'mot '.repeat(100));
    expect(long.length).toBeLessThanOrEqual(241);
    expect(long.endsWith('…')).toBe(true);
  });

  it('validate : champs requis, longueurs, date, publié', () => {
    expect(articles.validate({ title: ' T ', body: 'x', date: '2026-04-01', published: true }))
      .toEqual({ title: 'T', body: 'x', date: '2026-04-01', published: true });
    expect(articles.validate({ summary: '' }, { partial: true })).toEqual({ summary: null });
    expect(articles.validate({ body: null }, { partial: true })).toEqual({ body: '' });
    expect(articles.validate({ date: '' }, { partial: true })).toEqual({ date: null });
    for (const bad of [{}, { title: '' }, { title: 3 }, { title: 'T', date: '2026-13-45' }, { title: 'T', date: 'hier' },
      { title: 'T', published: 'oui' }, { title: 'x'.repeat(201) }]) {
      expect(() => articles.validate(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('card : couverture choisie, sinon première photo visible', () => {
    const photos = new Map([['A/a.jpg', { filename: 'a.jpg', thumbUrl: '/t/a' }], ['A/v.mp4', { type: 'video', thumbUrl: null }]]);
    const a = { id: 1, album: 'A', slug: 's', title: 'T', summary: null, body: '![](v.mp4)\n![](a.jpg)', cover: null, published: true };
    expect(articles.card(a, photos).cover.filename).toBe('a.jpg');
    expect(articles.card({ ...a, cover: 'gone.jpg', body: '' }, photos).cover).toBeNull();
  });
});

describe('articles : base de données', () => {
  beforeEach(() => database._reset());

  it('sans base : listes vides, rien trouvé', async () => {
    expect(await articles.listForAlbum('A')).toEqual([]);
    expect(await articles.latest(['A'])).toEqual([]);
    expect(await articles.latest([])).toEqual([]);
    expect((await articles.counts()).size).toBe(0);
    expect(await articles.get('A', 's')).toBeNull();
    expect(await articles.getById(1)).toBeNull();
  });

  it('create : adresse suivante libre', async () => {
    const query = vi.fn(async (sql) => {
      if (sql.startsWith('SELECT slug')) return { rows: [{ slug: 'jour' }, { slug: 'jour-2' }] };
      if (sql.startsWith('INSERT')) return { rows: [{ id: 7 }] };
      return { rows: [{ id: 7, album: 'A', slug: 'jour-3', title: 'Jour', created_at: new Date(0), updated_at: new Date(0) }] };
    });
    database._setState({ query }, true);
    const a = await articles.create('A', { title: 'Jour' }, 1);
    expect(a).toMatchObject({ id: 7, slug: 'jour-3', createdAt: '1970-01-01T00:00:00.000Z' });
    expect(query.mock.calls[1][1].slice(0, 3)).toEqual(['A', 'jour-3', 1]);
  });

  it('update sans champ : relit l’article', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    database._setState({ query }, true);
    expect(await articles.update(1, {})).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('resolvePhotos : seulement les albums permis, titres modifiés appliqués', async () => {
    const library = _require('../../../services/library.js');
    vi.spyOn(library, 'getAlbumPhotos').mockImplementation(async (a) => (a === 'gone' ? null
      : [{ filename: 'a.jpg', type: 'photo', name: 'a', url: `/photos/${a}/a.jpg`, thumbUrl: 't', previewUrl: 'p', exif: { width: 4, height: 3 } }]));
    const out = await articles.resolvePhotos(
      [{ album: 'A', file: 'a.jpg' }, { album: 'A', file: 'nope.jpg' }, { album: 'R', file: 'a.jpg' }, { album: 'gone', file: 'a.jpg' }],
      async (album) => album !== 'R');
    expect([...out.keys()]).toEqual(['A/a.jpg']);
    expect(out.get('A/a.jpg')).toMatchObject({ album: 'A', name: 'a', width: 4, height: 3, description: null });
    vi.restoreAllMocks();
  });
});
