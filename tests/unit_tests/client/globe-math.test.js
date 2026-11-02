import { describe, it, expect } from 'vitest';
import {
  lonLatToXyz, xyzToLonLat, subsolarPoint, moonPosition, planetPositions, skyToLonLat, gmst, sphereRadiusPx, distanceToZoom, zoomToDistance, clusterScreen, angularDistance,
} from '../../../public/utils/globe-math.js';

describe('globe-math', () => {
  it('lat/lng ↔ xyz, aller-retour (y vers le nord, est = -z)', () => {
    expect(lonLatToXyz(0, 0)).toEqual([1, 0, -0]);
    const [x, y, z] = lonLatToXyz(90, 0); expect([x, y].map((v) => +v.toFixed(9))).toEqual([0, 1]); expect(Math.abs(z)).toBeLessThan(1e-9);
    expect(lonLatToXyz(0, 90).map((v) => +v.toFixed(9))).toEqual([0, 0, -1]);
    for (const [lat, lng] of [[48.8584, 2.2945], [-33.86, 151.21], [64.14, -21.94], [0, 179.9]]) {
      const back = xyzToLonLat(lonLatToXyz(lat, lng, 3));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lng).toBeCloseTo(lng, 9);
    }
  });

  it('point subsolaire : équinoxe, solstices, heure du jour (±1°)', () => {
    const near = (p, lat, lng) => { expect(Math.abs(p.lat - lat)).toBeLessThan(1); expect(Math.abs(((p.lng - lng + 540) % 360) - 180)).toBeLessThan(1.5); };
    // at noon UTC the sun is off Greenwich by the equation of time (sun ahead in March, late in November)
    near(subsolarPoint(new Date(Date.UTC(2026, 2, 20, 12, 0))), 0, 1.9);         // equinox
    near(subsolarPoint(new Date(Date.UTC(2026, 5, 21, 12, 0))), 23.44, 0.4);     // June solstice
    near(subsolarPoint(new Date(Date.UTC(2026, 10, 3, 12, 0))), -15.15, -4.1);   // 3 November
    near(subsolarPoint(new Date(Date.UTC(2026, 11, 21, 0, 0))), -23.44, 179.5);  // December solstice, midnight UTC
  });

  // références : astronomy-engine 2.1.19 (géocentrique, équateur de la date)
  const sep = (a, b) => {
    const R = Math.PI / 180;
    return Math.acos(Math.min(1, Math.sin(a.dec * R) * Math.sin(b.dec * R) + Math.cos(a.dec * R) * Math.cos(b.dec * R) * Math.cos((a.ra - b.ra) * R))) / R;
  };
  it('Lune : position à 0,1° près, distance à 100 km près', () => {
    for (const [iso, ra, dec, km] of [['2024-04-08T18:00:00Z', 17.58, 7.82, 359771], ['2026-10-31T20:00:00Z', 117.59, 23.74, 369447]]) {
      const m = moonPosition(new Date(iso));
      expect(sep(m, { ra, dec })).toBeLessThan(0.1);
      expect(Math.abs(m.distanceKm - km)).toBeLessThan(100);
    }
  });

  it('planètes : position à 0,2° près, magnitude à ±1', () => {
    const ref = {
      '2024-04-08T18:00:00Z': { venus: [4.66, 0.39, -3.8], mars: [344.85, -7.81, 1.2], jupiter: [46.82, 16.71, -2.0], saturn: [346.34, -7.68, 1.0] },
      '2026-10-31T20:00:00Z': { venus: [202.58, -14.73, -4.2], mars: [141.49, 16.79, 0.9], jupiter: [146.84, 14.07, -2.0], saturn: [9.59, 1.21, 0.4] },
    };
    for (const [iso, bodies] of Object.entries(ref)) {
      const got = Object.fromEntries(planetPositions(new Date(iso)).map((p) => [p.name, p]));
      expect(Object.keys(got)).toEqual(['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
      for (const [name, [ra, dec, mag]] of Object.entries(bodies)) {
        expect(sep(got[name], { ra, dec })).toBeLessThan(0.2);
        expect(Math.abs(got[name].magnitude - mag)).toBeLessThan(1);
      }
    }
  });

  it('ciel → point au zénith : la longitude tourne avec le temps sidéral', () => {
    const d = new Date('2026-10-31T20:00:00Z');
    const a = skyToLonLat({ ra: 100, dec: 20 }, d), b = skyToLonLat({ ra: 100, dec: 20 }, new Date(d.getTime() + 3600e3));
    expect(a.lat).toBe(20);
    expect(((a.lng - b.lng + 360) % 360)).toBeCloseTo(15.04, 1);   // 15.04° per hour, westward
  });

  it('distance de caméra ↔ zoom de carte : inverses l\'une de l\'autre', () => {
    for (const d of [1.05, 1.2, 1.5, 2.6, 5]) {
      expect(zoomToDistance(distanceToZoom(d, 900, 45), 900, 45)).toBeCloseTo(d, 9);
    }
    expect(distanceToZoom(1.2, 900, 45)).toBeGreaterThan(distanceToZoom(2.6, 900, 45));   // closer = higher zoom
    // the globe filling ~a third of a 900 px tall view is around MapLibre zoom 1.5–2
    expect(distanceToZoom(2.6, 900, 45)).toBeGreaterThan(1);
    expect(distanceToZoom(2.6, 900, 45)).toBeLessThan(2.5);
    expect(sphereRadiusPx(1, 900, 45)).toBeGreaterThan(1e6);   // camera on the surface
  });

  it('regroupement à l\'écran', () => {
    const pts = [{ x: 0, y: 0, id: 'a' }, { x: 10, y: 10, id: 'b' }, { x: 100, y: 0, id: 'c' }, { x: 105, y: 3, id: 'd' }, { x: 300, y: 300, id: 'e' }];
    const c = clusterScreen(pts, 30);
    expect(c.map((k) => k.items.map((i) => i.id).join(''))).toEqual(['ab', 'cd', 'e']);
    expect(c[1]).toMatchObject({ x: 100, y: 0 });
    expect(clusterScreen([], 30)).toEqual([]);
  });

  it('distance angulaire', () => {
    expect(angularDistance({ lat: 0, lng: 0 }, { lat: 0, lng: 90 })).toBeCloseTo(90, 9);
    expect(angularDistance({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8566, lng: 2.3522 })).toBe(0);
  });
});

describe('temps sidéral (le ciel étoilé)', () => {
  it('GMST : 280,46° à J2000.0, un tour en un jour sidéral, toujours dans [0, 360)', () => {
    expect(gmst(new Date(Date.UTC(2000, 0, 1, 12)))).toBeCloseTo(280.4606, 3);
    const d = new Date(Date.UTC(2026, 5, 21, 22));
    const sidereal = 86164.0905e3;
    expect(gmst(new Date(d.getTime() + sidereal))).toBeCloseTo(gmst(d), 2);
    for (const y of [1990, 2026, 2049]) {
      const g = gmst(new Date(Date.UTC(y, 2, 3)));
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThan(360);
    }
  });

  it('une étoile au-dessus du point de longitude α − GMST (Sirius)', () => {
    const d = new Date(Date.UTC(2026, 5, 21, 22));
    const s = skyToLonLat({ ra: 101.287, dec: -16.716 }, d);
    expect(s.lat).toBe(-16.716);
    expect(((s.lng - (101.287 - gmst(d))) % 360 + 360) % 360).toBeCloseTo(0, 6);
  });
});
