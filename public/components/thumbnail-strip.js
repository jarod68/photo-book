/**
 * Horizontal thumbnail strip — sliding-window virtual DOM.
 *
 * At most WINDOW items exist in the DOM at once. Two invisible spacers
 * (left and right) maintain the full scroll width so the scrollbar behaves
 * naturally. As the user scrolls, items entering the window are created and
 * items leaving the window are removed.
 *
 * CSS constants that must stay in sync with style.css:
 *   .thumb  { width: 64px }
 *   #thumbnails { gap: 5px; padding: 0 48px }
 */

const THUMB_W = 64;
const GAP     = 5;
const PAD     = 48;   // #thumbnails horizontal padding
const STRIDE  = THUMB_W + GAP; // 69 px per slot
const WINDOW  = 25;   // max items in the DOM
const BUFFER  = 5;    // items pre-rendered beyond the visible edge on each side

export class ThumbnailStrip {
  /**
   * @param {HTMLElement} el
   * @param {(i: number) => void} onSelect
   * @param {{ prevBtn?: HTMLElement, nextBtn?: HTMLElement }} [arrows]
   */
  constructor(el, onSelect, { prevBtn, nextBtn } = {}) {
    this._el       = el;
    this._onSelect = onSelect;
    this._prevBtn  = prevBtn || null;
    this._nextBtn  = nextBtn || null;

    this._photos   = [];
    this._winStart = 0;
    this._winEnd   = -1;   // empty: winEnd < winStart
    this._left     = null; // left spacer element
    this._right    = null; // right spacer element
    this._rafId    = null;

    this._activeIndex        = -1;
    this._suppressAutoSelect = false; // true while activate() drives the scroll
    this._scrollEndTimer     = null;
    this._suppressTimer      = null;  // safety timeout to always clear the suppress flag

    this._el.addEventListener('scroll', () => {
      this._updateArrows();
      if (this._rafId === null) {
        this._rafId = requestAnimationFrame(() => {
          this._rafId = null;
          this._updateWindow();
        });
      }
      // Detect user scroll-end via debounce (fallback) —
      // cleared if scrollend fires first.
      clearTimeout(this._scrollEndTimer);
      this._scrollEndTimer = setTimeout(() => this._onScrollEnd(), 180);
    }, { passive: true });

    // scrollend is supported in all modern browsers; fires once per scroll gesture.
    this._el.addEventListener('scrollend', () => {
      clearTimeout(this._scrollEndTimer);
      this._scrollEndTimer = null;
      this._onScrollEnd();
    }, { passive: true });

    this._prevBtn?.addEventListener('click', () =>
      this._el.scrollBy({ left: -(this._el.clientWidth * 0.75), behavior: 'smooth' })
    );
    this._nextBtn?.addEventListener('click', () =>
      this._el.scrollBy({ left: this._el.clientWidth * 0.75, behavior: 'smooth' })
    );
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** @param {import('../api/client.js').Photo[]} photos */
  render(photos) {
    if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }

    this._photos      = photos;
    this._winStart    = 0;
    this._winEnd      = -1;
    this._el.innerHTML  = '';
    this._el.scrollLeft = 0;

    if (photos.length === 0) { this._updateArrows(); return; }

    this._left  = this._makeSpacer();
    this._right = this._makeSpacer();
    this._el.appendChild(this._left);
    this._el.appendChild(this._right);

    // Defer first render so clientWidth is computed
    requestAnimationFrame(() => { this._updateWindow(); this._updateArrows(); });
  }

  /**
   * Scroll to and highlight the thumbnail at `index`.
   * @param {number} index
   */
  activate(index) {
    const n = this._photos.length;
    if (index < 0 || index >= n) return;

    this._activeIndex = index;

    // Re-centre the window around target if needed
    if (index < this._winStart || index > this._winEnd) {
      const half  = Math.floor(WINDOW / 2);
      const start = Math.max(0, index - half);
      const end   = Math.min(n - 1, start + WINDOW - 1);
      this._setWindow(start, end);
    }

    this._el.querySelectorAll('.thumb').forEach(el =>
      el.classList.toggle('active', +el.dataset.i === index)
    );

    // Suppress auto-select while the programmatic scroll settles.
    // Cleared by scrollend if a scroll actually happens, or by the safety
    // timeout below when scrollIntoView is a no-op (thumbnail already centered).
    this._suppressAutoSelect = true;
    clearTimeout(this._suppressTimer);
    this._suppressTimer = setTimeout(() => {
      this._suppressAutoSelect = false;
    }, 400);
    this._el.querySelector(`.thumb[data-i="${index}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  /**
   * Add a "360°" badge overlay to the thumbnail at `index`.
   * @param {number} index
   */
  addBadge(index) {
    const thumb = this._el.querySelector(`.thumb[data-i="${index}"]`);
    if (!thumb || thumb.querySelector('.thumb-badge')) return;
    const badge = document.createElement('span');
    badge.className   = 'thumb-badge';
    badge.textContent = '360°';
    thumb.appendChild(badge);
  }

  // ── Auto-select centered thumbnail on scroll-end ────────────────────────────

  _onScrollEnd() {
    if (this._suppressAutoSelect) {
      // This scroll was driven by activate() — clear flag, don't select.
      this._suppressAutoSelect = false;
      clearTimeout(this._suppressTimer);
      return;
    }
    const i = this._centerIndex();
    if (i !== -1 && i !== this._activeIndex) {
      this._onSelect?.(i);
    }
  }

  /** Index of the thumbnail closest to the horizontal center of the strip. */
  _centerIndex() {
    const n = this._photos.length;
    if (!n) return -1;
    const center = this._el.scrollLeft + this._el.clientWidth / 2;
    return Math.max(0, Math.min(n - 1, Math.round((center - PAD) / STRIDE)));
  }

  // ── Window management ───────────────────────────────────────────────────────

  _updateWindow() {
    const n = this._photos.length;
    if (!n || !this._left) return;

    const scrollLeft = this._el.scrollLeft;
    const visible    = this._el.clientWidth;

    const firstVis = Math.max(0,     Math.floor((scrollLeft - PAD) / STRIDE));
    const lastVis  = Math.min(n - 1, Math.ceil((scrollLeft + visible - PAD) / STRIDE));

    const newStart = Math.max(0,     firstVis - BUFFER);
    const newEnd   = Math.min(n - 1, newStart + WINDOW - 1);

    this._setWindow(newStart, newEnd);
  }

  /**
   * Transition the rendered window to [newStart, newEnd].
   * Removes DOM nodes that fall outside, adds nodes that are now inside.
   * Spacers are updated to preserve total scroll width.
   */
  _setWindow(newStart, newEnd) {
    // ── Remove from left ──────────────────────────────────────────────────────
    while (this._winEnd >= this._winStart && this._winStart < newStart) {
      this._left.nextSibling.remove();
      this._winStart++;
    }

    // ── Remove from right ─────────────────────────────────────────────────────
    while (this._winEnd >= this._winStart && this._winEnd > newEnd) {
      this._right.previousSibling.remove();
      this._winEnd--;
    }

    // ── Add to right ──────────────────────────────────────────────────────────
    while (this._winEnd < newEnd) {
      this._el.insertBefore(this._buildThumb(++this._winEnd), this._right);
    }

    // ── Add to left ───────────────────────────────────────────────────────────
    while (this._winStart > newStart) {
      const anchor = this._left.nextSibling; // first existing thumb (or right spacer)
      this._el.insertBefore(this._buildThumb(--this._winStart), anchor);
    }

    this._syncSpacers();
  }

  // ── Spacers ─────────────────────────────────────────────────────────────────

  /**
   * Spacer width = items_represented * STRIDE − GAP.
   * The −GAP accounts for the flex gap that will be inserted after the spacer.
   * When representing 0 items, hide the spacer (display:none removes it from
   * flex flow, eliminating the unwanted 5 px gap before the first real item).
   */
  _syncSpacers() {
    const n          = this._photos.length;
    const leftCount  = this._winStart;
    const rightCount = n - this._winEnd - 1;

    if (leftCount > 0) {
      this._left.style.display = '';
      this._left.style.width   = `${leftCount * STRIDE - GAP}px`;
    } else {
      this._left.style.display = 'none';
    }

    if (rightCount > 0) {
      this._right.style.display = '';
      this._right.style.width   = `${rightCount * STRIDE - GAP}px`;
    } else {
      this._right.style.display = 'none';
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _buildThumb(i) {
    const photo = this._photos[i];

    const thumb   = document.createElement('div');
    thumb.className = 'thumb';
    thumb.setAttribute('role', 'option');
    thumb.dataset.i = i;
    thumb.onclick   = () => this._onSelect?.(i);

    const img  = document.createElement('img');
    img.alt    = photo.name;
    img.onload = () => img.classList.add('loaded');
    img.src    = photo.previewUrl || photo.url;
    thumb.appendChild(img);

    if (photo.is360) {
      const badge = document.createElement('span');
      badge.className   = 'thumb-badge';
      badge.textContent = '360°';
      thumb.appendChild(badge);
    }

    if (photo.isRestricted) {
      const lock = document.createElement('span');
      lock.className = 'thumb-badge thumb-badge--lock';
      lock.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
      </svg>`;
      thumb.appendChild(lock);
    }

    return thumb;
  }

  _makeSpacer() {
    const el = document.createElement('div');
    el.style.cssText = 'flex-shrink:0;height:0;overflow:hidden;display:none;';
    return el;
  }

  _updateArrows() {
    const { scrollLeft, scrollWidth, clientWidth } = this._el;
    if (this._prevBtn) this._prevBtn.disabled = scrollLeft < 2;
    if (this._nextBtn) this._nextBtn.disabled = scrollLeft + clientWidth >= scrollWidth - 2;
  }
}
