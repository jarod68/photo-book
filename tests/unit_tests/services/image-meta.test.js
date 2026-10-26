import { vi, describe, it, expect, afterEach } from 'vitest';
import { photoMeta } from '../../../services/image.js';
import path from 'path';

afterEach(() => vi.restoreAllMocks());

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSharp() {
  const chain = {
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    jpeg:   vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue({}),
  };
  return { fn: vi.fn(() => chain), chain };
}

function makeFs({ exists = false } = {}) {
  return {
    existsSync:  vi.fn().mockReturnValue(exists),
    mkdirSync:   vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
  };
}

// Derivatives already up to date (same mtime as the source): nothing generated.
// Generation itself is covered on real files in derivatives.test.js.
function makeFsp({ fail = false } = {}) {
  return {
    stat:   vi.fn().mockImplementation(async () => { if (fail) throw new Error('ENOENT'); return { mtimeMs: 1000 }; }),
    mkdir:  vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  };
}

function makeExifr(data = {}, gpsData = null) {
  return {
    parse: vi.fn().mockResolvedValue(data),
    gps:   vi.fn().mockResolvedValue(gpsData),
  };
}

describe('photoMeta', () => {
  it('retourne les valeurs par défaut quand aucune donnée EXIF', async () => {
    const deps = {
      exifr: makeExifr(),
      fs:    makeFs({ exists: true }), fsPromises: makeFsp(),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.filename).toBe('photo.jpg');
    expect(meta.name).toBe('photo');
    expect(meta.description).toBe('');
    expect(meta.is360).toBe(false);
    expect(meta.gps).toBeNull();
    expect(meta.location).toBeNull();
    expect(meta.url).toBe('/photos/Paris/photo.jpg?v=1000');   // originals are versioned too
    // derivatives are named after the full filename and versioned by the source mtime
    expect(meta.previewUrl).toBe('/previews/Paris/photo.jpg.jpg?v=1000');
    expect(meta.thumbUrl).toBe('/previews/Paris/photo.jpg.thumb.jpg?v=1000');
    expect(meta.mtimeMs).toBe(1000);
  });

  it('utilise le champ Title EXIF comme nom', async () => {
    const deps = {
      exifr: makeExifr({ Title: 'Tour Eiffel' }),
      fs:    makeFs({ exists: true }), fsPromises: makeFsp(),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.name).toBe('Tour Eiffel');
  });

  it('ignore les valeurs placeholder EXIF', async () => {
    const deps = {
      exifr: makeExifr({ Title: 'OLYMPUS DIGITAL CAMERA' }),
      fs:    makeFs({ exists: true }), fsPromises: makeFsp(),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'ma-photo.jpg', '/albums/Paris', deps);

    expect(meta.name).toBe('ma-photo');
  });

  it("détecte is360 via ProjectionType 'equirectangular'", async () => {
    const deps = {
      exifr: makeExifr({ ProjectionType: 'equirectangular' }),
      fs:    makeFs({ exists: true }), fsPromises: makeFsp(),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'pano.jpg', '/albums/Paris', deps);

    expect(meta.is360).toBe(true);
  });

  it("détecte is360 via le ratio d'aspect 2:1 (ImageWidth/ImageHeight)", async () => {
    const deps = {
      exifr: makeExifr({ ImageWidth: 8000, ImageHeight: 4000 }),
      fs:    makeFs({ exists: true }), fsPromises: makeFsp(),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'pano.jpg', '/albums/Paris', deps);

    expect(meta.is360).toBe(true);
  });

  it('extrait les coordonnées GPS', async () => {
    const mockExifr = {
      parse: vi.fn().mockResolvedValue({}),
      gps:   vi.fn().mockResolvedValue({ latitude: 48.856600, longitude: 2.352200 }),
    };
    const deps = { exifr: mockExifr, fs: makeFs({ exists: true }), fsPromises: makeFsp(), sharp: makeSharp().fn };

    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.gps).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  it('extrait la location IPTC (City + Country)', async () => {
    const deps = {
      exifr: makeExifr({ City: 'Paris', 'Country-PrimaryLocationName': 'France' }),
      fs:    makeFs({ exists: true }), fsPromises: makeFsp(),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.location).toBe('Paris, France');
  });

  it('retourne previewUrl = null si ensurePreview échoue', async () => {
    const sharpFn = vi.fn(() => {
      throw new Error('sharp error');
    });
    // source found, derivatives missing → generation is attempted and fails
    const fsPromises = makeFsp();
    fsPromises.stat.mockReset().mockResolvedValueOnce({ mtimeMs: 1000 }).mockRejectedValue(new Error('ENOENT'));
    const deps = {
      exifr: makeExifr(),
      fs:    makeFs({ exists: false }), fsPromises,
      sharp: sharpFn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.previewUrl).toBeNull();
  });

  it("encode les caractères spéciaux dans l'URL de la photo", async () => {
    const deps = {
      exifr: makeExifr(),
      fs:    makeFs({ exists: true }), fsPromises: makeFsp(),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Été 2024', 'ma photo.jpg', '/albums', deps);

    expect(meta.url).toBe('/photos/%C3%89t%C3%A9%202024/ma%20photo.jpg?v=1000');
  });
});

// ── preGenerateAll ────────────────────────────────────────────────────────────

describe('photoMeta (cas supplémentaires)', () => {
  it('utilise Headline comme nom si Title est absent', async () => {
    const deps = { exifr: makeExifr({ Headline: 'Mon titre' }), fs: makeFs({ exists: true }), fsPromises: makeFsp(), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.name).toBe('Mon titre');
  });

  it('utilise ObjectName comme nom si Title et Headline sont absents', async () => {
    const deps = { exifr: makeExifr({ ObjectName: 'ID-42' }), fs: makeFs({ exists: true }), fsPromises: makeFsp(), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.name).toBe('ID-42');
  });

  it('utilise ImageDescription courte comme nom si les champs titre sont vides', async () => {
    const deps = { exifr: makeExifr({ ImageDescription: 'Coucher de soleil' }), fs: makeFs({ exists: true }), fsPromises: makeFsp(), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.name).toBe('Coucher de soleil');
  });

  it('détecte is360 via UsePanoramaViewer=true', async () => {
    const deps = { exifr: makeExifr({ UsePanoramaViewer: true }), fs: makeFs({ exists: true }), fsPromises: makeFsp(), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'pano.jpg', '/albums/Paris', deps);
    expect(meta.is360).toBe(true);
  });

  it('extrait la description depuis Caption-Abstract si Description est absent', async () => {
    const deps = { exifr: makeExifr({ 'Caption-Abstract': 'Légende IPTC' }), fs: makeFs({ exists: true }), fsPromises: makeFsp(), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.description).toBe('Légende IPTC');
  });

  it('extrait la localisation IPTC avec Province-State', async () => {
    const deps = {
      exifr: makeExifr({ City: 'Nice', 'Province-State': "Côte d'Azur", 'Country-PrimaryLocationName': 'France' }),
      fs: makeFs({ exists: true }), fsPromises: makeFsp(),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.location).toBe("Nice, Côte d'Azur, France");
  });

  it('retourne gps: null si exifr.gps lève une exception', async () => {
    const deps = {
      exifr: { parse: vi.fn().mockResolvedValue({}), gps: vi.fn().mockRejectedValue(new Error('no GPS')) },
      fs:    makeFs({ exists: true }), fsPromises: makeFsp(),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.gps).toBeNull();
  });

  it('gère une erreur de parse EXIF sans planter et retourne les valeurs par défaut', async () => {
    const deps = {
      exifr: { parse: vi.fn().mockRejectedValue(new Error('corrupt EXIF')), gps: vi.fn().mockResolvedValue(null) },
      fs:    makeFs({ exists: true }), fsPromises: makeFsp(),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.filename).toBe('photo.jpg');
    expect(meta.name).toBe('photo');
    expect(meta.is360).toBe(false);
  });

  it('retourne mediumUrl dans le résultat', async () => {
    const deps = { exifr: makeExifr(), fs: makeFs({ exists: true }), fsPromises: makeFsp(), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.mediumUrl).toBe('/medium/Paris/photo.jpg.jpg?v=1000');
  });

  it('retourne mediumUrl: null si ensureMedium échoue', async () => {
    const sharpFn = vi.fn(() => { throw new Error('sharp crash'); });
    // source found, derivatives missing → generation is attempted and fails
    const fsPromises = makeFsp();
    fsPromises.stat.mockReset().mockResolvedValueOnce({ mtimeMs: 1000 }).mockRejectedValue(new Error('ENOENT'));
    const deps = { exifr: makeExifr(), fs: makeFs({ exists: false }), fsPromises, sharp: sharpFn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.mediumUrl).toBeNull();
    expect(meta.thumbUrl).toBeNull();
  });
});
