// Derived images on real files (real sharp, temporary directories).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deriv-'));
process.env.PHOTOS_DIR   = path.join(tmp, 'photos');
process.env.PREVIEWS_DIR = path.join(tmp, 'previews');
process.env.MEDIUM_DIR   = path.join(tmp, 'medium');

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const image = require('../../../services/image.js');
const { photoMeta, preGenerateAll, pruneDerivatives, PHOTOS_DIR, PREVIEWS_DIR, MEDIUM_DIR } = image;

const album = path.join(PHOTOS_DIR, 'Perth');
const img = (color, file, fmt = 'jpeg') => sharp({ create: { width: 2000, height: 1000, channels: 3, background: color } })[fmt]().toFile(path.join(album, file));
const pixel = async (file) => (await sharp(file).resize(1, 1).raw().toBuffer())[0];   // red channel
const pathOf = (url) => path.join(url.startsWith('/previews/') ? PREVIEWS_DIR : MEDIUM_DIR, ...url.split('?')[0].split('/').slice(2).map(decodeURIComponent));

beforeAll(async () => {
  fs.mkdirSync(album, { recursive: true });
  await img('#ff0000', 'IMG_1.jpg');
  await img('#0000ff', 'IMG_1.png', 'png');
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('derived images', () => {
  it('IMG_1.jpg and IMG_1.png get their own derivatives (no collision)', async () => {
    const jpg = await photoMeta('Perth', 'IMG_1.jpg', album);
    const png = await photoMeta('Perth', 'IMG_1.png', album);
    expect(jpg.previewUrl.split('?')[0]).toBe('/previews/Perth/IMG_1.jpg.jpg');
    expect(png.previewUrl.split('?')[0]).toBe('/previews/Perth/IMG_1.png.jpg');
    expect(await pixel(pathOf(jpg.previewUrl))).toBeGreaterThan(200);   // red
    expect(await pixel(pathOf(png.previewUrl))).toBeLessThan(50);       // blue
  });

  it('makes a small thumbnail, a 1024 px preview and a 1280 px medium', async () => {
    const m = await photoMeta('Perth', 'IMG_1.jpg', album);
    expect((await sharp(pathOf(m.thumbUrl)).metadata()).width).toBe(480);
    expect((await sharp(pathOf(m.previewUrl)).metadata()).width).toBe(1024);
    expect((await sharp(pathOf(m.mediumUrl)).metadata()).width).toBe(1280);
    expect(fs.statSync(pathOf(m.thumbUrl)).size).toBeLessThan(fs.statSync(pathOf(m.previewUrl)).size);
  });

  it('rebuilds derivatives and changes their URL when a photo is replaced', async () => {
    const before = await photoMeta('Perth', 'IMG_1.jpg', album);
    await new Promise((r) => setTimeout(r, 20));
    await img('#00ff00', 'IMG_1.jpg');                                   // replaced: now green
    const after = await photoMeta('Perth', 'IMG_1.jpg', album);
    expect(after.previewUrl).not.toBe(before.previewUrl);                // new ?v= → browsers refetch
    expect(await pixel(pathOf(after.previewUrl))).toBeLessThan(50);      // no longer red
  });

  it('pre-generation covers every photo; cleanup removes orphans and old-scheme files', async () => {
    fs.mkdirSync(path.join(PREVIEWS_DIR, 'Gone'), { recursive: true });
    fs.writeFileSync(path.join(PREVIEWS_DIR, 'Gone', 'x.jpg'), 'old album');
    fs.writeFileSync(path.join(PREVIEWS_DIR, 'Perth', 'IMG_1.jpg'), 'old naming scheme');
    await preGenerateAll();
    const left = fs.readdirSync(path.join(PREVIEWS_DIR, 'Perth')).sort();
    expect(left).toEqual(['IMG_1.jpg.jpg', 'IMG_1.jpg.thumb.jpg', 'IMG_1.png.jpg', 'IMG_1.png.thumb.jpg']);
    expect(fs.existsSync(path.join(PREVIEWS_DIR, 'Gone'))).toBe(false);
    expect(await pruneDerivatives()).toBe(0);                            // idempotent
  });
});
