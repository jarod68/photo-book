/**
 * PhotoViewer — single Pannellum container + standard <img> with zoom/pan.
 * No spinner: the viewer background (#000) is visible during loading.
 * Pannellum's `preview` option shows a low-res preview from cache immediately.
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
   *   panoControls: { wrapper: HTMLElement, zoomIn: HTMLElement, zoomOut: HTMLElement, recenter: HTMLElement, gyroBtn: HTMLElement },
   *   onToggleUI:   () => void,
   *   onSwipe:      (dir: 'left'|'right') => void,
   * }} opts
   */
  constructor({ root, pnlContainer, stdImg, badge, nameEl, descEl, panoControls, onToggleUI, onSwipe }) {
    this._root       = root;
    this._pnl        = pnlContainer;
    this._img        = stdImg;
    this._badge      = badge;
    this._nameEl     = nameEl;
    this._descEl     = descEl;
    this._viewer     = null;
    this._controls   = panoControls;   // { wrapper, zoomIn, zoomOut, recenter, gyroBtn }
    this._onToggleUI = onToggleUI ?? null;
    this._onSwipe    = onSwipe    ?? null;

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
    this._initPanoEdgeSwipe();

  }

  // ── Public ─────────────────────────────────────────────────────────────────

  /**
   * Display a photo. Switches between panoramic (Pannellum) and standard view.
   * @param {import('../api/client.js').Photo} photo
   * @param {() => void} onDetect360 - called if the image is detected as 360°
   */
  show(photo, onDetect360) {
    this._resetZoom();
    this._nameEl.textContent = photo.name;
    this._descEl.textContent = photo.description;
    this._badge.classList.toggle('visible', photo.is360);

    if (photo.is360) {
      this._show360(photo.url, photo.previewUrl);
    } else {
      // photo.mediumUrl can be null if the server failed to generate the file.
      // Derive it from photo.url as a fallback: /photos/A/f.EXT → /medium/A/f.jpg
      // _showStandard's onerror handler will fall back to full if the file is absent.
      const mediumUrl = photo.mediumUrl
        ?? photo.url.replace(/^\/photos\//, '/medium/').replace(/\.[^./?#]+$/, '.jpg');
      this._showStandard(photo.url, mediumUrl, onDetect360);
    }
  }

  destroy() { this._destroyPannellum(); }

  // ── 360° ───────────────────────────────────────────────────────────────────

  _show360(url, previewUrl) {
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
          preview:            previewUrl || undefined,
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


    };

    // rAF loop: exponential smoothing then feed Pannellum at display refresh rate
    const SMOOTH = 0.2;   // 0.1 = very smooth/slow, 0.3 = responsive
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

  _showStandard(url, mediumUrl, onDetect360) {
    this._destroyPannellum();
    this._pnl.style.display = 'none';
    this._controls.wrapper.style.display = 'flex';
    if (this._gyroBtn) this._gyroBtn.style.display = 'none';
    this._img.classList.remove('loaded');
    this._img.style.display = 'block';

    const token = Symbol();
    this._loadToken = token;

    const check360 = (w, h) => {
      const r = w / h;
      return r >= 1.95 && r <= 2.05 && w >= 3000;
    };

    // Exception: full already loaded this session → skip medium.
    // performance.getEntriesByName detects the cache without starting
    // any network request (unlike new Image().src which does).
    const alreadyLoaded = performance.getEntriesByName(url, 'resource').length > 0;
    if (alreadyLoaded) {
      this._img.onload = () => {
        if (this._loadToken !== token) return;
        if (check360(this._img.naturalWidth, this._img.naturalHeight)) {
          this._badge.classList.add('visible');
          onDetect360?.();
          this._show360(url);
          return;
        }
        this._img.classList.add('loaded');
      };
      this._img.onerror = () => { if (this._loadToken === token) this._img.classList.add('loaded'); };
      this._img.src = url;
      return;
    }

    // Step 1: load medium and display it.
    // Step 2: after medium is visible, fetch full in a hidden Image to
    //         populate the cache, then swap it into this._img.
    const loadFull = () => {
      const pre = new Image();
      pre.onload = () => {
        if (this._loadToken !== token) return;
        if (check360(pre.naturalWidth, pre.naturalHeight)) {
          this._badge.classList.add('visible');
          onDetect360?.();
          this._show360(url);
          return;
        }
        // Replace medium handler before changing src to prevent re-entry.
        this._img.onload  = () => { if (this._loadToken === token) this._img.classList.add('loaded'); };
        this._img.onerror = () => {};
        this._img.src = url;
      };
      pre.onerror = () => {};
      pre.src = url;
    };

    const loadFullDirect = () => {
      this._img.onload  = () => { if (this._loadToken === token) this._img.classList.add('loaded'); };
      this._img.onerror = () => { if (this._loadToken === token) this._img.classList.add('loaded'); };
      this._img.src = url;
    };

    if (mediumUrl && mediumUrl !== url) {
      this._img.onload = () => {
        if (this._loadToken !== token) return;
        this._img.classList.add('loaded');
        loadFull();
      };
      this._img.onerror = () => {
        if (this._loadToken !== token) return;
        loadFullDirect();
      };
      this._img.src = mediumUrl;
    } else {
      loadFullDirect();
    }
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
      if (this._viewer) {
        this._viewer.setHfov(Math.max(30, this._viewer.getHfov() - 15), 300);
      } else {
        const r = this._root.getBoundingClientRect();
        this._zoomAt(1.5, r.width / 2, r.height / 2);
      }
    });

    zoomOut.addEventListener('click', () => {
      if (this._viewer) {
        this._viewer.setHfov(Math.min(120, this._viewer.getHfov() + 15), 300);
      } else {
        const r = this._root.getBoundingClientRect();
        this._zoomAt(1 / 1.5, r.width / 2, r.height / 2);
      }
    });

    recenter.addEventListener('click', () => {
      if (this._viewer) {
        this._viewer.setYaw(0, 600);
        this._viewer.setPitch(0, 600);
        this._viewer.setHfov(90, 600);
      } else {
        this._resetZoom();
      }
    });

    this._gyroBtn?.addEventListener('click', () => this._toggleGyro());
  }

  // ── 360° edge swipe: intercept border touches to navigate between photos ─────
  // Uses touch events with capture so Pannellum never sees the event.

  _initPanoEdgeSwipe() {
    const EDGE_PX = () => window.innerWidth * 0.15;
    let edgeTouch = null; // { id, startX, startY }

    const onTouchStart = e => {
      if (this._pnl.style.display === 'none') return;
      const t = e.changedTouches[0];
      const edge = EDGE_PX();
      if (t.clientX < edge || t.clientX > window.innerWidth - edge) {
        e.stopPropagation();
        e.preventDefault();
        edgeTouch = { id: t.identifier, startX: t.clientX, startY: t.clientY };
      }
    };

    const onTouchMove = e => {
      if (!edgeTouch) return;
      e.stopPropagation();
      e.preventDefault();
    };

    const onTouchEnd = e => {
      if (!edgeTouch) return;
      e.stopPropagation();
      const t = Array.from(e.changedTouches).find(c => c.identifier === edgeTouch.id);
      if (t) {
        const dx = t.clientX - edgeTouch.startX;
        const dy = t.clientY - edgeTouch.startY;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          this._onSwipe?.(dx < 0 ? 'left' : 'right');
        }
      }
      edgeTouch = null;
    };

    this._pnl.addEventListener('touchstart',  onTouchStart, { capture: true, passive: false });
    this._pnl.addEventListener('touchmove',   onTouchMove,  { capture: true, passive: false });
    this._pnl.addEventListener('touchend',    onTouchEnd,   { capture: true });
    this._pnl.addEventListener('touchcancel', () => { edgeTouch = null; }, { capture: true });
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

    // Tap detection — track origin + whether pointer moved significantly.
    // Used by the click handler below to distinguish tap from drag.
    let _tapX = 0, _tapY = 0, _tapped = false;

    // Edge-swipe: a touch starting within 15 % of either side navigates between photos.
    const EDGE_PX = () => window.innerWidth * 0.15;
    let isEdgeDrag = false;

    root.addEventListener('pointerdown', e => {
      _tapX    = e.clientX;
      _tapY    = e.clientY;
      _tapped  = true;

      if (this._img.style.display === 'none') return;
      // Do not capture clicks on overlaid interactive elements
      // (mini-map, nav buttons, etc.) — setPointerCapture would block
      // their click event by redirecting pointerup to #viewer.
      if (e.target.closest('button, a, .photo-map-mini')) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      root.setPointerCapture(e.pointerId);

      const edge = EDGE_PX();
      isEdgeDrag = e.clientX < edge || e.clientX > window.innerWidth - edge;

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
      // Invalidate the tap as soon as the finger/cursor moves more than 8 px
      if (_tapped && Math.hypot(e.clientX - _tapX, e.clientY - _tapY) > 8) _tapped = false;

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
        // Edge swipe → navigation entre photos (prioritaire sur zoom/pan)
        if (isEdgeDrag && pinch === null) {
          const dx = e.clientX - dragSx;
          const dy = e.clientY - dragSy;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            this._onSwipe?.(dx < 0 ? 'left' : 'right');
          }
        }
        dragId     = null;
        isEdgeDrag = false;
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

    // ── Clic simple → toggle UI  /  double-clic → reset zoom ou recenter 360° ──
    let _clickTimer = null;

    root.addEventListener('click', e => {
      if (!_tapped) return;                                          // was a drag
      if (e.target.closest('button, a, .photo-map-mini')) return;   // interactive element

      if (_clickTimer) {
        // Second click within the window → double-click
        clearTimeout(_clickTimer);
        _clickTimer = null;
        if (this._viewer) {
          this._viewer.setYaw(0, 600);
          this._viewer.setPitch(0, 600);
          this._viewer.setHfov(90, 600);
        } else {
          this._resetZoom();
        }
      } else {
        // First click — wait to see if a second one follows
        _clickTimer = setTimeout(() => {
          _clickTimer = null;
          this._onToggleUI?.();
        }, 280);
      }
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
