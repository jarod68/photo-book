import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _require = createRequire(import.meta.url);
const database = _require('../../../services/database.js');
const { summarize, pickCover, dateRange, loadAlbumInfo } = _require('../../../services/album-info.js');

const ph = (filename, extra = {}) => ({
  filename, type: 'photo', url: `/photos/A/${filename}`, thumbUrl: `/previews/A/${filename}.thumb.jpg`, previewUrl: `/previews/A/${filename}.jpg`, takenAt: null, ...extra,
});

describe('album info (F3)', () => {
  beforeEach(() => database._reset());

  it('la couverture choisie gagne si elle est lisible', () => {
    const photos = [ph('a.jpg'), ph('b.jpg')];
    expect(pickCover(photos, 'b.jpg').filename).toBe('b.jpg');
  });

  it('repli : première photo lisible (ni vidéo, ni fichier corrompu, ni couverture disparue)', () => {
    const photos = [ph('BROKEN.jpg', { thumbUrl: null }), ph('clip.mp4', { type: 'video', thumbUrl: null }), ph('ok.jpg')];
    expect(pickCover(photos, null).filename).toBe('ok.jpg');
    expect(pickCover(photos, 'gone.jpg').filename).toBe('ok.jpg');
    expect(pickCover(photos, 'clip.mp4').filename).toBe('ok.jpg');
    expect(pickCover([ph('x.mp4', { type: 'video', thumbUrl: null })], null)).toBeNull();
  });

  it('plage de dates = première et dernière date de prise de vue', () => {
    const photos = [
      ph('a.jpg', { takenAt: '2024-03-10T08:00:00.000Z' }),
      ph('b.jpg', { takenAt: '2024-02-01T08:00:00.000Z' }),
      ph('c.jpg'), ph('d.jpg', { takenAt: 'n/a' }),
    ];
    expect(dateRange(photos)).toEqual({ dateFrom: '2024-02-01T08:00:00.000Z', dateTo: '2024-03-10T08:00:00.000Z' });
    expect(dateRange([ph('c.jpg')])).toEqual({ dateFrom: null, dateTo: null });
  });

  it('summarize assemble le tout', () => {
    const s = summarize([ph('a.jpg', { takenAt: '2024-03-10T08:00:00.000Z' }), ph('b.mp4', { type: 'video', thumbUrl: null })], { cover: 'a.jpg', description: 'Voyage' });
    expect(s).toEqual({
      count: 2, cover: '/photos/A/a.jpg', coverFile: 'a.jpg', coverPreview: '/previews/A/a.jpg.jpg', coverThumb: '/previews/A/a.jpg.thumb.jpg',
      description: 'Voyage', dateFrom: '2024-03-10T08:00:00.000Z', dateTo: '2024-03-10T08:00:00.000Z',
    });
  });

  it('loadAlbumInfo : vide sans DB', async () => {
    expect((await loadAlbumInfo()).size).toBe(0);
    const query = vi.fn().mockResolvedValue({ rows: [{ album: 'A', cover: 'a.jpg', description: null }] });
    database._setState({ query }, true);
    expect((await loadAlbumInfo()).get('A')).toEqual({ cover: 'a.jpg', description: null });
  });
});
