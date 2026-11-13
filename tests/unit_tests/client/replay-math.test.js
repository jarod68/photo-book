import { describe, it, expect } from 'vitest';
import { buildStops, buildLegs, pointAlong, bearing, lift, legMs, ease } from '../../../public/utils/replay-math.js';

// Lisbon (2 photos, one stop) → Porto → Salamanca, then a new trip months later: Paris → Lyon
const trip = [
  { takenAt: '2026-04-01T10:00:00Z', gps: { lat: 38.7223, lng: -9.1393 } },
  { takenAt: '2026-04-01T18:00:00Z', gps: { lat: 38.7230, lng: -9.1400 } },
  { takenAt: '2026-04-03T10:00:00Z', gps: { lat: 41.1579, lng: -8.6291 } },
  { takenAt: '2026-04-05T10:00:00Z', gps: { lat: 40.9701, lng: -5.6635 } },
  { takenAt: '2026-09-01T10:00:00Z', gps: { lat: 48.8566, lng: 2.3522 } },
  { takenAt: '2026-09-02T10:00:00Z', gps: { lat: 45.7640, lng: 4.8357 } },
  { takenAt: null, gps: { lat: 0, lng: 0 } },
];

describe('rejouer un voyage', () => {
  it('les étapes : photos proches groupées, dans l’ordre, deux voyages', () => {
    const stops = buildStops(trip);
    expect(stops.map((s) => s.photos.length)).toEqual([2, 1, 1, 1, 1]);
    expect(stops.map((s) => s.segment)).toEqual([0, 0, 0, 1, 1]);
    expect(stops[0].date).toBe('2026-04-01T10:00:00Z');
  });

  it('les trajets : le long du tracé, un saut entre deux voyages', () => {
    const legs = buildLegs(buildStops(trip));
    expect(legs.map((l) => l.jump)).toEqual([false, false, true, false]);
    expect(legs[0].points.length).toBeGreaterThan(20);
    expect(legs[0].km).toBeGreaterThan(270);
    expect(legs[0].km).toBeLessThan(300);
    expect(legs[2].points).toHaveLength(2);
  });

  it('la caméra le long d’un trajet', () => {
    const pts = [[0, 0], [0, 10], [10, 10]];
    expect(pointAlong(pts, 0)).toMatchObject({ lat: 0, lng: 0 });
    expect(pointAlong(pts, 0.25)).toMatchObject({ lat: 0, lng: 5 });
    expect(pointAlong(pts, 0.75)).toMatchObject({ lat: 5, lng: 10 });
    expect(pointAlong(pts, 2)).toMatchObject({ lat: 10, lng: 10 });
    expect(Math.round(pointAlong(pts, 0.25).heading)).toBe(90);
    expect(Math.round(bearing({ lat: 0, lng: 0 }, { lat: 10, lng: 0 }))).toBe(0);
  });

  it('montée, durée, douceur', () => {
    expect(lift(10)).toBe(0);
    expect(lift(400)).toBeCloseTo(4, 0);
    expect(lift(100000)).toBe(7);
    expect(legMs(0)).toBe(1600);
    expect(legMs(10000)).toBe(6000);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBe(0.5);
  });
});
