// @ts-check
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
  const days = daysJ2000(date);
  const g = (357.529 + 0.98560028 * days) * DEG;                     // mean anomaly
  const q = 280.459 + 0.98564736 * days;                             // mean longitude
  const L = q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);       // ecliptic longitude
  return skyToLonLat(eclipticToEquatorial(L, 0, date), date);
}

// ── Sky: the Moon and the planets ────────────────────────────────────────────
// The globe's scene turns with the Earth (Earth-fixed axes), so a body of the
// sky at right ascension α and declination δ shows above the point where it is
// at the zenith: latitude δ, longitude α − GMST (Greenwich sidereal time).

const daysJ2000 = (date) => (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5;
const norm180 = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Ecliptic longitude / latitude (degrees) → { ra, dec } in degrees. */
export function eclipticToEquatorial(lon, lat, date = new Date()) {
  const e = (23.439 - 0.00000036 * daysJ2000(date)) * DEG;
  const l = lon * DEG, b = lat * DEG;
  const ra  = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  return { ra: ra / DEG, dec: dec / DEG };
}

/** { ra, dec } → { lat, lng } of the point that has it at the zenith at `date`. */
export function skyToLonLat({ ra, dec }, date = new Date()) {
  return { lat: dec, lng: norm180(ra - gmst(date)) };
}

/** Greenwich mean sidereal time at `date`, in degrees [0, 360). */
export function gmst(date = new Date()) {
  return (((18.697374558 + 24.06570982441908 * daysJ2000(date)) * 15) % 360 + 360) % 360;
}

// Main periodic terms of Meeus, Astronomical Algorithms ch. 47: [D, M, M', F,
// coefficient] — longitude and distance (Σl in 1e-6 °, Σr in metres), latitude.
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
];
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
];

/** Geocentric Moon at `date`: { ra, dec } (degrees, ~0.1°) and distance in km. */
export function moonPosition(date = new Date()) {
  const T = daysJ2000(date) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D  = (297.8501921 + 445267.1114034 * T) * DEG;
  const M  = (357.5291092 + 35999.0502909 * T) * DEG;
  const Mp = (134.9633964 + 477198.8675055 * T) * DEG;
  const F  = (93.2720950 + 483202.0175233 * T) * DEG;
  let l = 0, r = 0, b = 0;
  for (const [d, m, mp, f, cl, cr] of MOON_LR) {
    const a = d * D + m * M + mp * Mp + f * F;
    l += cl * Math.sin(a); r += cr * Math.cos(a);
  }
  for (const [d, m, mp, f, cb] of MOON_B) b += cb * Math.sin(d * D + m * M + mp * Mp + f * F);
  return { ...eclipticToEquatorial(Lp + l / 1e6, b / 1e6, date), distanceKm: 385000.56 + r / 1000 };
}

// Keplerian elements of JPL (Standish, "Approximate positions of the planets",
// 1800–2050, J2000 ecliptic): [a (au), e, I, L, ϖ, Ω (°)] and their rates per
// century. Arc-minute precision, far below what a point of light shows.
const ORBITS = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
            [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
            [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
            [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
            [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
            [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
            [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
            [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
            [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};
// absolute magnitude H (V at 1 au from the Sun and the Earth, full phase)
const ABS_MAG = { mercury: -0.4, venus: -4.4, mars: -1.5, jupiter: -9.4, saturn: -8.9, uranus: -7.2, neptune: -6.9 };
export const PLANETS = Object.keys(ABS_MAG);

/** Heliocentric ecliptic position (au) of a planet at T Julian centuries from J2000. */
function heliocentric(name, T) {
  const [el, rate] = ORBITS[name];
  const [a, e, I, L, w, O] = el.map((v, i) => v + rate[i] * T);
  const om = (w - O) * DEG, inc = I * DEG, node = O * DEG;
  let M = norm180(L - w) * DEG, E = M + e * Math.sin(M);
  for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));   // Kepler
  const x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const [co, so, cO, sO, ci, si] = [Math.cos(om), Math.sin(om), Math.cos(node), Math.sin(node), Math.cos(inc), Math.sin(inc)];
  return [
    (co * cO - so * sO * ci) * x + (-so * cO - co * sO * ci) * y,
    (co * sO + so * cO * ci) * x + (-so * sO + co * cO * ci) * y,
    so * si * x + co * si * y,
  ];
}

/**
 * The planets seen from the Earth at `date`: [{ name, ra, dec, distanceAu,
 * magnitude }] — the magnitude roughly (±1), for the size of their dot.
 */
export function planetPositions(date = new Date()) {
  const T = daysJ2000(date) / 36525;
  const earth = heliocentric('earth', T);
  return PLANETS.map((name) => {
    const p = heliocentric(name, T);
    const g = p.map((v, i) => v - earth[i]);
    const r = Math.hypot(...p), dist = Math.hypot(...g), R = Math.hypot(...earth);
    // J2000 ecliptic → ecliptic of date (precession: 1.397° per century)
    const lon = Math.atan2(g[1], g[0]) / DEG + 1.3970 * T, lat = Math.asin(g[2] / dist) / DEG;
    // Mercury and Venus show phases: thin crescents are much fainter (Meeus 41)
    const i = Math.acos(Math.max(-1, Math.min(1, (r * r + dist * dist - R * R) / (2 * r * dist)))) / DEG;
    const phase = name === 'mercury' ? 0.038 * i - 0.000273 * i ** 2 + 0.000002 * i ** 3
      : name === 'venus' ? 0.0009 * i + 0.000239 * i ** 2 - 0.00000065 * i ** 3 : 0;
    return { name, ...eclipticToEquatorial(lon, lat, date), distanceAu: dist, magnitude: ABS_MAG[name] + 5 * Math.log10(r * dist) + phase };
  });
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
