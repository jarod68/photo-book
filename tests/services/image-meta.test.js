import { vi, describe, it, expect, afterEach } from 'vitest';
import { ensurePreview, ensureMedium, photoMeta, preGenerateAll, PREVIEWS_DIR, MEDIUM_DIR } from '../../services/image.js';
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

function makeExifr(data = {}, gpsData = null) {
  return {
    parse: vi.fn().mockResolvedValue(data),
    gps:   vi.fn().mockResolvedValue(gpsData),
  };
}

// ── ensurePreview ─────────────────────────────────────────────────────────────

describe('ensurePreview', () => {
  it("retourne l'URL sans appeler sharp si la preview existe déjà", async () => {
    const { fn: sharpFn } = makeSharp();
    const mockFs = makeFs({ exists: true });

    const url = await ensurePreview('Paris', 'photo.jpg', '/photos/Paris/photo.jpg', false, {
      fs: mockFs, sharp: sharpFn,
    });

    expect(sharpFn).not.toHaveBeenCalled();
    expect(url).toBe('/previews/Paris/photo.jpg');
  });

  it('crée le dossier et génère la preview si elle est absente', async () => {
    const { fn: sharpFn, chain } = makeSharp();
    const mockFs = makeFs({ exists: false });

    await ensurePreview('Paris', 'photo.jpg', '/photos/Paris/photo.jpg', false, {
      fs: mockFs, sharp: sharpFn,
    });

    const expectedDir = path.join(PREVIEWS_DIR, 'Paris');
    expect(mockFs.mkdirSync).toHaveBeenCalledWith(expectedDir, { recursive: true });
    expect(sharpFn).toHaveBeenCalledWith('/photos/Paris/photo.jpg');
    expect(chain.rotate).toHaveBeenCalled();
    expect(chain.toFile).toHaveBeenCalled();
  });

  it('utilise la largeur 1024 pour une photo standard', async () => {
    const { fn: sharpFn, chain } = makeSharp();
    const mockFs = makeFs({ exists: false });

    await ensurePreview('Paris', 'photo.jpg', '/src/photo.jpg', false, {
      fs: mockFs, sharp: sharpFn,
    });

    expect(chain.resize).toHaveBeenCalledWith(1024, null, { withoutEnlargement: true });
  });

  it('utilise la largeur 1536 pour une photo 360°', async () => {
    const { fn: sharpFn, chain } = makeSharp();
    const mockFs = makeFs({ exists: false });

    await ensurePreview('Paris', 'pano.jpg', '/src/pano.jpg', true, {
      fs: mockFs, sharp: sharpFn,
    });

    expect(chain.resize).toHaveBeenCalledWith(1536, null, { withoutEnlargement: true });
  });

  it("encode les caractères spéciaux dans l'URL retournée", async () => {
    const { fn: sharpFn } = makeSharp();
    const mockFs = makeFs({ exists: true });

    const url = await ensurePreview('Été 2024', 'photo été.jpg', '/src', false, {
      fs: mockFs, sharp: sharpFn,
    });

    expect(url).toBe('/previews/%C3%89t%C3%A9%202024/photo%20%C3%A9t%C3%A9.jpg');
  });

  it('convertit le nom du fichier en .jpg pour la preview', async () => {
    const { fn: sharpFn } = makeSharp();
    const mockFs = makeFs({ exists: true });

    const url = await ensurePreview('Paris', 'image.png', '/src/image.png', false, {
      fs: mockFs, sharp: sharpFn,
    });

    expect(url).toBe('/previews/Paris/image.jpg');
  });
});

// ── photoMeta ─────────────────────────────────────────────────────────────────

describe('photoMeta', () => {
  it('retourne les valeurs par défaut quand aucune donnée EXIF', async () => {
    const deps = {
      exifr: makeExifr(),
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.filename).toBe('photo.jpg');
    expect(meta.name).toBe('photo');
    expect(meta.description).toBe('');
    expect(meta.is360).toBe(false);
    expect(meta.gps).toBeNull();
    expect(meta.location).toBeNull();
    expect(meta.url).toBe('/photos/Paris/photo.jpg');
    expect(meta.previewUrl).toBe('/previews/Paris/photo.jpg');
  });

  it('utilise le champ Title EXIF comme nom', async () => {
    const deps = {
      exifr: makeExifr({ Title: 'Tour Eiffel' }),
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.name).toBe('Tour Eiffel');
  });

  it('ignore les valeurs placeholder EXIF', async () => {
    const deps = {
      exifr: makeExifr({ Title: 'OLYMPUS DIGITAL CAMERA' }),
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'ma-photo.jpg', '/albums/Paris', deps);

    expect(meta.name).toBe('ma-photo');
  });

  it("détecte is360 via ProjectionType 'equirectangular'", async () => {
    const deps = {
      exifr: makeExifr({ ProjectionType: 'equirectangular' }),
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'pano.jpg', '/albums/Paris', deps);

    expect(meta.is360).toBe(true);
  });

  it("détecte is360 via le ratio d'aspect 2:1 (ImageWidth/ImageHeight)", async () => {
    const deps = {
      exifr: makeExifr({ ImageWidth: 8000, ImageHeight: 4000 }),
      fs:    makeFs({ exists: true }),
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
    const deps = { exifr: mockExifr, fs: makeFs({ exists: true }), sharp: makeSharp().fn };

    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.gps).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  it('extrait la location IPTC (City + Country)', async () => {
    const deps = {
      exifr: makeExifr({ City: 'Paris', 'Country-PrimaryLocationName': 'France' }),
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.location).toBe('Paris, France');
  });

  it('retourne previewUrl = null si ensurePreview échoue', async () => {
    const sharpFn = vi.fn(() => {
      throw new Error('sharp error');
    });
    const deps = {
      exifr: makeExifr(),
      fs:    makeFs({ exists: false }), // force sharp call
      sharp: sharpFn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.previewUrl).toBeNull();
  });

  it("encode les caractères spéciaux dans l'URL de la photo", async () => {
    const deps = {
      exifr: makeExifr(),
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Été 2024', 'ma photo.jpg', '/albums', deps);

    expect(meta.url).toBe('/photos/%C3%89t%C3%A9%202024/ma%20photo.jpg');
  });
});

// ── preGenerateAll ────────────────────────────────────────────────────────────

describe('preGenerateAll', () => {
  it("ne fait rien si PHOTOS_DIR n'existe pas", async () => {
    const mockFs = { existsSync: vi.fn().mockReturnValue(false), readdirSync: vi.fn() };

    await preGenerateAll({ fs: mockFs });

    expect(mockFs.readdirSync).not.toHaveBeenCalled();
  });

  it('génère les previews manquantes pour chaque photo', async () => {
    const dir  = name => ({ isDirectory: () => true,  name });
    const { fn: sharpFn } = makeSharp();

    const mockFs = {
      existsSync: vi.fn()
        .mockReturnValueOnce(true)   // PHOTOS_DIR existe
        .mockReturnValue(false),     // aucune preview n'existe
      mkdirSync:   vi.fn(),
      readdirSync: vi.fn()
        .mockReturnValueOnce([dir('Paris')])     // albums
        .mockReturnValue(['a.jpg', 'b.jpg']),    // photos dans l'album
    };
    const mockExifr = makeExifr();
    const deps = { fs: mockFs, sharp: sharpFn, exifr: mockExifr };

    await preGenerateAll(deps);

    expect(sharpFn).toHaveBeenCalledTimes(4); // preview + medium × 2 photos
  });

  it('saute les photos dont la preview existe déjà', async () => {
    const dir = name => ({ isDirectory: () => true, name });
    const { fn: sharpFn } = makeSharp();

    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true), // tout existe (PHOTOS_DIR + previews)
      mkdirSync:   vi.fn(),
      readdirSync: vi.fn()
        .mockReturnValueOnce([dir('Paris')])
        .mockReturnValue(['photo.jpg']),
    };
    const deps = { fs: mockFs, sharp: sharpFn, exifr: makeExifr() };

    await preGenerateAll(deps);

    expect(sharpFn).not.toHaveBeenCalled();
  });

  it('filtre les dossiers cachés (commençant par un point)', async () => {
    const dir = name => ({ isDirectory: () => true, name });
    const { fn: sharpFn } = makeSharp();

    const mockFs = {
      existsSync:  vi.fn().mockReturnValue(true),
      mkdirSync:   vi.fn(),
      readdirSync: vi.fn()
        .mockReturnValueOnce([dir('.hidden'), dir('Paris')])
        .mockReturnValueOnce([]), // Paris → aucun fichier
    };
    await preGenerateAll({ fs: mockFs, sharp: sharpFn, exifr: makeExifr() });

    // Seulement 2 appels : PHOTOS_DIR + Paris (.hidden ignoré)
    expect(mockFs.readdirSync).toHaveBeenCalledTimes(2);
  });

  it('log le nombre de thumbnails générés', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = name => ({ isDirectory: () => true, name });
    const { fn: sharpFn } = makeSharp();

    const mockFs = {
      existsSync: vi.fn()
        .mockReturnValueOnce(true)  // PHOTOS_DIR
        .mockReturnValue(false),    // previews absentes
      mkdirSync:   vi.fn(),
      readdirSync: vi.fn()
        .mockReturnValueOnce([dir('Paris')])
        .mockReturnValue(['photo.jpg']),
    };
    await preGenerateAll({ fs: mockFs, sharp: sharpFn, exifr: makeExifr() });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 thumbnail'));
  });

  it("n'affiche pas de log si aucun thumbnail n'est généré", async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = name => ({ isDirectory: () => true, name });

    const mockFs = {
      existsSync:  vi.fn().mockReturnValue(true),
      readdirSync: vi.fn()
        .mockReturnValueOnce([dir('Paris')])
        .mockReturnValue([]),
    };
    await preGenerateAll({ fs: mockFs, exifr: makeExifr() });

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('thumbnail'));
  });

  it('continue si sharp échoue (erreur absorbée par photoMeta)', async () => {
    const dir = name => ({ isDirectory: () => true, name });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const mockFs = {
      existsSync: vi.fn()
        .mockReturnValueOnce(true)  // PHOTOS_DIR
        .mockReturnValue(false),    // previews absentes
      mkdirSync:   vi.fn(),
      readdirSync: vi.fn()
        .mockReturnValueOnce([dir('Paris')])
        .mockReturnValue(['a.jpg', 'b.jpg']),
    };
    const failingSharp = vi.fn(() => { throw new Error('sharp failed'); });
    const deps = { fs: mockFs, sharp: failingSharp, exifr: makeExifr() };

    await preGenerateAll(deps);
    // preGenerateAll completes without throwing — photoMeta swallows errors
  });
});

// ── ensureMedium ──────────────────────────────────────────────────────────────

describe('ensureMedium', () => {
  it("retourne l'URL sans appeler sharp si le medium existe déjà", async () => {
    const { fn: sharpFn } = makeSharp();
    const mockFs = makeFs({ exists: true });

    const url = await ensureMedium('Paris', 'photo.jpg', '/photos/Paris/photo.jpg', {
      fs: mockFs, sharp: sharpFn,
    });

    expect(sharpFn).not.toHaveBeenCalled();
    expect(url).toBe('/medium/Paris/photo.jpg');
  });

  it('crée le dossier et génère le medium si absent', async () => {
    const { fn: sharpFn, chain } = makeSharp();
    const mockFs = makeFs({ exists: false });

    await ensureMedium('Paris', 'photo.jpg', '/photos/Paris/photo.jpg', {
      fs: mockFs, sharp: sharpFn,
    });

    const expectedDir = path.join(MEDIUM_DIR, 'Paris');
    expect(mockFs.mkdirSync).toHaveBeenCalledWith(expectedDir, { recursive: true });
    expect(sharpFn).toHaveBeenCalledWith('/photos/Paris/photo.jpg');
    expect(chain.rotate).toHaveBeenCalled();
    expect(chain.toFile).toHaveBeenCalled();
  });

  it('utilise toujours la largeur 1280', async () => {
    const { fn: sharpFn, chain } = makeSharp();

    await ensureMedium('Paris', 'photo.jpg', '/src/photo.jpg', {
      fs: makeFs({ exists: false }), sharp: sharpFn,
    });

    expect(chain.resize).toHaveBeenCalledWith(1280, null, { withoutEnlargement: true });
  });

  it('convertit le nom du fichier en .jpg pour le medium', async () => {
    const { fn: sharpFn } = makeSharp();

    const url = await ensureMedium('Paris', 'image.png', '/src/image.png', {
      fs: makeFs({ exists: true }), sharp: sharpFn,
    });

    expect(url).toBe('/medium/Paris/image.jpg');
  });

  it("encode les caractères spéciaux dans l'URL", async () => {
    const { fn: sharpFn } = makeSharp();

    const url = await ensureMedium('Été 2024', 'ma photo.jpg', '/src', {
      fs: makeFs({ exists: true }), sharp: sharpFn,
    });

    expect(url).toBe('/medium/%C3%89t%C3%A9%202024/ma%20photo.jpg');
  });
});

// ── photoMeta — cas supplémentaires ──────────────────────────────────────────

describe('photoMeta (cas supplémentaires)', () => {
  it('utilise Headline comme nom si Title est absent', async () => {
    const deps = { exifr: makeExifr({ Headline: 'Mon titre' }), fs: makeFs({ exists: true }), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.name).toBe('Mon titre');
  });

  it('utilise ObjectName comme nom si Title et Headline sont absents', async () => {
    const deps = { exifr: makeExifr({ ObjectName: 'ID-42' }), fs: makeFs({ exists: true }), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.name).toBe('ID-42');
  });

  it('utilise ImageDescription courte comme nom si les champs titre sont vides', async () => {
    const deps = { exifr: makeExifr({ ImageDescription: 'Coucher de soleil' }), fs: makeFs({ exists: true }), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.name).toBe('Coucher de soleil');
  });

  it('détecte is360 via UsePanoramaViewer=true', async () => {
    const deps = { exifr: makeExifr({ UsePanoramaViewer: true }), fs: makeFs({ exists: true }), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'pano.jpg', '/albums/Paris', deps);
    expect(meta.is360).toBe(true);
  });

  it('extrait la description depuis Caption-Abstract si Description est absent', async () => {
    const deps = { exifr: makeExifr({ 'Caption-Abstract': 'Légende IPTC' }), fs: makeFs({ exists: true }), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.description).toBe('Légende IPTC');
  });

  it('extrait la localisation IPTC avec Province-State', async () => {
    const deps = {
      exifr: makeExifr({ City: 'Nice', 'Province-State': "Côte d'Azur", 'Country-PrimaryLocationName': 'France' }),
      fs: makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.location).toBe("Nice, Côte d'Azur, France");
  });

  it('retourne gps: null si exifr.gps lève une exception', async () => {
    const deps = {
      exifr: { parse: vi.fn().mockResolvedValue({}), gps: vi.fn().mockRejectedValue(new Error('no GPS')) },
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.gps).toBeNull();
  });

  it('gère une erreur de parse EXIF sans planter et retourne les valeurs par défaut', async () => {
    const deps = {
      exifr: { parse: vi.fn().mockRejectedValue(new Error('corrupt EXIF')), gps: vi.fn().mockResolvedValue(null) },
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.filename).toBe('photo.jpg');
    expect(meta.name).toBe('photo');
    expect(meta.is360).toBe(false);
  });

  it('retourne mediumUrl dans le résultat', async () => {
    const deps = { exifr: makeExifr(), fs: makeFs({ exists: true }), sharp: makeSharp().fn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.mediumUrl).toBe('/medium/Paris/photo.jpg');
  });

  it('retourne mediumUrl: null si ensureMedium échoue', async () => {
    const sharpFn = vi.fn(() => { throw new Error('sharp crash'); });
    const deps = { exifr: makeExifr(), fs: makeFs({ exists: false }), sharp: sharpFn };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);
    expect(meta.mediumUrl).toBeNull();
  });
});
