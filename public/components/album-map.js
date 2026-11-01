// @ts-check
import { PinsMap } from './pins-map.js';
import { t } from '../utils/i18n.js';

/**
 * AlbumMap — full-screen overlay showing all GPS locations of an album.
 *
 * Pins are numbered (coral; white for the current photo). Clicking a pin
 * opens a card with the photo's thumbnail and a button to go to that photo.
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
    this._pins     = new PinsMap(canvasEl);
    this._onSelect = null;

    closeBtn.addEventListener('click',   () => this.close());
    overlayEl.addEventListener('click',  e => { if (e.target === overlayEl) this.close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Open the map and display all GPS-tagged photos of the album.
   * @param {any[]} photos - full album photo list
   * @param {number} currentIndex - index of the currently displayed photo
   * @param {(index: number) => void} onSelect - called when the user picks a photo on a card
   */
  open(photos, currentIndex, onSelect) {
    this._onSelect = onSelect;
    if (!photos.some(p => p.gps)) return; // nothing to show
    this._overlay.classList.remove('hidden');
    this._pins.show(photos, currentIndex, (p, i) => this._buildCard(p, i));
  }

  close() {
    this._overlay.classList.add('hidden');
  }

  /**
   * Re-highlight the active pin after navigation without re-opening the map.
   * @param {number} index - index of the currently displayed photo in the full album list
   */
  setCurrent(index) {
    this._pins.render(index);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _buildCard(photo, index) {
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

    const btn = document.createElement('button');
    btn.className   = 'map-popup-view';
    btn.textContent = t('viewer.seePhoto');
    btn.addEventListener('click', () => {
      this.close();
      this._onSelect?.(index);
    });
    wrap.appendChild(btn);

    return wrap;
  }
}
