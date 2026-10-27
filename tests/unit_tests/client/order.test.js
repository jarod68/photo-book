import { describe, it, expect, beforeEach } from 'vitest';
import { sortPhotos, sortAlbums, dayLabels, loadOrder, saveOrder } from '../../../public/utils/order.js';

const p = (filename, takenAt = null) => ({ filename, takenAt });
const names = (xs) => xs.map((x) => x.filename ?? x.name);

describe('order (F5)', () => {
  beforeEach(() => localStorage.clear());

  it('photos par nom : tri naturel (IMG_9 avant IMG_10), sans muter', () => {
    const src = [p('IMG_10.jpg'), p('IMG_9.jpg'), p('A.jpg')];
    expect(names(sortPhotos(src, 'name'))).toEqual(['A.jpg', 'IMG_9.jpg', 'IMG_10.jpg']);
    expect(names(src)).toEqual(['IMG_10.jpg', 'IMG_9.jpg', 'A.jpg']);
  });

  it('photos par date : chronologique, sans date à la fin par nom, égalité départagée par nom', () => {
    const src = [p('c.jpg'), p('b.jpg', '2024-06-15T09:00:00Z'), p('a.mp4'), p('z.jpg', '2024-06-14T21:00:00Z'), p('y.jpg', '2024-06-15T09:00:00Z')];
    expect(names(sortPhotos(src, 'date'))).toEqual(['z.jpg', 'b.jpg', 'y.jpg', 'a.mp4', 'c.jpg']);
  });

  it('albums : récents / anciens d\'après dateTo / dateFrom, sans date à la fin', () => {
    const albums = [
      { name: 'Porto', dateFrom: '2024-06-14T00:00:00Z', dateTo: '2024-06-15T00:00:00Z' },
      { name: 'Empty', dateFrom: null, dateTo: null },
      { name: 'Perth', dateFrom: '2025-03-21T00:00:00Z', dateTo: '2025-03-22T00:00:00Z' },
      { name: 'Big',   dateFrom: '2023-01-01T00:00:00Z', dateTo: '2025-12-01T00:00:00Z' },
    ];
    expect(names(sortAlbums(albums, 'recent'))).toEqual(['Big', 'Perth', 'Porto', 'Empty']);
    expect(names(sortAlbums(albums, 'oldest'))).toEqual(['Big', 'Porto', 'Perth', 'Empty']);
    expect(names(sortAlbums(albums, 'name'))).toEqual(['Big', 'Empty', 'Perth', 'Porto']);
  });

  it('libellé sur la première photo de chaque jour (jour UTC = heure de l\'appareil)', () => {
    const sorted = [p('a', '2024-06-14T21:00:00Z'), p('b', '2024-06-14T23:59:00Z'), p('c', '2024-06-15T00:01:00Z'), p('d')];
    expect(dayLabels(sorted, 'en-GB')).toEqual(['14 Jun', null, '15 Jun', null]);
  });

  it('préférence mémorisée, valeur inconnue ignorée', () => {
    expect(loadOrder('k', 'name', ['name', 'date'])).toBe('name');
    saveOrder('k', 'date');
    expect(loadOrder('k', 'name', ['name', 'date'])).toBe('date');
    saveOrder('k', 'bogus');
    expect(loadOrder('k', 'name', ['name', 'date'])).toBe('name');
  });
});
