import { createRequire } from 'module';
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const _require = createRequire(import.meta.url);
const { uniqueName, sameContent } = _require('../../../services/uploads.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('uploads (F7)', () => {
  it('garde le nom quand il est libre, suffixe sinon', () => {
    fs.writeFileSync(path.join(dir, 'IMG_1.jpg'), 'a');
    fs.writeFileSync(path.join(dir, 'IMG_1 (2).jpg'), 'b');
    expect(uniqueName(dir, 'new.jpg')).toBe('new.jpg');
    expect(uniqueName(dir, 'IMG_1.jpg')).toBe('IMG_1 (3).jpg');
    expect(uniqueName(dir, 'noext')).toBe('noext');
  });

  it('tient compte des noms déjà donnés dans le même envoi (sans tenir compte de la casse)', () => {
    const reserved = new Set(['clip.mov']);
    expect(uniqueName(dir, 'Clip.MOV', reserved)).toBe('Clip (2).MOV');
  });

  it('abandonne au-delà de 999 suffixes', () => {
    expect(() => uniqueName(dir, 'x.jpg', new Set(), () => true)).toThrow(/Too many/);
  });

  it('sameContent compare les octets', async () => {
    const a = path.join(dir, 'a.bin'), b = path.join(dir, 'b.bin'), c = path.join(dir, 'c.bin');
    fs.writeFileSync(a, 'same bytes'); fs.writeFileSync(b, 'same bytes'); fs.writeFileSync(c, 'same bytez');
    expect(await sameContent(a, b)).toBe(true);
    expect(await sameContent(a, c)).toBe(false);
    expect(await sameContent(a, path.join(dir, 'missing'))).toBe(false);
  });
});
