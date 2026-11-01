import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const _require = createRequire(import.meta.url);
const library = _require('../../../services/library.js');
const dup     = _require('../../../services/duplicates.js');

describe('doublons (admin)', () => {
  let root;
  const photos = {};
  const put = (album, filename, bytes, meta = {}) => {
    fs.mkdirSync(path.join(root, album), { recursive: true });
    fs.writeFileSync(path.join(root, album, filename), bytes);
    (photos[album] ??= []).push({ filename, type: 'photo', name: filename, url: `/photos/${album}/${filename}`, takenAt: null, exif: null, ...meta });
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-'));
    for (const k of Object.keys(photos)) delete photos[k];
    dup._reset();
    vi.spyOn(library, 'listAlbums').mockImplementation(async () => Object.keys(photos));
    vi.spyOn(library, 'getAlbumPhotos').mockImplementation(async (a) => photos[a]);
  });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

  it('trouve les fichiers identiques (même taille puis même empreinte) et les copies probables', async () => {
    const shot = { takenAt: '2025-06-03T10:00:00.000Z' };
    put('Paris', 'A.jpg', Buffer.from('same bytes here'), { ...shot, exif: { make: 'Apple', model: 'iPhone 15', width: 4000, height: 3000 } });
    put('Best of', 'A copy.jpg', Buffer.from('same bytes here'));                     // identical to Paris/A.jpg
    put('Paris', 'B.jpg', Buffer.from('other bytes!!!!'));                            // same size, other content
    put('Paris', 'C.heic', Buffer.from('heic original, bigger'), { ...shot, exif: { make: 'Apple', model: 'iPhone 15', width: 3000, height: 4000 } });
    put('Paris', 'C.jpg', Buffer.from('its jpeg export'), { ...shot, exif: { make: 'Apple', model: 'iPhone 15', width: 1500, height: 2000 } });
    put('Paris', 'D.jpg', Buffer.from('another shot'), { takenAt: '2025-06-03T10:00:01.000Z', exif: { make: 'Apple', model: 'iPhone 15', width: 4000, height: 3000 } });

    const { identical, probable } = await dup.findDuplicates({ root });
    expect(identical.map((g) => g.map((p) => `${p.album}/${p.filename}`))).toEqual([['Best of/A copy.jpg', 'Paris/A.jpg']]);
    expect(identical[0][0].size).toBe(15);
    // C.heic and C.jpg: same second, camera, proportions (rotated); A.jpg is already identical elsewhere
    expect(probable.map((g) => g.map((p) => p.filename))).toEqual([['C.heic', 'C.jpg']]);
  });
});
