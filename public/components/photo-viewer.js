/**
 * PhotoViewer — single Pannellum container + standard <img> with zoom/pan.
 * No spinner: the viewer background (#000) is visible during loading.
 * Pannellum's `preview` option shows a low-res aperçu from cache immediately.
 */
export class PhotoViewer {
  constructor({ root, pnlContainer, stdImg, badge, nameEl, descEl, panoControls }) {
    this._root    = root;
    this._pnl     = pnlContainer;
    this._img     = stdImg;
    this._badge   = badge;
    this._nameEl  = nameEl;
    this._descEl  = descEl;
    this._viewer  = null;
    this._controls = panoControls;   // { wrapper, zoomIn, zoomOut, recenter, gyroBtn }

    // Gyroscope state
    this._gyroOn            = false;
    this._gyroTouching      = false;   // true while a finger is on the 360 canvas
    this._gyroBtn           = panoControls.gyroBtn ?? null;
    this._gyroOrientHandler = null;
    this._gyroRaf           = null;

    this._isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this._isIOS   = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Zoom / pan state (standard photos only)
    this._scale = 1;
    this._tx    = 0;
    this._ty    = 0;

    this._initInteraction();
    this._initPanoControls();
    this._initPanoTouch();

    // Debug: always log raw sensor values to the console
    window.addEventListener('deviceorientation', e => {
      console.log(`α=${e.alpha?.toFixed(1)} β=${e.beta?.toFixed(1)} γ=${e.gamma?.toFixed(1)}`);
    });
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

    if (this._gyroBtn) {
      this._gyroBtn.style.display = 'flex';
      this._gyroBtn.classList.toggle('active', this._gyroOn);
    }

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
        this._viewer.on('load', () => this._onViewerLoad());
      } catch (e) {
        console.error('Pannellum init error:', e);
      }
    });
  }

  _onViewerLoad() {
    if (!this._isTouch) return;
    if (this._gyroOn) {
      // Restore gyro when switching between 360 photos
      this._attachGyro();
    } else if (!this._isIOS) {
      // Android / non-iOS: auto-start without permission prompt
      this._gyroOn = true;
      this._gyroBtn?.classList.add('active');
      this._attachGyro();
    }
    // iOS without prior consent: wait for button tap
  }

  // ── Gyroscope ──────────────────────────────────────────────────────────────

  async _toggleGyro() {
    if (this._gyroOn) {
      this._stopGyro();
      return;
    }
    // iOS 13+ requires an explicit user-gesture permission request
    if (this._isIOS && typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        if (result !== 'granted') return;
      } catch { return; }
    }
    this._gyroOn = true;
    this._gyroBtn?.classList.add('active');
    this._attachGyro();
  }

  /** Wire up the deviceorientation listener + smooth rAF loop driving Pannellum. */
  _attachGyro() {
    if (!this._viewer) return;
    this._teardownGyroLoop();

    const yawRef   = this._viewer.getYaw();
    const pitchRef = this._viewer.getPitch();

    let alphaRef   = null;
    let targetYaw   = yawRef;
    let targetPitch = pitchRef;
    let smoothYaw   = yawRef;
    let smoothPitch = pitchRef;

    // Sensor events → update target (raw, not smoothed)
    this._gyroOrientHandler = e => {
      if (e.alpha === null || e.beta === null) return;

      if (alphaRef === null) alphaRef = e.alpha;

      // Horizontal: alpha delta normalised to −180..180
      let d = e.alpha - alphaRef;
      if (d >  180) d -= 360;
      if (d < -180) d += 360;
      targetYaw = yawRef - d;

      // Vertical: depends on screen orientation
      const angle = screen.orientation?.angle ?? window.orientation ?? 0;
      if (Math.abs(angle) === 90) {
        // Landscape: gamma drives up/down tilt
        targetPitch = Math.max(-85, Math.min(85, -(e.gamma ?? 0)));
      } else {
        // Portrait: beta=90 → horizon, beta>90 → look up
        targetPitch = Math.max(-85, Math.min(85, e.beta - 90));
      }

      console.log(`α=${e.alpha.toFixed(1)} β=${e.beta.toFixed(1)} γ=${(e.gamma??0).toFixed(1)} → yaw=${targetYaw.toFixed(1)} pitch=${targetPitch.toFixed(1)}`);
    };

    // rAF loop: exponential smoothing then feed Pannellum at display refresh rate
    const SMOOTH = 0.2;   // 0.1 = très fluide/lent, 0.3 = réactif
    const tick = () => {
      if (!this._gyroOn) return;
      this._gyroRaf = requestAnimationFrame(tick);
      if (!this._viewer || this._gyroTouching) return;  // pause while finger on screen

      // Lerp yaw (wrap-safe)
      let dy = targetYaw - smoothYaw;
      if (dy >  180) dy -= 360;
      if (dy < -180) dy += 360;
      smoothYaw   += dy * SMOOTH;
      smoothPitch += (targetPitch - smoothPitch) * SMOOTH;

      this._viewer.lookAt(smoothPitch, smoothYaw, this._viewer.getHfov(), false);
    };

    window.addEventListener('deviceorientation', this._gyroOrientHandler);
    this._gyroRaf = requestAnimationFrame(tick);
  }

  _stopGyro() {
    this._gyroOn = false;
    this._gyroBtn?.classList.remove('active');
    this._teardownGyroLoop();
  }

  /** Remove listener + cancel rAF without changing _gyroOn (viewer destroyed or photo change). */
  _teardownGyroLoop() {
    if (this._gyroOrientHandler) {
      window.removeEventListener('deviceorientation', this._gyroOrientHandler);
      this._gyroOrientHandler = null;
    }
    if (this._gyroRaf) {
      cancelAnimationFrame(this._gyroRaf);
      this._gyroRaf = null;
    }
  }

  // ── Standard photo ─────────────────────────────────────────────────────────

  _showStandard(url, onDetect360) {
    this._destroyPannellum();
    this._pnl.style.display = 'none';
    this._controls.wrapper.style.display = 'none';
    if (this._gyroBtn) this._gyroBtn.style.display = 'none';
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
      this._teardownGyroLoop();  // preserve _gyroOn so next photo re-activates
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

    this._gyroBtn?.addEventListener('click', () => this._toggleGyro());
  }

  // ── 360° touch: pause gyro while finger moves, recalibrate on lift ───────────

  _initPanoTouch() {
    let activeTouches = 0;

    this._pnl.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      activeTouches++;
      this._gyroTouching = true;
    });

    const onUp = e => {
      if (e.pointerType !== 'touch') return;
      activeTouches = Math.max(0, activeTouches - 1);
      if (activeTouches > 0) return;

      this._gyroTouching = false;
      // Recalibrate gyro from the position Pannellum landed on after the drag
      if (this._gyroOn && this._viewer) this._attachGyro();
    };

    // Listen on document so we catch pointerup even if finger slides off _pnl
    document.addEventListener('pointerup',     onUp);
    document.addEventListener('pointercancel', onUp);
  }

  // ── Zoom & pan — standard photos (mouse wheel + touch pinch + drag) ─────────

  _initInteraction() {
    const root = this._root;

    // ── Mouse wheel ───────────────────────────────────────────────────────────
    root.addEventListener('wheel', e => {
      if (this._img.style.display === 'none') return;
      e.preventDefault();
      const rect = root.getBoundingClientRect();
      this._zoomAt(
        e.deltaY < 0 ? 1.15 : 1 / 1.15,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    }, { passive: false });

    // ── Pointer (mouse + touch) ───────────────────────────────────────────────
    const ptrs = new Map();          // pointerId → {x, y}
    let dragId     = null;
    let dragSx = 0, dragSy = 0, dragBx = 0, dragBy = 0;
    let pinch      = null;           // { dist0, scale0, tx0, ty0, cx, cy }

    root.addEventListener('pointerdown', e => {
      if (this._img.style.display === 'none') return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      root.setPointerCapture(e.pointerId);

      if (ptrs.size === 2) {
        // Second finger down → start pinch, cancel any drag
        dragId = null;
        const [a, b] = [...ptrs.values()];
        const rect   = root.getBoundingClientRect();
        pinch = {
          dist0:  Math.hypot(b.x - a.x, b.y - a.y),
          scale0: this._scale,
          tx0:    this._tx,
          ty0:    this._ty,
          cx:     (a.x + b.x) / 2 - rect.left,
          cy:     (a.y + b.y) / 2 - rect.top,
        };
      } else if (ptrs.size === 1) {
        // First finger down → drag (only useful when already zoomed)
        pinch  = null;
        dragId = e.pointerId;
        dragSx = e.clientX; dragSy = e.clientY;
        dragBx = this._tx;  dragBy = this._ty;
        if (this._scale > 1) this._img.style.cursor = 'grabbing';
      }
    });

    root.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId) || this._img.style.display === 'none') return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinch && ptrs.size === 2) {
        // Pinch zoom — scale anchored to pinch midpoint
        const [a, b] = [...ptrs.values()];
        const dist   = Math.hypot(b.x - a.x, b.y - a.y);
        const next   = Math.max(1, Math.min(12, pinch.scale0 * dist / pinch.dist0));
        if (next === 1) {
          this._scale = 1; this._tx = 0; this._ty = 0;
        } else {
          const lx    = (pinch.cx - pinch.tx0) / pinch.scale0;
          const ly    = (pinch.cy - pinch.ty0) / pinch.scale0;
          this._scale = next;
          this._tx    = pinch.cx - next * lx;
          this._ty    = pinch.cy - next * ly;
        }
        this._applyZoom();

      } else if (dragId === e.pointerId && this._scale > 1) {
        // Single-finger drag pan
        this._tx = dragBx + (e.clientX - dragSx);
        this._ty = dragBy + (e.clientY - dragSy);
        this._applyZoom();
      }
    }, { passive: false });

    const onEnd = e => {
      ptrs.delete(e.pointerId);
      if (dragId === e.pointerId) {
        dragId = null;
        this._img.style.cursor = this._scale > 1 ? 'grab' : '';
      }
      pinch = null;
      // If one finger remains after a pinch, re-anchor drag
      if (ptrs.size === 1 && this._scale > 1) {
        const [id, pos] = [...ptrs.entries()][0];
        dragId = id; dragSx = pos.x; dragSy = pos.y; dragBx = this._tx; dragBy = this._ty;
        this._img.style.cursor = 'grabbing';
      }
    };
    root.addEventListener('pointerup',     onEnd);
    root.addEventListener('pointercancel', onEnd);

    // Double-tap / double-click to reset zoom
    root.addEventListener('dblclick', () => {
      if (this._img.style.display === 'none') return;
      this._resetZoom();
    });
  }

  _zoomAt(factor, cx, cy) {
    const next = Math.max(1, Math.min(12, this._scale * factor));
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
