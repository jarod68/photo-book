import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';

const _require = createRequire(import.meta.url);
const { toEntry, parseQuery, search, cameraOf, norm } = _require('../../../services/search.js');

const photo = (filename, extra = {}) => ({ filename, type: 'photo', name: filename.replace(/\..*/, ''), description: '', location: null, takenAt: null, exif: null, url: `/photos/x/${filename}`, thumbUrl: `/t/${filename}`, ...extra });
const entries = [
  toEntry('Porto', photo('DSC_10.jpg', { location: 'Porto, Portugal', takenAt: '2024-06-14T21:32:12.000Z', exif: { make: 'NIKON CORPORATION', model: 'NIKON Z 6' } })),
  toEntry('Porto', photo('DSC_11.jpg', { name: 'Pont Dom-Luís', description: 'Vue depuis la Ribeira', takenAt: '2024-06-15T09:00:00.000Z', exif: { make: 'Apple', model: 'iPhone 15' } })),
  toEntry('Évora', photo('IMG_1.jpg', { name: 'Été à Évora', takenAt: '2023-08-01T10:00:00.000Z', exif: { make: 'Apple', model: 'iPhone 15' } })),
  toEntry('Évora', photo('clip.mp4', { type: 'video' })),
];
const run = (query) => {
  const { filters, error } = parseQuery(query);
  if (error) throw new Error(error);
  return search(entries, filters);
};
const files = (r) => r.results.map((e) => e.filename);

describe('search (F6)', () => {
  it('texte libre sans accents ni casse, tous les mots requis', () => {
    expect(files(run({ q: 'ete evora' }))).toEqual(['IMG_1.jpg']);
    expect(files(run({ q: 'RIBEIRA' }))).toEqual(['DSC_11.jpg']);
    expect(files(run({ q: 'porto portugal' }))).toEqual(['DSC_10.jpg']);
    expect(files(run({ q: 'porto inexistant' }))).toEqual([]);
  });

  it('cherche aussi dans l\'album, le nom de fichier et l\'appareil', () => {
    expect(files(run({ q: 'evora' }))).toEqual(['IMG_1.jpg', 'clip.mp4']);
    expect(files(run({ q: 'dsc_11' }))).toEqual(['DSC_11.jpg']);
    expect(files(run({ q: 'iphone' }))).toEqual(['DSC_11.jpg', 'IMG_1.jpg']);
  });

  it('sans critère : tout, le plus récent d\'abord, sans date à la fin', () => {
    expect(files(run({}))).toEqual(['DSC_11.jpg', 'DSC_10.jpg', 'IMG_1.jpg', 'clip.mp4']);
  });

  it('filtre par dates (bornes incluses, journée entière) — exclut les photos sans date', () => {
    expect(files(run({ from: '2024-06-14', to: '2024-06-14' }))).toEqual(['DSC_10.jpg']);
    expect(files(run({ to: '2024-01-01' }))).toEqual(['IMG_1.jpg']);
  });

  it('filtre par appareil et par album', () => {
    expect(files(run({ camera: 'Apple iPhone 15', album: 'Porto' }))).toEqual(['DSC_11.jpg']);
  });

  it('facettes : appareils par fréquence, albums, plage de dates', () => {
    const { facets } = run({ q: 'rien' });
    expect(facets.cameras).toEqual([{ name: 'Apple iPhone 15', count: 2 }, { name: 'NIKON Z 6', count: 1 }]);
    expect(facets.albums).toEqual(['Évora', 'Porto']);
    expect(facets).toMatchObject({ dateFrom: '2023-08-01T10:00:00.000Z', dateTo: '2024-06-15T09:00:00.000Z' });
  });

  it('les résultats n\'exposent pas les champs internes', () => {
    expect(Object.keys(run({ q: 'ribeira' }).results[0]).some((k) => k.startsWith('_'))).toBe(false);
  });

  it('parseQuery refuse une date mal formée', () => {
    expect(parseQuery({ from: '14/06/2024' }).error).toBeTruthy();
    expect(parseQuery({ to: '2024-13-45' }).error).toBeTruthy();
  });

  it('cameraOf évite de répéter la marque', () => {
    expect(cameraOf({ exif: { make: 'Canon', model: 'Canon EOS R6' } })).toBe('Canon EOS R6');
    expect(cameraOf({ exif: { make: 'Apple', model: 'iPhone 15' } })).toBe('Apple iPhone 15');
    expect(cameraOf({ exif: { make: 'NIKON CORPORATION', model: 'NIKON Z 6' } })).toBe('NIKON Z 6');
    expect(cameraOf({ exif: { make: 'SONY', model: '' } })).toBe('SONY');
    expect(cameraOf({ exif: null })).toBeNull();
    expect(norm('Éàç')).toBe('eac');
  });
});
