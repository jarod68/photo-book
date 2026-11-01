// @ts-check
/**
 * The 2D maps of the app — the map page, the viewer's mini-map, its map of
 * the album and the album overlay — on MapLibre GL, like the globe's close-up
 * view: vector tiles from OpenFreeMap (keyless, OpenStreetMap data) in their
 * "dark" style, place names in the page's language, sharp at any zoom.
 * MapLibre (1.5 MB) is imported only when a map is first shown; the module
 * comes from /vendor/ (services/vendor.js) — a variable URL, so the page
 * bundles leave it out.
 */
import { getLang } from './i18n.js';

const MAPLIBRE = '/vendor/maplibre-gl/maplibre-gl.mjs';
const STYLE = 'https://tiles.openfreemap.org/styles/dark';

/** @type {Promise<any> | null} */
let lib = null;
/** The MapLibre module (loaded once). */
export function loadMapLibre() {
  lib ??= import(/* webpackIgnore: true */ MAPLIBRE);
  return lib;
}

const nameExpr = (lang) => ['coalesce', ['get', `name:${lang}`], ['get', 'name:latin'], ['get', 'name']];

/** @type {Promise<any> | null} */
let style = null;
/** OpenFreeMap "dark", place names in the reader's language (a fresh copy each time). */
export async function darkStyle(lang = getLang()) {
  style ??= fetch(STYLE).then((r) => r.json()).then((s) => {
    for (const l of s.layers) {
      const tf = l.layout?.['text-field'];
      // place and water names, not road numbers
      if (tf && JSON.stringify(tf).includes('"name')) l.layout['text-field'] = nameExpr(lang);
    }
    return s;
  });
  return structuredClone(await style);
}

/**
 * A map in `container`: { ml (the MapLibre module), map }.
 * @param {HTMLElement} container
 * @param {{ center?: [number, number], zoom?: number, interactive?: boolean, controls?: boolean } & Record<string, any>} [opts]
 *   center as [lng, lat]; interactive: false for a static preview (the mini-map)
 */
export async function createMap(container, { center = [10, 20], zoom = 1, interactive = true, controls = interactive, ...rest } = {}) {
  const ml = await loadMapLibre();
  const map = new ml.Map({
    container, style: await darkStyle(), center, zoom, interactive,
    attributionControl: false,
    fadeDuration: 150,
    ...rest,
  });
  if (controls) map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-left');
  // a static preview keeps its bottom-right corner for its own button (expand)
  map.addControl(new ml.AttributionControl({ compact: true }), interactive ? 'bottom-right' : 'bottom-left');
  // the credits start folded behind their (i) button: unfolded, they cover a small map
  map.once('load', () => container.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'));
  return { ml, map };
}

/** [[west, south], [east, north]] around GPS points ({ lat, lng }). */
export function boundsOf(points) {
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}
