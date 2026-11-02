import { describe, it, expect, vi } from 'vitest';
import { routeData, addRouteLayers, setRouteVisible, ROUTE_LAYERS } from '../../../public/utils/route.js';

// a trip: Lisbon (2 photos at the same stop) → Porto → Salamanca, then far later Paris (new segment, alone)
const trip = [
  { date: '2026-04-01T10:00:00Z', gps: { lat: 38.7223, lng: -9.1393 } },
  { date: '2026-04-01T12:00:00Z', gps: { lat: 38.7230, lng: -9.1400 } },
  { date: '2026-04-03T10:00:00Z', gps: { lat: 41.1579, lng: -8.6291 } },
  { date: '2026-04-05T10:00:00Z', gps: { lat: 40.9701, lng: -5.6635 } },
  { date: '2026-09-01T10:00:00Z', gps: { lat: 48.8566, lng: 2.3522 } },
  { date: null, gps: { lat: 0, lng: 0 } },
];

describe('route (carte, globe)', () => {
  it('mêmes règles que la carte : courbes entre les arrêts, flèches, arrêts groupés', () => {
    const { lines, arrows, nodes } = routeData(trip);
    expect(lines.features).toHaveLength(2);                 // Lisbonne → Porto → Salamanque
    expect(arrows.features).toHaveLength(6);                // 3 par courbe
    expect(nodes.features).toHaveLength(1);                 // les deux photos de Lisbonne
    const [lng, lat] = lines.features[0].geometry.coordinates[0];
    expect(lat).toBeCloseTo(38.72265, 4);
    expect(lng).toBeCloseTo(-9.13965, 4);
    expect(arrows.features[0].properties.deg).toBeGreaterThanOrEqual(0);
    expect(routeData([]).lines.features).toEqual([]);
  });

  it('couches MapLibre : fines, visibles de près seulement, une fois ; masquables', () => {
    const layers = new Map(), sources = new Set();
    const map = {
      hasImage: () => false, addImage: vi.fn(),
      getSource: (id) => (sources.has(id) ? {} : undefined), addSource: (id) => sources.add(id),
      addLayer: (l) => layers.set(l.id, l), getLayer: (id) => layers.get(id),
      setLayoutProperty: (id, k, v) => { layers.get(id).layout[k] = v; },
    };
    const canvas = { getContext: () => ({ scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}, getImageData: () => 'img' }) };
    vi.spyOn(document, 'createElement').mockReturnValue(/** @type {any} */ (canvas));
    addRouteLayers(map, routeData(trip), false);
    addRouteLayers(map, routeData(trip));                   // déjà là : rien
    expect([...layers.keys()].sort()).toEqual([...ROUTE_LAYERS].sort());
    expect(layers.get('route-line').paint['line-width']).toBe(1.5);
    for (const id of ROUTE_LAYERS) {
      expect(layers.get(id).minzoom).toBeGreaterThan(5);
      expect(layers.get(id).layout.visibility).toBe('none');
    }
    setRouteVisible(map, true);
    expect(layers.get('route-arrows').layout.visibility).toBe('visible');
    vi.restoreAllMocks();
  });
});
