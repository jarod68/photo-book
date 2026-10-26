// Real files, no mocks: services/exif.js (ExifReader behind exifr's API).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const exif = require('../../../services/exif.js');
const sharp = require('sharp');

// JPEG with GPS (-31.9523, 115.8613), DateTimeOriginal 2025:03:21 10:00:00 and
// GPano ProjectionType=equirectangular (XMP).
const FIXTURE = path.join(import.meta.dirname, '../fixtures/gps.jpg');
let tmp;
const at = (f) => path.join(tmp, f);

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exif-'));
  fs.writeFileSync(at('empty.jpg'), '');
  fs.writeFileSync(at('garbage.jpg'), 'not an image');
  fs.writeFileSync(at('truncated.jpg'), fs.readFileSync(FIXTURE).subarray(0, 40));
  const img = () => sharp({ create: { width: 64, height: 32, channels: 3, background: 'red' } });
  await img().jpeg().toFile(at('bare.jpg'));
  await img().withExif({ IFD0: { Make: 'Canon', Model: 'EOS R6' } }).webp().toFile(at('meta.webp'));
  await img().png().toFile(at('wide.png'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('services/exif', () => {
  it('reads GPS from a real JPEG', async () => {
    const g = await exif.gps(FIXTURE);
    expect(g.latitude).toBeCloseTo(-31.9523, 4);
    expect(g.longitude).toBeCloseTo(115.8613, 4);
  });

  it('parses EXIF dates (local time, as exifr did) and XMP panorama tags', async () => {
    const d = await exif.parse(FIXTURE, { xmp: true, iptc: true, exif: true, gps: true, icc: false, jfif: false });
    expect(d.ProjectionType).toBe('equirectangular');
    expect(d.DateTimeOriginal).toEqual(new Date(2025, 2, 21, 10, 0, 0));
    expect(d.latitude).toBeCloseTo(-31.9523, 4);
  });

  it('exposes the XMP / IPTC / EXIF fields image.js reads under its own names', async () => {
    // rich.jpg: XMP dc:title / dc:description, IPTC caption + city / state /
    // country, EXIF UserComment + 35 mm focal length (exifr never surfaced these).
    const d = await exif.parse(path.join(import.meta.dirname, '../fixtures/rich.jpg'), {});
    expect(d).toMatchObject({
      Title: 'XMP title', Description: 'XMP description', 'Caption-Abstract': 'Caption from IPTC',
      UserComment: 'Shot from the bridge', City: 'Porto', 'Province-State': 'Norte',
      'Country-PrimaryLocationName': 'Portugal', FocalLengthIn35mmFilm: 24, Make: 'DJI',
    });
  });

  it('parse(file, [keys]) returns only those keys, or undefined', async () => {
    expect(Object.keys(await exif.parse(FIXTURE, ['DateTimeOriginal', 'CreateDate']))).toEqual(['DateTimeOriginal']);
    expect(await exif.parse(at('bare.jpg'), ['DateTimeOriginal', 'CreateDate'])).toBeUndefined();
    expect(await exif.gps(at('bare.jpg'))).toBeUndefined();
  });

  it('reads WebP EXIF (exifr could not) and PNG dimensions', async () => {
    expect(await exif.parse(at('meta.webp'), {})).toMatchObject({ Make: 'Canon', Model: 'EOS R6' });
    expect(await exif.parse(at('wide.png'), {})).toMatchObject({ ImageWidth: 64, ImageHeight: 32 });
  });

  it('rejects unreadable files, like exifr', async () => {
    await expect(exif.gps(at('garbage.jpg'))).rejects.toThrow();
    await expect(exif.gps(at('empty.jpg'))).rejects.toThrow();
    await expect(exif.gps(at('missing.jpg'))).rejects.toThrow();
  });

  it('reads only the JPEG header (up to the image data), not the whole file', async () => {
    const big = at('big.jpg');
    fs.writeFileSync(big, Buffer.concat([fs.readFileSync(FIXTURE), Buffer.alloc(2 * 1024 * 1024)]));
    const bytes = await exif.readMetadataBytes(big);
    expect(bytes.length).toBeLessThan(fs.readFileSync(FIXTURE).length);
    expect((await exif.gps(big)).latitude).toBeCloseTo(-31.9523, 4);
  });

  it('explicitly closes every file it opens, even when parsing fails', async () => {
    // Node 26 kills the process when a FileHandle is garbage-collected while
    // still open, so every handle must be closed explicitly. Record each one.
    const opened = [];
    const realOpen = fs.promises.open;
    const spy = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const fh = await realOpen.apply(fs.promises, args);
      const entry = { closed: false };
      const realClose = fh.close.bind(fh);
      fh.close = async () => { entry.closed = true; return realClose(); };
      opened.push(entry);
      return fh;
    });
    try {
      const files = ['empty.jpg', 'garbage.jpg', 'truncated.jpg'].map(at);
      await Promise.all(Array.from({ length: 30 }, (_, i) => exif.gps(files[i % 3]).catch(() => null)));
      await Promise.all(Array.from({ length: 10 }, () => exif.gps(FIXTURE)));
    } finally {
      spy.mockRestore();
    }
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.filter((e) => !e.closed)).toHaveLength(0);
  });
});
