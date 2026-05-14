import { buildMarkerIcon, shortLocation } from './map-marker.js';

/**
 * AlbumMap — full-screen overlay showing all GPS locations of an album.
 *
 * Markers are numbered and colour-coded (blue = default, red = current photo).
 * Clicking a marker opens a popup with the photo thumbnail and a button to
 * navigate directly to that photo in the gallery.
 */
export class AlbumMap {
  /**
   * @param {{
   *   overlayEl: HTMLElement,
   *   canvasEl:  HTMLElement,
   *   closeBtn:  HTMLElement,
   * }} els
   */
  constructor({ overlayEl, canvasEl, closeBtn }) {
    this._overlay  = overlayEl;
    this._canvas   = canvasEl;
    this._map      = null;
    this._markers  = [];
    this._onSelect = null;

    closeBtn.addEventListener('click',   () => this.close());
    overlayEl.addEventListener('click',  e => { if (e.target === overlayEl) this.close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Open the map and display all GPS-tagged photos of the album.
   * @param {Array}    photos       - full photo list (only those with .gps are shown)
   * @param {number}   currentIndex - index of the photo currently displayed
   * @param {Function} onSelect     - called with a photo index when user clicks "Voir"
   */
  /**
   * Open the map and display all GPS-tagged photos of the album.
   * @param {import('../api/client.js').Photo[]} photos - full album photo list
   * @param {number} currentIndex - index of the currently displayed photo
   * @param {(index: number) => void} onSelect - called when user clicks "Voir" on a pin
   */
  open(photos, currentIndex, onSelect) {
    this._onSelect = onSelect;
    const geoPhotos = photos.filter(p => p.gps);

    if (geoPhotos.length === 0) return; // nothing to show

    this._overlay.classList.remove('hidden');
    this._buildMap(photos, geoPhotos, currentIndex);
  }

  close() {
    this._overlay.classList.add('hidden');
  }

  /**
   * Re-highlight the active marker after navigation without re-opening the map.
   * @param {number} index - index of the currently displayed photo in the full album list
   */
  setCurrent(index) {
    this._markers.forEach(({ marker, photo, i }) => {
      marker.setIcon(buildMarkerIcon(i + 1, i === index, shortLocation(photo.location)));
    });
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _buildMap(allPhotos, geoPhotos, currentIndex) {
    if (!this._map) {
      this._map = L.map(this._canvas);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(this._map);
    }

    this._markers.forEach(({ marker }) => marker.remove());
    this._markers = [];

    const bounds = [];

    geoPhotos.forEach(photo => {
      const i         = allPhotos.indexOf(photo);
      const isCurrent = i === currentIndex;
      const icon      = buildMarkerIcon(i + 1, isCurrent, shortLocation(photo.location));

      const marker = L.marker([photo.gps.lat, photo.gps.lng], { icon })
        .addTo(this._map)
        .bindPopup(() => this._buildPopup(photo, i), { maxWidth: 180, minWidth: 160 });

      this._markers.push({ marker, photo, i });
      bounds.push([photo.gps.lat, photo.gps.lng]);
    });

    // Double rAF: the container just transitioned from display:none → visible.
    // Leaflet cached a zero size; wait for the browser to finish layout
    // before calling invalidateSize and fitBounds.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this._map.invalidateSize();
      if (bounds.length === 1) {
        this._map.setView(bounds[0], 14);
      } else if (bounds.length > 1) {
        this._map.fitBounds(bounds, { padding: [40, 40] });
      }
    }));
  }

  _buildPopup(photo, index) {
    const wrap = document.createElement('div');
    wrap.className = 'map-popup-inner';

    const title = document.createElement('strong');
    title.textContent = photo.name;
    wrap.appendChild(title);

    if (photo.previewUrl) {
      const img = document.createElement('img');
      img.src = photo.previewUrl;
      img.alt = photo.name;
      wrap.appendChild(img);
    }

    const btn = document.createElement('button');
    btn.className   = 'map-popup-view';
    btn.textContent = 'Voir la photo';
    btn.addEventListener('click', () => {
      this.close();
      this._onSelect?.(index);
    });
    wrap.appendChild(btn);

    return wrap;
  }
}
