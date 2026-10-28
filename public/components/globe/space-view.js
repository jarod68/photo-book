/**
 * Globe page — the "space" view (Three.js): the Earth from orbit.
 *
 *  - NASA Blue Marble by day, Black Marble city lights by night, the
 *    terminator at the sun's real position (updated every minute), sun glint
 *    on the oceans only (Natural Earth water mask), a scattering rim;
 *  - an atmosphere halo, a starfield with a Milky Way band;
 *  - the photos as round thumbnails, grouped on screen when they overlap
 *    (with a count); a click flies to the photo or zooms into the group;
 *  - localised country names (Intl.DisplayNames).
 *
 * The page switches to the MapLibre "near" view below NEAR_DISTANCE
 * (see pages/globe.js); this view only reports it through onNear().
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { lonLatToXyz, xyzToLonLat, subsolarPoint, clusterScreen, angularDistance } from '../../utils/globe-math.js';

export const FOV = 45;
export const NEAR_DISTANCE = 1.22;       // closer than this (≈1 400 km up): the near view takes over
const MIN_DISTANCE = 1.12;
const MAX_DISTANCE = 6;
const MARKER_PX = 54;                     // thumbnail diameter on screen
const CLUSTER_PX = 50;                    // thumbnails closer than this on screen are grouped
const TEX = '/textures/earth';

// ISO code, lat, lng, farthest camera distance at which the name shows
const COUNTRIES = [
  ['RU', 62, 96, 9], ['CA', 58, -100, 9], ['US', 40, -98, 9], ['BR', -10, -52, 9], ['AU', -25, 133, 9],
  ['CN', 35, 103, 9], ['IN', 22, 80, 9], ['AR', -35, -65, 9], ['KZ', 48, 68, 9], ['DZ', 28, 2, 9],
  ['CD', -3, 23, 2.2], ['LY', 27, 18, 2.2], ['MX', 24, -102, 2.2], ['PE', -10, -76, 2.2], ['MN', 46, 105, 2.2],
  ['EG', 26, 30, 2.2], ['NG', 9, 8, 2.2], ['ET', 9, 40, 2.2], ['ZA', -30, 25, 2.2], ['SA', 24, 45, 2.2],
  ['IR', 32, 54, 2.2], ['ID', -2, 118, 2.2], ['PK', 30, 70, 2.2], ['CO', 4, -72, 2.2], ['GL', 72, -42, 2.2],
  ['FR', 46.5, 2.5, 1.8], ['DE', 51, 10, 1.8], ['GB', 53, -2, 1.8], ['IT', 43, 12, 1.8], ['ES', 40, -4, 1.8],
  ['UA', 49, 32, 1.8], ['TR', 39, 35, 1.8], ['JP', 37, 138, 1.8], ['KR', 36.5, 128, 1.8], ['VN', 16, 107, 1.8],
  ['TH', 15, 101, 1.8], ['MM', 21, 96, 1.8], ['AO', -12, 18, 1.8], ['ML', 17, -2, 1.8], ['MZ', -18, 35, 1.8],
  ['VE', 7, -66, 1.8], ['CL', -30, -71, 1.8], ['SE', 62, 16, 1.8], ['NO', 64, 12, 1.8], ['FI', 64, 26, 1.8],
  ['MA', 31.5, -7, 1.8], ['PL', 52, 19.5, 1.8], ['AF', 33.5, 66, 1.8], ['IQ', 33, 44, 1.8], ['MY', 3.5, 102, 1.8],
  ['SD', 15, 30, 1.8], ['NZ', -42, 173, 1.8], ['MG', -19.5, 46.5, 1.8], ['IS', 64.9, -18.6, 1.8], ['PT', 39.6, -8, 1.5],
  ['PH', 12.5, 122, 1.8], ['KE', 0.5, 38, 1.8], ['TZ', -6.5, 35, 1.8], ['BO', -16.5, -64.5, 1.8], ['CU', 21.8, -79, 1.5],
];

// ── Shaders ─────────────────────────────────────────────────────────────────

const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const EARTH_FRAG = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D waterMap;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float cs = dot(n, sunDir);
    float day = smoothstep(-0.12, 0.22, cs);                 // soft terminator
    vec3 dayC = texture2D(dayMap, vUv).rgb;
    vec3 nightC = texture2D(nightMap, vUv).rgb;
    float water = texture2D(waterMap, vUv).r;

    vec3 lit = dayC * (0.06 + 1.10 * pow(clamp(cs, 0.0, 1.0), 0.7));
    vec3 lights = nightC * nightC * vec3(1.0, 0.80, 0.52) * 2.6;  // warm city lights
    vec3 col = mix(lights, lit, day);

    // sun glint on water
    vec3 h = normalize(sunDir + v);
    float nh = max(dot(n, h), 0.0);
    float glint = pow(nh, 400.0) * 0.9 + pow(nh, 40.0) * 0.12;      // a sharp core, a soft sheen
    col += glint * water * smoothstep(0.0, 0.25, cs) * vec3(1.0, 0.95, 0.85);

    // dusk: a thin warm band along the terminator, on the lit surface only
    float dusk = smoothstep(-0.06, 0.03, cs) * (1.0 - smoothstep(0.03, 0.16, cs));
    col = mix(col, col * vec3(1.3, 0.85, 0.62), dusk * 0.7);

    // atmospheric scattering at the limb, brighter on the day side
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.5);
    col += fres * vec3(0.30, 0.58, 1.0) * (0.12 + 0.9 * smoothstep(-0.25, 0.6, cs));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const ATMO_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

// Rendered on the back faces of a slightly larger sphere (radius ATMO_R): a
// glow brightest right at the Earth's limb, fading out to the shell's edge;
// blue on the day side, faint on the night side. On a back face, |n·v| goes
// from ~sqrt(1 - 1/ATMO_R²) at the limb to 0 at the shell's outer edge.
const ATMO_R = 1.045;
const ATMO_FRAG = /* glsl */ `
  uniform vec3 sunDir;
  uniform float limb;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float t = clamp(abs(dot(n, v)) / limb, 0.0, 1.0);    // 1 at the limb, 0 at the edge
    float glow = pow(t, 2.2);
    float lit = 0.06 + 0.94 * smoothstep(-0.3, 0.5, dot(n, sunDir));
    vec3 col = mix(vec3(0.12, 0.28, 0.75), vec3(0.45, 0.70, 1.0), lit) * glow * lit * 1.35;
    gl_FragColor = vec4(col, glow * lit);
    #include <colorspace_fragment>
  }`;

const STAR_VERT = /* glsl */ `
  attribute float size;
  attribute vec3 tint;
  uniform float pixelRatio;
  varying vec3 vTint;
  void main() {
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * mv;
  }`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vTint * a, a);
  }`;

// ── Helpers ─────────────────────────────────────────────────────────────────

const v3 = (lat, lng, r = 1) => new THREE.Vector3(...lonLatToXyz(lat, lng, r));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function loadTexture(url, srgb = true) {
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    resolve(t);
  }, undefined, reject));
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// A round marker: the photo (cover-cropped), a white ring, a count badge for groups.
function markerCanvas(img, count) {
  const S = 160;                                  // drawn at 3× for sharp HiDPI
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = S * 0.40, cx = S / 2, cy = S / 2;
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 14;
  g.beginPath(); g.arc(cx, cy, r + 5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  g.shadowBlur = 0;
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  if (img) {
    const s = Math.max((2 * r) / img.width, (2 * r) / img.height);
    g.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
  } else {
    g.fillStyle = '#3b82f6'; g.fillRect(0, 0, S, S);
  }
  g.restore();
  if (count > 1) {
    const label = count > 99 ? '99+' : String(count);
    g.font = '600 34px -apple-system, "Segoe UI", sans-serif';
    const w = Math.max(44, g.measureText(label).width + 22);
    const bx = cx + r * 0.62 - w / 2, by = cy - r - 8;
    g.fillStyle = '#3b82f6';
    g.beginPath(); g.roundRect(bx, by, w, 44, 22); g.fill();
    g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, bx + w / 2, by + 23);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── View ────────────────────────────────────────────────────────────────────

export class SpaceView {
  /**
   * @param {HTMLElement} container
   * @param {{ photos: object[], lang: string, onNear: Function, onPhoto: Function, onGroup: Function }} opts
   *   photos: /api/map entries ({ gps, album, filename, name, thumbUrl, … })
   *   onNear({ lat, lng, distance }): the camera came closer than NEAR_DISTANCE
   *   onPhoto(photo): a single photo was clicked
   *   onGroup(photos): a group of photos within a few degrees (a city, a region) was clicked
   *   at: a fixed date for the sun (screenshots); still: no auto-rotation
   */
  constructor(container, { photos, lang, onNear, onPhoto, onGroup, at = null, still = false }) {
    this.at = at;
    this.container = container;
    this.onNear = onNear;
    this.onPhoto = onPhoto;
    this.onGroup = onGroup;
    this.active = true;
    this.anim = null;
    this.lastZoomIn = 0;

    const W = container.clientWidth, H = container.clientHeight;
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000);
    container.appendChild(renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.setSize(W, H);
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, W / H, 0.005, 200);
    // Atlantic, Europe and Africa in view; far enough for the whole globe to
    // fit the narrower side (portrait phones)
    const halfFov = Math.min(FOV / 2 * Math.PI / 180, Math.atan(Math.tan(FOV / 2 * Math.PI / 180) * (W / H)));
    this.camera.position.copy(v3(30, -20, Math.max(2.7, 1 / Math.sin(Math.atan(Math.tan(halfFov) * 0.82)))));

    const controls = this.controls = new OrbitControls(this.camera, renderer.domElement);
    Object.assign(controls, {
      enableDamping: true, dampingFactor: 0.08, enablePan: false,
      minDistance: MIN_DISTANCE, maxDistance: MAX_DISTANCE,
      rotateSpeed: 0.5, zoomSpeed: 0.9, autoRotate: !still, autoRotateSpeed: 0.25,
    });
    let resume = null;
    // A touch or click starts a controls gesture too: only a real drag or the
    // wheel interrupts a flight (see bindPointer / the wheel listener).
    controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(resume); });
    controls.addEventListener('end', () => { if (!still) resume = setTimeout(() => { controls.autoRotate = true; }, 6000); });
    renderer.domElement.addEventListener('wheel', (e) => {
      this.cancelFlight();
      if (e.deltaY < 0) this.lastZoomIn = performance.now();
    }, { passive: true });
    renderer.domElement.addEventListener('touchmove', (e) => { if (e.touches.length === 2) this.lastZoomIn = performance.now(); }, { passive: true });

    this.sun = new THREE.Vector3();
    this.updateSun();
    this.sunTimer = setInterval(() => this.updateSun(), 60_000);

    this.buildStars();
    this.buildEarth();
    this.buildLabels(lang);
    this.buildMarkers(photos);
    this.bindPointer();

    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  updateSun() {
    const s = subsolarPoint(this.at ?? new Date());
    this.sun.copy(v3(s.lat, s.lng)).normalize();
  }

  // ── Scene ────────────────────────────────────────────────────────────────

  buildStars() {
    const N = 9000, pos = [], size = [], tint = [];
    const rnd = (() => { let s = 12345; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();   // stable sky
    // galactic plane: a great circle tilted ~63° to the equator
    const pole = new THREE.Vector3(-0.87, 0.46, -0.18).normalize();
    for (let i = 0; i < N; i++) {
      let d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      const band = i > N * 0.55;                       // 45 % of the stars crowd the Milky Way
      if (band) {
        d.addScaledVector(pole, -d.dot(pole) + (rnd() - 0.5) * (rnd() * 0.35)).normalize();
      }
      d.multiplyScalar(80);
      pos.push(d.x, d.y, d.z);
      const m = rnd() ** (band ? 6 : 3.2);
      size.push(band ? 0.6 + m * 1.8 : 0.8 + m * 3.6);
      const t = rnd();                                // colour temperature
      const c = t < 0.15 ? [0.75, 0.82, 1] : t > 0.9 ? [1, 0.85, 0.7] : [1, 1, 1];
      const b = band ? 0.35 + m * 0.6 : 0.5 + m * 0.6;
      tint.push(c[0] * b, c[1] * b, c[2] * b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
    geo.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 3));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      uniforms: { pixelRatio: { value: this.renderer.getPixelRatio() } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.scene.add(new THREE.Points(geo, this.starMat));
  }

  async buildEarth() {
    const caps = this.renderer.capabilities;
    // 8K textures (128 MB each once decoded) on large screens only: phones and
    // tablets (coarse pointer) get 4K, which mobile Safari keeps in memory.
    const touch = matchMedia('(pointer: coarse)').matches;
    const big = !touch && caps.maxTextureSize >= 8192 && Math.max(screen.width, screen.height) * devicePixelRatio > 1600 ? 8192 : 4096;
    const aniso = caps.getMaxAnisotropy();
    const [day, night, water] = await Promise.all([
      loadTexture(`${TEX}/day-2048.webp`), loadTexture(`${TEX}/night-2048.webp`), loadTexture(`${TEX}/water-4096.webp`, false),
    ]);
    for (const t of [day, night, water]) t.anisotropy = aniso;

    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG,
      uniforms: { dayMap: { value: day }, nightMap: { value: night }, waterMap: { value: water }, sunDir: { value: this.sun } },
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 128), this.earthMat);
    this.scene.add(this.earth);

    const atmo = new THREE.Mesh(new THREE.SphereGeometry(ATMO_R, 96, 64), new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
      uniforms: { sunDir: { value: this.sun }, limb: { value: Math.sqrt(1 - 1 / (ATMO_R * ATMO_R)) } },
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(atmo);
    this.container.dispatchEvent(new CustomEvent('globe-ready'));
    this.ready = true;

    // sharper textures, swapped in once loaded
    const [dayHi, nightHi] = await Promise.all([
      loadTexture(`${TEX}/day-${big}.webp`), loadTexture(`${TEX}/night-${big}.webp`),
    ]).catch(() => []);
    if (dayHi) {
      for (const t of [dayHi, nightHi]) t.anisotropy = aniso;
      this.earthMat.uniforms.dayMap.value = dayHi;
      this.earthMat.uniforms.nightMap.value = nightHi;
      day.dispose(); night.dispose();
    }
    this.sharp = true;   // full-resolution textures in place (tests wait for it)
  }

  buildLabels(lang) {
    let names;
    try { names = new Intl.DisplayNames([lang, 'en'], { type: 'region' }); } catch { names = { of: (c) => c }; }
    this.countryLabels = COUNTRIES.map(([code, lat, lng, maxDist]) => {
      const div = document.createElement('div');
      div.className = 'globe-label';
      div.textContent = names.of(code);
      const obj = new CSS2DObject(div);
      obj.position.copy(v3(lat, lng, 1.004));
      this.scene.add(obj);
      return { obj, dir: obj.position.clone().normalize(), maxDist, vis: null };
    });
  }

  buildMarkers(photos) {
    this.photos = photos.map((p) => ({ ...p, pos: v3(p.gps.lat, p.gps.lng, 1.002), img: null }));
    this.textures = new Map();          // "photo index:count" → texture
    this.sprites = [];                  // pool
    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);
    // thumbnails load in the background; markers redraw as they arrive
    this.photos.forEach((p) => {
      if (!p.thumbUrl) return;
      loadImage(p.thumbUrl).then((img) => {
        p.img = img;
        for (const [k, t] of this.textures) if (k.startsWith(`${this.photos.indexOf(p)}:`)) { t.dispose(); this.textures.delete(k); }
        this.markersDirty = true;
      });
    });
    this.markersDirty = true;
  }

  textureFor(index, count) {
    const key = `${index}:${count}`;
    if (!this.textures.has(key)) this.textures.set(key, markerCanvas(this.photos[index].img, count));
    return this.textures.get(key);
  }

  // Group the photos facing the camera by screen proximity, one sprite per group.
  layoutMarkers() {
    const cam = this.camera.position, W = this.container.clientWidth, H = this.container.clientHeight;
    const pts = [];
    const tmp = new THREE.Vector3();
    this.photos.forEach((p, i) => {
      if (p.pos.dot(cam) <= 1.01) return;                    // behind the horizon
      tmp.copy(p.pos).project(this.camera);
      pts.push({ i, x: (tmp.x + 1) / 2 * W, y: (1 - tmp.y) / 2 * H });
    });
    const groups = clusterScreen(pts, CLUSTER_PX);
    const scale = (MARKER_PX * 2 * Math.tan((FOV / 2) * Math.PI / 180)) / H;
    groups.forEach((g, k) => {
      let s = this.sprites[k];
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false, depthTest: false, transparent: true }));
        s.renderOrder = 10;
        this.sprites.push(s);
        this.markerGroup.add(s);
      }
      const first = g.items[0].i;
      s.material.map = this.textureFor(first, g.items.length);
      s.material.needsUpdate = true;
      s.position.copy(this.photos[first].pos);
      s.scale.set(scale, scale, 1);
      s.visible = true;
      s.userData.items = g.items.map((it) => this.photos[it.i]);
    });
    for (let k = groups.length; k < this.sprites.length; k++) this.sprites[k].visible = false;
  }

  /** The marker sprite under a page position, if any. */
  pick(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray ??= new THREE.Raycaster();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    return this.ray.intersectObjects(this.sprites.filter((s) => s.visible), false)[0]?.object;
  }

  bindPointer() {
    const el = this.renderer.domElement;
    const hit = (e) => this.pick(e.clientX, e.clientY);
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const s = hit(e);
      if (!s) return;
      const items = s.userData.items;
      if (items.length === 1) { this.onPhoto(items[0]); return; }
      const c = items.reduce((a, p) => a.add(p.pos), new THREE.Vector3()).normalize();
      const centre = xyzToLonLat([c.x, c.y, c.z]);
      const spread = Math.max(...items.map((p) => angularDistance(centre, p.gps)));
      // photos of one city or region: straight down to the near view, framed on them
      if (spread < 3) { this.onGroup(items, centre); return; }
      // spread wider: come close enough for the group to split on screen
      this.flyTo(centre.lat, centre.lng, Math.max(NEAR_DISTANCE * 1.05, 1 + (spread * Math.PI / 180) * 2.2));
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons) {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) this.cancelFlight();   // a drag
        return;
      }
      el.style.cursor = hit(e) ? 'pointer' : '';
    });
  }

  /** Screen positions of the visible markers (for tests): [{ x, y, count }]. */
  markerPositions() {
    const W = this.container.clientWidth, H = this.container.clientHeight, v = new THREE.Vector3();
    return this.sprites.filter((s) => s.visible).map((s) => {
      v.copy(s.position).project(this.camera);
      return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, count: s.userData.items.length };
    });
  }

  // ── Camera ───────────────────────────────────────────────────────────────

  distance() { return this.camera.position.length(); }

  /** Centre of the view and camera distance. */
  view() {
    const p = this.camera.position;
    return { ...xyzToLonLat([p.x, p.y, p.z]), distance: p.length() };
  }

  /** Jump to a view (from the near view's centre and zoom). */
  setView(lat, lng, distance) {
    this.cancelFlight();
    this.camera.position.copy(v3(lat, lng, Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance))));
    this.controls.update();
    this.markersDirty = true;
  }

  /** Stop a flight where it is; its promise resolves with false. */
  cancelFlight() {
    if (!this.anim) return;
    this.anim = null;
    this.flightDone?.(false);
  }

  /**
   * Animated flight: the direction follows the great circle, the distance eases.
   * Resolves with true on arrival, false if the user interrupted it.
   */
  flyTo(lat, lng, distance, ms = 1800) {
    this.cancelFlight();
    const from = this.camera.position.clone();
    const d0 = from.length();
    const dirFrom = from.clone().normalize(), dirTo = v3(lat, lng).normalize();
    const angle = dirFrom.angleTo(dirTo);
    const lift = Math.min(1.2, angle * 0.6);              // rise a little on long trips
    const rot = new THREE.Quaternion().setFromUnitVectors(dirFrom, dirTo);
    this.controls.autoRotate = false;
    return new Promise((resolve) => {
      this.flightDone = resolve;
      const t0 = performance.now(), dur = Math.max(600, ms * Math.min(1, 0.4 + angle));
      this.anim = (now) => {
        const t = Math.min(1, (now - t0) / dur), e = easeInOut(t);
        const dir = dirFrom.clone();
        if (angle > 1e-4) dir.applyQuaternion(new THREE.Quaternion().slerp(rot, e));
        const d = d0 + (distance - d0) * e + Math.sin(Math.PI * e) * lift * (d0 > 1.6 ? 0.3 : 1);
        this.camera.position.copy(dir.normalize().multiplyScalar(d));
        this.camera.lookAt(0, 0, 0);
        if (t >= 1) { this.anim = null; resolve(true); }
      };
    });
  }

  // ── Loop ─────────────────────────────────────────────────────────────────

  pause() { this.active = false; this.controls.enabled = false; }
  resume() { this.active = true; this.controls.enabled = true; this.markersDirty = true; requestAnimationFrame(this.loop); }

  resize() {
    const W = this.container.clientWidth, H = this.container.clientHeight;
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H);
    this.labels.setSize(W, H);
    this.markersDirty = true;
  }

  loop(now) {
    if (!this.active) return;
    requestAnimationFrame(this.loop);
    if (this.anim) this.anim(now);
    else this.controls.update();

    const d = this.distance();
    // slower and finer control close to the surface
    const k = Math.min(1, Math.max(0, (d - 1) / 2));
    this.controls.rotateSpeed = 0.08 + 0.5 * k;
    this.controls.zoomSpeed = 0.35 + 0.6 * k;

    const cam = this.camera.position;
    const camDir = cam.clone().normalize();
    for (const l of this.countryLabels) {
      const vis = l.dir.dot(camDir) > 0.35 && d <= l.maxDist && d > NEAR_DISTANCE;
      if (vis !== l.vis) { l.obj.element.style.opacity = vis ? '1' : '0'; l.vis = vis; }
    }

    const moved = !this.lastCam || !this.lastCam.equals(cam);
    if (moved || this.markersDirty) {
      this.layoutMarkers();
      this.markersDirty = false;
      this.lastCam = cam.clone();
    }

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);

    // the user zoomed in close enough: hand over to the near view (not during a flight)
    if (!this.anim && d < NEAR_DISTANCE && now - this.lastZoomIn < 1500) {
      this.lastZoomIn = 0;
      this.onNear(this.view());
    }
  }
}
