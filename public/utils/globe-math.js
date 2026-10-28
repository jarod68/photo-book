/**
 * Math shared by the two views of the globe page: the Three.js "space" view
 * (unit sphere, camera at distance d from the centre) and the MapLibre "near"
 * view (globe projection, zoom levels). No Three.js / MapLibre dependency, so
 * it is unit-tested on its own.
 */

const DEG = Math.PI / 180;

/** Geographic → point on the sphere of radius r (Y up, east = -Z). */
export function lonLatToXyz(lat, lng, r = 1) {
  const la = lat * DEG, lo = lng * DEG;
  return [r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo)];
}

/** Point (any length) → { lat, lng } of its direction. */
export function xyzToLonLat([x, y, z]) {
  const len = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(y / len) / DEG, lng: Math.atan2(-z, x) / DEG };
}

/**
 * Sub-solar point (where the sun is at the zenith) at `date`, ±0.5°: enough
 * to place the day / night terminator. NOAA's low-precision formulas.
 */
export function subsolarPoint(date = new Date()) {
  const days = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5;   // since J2000
  const g = (357.529 + 0.98560028 * days) * DEG;                     // mean anomaly
  const q = 280.459 + 0.98564736 * days;                             // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG; // ecliptic longitude
  const e = (23.439 - 0.00000036 * days) * DEG;                      // obliquity
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = ((18.697374558 + 24.06570982441908 * days) % 24) * 15 * DEG;
  let lng = (ra - gmst) / DEG;
  lng = ((lng + 540) % 360) - 180;
  return { lat: dec / DEG, lng };
}

// MapLibre draws the world 512 · 2^zoom pixels around at the equator; the
// space view shows a sphere of apparent radius (H/2)·tan(asin(1/d))/tan(fov/2)
// pixels. Matching both radii makes the switch between the views seamless.
const WORLD_PX = 512;

/** Apparent radius in pixels of the unit sphere seen from distance d. */
export function sphereRadiusPx(d, viewportHeight, fovDeg) {
  const a = Math.asin(Math.min(1, 1 / d));
  return (viewportHeight / 2) * Math.tan(a) / Math.tan((fovDeg / 2) * DEG);
}

/** Space-view camera distance → MapLibre zoom showing the globe the same size. */
export function distanceToZoom(d, viewportHeight, fovDeg) {
  return Math.log2((2 * Math.PI * sphereRadiusPx(d, viewportHeight, fovDeg)) / WORLD_PX);
}

/** MapLibre zoom → space-view camera distance (inverse of distanceToZoom). */
export function zoomToDistance(zoom, viewportHeight, fovDeg) {
  const rPx = (WORLD_PX * 2 ** zoom) / (2 * Math.PI);
  const tanA = (rPx * Math.tan((fovDeg / 2) * DEG)) / (viewportHeight / 2);
  return 1 / Math.sin(Math.atan(tanA));
}

/**
 * Greedy screen-space clustering: points closer than `radius` pixels to a
 * cluster's first point join it. Input: [{ x, y, ...}] in screen pixels.
 * Output: [{ x, y, items }] — x / y of the cluster's first (anchor) point.
 * O(n · clusters), fine for the few hundred photos of a gallery.
 */
export function clusterScreen(points, radius) {
  const r2 = radius * radius;
  const clusters = [];
  for (const p of points) {
    const c = clusters.find((k) => (k.x - p.x) ** 2 + (k.y - p.y) ** 2 < r2);
    if (c) c.items.push(p);
    else clusters.push({ x: p.x, y: p.y, items: [p] });
  }
  return clusters;
}

/** Great-circle angle (degrees) between two points. */
export function angularDistance(a, b) {
  const [ax, ay, az] = lonLatToXyz(a.lat, a.lng), [bx, by, bz] = lonLatToXyz(b.lat, b.lng);
  return Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz))) / DEG;
}
