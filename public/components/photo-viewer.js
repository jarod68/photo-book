/**
 * PhotoViewer — single Pannellum container + standard <img> with zoom/pan.
 * No spinner: the viewer background (#000) is visible during loading.
 * Pannellum's `preview` option shows a low-res aperçu from cache immediately.
 */
export class PhotoViewer {
  /**
   * @param {{
   *   root:         HTMLElement,
   *   pnlContainer: HTMLElement,
   *   stdImg:       HTMLImageElement,
   *   badge:        HTMLElement,
   *   nameEl:       HTMLElement,
   *   descEl:       HTMLElement,
   * }} els
   */
  constructor({ root, pnlContainer, stdImg, badge, nameEl, descEl, panoControls }) {
    this._root    = root;
    this._pnl     = pnlContainer;
    this._img     = stdImg;
    this._badge   = badge;
    this._nameEl  = nameEl;
    this._descEl  = descEl;
    this._viewer  = null;
    this._controls = panoControls;   // { wrapper, zoomIn, zoomOut, recenter }

    // Zoom / pan state (standard photos only)
    this._scale = 1;
    this._tx    = 0;
    this._ty    = 0;

    this._initInteraction();
    this._initPanoControls();
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  show(photo, onDetect360) {
    this._resetZoom();
    this._nameEl.textContent = photo.name;
    this._descEl.textContent = photo.description;
    this._badge.classList.toggle('visible', photo.is360);

    if (photo.is360) {
      this._show360(photo.url);
    } else {
      this._showStandard(photo.url, onDetect360);
    }
  }

  destroy() { this._destroyPannellum(); }

  // ── 360° ───────────────────────────────────────────────────────────────────

  _show360(url) {
    this._pnl.style.display = 'block';
    this._img.style.display = 'none';
    this._img.classList.remove('loaded');
    this._controls.wrapper.style.display = 'flex';
    this._destroyPannellum();

    // One rAF so the browser paints display:block before Pannellum reads
    // the container dimensions for WebGL (0×0 → onLoad never fires).
    requestAnimationFrame(() => {
      try {
        this._viewer = pannellum.viewer('pnl-container', {
          type:               'equirectangular',
          panorama:           url,
          autoLoad:           true,
          showZoomCtrl:       false,
          showFullscreenCtrl: false,
          showControls:       false,
          mouseZoom:          true,
          hfov:               90,
        });
      } catch (e) {
        console.error('Pannellum init error:', e);
      }
    });
  }

  // ── Standard photo ─────────────────────────────────────────────────────────

  _showStandard(url, onDetect360) {
    this._destroyPannellum();
    this._pnl.style.display = 'none';
    this._controls.wrapper.style.display = 'none';
    this._img.classList.remove('loaded');
    this._img.style.display = 'block';

    this._img.onload = () => {
      // Client-side 360° fallback for untagged equirectangular images
      const r = this._img.naturalWidth / this._img.naturalHeight;
      if (r >= 1.95 && r <= 2.05 && this._img.naturalWidth >= 3000) {
        this._badge.classList.add('visible');
        onDetect360?.();
        this._show360(url);
        return;
      }
      this._img.classList.add('loaded');
    };
    this._img.onerror = () => this._img.classList.add('loaded');
    this._img.src = url;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _destroyPannellum() {
    if (this._viewer) {
      try { this._viewer.destroy(); } catch (_) {}
      this._viewer = null;
      this._pnl.innerHTML = '';
    }
  }

  // ── Panorama controls ──────────────────────────────────────────────────────

  _initPanoControls() {
    const { zoomIn, zoomOut, recenter } = this._controls;

    zoomIn.addEventListener('click', () => {
      if (!this._viewer) return;
      this._viewer.setHfov(Math.max(30, this._viewer.getHfov() - 15), 300);
    });

    zoomOut.addEventListener('click', () => {
      if (!this._viewer) return;
      this._viewer.setHfov(Math.min(120, this._viewer.getHfov() + 15), 300);
    });

    recenter.addEventListener('click', () => {
      if (!this._viewer) return;
      this._viewer.setYaw(0, 600);
      this._viewer.setPitch(0, 600);
      this._viewer.setHfov(90, 600);
    });
  }

  // ── Zoom & pan (standard photos only) ──────────────────────────────────────

  _initInteraction() {
    const root = this._root;

    root.addEventListener('wheel', e => {
      if (this._img.style.display === 'none') return;
      e.preventDefault();

      const rect   = root.getBoundingClientRect();
      const cx     = e.clientX - rect.left;
      const cy     = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const next   = Math.max(1, Math.min(12, this._scale * factor));

      if (next === 1) {
        this._scale = 1; this._tx = 0; this._ty = 0;
      } else {
        const lx = (cx - this._tx) / this._scale;
        const ly = (cy - this._ty) / this._scale;
        this._tx    = cx - next * lx;
        this._ty    = cy - next * ly;
        this._scale = next;
      }
      this._applyZoom();
    }, { passive: false });

    let dragging = false;
    let sx = 0, sy = 0, bx = 0, by = 0;

    root.addEventListener('pointerdown', e => {
      if (this._img.style.display === 'none' || this._scale <= 1) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      bx = this._tx;  by = this._ty;
      root.setPointerCapture(e.pointerId);
      this._img.style.cursor = 'grabbing';
    });

    root.addEventListener('pointermove', e => {
      if (!dragging) return;
      this._tx = bx + (e.clientX - sx);
      this._ty = by + (e.clientY - sy);
      this._applyZoom();
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      this._img.style.cursor = this._scale > 1 ? 'grab' : '';
    };
    root.addEventListener('pointerup',     endDrag);
    root.addEventListener('pointercancel', endDrag);

    root.addEventListener('dblclick', () => {
      if (this._img.style.display === 'none') return;
      this._resetZoom();
    });
  }

  _applyZoom() {
    this._img.style.transformOrigin = '0 0';
    this._img.style.transform       = `translate(${this._tx}px,${this._ty}px) scale(${this._scale})`;
    this._img.style.cursor          = this._scale > 1 ? 'grab' : '';
  }

  _resetZoom() {
    this._scale = 1; this._tx = 0; this._ty = 0;
    this._img.style.transform       = '';
    this._img.style.transformOrigin = '';
    this._img.style.cursor          = '';
  }
}
