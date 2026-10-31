/**
 * Background of the Leaflet maps (map page, viewer mini-map and album map):
 * OpenStreetMap's tiles, turned dark by a CSS filter on the tiles only
 * (.pb-dark-tiles in style.css) — dark like the rest of the app and the
 * globe, keyless (the free dark tile services now all want an API key).
 */
export const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Add the dark base layer to a Leaflet map (Leaflet is the global `L`). */
export function addBaseLayer(map) {
  return L.tileLayer(TILES, {
    maxZoom: 19,
    className: 'pb-dark-tiles',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
}
