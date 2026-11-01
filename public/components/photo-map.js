// @ts-check
import { markerElement } from './map-marker.js';
import { createMap } from '../utils/base-map.js';
import { PinsMap } from './pins-map.js';
import { t } from '../utils/i18n.js';

/**
 * PhotoMap — mini-map in the viewer corner + expandable modal.
 *
 * Mini-map: shows only the current photo's GPS pin (a static preview).
 * Modal (expanded): shows ALL photos with GPS in the album.
 *   - Current photo → white pin
 *   - Other photos  → coral pins; clicking opens a card with a "Voir" button
 *     that closes the modal and goes to that photo.
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
    this._onSelect    = onSelect || null;

    this._miniReady  = null;   // Promise<{ ml, map }>
    this._miniMarker = null;
    this._modal      = new PinsMap(modalCanvas);

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
   * Refresh the map for the newly displayed photo.
   * Shows the mini-map if the photo has GPS; hides it otherwise.
   * @param {any} photo - the current photo
   * @param {number} index - position of photo in the album
   * @param {any[]} photos - full album photo list
   */
  update(photo, index, photos) {
    this._index   = index;
    this._photos  = photos ?? [];
    this._current = photo?.gps ? { ...photo.gps, name: photo.name } : null;

    if (this._current) {
      this._showMini(this._current);
    } else {
      this._mini.classList.add('hidden');
    }
  }

  /** The mini-map was just shown (its size changed): redraw it. */
  refresh() {
    if (this._current) this._showMini(this._current);
  }

  // ── Mini-map (current photo only) ───────────────────────────────────────────

  async _showMini(gps) {
    this._mini.classList.remove('hidden');
    const first = !this._miniReady;
    this._miniReady ??= createMap(this._miniCanvas, { center: [gps.lng, gps.lat], zoom: 12, interactive: false });
    const { ml, map } = await this._miniReady;
    if (first) {
      this._miniMarker = new ml.Marker({ element: markerElement('', false, null), anchor: 'bottom' }).setLngLat([gps.lng, gps.lat]).addTo(map);
    }
    if (this._current !== gps) return;   // another photo meanwhile
    // the container may have been display:none (previous photo without GPS)
    requestAnimationFrame(() => {
      map.resize();
      map.jumpTo({ center: [gps.lng, gps.lat], zoom: 12 });
      this._miniMarker.setLngLat([gps.lng, gps.lat]);
    });
  }

  // ── Modal map (all GPS photos of the album) ─────────────────────────────────

  _openModal() {
    if (!this._photos.some(p => p.gps) && !this._current) return;
    this._modalEl.classList.remove('hidden');
    this._modal.show(this._photos, this._index, (p, i) => this._buildCard(p, i, i === this._index), { focusCurrent: true });
  }

  _buildCard(photo, index, isCurrent) {
    const wrap = document.createElement('div');
    wrap.className = 'map-popup-inner';

    const title = document.createElement('strong');
    title.textContent = photo.name;
    wrap.appendChild(title);

    if (photo.previewUrl) {
      const img = document.createElement('img');
      img.src = photo.thumbUrl || photo.previewUrl;
      img.alt = photo.name;
      wrap.appendChild(img);
    }

    if (isCurrent) {
      const label = document.createElement('p');
      label.className = 'map-popup-date';
      label.textContent = t('viewer.currentPhoto');
      wrap.appendChild(label);
    } else {
      const btn = document.createElement('button');
      btn.className   = 'map-popup-view';
      btn.textContent = t('viewer.seePhoto');
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
