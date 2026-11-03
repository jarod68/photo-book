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

  it('un lieu absent du cache n’est redemandé à la base qu’après 5 minutes (la recherche le lit pour chaque photo)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    database._setState({ query }, true);
    vi.useFakeTimers();
    try {
      expect(await places.cached(1, 2)).toBeUndefined();
      expect(await places.cachedTerms(1, 2)).toBeUndefined();
      expect(query).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5 * 60_000 + 1);
      await places.cached(1, 2);
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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

  it('garde pour la recherche l\'adresse large et les noms étrangers du lieu', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    database._setState({ query }, true);
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      address: { suburb: 'Manhattan', city: 'New York', county: 'New York County', state: 'New York', country: 'États-Unis', postcode: '10024' },
      namedetails: { name: 'New York', 'name:es': 'Nueva York', 'name:ja': 'ニューヨーク', wikidata: 'Q60' },
    }) });
    expect(await places.lookup(40.78, -73.97, { fetch: f })).toBe('Manhattan, États-Unis');
    const terms = await places.cachedTerms(40.78, -73.97);
    expect(terms).toContain('New York County');
    expect(terms).toContain('Nueva York');
    expect(terms).not.toContain('10024');
    expect(terms).not.toContain('ニューヨーク');
    expect(f.mock.calls[0][0]).toContain('namedetails=1');
    expect(query.mock.calls.some(([sql, params]) => sql.includes('terms') && params[2] === terms)).toBe(true);
  });

  it('fillMissing complète les lieux mis en cache avant les mots de recherche', async () => {
    // an old row: location but no terms → fetched again; a row without a place → left alone
    database._setState({ query: vi.fn(async (sql, params) => ({
      rows: sql.startsWith('SELECT') ? (params[0] === '1.000,1.000' ? [{ location: 'Ancien, Pays', terms: null }] : [{ location: null, terms: null }]) : [],
    })) }, true);
    const f = ok({ city: 'Ancien', country: 'Pays' });
    const n = await places.fillMissing([{ gps: { lat: 1, lng: 1 }, location: null }, { gps: { lat: 2, lng: 2 }, location: null }], { fetch: f });
    expect(n).toBe(1);
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
