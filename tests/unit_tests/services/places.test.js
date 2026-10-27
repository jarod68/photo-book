import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _require = createRequire(import.meta.url);
const database = _require('../../../services/database.js');
const places   = _require('../../../services/places.js');

const ok = (address) => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ address }) });

describe('places (F6)', () => {
  beforeEach(() => { places._reset(); database._reset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('formate « lieu, pays » et met en cache (mémoire + DB)', async () => {
    const query = vi.fn(async (sql) => ({ rows: [] }));
    database._setState({ query }, true);
    const f = ok({ town: 'Fremantle', country: 'Australie' });
    expect(await places.lookup(-32.0569, 115.7439, { fetch: f })).toBe('Fremantle, Australie');
    expect(await places.lookup(-32.0571, 115.7441, { fetch: f })).toBe('Fremantle, Australie');   // same ~100 m cell
    expect(f).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql, params]) => sql.includes('INSERT INTO place_cache') && params[0] === '-32.057,115.744')).toBe(true);
  });

  it('relit le cache persistant sans appel réseau', async () => {
    database._setState({ query: vi.fn().mockResolvedValue({ rows: [{ location: 'Porto, Portugal' }] }) }, true);
    const f = ok({});
    expect(await places.cached(41.15, -8.61)).toBe('Porto, Portugal');
    expect(await places.lookup(41.15, -8.61, { fetch: f })).toBe('Porto, Portugal');
    expect(f).not.toHaveBeenCalled();
  });

  it('respecte une requête par seconde (politique Nominatim)', async () => {
    vi.useFakeTimers();
    try {
      const times = [];
      const f = vi.fn(async () => { times.push(Date.now()); return { ok: true, json: async () => ({ address: { city: 'X' } }) }; });
      const all = Promise.all([places.lookup(1, 1, { fetch: f }), places.lookup(2, 2, { fetch: f }), places.lookup(3, 3, { fetch: f })]);
      await vi.runAllTimersAsync();
      await all;
      expect(times).toHaveLength(3);
      expect(times[1] - times[0]).toBeGreaterThanOrEqual(places.MIN_GAP_MS);
      expect(times[2] - times[1]).toBeGreaterThanOrEqual(places.MIN_GAP_MS);
    } finally { vi.useRealTimers(); }
  });

  it('un échec n\'est pas réessayé avant un jour', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    expect(await places.lookup(5, 5, { fetch: f })).toBeNull();
    expect(await places.lookup(5, 5, { fetch: f })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('fillMissing ne traite que les photos GPS sans lieu', async () => {
    const f = ok({ city: 'Perth', country: 'Australie' });
    const n = await places.fillMissing([
      { gps: { lat: -31.95, lng: 115.86 }, location: null },
      { gps: { lat: 10, lng: 10 }, location: 'déjà connu' },
      { gps: null, location: null },
    ], { fetch: f });
    expect(n).toBe(1);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
