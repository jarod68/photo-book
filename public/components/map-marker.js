// @ts-check
/**
 * Map pins shared by the map page, the viewer's map and the album overlay
 * (HTML elements for MapLibre markers, anchored at their bottom tip): a
 * teardrop pin with a number (SVG, sharp at any size), an optional place
 * label to its right, and the round cluster badge with a count.
 */

// pin fill / number colour: the app's coral; the current photo inverted (white pin)
const COLOR_DEFAULT = { fill: '#ff8a5b', text: '#1d0e07', stroke: 'white' };
const COLOR_CURRENT = { fill: 'white',   text: '#1d0e07', stroke: '#ff8a5b' };

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * A pin: a MapLibre marker element (anchor "bottom": the tip on the spot).
 * @param {number|string} num          - number shown inside the pin (empty: none)
 * @param {boolean}      isCurrent     - current photo: a white, larger pin
 * @param {string|null}  locationLabel - place name shown next to the pin
 * @returns {HTMLElement}
 */
export function markerElement(num, isCurrent, locationLabel) {
  const color = isCurrent ? COLOR_CURRENT : COLOR_DEFAULT;
  const w     = isCurrent ? 34 : 28;
  const h     = isCurrent ? 46 : 38;
  const fs    = isCurrent ? 10 : 9;
  const label = locationLabel ? `<span class="map-pin-label">${escapeHtml(_clip(locationLabel, 24))}</span>` : '';
  const el = document.createElement('div');
  el.className = `map-marker-wrap${isCurrent ? ' current' : ''}`;
  el.style.zIndex = isCurrent ? '2' : '1';
  // the SVG has a fixed viewBox (0 0 28 38); width / height scale it up for the current photo
  el.innerHTML = `
    <svg width="${w}" height="${h}" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 1C7.4 1 2 6.4 2 13c0 8.4 12 23.5 12 23.5S26 21.4 26 13C26 6.4 20.6 1 14 1z"
            fill="${color.fill}" stroke="${color.stroke}" stroke-width="2"/>
      <text x="14" y="13" text-anchor="middle" dominant-baseline="central"
            fill="${color.text}" font-size="${fs}" font-weight="700"
            font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${num}</text>
    </svg>
    ${label}`;
  return el;
}

/**
 * A cluster badge (anchor "center"): concentric rings, the count inside.
 * @param {number} count
 * @returns {HTMLElement}
 */
export function clusterElement(count) {
  const tier = count < 10 ? 'sm' : count < 100 ? 'md' : 'lg';
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `map-cluster map-cluster--${tier}`;
  el.innerHTML = `<span>${count > 999 ? '999+' : count}</span>`;
  return el;
}

/** Extract first segment of "Paris, France" → "Paris" */
export function shortLocation(location) {
  if (!location) return null;
  return _clip(location.split(',')[0].trim(), 24);
}

function _clip(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
