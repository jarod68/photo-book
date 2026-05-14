import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ensurePreview, photoMeta, preGenerateAll, PREVIEWS_DIR } from '../../services/image.js';
import path from 'path';

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
  it('returns the URL without calling sharp if preview already exists', async () => {
    const { fn: sharpFn } = makeSharp();
    const mockFs = makeFs({ exists: true });

    const url = await ensurePreview('Paris', 'photo.jpg', '/photos/Paris/photo.jpg', false, {
      fs: mockFs, sharp: sharpFn,
    });

    expect(sharpFn).not.toHaveBeenCalled();
    expect(url).toBe('/previews/Paris/photo.jpg');
  });

  it('creates the folder and generates the preview if absent', async () => {
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

  it('encodes special characters in the returned URL', async () => {
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
  it('returns default values when no EXIF data', async () => {
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

  it('uses EXIF Title field as name', async () => {
    const deps = {
      exifr: makeExifr({ Title: 'Tour Eiffel' }),
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.name).toBe('Tour Eiffel');
  });

  it('ignores EXIF placeholder values', async () => {
    const deps = {
      exifr: makeExifr({ Title: 'OLYMPUS DIGITAL CAMERA' }),
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'ma-photo.jpg', '/albums/Paris', deps);

    expect(meta.name).toBe('ma-photo');
  });

  it("detects is360 via ProjectionType 'equirectangular'", async () => {
    const deps = {
      exifr: makeExifr({ ProjectionType: 'equirectangular' }),
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'pano.jpg', '/albums/Paris', deps);

    expect(meta.is360).toBe(true);
  });

  it('detects is360 via 2:1 aspect ratio (ImageWidth/ImageHeight)', async () => {
    const deps = {
      exifr: makeExifr({ ImageWidth: 8000, ImageHeight: 4000 }),
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'pano.jpg', '/albums/Paris', deps);

    expect(meta.is360).toBe(true);
  });

  it('extracts GPS coordinates', async () => {
    const mockExifr = {
      parse: vi.fn().mockResolvedValue({}),
      gps:   vi.fn().mockResolvedValue({ latitude: 48.856600, longitude: 2.352200 }),
    };
    const deps = { exifr: mockExifr, fs: makeFs({ exists: true }), sharp: makeSharp().fn };

    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.gps).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  it('extracts IPTC location (City + Country)', async () => {
    const deps = {
      exifr: makeExifr({ City: 'Paris', 'Country-PrimaryLocationName': 'France' }),
      fs:    makeFs({ exists: true }),
      sharp: makeSharp().fn,
    };
    const meta = await photoMeta('Paris', 'photo.jpg', '/albums/Paris', deps);

    expect(meta.location).toBe('Paris, France');
  });

  it('returns previewUrl = null if ensurePreview fails', async () => {
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

  it('encodes special characters in the photo URL', async () => {
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
  it('does nothing if PHOTOS_DIR does not exist', async () => {
    const mockFs = { existsSync: vi.fn().mockReturnValue(false), readdirSync: vi.fn() };

    await preGenerateAll({ fs: mockFs });

    expect(mockFs.readdirSync).not.toHaveBeenCalled();
  });

  it('generates missing previews for each photo', async () => {
    const dir  = name => ({ isDirectory: () => true,  name });
    const { fn: sharpFn } = makeSharp();

    const mockFs = {
      existsSync: vi.fn()
        .mockReturnValueOnce(true)   // PHOTOS_DIR exists
        .mockReturnValue(false),     // no previews exist
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

  it('skips photos whose preview already exists', async () => {
    const dir = name => ({ isDirectory: () => true, name });
    const { fn: sharpFn } = makeSharp();

    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true), // everything exists (PHOTOS_DIR + previews)
      mkdirSync:   vi.fn(),
      readdirSync: vi.fn()
        .mockReturnValueOnce([dir('Paris')])
        .mockReturnValue(['photo.jpg']),
    };
    const deps = { fs: mockFs, sharp: sharpFn, exifr: makeExifr() };

    await preGenerateAll(deps);

    expect(sharpFn).not.toHaveBeenCalled();
  });
});
