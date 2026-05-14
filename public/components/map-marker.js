/**
 * Shared Leaflet marker builder used by both PhotoMap and AlbumMap.
 *
 * Produces a Google Maps-style teardrop pin (SVG, scales cleanly) with an
 * optional location label pill to the right of the pin.
 */

const COLOR_DEFAULT = '#3b82f6'; // cobalt blue
const COLOR_CURRENT = '#ef4444'; // red — current photo

/**
 * @param {number}       num           - number shown inside the pin
 * @param {boolean}      isCurrent     - current photo gets a red, larger pin
 * @param {string|null}  locationLabel - city/place name displayed next to pin
 * @returns {L.DivIcon}
 */
export function buildMarkerIcon(num, isCurrent, locationLabel) {
  const color = isCurrent ? COLOR_CURRENT : COLOR_DEFAULT;
  const w     = isCurrent ? 34 : 28;
  const h     = isCurrent ? 46 : 38;
  const fs    = isCurrent ? 10 : 9;

  // Truncate label to keep the map readable
  const label = locationLabel
    ? `<span class="map-pin-label">${_clip(locationLabel, 24)}</span>`
    : '';

  // SVG uses a fixed viewBox (0 0 28 38); width/height scale it up for current.
  const html = `<div class="map-marker-wrap${isCurrent ? ' current' : ''}">
    <svg width="${w}" height="${h}" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 1C7.4 1 2 6.4 2 13c0 8.4 12 23.5 12 23.5S26 21.4 26 13C26 6.4 20.6 1 14 1z"
            fill="${color}" stroke="white" stroke-width="2"/>
      <text x="14" y="13" text-anchor="middle" dominant-baseline="central"
            fill="white" font-size="${fs}" font-weight="700"
            font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${num}</text>
    </svg>
    ${label}
  </div>`;

  return L.divIcon({
    html,
    className:   '',
    iconSize:    [w, h],
    iconAnchor:  [Math.round(w / 2), h],   // tip of pin
    popupAnchor: [0, -(h + 4)],            // popup opens above the pin
  });
}

/**
 * Cluster icon for L.markerClusterGroup — concentric-ring style, matches pin palette.
 * @param {L.MarkerCluster} cluster
 * @returns {L.DivIcon}
 */
export function buildClusterIcon(cluster) {
  const count = cluster.getChildCount();
  const tier  = count < 10 ? 'sm' : count < 100 ? 'md' : 'lg';
  const size  = { sm: 40, md: 50, lg: 60 }[tier];
  return L.divIcon({
    html:        `<div class="map-cluster map-cluster--${tier}"><span>${count}</span></div>`,
    className:   '',
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

/** Extract first segment of "Paris, France" → "Paris" */
export function shortLocation(location) {
  if (!location) return null;
  return _clip(location.split(',')[0].trim(), 24);
}

function _clip(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
