// @ts-check
// A trip's figures from its photos: days, countries, kilometres — the
// kilometres along the route of the map and the globe (utils/route.js: the
// same segments and stops), so the figure matches the line drawn.
import { buildSegments, clusterSegment, centroid, haversineKm } from './map-math.js';

/** "Lisboa, Portugal" → "Portugal" (the place's last part). */
export const countryOf = (location) => {
  const parts = String(location ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : null;
};

/**
 * @param {{ takenAt?: string|null, date?: string|null, gps?: { lat: number, lng: number }|null, location?: string|null }[]} photos
 * @returns {{ days: number, countries: string[], km: number, photos: number }}
 */
export function travelStats(photos) {
  const times = photos.map((p) => Date.parse(p.takenAt ?? p.date ?? '')).filter((t) => !Number.isNaN(t));
  // calendar days from the first photo to the last, both counted
  const day = (t) => Math.floor(t / 864e5);
  const days = times.length ? day(Math.max(...times)) - day(Math.min(...times)) + 1 : 0;
  const countries = [...new Set(photos.map((p) => countryOf(p.location)).filter(Boolean))].sort();
  let km = 0;
  const dated = photos.map((p) => ({ date: p.takenAt ?? p.date ?? null, gps: p.gps ?? null }));
  for (const segment of buildSegments(dated)) {
    const stops = clusterSegment(segment).map(centroid);
    for (let i = 1; i < stops.length; i++) km += haversineKm(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
  }
  return { days, countries, km: Math.round(km), photos: photos.length };
}
