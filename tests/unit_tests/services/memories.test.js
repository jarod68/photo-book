import { createRequire } from 'module';
import { describe, it, expect, vi } from 'vitest';

const _require = createRequire(import.meta.url);
const memories = _require('../../../services/memories.js');
const notify   = _require('../../../services/notify.js');
const database = _require('../../../services/database.js');

const ph = (filename, takenAt, extra = {}) => ({ album: 'A', photo: { filename, takenAt, thumbUrl: `/t/${filename}`, previewUrl: `/p/${filename}`, ...extra } });

describe('ce jour-là', () => {
  const today = new Date('2026-11-10T12:00:00Z');

  it('les photos à ±3 jours de la date, les années passées, par année (la plus récente d’abord)', () => {
    const out = memories.onThisDay([
      ph('a.jpg', '2024-11-09T10:00:00Z'), ph('b.jpg', '2024-11-13T10:00:00Z'), ph('c.jpg', '2024-11-14T10:00:00Z'),
      ph('d.jpg', '2023-11-10T10:00:00Z'), ph('now.jpg', '2026-11-10T10:00:00Z'), ph('nodate.jpg', null),
      ph('vid.mp4', '2022-11-10T10:00:00Z', { type: 'video' }), ph('broken.jpg', '2022-11-10T10:00:00Z', { thumbUrl: null }),
    ], today);
    expect(out.map((y) => [y.year, y.yearsAgo, y.count, y.photos.map((p) => p.filename)])).toEqual([
      [2024, 2, 2, ['a.jpg', 'b.jpg']],
      [2023, 3, 1, ['d.jpg']],
    ]);
  });

  it('autour du nouvel an, et le 29 février compte comme le 28', () => {
    const jan1 = new Date('2027-01-01T12:00:00Z');
    expect(memories.onThisDay([ph('x.jpg', '2025-12-30T10:00:00Z')], jan1)).toHaveLength(1);
    expect(memories.dayOfYear(new Date('2024-02-29T00:00:00Z'))).toBe(memories.dayOfYear(new Date('2025-02-28T00:00:00Z')));
  });

  it('au plus 8 photos par année, réparties sur la période', () => {
    const many = Array.from({ length: 20 }, (_, i) => ph(`p${i}.jpg`, `2020-11-${String(8 + (i % 5)).padStart(2, '0')}T${String(i).padStart(2, '0')}:00:00Z`));
    const [y] = memories.onThisDay(many, today);
    expect(y.count).toBe(20);
    expect(y.photos.length).toBeLessThanOrEqual(8);
  });
});

describe('notification d’un nouvel article', () => {
  it('ses abonnés reçoivent son titre et son adresse ; rien si l’album ne notifie pas', async () => {
    database._setState({ query: vi.fn().mockResolvedValue({ rows: [{ notify_new: true }] }) }, true);
    const send = vi.fn().mockResolvedValue(2);
    expect(await notify.articlePublished('Ibérie', { id: 4, slug: 'jour-1', title: 'Jour 1' }, { send })).toBe(2);
    expect(send).toHaveBeenCalledWith('Ibérie', {
      title: 'Ibérie', body: 'Nouvel article : Jour 1', tag: 'article-4', url: '/article.html?album=Ib%C3%A9rie&a=jour-1',
    });
    database._setState({ query: vi.fn().mockResolvedValue({ rows: [{ notify_new: false }] }) }, true);
    send.mockClear();
    expect(await notify.articlePublished('Ibérie', { id: 4, slug: 'jour-1', title: 'Jour 1' }, { send })).toBe(0);
    expect(send).not.toHaveBeenCalled();
    database._reset();
  });
});
