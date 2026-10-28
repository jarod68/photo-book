// The cached photo index on real files (temp dirs, real sharp / EXIF).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));
process.env.PHOTOS_DIR   = path.join(tmp, 'photos');
process.env.PREVIEWS_DIR = path.join(tmp, 'previews');
process.env.MEDIUM_DIR   = path.join(tmp, 'medium');

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const library = require('../../../services/library.js');
const album = path.join(process.env.PHOTOS_DIR, 'Perth');
const FIXTURE = path.join(import.meta.dirname, '../fixtures/gps.jpg');   // GPS + date

beforeAll(async () => {
  fs.mkdirSync(album, { recursive: true });
  fs.copyFileSync(FIXTURE, path.join(album, 'a.jpg'));
  await sharp({ create: { width: 64, height: 64, channels: 3, background: 'red' } }).jpeg().toFile(path.join(album, 'b.jpg'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('library (T2)', () => {
  it('lists albums and photos', async () => {
    expect(await library.listAlbums()).toEqual(['Perth']);
    expect(await library.listPhotos('Perth')).toEqual(['a.jpg', 'b.jpg']);
    expect(await library.getAlbumPhotos('Nope')).toBeNull();
    expect(await library.albumExists('Perth')).toBe(true);
    expect(await library.albumExists('Nope')).toBe(false);
    fs.writeFileSync(path.join(process.env.PHOTOS_DIR, 'file.txt'), 'x');
    expect(await library.albumExists('file.txt')).toBe(false);   // a file is not an album
    await expect(library.albumExists('../etc')).rejects.toThrow('Invalid album');
  });

  it('returns the cached metadata while the file is unchanged', async () => {
    const [a1] = await library.getAlbumPhotos('Perth');
    const [a2] = await library.getAlbumPhotos('Perth');
    expect(a2).toBe(a1);                              // same object: not recomputed
    expect(a1.gps.lat).toBeCloseTo(-31.9523, 4);
    expect(a1.takenAt).toBe(new Date(2025, 2, 21, 10).toISOString());
  });

  it('recomputes a photo whose file changed', async () => {
    const before = await library.getPhoto('Perth', 'b.jpg');
    await new Promise((r) => setTimeout(r, 20));
    await sharp({ create: { width: 64, height: 64, channels: 3, background: 'blue' } }).jpeg().toFile(path.join(album, 'b.jpg'));
    const after = await library.getPhoto('Perth', 'b.jpg');
    expect(after).not.toBe(before);
    expect(after.previewUrl).not.toBe(before.previewUrl);
  });

  it('forgets deleted photos and shares concurrent computations', async () => {
    fs.unlinkSync(path.join(album, 'b.jpg'));
    expect((await library.getAlbumPhotos('Perth')).map((p) => p.filename)).toEqual(['a.jpg']);
    library.clear();
    const [x, y] = await Promise.all([library.getPhoto('Perth', 'a.jpg'), library.getPhoto('Perth', 'a.jpg')]);
    expect(x).toBe(y);
    expect(library.size()).toBe(1);
  });

  it('warmAll() reads every album once; allPhotos() returns them all', async () => {
    const files = await library.listPhotos('Perth');   // an earlier test deleted one
    library.clear();
    await library.warmAll();
    expect(library.size()).toBe(files.length);
    expect((await library.allPhotos()).map((p) => p.filename)).toEqual(files);
  });

  it('invalidate() drops entries; album paths cannot escape PHOTOS_DIR', async () => {
    library.invalidate('Perth');
    expect(library.size()).toBe(0);
    expect(() => library.albumPath('../etc')).toThrow('Invalid album');
  });
});

describe('isWritable (QA read-only library)', () => {
  it('vrai sur un dossier inscriptible, faux s\'il ne l\'est pas, relu au plus une fois par minute', async () => {
    library._resetWritable();
    expect(await library.isWritable()).toBe(true);
    fs.chmodSync(process.env.PHOTOS_DIR, 0o555);
    try {
      expect(await library.isWritable()).toBe(true);           // cached
      library._resetWritable();
      // root ignores permission bits: only meaningful as a normal user (CI, the pod)
      if (process.getuid?.() !== 0) expect(await library.isWritable()).toBe(false);
    } finally {
      fs.chmodSync(process.env.PHOTOS_DIR, 0o755);
      library._resetWritable();
    }
  });
});
