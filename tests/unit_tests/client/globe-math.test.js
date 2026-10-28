import { describe, it, expect } from 'vitest';
import {
  lonLatToXyz, xyzToLonLat, subsolarPoint, sphereRadiusPx, distanceToZoom, zoomToDistance, clusterScreen, angularDistance,
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
