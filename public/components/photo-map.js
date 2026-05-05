import { buildMarkerIcon, shortLocation } from './map-marker.js';

/**
 * PhotoMap — mini-map in the viewer corner + expandable modal.
 *
 * Mini-map: shows only the current photo's GPS pin.
 * Modal (expanded): shows ALL photos with GPS in the album.
 *   - Current photo → red pin
 *   - Other photos  → blue pins; clicking opens a popup with a "Voir" button
 *     that closes the modal and navigates to that photo.
 */
export class PhotoMap {
  /**
   * @param {{
   *   miniEl:       HTMLElement,
   *   miniCanvas:   HTMLElement,
   *   expandBtn:    HTMLElement,
   *   modalEl:      HTMLElement,
   *   modalCanvas:  HTMLElement,
   *   closeBtn:     HTMLElement,
   *   onSelect:     (index: number) => void,
   * }} opts
   */
  constructor({ miniEl, miniCanvas, expandBtn, modalEl, modalCanvas, closeBtn, onSelect }) {
    this._mini        = miniEl;
    this._miniCanvas  = miniCanvas;
    this._modalEl     = modalEl;
    this._modalCanvas = modalCanvas;
    this._onSelect    = onSelect || null;

    this._miniMap      = null;
    this._miniMarker   = null;
    this._modalMap     = null;
    this._modalMarkers = [];

    // Context set by update()
    this._photos  = [];
    this._index   = -1;
    this._current = null; // { lat, lng, name } | null

    expandBtn.addEventListener('click', e => { e.stopPropagation(); this._openModal(); });
    miniEl.addEventListener('click',   () => this._openModal());
    closeBtn.addEventListener('click', () => this._closeModal());
    modalEl.addEventListener('click',  e => { if (e.target === modalEl) this._closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this._closeModal(); });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Call every time the displayed photo changes.
   * @param {Object}  photo  - current photo object (may have .gps)
   * @param {number}  index  - index in the photos array
   * @param {Array}   photos - full album photo list
   */
  update(photo, index, photos) {
    this._index   = index;
    this._photos  = photos ?? [];
    this._current = photo?.gps ? { ...photo.gps, name: photo.name } : null;

    if (this._current) {
      this._showMini(photo.gps, photo.name);
    } else {
      this._mini.classList.add('hidden');
    }
  }

  // ── Mini-map (current photo only) ───────────────────────────────────────────

  _showMini(gps, name) {
    this._mini.classList.remove('hidden');

    if (!this._miniMap) {
      this._miniMap = L.map(this._miniCanvas, {
        zoomControl: false, attributionControl: false,
        dragging: false, scrollWheelZoom: false,
        doubleClickZoom: false, boxZoom: false,
        keyboard: false, touchZoom: false,
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
        .addTo(this._miniMap);
      this._miniMarker = L.marker([gps.lat, gps.lng]).addTo(this._miniMap);
      this._miniMap.setView([gps.lat, gps.lng], 13);
      requestAnimationFrame(() => this._miniMap.invalidateSize());
      return;
    }

    this._miniMarker.setLatLng([gps.lat, gps.lng]);
    // Le conteneur était peut-être display:none (photo sans GPS précédente) :
    // invalidateSize() recalibre la taille avant setView.
    requestAnimationFrame(() => {
      this._miniMap.invalidateSize();
      this._miniMap.setView([gps.lat, gps.lng], 13);
    });
  }

  // ── Modal map (all GPS photos of the album) ─────────────────────────────────

  _openModal() {
    const geoPhotos = this._photos.filter(p => p.gps);
    if (geoPhotos.length === 0 && !this._current) return;

    this._modalEl.classList.remove('hidden');

    if (!this._modalMap) {
      this._modalMap = L.map(this._modalCanvas);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(this._modalMap);
    }

    // Clear previous markers
    this._modalMarkers.forEach(m => m.remove());
    this._modalMarkers = [];

    const bounds = [];

    this._photos.forEach((photo, i) => {
      if (!photo.gps) return;

      const isCurrent = i === this._index;
      const icon = buildMarkerIcon(i + 1, isCurrent, shortLocation(photo.location));

      const marker = L.marker([photo.gps.lat, photo.gps.lng], {
        icon,
        zIndexOffset: isCurrent ? 1000 : 0,
      })
        .addTo(this._modalMap)
        .bindPopup(() => this._buildPopup(photo, i, isCurrent), { maxWidth: 180, minWidth: 160 });

      this._modalMarkers.push(marker);
      bounds.push([photo.gps.lat, photo.gps.lng]);
    });

    // setView APRÈS invalidateSize : le conteneur vient d'être affiché (display:none → flex),
    // Leaflet a mis en cache une taille zéro. On attend deux frames pour que le navigateur
    // ait terminé le layout, puis on recalibre avant de positionner la vue.
    const current = this._current;
    const fitBounds = bounds.length > 0 ? bounds : null;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this._modalMap.invalidateSize();
      if (current) {
        this._modalMap.setView([current.lat, current.lng], 14);
      } else if (fitBounds) {
        this._modalMap.fitBounds(fitBounds, { padding: [50, 50] });
      }
    }));
  }

  _buildPopup(photo, index, isCurrent) {
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

    if (isCurrent) {
      const label = document.createElement('p');
      label.style.cssText = 'font-size:11px;color:#888;margin:4px 0 0;text-align:center;';
      label.textContent = 'Photo en cours';
      wrap.appendChild(label);
    } else {
      const btn = document.createElement('button');
      btn.className   = 'map-popup-view';
      btn.textContent = 'Voir la photo';
      btn.addEventListener('click', () => {
        this._closeModal();
        this._onSelect?.(index);
      });
      wrap.appendChild(btn);
    }

    return wrap;
  }

  _closeModal() {
    this._modalEl.classList.add('hidden');
  }
}
