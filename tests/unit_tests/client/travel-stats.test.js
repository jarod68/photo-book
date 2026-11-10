import { describe, it, expect } from 'vitest';
import { travelStats, countryOf } from '../../../public/utils/travel-stats.js';

describe('statistiques de voyage', () => {
  it('pays : la dernière partie du lieu', () => {
    expect(countryOf('Lisboa, Portugal')).toBe('Portugal');
    expect(countryOf('Paris')).toBeNull();
    expect(countryOf(null)).toBeNull();
  });

  it('jours (premier au dernier, inclus), pays, kilomètres le long du tracé', () => {
    const s = travelStats([
      { takenAt: '2026-04-01T10:00:00Z', gps: { lat: 38.7223, lng: -9.1393 }, location: 'Lisboa, Portugal' },
      { takenAt: '2026-04-01T18:00:00Z', gps: { lat: 38.7230, lng: -9.1400 }, location: 'Lisboa, Portugal' },
      { takenAt: '2026-04-03T10:00:00Z', gps: { lat: 41.1579, lng: -8.6291 }, location: 'Porto, Portugal' },
      { takenAt: '2026-04-05T10:00:00Z', gps: { lat: 40.9701, lng: -5.6635 }, location: 'Salamanca, España' },
      { takenAt: null, gps: null, location: null },
    ]);
    expect(s.days).toBe(5);
    expect(s.countries).toEqual(['España', 'Portugal']);
    expect(s.km).toBeGreaterThan(520);   // Lisbon → Porto ≈ 274, Porto → Salamanca ≈ 251
    expect(s.km).toBeLessThan(540);
    expect(s.photos).toBe(5);
  });

  it('rien à compter', () => {
    expect(travelStats([])).toEqual({ days: 0, countries: [], km: 0, photos: 0 });
  });
});
