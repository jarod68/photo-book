// @ts-check
// The geometry of a trip's replay (pages/replay.js): its stops, the legs
// between them along the route of the map and the globe (the same segments
// and stops: utils/route.js), and the camera along each leg.
import { buildSegments, clusterSegment, centroid, catmullRom, haversineKm } from './map-math.js';

/**
 * The trip's stops in order: { lat, lng, photos (taken there, in order),
 * date (the first photo's), segment } — a new segment after a long gap (a
 * new trip: the camera then jumps instead of travelling).
 * @param {{ takenAt?: string|null, date?: string|null, gps?: { lat: number, lng: number }|null }[]} photos
 */
export function buildStops(photos) {
  const dated = photos.map((p) => ({ ...p, date: p.takenAt ?? p.date ?? null, gps: p.gps ?? null }));
  const stops = [];
  buildSegments(dated).forEach((segment, si) => {
    for (const group of clusterSegment(segment)) {
      const c = centroid(group);
      stops.push({ lat: c.lat, lng: c.lng, photos: group, date: group[0].date, segment: si });
    }
  });
  return stops;
}

/** Heading from a to b, degrees clockwise from north. */
export function bearing(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/**
 * The legs between consecutive stops: the curve of the route ([lat, lng]
 * points, as on the map) and its length; `jump` between two segments.
 */
export function buildLegs(stops) {
  const legs = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i], b = stops[i + 1];
    const jump = a.segment !== b.segment;
    let points;
    if (jump) points = [[a.lat, a.lng], [b.lat, b.lng]];
    else {
      const same = stops.filter((s) => s.segment === a.segment);
      const k = same.indexOf(a);
      points = catmullRom(same.map((s) => ({ lat: s.lat, lng: s.lng })), k, 60).pts;
    }
    let km = 0;
    for (let j = 1; j < points.length; j++) km += haversineKm(points[j - 1][0], points[j - 1][1], points[j][0], points[j][1]);
    legs.push({ from: i, to: i + 1, points, km, jump });
  }
  return legs;
}

/** The point at fraction t (0–1) of a polyline's length, and its heading. */
export function pointAlong(points, t) {
  const lens = [0];
  for (let j = 1; j < points.length; j++) lens.push(lens[j - 1] + Math.hypot(points[j][0] - points[j - 1][0], points[j][1] - points[j - 1][1]));
  const total = lens[lens.length - 1] || 1;
  const d = Math.min(Math.max(t, 0), 1) * total;
  let j = 1;
  while (j < lens.length - 1 && lens[j] < d) j++;
  const seg = (lens[j] - lens[j - 1]) || 1;
  const u = (d - lens[j - 1]) / seg;
  const a = points[j - 1], b = points[j] ?? a;
  const p = { lat: a[0] + (b[0] - a[0]) * u, lng: a[1] + (b[1] - a[1]) * u };
  return { ...p, heading: bearing({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }), index: j };
}

/** Zoom to show a stop: close, but a city around it. */
export const STOP_ZOOM = 10.5;

/** How far the camera rises halfway along a leg (zoom levels), with its length. */
export function lift(km) {
  return Math.min(7, Math.max(0, Math.log2(Math.max(km, 1) / 25)));
}

/** A leg's duration in ms at speed 1: a short hop, longer for long ways. */
export function legMs(km) {
  return 1600 + Math.min(4400, km * 7);
}

/** Smooth start and end. */
export const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
