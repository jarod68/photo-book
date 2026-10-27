// GPS position privacy per album (F10), with real files for the clean copy.
import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gpsp-'));
process.env.PHOTOS_DIR   = path.join(tmp, 'photos');
process.env.PREVIEWS_DIR = path.join(tmp, 'previews');
process.env.MEDIUM_DIR   = path.join(tmp, 'medium');

const _require   = createRequire(import.meta.url);
const database   = _require('../../../services/database.js');
const exif       = _require('../../../services/exif.js');
const gpsPrivacy = _require('../../../services/gps-privacy.js');

const photo = { filename: 'a.jpg', gps: { lat: 48.858370, lng: 2.294481 }, location: 'Paris' };
const admin = { id: 1, role: 'admin' };
const basic = { id: 2, role: 'basic' };

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('gps-privacy (F10)', () => {
  beforeEach(() => { database._reset(); gpsPrivacy._reset(); vi.useRealTimers(); });

  it('protect : exact inchangé, approx arrondi à ~1 km, hidden supprimé', () => {
    expect(gpsPrivacy.protect(photo, 'exact')).toBe(photo);
    expect(gpsPrivacy.protect(photo, 'approx')).toMatchObject({ gps: { lat: 48.86, lng: 2.29 }, gpsApprox: true, location: 'Paris' });
    expect(gpsPrivacy.protect(photo, 'hidden')).toMatchObject({ gps: null, location: 'Paris' });
    expect(photo.gps.lat).toBe(48.858370);                         // never mutated
    expect(gpsPrivacy.protect({ filename: 'v.mp4', gps: null }, 'approx').gps).toBeNull();
  });

  it('protectAll : les admins voient toujours la position exacte', async () => {
    database._setState({ query: vi.fn().mockResolvedValue({ rows: [{ album: 'Paris', gps_privacy: 'hidden' }] }) }, true);
    expect((await gpsPrivacy.protectAll('Paris', [photo], admin))[0].gps).toEqual(photo.gps);
    expect((await gpsPrivacy.protectAll('Paris', [photo], basic))[0].gps).toBeNull();
    expect((await gpsPrivacy.protectAll('Paris', [photo], null))[0].gps).toBeNull();
    expect((await gpsPrivacy.protectAll('Lyon', [photo], null))[0].gps).toEqual(photo.gps);   // not set = exact
    expect(await gpsPrivacy.exactFor('Paris', admin)).toBe(true);
    expect(await gpsPrivacy.exactFor('Paris', basic)).toBe(false);
  });

  it('les réglages sont relus au plus une fois par minute, tout de suite après invalidate()', async () => {
    vi.useFakeTimers();
    const query = vi.fn().mockResolvedValue({ rows: [{ album: 'Paris', gps_privacy: 'approx' }] });
    database._setState({ query }, true);
    await gpsPrivacy.modeFor('Paris'); await gpsPrivacy.modeFor('Lyon');
    expect(query).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    await gpsPrivacy.modeFor('Paris');
    expect(query).toHaveBeenCalledTimes(2);
    gpsPrivacy.invalidate();
    await gpsPrivacy.modeFor('Paris');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('base indisponible : les derniers réglages connus restent appliqués', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ album: 'Paris', gps_privacy: 'hidden' }] });
    database._setState({ query }, true);
    expect(await gpsPrivacy.modeFor('Paris')).toBe('hidden');
    gpsPrivacy.invalidate();
    query.mockRejectedValue(new Error('down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await gpsPrivacy.modeFor('Paris')).toBe('hidden');
    err.mockRestore();
  });

  it('cleanCopy : une copie pleine taille sans aucune métadonnée GPS', async () => {
    const dir = path.join(process.env.PHOTOS_DIR, 'Perth');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(import.meta.dirname, '../fixtures/gps.jpg'), path.join(dir, 'gps.jpg'));
    expect((await exif.gps(path.join(dir, 'gps.jpg')))?.latitude).toBeCloseTo(-31.95, 1);
    const copy = await gpsPrivacy.cleanCopy('Perth', 'gps.jpg');
    expect(copy).toBe(path.join(process.env.MEDIUM_DIR, 'Perth', 'gps.jpg.full.jpg'));
    expect(await exif.gps(copy)).toBeUndefined();
    expect(gpsPrivacy.cleanName('IMG_1.JPG')).toBe('IMG_1.JPG');
    expect(gpsPrivacy.cleanName('IMG_1.png')).toBe('IMG_1.png.jpg');
  });
});
