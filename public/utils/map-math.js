export const MAX_DAYS   = 21;   // fenêtre consécutive max : 3 semaines
export const MAX_KM     = 400;  // rayon max entre deux points consécutifs
export const CLUSTER_KM = 5;    // rayon de regroupement de photos proches

/** @param {number} lat1 @param {number} lng1 @param {number} lat2 @param {number} lng2 @returns {number} */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R   = 6371;
  const d2r = Math.PI / 180;
  const dLat = (lat2 - lat1) * d2r;
  const dLng = (lng2 - lng1) * d2r;
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** @param {{ gps: { lat: number, lng: number } }[]} photos @returns {{ lat: number, lng: number }} */
export function centroid(photos) {
  return {
    lat: photos.reduce((s, p) => s + p.gps.lat, 0) / photos.length,
    lng: photos.reduce((s, p) => s + p.gps.lng, 0) / photos.length,
  };
}

/**
 * Split photos into temporally and spatially connected segments.
 * @param {{ date: string|null, gps: { lat: number, lng: number }|null }[]} photos
 * @returns {Array[]}
 */
export function buildSegments(photos) {
  const dated = photos
    .filter(p => p.date && p.gps)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (dated.length < 2) return [];

  const segments = [];
  let current = [dated[0]];

  for (let i = 1; i < dated.length; i++) {
    const prev = current[current.length - 1];
    const curr = dated[i];
    const days = (new Date(curr.date) - new Date(prev.date)) / 86_400_000;
    const km   = haversineKm(prev.gps.lat, prev.gps.lng, curr.gps.lat, curr.gps.lng);

    if (days <= MAX_DAYS && km <= MAX_KM) {
      current.push(curr);
    } else {
      if (current.length >= 2) segments.push(current);
      current = [curr];
    }
  }
  if (current.length >= 2) segments.push(current);

  return segments;
}

/**
 * Group nearby photos in a segment into cluster nodes.
 * @param {Array} segment
 * @returns {Array[]}
 */
export function clusterSegment(segment) {
  const nodes = [];
  let current = [segment[0]];

  for (let i = 1; i < segment.length; i++) {
    const ref = current[0].gps;
    const p   = segment[i].gps;
    if (haversineKm(ref.lat, ref.lng, p.lat, p.lng) <= CLUSTER_KM) {
      current.push(segment[i]);
    } else {
      nodes.push(current);
      current = [segment[i]];
    }
  }
  nodes.push(current);
  return nodes;
}

/**
 * Cubic Bézier curve using Catmull-Rom tangents.
 * Guarantees consecutive segments share tangent direction → no crossings.
 * @param {{ lat: number, lng: number }[]} centroids
 * @param {number} i
 * @param {number} [steps=40]
 */
export function catmullRom(centroids, i, steps = 40) {
  const n  = centroids.length;
  const P0 = centroids[i];
  const P1 = centroids[i + 1];
  const prev = i > 0     ? centroids[i - 1] : { lat: 2 * P0.lat - P1.lat, lng: 2 * P0.lng - P1.lng };
  const next = i + 2 < n ? centroids[i + 2] : { lat: 2 * P1.lat - P0.lat, lng: 2 * P1.lng - P0.lng };

  const tx0 = (P1.lat - prev.lat) / 2;
  const ty0 = (P1.lng - prev.lng) / 2;
  const tx1 = (next.lat - P0.lat) / 2;
  const ty1 = (next.lng - P0.lng) / 2;

  const segLen = Math.sqrt((P1.lat - P0.lat) ** 2 + (P1.lng - P0.lng) ** 2) || 1e-9;
  const len0   = Math.sqrt(tx0 * tx0 + ty0 * ty0) || 1e-9;
  const len1   = Math.sqrt(tx1 * tx1 + ty1 * ty1) || 1e-9;
  const cap    = segLen * 0.30;
  const s0     = Math.min(cap, len0) / (3 * len0);
  const s1     = Math.min(cap, len1) / (3 * len1);

  const cp1 = { lat: P0.lat + tx0 * s0, lng: P0.lng + ty0 * s0 };
  const cp2 = { lat: P1.lat - tx1 * s1, lng: P1.lng - ty1 * s1 };

  const pts = [];
  for (let j = 0; j <= steps; j++) {
    const t = j / steps;
    const u = 1 - t;
    pts.push([
      u*u*u * P0.lat + 3*u*u*t * cp1.lat + 3*u*t*t * cp2.lat + t*t*t * P1.lat,
      u*u*u * P0.lng + 3*u*u*t * cp1.lng + 3*u*t*t * cp2.lng + t*t*t * P1.lng,
    ]);
  }

  return { pts, cp1, cp2, P0, P1 };
}

/**
 * Point and heading on a cubic Bézier at parameter t.
 * @param {number} t - curve parameter [0, 1]
 * @returns {{ lat: number, lng: number, deg: number }}
 */
export function cubicSample(t, P0, cp1, cp2, P1) {
  const u    = 1 - t;
  const lat  = u*u*u * P0.lat + 3*u*u*t * cp1.lat + 3*u*t*t * cp2.lat + t*t*t * P1.lat;
  const lng  = u*u*u * P0.lng + 3*u*u*t * cp1.lng + 3*u*t*t * cp2.lng + t*t*t * P1.lng;
  const dlat = 3*u*u * (cp1.lat - P0.lat) + 6*u*t * (cp2.lat - cp1.lat) + 3*t*t * (P1.lat - cp2.lat);
  const dlng = 3*u*u * (cp1.lng - P0.lng) + 6*u*t * (cp2.lng - cp1.lng) + 3*t*t * (P1.lng - cp2.lng);
  const deg  = (Math.atan2(dlng, dlat) * 180 / Math.PI + 360) % 360;
  return { lat, lng, deg };
}
