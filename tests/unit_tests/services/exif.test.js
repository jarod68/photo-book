// Real files, no mocks: exifr's own fs reader is what broke on Node 26
// (services/exif.js). These run on the CI's Node version.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const exif = require('../../../services/exif.js');

const FIXTURE = path.join(import.meta.dirname, '../fixtures/gps.jpg');   // GPS + DateTimeOriginal + GPano XMP
let tmp;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exif-'));
  fs.writeFileSync(path.join(tmp, 'empty.jpg'), '');
  fs.writeFileSync(path.join(tmp, 'garbage.jpg'), 'not an image');
  fs.writeFileSync(path.join(tmp, 'truncated.jpg'), fs.readFileSync(FIXTURE).subarray(0, 40));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('services/exif (exifr, Node 26 safe)', () => {
  it('reads GPS from a real JPEG path', async () => {
    const g = await exif.gps(FIXTURE);
    expect(g.latitude).toBeCloseTo(-31.9523, 4);
    expect(g.longitude).toBeCloseTo(115.8613, 4);
  });

  it('parses EXIF dates and XMP panorama tags', async () => {
    const d = await exif.parse(FIXTURE, { xmp: true, iptc: true, exif: true, gps: true, icc: false, jfif: false });
    expect(d.ProjectionType).toBe('equirectangular');
    expect(d.DateTimeOriginal).toBeInstanceOf(Date);
    const tags = await exif.parse(FIXTURE, ['DateTimeOriginal', 'CreateDate']);
    expect(tags.DateTimeOriginal).toBeInstanceOf(Date);
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
      const files = ['empty.jpg', 'garbage.jpg', 'truncated.jpg'].map((f) => path.join(tmp, f));
      await Promise.all(Array.from({ length: 30 }, (_, i) => exif.gps(files[i % 3]).catch(() => null)));
      await Promise.all(Array.from({ length: 10 }, () => exif.gps(FIXTURE)));
    } finally {
      spy.mockRestore();
    }
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.filter((e) => !e.closed)).toHaveLength(0);
  });
});
