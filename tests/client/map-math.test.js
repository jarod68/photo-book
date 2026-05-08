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
  it('retourne 0 pour le même point', () => {
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

  it('est symétrique (A→B = B→A)', () => {
    const ab = haversineKm(48.8566, 2.3522, 51.5074, -0.1278);
    const ba = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(ab).toBeCloseTo(ba, 6);
  });
});

// ── centroid ──────────────────────────────────────────────────────────────────

describe('centroid', () => {
  it('retourne le point unique si un seul élément', () => {
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
  it('retourne [] si moins de 2 photos datées', () => {
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

  it("regroupe deux photos proches dans le temps et dans l'espace", () => {
    const photos = [
      photo(48.8566, 2.3522, '2024-01-01'),
      photo(48.8600, 2.3600, '2024-01-02'),
    ];
    const segments = buildSegments(photos);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(2);
  });

  it(`coupe le segment si l'écart dépasse ${MAX_DAYS} jours`, () => {
    const photos = [
      photo(48.8566, 2.3522, '2024-01-01'),
      photo(48.8600, 2.3600, `2024-0${1 + MAX_DAYS + 1}-01`),
    ];
    expect(buildSegments(photos)).toEqual([]);
  });

  it(`coupe le segment si la distance dépasse ${MAX_KM} km`, () => {
    const photos = [
      photo(48.8566, 2.3522, '2024-01-01'),  // Paris
      photo(41.9028, 12.4964, '2024-01-02'), // Rome (~1 107 km)
    ];
    expect(buildSegments(photos)).toEqual([]);
  });

  it('trie les photos par date avant segmentation', () => {
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
  it('regroupe les points dans le rayon de cluster', () => {
    const segment = [
      { gps: { lat: 48.8566, lng: 2.3522 } },
      { gps: { lat: 48.8570, lng: 2.3530 } }, // ~100 m de distance
    ];
    const nodes = clusterSegment(segment);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toHaveLength(2);
  });

  it(`sépare les points distants de plus de ${CLUSTER_KM} km`, () => {
    const segment = [
      { gps: { lat: 48.8566, lng: 2.3522 } }, // Paris
      { gps: { lat: 43.2965, lng: 5.3698 } }, // Marseille
    ];
    const nodes = clusterSegment(segment);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toHaveLength(1);
    expect(nodes[1]).toHaveLength(1);
  });

  it('retourne un seul nœud pour un seul élément', () => {
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

  it('le premier et dernier point de la courbe correspondent aux nœuds', () => {
    const { pts } = catmullRom([A, B], 0);
    expect(pts[0][0]).toBeCloseTo(A.lat);
    expect(pts[0][1]).toBeCloseTo(A.lng);
    expect(pts[pts.length - 1][0]).toBeCloseTo(B.lat);
    expect(pts[pts.length - 1][1]).toBeCloseTo(B.lng);
  });

  it('génère le nombre de points demandé (steps + 1)', () => {
    const { pts } = catmullRom([A, B], 0, 10);
    expect(pts).toHaveLength(11);
  });

  it('retourne les bons points de contrôle P0 et P1', () => {
    const { P0, P1 } = catmullRom([A, B, C], 0);
    expect(P0).toEqual(A);
    expect(P1).toEqual(B);
  });

  it('retourne cp1 entre P0 et P1', () => {
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

  it('t=0 retourne le point de départ', () => {
    const { lat, lng } = cubicSample(0, P0, cp1, cp2, P1);
    expect(lat).toBeCloseTo(0);
    expect(lng).toBeCloseTo(0);
  });

  it("t=1 retourne le point d'arrivée", () => {
    const { lat, lng } = cubicSample(1, P0, cp1, cp2, P1);
    expect(lat).toBeCloseTo(1);
    expect(lng).toBeCloseTo(0);
  });

  it('t=0.5 retourne un point intermédiaire', () => {
    const { lat } = cubicSample(0.5, P0, cp1, cp2, P1);
    expect(lat).toBeGreaterThan(0);
    expect(lat).toBeLessThan(1);
  });

  it('retourne un cap (deg) dans [0, 360[', () => {
    const { deg } = cubicSample(0.5, P0, cp1, cp2, P1);
    expect(deg).toBeGreaterThanOrEqual(0);
    expect(deg).toBeLessThan(360);
  });
});
