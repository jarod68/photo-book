import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _require = createRequire(import.meta.url);
const errorLog = _require('../../../services/error-log.js');

describe('error-log (F8)', () => {
  beforeEach(() => errorLog._reset());

  it('garde les dernières erreurs, la plus récente d\'abord, bornées et tronquées', () => {
    for (let i = 0; i < errorLog.MAX + 5; i++) errorLog.record([`err ${i}`]);
    const r = errorLog.recent();
    expect(r).toHaveLength(errorLog.MAX);
    expect(r[0].message).toBe(`err ${errorLog.MAX + 4}`);
    errorLog.record(['x'.repeat(2000)]);
    expect(errorLog.recent()[0].message).toHaveLength(500);
  });

  it('formate Error, objets et chaînes', () => {
    errorLog.record(['failed:', new Error('boom'), { code: 42 }]);
    expect(errorLog.recent()[0].message).toMatch(/^failed: Error: boom[\s\S]*\{"code":42\}$/);
  });

  it('install() enregistre console.error sans l\'empêcher d\'afficher', () => {
    const printed = vi.fn();
    const con = { error: printed };
    errorLog.install(con);
    con.error('Upload failed', 'disk full');
    expect(printed).toHaveBeenCalledWith('Upload failed', 'disk full');
    expect(errorLog.recent()[0].message).toBe('Upload failed disk full');
  });
});
