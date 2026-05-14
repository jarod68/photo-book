import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  centroid,
  buildSegments,
  clusterSegment,
  catmullRom,
  cubicSample,
  MAX_DAYS,
  MAX_KM,
  CLUSTER_KM,
} from '../../public/utils/map-math.js';

// ── haversineKm ───────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  it('returns 0 for the same point', () => {
    expect(haversineKm(48.8566, 2.3522, 48.8566, 2.3522)).toBe(0);
  });

  it('calcule la distance Paris → Londres (~342 km)', () => {
    const km = haversineKm(48.8566, 2.3522, 51.5074, -0.1278);
    expect(km).toBeGreaterThan(330);
    expect(km).toBeLessThan(355);
  });

  it('calcule la distance Paris → New York (~5 837 km)', () => {
    const km = haversineKm(48.8566, 2.3522, 40.7128, -74.006);
    expect(km).toBeGreaterThan(5_700);
    expect(km).toBeLessThan(5_900);
  });

  it('is symmetric (A→B = B→A)', () => {
    const ab = haversineKm(48.8566, 2.3522, 51.5074, -0.1278);
    const ba = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(ab).toBeCloseTo(ba, 6);
  });
});

// ── centroid ──────────────────────────────────────────────────────────────────

describe('centroid', () => {
  it('returns the single point if only one element', () => {
    const photos = [{ gps: { lat: 48.0, lng: 2.0 } }];
    expect(centroid(photos)).toEqual({ lat: 48.0, lng: 2.0 });
  });

  it('calcule la moyenne de deux points', () => {
    const photos = [
      { gps: { lat: 48.0, lng: 2.0 } },
      { gps: { lat: 50.0, lng: 4.0 } },
    ];
    expect(centroid(photos)).toEqual({ lat: 49.0, lng: 3.0 });
  });

  it('calcule la moyenne de trois points', () => {
    const photos = [
      { gps: { lat: 0, lng: 0 } },
      { gps: { lat: 3, lng: 3 } },
      { gps: { lat: 6, lng: 6 } },
    ];
    const c = centroid(photos);
    expect(c.lat).toBeCloseTo(3.0);
    expect(c.lng).toBeCloseTo(3.0);
  });
});

// ── buildSegments ─────────────────────────────────────────────────────────────

const photo = (lat, lng, date) => ({ gps: { lat, lng }, date });

describe('buildSegments', () => {
  it('returns [] if fewer than 2 dated photos', () => {
    expect(buildSegments([])).toEqual([]);
    expect(buildSegments([photo(48, 2, '2024-01-01')])).toEqual([]);
  });

  it('retourne [] pour des photos sans date', () => {
    const photos = [
      { gps: { lat: 48, lng: 2 }, date: null },
      { gps: { lat: 49, lng: 3 }, date: null },
    ];
    expect(buildSegments(photos)).toEqual([]);
  });

  it('groups two photos close in time and space', () => {
    const photos = [
      photo(48.8566, 2.3522, '2024-01-01'),
      photo(48.8600, 2.3600, '2024-01-02'),
    ];
    const segments = buildSegments(photos);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(2);
  });

  it(`cuts the segment if the gap exceeds ${MAX_DAYS} days`, () => {
    const photos = [
      photo(48.8566, 2.3522, '2024-01-01'),
      photo(48.8600, 2.3600, `2024-0${1 + MAX_DAYS + 1}-01`),
    ];
    expect(buildSegments(photos)).toEqual([]);
  });

  it(`cuts the segment if the distance exceeds ${MAX_KM} km`, () => {
    const photos = [
      photo(48.8566, 2.3522, '2024-01-01'),  // Paris
      photo(41.9028, 12.4964, '2024-01-02'), // Rome (~1 107 km)
    ];
    expect(buildSegments(photos)).toEqual([]);
  });

  it('sorts photos by date before segmentation', () => {
    const photos = [
      photo(48.8600, 2.3600, '2024-01-03'),
      photo(48.8566, 2.3522, '2024-01-01'),
      photo(48.8580, 2.3540, '2024-01-02'),
    ];
    const segments = buildSegments(photos);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(3);
  });
});

// ── clusterSegment ────────────────────────────────────────────────────────────

describe('clusterSegment', () => {
  it('groups points within cluster radius', () => {
    const segment = [
      { gps: { lat: 48.8566, lng: 2.3522 } },
      { gps: { lat: 48.8570, lng: 2.3530 } }, // ~100 m apart
    ];
    const nodes = clusterSegment(segment);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toHaveLength(2);
  });

  it(`separates points more than ${CLUSTER_KM} km apart`, () => {
    const segment = [
      { gps: { lat: 48.8566, lng: 2.3522 } }, // Paris
      { gps: { lat: 43.2965, lng: 5.3698 } }, // Marseille
    ];
    const nodes = clusterSegment(segment);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toHaveLength(1);
    expect(nodes[1]).toHaveLength(1);
  });

  it('returns a single node for a single element', () => {
    const segment = [{ gps: { lat: 48.8566, lng: 2.3522 } }];
    const nodes = clusterSegment(segment);
    expect(nodes).toHaveLength(1);
  });
});

// ── catmullRom ────────────────────────────────────────────────────────────────

describe('catmullRom', () => {
  const A = { lat: 0, lng: 0 };
  const B = { lat: 1, lng: 0 };
  const C = { lat: 2, lng: 0 };

  it('first and last curve points match the nodes', () => {
    const { pts } = catmullRom([A, B], 0);
    expect(pts[0][0]).toBeCloseTo(A.lat);
    expect(pts[0][1]).toBeCloseTo(A.lng);
    expect(pts[pts.length - 1][0]).toBeCloseTo(B.lat);
    expect(pts[pts.length - 1][1]).toBeCloseTo(B.lng);
  });

  it('generates the requested number of points (steps + 1)', () => {
    const { pts } = catmullRom([A, B], 0, 10);
    expect(pts).toHaveLength(11);
  });

  it('returns the correct control points P0 and P1', () => {
    const { P0, P1 } = catmullRom([A, B, C], 0);
    expect(P0).toEqual(A);
    expect(P1).toEqual(B);
  });

  it('returns cp1 between P0 and P1', () => {
    const { cp1, P0, P1 } = catmullRom([A, B, C], 0);
    expect(cp1.lat).toBeGreaterThanOrEqual(Math.min(P0.lat, P1.lat));
    expect(cp1.lat).toBeLessThanOrEqual(Math.max(P0.lat, P1.lat));
  });
});

// ── cubicSample ───────────────────────────────────────────────────────────────

describe('cubicSample', () => {
  const P0  = { lat: 0, lng: 0 };
  const P1  = { lat: 1, lng: 0 };
  const cp1 = { lat: 0.3, lng: 0 };
  const cp2 = { lat: 0.7, lng: 0 };

  it('t=0 returns the start point', () => {
    const { lat, lng } = cubicSample(0, P0, cp1, cp2, P1);
    expect(lat).toBeCloseTo(0);
    expect(lng).toBeCloseTo(0);
  });

  it('t=1 returns the end point', () => {
    const { lat, lng } = cubicSample(1, P0, cp1, cp2, P1);
    expect(lat).toBeCloseTo(1);
    expect(lng).toBeCloseTo(0);
  });

  it('t=0.5 returns an intermediate point', () => {
    const { lat } = cubicSample(0.5, P0, cp1, cp2, P1);
    expect(lat).toBeGreaterThan(0);
    expect(lat).toBeLessThan(1);
  });

  it('returns a bearing (deg) in [0, 360[', () => {
    const { deg } = cubicSample(0.5, P0, cp1, cp2, P1);
    expect(deg).toBeGreaterThanOrEqual(0);
    expect(deg).toBeLessThan(360);
  });
});
