// @ts-check
// The route between the photos, shared by the map page and the globe's
// close-up map, with the same rules everywhere: photos in date order, a new
// segment after more than 21 days or 400 km (buildSegments), nearby photos
// merged into one stop (clusterSegment), Catmull-Rom curves between the
// stops, arrows along them. A thin line, shown only close up (from zoom 6,
// a region): from further away it would only clutter the map.
import { catmullRom, cubicSample, centroid, buildSegments, clusterSegment } from './map-math.js';

export const ROUTE_COLOR  = '#ff8a5b';   // the app's accent (--accent)
export const ROUTE_LAYERS = ['route-halo', 'route-line', 'route-arrows', 'route-nodes'];
const ARROW_TS = [0.2, 0.5, 0.8];
const MIN_ZOOM = 5.5;                                   // nothing further out…
const fadeIn = (to) => ['interpolate', ['linear'], ['zoom'], MIN_ZOOM, 0, 6.5, to];   // …then fading in

/**
 * GeoJSON of the route: lines (curves), arrows (with their heading `deg`,
 * clockwise from north) and nodes (stops where several photos were taken).
 * @param {{ date: string|null, gps: { lat: number, lng: number }|null }[]} photos
 */
export function routeData(photos) {
  const lines = [], arrows = [], nodes = [];
  buildSegments(photos).forEach(segment => {
    const groups    = clusterSegment(segment);
    const centroids = groups.map(centroid);
    groups.forEach((g, gi) => {
      if (g.length > 1) nodes.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [centroids[gi].lng, centroids[gi].lat] } });
    });
    for (let i = 0; i < centroids.length - 1; i++) {
      const a = centroids[i], b = centroids[i + 1];
      if (a.lat === b.lat && a.lng === b.lng) continue;
      const { pts, cp1, cp2, P0, P1 } = catmullRom(centroids, i);
      lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(([lat, lng]) => [lng, lat]) } });
      for (const tt of ARROW_TS) {
        const { lat, lng, deg } = cubicSample(tt, P0, cp1, cp2, P1);
        arrows.push({ type: 'Feature', properties: { deg }, geometry: { type: 'Point', coordinates: [lng, lat] } });
      }
    }
  });
  const fc = (features) => ({ type: 'FeatureCollection', features });
  return { lines: fc(lines), arrows: fc(arrows), nodes: fc(nodes) };
}

// the arrow head, drawn once (2× for sharp screens)
function arrowImage() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 44;
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.beginPath();
  g.moveTo(8, 0); g.lineTo(15.5, 19); g.lineTo(8, 13.5); g.lineTo(0.5, 19); g.closePath();
  g.fillStyle = ROUTE_COLOR; g.fill();
  g.lineWidth = 2; g.lineJoin = 'round'; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
  return g.getImageData(0, 0, 32, 44);
}

/**
 * Draw the route on a MapLibre map (its style loaded): a thin dashed coral
 * line on a faint white halo, small arrows along it, a grey dot where several
 * photos share a stop — from zoom 6 on. Again after a style change (setStyle
 * drops the layers).
 * @param {any} map
 * @param {ReturnType<typeof routeData>} data
 * @param {boolean} [visible]
 */
export function addRouteLayers(map, { lines, arrows, nodes }, visible = true) {
  if (map.getSource('route-lines')) return;
  if (!map.hasImage('route-arrow')) map.addImage('route-arrow', arrowImage(), { pixelRatio: 2 });
  map.addSource('route-lines', { type: 'geojson', data: lines });
  map.addSource('route-arrows', { type: 'geojson', data: arrows });
  map.addSource('route-nodes', { type: 'geojson', data: nodes });
  const visibility = visible ? 'visible' : 'none';
  const line = { minzoom: MIN_ZOOM, source: 'route-lines', type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round', visibility } };
  map.addLayer({ ...line, id: 'route-halo', paint: { 'line-color': '#ffffff', 'line-width': 3.5, 'line-opacity': fadeIn(0.16) } });
  map.addLayer({ ...line, id: 'route-line',
    paint: { 'line-color': ROUTE_COLOR, 'line-width': 1.5, 'line-opacity': fadeIn(0.9), 'line-dasharray': [5, 3.5] } });
  map.addLayer({ id: 'route-nodes', type: 'circle', source: 'route-nodes', minzoom: MIN_ZOOM, layout: { visibility },
    paint: { 'circle-radius': 4, 'circle-color': '#94a3b8', 'circle-opacity': fadeIn(0.75),
      'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': fadeIn(1) } });
  map.addLayer({ id: 'route-arrows', type: 'symbol', source: 'route-arrows', minzoom: MIN_ZOOM,
    layout: { 'icon-image': 'route-arrow', 'icon-size': 0.6, 'icon-rotate': ['get', 'deg'], 'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true, visibility },
    paint: { 'icon-opacity': fadeIn(1) } });
}

/** Show or hide the route layers of a MapLibre map. */
export function setRouteVisible(map, visible) {
  for (const id of ROUTE_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}
