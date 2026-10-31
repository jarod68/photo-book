import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';

const _require = createRequire(import.meta.url);
const { toEntry, parseQuery, search, cameraOf, norm, withAlbumCountries, editDistance } = _require('../../../services/search.js');
const { countryOf } = _require('../../../services/geo-names.js');

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
    // a word that matches nothing: the photos matching the others, flagged approximate
    expect(run({ q: 'porto inexistant' }).approximate).toBe(true);
    expect(files(run({ q: 'porto inexistant' }))).toEqual(['DSC_11.jpg', 'DSC_10.jpg']);
    expect(files(run({ q: 'xyzzy plugh' }))).toEqual([]);
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

describe('search — pays, continents, dates, fautes de frappe', () => {
  const world = withAlbumCountries([
    toEntry('New York', photo('NY_1.jpg', { location: 'Manhattan, États-Unis', takenAt: '2025-06-03T10:00:00.000Z' })),
    toEntry('New York', photo('NY_2.jpg', { takenAt: '2025-06-04T10:00:00.000Z' })),            // no place: the album's
    toEntry('Islande', photo('IS_1.jpg', { location: 'Reykjavik, Islande', takenAt: '2025-03-03T10:00:00.000Z' })),
    toEntry('Japon', photo('JP_1.jpg', { location: 'Tokyo, Japon', takenAt: '2025-04-03T10:00:00.000Z' })),
    toEntry('Londres', photo('UK_1.jpg', { location: 'London, UK' })),
  ]);
  const find = (q) => {
    const { filters } = parseQuery({ q });
    return search(world, filters);
  };
  const names = (q) => find(q).results.map((e) => e.filename).sort();

  it('reconnaît le pays d\'un lieu dans n\'importe quelle langue', () => {
    expect(countryOf('Manhattan, États-Unis')).toBe('US');
    expect(countryOf('Berlin, Deutschland')).toBe('DE');
    expect(countryOf('London, UK')).toBe('GB');
    expect(countryOf('Quelque part')).toBeNull();
  });

  it('trouve un pays par son code, ses noms et surnoms ; une photo sans lieu prend ceux de son album', () => {
    for (const q of ['usa', 'us', 'united states', 'estados unidos', 'etats-unis', 'amerique']) {
      expect(names(q), q).toEqual(['NY_1.jpg', 'NY_2.jpg']);
    }
    expect(names('iceland')).toEqual(['IS_1.jpg']);
    expect(names('japan')).toEqual(['JP_1.jpg']);
    expect(names('england')).toEqual(['UK_1.jpg']);
    expect(names('royaume-uni')).toEqual(['UK_1.jpg']);
  });

  it('continents', () => {
    expect(names('europe')).toEqual(['IS_1.jpg', 'UK_1.jpg']);
    expect(names('asie')).toEqual(['JP_1.jpg']);
    expect(names('amerique du nord')).toEqual(['NY_1.jpg', 'NY_2.jpg']);
  });

  it('mois et année en toutes lettres', () => {
    expect(names('juin 2025')).toEqual(['NY_1.jpg', 'NY_2.jpg']);
    expect(names('march')).toEqual(['IS_1.jpg']);
    expect(names('abril')).toEqual(['JP_1.jpg']);
  });

  it('sans résultat exact : tolère une faute de frappe, et le signale', () => {
    expect(find('japon').approximate).toBe(false);
    const r = find('japn');
    expect(r.results.map((e) => e.filename)).toEqual(['JP_1.jpg']);
    expect(r.approximate).toBe(true);
    expect(names('reykjavk')).toEqual(['IS_1.jpg']);
    expect(names('xyzzy')).toEqual([]);
    expect(editDistance('japn', 'japon', 1)).toBe(1);
    expect(editDistance('tokoy', 'tokyo', 1)).toBe(1);   // transposition
  });
});

describe('search — fiabilité générale', () => {
  const E = (album, file, extra = {}, ctx = {}) => toEntry(album, photo(file, extra), ctx);
  const lib = withAlbumCountries([
    E('Bretagne', 'P1.jpg', { name: 'Plage de Saint-Malo', location: 'Saint-Malo, France', takenAt: '2024-07-14T16:00:00.000Z' }),
    E('Bretagne', 'P2.jpg', { name: 'Martin pêcheur', takenAt: '2024-07-15T08:00:00.000Z' }),
    E('Art', 'ART_1.jpg', { name: 'Musée', takenAt: '2023-01-10T10:00:00.000Z' }, { albumDescription: 'Expositions et galeries' }),
    E('New York', 'NY.jpg', { location: 'Manhattan, États-Unis', gps: { lat: 40.78, lng: -73.97 }, takenAt: '2025-12-24T10:00:00.000Z' },
      { placeTerms: 'Manhattan ; New York ; New York County ; New York ; Nueva York' }),
    E('Sydney', 'SYD.jpg', { location: 'Sydney, Australie', gps: { lat: -33.86, lng: 151.2 }, takenAt: '2025-12-24T10:00:00.000Z' }),
    E('Vidéos', 'clip.mp4', { type: 'video', name: 'Feu d\'artifice' }),
    E('Panos', 'pano.jpg', { is360: true, name: 'Sommet' }),
    E('Divers', 'IMG_2024.jpg', { name: 'Œuvre d’art' }),
  ]);
  const find = (q) => { const { filters } = parseQuery({ q }); return search(lib, filters); };
  const names = (q) => find(q).results.map((e) => e.filename);

  it('ignore les mots vides : « photos de la plage en bretagne »', () => {
    expect(names('photos de la plage en bretagne')).toEqual(['P1.jpg']);
  });

  it('pluriel léger et début de mot', () => {
    expect(names('plages')).toEqual(['P1.jpg']);
    expect(names('saint mal')).toEqual(['P1.jpg']);
  });

  it('pas de correspondance parasite au milieu des mots courts : « art » ne trouve pas « Martin »', () => {
    // the title « Œuvre d'art » (whole word), the album « Art », « Feu d'artifice » (start of a word)
    expect(names('art')).toEqual(['IMG_2024.jpg', 'ART_1.jpg', 'clip.mp4']);
    expect(names('art')).not.toContain('P2.jpg');
  });

  it('classe par pertinence : le titre et l\'album avant le nom de fichier', () => {
    expect(names('2024')[0]).toBe('P2.jpg');                      // dates: the newest of 2024 first…
    expect(names('2024')).toContain('IMG_2024.jpg');              // …the file name counts too
    expect(names('musee')).toEqual(['ART_1.jpg']);
  });

  it('description d\'album, ligatures, type de média, 360°', () => {
    expect(names('galeries')).toEqual(['ART_1.jpg']);
    expect(names('oeuvre')).toEqual(['IMG_2024.jpg']);
    expect(names('video')).toEqual(['clip.mp4']);
    expect(names('panorama')).toEqual(['pano.jpg']);
  });

  it('lieu détaillé : ville, état, noms étrangers', () => {
    expect(names('new york')).toEqual(['NY.jpg']);
    expect(names('nueva york')).toEqual(['NY.jpg']);
  });

  it('jour, mois et saison (inversée dans l\'hémisphère sud)', () => {
    expect(names('14 juillet')).toEqual(['P1.jpg']);
    expect(names('ete 2024').sort()).toEqual(['P1.jpg', 'P2.jpg']);
    expect(names('hiver 2025')).toEqual(['NY.jpg']);              // 24 December in New York…
    expect(names('summer 2025')).toEqual(['SYD.jpg']);            // …is summer in Sydney
  });

  it('un mot sans correspondance n\'annule pas tout : résultats approchés', () => {
    const r = find('plage zanzibar');
    expect(r.approximate).toBe(true);
    expect(r.results.map((e) => e.filename)).toEqual(['P1.jpg']);
  });
});

