import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _require  = createRequire(import.meta.url);
const database  = _require('../../../services/database.js');
const { loadOverrides, applyOverride, parseOverride } = _require('../../../services/overrides.js');

const photo = { filename: 'a.jpg', name: 'IMG_1', description: 'from exif', location: null, views: 3 };

describe('overrides (F2)', () => {
  beforeEach(() => database._reset());

  it('applyOverride remplace uniquement les champs non NULL, sans muter la source', () => {
    const out = applyOverride(photo, { title: 'Titre', description: null, location: 'Perth' });
    expect(out).toMatchObject({ name: 'Titre', description: 'from exif', location: 'Perth', views: 3 });
    expect(photo.name).toBe('IMG_1');
    expect(applyOverride(photo, undefined)).toEqual(photo);
  });

  it('applyOverride expose les valeurs du fichier pour l\'éditeur', () => {
    const out = applyOverride(photo, undefined, { withOriginal: true });
    expect(out.original).toEqual({ title: 'IMG_1', description: 'from exif', location: null });
    expect(out.override).toEqual({ title: null, description: null, location: null });
  });

  it('parseOverride : trim, vide → NULL, absent → NULL, limites', () => {
    expect(parseOverride({ title: ' a ', description: '', location: undefined }))
      .toEqual({ values: { title: 'a', description: null, location: null } });
    expect(parseOverride(undefined)).toEqual({ values: { title: null, description: null, location: null } });
    expect(parseOverride({ description: 'x'.repeat(2001) }).error).toMatch(/too long/);
    expect(parseOverride({ title: ['x'] }).error).toMatch(/string/);
  });

  it('loadOverrides : vide sans DB, filtré par album sinon', async () => {
    expect((await loadOverrides(['A'])).size).toBe(0);
    const query = vi.fn().mockResolvedValue({ rows: [{ album: 'A', filename: 'x.jpg', title: 'T', description: null, location: null }] });
    database._setState({ query }, true);
    const map = await loadOverrides(['A']);
    expect(map.get('A/x.jpg')).toEqual({ title: 'T', description: null, location: null });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ANY($1)'), [['A']]);
  });
});
