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
   *   panoControls: { wrapper: HTMLElement, zoomIn: HTMLElement, zoomOut: HTMLElement, recenter: HTMLElement, gyroBtn: HTMLElement },
   *   onToggleUI:   () => void,
   *   onSwipe:      (dir: 'left'|'right') => void,
   * }} opts
   */
  constructor({ root, pnlContainer, stdImg, badge, nameEl, descEl, panoControls, onToggleUI, onSwipe }) {
    this._root       = root;
    this._pnl        = pnlContainer;
    this._img        = stdImg;
    // the browser's own image drag-and-drop would cancel the pan (pointercancel)
    stdImg.draggable = false;
    stdImg.addEventListener('dragstart', (e) => e.preventDefault());
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
    this._goal  = null;    // { s, tx, ty, tau }: where the eased animation heads
    this._raf   = null;
    this._hfovGoal = null; // 360°: field of view the eased wheel zoom heads to
    this._hfovRaf  = null;

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

    if (photo.type === 'video') {
      this._showVideo(photo);
      return;
    }
    this._hideVideo();

    // HEIC / TIFF originals cannot be shown by most browsers: use the
    // full-size JPEG the server made for them (the download keeps the original).
    const fullUrl = photo.displayUrl || photo.url;
    if (photo.is360) {
      // phones get the 4096 px panorama rather than the (often 8–12K) original
      const touch = matchMedia('(pointer: coarse)').matches;
      this._show360({ full: (touch && photo.panoUrl) || fullUrl, light: photo.previewUrl, view: photo.initialView });
    } else {
      // photo.mediumUrl can be null if the server failed to generate the file.
      // Derive it from photo.url as a fallback: /photos/A/f.EXT → /medium/A/f.EXT.jpg
      // _showStandard's onerror handler will fall back to full if the file is absent.
      const mediumUrl = photo.mediumUrl
        ?? photo.url.split('?')[0].replace(/^\/photos\//, '/medium/') + '.jpg';
      this._showStandard(fullUrl, mediumUrl, onDetect360);
    }
  }

  destroy() { this._destroyPannellum(); }

  /** True while the current video is playing (the slideshow waits for it). */
  isVideoPlaying() {
    const v = this._video;
    return !!v && v.style.display !== 'none' && !v.paused && !v.ended;
  }

  // ── 360° ───────────────────────────────────────────────────────────────────

  /**
   * Open a 360° photo with no jolt: the light 1536 px panorama shows at once,
   * already in 3D and at the photo's initial view; the sharp one downloads
   * meanwhile and cross-fades in at the very same view (a Pannellum scene
   * change). No flat preview, no jump.
   * @param {{ full: string, light?: string|null, view?: {yaw?, pitch?, hfov?}|null }} p
   */
  _show360({ full, light = null, view = null }) {
    this._pnl.style.display = 'block';
    this._img.style.display = 'none';
    this._img.classList.remove('loaded');
    this._controls.wrapper.style.display = 'flex';
    this._destroyPannellum();

    if (this._gyroBtn) {
      this._gyroBtn.style.display = 'flex';
      this._gyroBtn.classList.toggle('active', this._gyroOn);
    }

    const at = { yaw: view?.yaw ?? 0, pitch: view?.pitch ?? 0, hfov: view?.hfov ?? 90 };
    const progressive = !!light && light !== full;
    const scene = (panorama) => ({ type: 'equirectangular', panorama, ...at });
    const token = Symbol();
    this._panoToken = token;

    // One rAF so the browser paints display:block before Pannellum reads
    // the container dimensions for WebGL (0×0 → onLoad never fires).
    requestAnimationFrame(() => {
      if (this._panoToken !== token) return;
      try {
        this._viewer = pannellum.viewer('pnl-container', {
          default: {
            firstScene:         progressive ? 'light' : 'full',
            sceneFadeDuration:  700,
            autoLoad:           true,
            showZoomCtrl:       false,
            showFullscreenCtrl: false,
            showControls:       false,
            mouseZoom:          false,   // our wheel zoom, eased (_zoomPano)
            minHfov:            30,
            maxHfov:            120,
          },
          scenes: progressive ? { light: scene(light), full: scene(full) } : { full: scene(full) },
        });
        let first = true;
        this._viewer.on('load', () => { if (first) { first = false; this._onViewerLoad(); } });
      } catch (e) {
        console.error('Pannellum init error:', e);
        return;
      }
      if (!progressive) return;
      // fetch the sharp panorama; once it is in the cache, switch scenes
      // keeping where the user is looking
      const pre = new Image();
      pre.crossOrigin = 'anonymous';           // same request as Pannellum's: shares the cache
      pre.onload = () => {
        const v = this._viewer;
        if (this._panoToken !== token || !v || v.getScene() !== 'light') return;
        const swap = () => v.loadScene('full', v.getPitch(), v.getYaw(), v.getHfov());
        if (v.isLoaded()) swap(); else v.on('load', function once() { v.off('load', once); swap(); });
      };
      pre.src = full;
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

  // ── Video ──────────────────────────────────────────────────────────────────

  _showVideo(photo) {
    this._destroyPannellum();
    this._pnl.style.display = 'none';
    this._img.style.display = 'none';
    this._controls.wrapper.style.display = 'none';
    if (!this._video) {
      this._video = document.createElement('video');
      this._video.className = 'viewer-video';
      this._video.controls = true;
      this._video.playsInline = true;
      this._video.preload = 'metadata';
      this._img.after(this._video);
    }
    this._video.style.display = 'block';
    if (this._video.dataset.src !== photo.url) {
      this._video.dataset.src = photo.url;
      this._video.src = photo.url;
    }
  }

  _hideVideo() {
    if (!this._video) return;
    this._video.pause();
    this._video.style.display = 'none';
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
          this._show360({ full: url });
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
          this._show360({ full: url });
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
    this._stopPanoZoom();
    this._panoToken = null;                 // a pending sharp panorama no longer applies
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
        this._zoomPano(1 / 1.35);
      } else {
        const r = this._root.getBoundingClientRect();
        this._zoomAt(1.5, r.width / 2, r.height / 2);
      }
    });

    zoomOut.addEventListener('click', () => {
      if (this._viewer) {
        this._zoomPano(1.35);
      } else {
        const r = this._root.getBoundingClientRect();
        this._zoomAt(1 / 1.5, r.width / 2, r.height / 2);
      }
    });

    recenter.addEventListener('click', () => {
      if (this._viewer) {
        this._stopPanoZoom();
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
    // Proportional to the scroll (a trackpad's small steps zoom a little, a
    // mouse notch ~20 %), then eased: no jumps.
    root.addEventListener('wheel', e => {
      const pano = this._viewer && this._pnl.style.display !== 'none';
      if (!pano && this._img.style.display === 'none') return;
      if (e.target.closest('.photo-map-mini, .exif-panel')) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? root.clientHeight : 1;
      // ctrlKey: a trackpad pinch, in much smaller steps
      const factor = Math.exp(-e.deltaY * px * (e.ctrlKey ? 0.01 : 0.002));
      if (pano) { this._zoomPano(1 / factor); return; }
      const rect = root.getBoundingClientRect();
      this._zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    // ── Pointer (mouse + touch) ───────────────────────────────────────────────
    const ptrs = new Map();          // pointerId → {x, y}
    let dragId     = null;
    let dragSx = 0, dragSy = 0, dragBx = 0, dragBy = 0;
    let pinch      = null;           // { dist0, scale0, tx0, ty0, cx, cy }
    const track    = [];             // recent drag positions { t, x, y }: release velocity

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
      // Don't capture clicks on overlaid interactive elements
      // (mini-map, navigation buttons, etc.) — setPointerCapture would block
      // their click event by redirecting pointerup to #viewer.
      if (e.target.closest('button, a, .photo-map-mini')) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      root.setPointerCapture(e.pointerId);
      this._stopAnim();
      track.length = 0;

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
      // Invalidate tap as soon as finger/cursor moves more than 8 px
      if (_tapped && Math.hypot(e.clientX - _tapX, e.clientY - _tapY) > 8) _tapped = false;

      if (!ptrs.has(e.pointerId) || this._img.style.display === 'none') return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinch && ptrs.size === 2) {
        // Pinch zoom — scale anchored to pinch midpoint
        const [a, b] = [...ptrs.values()];
        const dist   = Math.hypot(b.x - a.x, b.y - a.y);
        const next   = Math.max(1, Math.min(12, pinch.scale0 * dist / pinch.dist0));
        // the point under the fingers stays under them, and follows them
        const rect = root.getBoundingClientRect();
        const mx   = (a.x + b.x) / 2 - rect.left, my = (a.y + b.y) / 2 - rect.top;
        const lx   = (pinch.cx - pinch.tx0) / pinch.scale0;
        const ly   = (pinch.cy - pinch.ty0) / pinch.scale0;
        this._setView(next, mx - next * lx, my - next * ly);

      } else if (dragId === e.pointerId && this._scale > 1) {
        // Single-finger drag pan
        this._setView(this._scale, dragBx + (e.clientX - dragSx), dragBy + (e.clientY - dragSy));
        track.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
        while (track.length > 2 && e.timeStamp - track[0].t > 100) track.shift();
      }
    }, { passive: false });

    const onEnd = e => {
      ptrs.delete(e.pointerId);
      if (dragId === e.pointerId) {
        // Edge swipe → navigate between photos (takes priority over zoom/pan)
        if (isEdgeDrag && pinch === null) {
          const dx = e.clientX - dragSx;
          const dy = e.clientY - dragSy;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            this._onSwipe?.(dx < 0 ? 'left' : 'right');
          }
        }
        // released while moving: glide on (velocity of the last 100 ms)
        const first = track[0], last = track[track.length - 1];
        const dt = last && e.timeStamp - first.t;
        if (this._scale > 1 && dt > 0 && e.timeStamp - last.t < 60) {
          const GLIDE = 0.3;   // s: distance = speed × GLIDE, eased out
          const vx = ((last.x - first.x) / dt) * 1000, vy = ((last.y - first.y) / dt) * 1000;
          if (Math.hypot(vx, vy) > 150) this._animateTo(this._scale, this._tx + vx * GLIDE, this._ty + vy * GLIDE, GLIDE * 1000);
        }
        track.length = 0;
        dragId     = null;
        isEdgeDrag = false;
        this._img.style.cursor = this._scale > 1 ? 'grab' : '';
        if (!this._raf) this._settle();
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

    // ── Single click → toggle UI  /  double-click → reset zoom or recenter 360° ──
    let _clickTimer = null;

    root.addEventListener('click', e => {
      if (!_tapped) return;                                          // was a drag
      if (e.target.closest('button, a, .photo-map-mini')) return;   // interactive element

      if (_clickTimer) {
        // Second click in the window → double-click
        clearTimeout(_clickTimer);
        _clickTimer = null;
        if (this._viewer) {
          this._stopPanoZoom();
          this._viewer.setYaw(0, 600);
          this._viewer.setPitch(0, 600);
          this._viewer.setHfov(90, 600);
        } else {
          this._animateTo(1, 0, 0);
        }
      } else {
        // First click — wait to see if a second follows
        _clickTimer = setTimeout(() => {
          _clickTimer = null;
          this._onToggleUI?.();
        }, 280);
      }
    });
  }

  // ── Eased zoom & pan (standard photos) ──────────────────────────────────────
  // The view is (scale, tx, ty): img transform translate(tx, ty) scale(s),
  // origin top-left. Direct gestures (drag, pinch) set it at once; the wheel,
  // the buttons, a double-click and a released drag animate towards a goal
  // with exponential easing, frame-rate independent.

  /** Zoom by `factor` keeping the point (cx, cy) of the viewer in place — eased. */
  _zoomAt(factor, cx, cy) {
    const g    = this._goal ?? { s: this._scale, tx: this._tx, ty: this._ty };
    const next = Math.max(1, Math.min(12, g.s * factor));
    const lx = (cx - g.tx) / g.s, ly = (cy - g.ty) / g.s;
    this._animateTo(next, cx - next * lx, cy - next * ly);
  }

  /**
   * Keep the photo in view: centred along an axis where it is smaller than
   * the viewer, otherwise no empty band on either side. The <img> fills the
   * viewer with object-fit: contain, so the photo is a centred box inside it.
   */
  _clamp(s, tx, ty) {
    const W = this._root.clientWidth, H = this._root.clientHeight;
    const nw = this._img.naturalWidth, nh = this._img.naturalHeight;
    const fit = nw && nh ? Math.min(W / nw, H / nh) : 1;
    const cw = nw ? nw * fit : W, ch = nh ? nh * fit : H;
    const axis = (t, size, c) => {
      const o = (size - c) / 2;
      if (s * c <= size) return (size - s * c) / 2 - s * o;
      return Math.min(-s * o, Math.max(size - s * (o + c), t));
    };
    return { s, tx: axis(tx, W, cw), ty: axis(ty, H, ch) };
  }

  /** Set the view at once (drag, pinch). */
  _setView(s, tx, ty) {
    this._stopAnim();
    ({ s: this._scale, tx: this._tx, ty: this._ty } = this._clamp(s, tx, ty));
    this._img.style.willChange = 'transform';
    this._applyZoom();
  }

  /** Ease the view towards (s, tx, ty); `tau`: the easing's time scale in ms. */
  _animateTo(s, tx, ty, tau = 90) {
    this._goal = { ...this._clamp(s, tx, ty), tau };
    this._img.style.willChange = 'transform';
    if (this._raf) return;
    let prev = null;
    const step = (now) => {
      prev ??= now - 16;   // first frame: one frame's worth
      const g = this._goal;
      if (!g) { this._raf = null; return; }
      const k = 1 - Math.exp(-(now - prev) / g.tau);
      prev = now;
      this._scale += (g.s - this._scale) * k;
      this._tx    += (g.tx - this._tx) * k;
      this._ty    += (g.ty - this._ty) * k;
      const done = Math.abs(g.s - this._scale) < 0.002 * g.s && Math.abs(g.tx - this._tx) < 0.5 && Math.abs(g.ty - this._ty) < 0.5;
      if (done) ({ s: this._scale, tx: this._tx, ty: this._ty } = g);
      this._applyZoom();
      if (done) { this._goal = null; this._raf = null; this._settle(); return; }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _stopAnim() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._goal = null;
  }

  // At rest: let the browser redraw the zoomed photo sharp (a will-change
  // layer keeps the resolution it had when the motion started).
  _settle() {
    this._img.style.willChange = '';
  }

  _applyZoom() {
    this._img.style.transformOrigin = '0 0';
    this._img.style.transform       = `translate(${this._tx}px,${this._ty}px) scale(${this._scale})`;
    this._img.style.cursor          = this._scale > 1 ? 'grab' : '';
  }

  _resetZoom() {
    this._stopAnim();
    this._scale = 1; this._tx = 0; this._ty = 0;
    this._img.style.transform       = '';
    this._img.style.transformOrigin = '';
    this._img.style.cursor          = '';
    this._settle();
  }

  // ── Eased zoom (360°) ────────────────────────────────────────────────────────

  /** Multiply the 360° field of view by `factor` (> 1 zooms out), eased. */
  _zoomPano(factor) {
    const v = this._viewer;
    if (!v) return;
    const from = this._hfovGoal ?? v.getHfov();
    this._hfovGoal = Math.max(30, Math.min(120, from * factor));
    if (this._hfovRaf) return;
    let prev = null;
    const step = (now) => {
      prev ??= now - 16;   // first frame: one frame's worth
      const goal = this._hfovGoal, view = this._viewer;
      if (goal == null || !view) { this._hfovRaf = null; return; }
      const k = 1 - Math.exp(-(now - prev) / 90);
      prev = now;
      const h = view.getHfov();
      const done = Math.abs(goal - h) < 0.05;
      view.setHfov(done ? goal : h + (goal - h) * k, false);
      if (done || Math.abs(view.getHfov() - h) < 1e-4) { this._hfovGoal = null; this._hfovRaf = null; return; }
      this._hfovRaf = requestAnimationFrame(step);
    };
    this._hfovRaf = requestAnimationFrame(step);
  }

  _stopPanoZoom() {
    if (this._hfovRaf) cancelAnimationFrame(this._hfovRaf);
    this._hfovRaf = null;
    this._hfovGoal = null;
  }
}
